// Suscripciones a los planes con Mercado Pago: con un Mercado Pago y un n8n de mentira (servidores locales del propio test).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearClienteMp, verificarFirma } from '../src/mercadopago.js';
import { crearNotificador } from '../src/notificaciones.js';
import { crearPlan, PLANES_SUGERIDOS, registrarPago } from '../src/plataforma.js';
import { autenticar, crearTienda } from '../src/tiendas.js';
import {
  iniciarSuscripcion,
  sincronizarSuscripcion,
  procesarCobro,
  crearCuentaDeSuscripcion,
  cancelarSuscripcionDeTienda,
  tokenDeAlta,
  idDeToken,
  leerSuscripcion,
  DIAS_DE_GRACIA_ALTA,
} from '../src/suscripciones.js';
import { hoy, sumarDias, sumarMeses } from '../src/util/fechas.js';
import { TOKEN_MP, crearMpFalso, crearN8nFalso } from './mercadopago-falso.js';

const SECRETO_WEBHOOK = 'secreto-del-webhook';
const SECRETO_N8N = 'secreto-de-n8n';
const SECRETO = 'secreto-de-prueba-de-al-menos-32-caracteres';
const URL_BASE = 'https://vezzashop.test';

let mp;
let n8n;
let db;
let servicios;
let planes; // { prueba, esencial, medida }

before(async () => {
  mp = crearMpFalso();
  n8n = crearN8nFalso();
  for (const falso of [mp, n8n]) {
    falso.servidor.listen(0, '127.0.0.1');
    await once(falso.servidor, 'listening');
    falso.puerto = falso.servidor.address().port;
  }
});

