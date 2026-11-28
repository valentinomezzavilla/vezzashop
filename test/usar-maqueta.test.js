// Usar una maqueta en la tienda real y deshacerlo (src/usar-maqueta.js): lo que se propone, lo que se aplica, cómo se vuelve atrás sin pisar lo que el cliente
// cambió después, y que nunca queden archivos de más. n8n se reemplaza por un servidor de mentira, como en kit-de-marca.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearPlan } from '../src/plataforma.js';
import { actualizarAjustes, agregarBanner, borrarBanner, leerAjustes, listarBanners } from '../src/diseno.js';
import { borrarImagen, guardarImagen } from '../src/imagenes.js';
import { funcionesDePreset } from '../src/diseno-por-plan.js';
import { borrarArchivo, listarArchivos } from '../src/marca.js';
import { borrarMaqueta, datosParaUsar, entregarMaqueta, pedirMaqueta } from '../src/maquetas.js';
import { CLAVES_DE_ITEMS, deshacerUso, leerUso, proponerUso, usarMaqueta } from '../src/usar-maqueta.js';
import { crearNavegador, pedirConHost, PNG, otraFoto } from './ayudantes.js';

let db;
let servidor;
let n8n;
let puerto;
let dirSubidas;
let contador = 0;
const recibidos = [];

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'usar-maqueta-'));
  n8n = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (parte) => (cuerpo += parte));
    req.on('end', () => {
      recibidos.push(JSON.parse(cuerpo || '{}'));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"recibido":true}');
    });
  });
  n8n.listen(0);
  await once(n8n, 'listening');
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas,
    maquetas: { url: `http://127.0.0.1:${n8n.address().port}/webhook/maquetas`, secreto: 'secreto-de-n8n' },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor?.closeAllConnections();
  servidor?.close();
  n8n?.closeAllConnections();
  n8n?.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

// ---------- Ayudas ----------

const HTML_OK = '<!doctype html><html><head><meta charset="utf-8"><title>Maqueta</title></head><body><h1>Casa de ejemplo</h1><p>Una tienda con mucho para ver y comprar</p></body></html>';
const TEXTOS = {
  anuncio: 'Envíos a todo el país',
  eslogan: 'Tu casa, tu estilo',
  bajada: 'Todo para el hogar.',
  boton: 'Ver productos',
  sobreTitulo: 'Sobre nosotros',
  sobreTexto: 'Somos una tienda familiar que ama lo hecho a mano.',
  valores: [{ titulo: 'Uno', texto: 'Uno bien' }, { titulo: 'Dos', texto: 'Dos bien' }, { titulo: 'Tres', texto: 'Tres bien' }],
  cierre: 'Gracias por visitarnos',
};
const TODOS = ['colorPrincipal', 'logo', 'franjaTexto', 'descripcion', 'banner'];

