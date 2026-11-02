import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretarHoja } from '../src/importacion/interpretar.js';

const VACIO = { pesoKg: null, altoCm: null, anchoCm: null, profundidadCm: null };

test('agrupa en un producto las filas con el mismo nombre y arma sus variantes', () => {
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Descripción', 'Categorías', 'Marca', 'Precio', 'Precio promocional', 'Stock',
      'Atributo 1', 'Valor 1', 'Atributo 2', 'Valor 2', 'Visible', 'Peso (kg)'],
    ['REM-S-NEG', 'Remera Básica', 'Algodón', 'Ropa > Remeras', 'Marca X', 12500, null, 10,
      'Talle', 'S', 'Color', 'Negro', 'Sí', '0,2'],
    ['REM-M-NEG', 'remera basica', null, null, null, '12.500', null, 5,
      null, 'M', null, 'Negro', null, null],
    ['GORRA-1', 'Gorra', null, 'Accesorios', null, 8000, 7000, 3,
      null, null, null, null, 'No', null],
  ]);

  assert.deepEqual(errores, []);
  assert.deepEqual(productos, [
    {
      slug: 'remera-basica', nombre: 'Remera Básica', descripcion: 'Algodón', marca: 'Marca X',
      categorias: [['Ropa', 'Remeras']], visible: true, atributos: ['Talle', 'Color'], primeraFila: 2,
      variantes: [
        { fila: 2, sku: 'REM-S-NEG', valores: ['S', 'Negro'], precioCentavos: 1250000,
          precioPromocionalCentavos: null, stock: 10, ...VACIO, pesoKg: 0.2 },
        { fila: 3, sku: 'REM-M-NEG', valores: ['M', 'Negro'], precioCentavos: 1250000,
          precioPromocionalCentavos: null, stock: 5, ...VACIO },
      ],
    },
    {
      slug: 'gorra', nombre: 'Gorra', descripcion: null, marca: null,
      categorias: [['Accesorios']], visible: false, atributos: [], primeraFila: 4,
      variantes: [
        { fila: 4, sku: 'GORRA-1', valores: [], precioCentavos: 800000,
          precioPromocionalCentavos: 700000, stock: 3, ...VACIO },
      ],
    },
  ]);
});

test('reconoce encabezados sin tildes ni mayúsculas, y columnas en otro orden', () => {
  const { productos, errores } = interpretarHoja([
    ['precio', 'NOMBRE', 'categoria', 'sku'],
    [1000, 'Taza', 'Cocina > Tazas, Ofertas', 'TAZA-1'],
  ]);
  assert.deepEqual(errores, []);
  assert.equal(productos[0].variantes[0].precioCentavos, 100000);
  assert.deepEqual(productos[0].categorias, [['Cocina', 'Tazas'], ['Ofertas']]);
});

test('alcanza con SKU, Nombre y Stock para actualizar stock', () => {
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Stock'],
    ['TAZA-1', 'Taza', 7],
  ]);
  assert.deepEqual(errores, []);
  assert.equal(productos[0].variantes[0].stock, 7);
  assert.equal(productos[0].variantes[0].precioCentavos, null);
  assert.equal(productos[0].descripcion, null);
  assert.equal(productos[0].categorias, null);
  assert.equal(productos[0].visible, null);
});

test('avisa qué columna obligatoria falta', () => {
  const { productos, errores } = interpretarHoja([['Nombre', 'Precio'], ['Taza', 100]]);
  assert.deepEqual(productos, []);
  assert.equal(errores.length, 1);
  assert.equal(errores[0].fila, 1);
  assert.match(errores[0].mensaje, /SKU/);
});

test('saltea filas vacías sin marcar error', () => {
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio'],
    [null, null, null],
    ['TAZA-1', 'Taza', 100],
    ['', '  ', null],
  ]);
  assert.deepEqual(errores, []);
  assert.equal(productos.length, 1);
});

test('informa cada error con el número de fila del Excel', () => {
  const { errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Precio promocional', 'Stock'],
    [null, 'Taza', 100, null, 1], // fila 2: sin SKU
    ['B', null, 100, null, 1], // fila 3: sin nombre
    ['C', 'Plato', 'caro', null, 1], // fila 4: precio inválido
    ['D', 'Vaso', 100, 150, 1], // fila 5: promo mayor al precio
    ['E', 'Jarra', 100, null, -2], // fila 6: stock negativo
    ['C', 'Bowl', 100, null, 1], // fila 7: SKU repetido de la fila 4
    ['F', 'Fuente', 0, null, 1], // fila 8: precio cero
  ]);
  const porFila = Object.fromEntries(errores.map((e) => [e.fila, e.mensaje]));
  assert.deepEqual(Object.keys(porFila).map(Number), [2, 3, 4, 5, 6, 7, 8]);
  assert.match(porFila[2], /SKU/);
  assert.match(porFila[3], /nombre/i);
  assert.match(porFila[4], /precio inválido/i);
  assert.match(porFila[5], /promocional/i);
  assert.match(porFila[6], /entero/i);
  assert.match(porFila[7], /repetido.*fila 4/);
  assert.match(porFila[8], /mayor a 0/);
});

test('valida que las variantes de un producto sean consistentes', () => {
  const { errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Atributo 1', 'Valor 1', 'Atributo 2', 'Valor 2'],
    ['A1', 'Buzo', 100, 'Talle', 'S', null, null],
    ['A2', 'Buzo', 100, null, null, null, null], // fila 3: falta Valor 1
    ['A3', 'Buzo', 100, null, 'M', null, 'Rojo'], // fila 4: valor 2 sin atributo 2
    ['A4', 'Buzo', 100, null, 'S', null, null], // fila 5: repite la combinación de la fila 2
    ['A5', 'Buzo', 100, 'Color', 'L', null, null], // fila 6: atributo 1 distinto
    // filas 7 y 8: mismo producto en varias filas sin atributos (se informa en la primera)
    ['B1', 'Media', 100, null, null, null, null],
    ['B2', 'Media', 100, null, null, null, null],
  ]);
  const porFila = Object.fromEntries(errores.map((e) => [e.fila, e.mensaje]));
  assert.deepEqual(Object.keys(porFila).map(Number), [3, 4, 5, 6, 7]);
  assert.match(porFila[3], /Valor 1/);
  assert.match(porFila[4], /Atributo 2/);
  assert.match(porFila[5], /combinación.*fila 2/);
  assert.match(porFila[6], /Atributo 1/);
  assert.match(porFila[7], /varias filas/);
});