after(() => {
  for (const falso of [mp, n8n]) {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
});

beforeEach(async () => {
  mp.suscripciones.clear();
  mp.cobros.clear();
  mp.pedidos.length = 0;
  mp.fallar = false;
  mp.rechazarCancelled = false;
  mp.contador = 0;
  n8n.recibidos.length = 0;
  n8n.fallar = false;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { prueba: await crear('Prueba'), esencial: await crear('Esencial'), medida: await crear('A medida') };
  servicios = {
    db,
    mp: crearClienteMp({ accessToken: TOKEN_MP, apiUrl: `http://127.0.0.1:${mp.puerto}` }),
    avisar: crearNotificador({ url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: SECRETO_N8N }),
    secreto: SECRETO,
  };
});

const FORMULARIO = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@correo.com', clave: 'una-clave-larga-1', claveRepetida: 'una-clave-larga-1', nombreTienda: 'Casa Ana', slug: '' };
const vueltaDe = (token) => `${URL_BASE}/suscribirse/volver?t=${token}`;

// Empieza una suscripción pagando el plan Esencial. Devuelve { id, token, mpId }.
async function suscribirse(plan = planes.esencial, email = 'ana@correo.com') {
  const r = await iniciarSuscripcion(servicios, { planId: plan, email, urlVuelta: vueltaDe });
  assert.equal(r.error, undefined);
  return { id: r.suscripcionId, token: r.token, mpId: [...mp.suscripciones.keys()].at(-1), initPoint: r.initPoint };
}

// Suscripción ya autorizada en Mercado Pago y sincronizada.
async function suscripcionPaga() {
  const s = await suscribirse();
  mp.autorizar(s.mpId);
  await sincronizarSuscripcion(servicios, s.mpId, { urlBase: URL_BASE });
  return s;
}

const esperar = async (condicion) => {
  for (let i = 0; i < 100 && !condicion(); i++) await new Promise((r) => setTimeout(r, 20));
};

// ---------- La firma de los avisos ----------

const firma = (secreto, manifiesto, ts = '1700000000') => `ts=${ts},v1=${createHmac('sha256', secreto).update(manifiesto.replace('TS', ts)).digest('hex')}`;

test('verificarFirma acepta la firma de Mercado Pago y rechaza todo lo demás', () => {
  const base = { xRequestId: 'req-1', dataId: 'ABC123', secreto: SECRETO_WEBHOOK };
  const buena = firma(SECRETO_WEBHOOK, 'id:abc123;request-id:req-1;ts:TS;'); // el id alfanumérico se firma en minúsculas
  assert.equal(verificarFirma({ ...base, xSignature: buena }), true);
  assert.equal(verificarFirma({ ...base, xSignature: buena, dataId: 'otro' }), false, 'otro id');
  assert.equal(verificarFirma({ ...base, xSignature: buena, xRequestId: 'req-2' }), false, 'otro request');
  assert.equal(verificarFirma({ ...base, xSignature: buena, secreto: 'otro-secreto' }), false, 'otro secreto');
  assert.equal(verificarFirma({ ...base, xSignature: buena.replace('ts=1700000000', 'ts=1700000001') }), false, 'otro ts');
  assert.equal(verificarFirma({ ...base, xSignature: undefined }), false);
  assert.equal(verificarFirma({ ...base, xSignature: 'basura' }), false);
  assert.equal(verificarFirma({ ...base, xSignature: 'ts=1,v1=' }), false);
  assert.equal(verificarFirma({ ...base, xSignature: buena, secreto: '' }), false, 'sin secreto configurado nada es válido');
  // Lo que falta en el aviso se omite del texto firmado.
  assert.equal(verificarFirma({ xSignature: firma(SECRETO_WEBHOOK, 'ts:TS;'), secreto: SECRETO_WEBHOOK }), true);
});

test('el token del link de alta se arma con el secreto y no se puede falsificar', () => {
  const token = tokenDeAlta(SECRETO, 42);
  assert.equal(idDeToken(SECRETO, token), 42);
  assert.equal(idDeToken('otro-secreto-de-al-menos-32-caracteres', token), null);
  assert.equal(idDeToken(SECRETO, token.replace(/^42/, '43')), null);
  assert.equal(idDeToken(SECRETO, '42'), null);
  assert.equal(idDeToken(SECRETO, undefined), null);
  assert.equal(idDeToken(SECRETO, `42.${'a'.repeat(32)}`), null);
});

// ---------- Paso 1: elegir plan ----------

test('iniciarSuscripcion crea la suscripción en Mercado Pago con el precio del plan y devuelve el link de pago', async () => {
  const s = await suscribirse();
  assert.match(s.initPoint, /checkout\?preapproval_id=mp1abc$/);
  const pedido = mp.pedidos.find((p) => p.ruta === '/preapproval');
  assert.equal(pedido.autorizacion, `Bearer ${TOKEN_MP}`);
  assert.deepEqual(pedido.cuerpo, {
    reason: 'VEZZA Shop · Plan Esencial',
    external_reference: String(s.id),
    payer_email: 'ana@correo.com',
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 12900, currency_id: 'ARS' },
    back_url: vueltaDe(s.token),
    status: 'pending',
  });
  const fila = await leerSuscripcion(db, s.id);
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.tiendaId, null);
  assert.equal(fila.mpId, 'mp1abc');
  assert.equal(fila.montoCentavos, 1_290_000);
});

test('iniciarSuscripcion rechaza planes que no se contratan solos, emails inválidos o ya registrados', async () => {
  const intentar = (datos) => iniciarSuscripcion(servicios, { email: 'ana@correo.com', urlVuelta: vueltaDe, ...datos });
  assert.equal((await intentar({ planId: planes.medida })).campo, 'plan', 'A medida se consulta');
  assert.equal((await intentar({ planId: 99999 })).campo, 'plan');
  const interno = await crearPlan(db, { nombre: 'Interno', precioCentavos: 0, maxProductos: 5, maxFotos: 1, maxBanners: 0, activo: true });
  assert.equal((await intentar({ planId: interno })).campo, 'plan', 'un plan gratis y sin prueba es interno');
  const pausado = await crearPlan(db, { nombre: 'Pausado', precioCentavos: 100_000, maxProductos: 5, maxFotos: 1, maxBanners: 0, activo: false });
  assert.equal((await intentar({ planId: pausado })).campo, 'plan');
  assert.equal((await intentar({ planId: planes.esencial, email: 'esto no es un mail' })).campo, 'email');
  await crearTienda(db, { nombre: 'Ya Existe', email: 'ya@existe.com' });
  assert.equal((await intentar({ planId: planes.esencial, email: 'YA@existe.com' })).campo, 'email');
  assert.equal(mp.pedidos.length, 0, 'nada de eso llega a Mercado Pago');
});

