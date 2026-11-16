// Fotos pegadas en el Excel: flotantes (dibujos anclados a una celda) y "colocadas en la celda".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import writeExcelFile from 'write-excel-file/node';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
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

// ---------- Fotos que no se pueden usar y partes que no hacen falta ----------

// Cambia una parte de un .xlsx (fn recibe el texto, o null si no existe; devolver null la borra).
function cambiarParte(xlsx, ruta, fn) {
  const partes = unzipSync(new Uint8Array(xlsx));
  const nuevo = fn(partes[ruta] ? strFromU8(partes[ruta]) : null);
  if (nuevo === null) delete partes[ruta];
  else partes[ruta] = strToU8(nuevo);
  return Buffer.from(zipSync(partes));
}

// Agrega una parte comprimida cuyo contenido está roto: si alguien la descomprime, fflate lanza un error.
function conParteRota(xlsx, ruta) {
  const partes = unzipSync(new Uint8Array(xlsx));
  partes[ruta] = [new Uint8Array(4096).fill(7), { level: 9 }];
  const zip = Buffer.from(zipSync(partes));
  const inicio = zip.indexOf(Buffer.from(ruta)) - 30; // encabezado local de esa parte
  assert.equal(zip.readUInt32LE(inicio), 0x04034b50);
  zip[inicio + 30 + zip.readUInt16LE(inicio + 26) + zip.readUInt16LE(inicio + 28)] = 0xff; // tipo de bloque inválido
  return zip;
}

test('no descomprime partes del Excel que no necesita', async () => {
  const xlsx = conParteRota(await writeExcelFile(hoja, { images: [foto(2, 3, PNG)] }).toBuffer(), 'xl/printerSettings/printerSettings1.bin');
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});

test('una foto pegada de más de 5 MB se marca sin descomprimirla', async () => {
  const partes = unzipSync(new Uint8Array(await writeExcelFile(hoja, { images: [foto(2, 3, PNG)] }).toBuffer()));
  partes['xl/media/sheet1-image1.png'] = new Uint8Array(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]));
  const xlsx = Buffer.from(zipSync(partes));
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: null, problema: 'pesada' }]);
});

test('una celda con una foto que no se puede resolver queda marcada', async () => {
  const sinValores = cambiarParte(conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG), 'xl/richData/rdrichvalue.xml', () => null);
  assert.deepEqual(leerFotosExcel(sinValores), [{ fila: 2, columna: 2, contenido: null, problema: 'ilegible' }]);
  const otroTipo = cambiarParte(conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG), 'xl/richData/rdrichvaluestructure.xml',
    (xml) => xml.replace('_rvRel:LocalImageIdentifier', '_rvRel:WebImageIdentifier'));
  assert.deepEqual(leerFotosExcel(otroTipo), [{ fila: 2, columna: 2, contenido: null, problema: 'ilegible' }]);
});

test('una foto dentro de un grupo queda marcada', async () => {
  const xlsx = cambiarParte(await writeExcelFile(hoja, { images: [foto(3, 3, PNG)] }).toBuffer(), 'xl/drawings/drawing1.xml',
    (xml) => xml.replace('<xdr:pic>', '<xdr:grpSp><xdr:pic>').replace('</xdr:pic>', '</xdr:pic></xdr:grpSp>'));
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 3, columna: 2, contenido: null, problema: 'ilegible' }]);
});

test('acepta atributos con comillas simples', async () => {
  const xlsx = cambiarParte(conFotoEnCelda(await writeExcelFile(hoja).toBuffer(), 'C2', PNG), 'xl/worksheets/sheet1.xml',
    (xml) => xml.replace('<c r="C2" t="e" vm="1">', "<c r='C2' t='e' vm='1'>"));
  assert.deepEqual(leerFotosExcel(xlsx), [{ fila: 2, columna: 2, contenido: PNG }]);
});
