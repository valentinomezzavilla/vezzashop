import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda, validarLink, cambiarLinkDeTienda, soltarEnlaceAnterior, enlaceActualDeAnterior, listarEnlacesAnteriores } from '../src/tiendas.js';
import { crearSuperadmin, resetearClaveDeCliente } from '../src/plataforma.js';
import { crearNavegador, pedirConHost, enviarConHost } from './ayudantes.js';

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

let contador = 0;
const unico = (prefijo) => `${prefijo}${(contador += 1)}x${Date.now().toString(36)}`;
const nueva = async (nombre = unico('tienda')) => (await crearTienda(db, { nombre, email: `${unico('d')}@ejemplo.com` })).tienda;
const slugDe = async (id) => (await db.prepare('SELECT slug FROM tiendas WHERE id = ?').get(id)).slug;

test('validarLink arma el link como siempre y rechaza lo que no sirve', async () => {
  assert.deepEqual(await validarLink(db, '  Ufo   Ambos Ñandú '), { slug: 'ufo-ambos-nandu' });
  assert.deepEqual(await validarLink(db, 'https://mi-tienda.vezzadev.com/'), { slug: 'mi-tienda' }, 'si pegan el link completo, se queda con el subdominio');
  for (const [texto, mensaje] of [['', /Escribí el link/], ['!!!', /Escribí el link/], ['a'.repeat(64), /muy largo/], ['WWW', /reservado/], ['plataforma', /reservado/]]) {
    assert.match((await validarLink(db, texto)).error, mensaje, `rechaza ${JSON.stringify(texto)}`);
  }
  const otra = await nueva();
  assert.match((await validarLink(db, otra.slug)).error, /ya lo usa otra tienda/);
  assert.deepEqual(await validarLink(db, otra.slug, { tiendaId: otra.id }), { slug: otra.slug }, 'el propio link no cuenta como ocupado');
});

test('cambiar el link guarda el anterior; los links viejos de varios cambios llevan al actual', async () => {
  const tienda = await nueva();
  const a = tienda.slug;
  const b = unico('nuevo');
  const c = unico('otro');

  assert.deepEqual(await cambiarLinkDeTienda(db, tienda.id, b), { slug: b, anterior: a });
  assert.equal(await slugDe(tienda.id), b);
  assert.equal(await enlaceActualDeAnterior(db, a), b);
  assert.equal(await enlaceActualDeAnterior(db, b), null, 'el actual no es un link anterior');

  await cambiarLinkDeTienda(db, tienda.id, c);
  assert.equal(await enlaceActualDeAnterior(db, a), c, 'el primero también lleva al último');
  assert.equal(await enlaceActualDeAnterior(db, b), c);
  assert.deepEqual((await listarEnlacesAnteriores(db, tienda.id)).map((e) => e.slug).sort(), [a, b].sort());

  // Volver a uno que ya tuvo: deja de ser "anterior" y el que se deja pasa a serlo.
  await cambiarLinkDeTienda(db, tienda.id, a);
  assert.equal(await slugDe(tienda.id), a);
  assert.equal(await enlaceActualDeAnterior(db, a), null);
  assert.equal(await enlaceActualDeAnterior(db, c), a);

  assert.match((await cambiarLinkDeTienda(db, tienda.id, a)).error, /ya es el link/);
  assert.match((await cambiarLinkDeTienda(db, 999999, 'x-y')).error, /no existe/);
});

test('un link no se puede quitar a otra tienda, ni siquiera uno que ya no usa, hasta que se lo suelta', async () => {
  const duena = await nueva();
  const vieja = duena.slug;
  await cambiarLinkDeTienda(db, duena.id, unico('nuevo'));
  const otra = await nueva();

  assert.match((await cambiarLinkDeTienda(db, otra.id, vieja)).error, /todavía redirige/);
  await assert.rejects(crearTienda(db, { nombre: 'Otra tienda', email: `${unico('d')}@ejemplo.com`, slug: vieja }), /todavía redirige/);
  await assert.rejects(crearTienda(db, { nombre: vieja, email: `${unico('d')}@ejemplo.com` }), /todavía redirige/, 'ni con un nombre que da el mismo link');

  // Solo la dueña lo puede soltar.
  assert.equal(await soltarEnlaceAnterior(db, otra.id, vieja), false);
  assert.equal(await enlaceActualDeAnterior(db, vieja) !== null, true);
  assert.equal(await soltarEnlaceAnterior(db, duena.id, vieja), true);
  assert.equal(await enlaceActualDeAnterior(db, vieja), null);
  assert.deepEqual(await cambiarLinkDeTienda(db, otra.id, vieja), { slug: vieja, anterior: otra.slug });
});

