// Checkout: formas de entrega y de pago, del carrito al pedido, y su seguimiento desde el panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { leerAjustes, actualizarAjustes } from '../src/diseno.js';
import { validarPagos, validarMetodoEntrega, crearMetodoEntrega } from '../src/pagos.js';
import { calcularTotales, costoEnvio, leerItems, telefonoParaWhatsapp } from '../src/pedidos.js';
import { crearNavegador, pedirConHost, enviarConHost } from './ayudantes.js';

let servidor;
let puerto;
let db;

before(async () => {
  db = abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirSubidas: mkdtempSync(path.join(tmpdir(), 'subidas-')),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => servidor.close());

const vidriera = (slug, ruta) => pedirConHost(puerto, `${slug}.localhost`, ruta);
const comprar = (slug, campos, headers) => enviarConHost(puerto, `${slug}.localhost`, '/checkout', campos, headers);
const stockDe = (tiendaId, sku) => db.prepare('SELECT stock FROM variantes WHERE tienda_id = ? AND sku = ?').get(tiendaId, sku).stock;

// Tienda con productos y el panel abierto. Buzo $30.000 (stock 3), Gorra $5.000 (stock 1).
async function tienda(slug) {
  const { tienda: creada, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock', 'Atributo 1', 'Valor 1'],
    ['BUZO-M', 'Buzo', 30000, 3, 'Talle', 'M'],
    ['GORRA', 'Gorra', 5000, 1, null, null],
  ]);
  assert.deepEqual(errores, []);
  aplicarImportacion(db, creada.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id };
}

// Configura la tienda desde el panel: retiro (acepta efectivo), moto con costo y envío a coordinar; transferencia y efectivo.
async function configurar(nav) {
  const entregas = [
    { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: 'Av. Colón 1234', costo: '0', aceptaEfectivo: '1', activo: '1' },
    { tipo: 'domicilio', nombre: 'Moto en Córdoba Capital', descripcion: '24 a 48 hs', costo: '4.500', gratisDesde: '60000', activo: '1' },
    { tipo: 'domicilio', nombre: 'Todo el país', costo: '', aCoordinar: '1', activo: '1' },
  ];
  for (const entrega of entregas) {
    const respuesta = await nav.enviar('/admin/pagos/entregas/nueva', entrega);
    assert.equal(respuesta.status, 302, `se guarda "${entrega.nombre}"`);
  }
  const pagos = await nav.enviar('/admin/pagos', {
    pagoTransferencia: '1', transferenciaAlias: 'mi.tienda.mp', transferenciaTitular: 'Juana Pérez', descuentoTransferencia: '10',
    pagoEfectivo: '1', descuentoEfectivo: '5', cuotasSinInteres: '0',
  });
  assert.equal(pagos.status, 302);
  const html = await (await nav.pedir('/admin/pagos')).text();
  const ids = [...html.matchAll(/href="\/admin\/pagos\/entregas\/(\d+)" aria-label="Editar ([^"]+)"/g)].map((m) => [m[2], m[1]]);
  return Object.fromEntries(ids);
}

const CLIENTE = { nombre: 'Lucía Gómez', telefono: '351 15 123 4567', email: 'lucia@ejemplo.com' };
const DIRECCION = { calle: 'Obispo Trejo 300', piso: '2 B', ciudad: 'Córdoba', provincia: 'Córdoba', cp: '5000' };

// ---------- Cuentas ----------

test('el envío es gratis desde el monto configurado, y a coordinar no suma al total', () => {
  const moto = { costo: 450000, gratisDesde: 6000000 };
  assert.equal(costoEnvio(moto, 3000000), 450000);
  assert.equal(costoEnvio(moto, 6000000), 0);
  assert.equal(costoEnvio({ costo: null, gratisDesde: null }, 3000000), null);
  assert.deepEqual(calcularTotales(3000000, moto, { descuento: 10 }), {
    subtotal: 3000000, descuentoPorcentaje: 10, descuento: 300000, envio: 450000, total: 3150000,
  }, 'el descuento es solo sobre los productos');
  assert.equal(calcularTotales(3000000, { costo: null, gratisDesde: null }, null).total, 3000000);
});

