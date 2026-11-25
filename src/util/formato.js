const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

// 1250050 -> "$ 12.500,50"
export function formatearPrecio(centavos) {
  return centavos === null || centavos === undefined ? '—' : PESOS.format(centavos / 100);
}

export function plural(cantidad, singular, pluralTexto) {
  return `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;
}

const FECHA = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Cordoba', dateStyle: 'short', timeStyle: 'short' });

// La fecha que guarda la base (texto en UTC, "2026-11-04 15:30:00") en hora argentina: "4/11/26, 12:30".
export function formatearFecha(fechaGuardada) {
  if (!fechaGuardada) return '';
  return FECHA.format(new Date(`${fechaGuardada.replace(' ', 'T')}Z`));
}

// ---------- Números para el Dashboard ----------

const PESOS_ENTEROS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const NUMERO = new Intl.NumberFormat('es-AR');
const UN_DECIMAL = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

// 1250050 -> "$ 12.501": pesos redondos, para totales grandes donde los centavos solo estorban.
export const formatearPesos = (centavos) => PESOS_ENTEROS.format(Math.round(centavos / 100));

// 1250000 -> "12.500" (un número entero o con hasta un decimal, con puntos de miles).
export const formatearNumero = (numero) => (Number.isInteger(numero) ? NUMERO.format(numero) : UN_DECIMAL.format(numero));

// Para los ejes de los gráficos: 85000 -> "$ 850", 1250000 -> "$ 12,5 mil", 250000000 -> "$ 2,5 M".
export function formatearCompacto(centavos) {
  const pesos = centavos / 100;
  if (pesos >= 1_000_000) return `$ ${UN_DECIMAL.format(pesos / 1_000_000)} M`;
  if (pesos >= 1_000) return `$ ${UN_DECIMAL.format(pesos / 1_000)} mil`;
  return `$ ${UN_DECIMAL.format(pesos)}`;
}

// 0.256 -> "26%"
export const formatearPorcentaje = (fraccion) => `${Math.round(fraccion * 100)}%`;

// 93600 -> "1 d 2 h", 7500 -> "2 h 5 min", 540 -> "9 min".
export function formatearDuracion(segundos) {
  const minutos = Math.round(segundos / 60);
  if (minutos < 1) return 'menos de 1 min';
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
  const dias = Math.floor(horas / 24);
  return horas % 24 ? `${dias} d ${horas % 24} h` : `${dias} d`;
}
