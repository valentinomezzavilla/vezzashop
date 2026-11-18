import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearSuperadmin } from '../src/plataforma.js';
import { vezza } from '../src/util/vezza.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

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
const archivo = (ruta) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), 'utf8');
const NEGRO = '#13121a';
const INDIGO = '#3b2ee4';

test('los SVG del logo: la versión para fondo oscuro es la misma figura con otros colores', () => {
  for (const nombre of ['logo', 'logo-oscuro', 'marca', 'marca-oscura', 'icono']) {
    const svg = archivo(`publico/vezza/${nombre}.svg`);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/, `${nombre} es un SVG con viewBox`);
    assert.match(svg, /aria-label="Vezza"/);
  }
  const igual = (claro, oscuro) =>
    assert.equal(archivo(`publico/vezza/${oscuro}.svg`).replaceAll('#f5f5f7', NEGRO).replaceAll('#7a72ff', INDIGO), archivo(`publico/vezza/${claro}.svg`));
  igual('logo', 'logo-oscuro');
  igual('marca', 'marca-oscura');
  // El ícono de la pestaña cambia de color según el modo del sistema, porque no hereda el CSS de la página.
  const icono = archivo('publico/vezza/icono.svg');
  assert.match(icono, /@media \(prefers-color-scheme:dark\)/);
});

test('vezza(): el SVG se incrusta con los colores del tema, sin tamaño fijo, y la firma lleva "Desarrollado por"', () => {
  const logo = vezza();
  assert.match(logo, /^<svg class="vezza-logo" /);
  assert.ok(!logo.includes(NEGRO) && !logo.includes(INDIGO), 'los colores fijos salen: los pone el CSS');
  assert.match(logo, /currentColor/);
  assert.match(logo, /class="vz-a"/);
  assert.ok(!/<svg[^>]* width=/.test(logo), 'el tamaño lo da el CSS');
  assert.match(logo, /role="img" aria-label="Vezza"/);

  const marca = vezza({ forma: 'marca', decorativo: true });
  assert.match(marca, /^<svg class="vezza-marca" /);
  assert.match(marca, /aria-hidden="true"/);
  assert.ok(!marca.includes('role="img"'));

  const firma = vezza({ etiqueta: true, clase: 'vezza-grande' });
  assert.match(firma, /^<span class="vezza-firma vezza-grande"><span class="vezza-etiqueta">Desarrollado por<\/span><svg /);
  assert.throws(() => vezza({ forma: 'otra' }), /Forma de logo desconocida/);
});

test('el CSS: los colores del logo existen en claro y en los dos oscuros, y la tienda conserva los de la marca', () => {
  const panel = archivo('publico/admin.css');
  assert.match(panel, /--vezza-tinta: #13121a;\s*--vezza-acento: #3b2ee4;/);
  assert.equal([...panel.matchAll(/--vezza-tinta: #f5f5f7;\s*--vezza-acento: #7a72ff;/g)].length, 2, 'oscuro del sistema y oscuro elegido');
  const tienda = archivo('publico/tienda.css');
  assert.match(tienda, /\.vezza-firma \{ --vezza-tinta: #13121a; --vezza-acento: #3b2ee4;/);
});

test('la plataforma usa el logo de Vezza: ingreso con el formato "Desarrollado por", menú y ícono de la pestaña', async () => {
  const ingreso = (await pedirConHost(puerto, 'localhost', '/plataforma/ingresar')).cuerpo;
  assert.match(ingreso, /<div class="ingreso-vezza"><span class="vezza-firma vezza-grande"><span class="vezza-etiqueta">Desarrollado por<\/span><svg class="vezza-logo"/);
  assert.match(ingreso, /<link rel="icon" href="\/vezza\/icono\.svg" type="image\/svg\+xml">/);
  assert.ok(!ingreso.includes('ingreso-icono'), 'ya no hay ícono genérico');

  const email = 'logo@vezza.dev';
  const { clave } = await crearSuperadmin(db, { email });
  const nav = crearNavegador(base());
  await nav.enviar('/plataforma/ingresar', { email, clave }, { desde: '/plataforma/ingresar' });
  const clientes = await (await nav.pedir('/plataforma/clientes')).text();
  assert.equal([...clientes.matchAll(/<span class="lateral-vezza"><svg class="vezza-marca"/g)].length, 2, 'la marca va en la barra del celular y en el menú');
  assert.match(clientes, /<div class="lateral-firma"><span class="vezza-firma">/);
});

test('el logo se sirve como SVG', async () => {
  const respuesta = await fetch(`${base()}/vezza/icono.svg`);
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers.get('content-type'), /image\/svg\+xml/);
});

test('cada panel de tienda lleva la firma de Vezza, al ingresar y en el menú, y la vidriera en el pie', async () => {
  const ingreso = (await pedirConHost(puerto, 'localhost', '/admin/ingresar')).cuerpo;
  assert.match(ingreso, /<div class="ingreso-firma"><span class="vezza-firma">/);
  assert.match(ingreso, /rel="icon" href="\/vezza\/icono\.svg"/);

  const { clave } = await crearTienda(db, { nombre: 'Con Firma', email: 'firma@ejemplo.com' });
  const nav = crearNavegador(base());
  await nav.enviar('/admin/ingresar', { email: 'firma@ejemplo.com', clave });
  const inicio = await (await nav.pedir('/admin/inicio')).text();
  assert.match(inicio, /<div class="lateral-firma"><span class="vezza-firma">/);

  const tienda = (await pedirConHost(puerto, 'con-firma.localhost', '/')).cuerpo;
  assert.match(tienda, /<p class="pie-copyright">\s*<span>© \d{4} Con Firma\. Todos los derechos reservados\.<\/span>\s*<span class="vezza-firma">/);
});