test('leerItems junta repetidos, ignora basura y pone topes', () => {
  assert.deepEqual(leerItems({ sku: ['A', 'B', 'A', '', 'C'], cantidad: ['2', '1', '3', '5', 'x'] }), [
    { sku: 'A', cantidad: 5 }, { sku: 'B', cantidad: 1 },
  ]);
  assert.deepEqual(leerItems({ sku: 'A', cantidad: '999' }), [{ sku: 'A', cantidad: 50 }]);
  assert.deepEqual(leerItems({}), []);
});

test('el teléfono del cliente se pasa a un número de WhatsApp', () => {
  assert.equal(telefonoParaWhatsapp('351 15 123 4567'), '5493511234567');
  assert.equal(telefonoParaWhatsapp('0351 1234567'), '5493511234567');
  assert.equal(telefonoParaWhatsapp('+54 9 351 123-4567'), '5493511234567');
  assert.equal(telefonoParaWhatsapp('11 2345 6789'), '5491123456789');
});

test('validarPagos pide alias o CBU para la transferencia y revisa los números', () => {
  assert.deepEqual(Object.keys(validarPagos({ pagoTransferencia: '1' }).errores), ['transferenciaAlias']);
  const { errores } = validarPagos({ pagoTransferencia: '1', transferenciaAlias: 'no', transferenciaCbu: '123', descuentoTransferencia: '95', cuotasSinInteres: '1' });
  assert.deepEqual(Object.keys(errores).sort(), ['cuotasSinInteres', 'descuentoTransferencia', 'transferenciaAlias', 'transferenciaCbu']);
  const bien = validarPagos({ pagoTransferencia: '1', transferenciaCbu: '0000003100012345678901', pagoEfectivo: 'on' });
  assert.deepEqual(bien.errores, {});
  assert.equal(bien.ajustes.pagoEfectivo, true);
  assert.equal(bien.ajustes.pagoMercadopago, false);
  assert.deepEqual(validarPagos({ transferenciaAlias: 'x' }).errores, {}, 'con la transferencia apagada no se revisa el alias');
});

test('validarMetodoEntrega pide el costo salvo que se coordine después', () => {
  assert.ok(validarMetodoEntrega({ tipo: 'domicilio', nombre: 'Moto' }).errores.costo);
  assert.equal(validarMetodoEntrega({ tipo: 'domicilio', nombre: 'Moto', costo: '4.500,50' }).datos.costo, 450050);
  const coordinar = validarMetodoEntrega({ tipo: 'domicilio', nombre: 'Correo', aCoordinar: '1', gratisDesde: '1000' });
  assert.deepEqual(coordinar.errores, {});
  assert.equal(coordinar.datos.costo, null);
  assert.equal(coordinar.datos.gratisDesde, null, 'si se coordina, no hay "gratis desde"');
  assert.ok(validarMetodoEntrega({ tipo: 'avion', nombre: '' }).errores.tipo);
});

// ---------- Vidriera ----------

test('sin formas de entrega y pago no hay checkout: el carrito sigue por WhatsApp', async () => {
  const { tiendaId } = await tienda('sinconfigurar');
  actualizarAjustes(db, tiendaId, { whatsapp: '5493511234567' });
  assert.equal((await vidriera('sinconfigurar', '/checkout?sku=GORRA&cantidad=1')).location, '/');
  const ficha = (await vidriera('sinconfigurar', '/producto/gorra')).cuerpo;
  assert.match(ficha, /Enviar pedido por WhatsApp/);
  assert.doesNotMatch(ficha, /data-carrito-checkout/);
});

