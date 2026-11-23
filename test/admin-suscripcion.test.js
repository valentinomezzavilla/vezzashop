// La suscripción desde el panel de un cliente que ya existe: contratar, completar un pago, cambiar de plan y cancelar.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, PLANES_SUGERIDOS, suspenderCliente } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { hoy, sumarDias } from '../src/util/fechas.js';
import { crearNavegador } from './ayudantes.js';
import { TOKEN_MP, crearMpFalso, crearN8nFalso } from './mercadopago-falso.js';

let mp;
let n8n;
let db;
let planes;
let servidor;
let navegador;
let puerto;
let tienda;

before(async () => {
  mp = crearMpFalso();
  n8n = crearN8nFalso();
  for (const falso of [mp, n8n]) {
    falso.servidor.listen(0, '127.0.0.1');
    await once(falso.servidor, 'listening');
    falso.puerto = falso.servidor.address().port;
  }
});

async function cerrar() {
  if (!servidor) return;
  servidor.closeAllConnections();
  servidor.close();
  servidor = null;
}

after(async () => {
  await cerrar();
  for (const falso of [mp, n8n]) {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
});

async function levantar({ pagos = true } = {}) {
  await cerrar();
  mp.suscripciones.clear();
  mp.cobros.clear();
  mp.pedidos.length = 0;
  mp.fallar = false;
  mp.contador = 0;
  n8n.recibidos.length = 0;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { prueba: await crear('Prueba'), esencial: await crear('Esencial'), acompanado: await crear('Acompañado'), medida: await crear('A medida') };
  ({ tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.prueba, venceEn: sumarDias(hoy(), 2), clave: 'clave-larguisima-1' }));
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    ...(pagos && {
      mercadopago: { accessToken: TOKEN_MP, webhookSecret: 'secreto-del-webhook', apiUrl: `http://127.0.0.1:${mp.puerto}` },
      n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' },
    }),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  navegador = crearNavegador(`http://127.0.0.1:${puerto}`);
  const ingreso = await navegador.enviar('/admin/ingresar', { email: 'luz@taller.com', clave: 'clave-larguisima-1' });
  assert.equal(ingreso.status, 302);
}

beforeEach(() => levantar());

const pagina = async (ruta = '/admin/suscripcion') => (await navegador.pedir(ruta)).text();
const pago = (accion, campos = {}) => navegador.enviar(`/admin/suscripcion/${accion}`, campos, { desde: '/admin/suscripcion' });
const ultimaMp = () => [...mp.suscripciones.keys()].at(-1);

test('sin cobro automático, la pantalla ofrece los planes que se contratan solos (no la prueba ni el A medida)', async () => {
  const html = await pagina();
  assert.match(html, /Sin cobro automático/);
  assert.match(html, /Suscribirme a Esencial/);
  assert.match(html, /Suscribirme a Acompañado/);
  assert.ok(!html.includes('Suscribirme a A medida'));
  assert.ok(!html.includes('Suscribirme a Prueba'));
});

test('contratar un plan lleva a Mercado Pago y, al volver autorizado, queda en ese plan', async () => {
  const r = await pago('iniciar', { plan: planes.esencial });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^https:\/\/www\.mercadopago\.test\/subscriptions\/checkout\?preapproval_id=mp1abc$/);
  const pedido = mp.pedidos.find((p) => p.ruta === '/preapproval').cuerpo;
  assert.equal(pedido.payer_email, 'luz@taller.com');
  assert.equal(pedido.back_url, `http://localhost:${puerto}/admin/suscripcion/volver`);

  // Cerró la ventana de pago sin terminar: la pantalla lo avisa y deja retomarlo.
  const sinTerminar = await pagina();
  assert.match(sinTerminar, /Tenés un pago sin terminar/);
  const retomar = await navegador.pedir('/admin/suscripcion/pagar');
  assert.equal(retomar.status, 302);
  assert.match(retomar.headers.get('location'), /preapproval_id=mp1abc$/);

  // Mercado Pago autoriza y el cliente vuelve.
  mp.autorizar('mp1abc');
  const vuelta = await navegador.pedir('/admin/suscripcion/volver');
  assert.equal(vuelta.status, 302);
  assert.equal(vuelta.headers.get('location'), '/admin/suscripcion');
  const html = await pagina();
  assert.match(html, /Tu suscripción al plan Esencial está activa/);
  const plano = html.replace(/\s+/g, ' '); // el precio lleva un espacio "duro" entre el $ y el número
  assert.ok(plano.includes('Esencial · $ 12.900,00 por mes'), 'muestra el plan y lo que se cobra');
  assert.ok(plano.includes('próximo cobro el 15/1/2030'));
  assert.equal((await db.prepare('SELECT plan_id AS "planId" FROM tiendas WHERE id = ?').get(tienda.id)).planId, planes.esencial);
  assert.equal(n8n.recibidos.length, 0, 'un cliente que ya existe no recibe el mail de "creá tu cuenta"');
});

