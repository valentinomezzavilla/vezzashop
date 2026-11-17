import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda, buscarTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { previsualizar, aplicarImportacion, ErrorDeImportacion } from '../src/importacion/aplicar.js';
import { estadoDeCobro, limitesDeTienda } from '../src/limites.js';
import { diasEntre, esDiaValido, hoy, sumarMeses } from '../src/util/fechas.js';
import {
  crearSuperadmin,
  resetearClaveSuperadmin,
  autenticarSuperadmin,
  cambiarClaveSuperadmin,
  crearPlan,
  listarPlanes,
  listarClientes,
  resumenPlataforma,
  registrarPago,
  fijarVencimiento,
} from '../src/plataforma.js';
import { crearNavegador, pedirConHost, PNG, otraFoto } from './ayudantes.js';

let servidor;
let puerto;
let db;
let dirSubidas;
const CONTACTO = 'WhatsApp 351 123 4567';

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = await abrirBase(':memory:');
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas, contactoPlataforma: CONTACTO };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${puerto}`;
const vidriera = (slug, ruta = '/') => pedirConHost(puerto, `${slug}.localhost`, ruta);
let contador = 0;
const unico = (prefijo) => `${prefijo}${(contador += 1)}x${Date.now().toString(36)}`;

// Un superadministrador ya logueado.
async function superadmin() {
  const email = `${unico('super')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const nav = crearNavegador(base());
  const respuesta = await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
  assert.equal(respuesta.status, 302);
  return { nav, email, clave };
}

const idDe = (ubicacion) => Number(ubicacion.split('/').at(-1));
const claveDe = (html) => html.match(/class="clave-generada">([^<]+)</)?.[1];

// Da de alta un cliente por la pantalla del administrador y devuelve su id, su clave y un navegador logueado en su panel.
async function altaDeCliente(admin, { nombre = unico('Tienda'), planId = '', venceEn = '' } = {}) {
  const email = `${unico('duenio')}@cliente.com`;
  const respuesta = await admin.enviar('/plataforma/clientes/nuevo', { nombre, email, planId: String(planId), venceEn });
  assert.equal(respuesta.status, 200, await respuesta.clone().text().then((t) => t.slice(0, 300)));
  const html = await respuesta.text();
  const clave = claveDe(html);
  assert.ok(clave, 'se muestra la clave');
  const tienda = await db.prepare('SELECT id, slug FROM tiendas WHERE nombre = ?').get(nombre);
  const panel = crearNavegador(base());
  assert.equal((await panel.enviar('/admin/ingresar', { email, clave })).status, 302, 'el cliente entra con la clave mostrada');
  return { id: tienda.id, slug: tienda.slug, nombre, email, clave, panel, html };
}

const nuevoPlan = (datos = {}) =>
  crearPlan(db, { nombre: unico('Plan'), precioCentavos: 1500000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, ...datos });

// ---------- Acceso ----------

test('/plataforma pide ingresar; los dueños de tienda y los superadministradores no se mezclan', async () => {
  const anonimo = crearNavegador(base());
  const sinSesion = await anonimo.pedir('/plataforma/clientes');
  assert.equal(sinSesion.status, 302);
  assert.equal(sinSesion.headers.get('location'), '/plataforma/ingresar');

  const { nav } = await superadmin();
  assert.equal((await nav.pedir('/plataforma/clientes')).status, 200);
  assert.equal((await nav.pedir('/plataforma/planes')).status, 200);
  assert.equal((await nav.pedir('/plataforma/cuenta')).status, 200);
  // Ser superadministrador no abre el panel de ninguna tienda.
  assert.equal((await nav.pedir('/admin/inicio')).headers.get('location'), '/admin/ingresar');

  // Y la clave de un dueño no sirve para entrar a la plataforma.
  const { tienda, clave } = await crearTienda(db, { nombre: unico('Dueña'), email: `${unico('d')}@cliente.com` });
  const dueno = crearNavegador(base());
  const usuario = await db.prepare('SELECT email FROM usuarios WHERE tienda_id = ?').get(tienda.id);
  assert.equal((await dueno.enviar('/admin/ingresar', { email: usuario.email, clave })).status, 302);
  assert.equal((await dueno.pedir('/plataforma/clientes')).headers.get('location'), '/plataforma/ingresar');
  const intento = await dueno.enviar('/plataforma/ingresar', { email: usuario.email, clave }, { desde: '/plataforma/ingresar' });
  assert.equal(intento.status, 401);
});

