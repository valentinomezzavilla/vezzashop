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

test('cada pantalla con campos de clave trae el botón para mostrarla, con sus íconos y sus textos', async () => {
  const anonimo = crearNavegador(base());
  const { clave } = await crearTienda(db, { nombre: 'Con Ojo', email: 'ojo@ejemplo.com' });
  const tienda = crearNavegador(base());
  assert.equal((await tienda.enviar('/admin/ingresar', { email: 'ojo@ejemplo.com', clave })).status, 302);
  const { clave: claveSuper } = await crearSuperadmin(db, { email: 'ojo@vezza.dev' });
  const superadmin = crearNavegador(base());
  assert.equal((await superadmin.enviar('/plataforma/ingresar', { email: 'ojo@vezza.dev', clave: claveSuper }, { desde: '/plataforma/ingresar' })).status, 302);

  // [navegador, pantalla, cuántos campos de clave tiene]
  const pantallas = [
    [anonimo, '/admin/ingresar', 1],
    [anonimo, '/plataforma/ingresar', 1],
    [tienda, '/admin/cuenta', 3],
    [superadmin, '/plataforma/cuenta', 3],
  ];
  for (const [nav, ruta, campos] of pantallas) {
    const respuesta = await nav.pedir(ruta);
    assert.equal(respuesta.status, 200, ruta);
    const html = await respuesta.text();
    assert.equal([...html.matchAll(/type="password"/g)].length, campos, `${ruta}: campos de clave`);
    const plantilla = html.match(/<template id="plantilla-ver-clave">([\s\S]*?)<\/template>/)?.[1];
    assert.ok(plantilla, `${ruta}: tiene la plantilla del botón`);
    assert.match(plantilla, /<button class="clave-ver" type="button" aria-pressed="false" aria-label="Mostrar la clave"/);
    assert.match(plantilla, /<span data-icono-oculta><svg/);
    assert.match(plantilla, /<span data-icono-visible hidden><svg/);
    assert.equal([...html.matchAll(/<template id="plantilla-ver-clave">/g)].length, 1, `${ruta}: una sola plantilla`);
  }
});

test('admin.js agrega el botón a todos los campos de clave y los vuelve a ocultar al enviar o salir de la página', () => {
  const js = readFileSync(new URL('../src/publico/admin.js', import.meta.url), 'utf8');
  assert.match(js, /document\.querySelectorAll\('input\[type="password"\]'\)/);
  assert.match(js, /entrada\.form\?\.addEventListener\('submit', \(\) => mostrar\(false\)\)/);
  assert.match(js, /addEventListener\('pagehide', \(\) => mostrar\(false\)\)/);
  for (const texto of ['Mostrar la clave', 'Ocultar la clave']) assert.ok(js.includes(texto));
  const css = readFileSync(new URL('../src/publico/admin.css', import.meta.url), 'utf8');
  assert.match(css, /\.clave-campo input \{ padding-right: 2\.9rem; \}/, 'el texto no queda debajo del botón');
});
