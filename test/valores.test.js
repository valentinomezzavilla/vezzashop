import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsearPrecio,
  parsearDecimal,
  parsearEntero,
  parsearSiNo,
  textoCelda,
} from '../src/importacion/valores.js';
import { slugificar } from '../src/util/slug.js';

test('parsearPrecio entiende los formatos que escribe un cliente argentino', () => {
  const casos = [
    [12500, 1250000],
    [1250.5, 125050],
    ['12500', 1250000],
    ['12.500', 1250000],
    ['12.500,50', 1250050],
    ['1.234.567,8', 123456780],
    ['1250,5', 125050],
    ['1250.50', 125050],
    ['$ 12.500', 1250000],
    ['  $12.500,00 ', 1250000],
  ];
  for (const [entrada, centavos] of casos) {
    assert.equal(parsearPrecio(entrada), centavos, `entrada: ${JSON.stringify(entrada)}`);
  }
});

test('parsearPrecio devuelve null si la celda está vacía', () => {
  assert.equal(parsearPrecio(null), null);
  assert.equal(parsearPrecio(undefined), null);
  assert.equal(parsearPrecio('   '), null);
});

test('parsearPrecio rechaza valores ambiguos o que no son precios', () => {
  for (const entrada of ['abc', '12,500', '-100', '12.50.3', '1,2,3', true]) {
    assert.throws(() => parsearPrecio(entrada), /precio/i, `entrada: ${JSON.stringify(entrada)}`);
  }
});

test('parsearDecimal acepta coma o punto decimal', () => {
  assert.equal(parsearDecimal('0,5'), 0.5);
  assert.equal(parsearDecimal('1.25'), 1.25);
  assert.equal(parsearDecimal(2), 2);
  assert.equal(parsearDecimal(''), null);
  assert.throws(() => parsearDecimal('mucho'));
  assert.throws(() => parsearDecimal(-1));
});

test('parsearEntero acepta enteros no negativos y miles con punto', () => {
  assert.equal(parsearEntero(10), 10);
  assert.equal(parsearEntero('0'), 0);
  assert.equal(parsearEntero('1.000'), 1000);
  assert.equal(parsearEntero(null), null);
  for (const entrada of [-1, 2.5, '2,5', 'diez']) {
    assert.throws(() => parsearEntero(entrada), undefined, `entrada: ${JSON.stringify(entrada)}`);
  }
});

test('parsearSiNo entiende sí/no en varias formas', () => {
  for (const si of ['Sí', 'si', 'S', 'x', 'true', 1, true]) assert.equal(parsearSiNo(si), true, String(si));
  for (const no of ['No', 'n', 'false', 0, false]) assert.equal(parsearSiNo(no), false, String(no));
  assert.equal(parsearSiNo(''), null);
  assert.throws(() => parsearSiNo('quizás'));
});

test('textoCelda limpia espacios y trata vacío como null', () => {
  assert.equal(textoCelda('  Remera  '), 'Remera');
  assert.equal(textoCelda(''), null);
  assert.equal(textoCelda(null), null);
  assert.equal(textoCelda(123), '123');
});

test('slugificar saca tildes, eñes y símbolos', () => {
  assert.equal(slugificar('Remera Básica Ñandú!'), 'remera-basica-nandu');
  assert.equal(slugificar('  Pantalón  --  Cargo  '), 'pantalon-cargo');
  assert.equal(slugificar('Ropa/Hombre'), 'ropa-hombre');
});