test('ingreso: clave incorrecta, token CSRF obligatorio, salir cierra la sesión y la página no se guarda en caché', async () => {
  const email = `${unico('s')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const nav = crearNavegador(base());
  const mala = await nav.enviar('/plataforma/ingresar', { email, clave: 'otra-clave' }, { desde: '/plataforma/ingresar' });
  assert.equal(mala.status, 401);
  assert.match(await mala.text(), /Email o clave incorrectos/);

  const sinToken = await nav.pedir('/plataforma/ingresar', { method: 'POST', body: new URLSearchParams({ email, clave }) });
  assert.equal(sinToken.status, 403);

  assert.equal((await nav.enviar('/plataforma/ingresar', { email: email.toUpperCase(), clave }, { desde: '/plataforma/ingresar' })).status, 302, 'el email no distingue mayúsculas');
  const lista = await nav.pedir('/plataforma/clientes');
  assert.match(lista.headers.get('cache-control'), /no-store/);
  await nav.enviar('/plataforma/salir', {}, { desde: '/plataforma/clientes' });
  assert.equal((await nav.pedir('/plataforma/clientes')).headers.get('location'), '/plataforma/ingresar');
});

test('después de 8 intentos fallidos se frena el ingreso, también con la clave correcta', async () => {
  // Una app aparte: el limitador vive en cada instancia y no tiene que afectar a los demás tests.
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas };
  const otro = crearApp({ db, config }).listen(0);
  await once(otro, 'listening');
  try {
    const email = `${unico('frenado')}@vezza.dev`;
    const { clave } = await crearSuperadmin(db, { email });
    const nav = crearNavegador(`http://127.0.0.1:${otro.address().port}`);
    for (let i = 0; i < 8; i++) assert.equal((await nav.enviar('/plataforma/ingresar', { email, clave: 'mala' }, { desde: '/plataforma/ingresar' })).status, 401);
    const frenado = await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
    assert.equal(frenado.status, 429);
    assert.match(await frenado.text(), /Demasiados intentos/);
  } finally {
    otro.close();
  }
});

