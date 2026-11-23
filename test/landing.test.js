import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { pedirConHost } from './ayudantes.js';

const PUBLICO = path.join(import.meta.dirname, '..', 'src', 'publico');
let servidor;
let puerto;

before(async () => {
  const db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => servidor.close());

test('el dominio principal muestra la landing, sin crear sesión', async () => {
  const respuesta = await pedirConHost(puerto, 'localhost', '/');
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers['content-type'], /text\/html/);
  assert.match(respuesta.cuerpo, /<title>VEZZA Shop/);
  assert.equal(respuesta.headers['set-cookie'], undefined);
});

test('la landing lleva al panel, que sigue en /admin', async () => {
  const landing = (await pedirConHost(puerto, 'localhost', '/')).cuerpo;
  assert.match(landing, /href="\/admin"/);
  const panel = await pedirConHost(puerto, 'localhost', '/admin');
  assert.equal(panel.status, 302);
  assert.equal(panel.location, '/admin/ingresar');
});

test('todas las imágenes y archivos que usa la landing existen', async () => {
  const landing = (await pedirConHost(puerto, 'localhost', '/')).cuerpo;
  const locales = [...landing.matchAll(/(?:src|href|content)="(\/(?:landing|vezza)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(locales.length > 10, 'la landing debería usar varias imágenes');
  for (const ruta of new Set(locales)) {
    assert.ok(existsSync(path.join(PUBLICO, ruta)), `falta ${ruta}`);
    assert.equal((await pedirConHost(puerto, 'localhost', ruta)).status, 200, `${ruta} no se sirve`);
  }
});

test('la landing no rompe las tiendas: un subdominio sin tienda sigue dando 404', async () => {
  assert.equal((await pedirConHost(puerto, 'no-existe.localhost', '/')).status, 404);
});
