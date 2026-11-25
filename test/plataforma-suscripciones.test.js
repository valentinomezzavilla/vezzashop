// Lo que ve y puede hacer el superadmin con las suscripciones: altas sin cuenta, la ficha del cliente y el mail de bienvenida.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, crearSuperadmin, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { crearNavegador } from './ayudantes.js';
import { TOKEN_MP, crearMpFalso, crearN8nFalso } from './mercadopago-falso.js';

let mp;
let n8n;
let db;
let planes;
let servidor;
let puerto;
let admin;

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
  n8n.fallar = false;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { prueba: await crear('Prueba'), esencial: await crear('Esencial'), medida: await crear('A medida') };
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
  const { clave } = await crearSuperadmin(db, { email: 'yo@vezza.dev' });
  admin = crearNavegador(`http://127.0.0.1:${puerto}`);
  const r = await admin.enviar('/plataforma/ingresar', { email: 'yo@vezza.dev', clave });
  assert.equal(r.status, 302);
}

beforeEach(() => levantar());

const esperar = async (condicion) => {
  for (let i = 0; i < 100 && !condicion(); i++) await new Promise((r) => setTimeout(r, 20));
};
const pagina = async (ruta) => (await admin.pedir(ruta)).text();
const accion = (ruta, desde) => admin.enviar(ruta, {}, { desde });

// Un visitante que eligió el plan Esencial y pagó, pero no creó su cuenta. Devuelve la fila de la suscripción.
async function altaPaga() {
  const visitante = crearNavegador(`http://127.0.0.1:${puerto}`);
  await visitante.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  mp.autorizar('mp1abc');
  const token = new URL(mp.pedidos[0].cuerpo.back_url).searchParams.get('t');
  await visitante.pedir(`/suscribirse/volver?t=${token}`);
  await esperar(() => n8n.recibidos.length > 0);
  n8n.recibidos.length = 0;
  return { visitante, token, fila: await db.prepare('SELECT id FROM suscripciones').get() };
}

test('Altas muestra quién pagó y no creó la cuenta, y deja reenviarle el link', async () => {
  assert.match(await pagina('/plataforma/altas'), /No hay altas pendientes/);
  const { fila, token } = await altaPaga();
  const html = await pagina('/plataforma/altas');
  assert.match(html, /ana@correo\.com/);
  assert.match(html, /Pagó, falta crear la cuenta/);
  assert.match(html, /Reenviar link por mail/);

  const r = await accion(`/plataforma/altas/${fila.id}/reenviar`, '/plataforma/altas');
  assert.equal(r.status, 302);
  await esperar(() => n8n.recibidos.length > 0);
  assert.equal(n8n.recibidos[0].cuerpo.evento, 'pago_recibido');
  assert.equal(n8n.recibidos[0].cuerpo.email, 'ana@correo.com');
  assert.equal(n8n.recibidos[0].cuerpo.urlCuenta, `http://localhost:${puerto}/suscribirse/cuenta?t=${token}`);
  assert.match(await pagina('/plataforma/altas'), /Le mandamos a ana@correo\.com el link/);
});

test('no se reenvía el link si el pago no está confirmado ni si la cuenta ya existe', async () => {
  const visitante = crearNavegador(`http://127.0.0.1:${puerto}`);
  await visitante.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  const { id } = await db.prepare('SELECT id FROM suscripciones').get();
  await accion(`/plataforma/altas/${id}/reenviar`, '/plataforma/altas');
  assert.match(await pagina('/plataforma/altas'), /Solo se puede reenviar el link cuando el pago está confirmado/);
  assert.equal(n8n.recibidos.length, 0);

  // "Sincronizar" lo pone al día con Mercado Pago.
  mp.autorizar('mp1abc');
  await accion(`/plataforma/altas/${id}/sincronizar`, '/plataforma/altas');
  assert.match(await pagina('/plataforma/altas'), /Pagó, falta crear la cuenta/);
});

test('una alta que ya creó su cuenta sale de Altas y aparece en Clientes con su titular', async () => {
  const { visitante, token } = await altaPaga();
  const r = await visitante.enviar(
    '/suscribirse/cuenta',
    { t: token, nombre: 'Ana', apellido: 'Pérez', email: 'ana@correo.com', clave: 'una-clave-larga-1', claveRepetida: 'una-clave-larga-1', nombreTienda: 'Casa Ana', slug: '' },
    { desde: `/suscribirse/cuenta?t=${token}` },
  );
  assert.equal(r.status, 302);
  assert.match(await pagina('/plataforma/altas'), /No hay altas pendientes/);

  const { id } = await db.prepare("SELECT id FROM tiendas WHERE slug = 'casa-ana'").get();
  const ficha = await pagina(`/plataforma/clientes/${id}`);
  assert.match(ficha, /ana@correo\.com · Ana Pérez/);
  assert.match(ficha, /<h2>Suscripción<\/h2>/);
  assert.match(ficha, /Activa<\/span> Esencial/);
  assert.match(ficha, /Sincronizar con Mercado Pago/);
  assert.match(ficha, /Paga con débito automático/);
});

