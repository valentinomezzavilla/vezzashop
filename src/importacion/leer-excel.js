import { readSheet } from 'read-excel-file/node';

export class ErrorDeLectura extends Error {}

// Devuelve la primera hoja como filas de celdas.
export async function leerExcel(buffer) {
  try {
    return await readSheet(buffer);
  } catch (causa) {
    throw new ErrorDeLectura('No es un archivo .xlsx válido', { cause: causa });
  }
}