test('con entrega y pago configurados, el carrito lleva al checkout (aunque la tienda no tenga WhatsApp)', async () => {
  const { nav } = await tienda('configurada');
  await configurar(nav);
  const ficha = (await vidriera('configurada', '/producto/buzo')).cuerpo;
  assert.match(ficha, /data-agregar/);
  assert.match(ficha, /data-carrito-checkout/);
  assert.match(ficha, /10% off con transferencia · 5% off en efectivo/);
  assert.doesNotMatch(ficha, /Enviar pedido por WhatsApp/);
  assert.match(ficha, /\$\s27\.000,00<\/strong> con transferencia/, 'el producto muestra el precio con transferencia');
});

test('el checkout muestra lo del carrito con precios de la base y ajusta lo que no tiene stock', async () => {
  const { nav } = await tienda('vercheckout');
  await configurar(nav);
  const { status, cuerpo, headers } = await vidriera('vercheckout', '/checkout?sku=BUZO-M&cantidad=5&sku=NO-EXISTE&cantidad=1');
  assert.equal(status, 200);
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.match(cuerpo, /<meta name="robots" content="noindex">/);
  assert.match(cuerpo, /De Buzo quedan 3: ajustamos la cantidad/);
  assert.match(cuerpo, /Un producto ya no tiene stock y lo sacamos/);
  assert.match(cuerpo, /name="sku" value="BUZO-M"><input type="hidden" name="cantidad" value="3">/);
  assert.match(cuerpo, /3 × \$\s30\.000,00 · Talle M/);
  assert.match(cuerpo, /Retiro en el local[\s\S]*Moto en Córdoba Capital[\s\S]*Todo el país[\s\S]*A coordinar/);
  assert.doesNotMatch(cuerpo, /Gratis desde/, 'con $90.000 ya llegó al envío gratis: no hace falta avisarlo');
  assert.match((await vidriera('vercheckout', '/checkout?sku=GORRA&cantidad=1')).cuerpo, /Gratis desde \$\s60\.000,00/);
  assert.match(cuerpo, /Transferencia bancaria <span class="beneficio-off">10% off/);

  // $90.000 ya pasa el "gratis desde" de la moto.
  const datos = JSON.parse(cuerpo.match(/<script type="application\/json" id="datos-checkout">([^<]+)<\/script>/)[1]);
  assert.equal(datos.subtotal, 9000000);
  assert.deepEqual(datos.carrito, [{ sku: 'BUZO-M', cantidad: 3 }]);
  assert.match(cuerpo, /data-entrega-costo="\d+">Gratis</, 'la moto ya sale gratis');

  const vacio = (await vidriera('vercheckout', '/checkout')).cuerpo;
  assert.match(vacio, /Tu carrito está vacío/);
  assert.match(vacio, /"sinItems":true/, 'sin productos en el link, el script usa el carrito guardado');
});