test('cada cobro aprobado se ve en la lista de pagos y extiende el vencimiento', async () => {
  await pago('iniciar', { plan: planes.esencial });
  mp.autorizar('mp1abc');
  await navegador.pedir('/admin/suscripcion/volver');
  mp.cobrar('7001', 'mp1abc');
  const { procesarCobro } = await import('../src/suscripciones.js');
  await procesarCobro({ db, mp: (await import('../src/mercadopago.js')).crearClienteMp({ accessToken: TOKEN_MP, apiUrl: `http://127.0.0.1:${mp.puerto}` }), avisar: async () => true, secreto: 'x' }, '7001');
  const html = await pagina();
  assert.match(html, /Mercado Pago · cobro 7001/);
  assert.match(html, /1 mes/);
});

test('cambiar de plan crea otra suscripción y, al autorizarse, da de baja la anterior', async () => {
  await pago('iniciar', { plan: planes.esencial });
  mp.autorizar('mp1abc');
  await navegador.pedir('/admin/suscripcion/volver');
  assert.match(await pagina(), /Cambiar a Acompañado/);
  assert.ok(!(await pagina()).includes('Suscribirme a Esencial'));

  const igual = await pago('iniciar', { plan: planes.esencial });
  assert.equal(igual.status, 302);
  assert.equal(igual.headers.get('location'), '/admin/suscripcion', 'el mismo plan no se vuelve a contratar');
  assert.equal(mp.suscripciones.size, 1);

  const cambio = await pago('iniciar', { plan: planes.acompanado });
  assert.match(cambio.headers.get('location'), /preapproval_id=mp2abc$/);
  assert.equal(mp.suscripciones.get('mp1abc').status, 'authorized', 'hasta pagar el nuevo, el anterior sigue');
  mp.autorizar('mp2abc');
  await navegador.pedir('/admin/suscripcion/volver');
  assert.equal(mp.suscripciones.get('mp1abc').status, 'cancelled');
  assert.equal((await db.prepare('SELECT plan_id AS "planId" FROM tiendas WHERE id = ?').get(tienda.id)).planId, planes.acompanado);
});

test('cancelar da de baja el cobro automático y la tienda sigue abierta', async () => {
  await pago('iniciar', { plan: planes.esencial });
  mp.autorizar('mp1abc');
  await navegador.pedir('/admin/suscripcion/volver');
  const r = await pago('cancelar');
  assert.equal(r.status, 302);
  assert.equal(mp.suscripciones.get('mp1abc').status, 'cancelled');
  const html = await pagina();
  assert.match(html, /Cancelaste el débito automático/);
  assert.match(html, /No se te cobran más meses/);
  assert.match(html, /Suscribirme a Esencial/, 'puede volver a suscribirse');
  const otra = await pago('cancelar');
  assert.equal(otra.status, 302);
  assert.match(await pagina(), /No hay una suscripción activa para cancelar/);
});

test('si Mercado Pago no responde, se avisa y no se pierde nada', async () => {
  mp.fallar = true;
  const r = await pago('iniciar', { plan: planes.esencial });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin/suscripcion');
  assert.match(await pagina(), /No pudimos conectarnos con Mercado Pago/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM suscripciones').get()).n, 0);
});

test('la prueba gratis no se puede "contratar" desde el panel, y un plan que no existe tampoco', async () => {
  for (const plan of [planes.prueba, planes.medida, 99999, 'abc']) {
    const r = await pago('iniciar', { plan });
    assert.equal(r.headers.get('location'), '/admin/suscripcion', `plan=${plan}`);
    await pagina(); // consume el aviso
  }
  assert.equal(mp.pedidos.length, 0);
});

test('una tienda suspendida puede pagar su suscripción aunque el resto del panel esté en solo lectura', async () => {
  await suspenderCliente(db, tienda.id, 'Falta de pago');
  const r = await pago('iniciar', { plan: planes.esencial });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /mercadopago\.test/);
});

test('sin los pagos configurados, la pantalla lo explica y no hace nada', async () => {
  await levantar({ pagos: false });
  const html = await pagina();
  assert.match(html, /Por ahora los pagos se coordinan con nosotros/);
  assert.ok(!html.includes('Suscribirme a'));
  const r = await pago('iniciar', { plan: planes.esencial });
  assert.equal(r.headers.get('location'), '/admin/suscripcion');
  assert.match(await pagina(), /Los pagos en línea no están disponibles/);
});

test('Cuenta enlaza a la suscripción solo cuando hay pagos en línea', async () => {
  assert.match(await pagina('/admin/cuenta'), /href="\/admin\/suscripcion"/);
  await levantar({ pagos: false });
  assert.ok(!(await pagina('/admin/cuenta')).includes('/admin/suscripcion'));
});

test('hace falta haber ingresado', async () => {
  const anonimo = crearNavegador(`http://127.0.0.1:${puerto}`);
  const r = await anonimo.pedir('/admin/suscripcion');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/admin/ingresar');
});
