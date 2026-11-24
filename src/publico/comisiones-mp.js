// Cuánto cobra Mercado Pago y cuánto le queda a la tienda. Código puro, sin dependencias: lo usan el servidor (src/comisiones-mp.js lo vuelve a
// exportar) y la calculadora del panel en el navegador, así los dos hacen exactamente la misma cuenta.
//
// Las tasas son las que Mercado Pago publica para cobrar con link de pago o Checkout Pro en Argentina, SIN el IVA: sobre la comisión se suma
// el IVA (21 %). No hay un cargo fijo por operación. Varían un poco según la provincia, y cobrar en cuotas puede tener un costo extra que paga
// el vendedor: eso va en "otros costos". Los importes van en centavos y los porcentajes en centésimas de punto porcentual (629 = 6,29 %).
// Fuente de las tasas: mercadopago.com.ar/herramientas-para-vender/check-out (consultada en noviembre de 2026). Si Mercado Pago las cambia,
// se actualizan acá y en ningún otro lado.

export const IVA_BP = 2100;

export const PLAZOS = {
  instante: { titulo: 'Al instante', tasaBp: 629 },
  10: { titulo: 'A los 10 días', tasaBp: 439 },
  18: { titulo: 'A los 18 días', tasaBp: 339 },
  35: { titulo: 'A los 35 días', tasaBp: 149 },
};
export const esPlazo = (valor) => typeof valor === 'string' && Object.hasOwn(PLAZOS, valor);
// En un objeto de JavaScript las claves que son números ('10', '18', '35') salen antes que las demás: el orden en que se muestran se dice acá.
export const ORDEN_PLAZOS = ['instante', '10', '18', '35'];
export const listaDePlazos = () => ORDEN_PLAZOS.map((clave) => ({ clave, ...PLAZOS[clave] }));

export const MAX_OTROS_BP = 3000;

const porcentaje = (centavos, bp) => Math.round((centavos * bp) / 10_000);

// Lo que Mercado Pago descuenta de una venta de `precio` (centavos) y lo que queda. { comision, iva, otros, total (todo lo que se descuenta), neto }.
export function calcularComision(precio, { plazo = 'instante', otrosBp = 0 } = {}) {
  const tasa = PLAZOS[plazo]?.tasaBp ?? PLAZOS.instante.tasaBp;
  const comision = porcentaje(precio, tasa);
  const iva = porcentaje(comision, IVA_BP);
  const otros = porcentaje(precio, otrosBp);
  const total = comision + iva + otros;
  return { precio, tasaBp: tasa, comision, iva, otros, total, neto: precio - total };
}

// A cuánto hay que vender para que, descontado todo, queden `neto` centavos. Se redondea hacia arriba a un peso entero (así el precio queda
// "lindo") y se verifica con la misma cuenta de arriba: el resultado siempre cumple neto >= lo pedido. null si no se puede (el costo suma 100 % o más).
export function precioParaRecibir(neto, { plazo = 'instante', otrosBp = 0 } = {}) {
  const tasa = PLAZOS[plazo]?.tasaBp ?? PLAZOS.instante.tasaBp;
  const descuento = (tasa * (10_000 + IVA_BP)) / 10_000 + otrosBp; // en centésimas de punto porcentual, con el IVA incluido
  if (!Number.isFinite(neto) || neto <= 0 || descuento >= 10_000) return null;
  let precio = Math.ceil((neto * 10_000) / (10_000 - descuento) / 100) * 100;
  // Los redondeos de cada paso pueden dejarlo a un centavo: se sube de a un peso hasta que alcance.
  for (let vuelta = 0; vuelta < 50 && calcularComision(precio, { plazo, otrosBp }).neto < neto; vuelta++) precio += 100;
  return precio;
}

// Los cuatro plazos juntos para un mismo precio, para la tabla del panel.
export function tablaDeComisiones(precio, { otrosBp = 0 } = {}) {
  return listaDePlazos().map(({ clave, titulo }) => ({ plazo: clave, titulo, ...calcularComision(precio, { plazo: clave, otrosBp }) }));
}
