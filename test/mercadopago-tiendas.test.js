// Mercado Pago dentro de cada tienda: conectar la cuenta (botón y token pegado), cobrar en el momento, pasar el pedido a Pagado solo
// cuando Mercado Pago lo confirma, y la calculadora de comisiones. Mercado Pago es un servidor de mentira (mercadopago-falso.js).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { leerConfig } from '../src/config.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { actualizarAjustes, leerAjustes } from '../src/diseno.js';
import { crearMetodoEntrega } from '../src/pagos.js';
import { crearPedido, cancelarPedido, leerPedido } from '../src/pedidos.js';
import { leerEventos } from '../src/envios.js';
import { cifrar, descifrar } from '../src/secretos.js';
import { IVA_BP, calcularComision, precioParaRecibir, tablaDeComisiones, listaDePlazos, esPlazo } from '../src/comisiones-mp.js';
import { configMp, conectarConToken, leerConexion, tokenVigente } from '../src/tienda-mercadopago.js';
import { itemsDelCobro, leerReferencia, referenciaDePedido } from '../src/cobros-mp.js';
import { crearNavegador, enviarConHost, pedirConHost } from './ayudantes.js';
import { crearMpVendedorFalso, crearN8nFalso } from './mercadopago-falso.js';

const SECRETO = 'secreto-de-prueba-de-al-menos-32-caracteres';
// El texto de una página tal como se lee: sin espacios no cortables ni las comillas escritas como entidades.
const sp = (texto) => texto.replaceAll(String.fromCharCode(160), ' ').replace(/&(?:quot|#34);/g, '"').replace(/&#39;/g, "'");

// ---------- Cifrado de los tokens ----------

test('secretos: lo cifrado se descifra con el mismo secreto, cada cifrado es distinto y nada sirve alterado o con otro secreto', () => {
  const token = 'APP_USR-123456-112233-abcdef0123456789-987654';
  const a = cifrar(token, SECRETO);
  const b = cifrar(token, SECRETO);
  assert.ok(a.startsWith('v1.'));
  assert.ok(!a.includes(token), 'no queda en claro');
  assert.notEqual(a, b, 'cada cifrado lleva su propio iv');
  assert.equal(descifrar(a, SECRETO), token);
  assert.equal(descifrar(b, SECRETO), token);
  assert.equal(descifrar(a, `${SECRETO}-otro`), null, 'con otro secreto no se lee');
  const partes = a.split('.');
  assert.equal(descifrar([partes[0], partes[1], partes[2], `${partes[3].slice(0, -2)}AA`].join('.'), SECRETO), null, 'alterado: no se lee');
  for (const malo of ['', 'v1.a.b', 'v2.a.b.c', null, undefined, 'texto en claro']) assert.equal(descifrar(malo, SECRETO), null);
  assert.throws(() => cifrar('x', 'corto'), /al menos 32/);
});

// ---------- Calculadora de comisiones ----------

test('comisiones: $50.000 al instante, a 35 días y con otros costos, con valores a mano (6,29 % + IVA sobre la comisión)', () => {
  // 6,29 % de 50.000 = 3.145,00; IVA 21 % de eso = 660,45; en total 3.805,45; quedan 46.194,55.
  assert.deepEqual(calcularComision(5_000_000), { precio: 5_000_000, tasaBp: 629, comision: 314_500, iva: 66_045, otros: 0, total: 380_545, neto: 4_619_455 });
  // A 35 días, 1,49 %: 745,00 + 156,45 de IVA.
  assert.deepEqual(calcularComision(5_000_000, { plazo: '35' }), { precio: 5_000_000, tasaBp: 149, comision: 74_500, iva: 15_645, otros: 0, total: 90_145, neto: 4_909_855 });
  // Otros costos del 1,5 % (por ejemplo, cuotas sin interés): 750,00 más.
  const conOtros = calcularComision(5_000_000, { otrosBp: 150 });
  assert.equal(conOtros.otros, 75_000);
  assert.equal(conOtros.neto, 4_544_455);
  assert.equal(IVA_BP, 2100);
  assert.ok(esPlazo('instante') && esPlazo('10') && esPlazo('18') && esPlazo('35'));
  assert.ok(!esPlazo('7') && !esPlazo(10) && !esPlazo('__proto__'));
});

test('comisiones: el precio para recibir $50.000 es el primer peso que alcanza, y la tabla trae los cuatro plazos empezando por "al instante"', () => {
  // 50.000 / (1 − 6,29 % × 1,21) = 54.118,94: se redondea hacia arriba a 54.119, y ese ya deja 50.000,05 (54.118 deja menos).
  assert.equal(precioParaRecibir(5_000_000), 5_411_900);
  assert.equal(calcularComision(5_411_900).neto, 5_000_005);
  assert.ok(calcularComision(5_411_800).neto < 5_000_000);
  assert.equal(precioParaRecibir(5_000_000, { plazo: '35' }), 5_091_900);
  // Siempre alcanza, para cualquier monto, plazo y otros costos.
  for (const plazo of ['instante', '10', '18', '35']) {
    for (const otrosBp of [0, 150, 1000]) {
      for (const neto of [100_000, 123_456, 5_000_000, 98_765_432]) {
        const precio = precioParaRecibir(neto, { plazo, otrosBp });
        assert.ok(calcularComision(precio, { plazo, otrosBp }).neto >= neto, `${plazo} ${otrosBp} ${neto}`);
        assert.equal(precio % 100, 0, 'un peso entero');
      }
    }
  }
  assert.equal(precioParaRecibir(0), null);
  assert.equal(precioParaRecibir(-5), null);
  assert.equal(precioParaRecibir(5_000_000, { otrosBp: 9_500 }), null, 'si el costo es el 100 %, no hay precio posible');

  assert.deepEqual(listaDePlazos().map((p) => p.clave), ['instante', '10', '18', '35']);
  assert.deepEqual(tablaDeComisiones(5_000_000).map((f) => [f.plazo, f.neto]), [['instante', 4_619_455], ['10', 4_734_405], ['18', 4_794_905], ['35', 4_909_855]]);
});

// ---------- Referencias e ítems del cobro ----------

test('la referencia de un pago une tienda y pedido, y solo se lee lo que tiene ese formato', () => {
  assert.equal(referenciaDePedido(7, 42), 'vezza-7-42');
  assert.deepEqual(leerReferencia('vezza-7-42'), { tiendaId: 7, pedidoId: 42 });
  for (const mala of ['vezza-7', 'vezza--1-2', 'vezza-7-42-9', 'otra-7-42', 'vezza-a-b', '', null, undefined, 'vezza-1234567890-1']) assert.equal(leerReferencia(mala), null, String(mala));
});

test('los renglones del cobro son los productos y el envío, y siempre suman el total del pedido', () => {
  const pedido = {
    numero: 12, envio: 450_000, total: 1_050_000 + 450_000,
    entrega: { nombre: 'Moto' },
    items: [{ nombre: 'Taza', detalle: 'Azul', precio: 350_000, cantidad: 3 }],
  };
  assert.deepEqual(itemsDelCobro(pedido), [
    { titulo: 'Taza (Azul)', cantidad: 3, precioCentavos: 350_000 },
    { titulo: 'Envío: Moto', cantidad: 1, precioCentavos: 450_000 },
  ]);
  // Con un descuento los renglones ya no suman el total: va un solo renglón por lo que hay que cobrar.
  assert.deepEqual(itemsDelCobro({ ...pedido, total: 1_400_000 }), [{ titulo: 'Pedido #12', cantidad: 1, precioCentavos: 1_400_000 }]);
  // Envío gratis: sin renglón de envío.
  assert.equal(itemsDelCobro({ ...pedido, envio: 0, total: 1_050_000 }).length, 1);
});

// ---------- Configuración ----------

test('config: el botón de conexión necesita el client id y el secreto juntos; sin ninguno, queda solo el token pegado', () => {
  const base = { SECRETO_SESION: SECRETO };
  const sin = leerConfig(base).mercadopagoTiendas;
  assert.equal(sin.oauth, false);
  assert.equal(sin.apiUrl, 'https://api.mercadopago.com');
  assert.equal(sin.authUrl, 'https://auth.mercadopago.com.ar');
  const con = leerConfig({ ...base, MP_CLIENT_ID: '123', MP_CLIENT_SECRET: 'abc', MP_API_URL: 'http://127.0.0.1:9/' }).mercadopagoTiendas;
  assert.deepEqual(con, { oauth: true, clientId: '123', clientSecret: 'abc', apiUrl: 'http://127.0.0.1:9', authUrl: 'https://auth.mercadopago.com.ar' });
  assert.throws(() => leerConfig({ ...base, MP_CLIENT_ID: '123' }), /MP_CLIENT_ID y MP_CLIENT_SECRET/);
  assert.throws(() => leerConfig({ ...base, MP_CLIENT_SECRET: 'abc' }), /MP_CLIENT_ID y MP_CLIENT_SECRET/);
  assert.equal(configMp({}).oauth, false, 'una config armada a mano, sin la sección, también anda');
});

// ---------- Con la aplicación andando ----------

let mp;
let n8n;
let db;
let servidor;
let puerto;
let config;
let contador = 0;

before(async () => {
  mp = crearMpVendedorFalso({ clienteId: 'cliente-1', clienteSecreto: 'secreto-cliente' });
  n8n = crearN8nFalso();
  for (const falso of [mp, n8n]) {
    falso.servidor.listen(0, '127.0.0.1');
    await once(falso.servidor, 'listening');
    falso.puerto = falso.servidor.address().port;
  }
});

after(() => {
  servidor?.closeAllConnections();
  servidor?.close();
  for (const falso of [mp, n8n]) {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
});

beforeEach(async () => {
  servidor?.closeAllConnections();
  servidor?.close();
  for (const falso of [mp.usuarios, mp.codigos, mp.refrescos, mp.preferencias, mp.pagos]) falso.clear();
  mp.pedidos.length = 0;
  mp.fallarPreferencias = false;
  n8n.recibidos.length = 0;
  db = await abrirBase(':memory:');
  config = {
    produccion: false,
    secretoSesion: SECRETO,
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' },
    mercadopagoTiendas: { oauth: true, clientId: 'cliente-1', clientSecret: 'secreto-cliente', apiUrl: `http://127.0.0.1:${mp.puerto}`, authUrl: 'https://auth.mercadopago.test' },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

const base = () => `http://127.0.0.1:${puerto}`;

// Una tienda con un producto, retiro en el local (gratis) y envío a coordinar, con Mercado Pago activo.
// conectada: con el token de la cuenta `cuenta` ya cargado; el navegador (nav) ya ingresó al panel.
async function tienda({ conectada = true, mercadopago = true, avisosMail = false } = {}) {
  contador++;
  const slug = `tienda-mp-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Nube ${contador}`, email: `${slug}@ejemplo.com`, slug });
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 1500, 100]]);
  await aplicarImportacion(db, creada.id, productos);
  await actualizarAjustes(db, creada.id, {
    whatsapp: '5493511234567', emailContacto: 'hola@nube.com', pagoMercadopago: mercadopago, pagoTransferencia: true, transferenciaAlias: 'mi.alias.mp', avisosPedidoEmail: avisosMail,
  });
  const retiro = await crearMetodoEntrega(db, creada.id, { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null, aceptaEfectivo: true, activo: true });
  const moto = await crearMetodoEntrega(db, creada.id, { tipo: 'domicilio', nombre: 'Moto en Córdoba', descripcion: '', costo: 450_000, gratisDesde: null, aceptaEfectivo: false, activo: true });
  const coordinar = await crearMetodoEntrega(db, creada.id, { tipo: 'domicilio', nombre: 'Todo el país', descripcion: '', costo: null, gratisDesde: null, aceptaEfectivo: false, activo: true });
  let cuenta = null;
  if (conectada) {
    cuenta = 1000 + contador;
    const token = mp.cuenta(`APP_USR-token-de-la-tienda-${contador}`, { id: cuenta, nickname: `VENDEDOR${contador}` });
    await conectarConToken(db, creada.id, token, { config, secreto: SECRETO });
  }
  const nav = crearNavegador(base());
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug, host: `${slug}.localhost`, retiro, moto, coordinar, cuenta, nombre: `Nube ${contador}` };
}