// Una tienda con la sesión iniciada, en un plan con las funciones del punto de partida dado (o de una lista) y, si se pide, con tope de banners.
async function tienda({ nivel = 'acompanado', maxBanners = null } = {}) {
  contador++;
  const slug = `usar-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Casa ${contador}`, email: `${slug}@ejemplo.com`, slug });
  const funciones = Array.isArray(nivel) ? nivel : funcionesDePreset(nivel);
  const planId = await crearPlan(db, { nombre: `Plan ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners, activo: true, funciones });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planId, creada.id);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug };
}

const pagina = async (t, ruta) => (await t.nav.pedir(ruta)).text();
const imagen = (n, nombre = `foto-${n}.png`) => ({ contenido: otraFoto(n), nombre });
const subir = (t, archivos, tipo = 'foto') => t.nav.enviarArchivos('/admin/marca/archivos', { tipo, archivos }, { desde: '/admin/marca' });
const guardarKit = (t, colorPrincipal) => t.nav.enviar('/admin/marca', { colorPrincipal }, { desde: '/admin/marca' });
const entregar = (id, cuerpo) =>
  fetch(`http://127.0.0.1:${puerto}/webhooks/maquetas/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
const vidriera = async (t, ruta = '/') => (await pedirConHost(puerto, `${t.slug}.localhost`, ruta)).cuerpo;
const archivosDe = (t) => {
  const dir = path.join(dirSubidas, String(t.tiendaId));
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
const hayArchivo = (t, archivo) => existsSync(path.join(dirSubidas, String(t.tiendaId), archivo));

// El kit: el color principal, un logo y `fotos` fotos.
async function conKit(t, { color = '#aa3300', logo = true, fotos = 1 } = {}) {
  assert.equal((await guardarKit(t, color)).status, 302);
  if (logo) assert.equal((await subir(t, [imagen(10, 'logo.png')], 'logo')).status, 302);
  if (fotos) assert.equal((await subir(t, Array.from({ length: fotos }, (_, i) => imagen(20 + i)))).status, 302);
}
// Pide una maqueta por el panel (así queda guardado el kit de ese momento) y la entrega lista, con los textos dados (sin textos, null).
async function maquetaLista(t, textos = TEXTOS) {
  const antes = recibidos.length;
  assert.equal((await t.nav.enviar('/admin/marca/maqueta', {}, { desde: '/admin/marca' })).status, 302);
  assert.equal(recibidos.length, antes + 1, 'le llegó el aviso a n8n');
  const { id, token } = recibidos.at(-1).maqueta;
  const respuesta = await entregar(id, { token, estado: 'lista', html: HTML_OK, resumen: 'Colores. Textos redactados con IA.', ...(textos ? { textos } : {}) });
  assert.equal(respuesta.status, 200);
  return id;
}
// `desde`: la página de donde sale el token de la sesión (para armar un pedido a mano cuando la pantalla de confirmación no se puede abrir, se usa otra).
const usar = (t, id, items, desde = `/admin/marca/maqueta/${id}/usar`) => t.nav.enviar(`/admin/marca/maqueta/${id}/usar`, items.map((i) => ['items', i]), { desde });
const deshacer = (t, desde = '/admin/marca/maqueta') => t.nav.enviar('/admin/marca/maqueta/deshacer', {}, { desde });
const itemDe = (propuesta, clave) => propuesta.items.find((i) => i.clave === clave);
const propuestaDe = (t, id) => proponerUso({ db, tiendaId: t.tiendaId, maquetaId: id });

// ---------- La entrega guarda los textos ----------

test('la entrega guarda los textos de la IA ya limpios; sin ellos (o con basura), la maqueta queda sin textos', async () => {
  const t = await tienda();
  await conKit(t);
  const { id, token } = await (async () => {
    await t.nav.enviar('/admin/marca/maqueta', {}, { desde: '/admin/marca' });
    return recibidos.at(-1).maqueta;
  })();
  const hostil = {
    anuncio: '  Envíos\n a todo   el país  <b>hoy</b>',
    eslogan: 123,
    bajada: 'x'.repeat(500),
    boton: ['a'],
    sobreTitulo: null,
    sobreTexto: 'Un texto',
    valores: [{ titulo: 'Uno', texto: 'y'.repeat(300) }, 'suelto', null, { titulo: 'Cuarto' }],
    cierre: '',
    otro: 'esto no vale',
  };
  assert.equal((await entregar(id, { token, estado: 'lista', html: HTML_OK, textos: hostil })).status, 200);
  const datos = await datosParaUsar(db, t.tiendaId, id);
  assert.deepEqual(datos.textos, {
    anuncio: 'Envíos a todo el país <b>hoy</b>',
    bajada: 'x'.repeat(140),
    sobreTexto: 'Un texto',
    valores: [{ titulo: 'Uno', texto: 'y'.repeat(90) }, { titulo: '', texto: '' }, { titulo: '', texto: '' }],
  });
  assert.ok(datos.kit && /^#[0-9a-f]{6}$/.test(datos.kit.colorPrincipal), 'y el kit de ese momento');

  // Otra tienda no ve esos datos, y una maqueta que no está lista tampoco los da.
  const otra = await tienda();
  assert.equal(await datosParaUsar(db, otra.tiendaId, id), null);
  const pendiente = await pedirMaqueta(db, otra.tiendaId);
  assert.equal(await datosParaUsar(db, otra.tiendaId, pendiente.id), null);

  // Sin textos, o con algo que no sirve: queda sin textos.
  for (const textos of [undefined, null, 'texto', [], { eslogan: 123 }, { valores: 'no' }]) {
    const nueva = await pedirMaqueta(db, (await tienda()).tiendaId);
    const fila = await db.prepare('SELECT tienda_id AS "tiendaId" FROM maquetas WHERE id = ?').get(nueva.id);
    assert.equal((await entregar(nueva.id, { token: nueva.token, estado: 'lista', html: HTML_OK, ...(textos === undefined ? {} : { textos }) })).status, 200);
    assert.equal((await datosParaUsar(db, fila.tiendaId, nueva.id)).textos, null, JSON.stringify(textos));
    assert.equal((await db.prepare('SELECT textos FROM maquetas WHERE id = ?').get(nueva.id)).textos, '');
  }
});

// ---------- Qué se propone ----------

test('la propuesta: cada cambio con lo que hay ahora y lo que quedaría, y por qué no se puede el que no se puede', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', logo: true, fotos: 2 });
  const id = await maquetaLista(t);
  const propuesta = await propuestaDe(t, id);
  assert.deepEqual(propuesta.items.map((i) => i.clave), TODOS, 'en el orden de siempre');
  assert.ok(propuesta.hayAplicables && propuesta.items.every((i) => i.aplicable && i.motivo === null));

  const color = itemDe(propuesta, 'colorPrincipal');
  assert.deepEqual([color.tipo, color.ahora, color.nuevo], ['color', '#1a1a1a', '#aa3300']);
  const logo = itemDe(propuesta, 'logo');
  const [archivoLogo] = (await listarArchivos(db, t.tiendaId)).filter((a) => a.tipo === 'logo');
  assert.deepEqual([logo.ahora, logo.nuevo, logo.archivo], [null, `/subidas/${t.tiendaId}/${archivoLogo.archivo.replace('.webp', '-m.webp')}`, archivoLogo.archivo]);
  assert.deepEqual([itemDe(propuesta, 'franjaTexto').ahora, itemDe(propuesta, 'franjaTexto').nuevo], [null, TEXTOS.anuncio]);
  assert.deepEqual([itemDe(propuesta, 'descripcion').ahora, itemDe(propuesta, 'descripcion').nuevo], [null, TEXTOS.sobreTexto]);
  const banner = itemDe(propuesta, 'banner');
  const [primeraFoto] = (await listarArchivos(db, t.tiendaId)).filter((a) => a.tipo === 'foto');
  assert.equal(banner.archivo, primeraFoto.archivo, 'la primera foto del kit, la que se ve en la maqueta');
  assert.deepEqual(banner.ahora, { cantidad: 0, maximo: 6 });
  assert.equal(propuesta.eslogan, TEXTOS.eslogan);

  // Una maqueta que no se puede pedir de ninguna tienda o que no es de esta: no hay propuesta.
  assert.equal(await proponerUso({ db, tiendaId: t.tiendaId, maquetaId: 99999 }), null);
  assert.equal(await proponerUso({ db, tiendaId: (await tienda()).tiendaId, maquetaId: id }), null);
});

test('la propuesta explica lo que no se puede: sin textos, sin logo, sin fotos, mismo color, sin lugar para otro banner', async () => {
  // Sin textos (maqueta de antes, o con textos de ejemplo).
  const a = await tienda();
  await conKit(a);
  const sinTextos = await propuestaDe(a, await maquetaLista(a, null));
  for (const clave of ['franjaTexto', 'descripcion']) {
    assert.equal(itemDe(sinTextos, clave).aplicable, false);
    assert.match(itemDe(sinTextos, clave).motivo, /no guardó sus textos/);
  }
  assert.ok(itemDe(sinTextos, 'logo').aplicable && itemDe(sinTextos, 'colorPrincipal').aplicable && itemDe(sinTextos, 'banner').aplicable, 'lo del kit sí');

  // Solo una foto: sin logo. Solo un logo: sin fotos.
  const b = await tienda();
  await conKit(b, { logo: false, fotos: 1 });
  assert.match(itemDe(await propuestaDe(b, await maquetaLista(b)), 'logo').motivo, /no tiene un logo/);
  const c = await tienda();
  await conKit(c, { logo: true, fotos: 0 });
  assert.match(itemDe(await propuestaDe(c, await maquetaLista(c)), 'banner').motivo, /no tiene fotos/);

  // El mismo color que ya tiene la tienda, y los mismos textos.
  const d = await tienda();
  await conKit(d, { color: '#1a1a1a' });
  await actualizarAjustes(db, d.tiendaId, { franjaTexto: TEXTOS.anuncio });
  const iguales = await propuestaDe(d, await maquetaLista(d));
  assert.match(itemDe(iguales, 'colorPrincipal').motivo, /ya tiene este color/);
  assert.match(itemDe(iguales, 'franjaTexto').motivo, /ya lo tiene así/);
  assert.ok(itemDe(iguales, 'descripcion').aplicable);

  // El plan tiene tope de banners y ya está lleno.
  const e = await tienda({ maxBanners: 1 });
  await conKit(e);
  await agregarBanner(db, e.tiendaId, { imagen: 'viejo.webp', imagenMovil: null, enlace: '', textoAlternativo: '' });
  const lleno = itemDe(await propuestaDe(e, await maquetaLista(e)), 'banner');
  assert.equal(lleno.aplicable, false);
  assert.match(lleno.motivo, /Tu plan permite 1 banner y ya tenés 1\. Borrá uno en Diseño/);
});

test('se propone lo que se veía en la maqueta aunque el kit haya cambiado después; y si ese archivo ya no está, se avisa', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300' });
  const id = await maquetaLista(t);
  const [logoViejo] = (await listarArchivos(db, t.tiendaId)).filter((a) => a.tipo === 'logo');
  // Después de pedirla, el cliente cambia el color y suma otro logo.
  await guardarKit(t, '#0033aa');
  await subir(t, [imagen(11, 'logo-nuevo.png')], 'logo');
  const propuesta = await propuestaDe(t, id);
  assert.equal(itemDe(propuesta, 'colorPrincipal').nuevo, '#aa3300', 'el color de esa maqueta, no el de hoy');
  assert.equal(itemDe(propuesta, 'logo').archivo, logoViejo.archivo, 'el logo de esa maqueta, no el nuevo');
  // Si borra el logo y la foto de esa maqueta del kit, ya no se pueden llevar.
  await borrarArchivo(db, dirSubidas, t.tiendaId, logoViejo.id);
  const [foto] = (await listarArchivos(db, t.tiendaId)).filter((a) => a.tipo === 'foto');
  await borrarArchivo(db, dirSubidas, t.tiendaId, foto.id);
  const sinArchivos = await propuestaDe(t, id);
  assert.match(itemDe(sinArchivos, 'logo').motivo, /Ese logo ya no está en tu kit/);
  assert.match(itemDe(sinArchivos, 'banner').motivo, /Esa foto ya no está en tu kit/);
  assert.ok(itemDe(sinArchivos, 'colorPrincipal').aplicable);
});

test('una maqueta pedida antes de que se guardara el kit (sin kit) usa el kit de hoy', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300' });
  const pedido = await pedirMaqueta(db, t.tiendaId); // sin kit: como las de antes
  await entregarMaqueta(db, pedido.id, { token: pedido.token, estado: 'lista', html: HTML_OK, textos: TEXTOS });
  assert.equal((await datosParaUsar(db, t.tiendaId, pedido.id)).kit, null);
  const propuesta = await propuestaDe(t, pedido.id);
  assert.equal(itemDe(propuesta, 'colorPrincipal').nuevo, '#aa3300');
  assert.ok(itemDe(propuesta, 'logo').aplicable && itemDe(propuesta, 'banner').aplicable);
});

// ---------- La pantalla ----------

test('la pantalla de confirmación muestra cada cambio con su casilla y no cambia nada', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  await actualizarAjustes(db, t.tiendaId, { franjaTexto: 'Un anuncio <de> hoy' });
  const id = await maquetaLista(t);
  const antes = await leerAjustes(db, t.tiendaId);
  const html = await pagina(t, `/admin/marca/maqueta/${id}/usar`);
  assert.ok(html.includes('Usar esta maqueta en tu tienda') && html.includes('Todavía no se cambió nada'));
  for (const clave of TODOS) assert.match(html, new RegExp(`<input type="checkbox" name="items" value="${clave}" checked>`), clave);
  assert.ok(html.includes('#aa3300') && html.includes('#1a1a1a'), 'el color de ahora y el nuevo');
  assert.ok(html.includes(TEXTOS.anuncio) && html.includes(TEXTOS.sobreTexto), 'los textos nuevos');
  assert.ok(html.includes('Un anuncio &lt;de&gt; hoy'), 'lo de ahora, escapado');
  assert.ok(html.includes('class="usar-imagen"') && html.includes(`/subidas/${t.tiendaId}/`), 'las imágenes');
  assert.ok(html.includes(`action="/admin/marca/maqueta/${id}/usar"`) && html.includes('Usar en mi tienda'));
  assert.deepEqual(await leerAjustes(db, t.tiendaId), antes, 'mirar no cambia nada');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maqueta_usada WHERE tienda_id = ?').get(t.tiendaId)).n, 0);

  // Lo que no se puede sale sin casilla activa y con su motivo.
  const sinTextos = await pagina(t, `/admin/marca/maqueta/${await maquetaLista(t, null)}/usar`);
  assert.match(sinTextos, /<input type="checkbox" name="items" value="franjaTexto" disabled>/);
  assert.ok(sinTextos.includes('no guardó sus textos') && sinTextos.includes('usar-item-no'));
});