test('la ficha permite reenviar el mail de bienvenida por n8n', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.esencial });
  await accion(`/plataforma/clientes/${tienda.id}/bienvenida`, `/plataforma/clientes/${tienda.id}`);
  await esperar(() => n8n.recibidos.length > 0);
  const { cuerpo } = n8n.recibidos[0];
  assert.equal(cuerpo.evento, 'cuenta_creada');
  assert.equal(cuerpo.email, 'luz@taller.com');
  assert.equal(cuerpo.tienda.nombre, 'Taller Luz');
  assert.equal(cuerpo.tienda.url, `http://taller-luz.localhost:${puerto}`);
  assert.equal(cuerpo.plan.nombre, 'Esencial');
  assert.equal(cuerpo.urlPanel, `http://localhost:${puerto}/admin`);
  assert.match(await pagina(`/plataforma/clientes/${tienda.id}`), /Le mandamos el mail de bienvenida a luz@taller\.com/);

  n8n.fallar = true;
  await accion(`/plataforma/clientes/${tienda.id}/bienvenida`, `/plataforma/clientes/${tienda.id}`);
  assert.match(await pagina(`/plataforma/clientes/${tienda.id}`), /No se pudo mandar el mail/);
});

test('el superadmin puede sincronizar y cancelar la suscripción de un cliente', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.prueba });
  // La suscripción se arma directo (el cliente la contrata desde su panel en admin-suscripcion.test.js).
  const { iniciarSuscripcion } = await import('../src/suscripciones.js');
  const { crearClienteMp } = await import('../src/mercadopago.js');
  const servicios = { db, mp: crearClienteMp({ accessToken: TOKEN_MP, apiUrl: `http://127.0.0.1:${mp.puerto}` }), avisar: async () => true, secreto: 'secreto-de-prueba-de-al-menos-32-caracteres' };
  await iniciarSuscripcion(servicios, { planId: planes.esencial, email: 'luz@taller.com', tiendaId: tienda.id, urlVuelta: 'https://x.test/vuelta' });
  mp.autorizar('mp1abc');

  const ruta = `/plataforma/clientes/${tienda.id}`;
  assert.match(await pagina(ruta), /Pago sin terminar/);
  await accion(`${ruta}/suscripcion/sincronizar`, ruta);
  const activa = await pagina(ruta);
  assert.match(activa, /Sincronizamos la suscripción con Mercado Pago/);
  assert.match(activa, /Activa<\/span> Esencial/);
  assert.match(activa, /<code>mp1abc<\/code>/);

  await accion(`${ruta}/suscripcion/cancelar`, ruta);
  assert.equal(mp.suscripciones.get('mp1abc').status, 'cancelled');
  const cancelada = await pagina(ruta);
  assert.match(cancelada, /Cancelamos el cobro automático/);
  assert.match(cancelada, /Cancelada<\/span> Esencial/);

  await accion(`${ruta}/suscripcion/sincronizar`, ruta);
  assert.match(await pagina(ruta), /Este cliente no tiene una suscripción para sincronizar/, 'ya no hay nada que sincronizar');
});

test('sin los pagos configurados no hay Altas ni sección de suscripción', async () => {
  await levantar({ pagos: false });
  const { tienda } = await crearTienda(db, { nombre: 'Taller Luz', email: 'luz@taller.com', planId: planes.esencial });
  const r = await admin.pedir('/plataforma/altas');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/plataforma/clientes');
  const ficha = await pagina(`/plataforma/clientes/${tienda.id}`);
  assert.ok(!ficha.includes('<h2>Suscripción</h2>'));
  assert.ok(!ficha.includes('href="/plataforma/altas"'));
  assert.match(ficha, /Cobrás por fuera/);
});

test('hace falta ser superadministrador', async () => {
  const anonimo = crearNavegador(`http://127.0.0.1:${puerto}`);
  const r = await anonimo.pedir('/plataforma/altas');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/plataforma/ingresar');
});