test('si Mercado Pago falla al crear la suscripción no queda ninguna fila colgada', async () => {
  mp.fallar = true;
  await assert.rejects(iniciarSuscripcion(servicios, { planId: planes.esencial, email: 'ana@correo.com', urlVuelta: vueltaDe }));
  assert.equal((await db.prepare('SELECT count(*) AS n FROM suscripciones').get()).n, 0);
});

test('el plan de prueba gratis no pasa por Mercado Pago y abre el formulario directo', async () => {
  const r = await iniciarSuscripcion(servicios, { planId: planes.prueba, email: 'ana@correo.com', urlVuelta: vueltaDe });
  assert.equal(r.initPoint, null);
  assert.equal(mp.pedidos.length, 0);
  assert.equal((await leerSuscripcion(db, r.suscripcionId)).estado, 'prueba');

  const cuenta = await crearCuentaDeSuscripcion(servicios, r.token, FORMULARIO);
  assert.equal(cuenta.errores, undefined);
  const { venceEn, planId } = await db.prepare('SELECT vence_en AS "venceEn", plan_id AS "planId" FROM tiendas WHERE id = ?').get(cuenta.tienda.id);
  assert.equal(venceEn, sumarDias(hoy(), 7));
  assert.equal(planId, planes.prueba);
});

// ---------- Mercado Pago autoriza ----------

test('mientras Mercado Pago no autorice, el formulario de cuenta sigue cerrado', async () => {
  const s = await suscribirse();
  await sincronizarSuscripcion(servicios, s.mpId, { urlBase: URL_BASE });
  assert.equal((await leerSuscripcion(db, s.id)).estado, 'pendiente');
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO), { error: 'pendiente' });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM tiendas').get()).n, 0, 'no se creó ninguna tienda');
  assert.equal(n8n.recibidos.length, 0);
});

test('al autorizarse se manda por n8n el link para crear la cuenta, una sola vez', async () => {
  const s = await suscripcionPaga();
  await sincronizarSuscripcion(servicios, s.mpId, { urlBase: URL_BASE }); // un segundo aviso de lo mismo
  assert.equal(n8n.recibidos.length, 1);
  const { cuerpo, secreto } = n8n.recibidos[0];
  assert.equal(secreto, SECRETO_N8N);
  assert.deepEqual(cuerpo, {
    evento: 'pago_recibido',
    email: 'ana@correo.com',
    plan: { nombre: 'Esencial', precio: cuerpo.plan.precio },
    urlCuenta: `${URL_BASE}/suscribirse/cuenta?t=${s.token}`,
  });
  assert.match(cuerpo.plan.precio.replace(/\s/g, ' '), /12\.900/);
  assert.equal((await leerSuscripcion(db, s.id)).estado, 'autorizada');
  assert.equal((await leerSuscripcion(db, s.id)).proximoCobro, '2030-01-15');
});

test('si n8n está caído el pago igual se registra y el alta sigue andando', async () => {
  n8n.fallar = true;
  const s = await suscripcionPaga();
  assert.equal((await leerSuscripcion(db, s.id)).estado, 'autorizada');
  assert.equal((await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO)).errores, undefined);
});

