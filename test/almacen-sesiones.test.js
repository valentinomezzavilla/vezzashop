import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { abrirBase } from '../src/db.js';
import { AlmacenSesiones } from '../src/almacen-sesiones.js';

function preparar() {
  const almacen = new AlmacenSesiones(abrirBase(':memory:'));
  return {
    get: promisify(almacen.get.bind(almacen)),
    set: promisify(almacen.set.bind(almacen)),
    destroy: promisify(almacen.destroy.bind(almacen)),
  };
}

const enUnaHora = () => new Date(Date.now() + 3_600_000).toISOString();

test('guarda y recupera una sesión', async () => {
  const almacen = preparar();
  const sesion = { cookie: { expires: enUnaHora() }, usuario: { id: 1, tiendaId: 2 } };
  await almacen.set('abc', sesion);
  assert.deepEqual(await almacen.get('abc'), sesion);
});

test('una sesión vencida no se devuelve', async () => {
  const almacen = preparar();
  await almacen.set('abc', { cookie: { expires: new Date(Date.now() - 1000).toISOString() }, usuario: { id: 1 } });
  assert.equal(await almacen.get('abc'), null);
});

test('destroy borra la sesión', async () => {
  const almacen = preparar();
  await almacen.set('abc', { cookie: { expires: enUnaHora() } });
  await almacen.destroy('abc');
  assert.equal(await almacen.get('abc'), null);
});
