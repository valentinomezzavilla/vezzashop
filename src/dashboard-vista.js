// Lo que las vistas del Dashboard necesitan además de los números: los links de cada período y panel, y los gráficos ya armados.
import { PERIODOS, PANELES, urlDashboard } from './dashboard.js';
import { armarGrafico } from './util/grafico.js';
import { formatearCompacto, formatearPesos, plural } from './util/formato.js';

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

// Los links para cambiar de período (conservando el panel) y de panel (conservando el período).
export function enlacesDashboard({ periodo, panel }) {
  const actual = { periodo: periodo.clave, desde: periodo.desde, hasta: periodo.hasta };
  return {
    periodos: Object.entries(PERIODOS).map(([clave, titulo]) => ({ clave, titulo, url: urlDashboard({ periodo: clave, panel }), activo: periodo.clave === clave })),
    paneles: Object.entries(PANELES).map(([clave, titulo]) => ({ clave, titulo, url: urlDashboard({ ...actual, panel: clave }), activo: panel === clave })),
    // Para el formulario de fechas: vuelve al mismo panel.
    rango: { periodo: 'rango', panel },
  };
}

const textoPedidos = (pedidos, ventas) => `${plural(pedidos, 'pedido', 'pedidos')} · ${formatearPesos(ventas)}`;

// Ventas por día (o semana o mes) en pesos.
export function graficoDeVentas(serie) {
  return armarGrafico(
    serie.map((g) => ({ valor: g.ventas, etiqueta: g.etiqueta, tip: `${g.nombre}: ${formatearPesos(g.ventas)} · ${plural(g.pedidos, 'pedido', 'pedidos')}` })),
    { formatoEje: formatearCompacto },
  );
}

// Pedidos concretados por día (o semana o mes).
export function graficoDePedidos(serie) {
  return armarGrafico(
    serie.map((g) => ({ valor: g.pedidos, etiqueta: g.etiqueta, tip: `${g.nombre}: ${plural(g.pedidos, 'pedido', 'pedidos')}` })),
    { formatoEje: (n) => String(Math.round(n)), entero: true },
  );
}

export function graficoDeDiasDeLaSemana(momentos) {
  return armarGrafico(
    momentos.porDiaDeLaSemana.map((d, n) => ({ valor: d.pedidos, etiqueta: DIAS_CORTOS[n], tip: `${d.nombre}: ${textoPedidos(d.pedidos, d.ventas)}` })),
    { formatoEje: (n) => String(Math.round(n)), entero: true },
  );
}

export function graficoDeHoras(momentos) {
  return armarGrafico(
    momentos.porHora.map((h) => ({
      valor: h.pedidos,
      etiqueta: `${h.hora} h`,
      tip: `${String(h.hora).padStart(2, '0')}:00 a ${String(h.hora).padStart(2, '0')}:59: ${textoPedidos(h.pedidos, h.ventas)}`,
    })),
    { formatoEje: (n) => String(Math.round(n)), entero: true },
  );
}

// Agrega a los datos de un panel lo que las vistas necesitan.
export function prepararVista(datos) {
  const graficos = {};
  if (datos.serie) {
    graficos.ventas = graficoDeVentas(datos.serie);
    graficos.pedidos = graficoDePedidos(datos.serie);
  }
  if (datos.momentos) {
    graficos.diasDeLaSemana = graficoDeDiasDeLaSemana(datos.momentos);
    graficos.horas = graficoDeHoras(datos.momentos);
  }
  return { ...datos, enlaces: enlacesDashboard(datos), graficos };
}