test('un aviso viejo de "pendiente" no hace retroceder a una suscripción ya autorizada', async () => {
  const s = await suscripcionPaga();
  mp.suscripciones.get(s.mpId).status = 'pending';
  await sincronizarSuscripcion(servicios, s.mpId, { urlBase: URL_BASE });
  assert.equal((await leerSuscripcion(db, s.id)).estado, 'autorizada');
});

test('una suscripción que no es nuestra se ignora', async () => {
  assert.equal(await sincronizarSuscripcion(servicios, 'desconocida', { urlBase: URL_BASE }), null);
});

// ---------- Paso 5: crear la cuenta ----------

test('con la suscripción autorizada, el formulario crea la tienda y el usuario con la clave elegida', async () => {
  const s = await suscripcionPaga();
  const r = await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO);
  assert.equal(r.errores, undefined);
  assert.equal(r.tienda.slug, 'casa-ana');

  const tienda = await db.prepare('SELECT plan_id AS "planId", vence_en AS "venceEn", estado FROM tiendas WHERE id = ?').get(r.tienda.id);
  assert.equal(tienda.planId, planes.esencial);
  assert.equal(tienda.estado, 'activa');
  assert.equal(tienda.venceEn, sumarDias(hoy(), DIAS_DE_GRACIA_ALTA), 'abierta unos días hasta que llegue el primer cobro');
  const usuario = await db.prepare('SELECT nombre, apellido, email FROM usuarios WHERE tienda_id = ?').get(r.tienda.id);
  assert.deepEqual({ ...usuario }, { nombre: 'Ana', apellido: 'Pérez', email: 'ana@correo.com' });
  assert.ok(await autenticar(db, 'ana@correo.com', 'una-clave-larga-1'), 'puede ingresar con la clave que eligió');
  assert.equal((await leerSuscripcion(db, s.id)).tiendaId, r.tienda.id);
});

test('el link del formulario se usa una sola vez, aunque lleguen dos envíos juntos', async () => {
  const s = await suscripcionPaga();
  const [a, b] = await Promise.all([crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO), crearCuentaDeSuscripcion(servicios, s.token, { ...FORMULARIO, email: 'otra@correo.com', nombreTienda: 'Otra' })]);
  assert.equal([a, b].filter((r) => r.tienda).length, 1, 'se creó una sola cuenta');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM tiendas').get()).n, 1);
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO), { error: 'usado' });
});

test('el formulario valida los datos y no gasta el link si hay errores', async () => {
  const s = await suscripcionPaga();
  const intentar = (cambios) => crearCuentaDeSuscripcion(servicios, s.token, { ...FORMULARIO, ...cambios });
  assert.ok((await intentar({ nombre: '' })).errores.nombre);
  assert.ok((await intentar({ apellido: ' ' })).errores.apellido);
  assert.ok((await intentar({ email: 'sin-arroba' })).errores.email);
  assert.ok((await intentar({ clave: 'corta', claveRepetida: 'corta' })).errores.clave);
  assert.ok((await intentar({ claveRepetida: 'distinta-distinta' })).errores.claveRepetida);
  assert.ok((await intentar({ nombreTienda: '' })).errores.nombreTienda);
  assert.ok((await intentar({ nombreTienda: 'Panel' })).errores.nombreTienda, 'un nombre reservado no sirve de link');
  assert.ok((await intentar({ slug: 'admin' })).errores.slug);
  await crearTienda(db, { nombre: 'Casa Ana', email: 'otro@correo.com' });
  assert.ok((await intentar({})).errores.nombreTienda, 'el link ya lo usa otra tienda');
  await crearTienda(db, { nombre: 'Y Esta', email: 'ana@correo.com' });
  assert.ok((await intentar({ nombreTienda: 'Casa Nueva' })).errores.email, 'el email ya tiene cuenta');
  const bien = await intentar({ nombreTienda: 'Casa Nueva', email: 'nueva@correo.com' });
  assert.ok(bien.tienda, 'después de tantos errores, el link seguía sirviendo');
});