test('la pantalla: una maqueta que no existe, que no es tuya o que no está lista vuelve a la maqueta con un aviso; y sin el plan, al aviso del plan', async () => {
  const t = await tienda();
  await conKit(t);
  const otra = await tienda();
  await conKit(otra);
  const ajena = await maquetaLista(otra);
  for (const ruta of ['/admin/marca/maqueta/99999/usar', `/admin/marca/maqueta/${ajena}/usar`, '/admin/marca/maqueta/abc/usar']) {
    const respuesta = await t.nav.pedir(ruta);
    assert.equal(respuesta.status, 302, ruta);
    assert.equal(respuesta.headers.get('location'), '/admin/marca/maqueta');
  }
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Esa maqueta no existe o todavía no está lista.'));
  // Una maqueta todavía en camino.
  await t.nav.enviar('/admin/marca/maqueta', {}, { desde: '/admin/marca' });
  const enCamino = recibidos.at(-1).maqueta.id;
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${enCamino}/usar`)).status, 302);
  // Sin la función del kit de marca, la pantalla manda al aviso del plan.
  const sinPlan = await tienda({ nivel: 'esencial' });
  const respuesta = await sinPlan.nav.pedir('/admin/marca/maqueta/1/usar');
  assert.equal(respuesta.status, 302);
  assert.ok((await pagina(sinPlan, '/admin/marca/maqueta')).includes('no incluye <strong>Kit de marca y maqueta web</strong>'));
});

test('la página de la maqueta ofrece "Usar en mi tienda" solo cuando está lista, y la tarjeta de deshacer solo si se usó una', async () => {
  const t = await tienda();
  await conKit(t);
  await t.nav.enviar('/admin/marca/maqueta', {}, { desde: '/admin/marca' });
  let html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(!html.includes('Usar en mi tienda') && !html.includes('Usaste una maqueta en tu tienda'), 'mientras se arma, nada');
  const { id, token } = recibidos.at(-1).maqueta;
  await entregar(id, { token, estado: 'lista', html: HTML_OK, textos: TEXTOS });
  html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes(`href="/admin/marca/maqueta/${id}/usar"`) && html.includes('Usar en mi tienda'));
  assert.ok(!html.includes('Usaste una maqueta en tu tienda') && !html.includes('Deshacer'));
});

// ---------- Usar ----------

test('usar la maqueta lleva a la tienda lo elegido, copia las imágenes y deja todo listo para deshacer', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  const id = await maquetaLista(t);
  const kit = await listarArchivos(db, t.tiendaId);
  const archivosAntes = archivosDe(t);

  const respuesta = await usar(t, id, TODOS);
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/marca/maqueta');
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.deepEqual([ajustes.colorPrincipal, ajustes.franjaTexto, ajustes.descripcion], ['#aa3300', TEXTOS.anuncio, TEXTOS.sobreTexto]);
  // El logo es una copia: un archivo propio de la tienda, distinto del del kit.
  assert.match(ajustes.logo, /^[0-9a-f-]{36}\.webp$/);
  assert.ok(!kit.some((a) => a.archivo === ajustes.logo) && hayArchivo(t, ajustes.logo));
  // Y el banner, con su foto copiada y el título como texto alternativo.
  const banners = await listarBanners(db, t.tiendaId);
  assert.equal(banners.length, 1);
  assert.ok(hayArchivo(t, banners[0].imagen) && !kit.some((a) => a.archivo === banners[0].imagen));
  assert.deepEqual([banners[0].enlace, banners[0].textoAlternativo, banners[0].imagenMovil], ['', TEXTOS.eslogan, null]);
  assert.equal(archivosDe(t).length, archivosAntes.length + 2, 'solo se sumaron las dos copias');

  // Quedó anotado, y la página dice qué se llevó y ofrece deshacerlo.
  const uso = await leerUso(db, t.tiendaId);
  assert.equal(uso.maquetaId, id);
  assert.deepEqual(uso.cambios.map((c) => c.clave), TODOS);
  const html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes('Listo: llevamos a tu tienda color principal, logo, franja de anuncios, sobre la tienda y banner de bienvenida.'));
  assert.ok(html.includes('Usaste una maqueta en tu tienda') && html.includes('action="/admin/marca/maqueta/deshacer"') && html.includes(TEXTOS.anuncio));
  // La tienda lo muestra.
  const tienda_ = await vidriera(t);
  assert.ok(tienda_.includes(TEXTOS.anuncio) && tienda_.includes(`/subidas/${t.tiendaId}/${ajustes.logo}`) && tienda_.includes(`/subidas/${t.tiendaId}/${banners[0].imagen}`));

  // Borrar el logo o la foto del kit no rompe lo que se copió.
  for (const archivo of kit) await borrarArchivo(db, dirSubidas, t.tiendaId, archivo.id);
  assert.ok(hayArchivo(t, ajustes.logo) && hayArchivo(t, banners[0].imagen));
});

test('solo se lleva lo que se tildó; lo que no existe, lo que no se puede y lo armado a mano se ignoran', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300' });
  const id = await maquetaLista(t);
  const antes = await leerAjustes(db, t.tiendaId);
  // Solo el color, junto con basura que no es un cambio.
  assert.equal((await usar(t, id, ['colorPrincipal', 'hackeo', '__proto__', 'constructor', ''])).status, 302);
  const despues = await leerAjustes(db, t.tiendaId);
  assert.deepEqual({ ...despues, colorPrincipal: antes.colorPrincipal }, antes, 'nada más cambió');
  assert.equal(despues.colorPrincipal, '#aa3300');
  assert.deepEqual((await leerUso(db, t.tiendaId)).cambios.map((c) => c.clave), ['colorPrincipal']);
  assert.equal((await listarBanners(db, t.tiendaId)).length, 0);

  // Sin tildar nada, o tildando algo que ya está (el mismo color): aviso y nada cambia.
  for (const items of [[], ['colorPrincipal']]) {
    const respuesta = await usar(t, id, items);
    assert.equal(respuesta.status, 302);
    assert.equal(respuesta.headers.get('location'), `/admin/marca/maqueta/${id}/usar`);
    assert.ok((await pagina(t, `/admin/marca/maqueta/${id}/usar`)).includes('No hay nada para cambiar'));
  }
  assert.equal(archivosDe(t).filter((a) => !a.includes('-')).length, 0);

  // Un solo valor (no una lista) también vale.
  const una = await t.nav.enviar(`/admin/marca/maqueta/${id}/usar`, { items: 'franjaTexto' }, { desde: `/admin/marca/maqueta/${id}/usar` });
  assert.equal(una.status, 302);
  assert.equal((await leerAjustes(db, t.tiendaId)).franjaTexto, TEXTOS.anuncio);
});

test('sin el token de la sesión no se usa nada; sin el plan, tampoco; con la tienda suspendida, tampoco; y las maquetas de otra tienda no', async () => {
  const t = await tienda();
  await conKit(t);
  const id = await maquetaLista(t);
  const sinToken = await t.nav.pedir(`/admin/marca/maqueta/${id}/usar`, { method: 'POST', body: new URLSearchParams({ items: 'colorPrincipal' }) });
  assert.equal(sinToken.status, 403);
  assert.equal((await t.nav.pedir('/admin/marca/maqueta/deshacer', { method: 'POST', body: new URLSearchParams() })).status, 403);
  assert.equal(await leerUso(db, t.tiendaId), null);
  assert.equal((await leerAjustes(db, t.tiendaId)).colorPrincipal, '#1a1a1a');

  // Una maqueta de otra tienda no se puede llevar a esta, aunque se arme el pedido a mano.
  const otra = await tienda();
  await conKit(otra);
  const ajena = await maquetaLista(otra);
  assert.equal((await usar(t, ajena, TODOS, '/admin/diseno')).status, 302);
  assert.equal(await leerUso(db, t.tiendaId), null);
  assert.equal((await leerAjustes(db, t.tiendaId)).colorPrincipal, '#1a1a1a');
  assert.equal((await leerAjustes(db, otra.tiendaId)).colorPrincipal, '#1a1a1a', 'y la otra tienda tampoco cambió');

  // Con el plan en Esencial (sin la función), el panel no deja usar una maqueta que ya existía.
  const planEsencial = await crearPlan(db, { nombre: `Baja ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones: [] });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planEsencial, t.tiendaId);
  assert.equal((await usar(t, id, TODOS, '/admin/diseno')).status, 302);
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('no incluye <strong>Kit de marca y maqueta web</strong>'));
  assert.equal(await leerUso(db, t.tiendaId), null);
  assert.equal((await deshacer(t, '/admin/diseno')).status, 302);

  // Tienda suspendida: puede mirar pero no cambiar.
  await db.prepare("UPDATE tiendas SET estado = 'suspendida' WHERE id = ?").run(otra.tiendaId);
  assert.equal((await usar(otra, ajena, TODOS, '/admin/diseno')).status, 302);
  assert.equal(await leerUso(db, otra.tiendaId), null);
  assert.equal((await leerAjustes(db, otra.tiendaId)).colorPrincipal, '#1a1a1a');
});

