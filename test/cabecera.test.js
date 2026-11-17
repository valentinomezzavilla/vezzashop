import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { validarAjustes, leerAjustes, TAMANOS_LOGO } from '../src/diseno.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

let servidor;
let puerto;
let db;
let dirSubidas;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = await abrirBase(':memory:');
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

const AJUSTES = { colorPrincipal: '#0a3d62', franjaTexto: '', ordenCatalogo: 'nombre', whatsapp: '', instagram: '', facebook: '', tiktok: '', emailContacto: '', direccion: '' };

// Una tienda con tres categorías de primer nivel (una con subcategorías), todas con productos visibles.
async function tiendaConCategorias(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock', 'Categorías'],
    ['R-1', 'Remera', 10000, 5, 'Ropa > Remeras'],
    ['P-1', 'Pelota', 20000, 5, 'Deportes'],
    ['A-1', 'Auriculares', 30000, 5, 'Tecnología'],
  ]);
  await aplicarImportacion(db, tienda.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  const raiz = Object.fromEntries((await db.prepare('SELECT id, nombre FROM categorias WHERE tienda_id = ? AND padre_id IS NULL').all(tienda.id)).map((c) => [c.nombre, c.id]));
  return { nav, tiendaId: tienda.id, raiz, slug };
}

const vidriera = (slug, ruta = '/') => pedirConHost(puerto, `${slug}.localhost`, ruta);
// Las categorías que aparecen en la barra de arriba (no las del pie ni las del catálogo).
const enBarra = (html) => [...(html.match(/<nav class="navegacion"[\s\S]*?<\/nav>/)?.[0] ?? '').matchAll(/<li class="navegacion-item[^"]*">\s*<a href="[^"]*">([^<]+)/g)].map((m) => m[1].trim());

test('validarAjustes: el estilo del menú y el tamaño del logo se validan, y si no vienen el ajuste no se toca', () => {
  const bien = validarAjustes({ ...AJUSTES, menuEstilo: 'desplegable', logoTamano: 'grande' });
  assert.deepEqual(bien.errores, {});
  assert.equal(bien.ajustes.menuEstilo, 'desplegable');
  assert.equal(bien.ajustes.logoTamano, 'grande');

  const mal = validarAjustes({ ...AJUSTES, menuEstilo: 'flotante', logoTamano: 'enorme' });
  assert.ok(mal.errores.menuEstilo && mal.errores.logoTamano);
  // Prototipos y claves raras no valen como opción.
  assert.ok(validarAjustes({ ...AJUSTES, menuEstilo: 'constructor' }).errores.menuEstilo);
  assert.ok(validarAjustes({ ...AJUSTES, logoTamano: '__proto__' }).errores.logoTamano);

  // Un formulario que no trae estos campos (como los de antes) no los cambia.
  const sin = validarAjustes(AJUSTES);
  assert.deepEqual(sin.errores, {});
  assert.equal('menuEstilo' in sin.ajustes, false);
  assert.equal('logoTamano' in sin.ajustes, false);
});

test('por defecto el menú es una barra con todas las categorías y el logo es mediano', async () => {
  const { nav, slug, raiz } = await tiendaConCategorias('cabdefecto');
  const html = (await vidriera(slug)).cuerpo;
  assert.match(html, /<header class="cabecera" data-menu="barra">/);
  assert.match(html, /--logo-alto: 40px/);
  assert.deepEqual(enBarra(html).sort(), ['Deportes', 'Ropa', 'Tecnología']);
  // Y en el panel están todas marcadas.
  const panel = await (await nav.pedir('/admin/diseno')).text();
  for (const id of Object.values(raiz)) assert.match(panel, new RegExp(`name="menuCategorias" value="${id}"[^>]*checked`));
  assert.match(panel, /name="menuEstilo" value="barra" checked/);
  assert.match(panel, /name="logoTamano" value="mediano" checked/);
});