const DIRECCION = { calle: 'Obispo Trejo 300', piso: '', ciudad: 'Córdoba', provincia: 'Córdoba', cp: '5000', referencias: '' };
const camposCheckout = (t, { entrega, pago = 'mercadopago', email = 'lucia@correo.com', cantidad = 2 } = {}) => [
  ['sku', 'TAZA'], ['cantidad', String(cantidad)], ['nombre', 'Lucía Gómez'], ['telefono', '351 123 4567'], ['email', email],
  ['entrega', String(entrega ?? t.retiro)], ['pago', pago],
  ...Object.entries(DIRECCION),
];

// Hace el pedido por el checkout, como un comprador. Devuelve la respuesta y el pedido guardado.
async function comprar(t, opciones = {}) {
  const origen = `http://${t.host}:${puerto}`;
  const respuesta = await enviarConHost(puerto, t.host, '/checkout', camposCheckout(t, opciones), { origin: origen });
  const fila = await db.prepare('SELECT id FROM pedidos WHERE tienda_id = ? ORDER BY id DESC LIMIT 1').get(t.tiendaId);
  return { respuesta, pedido: fila ? await leerPedido(db, t.tiendaId, fila.id) : null };
}

const avisoDePago = (t, pagoId, cuerpo = { type: 'payment', data: { id: pagoId } }) =>
  fetch(`${base()}/webhooks/mercadopago/tienda/${t.tiendaId}?data.id=${pagoId}&type=payment`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo),
  });

const pagoDelPedido = (t, pedido, opciones = {}) =>
  mp.pagar({ referencia: referenciaDePedido(t.tiendaId, pedido.id), monto: pedido.total / 100, cuenta: t.cuenta, ...opciones });

const estadoDe = async (id) => (await db.prepare('SELECT estado, mp_pago_id AS pago, mp_pago_estado AS "pagoEstado" FROM pedidos WHERE id = ?').get(id));

// ---------- Conectar la cuenta ----------

