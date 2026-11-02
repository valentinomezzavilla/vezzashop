import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { crearTienda, autenticar } from '../src/tiendas.js';

test('crearTienda da una clave con la que el dueño puede ingresar a su tienda', async () => {
  const db = abrirBase(':memory:');
  const { tienda, clave } = await crearTienda(db, { nombre: 'Almacén Doña Rosa', email: 'rosa@ejemplo.com' });

  assert.equal(tienda.slug, 'almacen-dona-rosa');
  const usuario = await autenticar(db, 'Rosa@Ejemplo.com', clave);
  assert.equal(usuario.tiendaId, tienda.id);
  assert.equal(usuario.email, 'rosa@ejemplo.com');
});

test('autenticar rechaza clave incorrecta y email inexistente', async () => {
  const db = abrirBase(':memory:');
  const { clave } = await crearTienda(db, { nombre: 'Tienda', email: 'a@ejemplo.com' });

  assert.equal(await autenticar(db, 'a@ejemplo.com', clave + 'x'), null);
  assert.equal(await autenticar(db, 'nadie@ejemplo.com', clave), null);
});

test('cada tienda genera una clave distinta', async () => {
  const db = abrirBase(':memory:');
  const a = await crearTienda(db, { nombre: 'Uno', email: 'uno@ejemplo.com' });
  const b = await crearTienda(db, { nombre: 'Dos', email: 'dos@ejemplo.com' });
  assert.notEqual(a.clave, b.clave);
  assert.ok(a.clave.length >= 16);
  assert.equal(await autenticar(db, 'uno@ejemplo.com', b.clave), null);
});

test('no deja repetir email ni nombre de tienda', async () => {
  const db = abrirBase(':memory:');
  await crearTienda(db, { nombre: 'Uno', email: 'uno@ejemplo.com' });
  await assert.rejects(crearTienda(db, { nombre: 'Otra', email: 'UNO@ejemplo.com' }), /email/i);
  await assert.rejects(crearTienda(db, { nombre: 'uno', email: 'otro@ejemplo.com' }), /nombre/i);
});

test('reabrir la base guarda los datos y no vuelve a aplicar migraciones', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'plataforma-'));
  try {
    const ruta = path.join(dir, 'prueba.db');
    const db1 = abrirBase(ruta);
    const { clave } = await crearTienda(db1, { nombre: 'Persistente', email: 'p@ejemplo.com' });
    db1.close();

    const db2 = abrirBase(ruta);
    assert.ok(await autenticar(db2, 'p@ejemplo.com', clave));
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
