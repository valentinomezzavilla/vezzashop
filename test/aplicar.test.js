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

function preparar() {
  const db = abrirBase(':memory:');
  return { db, tiendaId: crearTiendaVacia(db, 'principal') };
}

function importar(db, tiendaId, hoja) {
  const { productos, errores } = interpretarHoja(hoja);
  assert.deepEqual(errores, [], 'la hoja de prueba no debería tener errores de formato');
  return aplicarImportacion(db, tiendaId, productos);
}

test('crea productos, variantes y categorías nuevas', () => {
  const { db, tiendaId } = preparar();
  const resumen = importar(db, tiendaId, CATALOGO_INICIAL);

  assert.deepEqual(resumen, { productosNuevos: 2, productosActualizados: 0, variantesNuevas: 3, variantesActualizadas: 0 });
  assert.deepEqual(leerCatalogo(db, tiendaId), [
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

test('importar dos veces el mismo Excel no duplica nada', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);
  const antes = leerCatalogo(db, tiendaId);

  const resumen = importar(db, tiendaId, CATALOGO_INICIAL);

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 2, variantesNuevas: 0, variantesActualizadas: 3 });
  assert.deepEqual(leerCatalogo(db, tiendaId), antes);
  assert.equal(db.prepare('SELECT count(*) AS n FROM categorias').get().n, 3);
});

test('las celdas vacías no pisan lo que ya estaba cargado', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);

  importar(db, tiendaId, [['SKU', 'Nombre', 'Stock'], ['REM-S', 'remera basica', 99]]);

  const remera = leerCatalogo(db, tiendaId).find((p) => p.nombre === 'Remera Básica');
  assert.equal(remera.descripcion, 'Algodón');
  assert.deepEqual(remera.categorias, ['Ropa > Remeras']);
  assert.deepEqual(remera.atributos, ['Talle']);
  assert.deepEqual(remera.variantes.find((v) => v.sku === 'REM-S'), { sku: 'REM-S', valores: ['S'], precio: 1250000, stock: 99 });
});

test('si el Excel trae categorías, reemplazan a las anteriores', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);

  importar(db, tiendaId, [['SKU', 'Nombre', 'Categorías'], ['GORRA', 'Gorra', 'Ofertas, Accesorios > Cabeza']]);

  const gorra = leerCatalogo(db, tiendaId).find((p) => p.nombre === 'Gorra');
  assert.deepEqual(gorra.categorias, ['Accesorios > Cabeza', 'Ofertas']);
});

test('no toca los productos que no están en el Excel', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);
  const gorraAntes = leerCatalogo(db, tiendaId).find((p) => p.nombre === 'Gorra');

  importar(db, tiendaId, [['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 3000, 4]]);

  const catalogo = leerCatalogo(db, tiendaId);
  assert.deepEqual(catalogo.map((p) => p.nombre), ['Gorra', 'Remera Básica', 'Taza']);
  assert.deepEqual(catalogo.find((p) => p.nombre === 'Gorra'), gorraAntes);
});

test('agrega una variante nueva a un producto que ya existe', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);

  const resumen = importar(db, tiendaId, [ENCABEZADOS, ['REM-L', 'Remera Básica', null, null, 13000, 2, 'Talle', 'L']]);

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 1, variantesNuevas: 1, variantesActualizadas: 0 });
  const remera = leerCatalogo(db, tiendaId).find((p) => p.nombre === 'Remera Básica');
  assert.deepEqual(remera.variantes.map((v) => v.sku), ['REM-L', 'REM-M', 'REM-S']);
});

test('una variante nueva sin precio es un error y no se guarda nada del archivo', () => {
  const { db, tiendaId } = preparar();
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio'],
    ['TAZA', 'Taza', 3000],
    ['PLATO', 'Plato', null],
  ]);

  const { errores } = previsualizar(db, tiendaId, productos);
  assert.equal(errores.length, 1);
  assert.equal(errores[0].fila, 3);
  assert.match(errores[0].mensaje, /precio/i);

  assert.throws(() => aplicarImportacion(db, tiendaId, productos), ErrorDeImportacion);
  assert.deepEqual(leerCatalogo(db, tiendaId), []);
});

test('un SKU que ya pertenece a otro producto es un error', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio'], ['GORRA', 'Visera', 5000]]);

  const { errores } = previsualizar(db, tiendaId, productos);

  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /GORRA.*Gorra/);
});

test('no deja cambiar los atributos de un producto que ya tiene variantes', () => {
  const { db, tiendaId } = preparar();
  importar(db, tiendaId, CATALOGO_INICIAL);
  const { productos } = interpretarHoja([ENCABEZADOS, ['REM-ROJA', 'Remera Básica', null, null, 12500, 1, 'Color', 'Rojo']]);

  const { errores } = previsualizar(db, tiendaId, productos);

  assert.equal(errores.length, 1);
  assert.match(errores[0].mensaje, /Talle.*Color/);
});

test('cada tienda tiene su propio catálogo aunque repitan SKU', () => {
  const { db, tiendaId } = preparar();
  const otraTiendaId = crearTiendaVacia(db, 'otra');
  importar(db, tiendaId, CATALOGO_INICIAL);

  const resumen = importar(db, otraTiendaId, [['SKU', 'Nombre', 'Precio'], ['GORRA', 'Gorra', 9999]]);

  assert.deepEqual(resumen, { productosNuevos: 1, productosActualizados: 0, variantesNuevas: 1, variantesActualizadas: 0 });
  assert.equal(leerCatalogo(db, otraTiendaId)[0].variantes[0].precio, 999900);
  assert.equal(leerCatalogo(db, tiendaId).find((p) => p.nombre === 'Gorra').variantes[0].precio, 800000);
});