test('cuentas de superadministrador: alta, duplicado, clave nueva y cambio de clave', async () => {
  const email = `${unico('cuenta')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  assert.ok(clave.length >= 16);
  await assert.rejects(crearSuperadmin(db, { email: email.toUpperCase() }), /Ya existe/);
  await assert.rejects(crearSuperadmin(db, { email: 'no-es-un-email' }), /Email inválido/);
  assert.ok(await autenticarSuperadmin(db, email, clave));
  assert.equal(await autenticarSuperadmin(db, email, 'mala'), null);
  assert.equal(await autenticarSuperadmin(db, 'nadie@vezza.dev', clave), null);

  const nueva = await resetearClaveSuperadmin(db, email);
  assert.equal(await autenticarSuperadmin(db, email, clave), null, 'la clave vieja ya no sirve');
  const { id } = await autenticarSuperadmin(db, email, nueva.clave);
  await assert.rejects(resetearClaveSuperadmin(db, 'nadie@vezza.dev'), /No existe/);

  assert.equal((await cambiarClaveSuperadmin(db, id, { actual: 'mala', nueva: 'x'.repeat(14), repetida: 'x'.repeat(14) })).campo, 'claveActual');
  assert.equal((await cambiarClaveSuperadmin(db, id, { actual: nueva.clave, nueva: 'corta', repetida: 'corta' })).campo, 'claveNueva');
  assert.equal((await cambiarClaveSuperadmin(db, id, { actual: nueva.clave, nueva: 'x'.repeat(14), repetida: 'y'.repeat(14) })).campo, 'claveRepetida');
  assert.equal(await cambiarClaveSuperadmin(db, id, { actual: nueva.clave, nueva: 'una-clave-bien-larga', repetida: 'una-clave-bien-larga' }), null);
  assert.ok(await autenticarSuperadmin(db, email, 'una-clave-bien-larga'));
});

// ---------- Planes ----------

test('planes: se crean, se validan, se editan y no se borran con clientes', async () => {
  const { nav } = await superadmin();
  const nombre = unico('Básico');
  const creado = await nav.enviar('/plataforma/planes/nuevo', { nombre, precio: '15.000,50', maxProductos: '30', maxFotos: '3', maxBanners: '', activo: '1' });
  assert.equal(creado.status, 302);
  const plan = (await listarPlanes(db)).find((p) => p.nombre === nombre);
  assert.deepEqual({ precio: plan.precioCentavos, productos: plan.maxProductos, fotos: plan.maxFotos, banners: plan.maxBanners, activo: plan.activo }, { precio: 1500050, productos: 30, fotos: 3, banners: null, activo: true });

  // Validaciones
  const html = async (campos) => (await nav.enviar('/plataforma/planes/nuevo', campos)).text();
  assert.match(await html({ nombre: '', precio: '0' }), /Escribí el nombre del plan/);
  assert.match(await html({ nombre: nombre.toUpperCase(), precio: '0' }), /Ya hay un plan con ese nombre/);
  assert.match(await html({ nombre: unico('X'), precio: 'mucho' }), /precio por mes en pesos/);
  assert.match(await html({ nombre: unico('X'), maxProductos: '0' }), /Productos: escribí un número entero entre 1 y/);
  assert.match(await html({ nombre: unico('X'), maxFotos: '11' }), /Fotos por producto: escribí un número entero entre 1 y 10/);
  assert.match(await html({ nombre: unico('X'), maxBanners: '7' }), /Banners: escribí un número entero entre 0 y 6/);
  assert.match(await html({ nombre: unico('X'), maxProductos: '1e3' }), /número entero/);

  // Editar: el mismo nombre no cuenta como repetido; el cambio de topes se ve en las tiendas del plan
  const editado = await nav.enviar(`/plataforma/planes/${plan.id}`, { nombre, precio: '20000', maxProductos: '', maxFotos: '', maxBanners: '0' }, { desde: `/plataforma/planes/${plan.id}` });
  assert.equal(editado.status, 302);
  const despues = (await listarPlanes(db)).find((p) => p.id === plan.id);
  assert.deepEqual({ precio: despues.precioCentavos, productos: despues.maxProductos, banners: despues.maxBanners, activo: despues.activo }, { precio: 2000000, productos: null, banners: 0, activo: false });

  // Con un cliente adentro no se borra; sin clientes, sí
  const { id: tiendaId } = await altaDeCliente(nav, { planId: plan.id });
  const noBorra = await nav.enviar(`/plataforma/planes/${plan.id}/borrar`, {}, { desde: `/plataforma/planes/${plan.id}` });
  assert.equal(noBorra.status, 302);
  assert.ok((await listarPlanes(db)).some((p) => p.id === plan.id), 'sigue existiendo');
  assert.match(await (await nav.pedir('/plataforma/planes')).text(), /No se puede borrar: hay 1 cliente/);
  await db.prepare('UPDATE tiendas SET plan_id = NULL WHERE id = ?').run(tiendaId);
  await nav.enviar(`/plataforma/planes/${plan.id}/borrar`, {}, { desde: `/plataforma/planes/${plan.id}` });
  assert.ok(!(await listarPlanes(db)).some((p) => p.id === plan.id), 'se borró');
  assert.equal((await nav.pedir('/plataforma/planes/999999')).status, 404);
});

test('un plan desactivado no se ofrece para clientes nuevos, pero lo conserva quien ya lo tiene', async () => {
  const { nav } = await superadmin();
  const apagado = await nuevoPlan({ nombre: unico('Viejo'), activo: false });
  const nombrePlan = (await listarPlanes(db)).find((p) => p.id === apagado).nombre;
  assert.doesNotMatch(await (await nav.pedir('/plataforma/clientes/nuevo')).text(), new RegExp(nombrePlan));
  const rechazado = await nav.enviar('/plataforma/clientes/nuevo', { nombre: unico('T'), email: `${unico('e')}@c.com`, planId: '' });
  assert.match(await rechazado.text(), /Elegí un plan/);
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = (SELECT max(id) FROM tiendas)').run(apagado);
  const { id } = await db.prepare('SELECT max(id) AS id FROM tiendas').get();
  assert.match(await (await nav.pedir(`/plataforma/clientes/${id}`)).text(), new RegExp(`${nombrePlan}[^<]*\\(ya no se ofrece\\)`));
});

// ---------- Clientes ----------

test('alta de un cliente: crea su tienda y su acceso, muestra la clave una sola vez y valida', async () => {
  const { nav } = await superadmin();
  const planId = await nuevoPlan({ maxProductos: 5 });
  const cliente = await altaDeCliente(nav, { nombre: 'Café <i>Luna</i>', planId, venceEn: sumarMeses(hoy(), 1) });
  assert.match(cliente.html, /Creamos la tienda de/);
  assert.doesNotMatch(cliente.html, /<i>Luna<\/i>/, 'el nombre se escapa: no se cuela HTML');
  assert.match(cliente.html, new RegExp(`${cliente.slug}\\.localhost`));
  assert.match(cliente.html, /Clave: /, 'el mensaje listo para mandarle');
  const fila = await db.prepare('SELECT plan_id AS "planId", vence_en AS "venceEn", estado FROM tiendas WHERE id = ?').get(cliente.id);
  assert.deepEqual({ ...fila }, { planId, venceEn: sumarMeses(hoy(), 1), estado: 'activa' });
  // La clave no queda en ninguna página: recargar el listado o la ficha no la muestra.
  assert.doesNotMatch(await (await nav.pedir(`/plataforma/clientes/${cliente.id}`)).text(), new RegExp(cliente.clave));

  const intento = async (campos) => (await nav.enviar('/plataforma/clientes/nuevo', { planId: String(planId), ...campos })).text();
  assert.match(await intento({ nombre: 'Café <i>Luna</i>', email: `${unico('o')}@c.com` }), /Ya existe una tienda/);
  assert.match(await intento({ nombre: unico('N'), email: cliente.email }), /Ya existe un usuario con el email/);
  assert.match(await intento({ nombre: unico('N'), email: 'sin-arroba' }), /Email inválido/);
  assert.match(await intento({ nombre: 'Admin', email: `${unico('o')}@c.com` }), /no se puede usar como nombre/);
  assert.match(await intento({ nombre: '!!!', email: `${unico('o')}@c.com` }), /tiene que tener letras o números/);
  assert.match(await intento({ nombre: unico('N'), email: `${unico('o')}@c.com`, venceEn: '2026-02-31' }), /fecha válida/);
  assert.match(await intento({ nombre: unico('N'), email: `${unico('o')}@c.com`, planId: '999999' }), /Elegí un plan/);
});

test('el listado filtra por estado y cobro, busca, y suma lo que se espera cobrar por mes', async () => {
  const admin = await superadmin();
  const planA = await nuevoPlan({ precioCentavos: 1000000 });
  const planB = await nuevoPlan({ precioCentavos: 2500000 });
  const dia = hoy();
  const nombres = { alDia: unico('AlDia'), porVencer: unico('PorVencer'), vencido: unico('Vencido'), suspendido: unico('Susp'), sinFecha: unico('SinFecha') };
  const t = {};
  t.alDia = await altaDeCliente(admin.nav, { nombre: nombres.alDia, planId: planA, venceEn: sumarMeses(dia, 2) });
  t.porVencer = await altaDeCliente(admin.nav, { nombre: nombres.porVencer, planId: planB, venceEn: sumarMeses(dia, 0) });
  await db.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(new Date(Date.parse(`${dia}T00:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10), t.porVencer.id);
  t.vencido = await altaDeCliente(admin.nav, { nombre: nombres.vencido, planId: planA });
  await db.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(new Date(Date.parse(`${dia}T00:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10), t.vencido.id);
  t.suspendido = await altaDeCliente(admin.nav, { nombre: nombres.suspendido, planId: planB });
  await db.prepare("UPDATE tiendas SET estado = 'suspendida' WHERE id = ?").run(t.suspendido.id);
  t.sinFecha = await altaDeCliente(admin.nav, { nombre: nombres.sinFecha, planId: planA });

  const nombresDe = async (filtro, busqueda = '') => (await listarClientes(db, { filtro, busqueda, dia })).clientes.map((c) => c.nombre).filter((n) => Object.values(nombres).includes(n)).sort();
  assert.deepEqual(await nombresDe('vencidos'), [nombres.vencido]);
  assert.deepEqual(await nombresDe('por-vencer'), [nombres.porVencer]);
  assert.deepEqual(await nombresDe('suspendidos'), [nombres.suspendido]);
  assert.deepEqual(await nombresDe('activos'), [nombres.alDia, nombres.porVencer, nombres.sinFecha, nombres.vencido].sort());
  assert.deepEqual(await nombresDe('todos', nombres.alDia.toUpperCase()), [nombres.alDia], 'la búsqueda no distingue mayúsculas');
  assert.deepEqual(await nombresDe('todos', t.sinFecha.email.slice(0, 12)), [nombres.sinFecha], 'busca por email');
  assert.deepEqual(await nombresDe('todos', t.sinFecha.slug), [nombres.sinFecha], 'y por link');

  const resumen = await resumenPlataforma(db, dia);
  assert.ok(resumen.suspendidos >= 1 && resumen.vencidos >= 1 && resumen.porVencer >= 1);
  const lista = await (await admin.nav.pedir('/plataforma/clientes?filtro=vencidos')).text();
  assert.match(lista, new RegExp(nombres.vencido));
  assert.doesNotMatch(lista, new RegExp(nombres.alDia));
  assert.match(lista, /Venció el/);
  // Un filtro inventado cae en "todos" en vez de romper.
  assert.equal((await admin.nav.pedir('/plataforma/clientes?filtro=__proto__&q=x')).status, 200);
});

test('estadoDeCobro: al día, por vencer (7 días o menos), vencido y sin vencimiento', () => {
  const dia = '2026-11-17';
  assert.deepEqual(estadoDeCobro(null, dia), { estado: 'sin-vencimiento', dias: null });
  assert.deepEqual(estadoDeCobro('2026-11-16', dia), { estado: 'vencido', dias: -1 });
  assert.deepEqual(estadoDeCobro('2026-11-17', dia), { estado: 'por-vencer', dias: 0 }, 'vence hoy: todavía no está vencido');
  assert.deepEqual(estadoDeCobro('2026-11-24', dia), { estado: 'por-vencer', dias: 7 });
  assert.deepEqual(estadoDeCobro('2026-11-25', dia), { estado: 'al-dia', dias: 8 });
});

test('fechas: sumar meses respeta el fin de mes, y se validan los días del calendario', () => {
  assert.equal(sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(sumarMeses('2028-01-31', 1), '2028-02-29', 'año bisiesto');
  assert.equal(sumarMeses('2026-11-30', 3), '2027-02-28');
  assert.equal(sumarMeses('2026-12-15', 1), '2027-01-15');
  assert.equal(sumarMeses('2026-03-31', 12), '2027-03-31');
  assert.equal(diasEntre('2026-11-17', '2026-12-17'), 30);
  assert.ok(esDiaValido('2028-02-29') && !esDiaValido('2026-02-29') && !esDiaValido('2026-13-01') && !esDiaValido('hoy') && !esDiaValido(''));
});

// ---------- Cobro ----------

test('registrar un pago extiende el vencimiento desde su fecha (si no venció) o desde hoy, y queda en el historial', async () => {
  const { nav } = await superadmin();
  const planId = await nuevoPlan();
  const dia = '2026-11-17';
  const { id } = await altaDeCliente(nav, { planId });
  const vence = async () => (await db.prepare('SELECT vence_en AS v FROM tiendas WHERE id = ?').get(id)).v;

  // Sin fecha: desde hoy
  assert.deepEqual(await registrarPago(db, id, { meses: '1', monto: '15.000', nota: 'transferencia' }, dia), { venceDespues: '2026-12-17' });
  // Todavía no venció: se suma al vencimiento, no a hoy
  assert.deepEqual(await registrarPago(db, id, { meses: '2', monto: '', nota: '' }, dia), { venceDespues: '2027-02-17' });
  // Vencido hace rato: cuenta desde hoy, no desde la fecha vieja
  await fijarVencimiento(db, id, '2026-01-05');
  assert.deepEqual(await registrarPago(db, id, { meses: '1', monto: '', nota: '' }, dia), { venceDespues: '2026-12-17' });
  assert.equal(await vence(), '2026-12-17');

  const historial = await db.prepare('SELECT monto_centavos AS monto, meses, vencia_antes AS antes, vence_despues AS despues, nota FROM pagos_plataforma WHERE tienda_id = ? ORDER BY id').all(id);
  assert.deepEqual(historial.map((h) => ({ ...h })), [
    { monto: 1500000, meses: 1, antes: null, despues: '2026-12-17', nota: 'transferencia' },
    { monto: 0, meses: 2, antes: '2026-12-17', despues: '2027-02-17', nota: '' },
    { monto: 0, meses: 1, antes: '2026-01-05', despues: '2026-12-17', nota: '' },
  ]);

  // Validaciones
  for (const meses of ['0', '25', 'dos', '-1', '']) assert.match((await registrarPago(db, id, { meses }, dia)).error, /entre 1 y 24 meses/);
  assert.match((await registrarPago(db, id, { meses: '1', monto: 'barato' }, dia)).error, /monto en pesos/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM pagos_plataforma WHERE tienda_id = ?').get(id)).n, 3, 'los rechazados no se registran');
  assert.match(await fijarVencimiento(db, id, '2026-02-30'), /fecha válida/);
  assert.equal(await fijarVencimiento(db, id, null), null);
  assert.equal(await vence(), null);

  // Por la pantalla
  const respuesta = await nav.enviar(`/plataforma/clientes/${id}/pago`, { meses: '3', monto: '45000', nota: 'trimestre' }, { desde: `/plataforma/clientes/${id}` });
  assert.equal(respuesta.status, 302);
  assert.equal(await vence(), sumarMeses(hoy(), 3));
  const ficha = await (await nav.pedir(`/plataforma/clientes/${id}`)).text();
  assert.match(ficha, /trimestre/);
  const rechazado = await nav.enviar(`/plataforma/clientes/${id}/pago`, { meses: '99' }, { desde: `/plataforma/clientes/${id}` });
  assert.equal(rechazado.status, 400);
  assert.match(await rechazado.text(), /entre 1 y 24 meses/);
});

test('el cliente ve su plan en Cuenta y el aviso de cobro en Inicio cuando está por vencer o vencido', async () => {
  const { nav } = await superadmin();
  const planId = await nuevoPlan({ nombre: unico('Mensual'), maxProductos: 40, maxFotos: 4, maxBanners: 2 });
  const cliente = await altaDeCliente(nav, { planId, venceEn: sumarMeses(hoy(), 3) });
  const cuenta = await (await cliente.panel.pedir('/admin/cuenta')).text();
  assert.match(cuenta, /Tu plan/);
  assert.match(cuenta, /0 de 40/);
  assert.match(cuenta, /hasta 4/);
  assert.match(cuenta, /0 de 2/);
  assert.match(cuenta, new RegExp(CONTACTO));
  assert.doesNotMatch(await (await cliente.panel.pedir('/admin/inicio')).text(), /Tu plan vence|Tu plan venció/, 'al día: sin aviso');

  const fecha = (dias) => new Date(Date.parse(`${hoy()}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
  await fijarVencimiento(db, cliente.id, fecha(3));
  assert.match(await (await cliente.panel.pedir('/admin/inicio')).text(), /Tu plan vence el/);
  await fijarVencimiento(db, cliente.id, fecha(-1));
  const vencido = await (await cliente.panel.pedir('/admin/inicio')).text();
  assert.match(vencido, /Tu plan venció el/);
  assert.match(vencido, new RegExp(CONTACTO));
  // El vencimiento solo avisa: la tienda sigue abierta hasta que la suspendan a mano.
  assert.equal((await vidriera(cliente.slug)).status, 200);
});

// ---------- Suspensión ----------

test('suspender cierra la tienda a los compradores y deja el panel del cliente en solo lectura; reactivar la reabre', async () => {
  const { nav } = await superadmin();
  const cliente = await altaDeCliente(nav, { planId: await nuevoPlan() });
  assert.equal((await vidriera(cliente.slug)).status, 200);
  await cliente.panel.enviar('/admin/productos/nuevo', { nombre: 'Antes', sku: 'A-1', precio: '1000', stock: '1' });

  const suspender = await nav.enviar(`/plataforma/clientes/${cliente.id}/suspender`, { motivo: 'Falta de pago de noviembre' }, { desde: `/plataforma/clientes/${cliente.id}` });
  assert.equal(suspender.status, 302);
  assert.equal((await buscarTienda(db, cliente.id)).estado, 'suspendida');

  // Compradores: un aviso con 503, que no se guarda en caché, sin mostrar el motivo interno
  const cerrada = await vidriera(cliente.slug);
  assert.equal(cerrada.status, 503);
  assert.match(cerrada.cuerpo, /no está disponible por el momento/);
  assert.doesNotMatch(cerrada.cuerpo, /Falta de pago/);
  assert.equal((await vidriera(cliente.slug, '/producto/antes')).status, 503);
  assert.equal((await vidriera(cliente.slug, '/api/carrito?skus=A-1')).status, 503);

  // El dueño puede mirar su panel, con el motivo y cómo contactarte...
  const inicio = await cliente.panel.pedir('/admin/productos');
  assert.equal(inicio.status, 200);
  const html = await inicio.text();
  assert.match(html, /Tu tienda está suspendida/);
  assert.match(html, /Motivo: Falta de pago de noviembre/);
  assert.match(html, new RegExp(CONTACTO));
  // ...pero no cambiar nada
  const crear = await cliente.panel.enviar('/admin/productos/nuevo', { nombre: 'Durante', sku: 'D-1', precio: '1000', stock: '1' }, { desde: '/admin/productos' });
  assert.equal(crear.status, 302);
  assert.equal(crear.headers.get('location'), '/admin/inicio');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ? AND nombre = ?').get(cliente.id, 'Durante')).n, 0);
  assert.match(await (await cliente.panel.pedir('/admin/inicio')).text(), /por ahora podés ver tus datos, pero no cambiarlos/);
  const nombre = await cliente.panel.enviar('/admin/cuenta/tienda', { nombre: 'Otro nombre' }, { desde: '/admin/cuenta' });
  assert.equal(nombre.status, 302);
  assert.equal((await buscarTienda(db, cliente.id)).nombre, cliente.nombre, 'el nombre no cambió');
  // Salir sí se puede
  assert.equal((await cliente.panel.enviar('/admin/salir', {}, { desde: '/admin/cuenta' })).status, 302);

  // Reactivar
  const reactivar = await nav.enviar(`/plataforma/clientes/${cliente.id}/reactivar`, {}, { desde: `/plataforma/clientes/${cliente.id}` });
  assert.equal(reactivar.status, 302);
  assert.equal((await vidriera(cliente.slug)).status, 200);
  const otra = crearNavegador(base());
  await otra.enviar('/admin/ingresar', { email: cliente.email, clave: cliente.clave });
  assert.equal((await otra.enviar('/admin/productos/nuevo', { nombre: 'Después', sku: 'P-1', precio: '1000', stock: '1' }, { desde: '/admin/productos/nuevo' })).status, 302);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(cliente.id)).n, 2);
  assert.equal((await buscarTienda(db, cliente.id)).motivoSuspension, '', 'el motivo se borra al reactivar');
});

