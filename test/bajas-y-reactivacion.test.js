// Dar de baja la suscripción: el aviso dice hasta cuándo sigue activa la tienda (en pantalla y por mail), y se puede reactivar sin cobrar de más.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { crearClienteMp } from '../src/mercadopago.js';
import { crearNotificador } from '../src/notificaciones.js';
import { inicioDeReactivacion, sincronizarSuscripcion, cancelarSuscripcionDeTienda, estadoDeSuscripcion } from '../src/suscripciones.js';
import { formatearDiaLargo, hoy, sumarDias } from '../src/util/fechas.js';
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
let servicios;

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

beforeEach(async () => {
  await cerrar();
  mp.suscripciones.clear();
  mp.cobros.clear();
  mp.pedidos.length = 0;
  mp.fallar = false;
  mp.contador = 0;
  mp.rechazarMonto.clear();
  n8n.recibidos.length = 0;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { prueba: await crear('Prueba'), esencial: await crear('Esencial'), acompanado: await crear('Acompañado') };
  ({ tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.esencial, venceEn: sumarDias(hoy(), 15), clave: 'clave-larguisima-1' }));
  await db.prepare('UPDATE usuarios SET nombre = ?, apellido = ? WHERE tienda_id = ?').run('Luz', 'Díaz', tienda.id);
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    mercadopago: { accessToken: TOKEN_MP, webhookSecret: 'secreto-del-webhook', apiUrl: `http://127.0.0.1:${mp.puerto}` },
    n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  navegador = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await navegador.enviar('/admin/ingresar', { email: 'luz@taller.com', clave: 'clave-larguisima-1' })).status, 302);
  servicios = { db, mp: crearClienteMp({ accessToken: TOKEN_MP, apiUrl: `http://127.0.0.1:${mp.puerto}` }), avisar: crearNotificador(config.n8n), secreto: config.secretoSesion };
});

const pagina = async (ruta = '/admin/suscripcion') => (await navegador.pedir(ruta)).text();
const pago = (accion, campos = {}) => navegador.enviar(`/admin/suscripcion/${accion}`, campos, { desde: '/admin/suscripcion' });
const avisosDe = (evento) => n8n.recibidos.filter((r) => r.cuerpo.evento === evento).map((r) => r.cuerpo);
const vencimiento = async (dia) => db.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(dia, tienda.id);

// Contrata el plan desde el panel y deja la suscripción autorizada (mp1abc).
async function suscribir(plan = planes.esencial) {
  await pago('iniciar', { plan });
  const id = [...mp.suscripciones.keys()].at(-1);
  mp.autorizar(id);
  await navegador.pedir('/admin/suscripcion/volver');
  await pagina(); // consume el aviso
  return id;
}

test('cancelar dice hasta cuándo sigue activa la tienda y manda un solo mail con esa fecha', async () => {
  await suscribir();
  const hasta = sumarDias(hoy(), 15);
  await pago('cancelar');
  const html = await pagina();
  assert.match(html, /Cancelaste la suscripción: no se te cobran más meses\./);
  assert.match(html, new RegExp(`Tu tienda sigue activa hasta el ${formatearDiaLargo(hasta)} \\(lo que ya pagaste\\)`));
  assert.match(html, /Podés reactivarla cuando quieras/);

  const avisos = avisosDe('suscripcion_cancelada');
  assert.equal(avisos.length, 1);
  assert.deepEqual(avisos[0], {
    evento: 'suscripcion_cancelada',
    email: 'luz@taller.com',
    nombre: 'Luz',
    apellido: 'Díaz',
    tienda: { nombre: 'Taller Luz' },
    plan: { nombre: 'Esencial' },
    accesoHasta: hasta,
    accesoHastaTexto: formatearDiaLargo(hasta),
    vencida: false,
    urlReactivar: `http://localhost:${puerto}/admin/suscripcion`,
  });
  assert.equal(n8n.recibidos[0].secreto, 'secreto-de-n8n');

  // Otro aviso de Mercado Pago sobre la misma baja (o repetir el botón) no manda otro mail.
  await sincronizarSuscripcion(servicios, 'mp1abc', { urlBase: `http://localhost:${puerto}` });
  await pago('cancelar');
  assert.equal(avisosDe('suscripcion_cancelada').length, 1);
});

