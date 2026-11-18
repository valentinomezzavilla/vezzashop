import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearSuperadmin } from '../src/plataforma.js';
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

const base = () => `http://127.0.0.1:${puerto}`;
let contador = 0;
const unico = (prefijo) => `${prefijo}${(contador += 1)}`;

async function ingresarComoSuperadmin(nav) {
  const email = `${unico('super')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const respuesta = await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
  assert.equal(respuesta.status, 302);
  return { email, clave };
}

async function ingresarEnUnaTienda(nav) {
  const email = `${unico('duenio')}@cliente.com`;
  const { clave } = await crearTienda(db, { nombre: unico('Tienda'), email });
  const respuesta = await nav.enviar('/admin/ingresar', { email, clave });
  assert.equal(respuesta.status, 302);
  return { email, clave };
}

// El vencimiento que trae la cookie (express-session lo manda como Expires).
const horaDeVencimiento = (cookie) => new Date(cookie.match(/Expires=([^;]+)/)[1]).getTime();

const estaAdentro = async (nav, ruta) => (await nav.pedir(ruta)).status === 200;

test('el ingreso a una tienda en el mismo navegador no cierra la sesión de la plataforma, ni al revés', async () => {
  const nav = crearNavegador(base());
  await ingresarComoSuperadmin(nav);
  assert.ok(await estaAdentro(nav, '/plataforma/clientes'));

  await ingresarEnUnaTienda(nav);
  assert.ok(await estaAdentro(nav, '/admin/inicio'), 'entró al panel de la tienda');
  assert.ok(await estaAdentro(nav, '/plataforma/clientes'), 'la sesión de la plataforma sigue abierta');

  // Salir del panel de la tienda tampoco toca la plataforma...
  assert.equal((await nav.enviar('/admin/salir', {}, { desde: '/admin/inicio' })).status, 302);
  assert.equal((await nav.pedir('/admin/inicio')).status, 302, 'la tienda quedó cerrada');
  assert.ok(await estaAdentro(nav, '/plataforma/clientes'), 'la plataforma sigue abierta después de salir de la tienda');

  // ...ni salir de la plataforma toca la tienda.
  await ingresarEnUnaTienda(nav);
  assert.equal((await nav.enviar('/plataforma/salir', {}, { desde: '/plataforma/clientes' })).status, 302);
  assert.equal((await nav.pedir('/plataforma/clientes')).status, 302, 'la plataforma quedó cerrada');
  assert.ok(await estaAdentro(nav, '/admin/inicio'), 'la tienda sigue abierta después de salir de la plataforma');
});

test('quien ingresa desde otro navegador tampoco afecta la sesión de la plataforma', async () => {
  const admin = crearNavegador(base());
  await ingresarComoSuperadmin(admin);
  for (let i = 0; i < 3; i++) {
    const otra = crearNavegador(base());
    await ingresarEnUnaTienda(otra);
    assert.ok(await estaAdentro(otra, '/admin/inicio'));
    await otra.enviar('/admin/salir', {}, { desde: '/admin/inicio' });
  }
  assert.ok(await estaAdentro(admin, '/plataforma/clientes'));
});

test('la sesión de la plataforma tiene su propia cookie, que dura más y se renueva mientras se usa', async () => {
  const nav = crearNavegador(base());
  const email = `${unico('persiste')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const ingreso = await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
  const cookie = ingreso.headers.getSetCookie().find((c) => c.startsWith('sesion-plataforma='));
  assert.ok(cookie, 'la plataforma usa su propia cookie');
  assert.match(cookie, /Path=\/plataforma/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  const dias = (horaDeVencimiento(cookie) - Date.now()) / 86_400_000;
  assert.ok(dias >= 14 && dias <= 16, `dura unos 15 días (son ${dias.toFixed(2)})`);

  // El panel de una tienda sigue con su cookie de siempre, de 8 horas, y ingresar a una tienda no toca la de la plataforma.
  const otro = crearNavegador(base());
  const ingresoTienda = await otro.enviar('/admin/ingresar', await (async () => {
    const emailTienda = `${unico('duenio')}@cliente.com`;
    const { clave: claveTienda } = await crearTienda(db, { nombre: unico('Tienda'), email: emailTienda });
    return { email: emailTienda, clave: claveTienda };
  })());
  const cookiesTienda = ingresoTienda.headers.getSetCookie();
  const cookieTienda = cookiesTienda.find((c) => c.startsWith('sesion='));
  assert.ok(cookieTienda, 'la tienda sigue usando la cookie "sesion"');
  const horas = (horaDeVencimiento(cookieTienda) - Date.now()) / 3_600_000;
  assert.ok(horas > 7.9 && horas <= 8, `dura 8 horas (son ${horas.toFixed(2)})`);
  assert.ok(!cookiesTienda.some((c) => c.startsWith('sesion-plataforma=')));

  // Mientras se usa, el vencimiento se corre hacia adelante.
  const vencimiento = async () => Number((await db.prepare('SELECT max(expira) AS expira FROM sesiones WHERE datos LIKE ?').get('%"superadmin"%')).expira);
  const antes = await vencimiento();
  await new Promise((resolver) => setTimeout(resolver, 1100));
  assert.equal((await nav.pedir('/plataforma/clientes')).status, 200);
  assert.ok((await vencimiento()) > antes, 'el vencimiento se renovó con la actividad');
});

test('salir de la plataforma borra su cookie', async () => {
  const nav = crearNavegador(base());
  await ingresarComoSuperadmin(nav);
  const salida = await nav.enviar('/plataforma/salir', {}, { desde: '/plataforma/clientes' });
  const borrada = salida.headers.getSetCookie().find((c) => c.startsWith('sesion-plataforma='));
  assert.ok(borrada, 'manda a borrar la cookie');
  assert.match(borrada, /Path=\/plataforma/);
  assert.match(borrada, /Expires=Thu, 01 Jan 1970/);
});

test('cada ingreso estrena sesión: una cookie puesta antes del ingreso deja de servir', async () => {
  const nav = crearNavegador(base());
  const antes = await nav.pedir('/plataforma/ingresar'); // crea una sesión con el token CSRF
  const idAntes = antes.headers.getSetCookie().find((c) => c.startsWith('sesion-plataforma='))?.split(';')[0];
  assert.ok(idAntes, 'la pantalla de ingreso ya tiene su cookie');
  const email = `${unico('fija')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const ingreso = await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
  const idDespues = ingreso.headers.getSetCookie().find((c) => c.startsWith('sesion-plataforma='))?.split(';')[0];
  assert.ok(idDespues && idDespues !== idAntes, 'el ingreso cambia el identificador de la sesión');
});