// ---------- Acceso del cliente ----------

test('resetear la clave del cliente y cambiarle el email', async () => {
  const { nav } = await superadmin();
  const cliente = await altaDeCliente(nav, { planId: await nuevoPlan() });
  const otro = await altaDeCliente(nav, { planId: await nuevoPlan() });

  const reseteo = await nav.enviar(`/plataforma/clientes/${cliente.id}/clave`, {}, { desde: `/plataforma/clientes/${cliente.id}` });
  assert.equal(reseteo.status, 200);
  assert.match(reseteo.headers.get('cache-control'), /no-store/);
  const nueva = claveDe(await reseteo.text());
  assert.ok(nueva && nueva !== cliente.clave);
  const viejo = crearNavegador(base());
  assert.equal((await viejo.enviar('/admin/ingresar', { email: cliente.email, clave: cliente.clave })).status, 401, 'la clave vieja ya no sirve');
  assert.equal((await viejo.enviar('/admin/ingresar', { email: cliente.email, clave: nueva })).status, 302);

  const html = async (email) => (await nav.enviar(`/plataforma/clientes/${cliente.id}/email`, { email }, { desde: `/plataforma/clientes/${cliente.id}` })).text();
  assert.match(await html('sin-arroba'), /El email no es válido/);
  assert.match(await html(otro.email.toUpperCase()), /Ya hay otro usuario con ese email/);
  const nuevoEmail = `${unico('nuevo')}@cliente.com`;
  assert.equal((await nav.enviar(`/plataforma/clientes/${cliente.id}/email`, { email: nuevoEmail }, { desde: `/plataforma/clientes/${cliente.id}` })).status, 302);
  const conOtroEmail = crearNavegador(base());
  assert.equal((await conOtroEmail.enviar('/admin/ingresar', { email: nuevoEmail, clave: nueva })).status, 302, 'entra con el email nuevo y la misma clave');
});