test('el token pegado se comprueba con Mercado Pago, se guarda cifrado y la pantalla muestra la cuenta sin mostrar el token', async () => {
  const t = await tienda({ conectada: false });
  const token = mp.cuenta('APP_USR-12345678-token-largo-de-prueba-9999', { id: 5150, nickname: 'MI_TIENDA_MP' });

  const antes = sp(await (await t.nav.pedir('/admin/pagos')).text());
  assert.ok(antes.includes('Todavía no conectaste tu cuenta'));
  assert.ok(antes.includes('Conectar con Mercado Pago'), 'con las credenciales de OAuth cargadas aparece el botón');
  assert.ok(antes.includes('/admin/pagos/mercadopago/conectar'));

  const respuesta = await t.nav.enviar('/admin/pagos/mercadopago/token', { accessToken: `  ${token}  ` }, { desde: '/admin/pagos' });
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/pagos#mercadopago');
  assert.equal(mp.llamadas('/users/me').length, 1);
  assert.equal(mp.llamadas('/users/me')[0].autorizacion, `Bearer ${token}`, 'se comprobó con ese mismo token');

  const guardado = await db.prepare('SELECT * FROM tienda_mercadopago WHERE tienda_id = ?').get(t.tiendaId);
  assert.equal(guardado.modo, 'token');
  assert.equal(guardado.mp_user_id, '5150');
  assert.equal(guardado.mp_apodo, 'MI_TIENDA_MP');
  assert.equal(guardado.expira_en, null);
  assert.ok(guardado.access_token.startsWith('v1.') && !guardado.access_token.includes(token), 'se guarda cifrado');
  assert.equal(descifrar(guardado.access_token, SECRETO), token);
  assert.deepEqual(await leerConexion(db, t.tiendaId), { modo: 'token', userId: '5150', apodo: 'MI_TIENDA_MP', conectadaEn: guardado.conectada_en, expiraEn: null });

  const despues = sp(await (await t.nav.pedir('/admin/pagos')).text());
  assert.ok(despues.includes('Conectamos tu cuenta de Mercado Pago (MI_TIENDA_MP).'));
  assert.ok(despues.includes('MI_TIENDA_MP') && despues.includes('Desconectar mi cuenta'));
  assert.ok(!despues.includes(token), 'el token no se vuelve a mostrar');
  assert.ok(!despues.includes('Todavía no conectaste'));
});

test('un token que Mercado Pago no acepta, o que no parece uno, no se guarda', async () => {
  const t = await tienda({ conectada: false });
  const rechazar = async (accessToken) => {
    const respuesta = await t.nav.enviar('/admin/pagos/mercadopago/token', { accessToken }, { desde: '/admin/pagos' });
    assert.equal(respuesta.status, 302);
    return sp(await (await t.nav.pedir('/admin/pagos')).text());
  };
  // Con el formato de un token, pero que Mercado Pago no conoce.
  assert.ok((await rechazar('APP_USR-token-que-no-existe-0000000')).includes('Mercado Pago no aceptó ese Access Token'));
  // Texto cualquiera: ni siquiera se le pregunta a Mercado Pago.
  const consultas = mp.llamadas('/users/me').length;
  assert.ok((await rechazar('hola que tal')).includes('no parece un Access Token'));
  assert.equal(mp.llamadas('/users/me').length, consultas);
  assert.equal(await leerConexion(db, t.tiendaId), null);
  // Sin la sesión del panel (CSRF vencido o ausente), nada.
  const sinToken = await t.nav.pedir('/admin/pagos/mercadopago/token', { method: 'POST', body: new URLSearchParams({ accessToken: 'APP_USR-12345678-token-largo-de-prueba-9999' }) });
  assert.notEqual(sinToken.status, 302);
  assert.equal(await leerConexion(db, t.tiendaId), null);
});

test('desconectar borra la conexión, y los pedidos nuevos vuelven al link de pago a mano', async () => {
  const t = await tienda();
  assert.ok(await leerConexion(db, t.tiendaId));
  const respuesta = await t.nav.enviar('/admin/pagos/mercadopago/desconectar', {}, { desde: '/admin/pagos' });
  assert.equal(respuesta.status, 302);
  assert.equal(await leerConexion(db, t.tiendaId), null);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM tienda_mercadopago').get()).n, 0);
  const pagina = sp(await (await t.nav.pedir('/admin/pagos')).text());
  assert.ok(pagina.includes('Desconectamos tu cuenta de Mercado Pago'));
  assert.ok(pagina.includes('Todavía no conectaste tu cuenta'));
});

test('con el botón: se va a Mercado Pago con un estado, se vuelve con el código y la cuenta queda conectada; el estado sirve una sola vez', async () => {
  const t = await tienda({ conectada: false });
  const ir = await t.nav.pedir('/admin/pagos/mercadopago/conectar');
  assert.equal(ir.status, 302);
  const destino = new URL(ir.headers.get('location'));
  assert.equal(destino.origin, 'https://auth.mercadopago.test');
  assert.equal(destino.pathname, '/authorization');
  assert.equal(destino.searchParams.get('client_id'), 'cliente-1');
  assert.equal(destino.searchParams.get('response_type'), 'code');
  assert.equal(destino.searchParams.get('platform_id'), 'mp');
  // El panel se ve en config.dominio (localhost acá), con el puerto con el que entró la visita.
  const urlVuelta = `http://localhost:${puerto}/admin/pagos/mercadopago/volver`;
  assert.equal(destino.searchParams.get('redirect_uri'), urlVuelta);
  const estado = destino.searchParams.get('state');
  assert.ok(estado.length >= 30);

  // Mercado Pago devuelve a la tienda con un código y el mismo estado.
  mp.codigo('CODIGO-1', { id: 7070, nickname: 'CUENTA_OAUTH' });
  const volver = await t.nav.pedir(`/admin/pagos/mercadopago/volver?code=CODIGO-1&state=${encodeURIComponent(estado)}`);
  assert.equal(volver.status, 302);
  assert.equal(volver.headers.get('location'), '/admin/pagos#mercadopago');
  const canje = mp.llamadas('/oauth/token')[0].cuerpo;
  assert.deepEqual(canje, { client_id: 'cliente-1', client_secret: 'secreto-cliente', grant_type: 'authorization_code', code: 'CODIGO-1', redirect_uri: urlVuelta });

  const conexion = await leerConexion(db, t.tiendaId);
  assert.equal(conexion.modo, 'oauth');
  assert.equal(conexion.apodo, 'CUENTA_OAUTH');
  assert.equal(conexion.userId, '7070');
  assert.ok(Date.parse(conexion.expiraEn) > Date.now() + 170 * 86_400_000, 'el token dura unos 180 días');
  const fila = await db.prepare('SELECT access_token, refresh_token FROM tienda_mercadopago WHERE tienda_id = ?').get(t.tiendaId);
  assert.equal(descifrar(fila.access_token, SECRETO), 'APP_USR-oauth-CODIGO-1');
  assert.equal(descifrar(fila.refresh_token, SECRETO), 'TG-refresh-CODIGO-1');
  assert.ok(sp(await (await t.nav.pedir('/admin/pagos')).text()).includes('Conectamos tu cuenta de Mercado Pago (CUENTA_OAUTH).'));

  // El mismo estado no sirve de nuevo.
  mp.codigo('CODIGO-2');
  await t.nav.pedir(`/admin/pagos/mercadopago/volver?code=CODIGO-2&state=${encodeURIComponent(estado)}`);
  assert.equal(mp.llamadas('/oauth/token').length, 1, 'no se canjeó el segundo código');
  assert.ok(sp(await (await t.nav.pedir('/admin/pagos')).text()).includes('El enlace de conexión venció o no es válido'));
});