test('comprar con envío y transferencia: crea el pedido, descuenta stock y muestra cómo pagar', async () => {
  const { nav, tiendaId } = await tienda('compra');
  const ids = await configurar(nav);
  const respuesta = await comprar('compra', [
    ['sku', 'BUZO-M'], ['cantidad', '1'], ['sku', 'GORRA'], ['cantidad', '1'],
    ...Object.entries(CLIENTE), ...Object.entries(DIRECCION),
    ['entrega', ids['Moto en Córdoba Capital']], ['pago', 'transferencia'], ['notas', 'Tocar timbre'],
    // Lo que mande el navegador sobre precios no se usa.
    ['precio', '1'],
  ]);
  assert.equal(respuesta.status, 303);
  const [, token] = respuesta.location.match(/^\/pedido\/([\w-]+)\?nuevo=1$/);
  assert.equal(stockDe(tiendaId, 'BUZO-M'), 2);
  assert.equal(stockDe(tiendaId, 'GORRA'), 0);

  const pedido = db.prepare('SELECT * FROM pedidos WHERE token = ?').get(token);
  assert.equal(pedido.numero, 1);
  assert.equal(pedido.subtotal_centavos, 3500000);
  assert.equal(pedido.descuento_centavos, 350000, '10% de $35.000');
  assert.equal(pedido.envio_centavos, 450000, 'no llega a los $60.000 del envío gratis');
  assert.equal(pedido.total_centavos, 3600000);
  assert.equal(pedido.direccion_calle, 'Obispo Trejo 300');
  assert.equal(pedido.estado, 'nuevo');

  const pagina = await vidriera('compra', `/pedido/${token}?nuevo=1`);
  assert.equal(pagina.status, 200);
  assert.equal(pagina.headers['cache-control'], 'private, no-store');
  assert.match(pagina.cuerpo, /¡Gracias, Lucía! Recibimos tu pedido/);
  assert.match(pagina.cuerpo, /data-pedido-nuevo/, 'el script vacía el carrito');
  assert.match(pagina.cuerpo, /Transferí <strong class="pedido-monto">\$\s36\.000,00<\/strong>/);
  assert.match(pagina.cuerpo, /mi\.tienda\.mp/);
  assert.match(pagina.cuerpo, /Juana Pérez/);
  assert.match(pagina.cuerpo, /Obispo Trejo 300, 2 B · Córdoba · Córdoba · CP 5000/);
  assert.match(pagina.cuerpo, /Descuento 10% \(transferencia bancaria\)/);

  // Otra tienda no ve el pedido, y un token inventado tampoco.
  assert.equal((await vidriera('vercheckout', `/pedido/${token}`)).status, 404);
  assert.equal((await vidriera('compra', '/pedido/inventado-1234567890')).status, 404);

  // El segundo pedido de la tienda es el #2.
  const otro = await comprar('compra', [['sku', 'BUZO-M'], ['cantidad', '1'], ...Object.entries(CLIENTE), ['entrega', ids['Retiro en el local']], ['pago', 'efectivo']]);
  assert.equal(otro.status, 303);
  const segundo = db.prepare('SELECT numero, descuento_porcentaje, envio_centavos, direccion_calle FROM pedidos WHERE token = ?').get(otro.location.match(/\/pedido\/([\w-]+)/)[1]);
  assert.deepEqual({ ...segundo }, { numero: 2, descuento_porcentaje: 5, envio_centavos: 0, direccion_calle: '' }, 'el retiro no guarda dirección');
});

test('con datos que faltan no se crea nada y se marca qué revisar', async () => {
  const { nav, tiendaId } = await tienda('incompleta');
  const ids = await configurar(nav);
  const respuesta = await comprar('incompleta', [
    ['sku', 'BUZO-M'], ['cantidad', '2'], ['nombre', 'Lu'], ['telefono', '12'],
    ['entrega', ids['Moto en Córdoba Capital']], ['pago', 'transferencia'], ['calle', ''],
  ]);
  assert.equal(respuesta.status, 400);
  for (const texto of ['Escribí tu nombre y apellido', 'Escribí tu teléfono', 'Escribí la calle y el número', 'Elegí la provincia']) {
    assert.match(respuesta.cuerpo, new RegExp(texto));
  }
  assert.match(respuesta.cuerpo, /name="cantidad" value="2"/, 'conserva el carrito');
  assert.match(respuesta.cuerpo, /value="Lu"/, 'conserva lo que se escribió');
  assert.equal(stockDe(tiendaId, 'BUZO-M'), 3);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pedidos WHERE tienda_id = ?').get(tiendaId).n, 0);
});