test('cancelar con el vencimiento ya pasado no promete días: el mail dice que ya venció', async () => {
  await suscribir();
  await vencimiento(sumarDias(hoy(), -3));
  await pago('cancelar');
  const html = await pagina();
  assert.match(html, /Cancelaste la suscripción: no se te cobran más meses\. Podés reactivarla cuando quieras/);
  assert.doesNotMatch(html, /Tu tienda sigue activa hasta/);
  const [aviso] = avisosDe('suscripcion_cancelada');
  assert.equal(aviso.vencida, true);
  assert.equal(aviso.accesoHasta, null);
  assert.equal(aviso.accesoHastaTexto, '');
});

test('el ejemplo del pedido: paga el 25, cancela el 10 y sigue activa hasta el 25', async () => {
  await suscribir();
  // Último pago el 25 de octubre (vence el 25 de noviembre); cancela el 10 de noviembre.
  await vencimiento('2099-11-25');
  const r = await cancelarSuscripcionDeTienda(servicios, tienda.id, { urlBase: 'https://tiendas.vezzadev.com' });
  assert.equal(r.venceEn, '2099-11-25');
  const [aviso] = avisosDe('suscripcion_cancelada');
  assert.equal(aviso.accesoHastaTexto, '25 de noviembre de 2099');
  assert.equal(aviso.urlReactivar, 'https://tiendas.vezzadev.com/admin/suscripcion');
});

test('si la baja la hace el cliente desde su cuenta de Mercado Pago, también se le avisa (una vez)', async () => {
  const id = await suscribir();
  mp.suscripciones.get(id).status = 'cancelled';
  await sincronizarSuscripcion(servicios, id, { urlBase: `http://localhost:${puerto}` });
  const [aviso] = avisosDe('suscripcion_cancelada');
  assert.equal(avisosDe('suscripcion_cancelada').length, 1);
  assert.equal(aviso.accesoHasta, sumarDias(hoy(), 15));
  assert.equal((await db.prepare('SELECT estado FROM suscripciones WHERE mp_id = ?').get(id)).estado, 'cancelada');
  await sincronizarSuscripcion(servicios, id, { urlBase: `http://localhost:${puerto}` });
  assert.equal(avisosDe('suscripcion_cancelada').length, 1);
  assert.match(await pagina(), /Tu tienda sigue activa hasta el/);
});

test('una suscripción que nunca se autorizó y se cancela no manda ningún aviso de baja', async () => {
  await pago('iniciar', { plan: planes.acompanado });
  const id = [...mp.suscripciones.keys()].at(-1);
  mp.suscripciones.get(id).status = 'cancelled';
  await sincronizarSuscripcion(servicios, id, { urlBase: `http://localhost:${puerto}` });
  assert.equal(avisosDe('suscripcion_cancelada').length, 0);
});

test('cambiar de plan da de baja la anterior pero no manda el aviso de cancelación', async () => {
  await suscribir(planes.esencial);
  await suscribir(planes.acompanado);
  assert.equal(mp.suscripciones.get('mp1abc').status, 'cancelled');
  // Llega el aviso de Mercado Pago por la baja de la anterior.
  await sincronizarSuscripcion(servicios, 'mp1abc', { urlBase: `http://localhost:${puerto}` });
  assert.equal(avisosDe('suscripcion_cancelada').length, 0);
});

test('sin n8n configurado, cancelar anda igual y el mail simplemente no sale', async () => {
  await suscribir();
  const sinN8n = { ...servicios, avisar: crearNotificador(null) };
  const r = await cancelarSuscripcionDeTienda(sinN8n, tienda.id, { urlBase: `http://localhost:${puerto}` });
  assert.ok(r.suscripcion);
  assert.equal(n8n.recibidos.length, 0);
});