test('con el botón: un estado que no es el de la sesión, o sin haber empezado, o un permiso rechazado, no conectan nada', async () => {
  const t = await tienda({ conectada: false });
  mp.codigo('CODIGO-X');
  // Sin haber empezado (no hay estado en la sesión).
  await t.nav.pedir('/admin/pagos/mercadopago/volver?code=CODIGO-X&state=inventado');
  // Habiendo empezado, pero con otro estado.
  await t.nav.pedir('/admin/pagos/mercadopago/conectar');
  await t.nav.pedir('/admin/pagos/mercadopago/volver?code=CODIGO-X&state=inventado');
  // Habiendo empezado, y el usuario no dio el permiso.
  const ir = await t.nav.pedir('/admin/pagos/mercadopago/conectar');
  const estado = new URL(ir.headers.get('location')).searchParams.get('state');
  await t.nav.pedir(`/admin/pagos/mercadopago/volver?error=access_denied&state=${encodeURIComponent(estado)}`);
  assert.equal(mp.llamadas('/oauth/token').length, 0, 'nunca se canjeó el código');
  assert.equal(await leerConexion(db, t.tiendaId), null);
  assert.ok(sp(await (await t.nav.pedir('/admin/pagos')).text()).includes('No se conectó Mercado Pago'));
});

test('sin las credenciales de OAuth no hay botón (queda el token pegado) y la ruta del botón avisa', async () => {
  servidor.closeAllConnections();
  servidor.close();
  config.mercadopagoTiendas = { ...config.mercadopagoTiendas, oauth: false, clientId: '', clientSecret: '' };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  const t = await tienda({ conectada: false });
  const pagina = sp(await (await t.nav.pedir('/admin/pagos')).text());
  assert.ok(!pagina.includes('/admin/pagos/mercadopago/conectar'));
  assert.ok(pagina.includes('Pegá tu Access Token') && pagina.includes('<details class="mp-token" open>'));
  const ir = await t.nav.pedir('/admin/pagos/mercadopago/conectar');
  assert.equal(ir.status, 302);
  assert.equal(ir.headers.get('location'), '/admin/pagos#mercadopago');
  assert.ok(sp(await (await t.nav.pedir('/admin/pagos')).text()).includes('todavía no está activado'));
});

test('el token de OAuth se renueva solo antes de vencer y se guarda el refresh token nuevo; si no se puede renovar, sigue el actual mientras sirva', async () => {
  const t = await tienda({ conectada: false });
  mp.codigo('CODIGO-R', { id: 8080 });
  const ir = await t.nav.pedir('/admin/pagos/mercadopago/conectar');
  const estado = new URL(ir.headers.get('location')).searchParams.get('state');
  await t.nav.pedir(`/admin/pagos/mercadopago/volver?code=CODIGO-R&state=${encodeURIComponent(estado)}`);
  const opciones = { config, secreto: SECRETO };

  // Falta mucho para que venza: se usa el que hay, sin llamar a Mercado Pago.
  assert.equal(await tokenVigente(db, t.tiendaId, opciones), 'APP_USR-oauth-CODIGO-R');
  assert.equal(mp.llamadas('/oauth/token').length, 1);

  // Le faltan 5 días: se renueva (una sola vez aunque lo pidan varios a la vez).
  await db.prepare('UPDATE tienda_mercadopago SET expira_en = ? WHERE tienda_id = ?').run(new Date(Date.now() + 5 * 86_400_000).toISOString(), t.tiendaId);
  const [uno, dos, tres] = await Promise.all([1, 2, 3].map(() => tokenVigente(db, t.tiendaId, opciones)));
  assert.equal(uno, dos);
  assert.equal(dos, tres);
  assert.match(uno, /^APP_USR-renovado-/);
  assert.equal(mp.llamadas('/oauth/token').length, 2, 'una sola renovación');
  assert.equal(mp.llamadas('/oauth/token')[1].cuerpo.grant_type, 'refresh_token');
  assert.equal(mp.llamadas('/oauth/token')[1].cuerpo.refresh_token, 'TG-refresh-CODIGO-R');
  const fila = await db.prepare('SELECT access_token, refresh_token, expira_en FROM tienda_mercadopago WHERE tienda_id = ?').get(t.tiendaId);
  assert.equal(descifrar(fila.access_token, SECRETO), uno);
  assert.match(descifrar(fila.refresh_token, SECRETO), /^TG-refresh-nuevo-/, 'se guarda el refresh token nuevo (el anterior ya no sirve)');
  assert.ok(Date.parse(fila.expira_en) > Date.now() + 170 * 86_400_000);

  // Otra vez por vencer, pero Mercado Pago ya no reconoce el refresh token: sigue el token actual mientras no haya vencido...
  await db.prepare('UPDATE tienda_mercadopago SET expira_en = ?, refresh_token = ? WHERE tienda_id = ?').run(new Date(Date.now() + 3 * 86_400_000).toISOString(), cifrar('TG-ya-usado', SECRETO), t.tiendaId);
  assert.equal(await tokenVigente(db, t.tiendaId, opciones), uno);
  // ...y si ya venció, no hay token para usar.
  await db.prepare('UPDATE tienda_mercadopago SET expira_en = ? WHERE tienda_id = ?').run(new Date(Date.now() - 1000).toISOString(), t.tiendaId);
  assert.equal(await tokenVigente(db, t.tiendaId, opciones), null);
  // Un token pegado a mano no vence ni se renueva.
  const manual = await tienda();
  assert.equal(await tokenVigente(db, manual.tiendaId, opciones), `APP_USR-token-de-la-tienda-${contador}`);
  // Sin conexión: nada.
  assert.equal(await tokenVigente(db, 999_999, opciones), null);
  // Con otro SECRETO_SESION los tokens guardados no se pueden leer.
  assert.equal(await tokenVigente(db, manual.tiendaId, { config, secreto: `${SECRETO}-cambiado` }), null);
});

// ---------- Calculadora de comisiones en el panel ----------