test('cambiar de plan y guardar notas; un cliente inexistente da 404 y los POST exigen token', async () => {
  const { nav } = await superadmin();
  const cliente = await altaDeCliente(nav, { planId: await nuevoPlan() });
  const planNuevo = await nuevoPlan({ maxProductos: 7 });
  assert.equal((await nav.enviar(`/plataforma/clientes/${cliente.id}/plan`, { planId: String(planNuevo) }, { desde: `/plataforma/clientes/${cliente.id}` })).status, 302);
  assert.equal((await limitesDeTienda(db, cliente.id)).maxProductos, 7);
  assert.match(await (await nav.enviar(`/plataforma/clientes/${cliente.id}/plan`, { planId: '999999' }, { desde: `/plataforma/clientes/${cliente.id}` })).text(), /El plan no existe/);
  await nav.enviar(`/plataforma/clientes/${cliente.id}/notas`, { notas: 'Pidió factura A <script>' }, { desde: `/plataforma/clientes/${cliente.id}` });
  const ficha = await (await nav.pedir(`/plataforma/clientes/${cliente.id}`)).text();
  assert.match(ficha, /Pidió factura A &lt;script&gt;/, 'las notas se escapan');

  assert.equal((await nav.pedir('/plataforma/clientes/999999')).status, 404);
  assert.equal((await nav.pedir('/plataforma/clientes/abc')).status, 404);
  for (const accion of ['suspender', 'reactivar', 'clave', 'plan', 'pago']) {
    assert.equal((await nav.pedir(`/plataforma/clientes/${cliente.id}/${accion}`, { method: 'POST', body: new URLSearchParams({ planId: '1' }) })).status, 403, `${accion} sin token`);
  }
  assert.equal((await buscarTienda(db, cliente.id)).estado, 'activa');
});

