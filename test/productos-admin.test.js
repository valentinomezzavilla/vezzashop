// Productos en el panel: orden, filtros nuevos, categoría, acciones sobre varios y "ocultar los que no tienen stock".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { listarProductosAdmin, ORDENES_ADMIN, categoriaDeFiltro } from '../src/productos.js';
import { volverSeguro } from '../src/util/volver.js';
import { crearNavegador } from './ayudantes.js';

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

// Cuatro productos: Alfa (stock 5, en Ropa), Beta (sin stock, en oferta, en Ropa > Remeras), Gamma (stock 2, en Hogar), Delta (sin stock, sin categoría).
async function tiendaConProductos(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Categorías', 'Precio', 'Precio promocional', 'Stock'],
    ['A-1', 'Alfa', 'Ropa', 1000, null, 5],
    ['B-1', 'Beta', 'Ropa > Remeras', 3000, 2500, 0],
    ['C-1', 'Gamma', 'Hogar', 2000, null, 2],
    ['D-1', 'Delta', null, 500, null, 0],
  ]);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tienda.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: tienda.id };
}

const nombresEn = (html) => [...html.matchAll(/class="celda-producto-nombre">([^<]+)</g)].map((m) => m[1].trim());
const idDeProducto = async (tiendaId, nombre) => (await db.prepare('SELECT id FROM productos WHERE tienda_id = ? AND nombre = ?').get(tiendaId, nombre)).id;
const visibleDe = async (tiendaId, nombre) => (await db.prepare('SELECT visible FROM productos WHERE tienda_id = ? AND nombre = ?').get(tiendaId, nombre)).visible;
const lista = async (nav, consulta = '') => nombresEn(await (await nav.pedir(`/admin/productos${consulta}`)).text());

test('el listado se puede ordenar por nombre, precio, stock y antigüedad', async () => {
  const { nav } = await tiendaConProductos('orden-productos');
  assert.deepEqual(await lista(nav), ['Alfa', 'Beta', 'Delta', 'Gamma'], 'por defecto, por nombre');
  assert.deepEqual(await lista(nav, '?orden=nombre-desc'), ['Gamma', 'Delta', 'Beta', 'Alfa']);
  assert.deepEqual(await lista(nav, '?orden=precio-menor'), ['Delta', 'Alfa', 'Gamma', 'Beta']);
  assert.deepEqual(await lista(nav, '?orden=precio-mayor'), ['Beta', 'Gamma', 'Alfa', 'Delta']);
  assert.deepEqual(await lista(nav, '?orden=stock-menor'), ['Beta', 'Delta', 'Gamma', 'Alfa']);
  assert.deepEqual(await lista(nav, '?orden=stock-mayor'), ['Alfa', 'Gamma', 'Beta', 'Delta']);
  assert.deepEqual(await lista(nav, '?orden=nuevos').then((n) => n.length), 4);
  assert.deepEqual(await lista(nav, '?orden=viejos').then((n) => n.length), 4);
  assert.deepEqual(await lista(nav, '?orden=inventado; DROP TABLE productos'), ['Alfa', 'Beta', 'Delta', 'Gamma'], 'un orden desconocido vuelve al de siempre');
  // El menú ofrece todos los órdenes y marca el elegido.
  const html = await (await nav.pedir('/admin/productos?orden=precio-menor')).text();
  for (const clave of Object.keys(ORDENES_ADMIN)) assert.match(html, new RegExp(`<option value="${clave}"`));
  assert.match(html, /<option value="precio-menor" selected>/);
});

test('filtros nuevos: con stock, pocas unidades, en oferta y sin stock, con su cuenta en cada pestaña', async () => {
  const { nav } = await tiendaConProductos('filtros-productos');
  assert.deepEqual(await lista(nav, '?filtro=con-stock'), ['Alfa', 'Gamma']);
  assert.deepEqual(await lista(nav, '?filtro=sin-stock'), ['Beta', 'Delta']);
  assert.deepEqual(await lista(nav, '?filtro=pocas-unidades'), ['Gamma'], 'Gamma tiene 2; Alfa tiene 5');
  assert.deepEqual(await lista(nav, '?filtro=en-oferta'), ['Beta']);
  const html = await (await nav.pedir('/admin/productos')).text();
  assert.match(html, /Con stock <span class="pestania-cuenta">2<\/span>/);
  assert.match(html, /Pocas unidades <span class="pestania-cuenta">1<\/span>/);
  assert.match(html, /En oferta <span class="pestania-cuenta">1<\/span>/);
  // Combina con la búsqueda y con el orden.
  assert.deepEqual(await lista(nav, '?filtro=con-stock&q=a&orden=precio-mayor'), ['Gamma', 'Alfa']);
  // Las pestañas conservan el orden y la categoría elegidos.
  const conOrden = await (await nav.pedir('/admin/productos?orden=stock-mayor&q=a')).text();
  assert.match(conOrden, /href="\/admin\/productos\?filtro=sin-stock&amp;q=a&amp;orden=stock-mayor"/);
});

