const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

// 1250050 -> "$ 12.500,50"
export function formatearPrecio(centavos) {
  return centavos === null || centavos === undefined ? '—' : PESOS.format(centavos / 100);
}

export function plural(cantidad, singular, pluralTexto) {
  return `${cantidad} ${cantidad === 1 ? singular : pluralTexto}`;
}
