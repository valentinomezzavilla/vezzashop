import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase } from '../src/db.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { previsualizar, aplicarImportacion, ErrorDeImportacion, claveFoto } from '../src/importacion/aplicar.js';
import { asignarFotos } from '../src/importacion/fotos.js';
import { listarFotos } from '../src/productos.js';
import { huellaDe } from '../src/imagenes.js';
import { leerCatalogo, crearTiendaVacia, PNG, otraFoto } from './ayudantes.js';

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

  assert.deepEqual(resumen, { productosNuevos: 2, productosActualizados: 0, variantesNuevas: 3, variantesActualizadas: 0, fotosNuevas: 0 });
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

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 2, variantesNuevas: 0, variantesActualizadas: 3, fotosNuevas: 0 });
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

  assert.deepEqual(resumen, { productosNuevos: 0, productosActualizados: 1, variantesNuevas: 1, variantesActualizadas: 0, fotosNuevas: 0 });
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

  assert.deepEqual(resumen, { productosNuevos: 1, productosActualizados: 0, variantesNuevas: 1, variantesActualizadas: 0, fotosNuevas: 0 });
  assert.equal((await leerCatalogo(db, otraTiendaId))[0].variantes[0].precio, 999900);
  assert.equal((await leerCatalogo(db, tiendaId)).find((p) => p.nombre === 'Gorra').variantes[0].precio, 800000);
});

// ---------- Fotos ----------

const HOJA_FOTOS = [['SKU', 'Nombre', 'Precio'], ['GORRA', 'Gorra', 8000], ['REM', 'Remera', 9000]];

// Productos de la hoja con fotos por fila (la Gorra es la fila 2, la Remera la 3).
function conFotos(fotosPorFila) {
  const { productos } = interpretarHoja(HOJA_FOTOS);
  asignarFotos(productos, new Map(Object.entries(fotosPorFila).map(([fila, fotos]) => [Number(fila), fotos])));
  return productos;
}
const archivosPara = (pares) => new Map(pares.map(([slug, foto, archivo]) => [claveFoto(slug, huellaDe(foto)), archivo]));
const idDe = async (db, slug) => (await db.prepare('SELECT id FROM productos WHERE slug = ?').get(slug)).id;
const archivosDe = async (db, tiendaId, slug) => (await listarFotos(db, tiendaId, await idDe(db, slug))).map((f) => f.archivo);

test('previsualizar cuenta las fotos nuevas y saltea las que el producto ya tiene', async () => {
  const { db, tiendaId } = await preparar();
  await aplicarImportacion(db, tiendaId, conFotos({ 2: [PNG] }), archivosPara([['gorra', PNG, 'a.png']]));

  const { resumen, errores, fotosAGuardar } = await previsualizar(db, tiendaId, conFotos({ 2: [PNG, otraFoto(1)] }));

  assert.deepEqual(errores, []);
  assert.equal(resumen.fotosNuevas, 1);
  assert.deepEqual(fotosAGuardar.map((f) => [f.slug, f.huella]), [['gorra', huellaDe(otraFoto(1))]]);
  assert.deepEqual(fotosAGuardar[0].contenido, otraFoto(1));
});

test('aplicarImportacion agrega las fotos en orden; la primera queda como principal', async () => {
  const { db, tiendaId } = await preparar();
  const resumen = await aplicarImportacion(db, tiendaId, conFotos({ 2: [PNG, otraFoto(1)] }),
    archivosPara([['gorra', PNG, 'a.png'], ['gorra', otraFoto(1), 'b.png']]));

  assert.equal(resumen.fotosNuevas, 2);
  assert.deepEqual(await archivosDe(db, tiendaId, 'gorra'), ['a.png', 'b.png']);
  assert.deepEqual((await db.prepare('SELECT huella FROM producto_fotos ORDER BY orden').all()).map((f) => f.huella), [huellaDe(PNG), huellaDe(otraFoto(1))]);
});

test('si el producto ya tenía fotos, las nuevas van al final', async () => {
  const { db, tiendaId } = await preparar();
  await aplicarImportacion(db, tiendaId, conFotos({ 2: [PNG] }), archivosPara([['gorra', PNG, 'a.png']]));
  await aplicarImportacion(db, tiendaId, conFotos({ 2: [otraFoto(1), PNG] }), archivosPara([['gorra', otraFoto(1), 'b.png']]));
  assert.deepEqual(await archivosDe(db, tiendaId, 'gorra'), ['a.png', 'b.png']);
});

test('un producto que pasaría de 10 fotos es un problema', async () => {
  const { db, tiendaId } = await preparar();
  const once = Array.from({ length: 11 }, (_, i) => otraFoto(i));
  const { errores } = await previsualizar(db, tiendaId, conFotos({ 2: once }));
  assert.deepEqual(errores, [{ fila: 2, mensaje: '"Gorra" quedaría con 11 fotos y el máximo es 10' }]);
  await assert.rejects(aplicarImportacion(db, tiendaId, conFotos({ 2: once })), ErrorDeImportacion);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM productos').get()).n, 0);
});

test('la misma foto en dos productos se guarda para cada uno', async () => {
  const { db, tiendaId } = await preparar();
  await aplicarImportacion(db, tiendaId, conFotos({ 2: [PNG], 3: [PNG] }), archivosPara([['gorra', PNG, 'g.png'], ['remera', PNG, 'r.png']]));
  assert.deepEqual(await archivosDe(db, tiendaId, 'gorra'), ['g.png']);
  assert.deepEqual(await archivosDe(db, tiendaId, 'remera'), ['r.png']);
});