// ---------- Topes del plan ----------

const PRODUCTO = (n) => ({ nombre: `Producto ${n}`, sku: `P-${n}-${Date.now().toString(36)}`, precio: '1000', stock: '1' });

test('tope de productos: al llegar no se crean más (a mano ni por Excel), editar sigue andando y subir de plan lo libera', async () => {
  const { nav } = await superadmin();
  const planId = await nuevoPlan({ maxProductos: 2 });
  const { id, panel } = await altaDeCliente(nav, { planId });

  for (const n of [1, 2]) assert.equal((await panel.enviar('/admin/productos/nuevo', PRODUCTO(n), { desde: '/admin/productos/nuevo' })).status, 302);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(id)).n, 2);

  const lleno = await panel.enviar('/admin/productos/nuevo', PRODUCTO(3), { desde: '/admin/productos' });
  assert.equal(lleno.headers.get('location'), '/admin/productos');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(id)).n, 2, 'el tercero no se creó');
  const lista = await (await panel.pedir('/admin/productos')).text();
  assert.match(lista, /Llegaste al máximo de tu plan: hasta 2 productos/);
  assert.match(lista, new RegExp(CONTACTO));
  assert.match(lista, /tu plan permite hasta 2/);
  assert.equal((await panel.pedir('/admin/productos/nuevo')).headers.get('location'), '/admin/productos', 'ni siquiera abre el formulario');

  // Editar uno existente sigue andando
  const { id: productoId } = await db.prepare('SELECT id FROM productos WHERE tienda_id = ? ORDER BY id LIMIT 1').get(id);
  const edicion = await panel.pedir(`/admin/productos/${productoId}`);
  assert.equal(edicion.status, 200);

  // Por Excel: la vista previa avisa y aplicar no crea nada
  const hoja = (...nombres) => interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ...nombres.map((n, i) => [`X-${n}-${i}`, `Excel ${n}`, 1000, 1]), ]).productos;
  const limites = await limitesDeTienda(db, id);
  const { errores } = await previsualizar(db, id, hoja('a'), limites);
  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /Tu plan permite hasta 2 productos y ya tenés 2/);
  await assert.rejects(aplicarImportacion(db, id, hoja('a', 'b'), new Map(), limites), ErrorDeImportacion);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(id)).n, 2);
  // Actualizar productos que ya existen no cuenta como crear: pasa aunque esté lleno
  const existentes = await db.prepare('SELECT p.nombre, v.sku FROM productos p JOIN variantes v ON v.producto_id = p.id WHERE p.tienda_id = ?').all(id);
  const actualizar = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ...existentes.map((e) => [e.sku, e.nombre, 2000, 5])]).productos;
  assert.equal((await previsualizar(db, id, actualizar, limites)).errores.length, 0);

  // Subir de plan lo libera
  await nav.enviar(`/plataforma/clientes/${id}/plan`, { planId: String(await nuevoPlan({ maxProductos: 3 })) }, { desde: `/plataforma/clientes/${id}` });
  assert.equal((await panel.enviar('/admin/productos/nuevo', PRODUCTO(3), { desde: '/admin/productos/nuevo' })).status, 302);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos WHERE tienda_id = ?').get(id)).n, 3);
  assert.equal((await panel.pedir('/admin/productos/nuevo')).headers.get('location'), '/admin/productos');
});