test('al dar de alta se puede elegir el link; si no, sale del nombre', async () => {
  const elegido = unico('elegido');
  const { tienda } = await crearTienda(db, { nombre: 'Nombre Distinto', email: `${unico('d')}@ejemplo.com`, slug: `  ${elegido.toUpperCase()} ` });
  assert.equal(tienda.slug, elegido);
  assert.equal((await crearTienda(db, { nombre: 'Café Sur', email: `${unico('d')}@ejemplo.com`, slug: '' })).tienda.slug, 'cafe-sur');
  await assert.rejects(crearTienda(db, { nombre: 'X Y', email: `${unico('d')}@ejemplo.com`, slug: 'admin' }), /reservado/);
  await assert.rejects(crearTienda(db, { nombre: 'X Z', email: `${unico('d')}@ejemplo.com`, slug: elegido }), /ya lo usa otra tienda/);
});

// ---------- Desde la plataforma ----------

async function superadmin() {
  const email = `${unico('super')}@vezza.dev`;
  const { clave } = await crearSuperadmin(db, { email });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' })).status, 302);
  return nav;
}

test('desde la ficha del cliente se cambia el link: el nuevo abre la tienda y el anterior redirige', async () => {
  const admin = await superadmin();
  const { tienda } = await crearTienda(db, { nombre: unico('cliente'), email: `${unico('d')}@ejemplo.com` });
  const viejo = tienda.slug;
  const ficha = `/plataforma/clientes/${tienda.id}`;
  const html = await (await admin.pedir(ficha)).text();
  assert.match(html, /<h2>Link de la tienda<\/h2>/);
  assert.match(html, new RegExp(`name="slug" value="${viejo}"`));
  assert.match(html, /<span class="sufijo" aria-hidden="true">\.localhost:\d+<\/span>/, 'muestra el dominio alrededor del campo');

  const nuevo = unico('nuevo');
  const respuesta = await admin.enviar(`${ficha}/enlace`, { slug: nuevo }, { desde: ficha });
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), ficha);
  const despues = await (await admin.pedir(ficha)).text();
  assert.match(despues, new RegExp(`Cambiamos el link: ahora la tienda está en ${nuevo}\\.localhost:\\d+\\. El anterior \\(${viejo}\\) redirige al nuevo\\.`));
  assert.match(despues, /<h3>Links anteriores<\/h3>/);
  assert.match(despues, new RegExp(`${viejo}\\.localhost`));

  // El link nuevo abre la tienda; el anterior redirige (con el mismo camino y las mismas búsquedas) y no se guarda en caché.
  assert.equal((await pedirConHost(puerto, `${nuevo}.localhost`, '/')).status, 200);
  const redireccion = await pedirConHost(puerto, `${viejo}.localhost`, '/categoria/ofertas?orden=precio-menor');
  assert.equal(redireccion.status, 301);
  assert.equal(redireccion.location, `http://${nuevo}.localhost:${puerto}/categoria/ofertas?orden=precio-menor`);
  assert.equal(redireccion.headers['cache-control'], 'no-store');
  // Los pedidos que no son de lectura conservan el método (308).
  const envio = await enviarConHost(puerto, `${viejo}.localhost`, '/checkout', { nombre: 'x' });
  assert.equal(envio.status, 308);
  assert.equal(envio.location, `http://${nuevo}.localhost:${puerto}/checkout`);
  // Un link que nunca existió sigue dando "no existe".
  assert.equal((await pedirConHost(puerto, `${unico('nunca')}.localhost`, '/')).status, 404);

  // El panel del cliente ya muestra el link nuevo.
  const panel = crearNavegador(`http://127.0.0.1:${puerto}`);
  const email = (await db.prepare('SELECT email FROM usuarios WHERE tienda_id = ?').get(tienda.id)).email;
  const { clave } = await resetearClaveDeCliente(db, tienda.id);
  assert.equal((await panel.enviar('/admin/ingresar', { email, clave })).status, 302);
  assert.match(await (await panel.pedir('/admin/cuenta')).text(), new RegExp(`${nuevo}\\.localhost`));
});