test('un link inventado, vencido o de un pago cancelado no abre el formulario', async () => {
  const s = await suscripcionPaga();
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, 'cualquier-cosa', FORMULARIO), { error: 'invalido' });
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, tokenDeAlta(SECRETO, 9999), FORMULARIO), { error: 'invalido' });

  await db.prepare("UPDATE suscripciones SET creada_en = to_char(now() AT TIME ZONE 'UTC' - interval '15 days', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(s.id);
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO), { error: 'vencido' });

  await db.prepare('UPDATE suscripciones SET enlace_renovado_en = ahora() WHERE id = ?').run(s.id); // el superadmin lo reenvió
  await db.prepare("UPDATE suscripciones SET estado = 'cancelada' WHERE id = ?").run(s.id);
  assert.deepEqual(await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO), { error: 'sin-pago' });
});

// ---------- Cobros ----------

test('un cobro aprobado suma un mes pagado, y el mismo cobro avisado dos veces cuenta una sola vez', async () => {
  const s = await suscripcionPaga();
  const { tienda } = await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO);
  const vencimiento = async () => (await db.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tienda.id)).venceEn;
  const grace = await vencimiento();

  mp.cobrar('1001', s.mpId);
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { aplicado: true });
  assert.equal(await vencimiento(), sumarMeses(grace, 1));
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { repetido: true });
  assert.equal(await vencimiento(), sumarMeses(grace, 1), 'el repetido no suma otro mes');

  const pagos = await db.prepare('SELECT monto_centavos AS monto, meses, nota FROM pagos_plataforma WHERE tienda_id = ?').all(tienda.id);
  assert.equal(pagos.length, 1);
  assert.deepEqual({ ...pagos[0] }, { monto: 1_290_000, meses: 1, nota: 'Mercado Pago · cobro 1001' });

  mp.cobrar('1002', s.mpId);
  await procesarCobro(servicios, '1002', { urlBase: URL_BASE });
  assert.equal(await vencimiento(), sumarMeses(grace, 2), 'el mes siguiente suma otro');
});

test('un cobro rechazado no suma nada', async () => {
  const s = await suscripcionPaga();
  const { tienda } = await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO);
  mp.cobrar('1001', s.mpId, { aprobado: false });
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { aprobado: false });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM pagos_plataforma WHERE tienda_id = ?').get(tienda.id)).n, 0);
});

test('un cobro que llega antes de crear la cuenta se guarda y se aplica al crearla', async () => {
  const s = await suscripcionPaga();
  mp.cobrar('1001', s.mpId);
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { aplicado: false });

  const { tienda } = await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO);
  const { venceEn } = await db.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tienda.id);
  assert.equal(venceEn, sumarMeses(hoy(), 1), 'un mes pago, sin los días de gracia');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM pagos_plataforma WHERE tienda_id = ?').get(tienda.id)).n, 1);
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { repetido: true });
});

test('un cobro de una suscripción desconocida se ignora', async () => {
  mp.cobrar('1001', 'otra-suscripcion');
  assert.deepEqual(await procesarCobro(servicios, '1001', { urlBase: URL_BASE }), { ignorado: true });
});

// ---------- Cancelar y cambiar de plan (clientes que ya existen) ----------

async function clienteConSuscripcion() {
  const { tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.prueba, venceEn: sumarDias(hoy(), 3) });
  const r = await iniciarSuscripcion(servicios, { planId: planes.esencial, email: 'luz@taller.com', tiendaId: tienda.id, urlVuelta: `${URL_BASE}/admin/suscripcion/volver` });
  assert.equal(r.error, undefined);
  const mpId = [...mp.suscripciones.keys()].at(-1);
  mp.autorizar(mpId);
  await sincronizarSuscripcion(servicios, mpId, { urlBase: URL_BASE });
  return { tienda, mpId, id: r.suscripcionId };
}