test('reactivar con días pagos: el primer cobro es el día del vencimiento (no se cobra de más)', async () => {
  await suscribir();
  await pago('cancelar');
  const hasta = sumarDias(hoy(), 15);
  assert.equal(await inicioDeReactivacion(db, tienda.id), hasta);

  const pantalla = await pagina();
  assert.match(pantalla, /Reactivar tu suscripción/);
  assert.match(pantalla, /Volver al plan Esencial/);
  assert.match(pantalla, new RegExp(`No se te cobra ahora: el primer cobro es el <strong>${formatearDiaLargo(hasta)}</strong>`));

  const r = await pago('iniciar', { plan: planes.esencial });
  assert.match(r.headers.get('location'), /preapproval_id=mp2abc$/);
  const pedido = mp.pedidos.filter((p) => p.ruta === '/preapproval').at(-1).cuerpo;
  assert.equal(pedido.auto_recurring.start_date, `${hasta}T12:00:00.000-03:00`);
  assert.equal(pedido.auto_recurring.transaction_amount, 12900);

  mp.autorizar('mp2abc');
  await navegador.pedir('/admin/suscripcion/volver');
  const despues = await pagina();
  assert.match(despues, new RegExp(`próximo cobro el ${hasta.split('-').map(Number).reverse().join('/')}`));
  const { activa } = await estadoDeSuscripcion(db, tienda.id);
  assert.equal(activa.proximoCobro, hasta);
  assert.equal((await db.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tienda.id)).venceEn, hasta, 'reactivar no cambia el vencimiento ya pago');
});

test('reactivar cuando ya venció cobra apenas se autoriza (sin fecha de inicio)', async () => {
  await suscribir();
  await vencimiento(sumarDias(hoy(), -2));
  await pago('cancelar');
  assert.equal(await inicioDeReactivacion(db, tienda.id), null);
  const pantalla = await pagina();
  assert.match(pantalla, /Se te cobra apenas autorices el pago en Mercado Pago/);
  await pago('iniciar', { plan: planes.esencial });
  const pedido = mp.pedidos.filter((p) => p.ruta === '/preapproval').at(-1).cuerpo;
  assert.equal(pedido.auto_recurring.start_date, undefined);
});

test('un cambio de plan o una primera suscripción no usan fecha de inicio', async () => {
  // Primera suscripción de un cliente que nunca tuvo una (aunque le queden días): cobra de entrada, como siempre.
  assert.equal(await inicioDeReactivacion(db, tienda.id), null);
  await pago('iniciar', { plan: planes.acompanado });
  assert.equal(mp.pedidos.find((p) => p.ruta === '/preapproval').cuerpo.auto_recurring.start_date, undefined);
  mp.autorizar('mp1abc');
  await navegador.pedir('/admin/suscripcion/volver');
  await pagina();
  // Cambio de plan con una suscripción activa: la nueva cobra de entrada.
  await pago('iniciar', { plan: planes.esencial });
  assert.equal(mp.pedidos.filter((p) => p.ruta === '/preapproval').at(-1).cuerpo.auto_recurring.start_date, undefined);
});

test('el Inicio avisa que la suscripción está cancelada mientras dura el acceso, en vez de "acordate de abonarlo"', async () => {
  await suscribir();
  await vencimiento(sumarDias(hoy(), 3)); // por vencer
  assert.match(await pagina('/admin/inicio'), /Tu plan vence el/, 'con la suscripción activa, el aviso de siempre');
  await pago('cancelar');
  const inicio = await pagina('/admin/inicio');
  assert.match(inicio, /Cancelaste tu suscripción\./);
  assert.match(inicio, new RegExp(`Tu tienda sigue activa hasta el ${formatearDiaLargo(sumarDias(hoy(), 3))}`));
  assert.match(inicio, /<a href="\/admin\/suscripcion">Reactivar mi suscripción<\/a>/);
  assert.doesNotMatch(inicio, /acordate de abonarlo/);
  // Ya vencida, vuelve el aviso de vencimiento.
  await vencimiento(sumarDias(hoy(), -1));
  const vencida = await pagina('/admin/inicio');
  assert.match(vencida, /Tu plan venció el/);
  assert.doesNotMatch(vencida, /Cancelaste tu suscripción\./);
});