test('si una imagen del kit no se puede leer, no se cambia nada y no quedan archivos sueltos', async () => {
  const t = await tienda();
  await conKit(t);
  const id = await maquetaLista(t);
  const [logo] = (await listarArchivos(db, t.tiendaId)).filter((a) => a.tipo === 'logo');
  rmSync(path.join(dirSubidas, String(t.tiendaId), logo.archivo)); // la fila sigue, el archivo no
  const antes = archivosDe(t);
  const respuesta = await usar(t, id, TODOS);
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), `/admin/marca/maqueta/${id}/usar`);
  assert.ok((await pagina(t, `/admin/marca/maqueta/${id}/usar`)).includes('No pudimos leer una de las imágenes de tu kit de marca'));
  assert.deepEqual(archivosDe(t), antes, 'ninguna copia quedó (ni la del banner, que sí se había leído)');
  assert.equal((await leerAjustes(db, t.tiendaId)).colorPrincipal, '#1a1a1a');
  assert.equal(await leerUso(db, t.tiendaId), null);
  assert.equal((await listarBanners(db, t.tiendaId)).length, 0);
});

test('dos pedidos a la vez no se pisan: si el último lugar para un banner se ocupa, el segundo no lo suma y no deja archivos de más', async () => {
  const t = await tienda({ maxBanners: 1 });
  await conKit(t);
  const id = await maquetaLista(t);
  const antes = archivosDe(t).length;
  const resultados = await Promise.all([1, 2, 3].map(() => usarMaqueta({ db, dirSubidas, tiendaId: t.tiendaId, maquetaId: id, elegidos: ['banner'] })));
  assert.equal(resultados.filter((r) => r.aplicados).length, 1, 'solo uno lo suma');
  assert.equal(resultados.filter((r) => r.error === 'nada').length, 2);
  assert.equal((await listarBanners(db, t.tiendaId)).length, 1);
  assert.equal(archivosDe(t).length, antes + 1, 'una sola copia: las de los que no entraron se borraron');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maqueta_usada WHERE tienda_id = ?').get(t.tiendaId)).n, 1);
});