test('el tope de productos por Excel cuenta solo los productos nuevos, y avisa una sola vez', async () => {
  const { tienda } = await crearTienda(db, { nombre: unico('Excel'), email: `${unico('e')}@c.com` });
  const hoja = (n) => interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ...Array.from({ length: n }, (_, i) => [`E-${i}`, `Excel ${i}`, 1000, 1])]).productos;
  // Con 5 productos nuevos y un tope de 3: un solo error, en la fila del primero que se pasa
  const { errores } = await previsualizar(db, tienda.id, hoja(5), { maxProductos: 3 });
  assert.equal(errores.length, 1);
  assert.equal(errores[0].fila, 5, 'el cuarto producto es el primero que no entra (fila 5 con el encabezado)');
  assert.equal((await previsualizar(db, tienda.id, hoja(3), { maxProductos: 3 })).errores.length, 0, 'justo en el tope pasa');
  assert.equal((await previsualizar(db, tienda.id, hoja(50), {})).errores.length, 0, 'sin tope, sin problema');
});

test('tope de fotos por producto', async () => {
  const { nav } = await superadmin();
  const { id, panel } = await altaDeCliente(nav, { planId: await nuevoPlan({ maxFotos: 2 }) });
  const creado = await panel.enviar('/admin/productos/nuevo', PRODUCTO(1), { desde: '/admin/productos/nuevo' });
  const ficha = creado.headers.get('location');
  const subir = (...fotos) => panel.enviarArchivos(`${ficha}/fotos`, { fotos: fotos.map((contenido, n) => ({ contenido, nombre: `f${n}.png` })) }, { desde: ficha });
  const cantidad = async () => (await db.prepare('SELECT count(*) AS n FROM producto_fotos WHERE tienda_id = ?').get(id)).n;

  await subir(PNG, otraFoto(1), otraFoto(2));
  assert.equal(await cantidad(), 0, 'tres no entran: no se sube ninguna');
  assert.match(await (await panel.pedir(ficha)).text(), /Podés agregar 2 fotos más/);
  await subir(PNG, otraFoto(1));
  assert.equal(await cantidad(), 2);
  await subir(otraFoto(3));
  assert.equal(await cantidad(), 2);
  const html = await (await panel.pedir(ficha)).text();
  assert.match(html, /Ya tiene 2 fotos, el máximo de tu plan/);
  assert.match(html, /Hasta 2, de hasta/, 'el editor muestra el tope del plan');
  // Excel: el límite de fotos del plan también cuenta
  const productos = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['F-1', 'Con fotos', 1000, 1]]).productos;
  productos[0].fotos = [PNG, otraFoto(1), otraFoto(2)].map((contenido, i) => ({ huella: `h${i}`, contenido }));
  const { errores } = await previsualizar(db, id, productos, { maxFotos: 2 });
  assert.match(errores[0].mensaje, /quedaría con 3 fotos y el máximo es 2/);
});

