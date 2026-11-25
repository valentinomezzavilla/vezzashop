// Inicio (la lista de pasos deja su lugar a los pedidos cuando está completa) y lista de pedidos con acciones por fila.
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
import { actualizarAjustes, agregarBanner } from '../src/diseno.js';
import { crearMetodoEntrega } from '../src/pagos.js';
import { crearCategoria } from '../src/categorias.js';
import { agregarFoto } from '../src/productos.js';
import { crearPedido, siguientePaso, sePuedeCancelar, listarPedidos } from '../src/pedidos.js';
import { resumenTienda } from '../src/inicio.js';
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

async function tienda(slug) {
  const { tienda: creada, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock'],
    ['TAZA', 'Taza', 1500, 50],
    ['PLATO', 'Plato', 2500, 50],
  ]);
  await aplicarImportacion(db, creada.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id };
}

// Hace los 8 pasos de "Completá tu tienda": productos con foto, categoría, logo, color, banner, WhatsApp y compra online.
async function completar(tiendaId) {
  for (const { id } of await db.prepare('SELECT id FROM productos WHERE tienda_id = ?').all(tiendaId)) await agregarFoto(db, tiendaId, id, `foto-${id}.webp`, `huella-${id}`);
  await crearCategoria(db, tiendaId, { nombre: 'Cocina', slug: 'cocina', padreId: null });
  await actualizarAjustes(db, tiendaId, { logo: 'logo.webp', colorPrincipal: '#336699', whatsapp: '5493511234567', pagoTransferencia: true, transferenciaAlias: 'mi.tienda.mp' });
  await agregarBanner(db, tiendaId, { imagen: 'banner.webp', imagenMovil: null, enlace: '', textoAlternativo: '' });
  await crearMetodoEntrega(db, tiendaId, { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null, aceptaEfectivo: false, activo: true });
}

const DATOS = (extra = {}) => ({
  cliente: { nombre: 'Ana Pérez', telefono: '351 123 4567', email: '' },
  entrega: { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null },
  direccion: { calle: '', piso: '', ciudad: '', provincia: '', cp: '', referencias: '' },
  pago: { clave: 'transferencia', descuento: 0 },
  notas: '',
  ...extra,
});

// ---------- Inicio ----------

test('inicio: con pasos pendientes se ve la lista para completar la tienda y no los pedidos', async () => {
  const { nav, tiendaId } = await tienda('inicio-pendiente');
  await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS());
  const html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /Completá tu tienda/);
  assert.match(html, /de 8 pasos listos/);
  assert.doesNotMatch(html, /Tus pedidos/);
  const resumen = await resumenTienda(db, tiendaId);
  assert.equal(resumen.completa, false);
  assert.deepEqual(resumen.pedidosRecientes, []);
});

test('inicio: al completar todos los pasos, la lista desaparece y se ven los últimos pedidos', async () => {
  const { nav, tiendaId } = await tienda('inicio-completo');
  await completar(tiendaId);
  let html = await (await nav.pedir('/admin/inicio')).text();
  assert.doesNotMatch(html, /Completá tu tienda/, 'ya no hay pasos para completar');
  assert.doesNotMatch(html, /pasos listos/);
  assert.match(html, /Tus pedidos/);
  assert.match(html, /Todavía no te llegó ningún pedido/, 'sin pedidos: un estado vacío');
  assert.match(html, /data-copiar="http/, 'con el link de la tienda para compartir');

  for (let n = 1; n <= 8; n++) await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS({ cliente: { nombre: `Cliente ${n}`, telefono: '351 123 4567', email: '' } }));
  html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /8 por atender · 8 en total/);
  const filas = [...html.matchAll(/class="lista-pedidos-numero">#(\d+)</g)].map((m) => Number(m[1]));
  assert.deepEqual(filas, [8, 7, 6, 5, 4, 3], 'los 6 últimos, el más nuevo primero');
  assert.match(html, /<a class="boton boton-secundario boton-chico" href="\/admin\/pedidos">Ver todos<\/a>/);
  assert.match(html, /href="\/admin\/pedidos\/\d+"/);
  assert.match(html, /Cliente 8/);
  assert.doesNotMatch(html, /Cliente 1</, 'el primero ya no entra en los últimos 6');
  assert.match(html, /pastilla pastilla-nuevo/);
});

test('inicio: si se deshace un paso, vuelve la lista', async () => {
  const { nav, tiendaId } = await tienda('inicio-vuelve');
  await completar(tiendaId);
  assert.match(await (await nav.pedir('/admin/inicio')).text(), /Tus pedidos/);
  await actualizarAjustes(db, tiendaId, { whatsapp: '' });
  const html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /7 de 8 pasos listos/);
  assert.doesNotMatch(html, /Tus pedidos/);
});

// ---------- Lista de pedidos ----------