// ---------- Deshacer ----------

test('deshacer vuelve a lo de antes: ajustes, logo anterior, banner y archivos', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  // La tienda ya tenía un logo, una franja y una descripción propios.
  const logoViejo = await guardarImagen(dirSubidas, t.tiendaId, PNG, { perfil: 'logo' });
  await actualizarAjustes(db, t.tiendaId, { logo: logoViejo, franjaTexto: 'Mi anuncio de siempre', descripcion: 'Mi descripción de siempre' });
  const id = await maquetaLista(t);
  const antes = await leerAjustes(db, t.tiendaId);
  const archivosAntes = archivosDe(t);

  await usar(t, id, TODOS);
  const usado = await leerAjustes(db, t.tiendaId);
  assert.notEqual(usado.logo, logoViejo);
  assert.ok(hayArchivo(t, logoViejo), 'el logo de antes se conserva mientras se pueda deshacer');
  const banner = (await listarBanners(db, t.tiendaId))[0];

  const respuesta = await deshacer(t);
  assert.equal(respuesta.status, 302);
  assert.deepEqual(await leerAjustes(db, t.tiendaId), antes, 'todo como estaba');
  assert.equal((await leerAjustes(db, t.tiendaId)).logo, logoViejo);
  assert.ok(!hayArchivo(t, usado.logo) && !hayArchivo(t, banner.imagen) && hayArchivo(t, logoViejo), 'se borraron las copias y volvió el logo de antes');
  assert.deepEqual(archivosDe(t), archivosAntes, 'ni un archivo de más');
  assert.equal((await listarBanners(db, t.tiendaId)).length, 0);
  assert.equal(await leerUso(db, t.tiendaId), null);
  const html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes('Listo, volvimos a lo que tenías: color principal, logo, franja de anuncios, sobre la tienda y banner de bienvenida.'));
  assert.ok(!html.includes('Usaste una maqueta en tu tienda'));

  // Ya no hay nada para deshacer.
  assert.equal((await deshacer(t)).status, 302);
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('No hay nada para deshacer.'));
});

