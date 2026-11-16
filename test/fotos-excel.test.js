// Fotos pegadas en el Excel: flotantes (dibujos anclados a una celda) y "colocadas en la celda".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import writeExcelFile from 'write-excel-file/node';
import { leerFotosExcel } from '../src/importacion/fotos-excel.js';
import { conFotoEnCelda, PNG, otraFoto } from './ayudantes.js';

const hoja = [['SKU', 'Nombre', 'img'], ['A', 'Uno', null], ['B', 'Dos', null]];
const foto = (row, column, contenido, offsetX = 0) => ({
  content: contenido, contentType: 'image/png', width: 10, height: 10, dpi: 96, anchor: { row, column }, offsetX,
});

test('ubica una foto flotante en la celda de su esquina de arriba a la izquierda', async () => {
  const xlsx = await writeExcelFile(hoja, { images: [foto(3, 3, PNG)] }).toBuffer();
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 3, columna: 2, contenido: PNG }]);
});

test('varias fotos flotantes en la misma celda vienen de izquierda a derecha', async () => {
  const xlsx = await writeExcelFile(hoja, { images: [foto(2, 3, otraFoto(2), 40), foto(2, 3, otraFoto(1), 0)] }).toBuffer();
  assert.deepEqual(leerFotosExcel(xlsx).map((f) => f.contenido), [otraFoto(1), otraFoto(2)]);
});

test('ordena por fila y después por columna', async () => {
  const xlsx = await writeExcelFile(hoja, { images: [foto(3, 1, otraFoto(3)), foto(2, 3, otraFoto(2)), foto(2, 1, otraFoto(1))] }).toBuffer();
  assert.deepEqual(leerFotosExcel(xlsx).map((f) => [f.fila, f.columna]), [[2, 0], [2, 2], [3, 0]]);
});

test('lee una foto colocada en la celda', async () => {
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG);
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});

test('acepta Target absolutos en los rels', async () => {
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG, { targetAbsoluto: true });
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});

test('junta fotos flotantes y colocadas en celda', async () => {
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja, { images: [foto(2, 3, otraFoto(1))] }).toBuffer(), 'C3', otraFoto(2));
  assert.deepEqual(leerFotosExcel(xlsx), [
    { fila: 2, columna: 2, contenido: otraFoto(1) },
    { fila: 3, columna: 2, contenido: otraFoto(2) },
  ]);
});

test('un Excel sin fotos devuelve una lista vacía', async () => {
  assert.deepEqual(leerFotosExcel(await writeExcelFile(hoja).toBuffer()), []);
});