test('el efectivo solo con entregas que lo aceptan', async () => {
  const { nav } = await tienda('efectivo');
  const ids = await configurar(nav);
  const respuesta = await comprar('efectivo', [
    ['sku', 'GORRA'], ['cantidad', '1'], ...Object.entries(CLIENTE), ...Object.entries(DIRECCION),
    ['entrega', ids['Moto en Córdoba Capital']], ['pago', 'efectivo'],
  ]);
  assert.equal(respuesta.status, 400);
  assert.match(respuesta.cuerpo, /El pago en efectivo no está disponible con &#34;Moto en Córdoba Capital&#34;|El pago en efectivo no está disponible con &quot;Moto en Córdoba Capital&quot;/);
});

test('si el stock cambió mientras tanto, no se crea el pedido y se avisa', async () => {
  const { nav, tiendaId } = await tienda('carrera');
  const ids = await configurar(nav);
  const campos = [['sku', 'GORRA'], ['cantidad', '1'], ...Object.entries(CLIENTE), ['entrega', ids['Retiro en el local']], ['pago', 'transferencia']];
  assert.equal((await comprar('carrera', campos)).status, 303);
  const segundo = await comprar('carrera', campos);
  assert.equal(segundo.status, 400);
  assert.match(segundo.cuerpo, /Gorra ya no tiene stock y lo sacamos/);
  assert.equal(stockDe(tiendaId, 'GORRA'), 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pedidos WHERE tienda_id = ?').get(tiendaId).n, 1);
});

test('no se aceptan pedidos desde otro sitio ni de robots', async () => {
  const { nav, tiendaId } = await tienda('protegida');
  const ids = await configurar(nav);
  const campos = [['sku', 'BUZO-M'], ['cantidad', '1'], ...Object.entries(CLIENTE), ['entrega', ids['Retiro en el local']], ['pago', 'transferencia']];
  assert.equal((await comprar('protegida', campos, { origin: 'https://otro-sitio.com' })).status, 403);
  assert.equal((await comprar('protegida', [...campos, ['sitio', 'https://spam.com']])).location, '/');
  assert.equal(db.prepare('SELECT count(*) AS n FROM pedidos WHERE tienda_id = ?').get(tiendaId).n, 0);
  assert.equal((await comprar('protegida', campos, { origin: `http://protegida.localhost:${puerto}` })).status, 303, 'desde la misma tienda, sí');
});

// ---------- Panel ----------

test('el panel lista los pedidos, los avanza de estado y al cancelar devuelve el stock', async () => {
  const { nav, tiendaId } = await tienda('panelpedidos');
  const ids = await configurar(nav);
  const respuesta = await comprar('panelpedidos', [
    ['sku', 'BUZO-M'], ['cantidad', '2'], ...Object.entries(CLIENTE), ['entrega', ids['Retiro en el local']], ['pago', 'transferencia'],
  ]);
  const token = respuesta.location.match(/\/pedido\/([\w-]+)/)[1];
  const { id } = db.prepare('SELECT id FROM pedidos WHERE token = ?').get(token);
  assert.equal(stockDe(tiendaId, 'BUZO-M'), 1);

  const inicio = await (await nav.pedir('/admin/inicio')).text();
  assert.match(inicio, /Tenés un pedido nuevo/);
  assert.match(inicio, /<span class="menu-contador"[^>]*>1<\/span>/);

  const lista = await (await nav.pedir('/admin/pedidos')).text();
  assert.match(lista, new RegExp(`href="/admin/pedidos/${id}">#1</a>`));
  assert.match(lista, /Lucía Gómez/);
  assert.match(lista, /\$\s54\.000,00/, '$60.000 con 10% off');
  assert.match((await (await nav.pedir('/admin/pedidos?q=lucia')).text()), /Lucía Gómez/, 'busca sin tildes');
  assert.doesNotMatch((await (await nav.pedir('/admin/pedidos?q=nadie')).text()), /Lucía Gómez/);

  const detalle = await (await nav.pedir(`/admin/pedidos/${id}`)).text();
  assert.match(detalle, /Marcar como pagado/);
  assert.match(detalle, /href="https:\/\/wa\.me\/5493511234567\?text=/, 'link para escribirle al cliente');

  await nav.enviar(`/admin/pedidos/${id}/estado`, { estado: 'pagado' }, { desde: `/admin/pedidos/${id}` });
  assert.match(await (await nav.pedir(`/admin/pedidos/${id}`)).text(), /Marcar como listo para retirar/, 'es retiro: el siguiente paso es "listo para retirar"');
  assert.match((await vidriera('panelpedidos', `/pedido/${token}`)).cuerpo, /Pago confirmado/, 'el cliente ve el estado');

  await nav.enviar(`/admin/pedidos/${id}/cancelar`, {}, { desde: `/admin/pedidos/${id}` });
  assert.equal(stockDe(tiendaId, 'BUZO-M'), 3, 'volvieron las 2 unidades');
  assert.equal(db.prepare('SELECT estado FROM pedidos WHERE id = ?').get(id).estado, 'cancelado');
  await nav.enviar(`/admin/pedidos/${id}/cancelar`, {}, { desde: `/admin/pedidos/${id}` });
  assert.equal(stockDe(tiendaId, 'BUZO-M'), 3, 'cancelar dos veces no devuelve dos veces');
  await nav.enviar(`/admin/pedidos/${id}/estado`, { estado: 'nuevo' }, { desde: '/admin/pedidos' });
  assert.equal(db.prepare('SELECT estado FROM pedidos WHERE id = ?').get(id).estado, 'cancelado', 'un cancelado no vuelve atrás');
});

test('una tienda no ve ni toca los pedidos ni las entregas de otra', async () => {
  const duenia = await tienda('duenia');
  const ids = await configurar(duenia.nav);
  const respuesta = await comprar('duenia', [['sku', 'BUZO-M'], ['cantidad', '1'], ...Object.entries(CLIENTE), ['entrega', ids['Retiro en el local']], ['pago', 'transferencia']]);
  const { id } = db.prepare('SELECT id FROM pedidos WHERE token = ?').get(respuesta.location.match(/\/pedido\/([\w-]+)/)[1]);

  const intrusa = await tienda('intrusa');
  assert.equal((await intrusa.nav.pedir(`/admin/pedidos/${id}`)).status, 404);
  assert.equal((await intrusa.nav.enviar(`/admin/pedidos/${id}/cancelar`, {}, { desde: '/admin/pedidos' })).status, 404);
  assert.equal((await intrusa.nav.pedir(`/admin/pagos/entregas/${ids['Retiro en el local']}`)).status, 404);
  assert.equal(stockDe(duenia.tiendaId, 'BUZO-M'), 2);
});

test('Envíos y pagos: modelos para empezar, editar, pausar y no guardar formas de pago inválidas', async () => {
  const { nav, tiendaId } = await tienda('envios');
  actualizarAjustes(db, tiendaId, { direccion: 'Bv. San Juan 567' });
  const pagina = await (await nav.pedir('/admin/pagos')).text();
  assert.match(pagina, /Todavía no hay formas de entrega/);
  const retiro = await (await nav.pedir('/admin/pagos/entregas/nueva?modelo=retiro')).text();
  assert.match(retiro, /value="Retiro en el local"/);
  assert.match(retiro, /Bv\. San Juan 567\. Coordinamos/, 'el retiro trae la dirección de la tienda');

  const id = crearMetodoEntrega(db, tiendaId, { tipo: 'domicilio', nombre: 'Moto', descripcion: '', costo: 100000, gratisDesde: null, aceptaEfectivo: false, activo: true });
  await nav.enviar(`/admin/pagos/entregas/${id}`, { tipo: 'domicilio', nombre: 'Moto rápida', costo: '2000', activo: '1' });
  assert.match(await (await nav.pedir('/admin/pagos')).text(), /Moto rápida/);
  await nav.enviar(`/admin/pagos/entregas/${id}/activar`, { valor: '0' }, { desde: '/admin/pagos' });
  assert.equal(db.prepare('SELECT activo FROM metodos_entrega WHERE id = ?').get(id).activo, 0);

  const mal = await nav.enviar('/admin/pagos', { pagoTransferencia: '1', descuentoTransferencia: '10' });
  assert.equal(mal.status, 400);
  assert.match(await mal.text(), /escribí tu alias o tu CBU/);
  assert.equal(leerAjustes(db, tiendaId).pagoTransferencia, false);
  assert.equal(leerAjustes(db, tiendaId).direccion, 'Bv. San Juan 567', 'guardar pagos no toca el resto de los ajustes');
});