test('el panel muestra la calculadora con $50.000 ya calculados, la tabla con los cuatro plazos y guarda lo que la tienda elige', async () => {
  const t = await tienda({ conectada: false });
  const pagina = sp(await (await t.nav.pedir('/admin/pagos')).text());
  for (const esperado of [
    'Comisiones de Mercado Pago',
    '6,29 %', '3.145,00', '660,45', '46.194,55', // la venta de $50.000 al instante
    '$ 54.119,00', // lo que hay que vender para que queden $50.000
    '4,39 % + IVA', '1,49 % + IVA',
  ]) assert.ok(pagina.includes(esperado), `falta "${esperado}"`);
  // La tabla empieza por "Al instante" y sigue con 10, 18 y 35 días.
  const orden = [...pagina.matchAll(/data-mp-fila="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(orden, ['instante', '10', '18', '35']);
  assert.ok(pagina.includes('/calculadora-mp.js'));

  const guardar = await t.nav.enviar('/admin/pagos/comisiones', { mpPlazo: '35', mpOtros: '1,5' }, { desde: '/admin/pagos' });
  assert.equal(guardar.status, 302);
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.equal(ajustes.mpPlazo, '35');
  assert.equal(ajustes.mpOtrosBp, 150);
  const recalculada = sp(await (await t.nav.pedir('/admin/pagos')).text());
  assert.ok(recalculada.includes('1,49 %') && recalculada.includes('745,00') && recalculada.includes('156,45') && recalculada.includes('750,00'));
  assert.ok(recalculada.includes('value="1,5"'));
  assert.ok(recalculada.includes('<option value="35" selected>'));

  // Datos inválidos: no se guarda nada.
  for (const malo of [{ mpPlazo: '7', mpOtros: '1' }, { mpPlazo: 'instante', mpOtros: 'mucho' }, { mpPlazo: 'instante', mpOtros: '45' }, { mpPlazo: 'instante', mpOtros: '-1' }]) {
    await t.nav.enviar('/admin/pagos/comisiones', malo, { desde: '/admin/pagos' });
    assert.equal((await leerAjustes(db, t.tiendaId)).mpPlazo, '35');
    assert.equal((await leerAjustes(db, t.tiendaId)).mpOtrosBp, 150);
  }
  assert.ok(sp(await (await t.nav.pedir('/admin/pagos')).text()).includes('Revisá los datos de la calculadora'));
});

test('los módulos de la calculadora se sirven al navegador (el mismo código que usa el servidor)', async () => {
  const modulo = await fetch(`${base()}/comisiones-mp.js`);
  assert.equal(modulo.status, 200);
  assert.match(modulo.headers.get('content-type'), /javascript/);
  const texto = await modulo.text();
  assert.ok(texto.includes('export function calcularComision') && !/\bimport\b/.test(texto), 'sin dependencias: corre en el navegador');
  assert.equal((await fetch(`${base()}/calculadora-mp.js`)).status, 200);
});

// ---------- Cobrar en el checkout ----------

test('con la cuenta conectada, confirmar el pedido manda al comprador a Mercado Pago en el acto, con el pago armado por el total', async () => {
  const t = await tienda();
  const { respuesta, pedido } = await comprar(t, { entrega: t.moto });
  assert.equal(respuesta.status, 303);
  assert.match(respuesta.location, /^https:\/\/www\.mercadopago\.test\/checkout\?pref_id=pref-\d+$/);
  assert.equal(pedido.estado, 'nuevo');
  assert.equal(pedido.total, 300_000 + 450_000, '2 tazas de $1.500 más el envío');

  assert.equal(mp.preferencias.size, 1);
  const preferencia = mp.ultimaPreferencia();
  assert.equal(preferencia.token, `APP_USR-token-de-la-tienda-${contador}`, 'se arma con el token de la tienda, no con el de la plataforma');
  assert.equal(preferencia.external_reference, `vezza-${t.tiendaId}-${pedido.id}`);
  assert.deepEqual(preferencia.items, [
    { title: 'Taza', quantity: 2, unit_price: 1500, currency_id: 'ARS' },
    { title: 'Envío: Moto en Córdoba', quantity: 1, unit_price: 4500, currency_id: 'ARS' },
  ]);
  assert.equal(preferencia.items.reduce((suma, i) => suma + i.quantity * i.unit_price, 0) * 100, pedido.total, 'suma lo que hay que cobrar');
  assert.deepEqual(preferencia.payer, { email: 'lucia@correo.com' });
  const vuelta = `http://${t.host}:${puerto}/pedido/${pedido.token}`;
  assert.deepEqual(preferencia.back_urls, { success: `${vuelta}?mp=ok`, pending: `${vuelta}?mp=pendiente`, failure: `${vuelta}?mp=error` });
  // En tu compu (http) Mercado Pago no puede volver solo ni avisar: se omiten.
  assert.equal(preferencia.auto_return, undefined);
  assert.equal(preferencia.notification_url, undefined);
  assert.equal(preferencia.expires, true);
  assert.ok(Date.parse(preferencia.expiration_date_to) > Date.now() + 2 * 86_400_000);

  assert.equal(pedido.mp.preferenciaId, preferencia.id);
  assert.equal(pedido.mp.initPoint, respuesta.location);
  // Todavía no se pagó: el pedido sigue "nuevo" y el stock está reservado.
  assert.equal((await db.prepare("SELECT stock FROM variantes WHERE tienda_id = ? AND sku = 'TAZA'").get(t.tiendaId)).stock, 98);
});

test('el pago lleva las direcciones públicas (vuelta automática y aviso) cuando la tienda se ve en https', async () => {
  // Se prueba el armado del pago directamente, con las URL que tendría en producción.
  const { crearClienteMpTienda } = await import('../src/mercadopago-tiendas.js');
  const token = mp.cuenta('APP_USR-prueba-https-0000000000', { id: 31 });
  const cliente = crearClienteMpTienda({ accessToken: token, apiUrl: config.mercadopagoTiendas.apiUrl });
  const { id, initPoint } = await cliente.crearPreferencia({
    items: [{ titulo: 'Taza', cantidad: 1, precioCentavos: 150_000 }],
    referenciaExterna: 'vezza-1-2',
    urlsVuelta: { ok: 'https://nube.vezzadev.com/pedido/abc?mp=ok', pendiente: 'https://nube.vezzadev.com/pedido/abc?mp=pendiente', error: 'https://nube.vezzadev.com/pedido/abc?mp=error' },
    urlAviso: 'https://tiendas.vezzadev.com/webhooks/mercadopago/tienda/1',
    vence: new Date(Date.now() + 86_400_000).toISOString(),
  });
  assert.match(initPoint, /^https:\/\/www\.mercadopago\.test\//);
  const preferencia = mp.preferencias.get(id);
  assert.equal(preferencia.auto_return, 'approved');
  assert.equal(preferencia.notification_url, 'https://tiendas.vezzadev.com/webhooks/mercadopago/tienda/1');
  assert.equal(preferencia.payer, undefined, 'sin email del comprador, sin payer');
});

test('sin la cuenta conectada, Mercado Pago sigue como antes: el pedido se crea y el comprador pide el link por WhatsApp', async () => {
  const t = await tienda({ conectada: false });
  const { respuesta, pedido } = await comprar(t, { entrega: t.moto });
  assert.equal(respuesta.status, 303);
  assert.equal(respuesta.location, `/pedido/${pedido.token}?nuevo=1`);
  assert.equal(mp.pedidos.length, 0, 'no se le habló a Mercado Pago');
  const pagina = sp((await pedirConHost(puerto, t.host, `/pedido/${pedido.token}?nuevo=1`)).cuerpo);
  assert.ok(pagina.includes('Pedir el link de pago por WhatsApp'));
  assert.ok(!pagina.includes('Pagar con Mercado Pago</button>'));
  // El checkout no ofrece Mercado Pago "en línea".
  const checkout = (await pedirConHost(puerto, t.host, '/checkout?sku=TAZA&cantidad=1')).cuerpo;
  assert.ok(!checkout.includes('te llevamos a Mercado Pago'.toLowerCase()) || checkout.includes('data-nota-mp hidden'));
  assert.ok(sp(checkout).includes('"enLinea":false'));
});

test('con la cuenta conectada el checkout lo dice, y con una entrega a coordinar Mercado Pago no se puede elegir (no hay monto final)', async () => {
  const t = await tienda();
  const checkout = sp((await pedirConHost(puerto, t.host, '/checkout?sku=TAZA&cantidad=1')).cuerpo);
  assert.ok(checkout.includes('Pagás en el momento en Mercado Pago'));
  assert.ok(checkout.includes('"enLinea":true'));
  assert.ok(checkout.includes('data-sin-opcion'));

  // Con la entrega a coordinar, el servidor lo rechaza aunque se mande a mano.
  const { respuesta, pedido } = await comprar(t, { entrega: t.coordinar });
  assert.equal(respuesta.status, 400);
  assert.ok(sp(respuesta.cuerpo).includes('no está disponible con "Todo el país"'));
  assert.equal(pedido, null, 'no se creó el pedido');
  assert.equal(mp.preferencias.size, 0);
  // Con transferencia sí se puede.
  const transferencia = await comprar(t, { entrega: t.coordinar, pago: 'transferencia' });
  assert.equal(transferencia.respuesta.status, 303);
  assert.equal(transferencia.pedido.envio, null);
});

test('si Mercado Pago falla al armar el pago, el pedido igual queda hecho y el comprador puede intentar de nuevo desde su pedido', async () => {
  const t = await tienda();
  mp.fallarPreferencias = true;
  const { respuesta, pedido } = await comprar(t, { entrega: t.retiro });
  assert.equal(respuesta.status, 303);
  assert.equal(respuesta.location, `/pedido/${pedido.token}?nuevo=1&mp=error`);
  assert.equal(pedido.estado, 'nuevo');
  assert.equal(pedido.mp.preferenciaId, '');

  const pagina = sp((await pedirConHost(puerto, t.host, respuesta.location)).cuerpo);
  assert.ok(pagina.includes('No pudimos completar el pago. Podés intentar de nuevo.'));
  assert.ok(pagina.includes(`action="/pedido/${pedido.token}/pagar"`) && pagina.includes('Pagar con Mercado Pago'));

  // Mercado Pago vuelve a andar: el botón arma el pago y manda a Mercado Pago.
  mp.fallarPreferencias = false;
  const origen = `http://${t.host}:${puerto}`;
  const pagar = await enviarConHost(puerto, t.host, `/pedido/${pedido.token}/pagar`, {}, { origin: origen });
  assert.equal(pagar.status, 303);
  assert.match(pagar.location, /^https:\/\/www\.mercadopago\.test\/checkout\?pref_id=/);
  assert.equal(mp.preferencias.size, 1);
  // Otro clic reutiliza el mismo pago (no arma uno nuevo cada vez).
  const otra = await enviarConHost(puerto, t.host, `/pedido/${pedido.token}/pagar`, {}, { origin: origen });
  assert.equal(otra.location, pagar.location);
  assert.equal(mp.preferencias.size, 1);
  // Si el link armado ya es viejo, se arma otro.
  await db.prepare('UPDATE pedidos SET mp_preferencia_creada_en = ? WHERE id = ?').run(new Date(Date.now() - 2.5 * 86_400_000).toISOString(), pedido.id);
  const renovado = await enviarConHost(puerto, t.host, `/pedido/${pedido.token}/pagar`, {}, { origin: origen });
  assert.notEqual(renovado.location, pagar.location);
  assert.equal(mp.preferencias.size, 2);
});

test('"Pagar con Mercado Pago" no sirve desde otro sitio, ni con otro tipo de pago, ni con un pedido que ya no espera el pago', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const antes = mp.preferencias.size;
  // Un formulario de otro sitio.
  const ajeno = await enviarConHost(puerto, t.host, `/pedido/${pedido.token}/pagar`, {}, { origin: 'https://sitio-malo.example' });
  assert.equal(ajeno.status, 403);
  // Un pedido que no es de Mercado Pago.
  const transferencia = await comprar(t, { entrega: t.retiro, pago: 'transferencia' });
  const origen = `http://${t.host}:${puerto}`;
  const otro = await enviarConHost(puerto, t.host, `/pedido/${transferencia.pedido.token}/pagar`, {}, { origin: origen });
  assert.equal(otro.status, 303);
  assert.equal(otro.location, `/pedido/${transferencia.pedido.token}`);
  // Un pedido ya pago.
  await db.prepare("UPDATE pedidos SET estado = 'pagado' WHERE id = ?").run(pedido.id);
  const pago = await enviarConHost(puerto, t.host, `/pedido/${pedido.token}/pagar`, {}, { origin: origen });
  assert.equal(pago.location, `/pedido/${pedido.token}`);
  // Un pedido que no existe.
  assert.equal((await enviarConHost(puerto, t.host, '/pedido/token-que-no-existe-0000/pagar', {}, { origin: origen })).status, 404);
  assert.equal(mp.preferencias.size, antes);
});

// ---------- El aviso de pago ----------

test('el aviso de un pago aprobado pasa el pedido a Pagado, guarda lo que cobró Mercado Pago y lo que le llega a la tienda, y repetirlo no cambia nada', async () => {
  const t = await tienda({ avisosMail: true });
  const { pedido } = await comprar(t, { entrega: t.moto });
  const pagoId = pagoDelPedido(t, pedido, { neto: 6935.17 }); // $7.500 menos $564,83 de comisión e IVA

  const respuesta = await avisoDePago(t, pagoId);
  assert.equal(respuesta.status, 200);
  const guardado = await leerPedido(db, t.tiendaId, pedido.id);
  assert.equal(guardado.estado, 'pagado');
  assert.deepEqual({ ...guardado.mp, preferenciaCreadaEn: '' }, {
    preferenciaId: pedido.mp.preferenciaId, initPoint: pedido.mp.initPoint, preferenciaCreadaEn: '',
    pagoId, pagoEstado: 'approved', comision: 56_483, neto: 693_517, acreditacion: '2026-11-25',
  });
  assert.equal(guardado.mp.comision + guardado.mp.neto, guardado.total, 'lo que se queda Mercado Pago y lo que le llega a la tienda suman el total');
  const eventos = await leerEventos(db, pedido.id);
  const pagado = eventos.filter((e) => e.paso === 'pagado');
  assert.equal(pagado.length, 1);
  assert.equal(pagado[0].titulo, 'Pago confirmado');
  assert.equal(pagado[0].detalle, 'Pagó con Mercado Pago.');
  assert.ok(pagado[0].visible, 'el comprador lo ve en su línea de tiempo');
  // La tienda tiene activados los avisos: sale el mail "Pago confirmado" con el seguimiento.
  const mails = n8n.recibidos.filter((r) => r.cuerpo.evento === 'pedido_actualizado').map((r) => r.cuerpo);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].email, 'lucia@correo.com');
  assert.equal(mails[0].pedido.numero, pedido.numero);
  assert.equal(mails[0].titulo, `Recibimos el pago de tu pedido #${pedido.numero}`);
  assert.equal(pagado[0].avisadoEmail, true);

  // Mercado Pago repite el aviso (lo hace): nada cambia ni se manda otro mail.
  for (let vez = 0; vez < 3; vez++) assert.equal((await avisoDePago(t, pagoId)).status, 200);
  assert.equal((await leerEventos(db, pedido.id)).filter((e) => e.paso === 'pagado').length, 1);
  assert.equal(n8n.recibidos.filter((r) => r.cuerpo.evento === 'pedido_actualizado').length, 1);
  // También con el aviso en el formato viejo (topic e id en la URL).
  const viejo = await fetch(`${base()}/webhooks/mercadopago/tienda/${t.tiendaId}?topic=payment&id=${pagoId}`, { method: 'POST' });
  assert.equal(viejo.status, 200);
  assert.equal((await estadoDe(pedido.id)).estado, 'pagado');

  // La tienda ve lo que le cobraron y lo que le llega, en el pedido.
  const detalle = sp(await (await t.nav.pedir(`/admin/pedidos/${pedido.id}`)).text());
  assert.ok(detalle.includes('Aprobado'));
  assert.ok(detalle.includes('−$ 564,83') && detalle.includes('$ 6.935,17'), 'comisión y neto reales');
  assert.ok(detalle.includes('25/11/2026'));
});

