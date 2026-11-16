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