test('deshacer no pisa lo que el cliente cambió después de usar la maqueta', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  const id = await maquetaLista(t);
  const logoViejo = await guardarImagen(dirSubidas, t.tiendaId, PNG, { perfil: 'logo' });
  await actualizarAjustes(db, t.tiendaId, { logo: logoViejo });
  await usar(t, id, TODOS);
  const usado = await leerAjustes(db, t.tiendaId);

  // Después cambia la franja, el color y el logo (como lo haría desde Diseño: el logo que había se borra), y saca el banner.
  const logoPropio = await guardarImagen(dirSubidas, t.tiendaId, otraFoto(99), { perfil: 'logo' });
  await actualizarAjustes(db, t.tiendaId, { franjaTexto: 'Mi anuncio nuevo', colorPrincipal: '#00aa33', logo: logoPropio });
  await borrarImagen(dirSubidas, t.tiendaId, usado.logo);
  const banner = (await listarBanners(db, t.tiendaId))[0];
  await borrarBanner(db, t.tiendaId, banner.id);
  await borrarImagen(dirSubidas, t.tiendaId, banner.imagen);

  await deshacer(t);
  const despues = await leerAjustes(db, t.tiendaId);
  assert.deepEqual([despues.franjaTexto, despues.colorPrincipal, despues.logo], ['Mi anuncio nuevo', '#00aa33', logoPropio], 'lo que cambió después se queda');
  assert.equal(despues.descripcion, '', 'lo que no tocó, vuelve a lo de antes');
  assert.ok(hayArchivo(t, logoPropio), 'su logo nuevo sigue');
  assert.ok(!hayArchivo(t, logoViejo), 'el logo de antes ya no iba a volver: se borró');
  const html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes('Listo, volvimos a lo que tenías: sobre la tienda.'));
  assert.ok(html.includes('No tocamos color principal, logo y franja de anuncios porque lo cambiaste después.'));
  assert.equal(await leerUso(db, t.tiendaId), null, 'y el deshacer se consumió');
});

