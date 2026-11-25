// Gráficos de columnas del Dashboard: acá solo se hacen las cuentas (altura de cada columna, números de los ejes);
// el dibujo es HTML y CSS en parciales/grafico-columnas.ejs, así el texto se lee igual en el celular y en la compu.

const PASOS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// El tope "redondo" del eje: 1.340.000 -> 1.500.000. Con `entero` los números del eje no tienen decimales (pedidos).
export function techoAgradable(maximo, { entero = false } = {}) {
  if (!(maximo > 0)) return entero ? 2 : 1;
  const base = 10 ** Math.floor(Math.log10(maximo));
  let techo = PASOS.map((paso) => paso * base).find((valor) => valor >= maximo) ?? 10 * base;
  if (entero) {
    techo = Math.max(2, Math.ceil(techo));
    if (techo % 2) techo += 1; // el eje marca la mitad: tiene que ser entera
  }
  return techo;
}

// puntos: [{ valor, etiqueta, tip }]. Devuelve lo que necesita el parcial:
//   ejes:     los números a la izquierda (tope, mitad y cero) con su altura en %.
//   columnas: la altura de cada una, su texto emergente y la etiqueta del eje de abajo (solo en algunas, para que entren).
export function armarGrafico(puntos, { formatoEje, entero = false }) {
  const techo = techoAgradable(Math.max(0, ...puntos.map((p) => p.valor)), { entero });
  const cada = Math.max(1, Math.ceil(puntos.length / 7));
  const ejes = [
    { texto: formatoEje(techo), posicion: 100 },
    { texto: formatoEje(techo / 2), posicion: 50 },
    { texto: formatoEje(0), posicion: 0 },
  ];
  return {
    techo,
    ejes,
    // Cuánto lugar reserva el eje de la izquierda, en caracteres (los números van posicionados y no ocupan lugar por sí solos).
    anchoEje: Math.max(...ejes.map((e) => e.texto.length)),
    // Separación entre columnas, en px: con pocas columnas se ven más separadas.
    hueco: puntos.length <= 8 ? 12 : puntos.length <= 14 ? 6 : puntos.length <= 40 ? 3 : 2,
    columnas: puntos.map((p, n) => ({
      alto: p.valor > 0 ? Math.max(2.5, Math.round((p.valor / techo) * 1000) / 10) : 0,
      tip: p.tip,
      etiqueta: n % cada === 0 ? p.etiqueta : '',
      // En una pantalla angosta las fechas se tocan: una de cada dos se oculta (la CSS decide cuándo).
      opcional: cada > 1 && n % cada === 0 && (n / cada) % 2 === 1 && p.etiqueta.length >= 5,
      lado: n < puntos.length * 0.3 ? 'izq' : n > puntos.length * 0.7 ? 'der' : 'centro',
    })),
  };
}