test('la lista de pedidos tiene un menú de acciones por fila y un botón "Ver" para el celular', async () => {
  const { nav, tiendaId } = await tienda('lista-acciones');
  const transferencia = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS());
  const efectivo = await crearPedido(db, tiendaId, [{ sku: 'PLATO', cantidad: 1 }], DATOS({ pago: { clave: 'efectivo', descuento: 0 } }));
  const html = await (await nav.pedir('/admin/pedidos?filtro=todos')).text();

  assert.match(html, /<th scope="col"><span class="visualmente-oculto">Acciones<\/span><\/th>/);
  for (const { id, numero } of [transferencia, efectivo]) {
    assert.match(html, new RegExp(`popovertarget="acciones-${id}"[^>]*aria-label="Acciones del pedido #${numero}"`), 'el botón del menú de escritorio');
    assert.match(html, new RegExp(`<div class="menu-acciones-panel" id="acciones-${id}" popover data-menu-acciones>`));
    assert.match(html, new RegExp(`class="boton boton-secundario boton-chico acciones-angosto" href="/admin/pedidos/${id}">Ver`), 'el botón "Ver" del celular');
  }
  // Cada pedido ofrece su paso siguiente: la transferencia pide marcar el pago; el efectivo, preparar la entrega.
  const menuTransferencia = html.match(new RegExp(`id="acciones-${transferencia.id}"[\\s\\S]*?</div>`))[0];
  assert.match(menuTransferencia, /Ver pedido/);
  assert.match(menuTransferencia, /Marcar como pagado/);
  assert.match(menuTransferencia, /name="estado" value="pagado"/);
  assert.match(menuTransferencia, /name="volver" value="\/admin\/pedidos\?filtro=todos"/);
  assert.match(menuTransferencia, /https:\/\/wa\.me\/5493511234567\?text=/, 'WhatsApp con el teléfono del cliente');
  assert.match(menuTransferencia, new RegExp(`href="/admin/pedidos/${transferencia.id}#cancelar"`));
  const menuEfectivo = html.match(new RegExp(`id="acciones-${efectivo.id}"[\\s\\S]*?</div>`))[0];
  assert.match(menuEfectivo, /Marcar como listo para retirar/);
});

test('una acción rápida de la lista vuelve a la lista con su filtro; desde el detalle, al detalle', async () => {
  const { nav, tiendaId } = await tienda('lista-volver');
  const pedido = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS());
  const volver = '/admin/pedidos?filtro=nuevo&q=ana';

  const desdeLista = await nav.enviar(`/admin/pedidos/${pedido.id}/estado`, { estado: 'pagado', volver }, { desde: '/admin/pedidos' });
  assert.equal(desdeLista.headers.get('location'), volver);
  const lista = await (await nav.pedir('/admin/pedidos?filtro=pagado')).text();
  assert.match(lista, /quedó como &#34;Pagado&#34;|quedó como "Pagado"/);

  // Sin "volver", o con uno que no es del panel, se queda en el detalle del pedido.
  const sinVolver = await nav.enviar(`/admin/pedidos/${pedido.id}/estado`, { estado: 'enviado' }, { desde: '/admin/pedidos' });
  assert.equal(sinVolver.headers.get('location'), `/admin/pedidos/${pedido.id}`);
  const ajeno = await nav.enviar(`/admin/pedidos/${pedido.id}/estado`, { estado: 'entregado', volver: 'https://otro-sitio.com/admin/' }, { desde: '/admin/pedidos' });
  assert.equal(ajeno.headers.get('location'), `/admin/pedidos/${pedido.id}`);
});

test('el menú no ofrece paso siguiente ni cancelar cuando el pedido ya terminó, y la lista limita la cantidad', async () => {
  const { nav, tiendaId } = await tienda('lista-terminados');
  const entregado = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS());
  const cancelado = await crearPedido(db, tiendaId, [{ sku: 'PLATO', cantidad: 1 }], DATOS());
  await nav.enviar(`/admin/pedidos/${entregado.id}/estado`, { estado: 'entregado' }, { desde: '/admin/pedidos' });
  await nav.enviar(`/admin/pedidos/${cancelado.id}/cancelar`, {}, { desde: '/admin/pedidos' });
  const html = await (await nav.pedir('/admin/pedidos?filtro=todos')).text();
  for (const { id } of [entregado, cancelado]) {
    const menu = html.match(new RegExp(`id="acciones-${id}"[\\s\\S]*?</div>`))[0];
    assert.match(menu, /Ver pedido/);
    assert.doesNotMatch(menu, /name="estado"/, 'no hay paso siguiente');
    assert.doesNotMatch(menu, /#cancelar/, 'no se puede cancelar');
  }
  assert.equal(siguientePaso({ estado: 'entregado', pago: 'efectivo', entrega: { tipo: 'retiro' } }), null);
  assert.equal(sePuedeCancelar({ estado: 'pagado' }), true);
  assert.equal(sePuedeCancelar({ estado: 'entregado' }), false);
  assert.equal((await listarPedidos(db, tiendaId, { filtro: 'todos', limite: 1 })).length, 1);
  assert.equal((await listarPedidos(db, tiendaId, { filtro: 'todos' })).length, 2);
});

test('el detalle del pedido tiene el ancla #cancelar para llegar desde el menú', async () => {
  const { nav, tiendaId } = await tienda('lista-ancla');
  const pedido = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], DATOS());
  const html = await (await nav.pedir(`/admin/pedidos/${pedido.id}`)).text();
  assert.match(html, /<section class="tarjeta seccion-editor zona-peligro" id="cancelar">/);
});