test('un cliente que ya existe pasa al plan al autorizarse, sin mail de "creá tu cuenta"', async () => {
  const { tienda } = await clienteConSuscripcion();
  assert.equal((await db.prepare('SELECT plan_id AS "planId" FROM tiendas WHERE id = ?').get(tienda.id)).planId, planes.esencial);
  assert.equal(n8n.recibidos.length, 0);
});

test('cancelar da de baja en Mercado Pago pero la tienda sigue abierta hasta el vencimiento ya pago', async () => {
  const { tienda, mpId, id } = await clienteConSuscripcion();
  await registrarPago(db, tienda.id, { meses: 1, monto: '12900', nota: '' });
  const antes = (await db.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tienda.id)).venceEn;

  const r = await cancelarSuscripcionDeTienda(servicios, tienda.id);
  assert.equal(r.error, undefined);
  assert.equal(mp.suscripciones.get(mpId).status, 'cancelled');
  assert.equal((await leerSuscripcion(db, id)).estado, 'cancelada');
  assert.equal((await db.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tienda.id)).venceEn, antes);
  assert.ok((await cancelarSuscripcionDeTienda(servicios, tienda.id)).error, 'ya no hay nada que cancelar');
});

test('si Mercado Pago no acepta "cancelled", la baja se prueba con "canceled"', async () => {
  const { tienda, mpId } = await clienteConSuscripcion();
  mp.rechazarCancelled = true;
  await cancelarSuscripcionDeTienda(servicios, tienda.id);
  assert.equal(mp.suscripciones.get(mpId).status, 'canceled');
});

test('al cambiar de plan se cancela la suscripción anterior para no cobrar dos veces', async () => {
  const anterior = await clienteConSuscripcion();
  const otro = await crearPlan(db, { nombre: 'Acompañado', precioCentavos: 3_490_000, maxProductos: 1000, maxFotos: 8, maxBanners: 4, activo: true });
  const r = await iniciarSuscripcion(servicios, { planId: otro, email: 'luz@taller.com', tiendaId: anterior.tienda.id, reemplazaAId: anterior.id, urlVuelta: `${URL_BASE}/admin/suscripcion/volver` });
  assert.equal(r.error, undefined);
  const nuevaMp = [...mp.suscripciones.keys()].at(-1);
  assert.equal(mp.suscripciones.get(nuevaMp).auto_recurring.transaction_amount, 34900);

  assert.equal((await leerSuscripcion(db, anterior.id)).estado, 'autorizada', 'hasta que no se autoriza la nueva, la vieja sigue');
  mp.autorizar(nuevaMp);
  await sincronizarSuscripcion(servicios, nuevaMp, { urlBase: URL_BASE });
  assert.equal((await db.prepare('SELECT plan_id AS "planId" FROM tiendas WHERE id = ?').get(anterior.tienda.id)).planId, otro);
  assert.equal(mp.suscripciones.get(anterior.mpId).status, 'cancelled');
  assert.equal((await leerSuscripcion(db, anterior.id)).estado, 'cancelada');
});

// ---------- El webhook ----------