test('tope de banners, incluido un plan sin banners', async () => {
  const { nav } = await superadmin();
  const { id, panel } = await altaDeCliente(nav, { planId: await nuevoPlan({ maxBanners: 0 }) });
  const agregar = (n) => panel.enviarArchivos('/admin/diseno/banners', { imagen: { contenido: PNG, nombre: `b${n}.png` }, enlace: '', textoAlternativo: `Banner ${n}` }, { desde: '/admin/diseno' });
  const banners = async () => (await db.prepare('SELECT count(*) AS n FROM banners WHERE tienda_id = ?').get(id)).n;

  await agregar(1);
  assert.equal(await banners(), 0);
  const diseno = await (await panel.pedir('/admin/diseno')).text();
  assert.match(diseno, /Tu plan no incluye banners/);

  await nav.enviar(`/plataforma/clientes/${id}/plan`, { planId: String(await nuevoPlan({ maxBanners: 1 })) }, { desde: `/plataforma/clientes/${id}` });
  await agregar(1);
  assert.equal(await banners(), 1);
  await agregar(2);
  assert.equal(await banners(), 1, 'el segundo no entra');
  assert.match(await (await panel.pedir('/admin/diseno')).text(), /Podés tener hasta 1 banners/);
});

test('una tienda sin plan, o con el plan "Sin límites", no tiene topes', async () => {
  const { tienda } = await crearTienda(db, { nombre: unico('SinPlan'), email: `${unico('s')}@c.com` });
  const limites = await limitesDeTienda(db, tienda.id);
  assert.deepEqual({ plan: limites.plan, productos: limites.maxProductos, fotos: limites.maxFotos, banners: limites.maxBanners, vence: limites.venceEn }, { plan: null, productos: null, fotos: 10, banners: 6, vence: null });
  const sinLimites = (await listarPlanes(db)).find((p) => p.nombre === 'Sin límites');
  assert.ok(sinLimites, 'la migración deja un plan sin topes para las tiendas que ya existían');
  assert.deepEqual({ p: sinLimites.maxProductos, f: sinLimites.maxFotos, b: sinLimites.maxBanners }, { p: null, f: null, b: null });
  await assert.rejects(crearTienda(db, { nombre: unico('Plan'), email: `${unico('p')}@c.com`, planId: 999999 }), /plan elegido no existe/);
});