test('desde Diseño se elige el estilo del menú, el logo y qué categorías van arriba; el pie las sigue mostrando todas', async () => {
  const { nav, slug, raiz, tiendaId } = await tiendaConCategorias('cabelegida');
  const respuesta = await nav.enviarArchivos('/admin/diseno', {
    ...AJUSTES,
    menuEstilo: 'desplegable',
    logoTamano: 'grande',
    menuCategoriasEnviado: '1',
    menuCategorias: [String(raiz.Ropa), String(raiz.Deportes)],
  }, { desde: '/admin/diseno' });
  assert.equal(respuesta.status, 302);

  const ajustes = await leerAjustes(db, tiendaId);
  assert.equal(ajustes.menuEstilo, 'desplegable');
  assert.equal(ajustes.logoTamano, 'grande');

  const html = (await vidriera(slug)).cuerpo;
  assert.match(html, /<header class="cabecera" data-menu="desplegable">/);
  assert.match(html, new RegExp(`--logo-alto: ${TAMANOS_LOGO.grande.alto}px`));
  assert.deepEqual(enBarra(html).sort(), ['Deportes', 'Ropa'], 'Tecnología no está en el menú');
  const cabecera = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.doesNotMatch(cabecera, /Tecnología/, 'tampoco en el menú del celular ni en el desplegable');
  assert.match(html.slice(html.indexOf('<footer')), /Tecnología/, 'el pie muestra todas');

  // La pantalla de Diseño lo recuerda.
  const panel = await (await nav.pedir('/admin/diseno')).text();
  assert.match(panel, /name="menuEstilo" value="desplegable" checked/);
  assert.match(panel, /name="logoTamano" value="grande" checked/);
  assert.match(panel, new RegExp(`value="${raiz.Tecnología}"[^>]*data-categoria-menu data-nombre="Tecnología">`), 'sin marcar');
  assert.doesNotMatch(panel, new RegExp(`value="${raiz.Tecnología}"[^>]*checked`));
});

test('si el formulario no avisa que envió las categorías, no se toca cuáles van en el menú (aunque no haya casillas marcadas)', async () => {
  const { nav, slug, raiz } = await tiendaConCategorias('cabsinmarca');
  await nav.enviarArchivos('/admin/diseno', { ...AJUSTES, menuCategoriasEnviado: '1', menuCategorias: [String(raiz.Ropa)] }, { desde: '/admin/diseno' });
  assert.deepEqual(enBarra((await vidriera(slug)).cuerpo), ['Ropa']);
  // Un envío sin ese campo (como los formularios de antes) deja todo como estaba.
  await nav.enviarArchivos('/admin/diseno', { ...AJUSTES, colorPrincipal: '#111111' }, { desde: '/admin/diseno' });
  assert.deepEqual(enBarra((await vidriera(slug)).cuerpo), ['Ropa']);
  // Desmarcar todas es válido: no queda barra ni botón de menú.
  await nav.enviarArchivos('/admin/diseno', { ...AJUSTES, menuCategoriasEnviado: '1' }, { desde: '/admin/diseno' });
  const html = (await vidriera(slug)).cuerpo;
  assert.deepEqual(enBarra(html), []);
  assert.doesNotMatch(html, /data-menu-movil/);
});

test('no se puede cambiar el menú de otra tienda mandando sus ids', async () => {
  const una = await tiendaConCategorias('cabuna');
  const otra = await tiendaConCategorias('cabotra');
  await una.nav.enviarArchivos('/admin/diseno', {
    ...AJUSTES,
    menuCategoriasEnviado: '1',
    menuCategorias: [String(una.raiz.Ropa), String(otra.raiz.Ropa), String(otra.raiz.Deportes), 'no-es-un-numero', '1e3'],
  }, { desde: '/admin/diseno' });
  assert.deepEqual(enBarra((await vidriera(otra.slug)).cuerpo).sort(), ['Deportes', 'Ropa', 'Tecnología'], 'la otra tienda sigue igual');
  assert.deepEqual(enBarra((await vidriera(una.slug)).cuerpo), ['Ropa']);
});

test('el menú de la tienda no se superpone con los íconos: la barra recorta y tienda.js junta lo que no entra en "Más"', () => {
  const css = readFileSync(new URL('../src/publico/tienda.css', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../src/publico/tienda.js', import.meta.url), 'utf8');
  assert.match(css, /\.navegacion \{ flex: 1; min-width: 0; overflow: hidden; \}/, 'la barra no pasa de su lugar');
  assert.match(css, /\.navegacion-item \{ position: relative; flex-shrink: 0; \}/);
  assert.match(css, /\.navegacion\.ajustada \{ overflow: visible; \}/);
  assert.match(js, /function menuDeCategorias\(\)/);
  assert.match(js, /new ResizeObserver\(siguiente\)/, 'se recalcula al cambiar el tamaño de la ventana');
  assert.match(js, /^menuDeCategorias\(\);$/m, 'se ejecuta');
});
