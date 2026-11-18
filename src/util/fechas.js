// Fechas "de calendario" (sin hora) como texto "2026-12-31": así no dependen de la zona horaria del servidor.
// Se usan para el vencimiento del plan de cada cliente. "Hoy" es siempre el día de Argentina.

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' });
export const hoy = (ahora = new Date()) => HOY.format(ahora); // "2026-11-17"

export function esDiaValido(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto ?? '')) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto; // rechaza el 31 de febrero
}

// Suma meses de calendario; si el día no existe en el mes de llegada, queda el último (31 de enero + 1 mes = 28 de febrero).
export function sumarMeses(dia, meses) {
  const [anio, mes, dd] = dia.split('-').map(Number);
  const destino = new Date(Date.UTC(anio, mes - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(dd, ultimo));
  return destino.toISOString().slice(0, 10);
}

// Suma días de calendario: sumarDias('2026-11-28', 7) -> '2026-12-05'.
export const sumarDias = (dia, dias) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

// Cantidad de días de `desde` a `hasta` (negativa si `hasta` es anterior).
export const diasEntre = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);

// "2026-11-04" -> "4/11/2026"
export function formatearDia(dia) {
  if (!dia) return '';
  const [anio, mes, dd] = dia.split('-').map(Number);
  return `${dd}/${mes}/${anio}`;
}