test('sin los avisos por mail activados, el pago confirma el pedido pero no se manda mail', async () => {
  const t = await tienda({ avisosMail: false });
  const { pedido } = await comprar(t, { entrega: t.retiro });
  await avisoDePago(t, pagoDelPedido(t, pedido));
  assert.equal((await estadoDe(pedido.id)).estado, 'pagado');
  assert.equal(n8n.recibidos.length, 0);
});

test('un aviso que no se puede comprobar con Mercado Pago no cambia nada: pago de otra referencia, de otro monto, inexistente, de otra cuenta, o de otro tema', async () => {
  const t = await tienda();
  const otra = await tienda();
  const { pedido } = await comprar(t, { entrega: t.moto });
  const { pedido: ajeno } = await comprar(otra, { entrega: otra.moto });
  const llamadasAntes = () => mp.pedidos.length;

  // Un pago aprobado, pero de otro pedido de la misma tienda: no paga éste.
  const deOtroPedido = mp.pagar({ referencia: referenciaDePedido(t.tiendaId, pedido.id + 100), monto: pedido.total / 100, cuenta: t.cuenta });
  assert.equal((await avisoDePago(t, deOtroPedido)).status, 200);
  // Un pago por menos de lo que vale el pedido.
  const deOtroMonto = pagoDelPedido(t, pedido, { monto: 1 });
  assert.equal((await avisoDePago(t, deOtroMonto)).status, 200);
  // Un pago que no existe.
  assert.equal((await avisoDePago(t, '123456789')).status, 200);
  // Un pago de OTRA tienda, avisado contra ésta: Mercado Pago no lo conoce para esta cuenta.
  const deOtraTienda = pagoDelPedido(otra, ajeno);
  assert.equal((await avisoDePago(t, deOtraTienda)).status, 200);
  assert.equal((await estadoDe(pedido.id)).estado, 'nuevo');
  assert.equal((await estadoDe(ajeno.id)).estado, 'nuevo', 'tampoco se pagó el de la otra tienda (el aviso era contra ésta)');

  // Con la referencia de otra tienda, aunque el pago sea de esta cuenta: no.
  const conReferenciaAjena = mp.pagar({ referencia: referenciaDePedido(otra.tiendaId, ajeno.id), monto: ajeno.total / 100, cuenta: t.cuenta });
  assert.equal((await avisoDePago(t, conReferenciaAjena)).status, 200);
  assert.equal((await estadoDe(ajeno.id)).estado, 'nuevo');

  // Otro tema, un id que no es un número, o una tienda inexistente: ni se le pregunta a Mercado Pago.
  const antes = llamadasAntes();
  const idValido = pagoDelPedido(t, pedido);
  assert.equal((await avisoDePago(t, idValido, { type: 'merchant_order', data: { id: idValido } })).status, 200);
  assert.equal((await fetch(`${base()}/webhooks/mercadopago/tienda/${t.tiendaId}?data.id=abc&type=payment`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base()}/webhooks/mercadopago/tienda/${t.tiendaId}?type=payment`, { method: 'POST' })).status, 200);
  assert.equal(llamadasAntes(), antes);
  assert.equal((await fetch(`${base()}/webhooks/mercadopago/tienda/999999?data.id=${idValido}&type=payment`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${base()}/webhooks/mercadopago/tienda/abc?data.id=${idValido}&type=payment`, { method: 'POST' })).status, 404);
  assert.equal((await estadoDe(pedido.id)).estado, 'nuevo');
});

