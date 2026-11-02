// Interpretan lo que el cliente escribe en una celda del Excel.
// Todas devuelven null si la celda está vacía ("no cambiar") y tiran
// ErrorDeValor con un mensaje para el cliente si el valor no se entiende.

export class ErrorDeValor extends Error {}

export function textoCelda(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto === '' ? null : texto;
}

const MILES_CON_PUNTO = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/; // 12.500 | 12.500,50
const DECIMAL_CON_COMA = /^\d+,\d{1,2}$/; // 1250,5
const DECIMAL_CON_PUNTO = /^\d+(\.\d{1,2})?$/; // 1250 | 1250.50

// Devuelve el precio en centavos (entero) para no arrastrar errores de redondeo.
export function parsearPrecio(valor) {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) throw new ErrorDeValor(`Precio inválido: ${valor}`);
    return Math.round(valor * 100);
  }
  if (typeof valor !== 'string' && valor !== null && valor !== undefined) {
    throw new ErrorDeValor(`Precio inválido: ${valor}`);
  }
  const texto = textoCelda(valor);
  if (texto === null) return null;

  const limpio = texto.replace(/\$/g, '').replace(/[\s ]/g, '');
  let normalizado;
  if (MILES_CON_PUNTO.test(limpio)) normalizado = limpio.replace(/\./g, '').replace(',', '.');
  else if (DECIMAL_CON_COMA.test(limpio)) normalizado = limpio.replace(',', '.');
  else if (DECIMAL_CON_PUNTO.test(limpio)) normalizado = limpio;
  else throw new ErrorDeValor(`Precio inválido: "${texto}". Usá por ejemplo 12500 o 12.500,50`);

  return Math.round(Number(normalizado) * 100);
}

export function parsearDecimal(valor) {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor) || valor < 0) throw new ErrorDeValor(`Número inválido: ${valor}`);
    return valor;
  }
  const texto = textoCelda(valor);
  if (texto === null) return null;
  if (!/^\d+([.,]\d+)?$/.test(texto)) throw new ErrorDeValor(`Número inválido: "${texto}"`);
  return Number(texto.replace(',', '.'));
}

export function parsearEntero(valor) {
  if (typeof valor === 'number') {
    if (!Number.isInteger(valor) || valor < 0) throw new ErrorDeValor(`Tiene que ser un número entero, sin decimales: ${valor}`);
    return valor;
  }
  const texto = textoCelda(valor);
  if (texto === null) return null;
  if (/^\d+$/.test(texto)) return Number(texto);
  if (/^\d{1,3}(\.\d{3})+$/.test(texto)) return Number(texto.replace(/\./g, ''));
  throw new ErrorDeValor(`Tiene que ser un número entero, sin decimales: "${texto}"`);
}

const SI = new Set(['si', 's', 'x', 'true', '1', 'yes', 'y']);
const NO = new Set(['no', 'n', 'false', '0']);

export function parsearSiNo(valor) {
  if (typeof valor === 'boolean') return valor;
  const texto = textoCelda(valor);
  if (texto === null) return null;
  const normalizado = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (SI.has(normalizado)) return true;
  if (NO.has(normalizado)) return false;
  throw new ErrorDeValor(`Escribí "Sí" o "No": "${texto}"`);
}