test('la ficha avisa si el link no sirve y no cambia nada; un link anterior se puede soltar', async () => {
  const admin = await superadmin();
  const { tienda } = await crearTienda(db, { nombre: unico('cliente'), email: `${unico('d')}@ejemplo.com` });
  const ocupada = await nueva();
  const ficha = `/plataforma/clientes/${tienda.id}`;

  for (const [slug, mensaje] of [['admin', /reservado/], ['!!!', /Escribí el link/], [ocupada.slug, /ya lo usa otra tienda/], [tienda.slug, /ya es el link/]]) {
    const respuesta = await admin.enviar(`${ficha}/enlace`, { slug }, { desde: ficha });
    assert.equal(respuesta.status, 400, `rechaza ${slug}`);
    assert.match(await respuesta.text(), mensaje);
  }
  assert.equal(await slugDe(tienda.id), tienda.slug, 'no cambió nada');

  const nuevo = unico('nuevo');
  await admin.enviar(`${ficha}/enlace`, { slug: nuevo }, { desde: ficha });
  assert.equal((await pedirConHost(puerto, `${tienda.slug}.localhost`, '/')).status, 301);

  // Otra tienda no puede quedarse con el link que dejó, pero sí después de soltarlo.
  const intruso = await nueva();
  const fichaIntruso = `/plataforma/clientes/${intruso.id}`;
  assert.equal((await admin.enviar(`${fichaIntruso}/enlace`, { slug: tienda.slug }, { desde: fichaIntruso })).status, 400);
  assert.equal((await admin.enviar(`${fichaIntruso}/enlaces/soltar`, { slug: tienda.slug }, { desde: fichaIntruso })).status, 302);
  assert.match(await (await admin.pedir(fichaIntruso)).text(), /no estaba entre los anteriores/, 'no se puede soltar el link de otro');
  assert.equal((await pedirConHost(puerto, `${tienda.slug}.localhost`, '/')).status, 301, 'sigue redirigiendo');

  assert.equal((await admin.enviar(`${ficha}/enlaces/soltar`, { slug: tienda.slug }, { desde: ficha })).status, 302);
  assert.match(await (await admin.pedir(ficha)).text(), /dejó de redirigir/);
  assert.equal((await pedirConHost(puerto, `${tienda.slug}.localhost`, '/')).status, 404, 'ya no redirige');
  assert.equal((await admin.enviar(`${fichaIntruso}/enlace`, { slug: tienda.slug }, { desde: fichaIntruso })).status, 302, 'ahora sí lo puede usar');
});

test('al dar de alta un cliente desde la plataforma se puede elegir el link', async () => {
  const admin = await superadmin();
  const plan = (await db.prepare('INSERT INTO planes (nombre, precio_centavos) VALUES (?, ?) RETURNING id').run(unico('Plan'), 1000)).rows[0].id;
  const formulario = await (await admin.pedir('/plataforma/clientes/nuevo')).text();
  assert.match(formulario, /name="slug"/);

  const elegido = unico('elegido');
  const respuesta = await admin.enviar('/plataforma/clientes/nuevo', { nombre: 'Nombre cualquiera', email: `${unico('d')}@c.com`, planId: String(plan), slug: elegido });
  assert.equal(respuesta.status, 200);
  assert.match(await respuesta.text(), new RegExp(`${elegido}\\.localhost`));
  assert.ok(await db.prepare('SELECT 1 FROM tiendas WHERE slug = ?').get(elegido));

  const repetido = await admin.enviar('/plataforma/clientes/nuevo', { nombre: unico('Otro'), email: `${unico('d')}@c.com`, planId: String(plan), slug: elegido });
  assert.equal(repetido.status, 400);
  assert.match(await repetido.text(), /ya lo usa otra tienda/);
});