test('un aviso de una tienda sin la cuenta conectada se da por atendido sin tocar nada', async () => {
  const t = await tienda({ conectada: false });
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const pagoId = mp.pagar({ referencia: referenciaDePedido(t.tiendaId, pedido.id), monto: pedido.total / 100, cuenta: 1 });
  assert.equal((await avisoDePago(t, pagoId)).status, 200);
  assert.equal((await estadoDe(pedido.id)).estado, 'nuevo');
  assert.equal(mp.llamadas('/v1/payments').length, 0);
});

test('un pago pendiente no confirma el pedido; cuando se aprueba, sí. Un pago rechazado tampoco, y uno aprobado después lo confirma', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const pagoId = pagoDelPedido(t, pedido, { estado: 'pending' });
  await avisoDePago(t, pagoId);
  assert.deepEqual(await estadoDe(pedido.id), { estado: 'nuevo', pago: pagoId, pagoEstado: 'pending' });
  const pendiente = sp((await pedirConHost(puerto, t.host, `/pedido/${pedido.token}`)).cuerpo);
  assert.ok(pendiente.includes('Tu pago está pendiente de acreditación'));
  assert.ok(!pendiente.includes('Pagar con Mercado Pago</button>'), 'no se ofrece pagar de nuevo mientras hay un pago pendiente');

  mp.cambiarEstado(pagoId, 'approved');
  await avisoDePago(t, pagoId);
  assert.equal((await estadoDe(pedido.id)).estado, 'pagado');

  // Rechazado primero y aprobado después (otro intento con otra tarjeta).
  const { pedido: segundo } = await comprar(t, { entrega: t.retiro });
  const rechazado = pagoDelPedido(t, segundo, { estado: 'rejected' });
  await avisoDePago(t, rechazado);
  assert.deepEqual(await estadoDe(segundo.id), { estado: 'nuevo', pago: rechazado, pagoEstado: 'rejected' });
  const aprobado = pagoDelPedido(t, segundo);
  await avisoDePago(t, aprobado);
  assert.deepEqual(await estadoDe(segundo.id), { estado: 'pagado', pago: aprobado, pagoEstado: 'approved' });
});

test('un pago que llega a un pedido cancelado no lo reabre: queda una nota para reembolsar (una sola vez); un segundo pago a un pedido ya pago, también', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  await cancelarPedido(db, t.tiendaId, pedido.id);
  const tarde = pagoDelPedido(t, pedido);
  for (let vez = 0; vez < 3; vez++) await avisoDePago(t, tarde);
  assert.equal((await estadoDe(pedido.id)).estado, 'cancelado');
  const notas = (await leerEventos(db, pedido.id)).filter((e) => e.titulo.startsWith('Llegó un pago de Mercado Pago a un pedido cancelado'));
  assert.equal(notas.length, 1, 'una sola nota aunque el aviso se repita');
  assert.equal(notas[0].visible, false, 'el comprador no la ve');
  assert.ok(notas[0].detalle.includes(`Pago #${tarde}`) && notas[0].detalle.includes('Reembolsalo'));

  const { pedido: otro } = await comprar(t, { entrega: t.retiro });
  const primero = pagoDelPedido(t, otro);
  await avisoDePago(t, primero);
  const segundo = pagoDelPedido(t, otro);
  await avisoDePago(t, segundo);
  await avisoDePago(t, segundo);
  assert.deepEqual(await estadoDe(otro.id), { estado: 'pagado', pago: primero, pagoEstado: 'approved' }, 'queda registrado el primero');
  const dobles = (await leerEventos(db, otro.id)).filter((e) => e.titulo === 'Mercado Pago informa otro pago para este pedido');
  assert.equal(dobles.length, 1);
  assert.equal(dobles[0].visible, false);
});