test('el webhook valida la firma, no se cree lo que dice el cuerpo y responde bien', async () => {
  const config = {
    produccion: false,
    secretoSesion: SECRETO,
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    mercadopago: { accessToken: TOKEN_MP, webhookSecret: SECRETO_WEBHOOK, apiUrl: `http://127.0.0.1:${mp.puerto}` },
    n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: SECRETO_N8N },
  };
  const servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const avisar = (dataId, { tema = 'subscription_preapproval', cabeceras, cuerpo } = {}) =>
    fetch(`${base}/webhooks/mercadopago?data.id=${dataId}&type=${tema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...cabeceras },
      body: JSON.stringify(cuerpo ?? { type: tema, data: { id: dataId } }),
    });
  const firmado = (dataId, secreto = SECRETO_WEBHOOK) => ({ 'x-request-id': 'req-9', 'x-signature': firma(secreto, `id:${dataId};request-id:req-9;ts:TS;`) });

  try {
    const s = await suscribirse();
    assert.equal((await avisar(s.mpId)).status, 401, 'sin firma');
    assert.equal((await avisar(s.mpId, { cabeceras: firmado(s.mpId, 'otro-secreto') })).status, 401, 'firma de otro secreto');
    assert.equal((await avisar(s.mpId, { cabeceras: firmado('otro-id') })).status, 401, 'firma de otro id');

    // El cuerpo dice "autorizada", pero Mercado Pago dice "pendiente": manda Mercado Pago.
    const mentira = await avisar(s.mpId, { cabeceras: firmado(s.mpId), cuerpo: { type: 'subscription_preapproval', status: 'authorized', data: { id: s.mpId } } });
    assert.equal(mentira.status, 200);
    assert.equal((await leerSuscripcion(db, s.id)).estado, 'pendiente');

    mp.autorizar(s.mpId);
    assert.equal((await avisar(s.mpId, { cabeceras: firmado(s.mpId) })).status, 200);
    assert.equal((await leerSuscripcion(db, s.id)).estado, 'autorizada');
    assert.equal(n8n.recibidos.length, 1);
    assert.match(n8n.recibidos[0].cuerpo.urlCuenta, new RegExp(`^http://localhost:${servidor.address().port}/suscribirse/cuenta\\?t=`));

    // Un cobro por el aviso de cobros.
    const { tienda } = await crearCuentaDeSuscripcion(servicios, s.token, FORMULARIO);
    mp.cobrar('2001', s.mpId);
    assert.equal((await avisar('2001', { tema: 'subscription_authorized_payment', cabeceras: firmado('2001') })).status, 200);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM pagos_plataforma WHERE tienda_id = ?').get(tienda.id)).n, 1);
    assert.equal((await avisar('2001', { tema: 'subscription_authorized_payment', cabeceras: firmado('2001') })).status, 200, 'Mercado Pago reintenta');
    assert.equal((await db.prepare('SELECT count(*) AS n FROM pagos_plataforma WHERE tienda_id = ?').get(tienda.id)).n, 1);

    // Otros temas: se contestan bien sin hacer nada.
    assert.equal((await avisar('5', { tema: 'payment', cabeceras: firmado('5') })).status, 200);

    // Si no se puede consultar a Mercado Pago, 500: él vuelve a mandar el aviso.
    mp.fallar = true;
    assert.equal((await avisar(s.mpId, { cabeceras: firmado(s.mpId) })).status, 500);
  } finally {
    servidor.closeAllConnections();
    servidor.close();
  }
});

test('sin credenciales de Mercado Pago el webhook no existe', async () => {
  const config = { produccion: false, secretoSesion: SECRETO, dominio: 'localhost', dirImportaciones: '.', dirSubidas: '.' };
  const servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/webhooks/mercadopago?data.id=1&type=subscription_preapproval`, { method: 'POST' });
    assert.equal(r.status, 404);
  } finally {
    servidor.closeAllConnections();
    servidor.close();
  }
});

// ---------- n8n ----------

test('avisar a n8n no falla nunca: sin configurar, caído o con error', async () => {
  assert.equal(await crearNotificador(null)('cuenta_creada', {}), false);
  assert.equal(await crearNotificador({ url: 'http://127.0.0.1:1/nada', secreto: '' })('cuenta_creada', {}), false);
  n8n.fallar = true;
  assert.equal(await crearNotificador({ url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: '' })('cuenta_creada', {}), false);
  n8n.fallar = false;
  assert.equal(await crearNotificador({ url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: '' })('cuenta_creada', { email: 'a@b.com' }), true);
  await esperar(() => n8n.recibidos.length > 1);
  const ultimo = n8n.recibidos.at(-1);
  assert.deepEqual(ultimo.cuerpo, { evento: 'cuenta_creada', email: 'a@b.com' });
  assert.equal(ultimo.secreto, undefined, 'sin secreto configurado no se manda el header');
});
