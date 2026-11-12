import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase } from '../src/db.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { previsualizar, aplicarImportacion, ErrorDeImportacion } from '../src/importacion/aplicar.js';
import { leerCatalogo, crearTiendaVacia } from './ayudantes.js';

const ENCABEZADOS = ['SKU', 'Nombre', 'Descripción', 'Categorías', 'Precio', 'Stock', 'Atributo 1', 'Valor 1'];
const CATALOGO_INICIAL = [
  ENCABEZADOS,
  ['REM-S', 'Remera Básica', 'Algodón', 'Ropa > Remeras', 12500, 10, 'Talle', 'S'],
  ['REM-M', 'Remera Básica', null, null, 12500, 5, null, 'M'],
  ['GORRA', 'Gorra', null, 'Accesorios', 8000, 3, null, null],
];

async function preparar() {
  const db = await abrirBase(':memory:');
  return { db, tiendaId: await crearTiendaVacia(db, 'principal') };
}

function importar(db, tiendaId, hoja) {
  const { productos, errores } = interpretarHoja(hoja);
  assert.deepEqual(errores, [], 'la hoja de prueba no debería tener errores de formato');
  return aplicarImportacion(db, tiendaId, productos);
}

test('crea productos, variantes y categorías nuevas', async () => {
  const { db, tiendaId } = await preparar();
  const resumen = await importar(db, tiendaId, CATALOGO_INICIAL);

  assert.deepEqual(resumen, { productosNuevos: 2, productosActualizados: 0, variantesNuevas: 3, variantesActualizadas: 0 });
  assert.deepEqual((await leerCatalogo(db, tiendaId)), [
    {
      nombre: 'Gorra', descripcion: '', visible: 1, atributos: [], categorias: ['Accesorios'],
      variantes: [{ sku: 'GORRA', valores: [], precio: 800000, stock: 3 }],
    },
    {
      nombre: 'Remera Básica', descripcion: 'Algodón', visible: 1, atributos: ['Talle'], categorias: ['Ropa > Remeras'],
      variantes: [
        { sku: 'REM-M', valores: ['M'], precio: 1250000, stock: 5 },
        { sku: 'REM-S', valores: ['S'], precio: 1250000, stock: 10 },
      ],
    },
  ]);
});

test('importar dos veces el mismo Excel no duplica nada', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);
  const antes = (await leerCatalogo(db, tiendaId));

  const resumen = await importar(db, tiendaId, CATALOGO_INICIAL);

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 2, variantesNuevas: 0, variantesActualizadas: 3 });
  assert.deepEqual((await leerCatalogo(db, tiendaId)), antes);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM categorias').get()).n, 3);
});

test('las celdas vacías no pisan lo que ya estaba cargado', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);

  await importar(db, tiendaId, [['SKU', 'Nombre', 'Stock'], ['REM-S', 'remera basica', 99]]);

  const remera = (await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Remera Básica');
  assert.equal(remera.descripcion, 'Algodón');
  assert.deepEqual(remera.categorias, ['Ropa > Remeras']);
  assert.deepEqual(remera.atributos, ['Talle']);
  assert.deepEqual(remera.variantes.find((v) => v.sku === 'REM-S'), { sku: 'REM-S', valores: ['S'], precio: 1250000, stock: 99 });
});

test('si el Excel trae categorías, reemplazan a las anteriores', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);

  await importar(db, tiendaId, [['SKU', 'Nombre', 'Categorías'], ['GORRA', 'Gorra', 'Ofertas, Accesorios > Cabeza']]);

  const gorra = (await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Gorra');
  assert.deepEqual(gorra.categorias, ['Accesorios > Cabeza', 'Ofertas']);
});

test('no toca los productos que no están en el Excel', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);
  const gorraAntes = (await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Gorra');

  await importar(db, tiendaId, [['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 3000, 4]]);

  const catalogo = (await leerCatalogo(db, tiendaId));
  assert.deepEqual(catalogo.map((p) => p.nombre), ['Gorra', 'Remera Básica', 'Taza']);
  assert.deepEqual(catalogo.find((p) => p.nombre === 'Gorra'), gorraAntes);
});

test('agrega una variante nueva a un producto que ya existe', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);

  const resumen = await importar(db, tiendaId, [ENCABEZADOS, ['REM-L', 'Remera Básica', null, null, 13000, 2, 'Talle', 'L']]);

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 1, variantesNuevas: 1, variantesActualizadas: 0 });
  const remera = (await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Remera Básica');
  assert.deepEqual(remera.variantes.map((v) => v.sku), ['REM-L', 'REM-M', 'REM-S']);
});

test('una variante nueva sin precio es un error y no se guarda nada del archivo', async () => {
  const { db, tiendaId } = await preparar();
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio'],
    ['TAZA', 'Taza', 3000],
    ['PLATO', 'Plato', null],
  ]);

  const { errores } = await previsualizar(db, tiendaId, productos);
  assert.equal(errores.length, 1);
  assert.equal(errores[0].fila, 3);
  assert.match(errores[0].mensaje, /precio/i);

  await assert.rejects(aplicarImportacion(db, tiendaId, productos), ErrorDeImportacion);
  assert.deepEqual((await leerCatalogo(db, tiendaId)), []);
});

test('un SKU que ya pertenece a otro producto es un error', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio'], ['GORRA', 'Visera', 5000]]);

  const { errores } = await previsualizar(db, tiendaId, productos);

  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /GORRA.*Gorra/);
});

test('no deja cambiar los atributos de un producto que ya tiene variantes', async () => {
  const { db, tiendaId } = await preparar();
  await importar(db, tiendaId, CATALOGO_INICIAL);
  const { productos } = interpretarHoja([ENCABEZADOS, ['REM-ROJA', 'Remera Básica', null, null, 12500, 1, 'Color', 'Rojo']]);

  const { errores } = await previsualizar(db, tiendaId, productos);

  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /Talle.*Color/);
});

test('cada tienda tiene su propio catálogo aunque repitan SKU', async () => {
  const { db, tiendaId } = await preparar();
  const otraTiendaId = await crearTiendaVacia(db, 'otra');
  await importar(db, tiendaId, CATALOGO_INICIAL);

  const resumen = await importar(db, otraTiendaId, [['SKU', 'Nombre', 'Precio'], ['GORRA', 'Gorra', 9999]]);

  assert.deepEqual(resumen, { productosNuevos: 1, productosActualizados: 0, variantesNuevas: 1, variantesActualizadas: 0 });
  assert.equal((await leerCatalogo(db, otraTiendaId))[0].variantes[0].precio, 999900);
  assert.equal((await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Gorra').variantes[0].precio, 800000);
});
