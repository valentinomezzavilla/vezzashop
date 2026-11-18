import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase } from '../src/db.js';
import { cargarPlanesSugeridos, listarPlanes, PLANES_SUGERIDOS, editarPlan } from '../src/plataforma.js';

test('cargar los planes sugeridos los crea una vez, no pisa lo editado y respeta los topes del sistema', async () => {
  const db = await abrirBase(':memory:');
  const nombres = async () => (await listarPlanes(db)).map((p) => p.nombre).sort();
  assert.deepEqual(await nombres(), ['Sin límites'], 'la migración deja solo el plan sin topes');

  const primera = await cargarPlanesSugeridos(db);
  assert.deepEqual(primera.creados, ['Prueba', 'Esencial', 'Acompañado', 'A medida']);
  assert.deepEqual(primera.existentes, []);
  assert.deepEqual(await nombres(), ['A medida', 'Acompañado', 'Esencial', 'Prueba', 'Sin límites']);

  const planes = Object.fromEntries((await listarPlanes(db)).map((p) => [p.nombre, p]));
  assert.deepEqual(
    { precio: planes.Esencial.precioCentavos, productos: planes.Esencial.maxProductos, fotos: planes.Esencial.maxFotos, banners: planes.Esencial.maxBanners, activo: planes.Esencial.activo },
    { precio: 1290000, productos: 150, fotos: 4, banners: 2, activo: true },
  );
  assert.equal(planes.Prueba.precioCentavos, 0);
  assert.deepEqual({ p: planes['A medida'].maxProductos, f: planes['A medida'].maxFotos, b: planes['A medida'].maxBanners }, { p: null, f: null, b: null });

  // Lo que se edita después no se pisa al volver a correrlo, aunque el nombre venga con otras mayúsculas.
  await editarPlan(db, planes.Esencial.id, { nombre: 'ESENCIAL', precioCentavos: 1500000, maxProductos: 200, maxFotos: 4, maxBanners: 2, activo: true });
  const segunda = await cargarPlanesSugeridos(db);
  assert.deepEqual(segunda.creados, []);
  assert.deepEqual(segunda.existentes, ['Prueba', 'Esencial', 'Acompañado', 'A medida']);
  assert.equal((await listarPlanes(db)).find((p) => p.id === planes.Esencial.id).precioCentavos, 1500000);
  assert.equal((await listarPlanes(db)).length, 5);

  // Ningún plan sugerido pide más de lo que el sistema permite (10 fotos por producto, 6 banners).
  for (const plan of PLANES_SUGERIDOS) {
    assert.ok(plan.maxFotos === null || (plan.maxFotos >= 1 && plan.maxFotos <= 10), `${plan.nombre}: fotos`);
    assert.ok(plan.maxBanners === null || (plan.maxBanners >= 0 && plan.maxBanners <= 6), `${plan.nombre}: banners`);
  }
});