test('si Mercado Pago informa que el pago se devolvió, queda una nota interna y el pedido no cambia solo', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const pagoId = pagoDelPedido(t, pedido);
  await avisoDePago(t, pagoId);
  mp.cambiarEstado(pagoId, 'refunded');
  await avisoDePago(t, pagoId);
  await avisoDePago(t, pagoId);
  assert.deepEqual(await estadoDe(pedido.id), { estado: 'pagado', pago: pagoId, pagoEstado: 'refunded' });
  const notas = (await leerEventos(db, pedido.id)).filter((e) => e.titulo === 'Mercado Pago informa que el pago se devolvió');
  assert.equal(notas.length, 1);
  assert.equal(notas[0].visible, false);
});

test('un aviso que no se puede procesar (Mercado Pago caído) responde 500 para que Mercado Pago lo reintente', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const pagoId = pagoDelPedido(t, pedido);
  // Mercado Pago tira un error que no es "no existe": el aviso no se da por atendido.
  await db.prepare('UPDATE tienda_mercadopago SET access_token = ? WHERE tienda_id = ?').run(cifrar('APP_USR-token-que-ya-no-vale-123456', SECRETO), t.tiendaId);
  const rechazado = await avisoDePago(t, pagoId);
  assert.equal(rechazado.status, 500);
  assert.equal((await estadoDe(pedido.id)).estado, 'nuevo');
});

// ---------- Cuando vuelve el comprador y la verificación desde el panel ----------

test('cuando el comprador vuelve de Mercado Pago, su pedido se confirma al instante sin esperar el aviso; el número de pago que trae la URL solo dice qué mirar', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const pagoId = pagoDelPedido(t, pedido);
  const pagina = sp((await pedirConHost(puerto, t.host, `/pedido/${pedido.token}?mp=ok&payment_id=${pagoId}&status=approved&external_reference=lo-que-sea`)).cuerpo);
  assert.equal((await estadoDe(pedido.id)).estado, 'pagado');
  assert.ok(pagina.includes('Ya recibimos tu pago'));
  assert.ok(!pagina.includes('Pagar con Mercado Pago</button>'));

  // Sin el número de pago en la URL, se busca por la referencia del pedido.
  const { pedido: segundo } = await comprar(t, { entrega: t.retiro });
  pagoDelPedido(t, segundo);
  await pedirConHost(puerto, t.host, `/pedido/${segundo.token}?mp=ok`);
  assert.equal((await estadoDe(segundo.id)).estado, 'pagado');
  assert.ok(mp.llamadas('/v1/payments/search').length >= 1);

  // Una URL armada diciendo "aprobado" no confirma nada si Mercado Pago no tiene ese pago.
  const { pedido: tercero } = await comprar(t, { entrega: t.retiro });
  await pedirConHost(puerto, t.host, `/pedido/${tercero.token}?mp=ok&payment_id=999999999&status=approved`);
  assert.equal((await estadoDe(tercero.id)).estado, 'nuevo');
  // Tampoco con el número de pago de OTRO pedido: la referencia y el monto no coinciden.
  const deOtro = pagoDelPedido(t, pedido, { id: 55_001 });
  await pedirConHost(puerto, t.host, `/pedido/${tercero.token}?mp=ok&payment_id=${deOtro}`);
  assert.equal((await estadoDe(tercero.id)).estado, 'nuevo');
  // Sin el parámetro mp, abrir el pedido no le habla a Mercado Pago.
  const antes = mp.pedidos.length;
  await pedirConHost(puerto, t.host, `/pedido/${tercero.token}`);
  assert.equal(mp.pedidos.length, antes);
});

test('desde el panel, "Verificar pago" consulta a Mercado Pago, confirma el pedido y avisa qué pasó; sin pago informado, lo dice', async () => {
  const t = await tienda();
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const detalle = sp(await (await t.nav.pedir(`/admin/pedidos/${pedido.id}`)).text());
  assert.ok(detalle.includes('Verificar pago'));
  assert.ok(detalle.includes('El cliente paga en Mercado Pago desde su pedido'));

  await t.nav.enviar(`/admin/pedidos/${pedido.id}/verificar-mp`, {}, { desde: `/admin/pedidos/${pedido.id}` });
  assert.ok(sp(await (await t.nav.pedir(`/admin/pedidos/${pedido.id}`)).text()).includes('Mercado Pago todavía no informa ningún pago'));
  assert.equal((await estadoDe(pedido.id)).estado, 'nuevo');

  pagoDelPedido(t, pedido);
  const respuesta = await t.nav.enviar(`/admin/pedidos/${pedido.id}/verificar-mp`, {}, { desde: `/admin/pedidos/${pedido.id}` });
  assert.equal(respuesta.status, 302);
  assert.equal((await estadoDe(pedido.id)).estado, 'pagado');
  const despues = sp(await (await t.nav.pedir(`/admin/pedidos/${pedido.id}`)).text());
  assert.ok(despues.includes('Mercado Pago confirma el pago') && despues.includes('quedó como "Pagado"'));

  // Un pedido que no se paga con Mercado Pago no tiene qué verificar.
  const { pedido: otro } = await comprar(t, { entrega: t.retiro, pago: 'transferencia' });
  await t.nav.enviar(`/admin/pedidos/${otro.id}/verificar-mp`, {}, { desde: `/admin/pedidos/${otro.id}` });
  assert.ok(sp(await (await t.nav.pedir(`/admin/pedidos/${otro.id}`)).text()).includes('Este pedido no se paga con Mercado Pago'));
  assert.ok(!sp(await (await t.nav.pedir(`/admin/pedidos/${otro.id}`)).text()).includes('Verificar pago'));
});

test('sin la cuenta conectada, el detalle del pedido sigue como antes (link a mano y "marcar como pagado"), sin el botón de verificar', async () => {
  const t = await tienda({ conectada: false });
  const { pedido } = await comprar(t, { entrega: t.retiro });
  const detalle = sp(await (await t.nav.pedir(`/admin/pedidos/${pedido.id}`)).text());
  assert.ok(detalle.includes('Mandale al cliente el link de pago de Mercado Pago'));
  assert.ok(detalle.includes('Marcar como pagado'));
  assert.ok(!detalle.includes('Verificar pago'));
  // Otra tienda no puede verificar un pedido ajeno.
  const otra = await tienda();
  const ajeno = await otra.nav.enviar(`/admin/pedidos/${pedido.id}/verificar-mp`, {}, { desde: '/admin/pagos' });
  assert.equal(ajeno.status, 404);
});