test('filtro por categoría: incluye las subcategorías, y "sin categoría" encuentra a los huérfanos', async () => {
  const { nav, tiendaId } = await tiendaConProductos('categoria-productos');
  const ropa = (await db.prepare("SELECT id FROM categorias WHERE tienda_id = ? AND slug = 'ropa'").get(tiendaId)).id;
  const remeras = (await db.prepare("SELECT id FROM categorias WHERE tienda_id = ? AND slug = 'remeras'").get(tiendaId)).id;
  assert.deepEqual(await lista(nav, `?categoria=${ropa}`), ['Alfa', 'Beta'], 'Ropa incluye lo que está en Remeras');
  assert.deepEqual(await lista(nav, `?categoria=${remeras}`), ['Beta']);
  assert.deepEqual(await lista(nav, '?categoria=sin'), ['Delta']);
  assert.deepEqual(await lista(nav, `?categoria=${ropa}&filtro=sin-stock`), ['Beta']);
  assert.deepEqual(await lista(nav, '?categoria=abc'), ['Alfa', 'Beta', 'Delta', 'Gamma'], 'una categoría inválida se ignora');
  // Una categoría de otra tienda no muestra nada de esta.
  const ajena = await tiendaConProductos('categoria-ajena');
  const ropaAjena = (await db.prepare("SELECT id FROM categorias WHERE tienda_id = ? AND slug = 'ropa'").get(ajena.tiendaId)).id;
  assert.deepEqual(await lista(nav, `?categoria=${ropaAjena}`), []);
  assert.equal(categoriaDeFiltro('12'), 12);
  assert.equal(categoriaDeFiltro('sin'), 'sin');
  assert.equal(categoriaDeFiltro('1; DROP'), null);
  // La consulta usa los mismos parámetros que la pantalla.
  assert.deepEqual((await listarProductosAdmin(db, tiendaId, { categoria: ropa, orden: 'precio-mayor' })).map((p) => p.nombre), ['Beta', 'Alfa']);
});

test('acciones sobre varios productos: mostrar, ocultar, destacar y quitar de destacados, solo de esta tienda', async () => {
  const { nav, tiendaId } = await tiendaConProductos('varios-productos');
  const ajena = await tiendaConProductos('varios-ajena');
  const alfa = await idDeProducto(tiendaId, 'Alfa');
  const gamma = await idDeProducto(tiendaId, 'Gamma');
  const deOtra = await idDeProducto(ajena.tiendaId, 'Alfa');
  const volver = '/admin/productos?filtro=todos&orden=precio-mayor';
  const pares = (accion, ...ids) => [['accion', accion], ['volver', volver], ...ids.map((id) => ['ids', String(id)])];

  const oculta = await nav.enviar('/admin/productos/acciones-varias', pares('ocultar', alfa, gamma, deOtra), { desde: '/admin/productos' });
  assert.equal(oculta.headers.get('location'), volver);
  assert.equal(await visibleDe(tiendaId, 'Alfa'), 0);
  assert.equal(await visibleDe(tiendaId, 'Gamma'), 0);
  assert.equal(await visibleDe(ajena.tiendaId, 'Alfa'), 1, 'un id de otra tienda no se toca');
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Ocultamos 2 productos de la tienda/);

  await nav.enviar('/admin/productos/acciones-varias', pares('mostrar', alfa), { desde: '/admin/productos' });
  assert.equal(await visibleDe(tiendaId, 'Alfa'), 1);
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Mostramos 1 producto en la tienda/);

  await nav.enviar('/admin/productos/acciones-varias', pares('destacar', alfa, gamma), { desde: '/admin/productos' });
  assert.deepEqual(await lista(nav, '?filtro=destacados'), ['Alfa', 'Gamma']);
  await nav.enviar('/admin/productos/acciones-varias', pares('quitar-destacado', gamma), { desde: '/admin/productos' });
  assert.deepEqual(await lista(nav, '?filtro=destacados'), ['Alfa']);

  // Lo que ya estaba así no cuenta como cambio.
  await nav.enviar('/admin/productos/acciones-varias', pares('destacar', alfa), { desde: '/admin/productos' });
  assert.match(await (await nav.pedir('/admin/productos')).text(), /ya estaban así/);
  // Sin acción o sin productos, un aviso y nada cambia.
  await nav.enviar('/admin/productos/acciones-varias', pares('', alfa), { desde: '/admin/productos' });
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Elegí qué querés hacer/);
  await nav.enviar('/admin/productos/acciones-varias', pares('ocultar'), { desde: '/admin/productos' });
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Elegí al menos un producto/);
  // Una acción inventada no hace nada.
  await nav.enviar('/admin/productos/acciones-varias', pares('vaciar-todo', alfa), { desde: '/admin/productos' });
  assert.equal(await visibleDe(tiendaId, 'Alfa'), 1);
});

