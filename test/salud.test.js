import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { pedirConHost } from './ayudantes.js';

let servidor;
let puerto;

before(async () => {
  const db = abrirBase(':memory:');
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

test('/salud responde ok (lo usa Coolify para saber si el contenedor anda)', async () => {
  const respuesta = await pedirConHost(puerto, 'localhost', '/salud');
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.cuerpo, 'ok');
  assert.equal(respuesta.headers['set-cookie'], undefined);
});

test('/salud responde aunque el host sea el subdominio de una tienda que no existe', async () => {
  const respuesta = await pedirConHost(puerto, 'no-existe.localhost', '/salud');
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.cuerpo, 'ok');
});
