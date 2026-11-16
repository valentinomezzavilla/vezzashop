// Fotos de la carga masiva: huellas, fotos por fila y por producto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { agregarFoto } from '../src/productos.js';
import { huellaDe } from '../src/imagenes.js';
import { completarHuellas } from '../src/importacion/fotos.js';
import { crearTiendaVacia, PNG } from './ayudantes.js';

test('completarHuellas calcula la huella de las fotos viejas y saltea las que no tienen archivo', async (t) => {
  const db = abrirBase(':memory:');
  const tiendaId = crearTiendaVacia(db, 'huellas');
  const dir = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const productoId = Number(
    db.prepare("INSERT INTO productos (tienda_id, slug, nombre) VALUES (?, 'p', 'P')").run(tiendaId).lastInsertRowid,
  );
  mkdirSync(path.join(dir, String(tiendaId)));
  writeFileSync(path.join(dir, String(tiendaId), 'vieja.png'), PNG);
  agregarFoto(db, tiendaId, productoId, 'vieja.png');
  agregarFoto(db, tiendaId, productoId, 'perdida.png');

  await completarHuellas(db, dir, tiendaId);

  assert.deepEqual(
    db.prepare('SELECT archivo, huella FROM producto_fotos ORDER BY id').all().map((f) => ({ ...f })),
    [
      { archivo: 'vieja.png', huella: huellaDe(PNG) },
      { archivo: 'perdida.png', huella: null },
    ],
  );
});