test('"Borrar…" de las acciones sobre varios muestra la confirmación y no borra nada todavía', async () => {
  const { nav, tiendaId } = await tiendaConProductos('borrar-acciones');
  const delta = await idDeProducto(tiendaId, 'Delta');
  const respuesta = await nav.enviar('/admin/productos/acciones-varias', [['accion', 'borrar'], ['ids', String(delta)], ['volver', '/admin/productos']], { desde: '/admin/productos' });
  assert.equal(respuesta.status, 200);
  const html = await respuesta.text();
  assert.match(html, /Delta/);
  assert.match(html, /Sí, borrar 1 producto/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(tiendaId)).n, 4);
});

test('"Ocultar los que no tienen stock" saca de la tienda solo lo visible sin stock, y pide confirmación', async () => {
  const { nav, tiendaId } = await tiendaConProductos('sin-stock-productos');
  const antes = await (await nav.pedir('/admin/productos')).text();
  assert.match(antes, /Ocultar los 2 sin stock/);
  assert.match(antes, /Se ocultan de la tienda los 2 productos visibles que no tienen stock/);

  const respuesta = await nav.enviar('/admin/productos/ocultar-sin-stock', { volver: '/admin/productos?filtro=sin-stock' }, { desde: '/admin/productos' });
  assert.equal(respuesta.headers.get('location'), '/admin/productos?filtro=sin-stock');
  assert.equal(await visibleDe(tiendaId, 'Beta'), 0);
  assert.equal(await visibleDe(tiendaId, 'Delta'), 0);
  assert.equal(await visibleDe(tiendaId, 'Alfa'), 1, 'lo que tiene stock queda como estaba');
  assert.equal(await visibleDe(tiendaId, 'Gamma'), 1);
  const despues = await (await nav.pedir('/admin/productos')).text();
  assert.match(despues, /Ocultamos 2 productos sin stock de la tienda/);
  assert.doesNotMatch(despues, /Ocultar los \d+ sin stock/, 'ya no queda nada para ocultar');

  await nav.enviar('/admin/productos/ocultar-sin-stock', {}, { desde: '/admin/productos' });
  assert.match(await (await nav.pedir('/admin/productos')).text(), /No hay productos visibles sin stock/);
});

test('el panel pide los formularios con CSRF: sin token no se cambia nada', async () => {
  const { nav, tiendaId } = await tiendaConProductos('csrf-productos');
  const alfa = await idDeProducto(tiendaId, 'Alfa');
  const sinToken = await nav.pedir('/admin/productos/acciones-varias', {
    method: 'POST',
    body: new URLSearchParams([['accion', 'ocultar'], ['ids', String(alfa)]]),
  });
  assert.equal(sinToken.status, 403);
  assert.equal(await visibleDe(tiendaId, 'Alfa'), 1);
});

test('volverSeguro solo deja volver a páginas del panel', () => {
  assert.equal(volverSeguro('/admin/productos?filtro=ocultos'), '/admin/productos?filtro=ocultos');
  assert.equal(volverSeguro('/admin/pedidos?filtro=nuevo&q=ana', '/admin/inicio'), '/admin/pedidos?filtro=nuevo&q=ana');
  assert.equal(volverSeguro('https://otro-sitio.com'), '/admin/productos');
  assert.equal(volverSeguro('//otro-sitio.com/admin/'), '/admin/productos');
  assert.equal(volverSeguro('/admin/\\otro', '/admin/inicio'), '/admin/inicio');
  assert.equal(volverSeguro('/admin/x\r\nSet-Cookie: a=b', '/admin/inicio'), '/admin/inicio');
  assert.equal(volverSeguro(undefined, '/admin/pedidos'), '/admin/pedidos');
});