test('si no queda nada de lo que se llevó (todo cambiado después), el deshacer lo dice y no cambia nada', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300' });
  const id = await maquetaLista(t);
  await usar(t, id, ['colorPrincipal', 'franjaTexto']);
  await actualizarAjustes(db, t.tiendaId, { colorPrincipal: '#111111', franjaTexto: 'Otro' });
  await deshacer(t);
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('No cambiamos nada. No tocamos color principal y franja de anuncios porque lo cambiaste después.'));
  assert.deepEqual([(await leerAjustes(db, t.tiendaId)).colorPrincipal, (await leerAjustes(db, t.tiendaId)).franjaTexto], ['#111111', 'Otro']);
});

test('deshacer sirve aunque la maqueta ya se haya borrado, y aunque el banner ya no esté', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  const id = await maquetaLista(t);
  await usar(t, id, ['colorPrincipal', 'banner']);
  assert.ok(await borrarMaqueta(db, t.tiendaId, id));
  const banner = (await listarBanners(db, t.tiendaId))[0];
  await borrarBanner(db, t.tiendaId, banner.id);
  await borrarImagen(dirSubidas, t.tiendaId, banner.imagen);
  const resultado = await deshacerUso({ db, dirSubidas, tiendaId: t.tiendaId });
  assert.deepEqual(resultado.deshechos, ['colorPrincipal']);
  assert.deepEqual(resultado.omitidos, [{ clave: 'banner', motivo: 'ya no estaba' }]);
  assert.equal((await leerAjustes(db, t.tiendaId)).colorPrincipal, '#1a1a1a');
  assert.deepEqual(await deshacerUso({ db, dirSubidas, tiendaId: t.tiendaId }), { error: 'nada' });
});

test('usar otra maqueta reemplaza a la anterior: solo se deshace lo último, y el logo viejo que ya no vuelve se borra', async () => {
  const t = await tienda();
  await conKit(t, { color: '#aa3300', fotos: 1 });
  const logoViejo = await guardarImagen(dirSubidas, t.tiendaId, PNG, { perfil: 'logo' });
  await actualizarAjustes(db, t.tiendaId, { logo: logoViejo });
  const a = await maquetaLista(t);
  await usar(t, a, ['colorPrincipal', 'logo']);
  const logoA = (await leerAjustes(db, t.tiendaId)).logo;
  assert.ok(hayArchivo(t, logoViejo));

  // Otra maqueta, con otro color.
  await guardarKit(t, '#0033aa');
  const b = await maquetaLista(t);
  await usar(t, b, ['colorPrincipal', 'logo']);
  const logoB = (await leerAjustes(db, t.tiendaId)).logo;
  assert.deepEqual([logoA === logoB, (await leerAjustes(db, t.tiendaId)).colorPrincipal], [false, '#0033aa']);
  assert.ok(!hayArchivo(t, logoViejo), 'el logo original ya no se puede recuperar con el deshacer: se borró');
  assert.ok(hayArchivo(t, logoA) && hayArchivo(t, logoB), 'el de la primera maqueta sí, porque a eso vuelve el deshacer');
  assert.equal((await leerUso(db, t.tiendaId)).maquetaId, b);

  await deshacer(t);
  const despues = await leerAjustes(db, t.tiendaId);
  assert.deepEqual([despues.colorPrincipal, despues.logo], ['#aa3300', logoA], 'vuelve a como lo dejó la primera maqueta');
  assert.ok(!hayArchivo(t, logoB) && hayArchivo(t, logoA));
  assert.deepEqual(await deshacerUso({ db, dirSubidas, tiendaId: t.tiendaId }), { error: 'nada' }, 'lo de la primera ya no se deshace');
});

test('"usar" y "deshacer" son cosa de cada tienda: lo que una hace no toca a la otra', async () => {
  const [a, b] = [await tienda(), await tienda()];
  for (const t of [a, b]) await conKit(t, { color: '#aa3300' });
  const idA = await maquetaLista(a);
  const idB = await maquetaLista(b);
  await usar(a, idA, ['colorPrincipal']);
  await usar(b, idB, ['colorPrincipal']);
  await deshacer(a);
  assert.equal((await leerAjustes(db, a.tiendaId)).colorPrincipal, '#1a1a1a');
  assert.equal((await leerAjustes(db, b.tiendaId)).colorPrincipal, '#aa3300', 'la otra tienda sigue como la dejó');
  assert.ok(await leerUso(db, b.tiendaId));
});

test('las claves de lo que se puede llevar son las cinco de siempre', () => {
  assert.deepEqual(CLAVES_DE_ITEMS, TODOS);
});
