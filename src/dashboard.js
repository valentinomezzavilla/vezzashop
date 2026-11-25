// Estadísticas del negocio: los números de la card "Dashboard" del Inicio del panel.
//
// Todo sale de los pedidos y del catálogo de la tienda, y las fechas son las de Argentina. La base guarda la hora en UTC como
// texto ("2026-11-12 01:03:25"); Argentina no tiene horario de verano desde 2009, así que su hora es siempre UTC-3 y un día
// local va de las 03:00 UTC de ese día a las 03:00 UTC del siguiente.
//
// "Ventas" son los pedidos pagados, enviados y entregados. Los nuevos (todavía sin pago) se cuentan aparte como "por confirmar",
// y los cancelados no suman nunca. Un cliente es un teléfono (los últimos 10 dígitos), porque el email es opcional.
import { esDiaValido, diasEntre, formatearDia, hoy as hoyEnArgentina, sumarDias, sumarMeses } from './util/fechas.js';
import { FILTROS_PEDIDOS } from './pedidos.js';
import { FORMAS_DE_PAGO } from './pagos.js';

// ---------- Paneles y períodos ----------

export const PANELES = {
  resumen: 'Resumen',
  ventas: 'Ventas',
  pedidos: 'Pedidos',
  clientes: 'Clientes',
  productos: 'Productos',
  stock: 'Stock',
};
export const PANEL_INICIAL = 'resumen';
export const esPanel = (valor) => typeof valor === 'string' && Object.hasOwn(PANELES, valor);

export const PERIODOS = {
  hoy: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
  mes: 'Este mes',
  'mes-anterior': 'Mes pasado',
  anio: 'Este año',
  todo: 'Todo',
};
export const PERIODO_INICIAL = '30d';
export const MAX_DIAS_RANGO = 3660;

const HORAS_DE_DIFERENCIA = 3;
const DIAS_PARA_VENDER = 30; // ventana para calcular cuánto dura el stock
const DIAS_SIN_MOVIMIENTO = 90; // un producto sin ventas en tanto tiempo es "stock dormido"
const POCAS_UNIDADES = 3;
const DIAS_NUEVO_SIN_CONFIRMAR = 2;
const DIAS_PAGADO_SIN_ENVIAR = 2;
const DIAS_ENVIADO_SIN_CERRAR = 7;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS_DE_LA_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']; // ISO: lunes = 1

const texto = (valor) => (typeof valor === 'string' ? valor : '');
const primerDiaDelMes = (dia) => `${dia.slice(0, 7)}-01`;
const ultimoDiaDelMes = (dia) => sumarDias(sumarMeses(primerDiaDelMes(dia), 1), -1);
const diaDeLaSemana = (dia) => (new Date(`${dia}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = lunes
const lunesDe = (dia) => sumarDias(dia, -diaDeLaSemana(dia));
const diaYMes = (dia) => `${Number(dia.slice(8, 10))}/${Number(dia.slice(5, 7))}`;

// "2026-11-19" -> "2026-11-19 03:00:00": el comienzo de ese día argentino, en la hora de la base.
const comienzoDelDia = (dia) => `${dia} 0${HORAS_DE_DIFERENCIA}:00:00`;

// El instante de hace `dias` días, en el formato de la base ("2026-11-12 01:03:25", UTC).
const haceDias = (ahora, dias) => new Date(ahora.getTime() - dias * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');

// Los límites en UTC de un rango de días argentinos: [desde, hasta). `hasta` es el primer instante que ya no entra.
export function limitesUtc({ desde, hasta }) {
  return { desdeUtc: comienzoDelDia(desde), hastaUtc: comienzoDelDia(sumarDias(hasta, 1)) };
}

// Qué período se está mirando. Devuelve el rango de días (inclusive), con qué se compara y cómo agrupar el gráfico.
// entrada: lo que viene en la URL ({ periodo, desde, hasta }). Algo inválido vuelve a los 30 días, con un `error` para mostrar.
// hoy: el día de hoy en Argentina. primerDia: el día del primer pedido (para "Todo").
export function resolverPeriodo(entrada = {}, { hoy, primerDia = null }) {
  const pedido = texto(entrada.periodo);
  let clave = Object.hasOwn(PERIODOS, pedido) || pedido === 'rango' ? pedido : PERIODO_INICIAL;
  let error = null;
  let desde;
  let hasta = hoy;
  let anterior = null;

  if (clave === 'rango') {
    const dia1 = texto(entrada.desde);
    const dia2 = texto(entrada.hasta);
    if (!esDiaValido(dia1) || !esDiaValido(dia2) || dia1 > dia2) {
      error = 'Elegí dos fechas válidas, y que la de inicio no sea posterior a la de fin.';
    } else if (dia1 > hoy) {
      error = 'La fecha de inicio todavía no llegó.';
    } else if (diasEntre(dia1, dia2) + 1 > MAX_DIAS_RANGO) {
      error = 'Se pueden mirar hasta 10 años por vez.';
    } else {
      desde = dia1;
      hasta = dia2 > hoy ? hoy : dia2;
    }
    if (error) clave = PERIODO_INICIAL;
  }

  const dias = (primero, ultimo) => diasEntre(primero, ultimo) + 1;
  if (clave === 'hoy') {
    desde = hoy;
    anterior = { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1), titulo: 'ayer (el día completo)' };
  } else if (clave === '7d' || clave === '30d' || clave === '90d') {
    const n = Number.parseInt(clave, 10);
    desde = sumarDias(hoy, -(n - 1));
    anterior = { desde: sumarDias(desde, -n), hasta: sumarDias(desde, -1), titulo: `los ${n} días anteriores` };
  } else if (clave === 'mes') {
    desde = primerDiaDelMes(hoy);
    const mesAnterior = sumarMeses(desde, -1);
    const tramo = sumarDias(mesAnterior, dias(desde, hoy) - 1);
    const finDelMes = ultimoDiaDelMes(mesAnterior);
    anterior = { desde: mesAnterior, hasta: tramo < finDelMes ? tramo : finDelMes, titulo: 'el mismo tramo del mes anterior' };
  } else if (clave === 'mes-anterior') {
    desde = sumarMeses(primerDiaDelMes(hoy), -1);
    hasta = ultimoDiaDelMes(desde);
    const antes = sumarMeses(desde, -1);
    anterior = { desde: antes, hasta: ultimoDiaDelMes(antes), titulo: 'el mes anterior' };
  } else if (clave === 'anio') {
    desde = `${hoy.slice(0, 4)}-01-01`;
    anterior = { desde: sumarMeses(desde, -12), hasta: sumarMeses(hoy, -12), titulo: 'el mismo tramo del año anterior' };
  } else if (clave === 'todo') {
    desde = primerDia && primerDia <= hoy ? primerDia : hoy;
  } else if (clave === 'rango') {
    const largo = dias(desde, hasta);
    anterior = { desde: sumarDias(desde, -largo), hasta: sumarDias(desde, -1), titulo: `los ${largo} días anteriores` };
  }

  const total = dias(desde, hasta);
  return {
    clave,
    titulo: PERIODOS[clave] ?? 'Fechas elegidas',
    desde,
    hasta,
    dias: total,
    anterior,
    agrupar: total <= 45 ? 'dia' : total <= 200 ? 'semana' : 'mes',
    texto: clave === 'hoy' ? `Hoy, ${formatearDia(hoy)}` : total === 1 ? `El ${formatearDia(desde)}` : `Del ${formatearDia(desde)} al ${formatearDia(hasta)}`,
    error,
  };
}

// La URL de un panel y período dentro del Inicio (con el ancla a la card, para no perder el lugar).
export function urlDashboard({ periodo = PERIODO_INICIAL, panel = PANEL_INICIAL, desde = '', hasta = '' } = {}) {
  const consulta = new URLSearchParams();
  if (panel !== PANEL_INICIAL) consulta.set('panel', panel);
  if (periodo !== PERIODO_INICIAL) consulta.set('periodo', periodo);
  if (periodo === 'rango') {
    consulta.set('desde', desde);
    consulta.set('hasta', hasta);
  }
  const cadena = consulta.toString();
  return `/admin/inicio${cadena ? `?${cadena}` : ''}#dashboard`;
}

// ---------- Cuentas chicas ----------

// Cuánto cambió un número respecto del período anterior. null si no hay con qué comparar.
export function variacion(actual, anterior) {
  if (anterior === null || anterior === undefined) return null;
  if (anterior === 0) return actual === 0 ? { tipo: 'igual', porcentaje: 0 } : { tipo: 'nuevo', porcentaje: null };
  const porcentaje = (actual - anterior) / anterior;
  return { tipo: porcentaje > 0.0005 ? 'sube' : porcentaje < -0.0005 ? 'baja' : 'igual', porcentaje };
}

const proporcion = (parte, total) => (total > 0 ? parte / total : 0);
const conPorcentaje = (filas, total, campo) => filas.map((f) => ({ ...f, porcentaje: proporcion(f[campo], total) }));

// Las condiciones y expresiones de SQL que se repiten.
const CONCRETADO = "p.estado IN ('pagado', 'enviado', 'entregado')";
const CLIENTE = "right(regexp_replace(p.cliente_telefono, '\\D', '', 'g'), 10)";
const HORA_LOCAL = `(p.creado_en::timestamp - interval '${HORAS_DE_DIFERENCIA} hours')`;
const EN_EL_PERIODO = 'p.tienda_id = ? AND p.creado_en >= ? AND p.creado_en < ?';
const PRECIO_VIGENTE = 'coalesce(v.precio_promocional_centavos, v.precio_centavos)';

const parametrosDe = (tiendaId, rango) => {
  const { desdeUtc, hastaUtc } = limitesUtc(rango);
  return [tiendaId, desdeUtc, hastaUtc];
};

// ---------- Números del período ----------

// Todo lo que se suma en un rango de días: pedidos, ventas, descuentos, envíos, clientes y unidades.
export async function totalesDelPeriodo(db, tiendaId, rango) {
  const parametros = parametrosDe(tiendaId, rango);
  const t = await db
    .prepare(
      `SELECT count(*) AS recibidos,
              count(*) FILTER (WHERE p.estado = 'cancelado') AS cancelados,
              coalesce(sum(p.total_centavos) FILTER (WHERE p.estado = 'cancelado'), 0) AS "montoCancelados",
              count(*) FILTER (WHERE p.estado = 'nuevo') AS "porConfirmar",
              coalesce(sum(p.total_centavos) FILTER (WHERE p.estado = 'nuevo'), 0) AS "montoPorConfirmar",
              count(*) FILTER (WHERE ${CONCRETADO}) AS pedidos,
              coalesce(sum(p.total_centavos) FILTER (WHERE ${CONCRETADO}), 0) AS ventas,
              coalesce(sum(p.subtotal_centavos) FILTER (WHERE ${CONCRETADO}), 0) AS productos,
              coalesce(sum(p.descuento_centavos) FILTER (WHERE ${CONCRETADO}), 0) AS descuentos,
              coalesce(sum(p.envio_centavos) FILTER (WHERE ${CONCRETADO}), 0) AS envios,
              count(*) FILTER (WHERE ${CONCRETADO} AND p.descuento_centavos > 0) AS "conDescuento",
              count(*) FILTER (WHERE ${CONCRETADO} AND p.envio_centavos IS NULL) AS "envioACoordinar",
              count(*) FILTER (WHERE ${CONCRETADO} AND p.envio_centavos = 0) AS "envioGratis",
              count(DISTINCT ${CLIENTE}) FILTER (WHERE ${CONCRETADO}) AS clientes
       FROM pedidos p WHERE ${EN_EL_PERIODO}`,
    )
    .get(...parametros);
  const { unidades } = await db
    .prepare(
      `SELECT coalesce(sum(i.cantidad), 0) AS unidades
       FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
       WHERE ${EN_EL_PERIODO} AND ${CONCRETADO}`,
    )
    .get(...parametros);
  return {
    ...t,
    unidades,
    ticket: t.pedidos ? Math.round(t.ventas / t.pedidos) : 0,
    unidadesPorPedido: t.pedidos ? unidades / t.pedidos : 0,
    tasaCancelacion: proporcion(t.cancelados, t.recibidos),
  };
}

// Qué cambió cada número principal contra el período anterior (null si no hay período anterior).
export function compararTotales(actual, anterior) {
  if (!anterior) return null;
  return Object.fromEntries(
    ['ventas', 'pedidos', 'ticket', 'unidades', 'clientes', 'porConfirmar', 'recibidos'].map((campo) => [campo, variacion(actual[campo], anterior[campo])]),
  );
}

// Ventas y pedidos de cada día, rellenando con ceros los días sin ventas y agrupando en semanas o meses si el rango es largo.
export function armarSerie(filasPorDia, { desde, hasta, agrupar }) {
  const porDia = new Map(filasPorDia.map((f) => [f.dia, f]));
  const grupos = new Map();
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1)) {
    const clave = agrupar === 'mes' ? dia.slice(0, 7) : agrupar === 'semana' ? lunesDe(dia) : dia;
    const grupo = grupos.get(clave) ?? { clave, desde: dia, hasta: dia, ventas: 0, pedidos: 0 };
    const fila = porDia.get(dia);
    grupo.hasta = dia;
    grupo.ventas += fila?.ventas ?? 0;
    grupo.pedidos += fila?.pedidos ?? 0;
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].map((g) => {
    if (agrupar === 'mes') {
      const mes = Number(g.desde.slice(5, 7)) - 1;
      return { ...g, etiqueta: `${MESES_CORTOS[mes]} ${g.desde.slice(2, 4)}`, nombre: `${MESES[mes][0].toUpperCase()}${MESES[mes].slice(1)} ${g.desde.slice(0, 4)}` };
    }
    if (agrupar === 'semana') {
      return { ...g, etiqueta: diaYMes(g.desde), nombre: `Semana del ${diaYMes(g.desde)} al ${diaYMes(g.hasta)}` };
    }
    return { ...g, etiqueta: diaYMes(g.desde), nombre: `${DIAS_DE_LA_SEMANA[diaDeLaSemana(g.desde)]} ${diaYMes(g.desde)}` };
  });
}

export async function ventasPorDia(db, tiendaId, rango) {
  const filas = await db
    .prepare(
      `SELECT to_char(${HORA_LOCAL}, 'YYYY-MM-DD') AS dia, count(*) AS pedidos, sum(p.total_centavos) AS ventas
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} GROUP BY 1 ORDER BY 1`,
    )
    .all(...parametrosDe(tiendaId, rango));
  return armarSerie(filas, rango);
}

// Cuándo llegan los pedidos: por día de la semana (lunes a domingo) y por hora. No cuenta los cancelados.
export async function momentosDeCompra(db, tiendaId, rango) {
  const filas = await db
    .prepare(
      `SELECT extract(isodow FROM ${HORA_LOCAL}) AS dia, extract(hour FROM ${HORA_LOCAL}) AS hora,
              count(*) AS pedidos, sum(p.total_centavos) AS ventas
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND p.estado <> 'cancelado' GROUP BY 1, 2`,
    )
    .all(...parametrosDe(tiendaId, rango));
  const porDiaDeLaSemana = DIAS_DE_LA_SEMANA.map((nombre, n) => ({ nombre, pedidos: 0, ventas: 0, dia: n + 1 }));
  const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, pedidos: 0, ventas: 0 }));
  for (const f of filas) {
    porDiaDeLaSemana[f.dia - 1].pedidos += f.pedidos;
    porDiaDeLaSemana[f.dia - 1].ventas += f.ventas;
    porHora[f.hora].pedidos += f.pedidos;
    porHora[f.hora].ventas += f.ventas;
  }
  const mejor = (lista) => lista.reduce((a, b) => (b.pedidos > a.pedidos ? b : a), lista[0]);
  const hayPedidos = filas.length > 0;
  return {
    porDiaDeLaSemana,
    porHora,
    mejorDia: hayPedidos ? mejor(porDiaDeLaSemana) : null,
    mejorHora: hayPedidos ? mejor(porHora) : null,
  };
}

// ---------- Desgloses de pedidos ----------

// Pedidos del período por estado, con cantidad y monto.
export async function pedidosPorEstado(db, tiendaId, rango) {
  const filas = await db
    .prepare(`SELECT p.estado, count(*) AS pedidos, coalesce(sum(p.total_centavos), 0) AS monto FROM pedidos p WHERE ${EN_EL_PERIODO} GROUP BY 1`)
    .all(...parametrosDe(tiendaId, rango));
  const porEstado = new Map(filas.map((f) => [f.estado, f]));
  const total = filas.reduce((suma, f) => suma + f.pedidos, 0);
  return ['nuevo', 'pagado', 'enviado', 'entregado', 'cancelado'].map((estado) => {
    const f = porEstado.get(estado);
    return { estado, titulo: FILTROS_PEDIDOS[estado].titulo, pedidos: f?.pedidos ?? 0, monto: f?.monto ?? 0, porcentaje: proporcion(f?.pedidos ?? 0, total) };
  });
}

// Ventas por forma de pago.
export async function ventasPorPago(db, tiendaId, rango) {
  const filas = await db
    .prepare(
      `SELECT p.pago, count(*) AS pedidos, sum(p.total_centavos) AS ventas, coalesce(sum(p.descuento_centavos), 0) AS descuentos
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} GROUP BY 1 ORDER BY ventas DESC`,
    )
    .all(...parametrosDe(tiendaId, rango));
  const total = filas.reduce((suma, f) => suma + f.ventas, 0);
  return conPorcentaje(
    filas.map((f) => ({ ...f, clave: f.pago, titulo: FORMAS_DE_PAGO[f.pago].titulo, ticket: Math.round(f.ventas / f.pedidos) })),
    total,
    'ventas',
  );
}

// Ventas por forma de entrega (la que eligió el cliente, tal como se llamaba en ese momento).
export async function ventasPorEntrega(db, tiendaId, rango) {
  const filas = await db
    .prepare(
      `SELECT p.entrega_tipo AS tipo, p.entrega_nombre AS titulo, count(*) AS pedidos, sum(p.total_centavos) AS ventas,
              coalesce(sum(p.envio_centavos), 0) AS envios
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} GROUP BY 1, 2 ORDER BY ventas DESC`,
    )
    .all(...parametrosDe(tiendaId, rango));
  return conPorcentaje(filas, filas.reduce((suma, f) => suma + f.ventas, 0), 'ventas');
}

// De dónde son los pedidos con envío a domicilio: por provincia y por ciudad. Los retiros no tienen dirección.
export async function ventasPorLugar(db, tiendaId, rango) {
  const parametros = parametrosDe(tiendaId, rango);
  const filtro = `${EN_EL_PERIODO} AND ${CONCRETADO} AND p.entrega_tipo = 'domicilio'`;
  const provincias = await db
    .prepare(
      `SELECT coalesce(nullif(p.direccion_provincia, ''), 'Sin datos') AS titulo, count(*) AS pedidos, sum(p.total_centavos) AS ventas,
              count(DISTINCT ${CLIENTE}) AS clientes
       FROM pedidos p WHERE ${filtro} GROUP BY 1 ORDER BY ventas DESC`,
    )
    .all(...parametros);
  const ciudades = await db
    .prepare(
      `SELECT coalesce(nullif(p.direccion_ciudad, ''), 'Sin datos') AS titulo,
              coalesce(nullif(p.direccion_provincia, ''), 'Sin datos') AS provincia, count(*) AS pedidos, sum(p.total_centavos) AS ventas
       FROM pedidos p WHERE ${filtro} GROUP BY 1, 2 ORDER BY ventas DESC LIMIT 10`,
    )
    .all(...parametros);
  const total = provincias.reduce((suma, f) => suma + f.ventas, 0);
  return { provincias: conPorcentaje(provincias, total, 'ventas'), ciudades: conPorcentaje(ciudades, total, 'ventas') };
}

// Cuánto tardan los pedidos entregados en cerrarse (desde que llegan hasta el último cambio), y cuántos hay con envío por coordinar.
export async function tiempoHastaEntregar(db, tiendaId, rango) {
  const f = await db
    .prepare(
      `SELECT avg(extract(epoch FROM (p.actualizado_en::timestamp - p.creado_en::timestamp))) AS segundos, count(*) AS pedidos
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND p.estado = 'entregado'`,
    )
    .get(...parametrosDe(tiendaId, rango));
  return f.pedidos ? { segundos: f.segundos, pedidos: f.pedidos } : null;
}

// Lo que está demorado ahora mismo, sin importar el período: pedidos que esperan hace días.
export async function pedidosDemorados(db, tiendaId, ahora = new Date()) {
  const f = await db
    .prepare(
      `SELECT count(*) FILTER (WHERE estado = 'nuevo' AND creado_en < ?) AS "nuevos",
              coalesce(sum(total_centavos) FILTER (WHERE estado = 'nuevo' AND creado_en < ?), 0) AS "montoNuevos",
              count(*) FILTER (WHERE estado = 'pagado' AND actualizado_en < ?) AS "pagados",
              count(*) FILTER (WHERE estado = 'enviado' AND actualizado_en < ?) AS "enviados"
       FROM pedidos WHERE tienda_id = ?`,
    )
    .get(haceDias(ahora, DIAS_NUEVO_SIN_CONFIRMAR), haceDias(ahora, DIAS_NUEVO_SIN_CONFIRMAR), haceDias(ahora, DIAS_PAGADO_SIN_ENVIAR), haceDias(ahora, DIAS_ENVIADO_SIN_CERRAR), tiendaId);
  return { ...f, diasNuevos: DIAS_NUEVO_SIN_CONFIRMAR, diasPagados: DIAS_PAGADO_SIN_ENVIAR, diasEnviados: DIAS_ENVIADO_SIN_CERRAR, hay: f.nuevos + f.pagados + f.enviados > 0 };
}

// ---------- Clientes ----------

export async function clientesDelPeriodo(db, tiendaId, rango) {
  const { desdeUtc, hastaUtc } = limitesUtc(rango);
  // Cada cliente con su primer pedido (hasta el final del período) y cuántos hizo en el período.
  const resumen = await db
    .prepare(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE c.pedidos >= 2) AS "queVolvieron",
              count(*) FILTER (WHERE c.en_periodo > 0) AS activos,
              count(*) FILTER (WHERE c.en_periodo > 0 AND c.primera >= ?) AS nuevos,
              count(*) FILTER (WHERE c.en_periodo > 0 AND c.primera < ?) AS recurrentes
       FROM (SELECT ${CLIENTE} AS clave, min(p.creado_en) AS primera, count(*) AS pedidos,
                    count(*) FILTER (WHERE p.creado_en >= ?) AS en_periodo
             FROM pedidos p WHERE p.tienda_id = ? AND ${CONCRETADO} AND p.creado_en < ? GROUP BY 1) c`,
    )
    .get(desdeUtc, desdeUtc, desdeUtc, tiendaId, hastaUtc);
  const mejores = await db
    .prepare(
      `SELECT (array_agg(p.cliente_nombre ORDER BY p.creado_en DESC))[1] AS nombre,
              (array_agg(p.cliente_telefono ORDER BY p.creado_en DESC))[1] AS telefono,
              count(*) AS pedidos, sum(p.total_centavos) AS total, max(p.creado_en) AS ultima
       FROM pedidos p WHERE ${EN_EL_PERIODO} AND ${CONCRETADO}
       GROUP BY ${CLIENTE} ORDER BY total DESC, pedidos DESC, nombre LIMIT 10`,
    )
    .all(tiendaId, desdeUtc, hastaUtc);
  return { ...resumen, tasaRecompra: proporcion(resumen.queVolvieron, resumen.total), mejores };
}

// ---------- Productos ----------

// Lo vendido en el período por producto y por variante (sin cancelados ni pedidos nuevos), de mayor a menor facturación.
export async function productosVendidos(db, tiendaId, rango, { conVariantes = true } = {}) {
  const parametros = parametrosDe(tiendaId, rango);
  const productos = await db
    .prepare(
      `SELECT coalesce(nullif(i.slug, ''), i.nombre) AS clave, max(i.nombre) AS nombre, max(pr.id) AS id,
              sum(i.cantidad) AS unidades, sum(i.precio_centavos * i.cantidad) AS monto, count(DISTINCT i.pedido_id) AS pedidos
       FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
       LEFT JOIN productos pr ON pr.tienda_id = p.tienda_id AND pr.slug = i.slug
       WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} GROUP BY 1 ORDER BY monto DESC, unidades DESC LIMIT 500`,
    )
    .all(...parametros);
  const variantes = conVariantes
    ? await db
        .prepare(
          `SELECT i.sku, max(i.nombre) AS nombre, max(i.detalle) AS detalle, max(pr.id) AS id,
                  sum(i.cantidad) AS unidades, sum(i.precio_centavos * i.cantidad) AS monto
           FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
           LEFT JOIN productos pr ON pr.tienda_id = p.tienda_id AND pr.slug = i.slug
           WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} GROUP BY 1 ORDER BY monto DESC, unidades DESC LIMIT 500`,
        )
        .all(...parametros)
    : [];
  const montoTotal = productos.reduce((suma, f) => suma + f.monto, 0);
  const unidadesTotales = productos.reduce((suma, f) => suma + f.unidades, 0);
  const masUnidades = (lista) => [...lista].sort((a, b) => b.unidades - a.unidades || b.monto - a.monto);
  return {
    // Cuántos productos y variantes distintos se vendieron (puede haber más que los que se listan).
    distintos: productos.length,
    variantesDistintas: variantes.length,
    porMonto: conPorcentaje(productos.slice(0, 10), montoTotal, 'monto'),
    porUnidades: conPorcentaje(masUnidades(productos).slice(0, 10), unidadesTotales, 'unidades'),
    variantes: conPorcentaje(variantes.slice(0, 10), montoTotal, 'monto'),
    variantesPorUnidades: conPorcentaje(masUnidades(variantes).slice(0, 10), unidadesTotales, 'unidades'),
  };
}

// Ventas por categoría de primer nivel (lo vendido en sus subcategorías suma en ella). Un producto que está en dos categorías
// distintas cuenta en las dos; lo que no tiene categoría, o ya no está en el catálogo, va a "Sin categoría".
export async function ventasPorCategoria(db, tiendaId, rango) {
  const { desdeUtc, hastaUtc } = limitesUtc(rango);
  const filas = await db
    .prepare(
      `WITH RECURSIVE raiz(id, raiz_id) AS (
         SELECT id, id FROM categorias WHERE tienda_id = ? AND padre_id IS NULL
         UNION ALL
         SELECT c.id, r.raiz_id FROM categorias c JOIN raiz r ON c.padre_id = r.id
       ),
       lineas AS (
         SELECT i.pedido_id, i.cantidad, i.precio_centavos * i.cantidad AS monto, v.producto_id
         FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
         LEFT JOIN variantes v ON v.tienda_id = p.tienda_id AND v.sku = i.sku
         WHERE ${EN_EL_PERIODO} AND ${CONCRETADO}
       ),
       mapa AS (
         SELECT DISTINCT pc.producto_id, r.raiz_id FROM producto_categorias pc JOIN raiz r ON r.id = pc.categoria_id
       )
       SELECT coalesce(m.raiz_id, 0) AS id, coalesce(c.nombre, 'Sin categoría') AS nombre,
              sum(l.cantidad) AS unidades, sum(l.monto) AS monto, count(DISTINCT l.pedido_id) AS pedidos
       FROM lineas l LEFT JOIN mapa m ON m.producto_id = l.producto_id LEFT JOIN categorias c ON c.id = m.raiz_id
       GROUP BY 1, 2 ORDER BY monto DESC`,
    )
    .all(tiendaId, tiendaId, desdeUtc, hastaUtc);
  return conPorcentaje(filas, filas.reduce((suma, f) => suma + f.monto, 0), 'monto');
}

// Ventas por marca (solo los productos que tienen marca y todavía existen en el catálogo).
export async function ventasPorMarca(db, tiendaId, rango) {
  const filas = await db
    .prepare(
      `SELECT pr.marca AS nombre, sum(i.cantidad) AS unidades, sum(i.precio_centavos * i.cantidad) AS monto, count(DISTINCT i.pedido_id) AS pedidos
       FROM pedido_items i JOIN pedidos p ON p.id = i.pedido_id
       JOIN variantes v ON v.tienda_id = p.tienda_id AND v.sku = i.sku JOIN productos pr ON pr.id = v.producto_id
       WHERE ${EN_EL_PERIODO} AND ${CONCRETADO} AND pr.marca <> ''
       GROUP BY pr.marca ORDER BY monto DESC, pr.marca LIMIT 10`,
    )
    .all(...parametrosDe(tiendaId, rango));
  return conPorcentaje(filas, filas.reduce((suma, f) => suma + f.monto, 0), 'monto');
}

// Productos visibles y con stock que no se vendieron nada en el período, los de más stock primero.
export async function productosSinVentas(db, tiendaId, rango) {
  const { desdeUtc, hastaUtc } = limitesUtc(rango);
  // Primero los productos que sí se vendieron (una sola pasada por los pedidos del período) y después se descartan.
  const filas = await db
    .prepare(
      `WITH vendidos AS (
         SELECT DISTINCT v.producto_id
         FROM pedidos o JOIN pedido_items i ON i.pedido_id = o.id JOIN variantes v ON v.tienda_id = o.tienda_id AND v.sku = i.sku
         WHERE o.tienda_id = ? AND o.estado IN ('pagado', 'enviado', 'entregado') AND o.creado_en >= ? AND o.creado_en < ?
       )
       SELECT p.id, p.nombre, sum(v.stock) AS unidades, sum(v.stock * ${PRECIO_VIGENTE}) AS valor, count(*) OVER () AS total
       FROM productos p JOIN variantes v ON v.producto_id = p.id
       WHERE p.tienda_id = ? AND p.visible = 1 AND v.stock > 0 AND NOT EXISTS (SELECT 1 FROM vendidos x WHERE x.producto_id = p.id)
       GROUP BY p.id, p.nombre ORDER BY valor DESC, p.nombre LIMIT 8`,
    )
    .all(tiendaId, desdeUtc, hastaUtc, tiendaId);
  return { total: filas[0]?.total ?? 0, lista: filas };
}

// Cómo está armado el catálogo.
export async function resumenDelCatalogo(db, tiendaId, rango) {
  const { desdeUtc, hastaUtc } = limitesUtc(rango);
  const c = await db
    .prepare(
      `SELECT count(*) AS total,
              coalesce(sum(CASE WHEN p.visible = 1 THEN 1 ELSE 0 END), 0) AS visibles,
              coalesce(sum(CASE WHEN p.visible = 0 THEN 1 ELSE 0 END), 0) AS ocultos,
              coalesce(sum(CASE WHEN p.destacado = 1 THEN 1 ELSE 0 END), 0) AS destacados,
              coalesce(sum(CASE WHEN NOT EXISTS (SELECT 1 FROM producto_fotos f WHERE f.producto_id = p.id) THEN 1 ELSE 0 END), 0) AS "sinFoto",
              coalesce(sum(CASE WHEN NOT EXISTS (SELECT 1 FROM producto_categorias k WHERE k.producto_id = p.id) THEN 1 ELSE 0 END), 0) AS "sinCategoria",
              coalesce(sum(CASE WHEN EXISTS (SELECT 1 FROM variantes v WHERE v.producto_id = p.id AND v.precio_promocional_centavos IS NOT NULL) THEN 1 ELSE 0 END), 0) AS "enOferta",
              coalesce(sum(CASE WHEN p.creado_en >= ? AND p.creado_en < ? THEN 1 ELSE 0 END), 0) AS "nuevosEnElPeriodo"
       FROM productos p WHERE p.tienda_id = ?`,
    )
    .get(desdeUtc, hastaUtc, tiendaId);
  const v = await db
    .prepare(
      `SELECT count(*) AS variantes, min(${PRECIO_VIGENTE}) AS "precioMinimo", max(${PRECIO_VIGENTE}) AS "precioMaximo",
              coalesce(avg(${PRECIO_VIGENTE}), 0) AS "precioPromedio"
       FROM variantes v WHERE v.tienda_id = ?`,
    )
    .get(tiendaId);
  const { categorias } = await db.prepare('SELECT count(*) AS categorias FROM categorias WHERE tienda_id = ?').get(tiendaId);
  return { ...c, ...v, precioPromedio: Math.round(v.precioPromedio), categorias };
}

// ---------- Stock ----------

// Cuánto hay, cuánto vale a precio de venta y qué se está por acabar o no se mueve.
export async function inventario(db, tiendaId, ahora = new Date()) {
  const totales = await db
    .prepare(
      `SELECT coalesce(sum(v.stock), 0) AS unidades,
              coalesce(sum(v.stock * ${PRECIO_VIGENTE}), 0) AS "valorAPrecioDeVenta",
              coalesce(sum(v.stock * v.precio_centavos), 0) AS "valorAPrecioDeLista",
              count(*) AS variantes,
              coalesce(sum(CASE WHEN v.stock = 0 THEN 1 ELSE 0 END), 0) AS "variantesSinStock",
              coalesce(sum(CASE WHEN v.stock BETWEEN 1 AND ? THEN 1 ELSE 0 END), 0) AS "variantesConPocas"
       FROM variantes v WHERE v.tienda_id = ?`,
    )
    .get(POCAS_UNIDADES, tiendaId);
  const { productosSinStock } = await db
    .prepare(
      `SELECT count(*) AS "productosSinStock" FROM productos p WHERE p.tienda_id = ?
       AND NOT EXISTS (SELECT 1 FROM variantes v WHERE v.producto_id = p.id AND v.stock > 0)`,
    )
    .get(tiendaId);

  // Lo que ya se agotó y lo que está por agotarse, para ir a reponerlo.
  const agotados = await db
    .prepare(
      `SELECT p.id, p.nombre, p.visible, count(*) OVER () AS total FROM productos p WHERE p.tienda_id = ?
       AND NOT EXISTS (SELECT 1 FROM variantes v WHERE v.producto_id = p.id AND v.stock > 0)
       ORDER BY p.visible DESC, lower(p.nombre) LIMIT 8`,
    )
    .all(tiendaId);
  const pocas = (await db
    .prepare(
      `SELECT p.id, p.nombre, v.stock, v.valor1, v.valor2, v.valor3
       FROM variantes v JOIN productos p ON p.id = v.producto_id
       WHERE v.tienda_id = ? AND v.stock BETWEEN 1 AND ? ORDER BY v.stock, lower(p.nombre) LIMIT 8`,
    )
    .all(tiendaId, POCAS_UNIDADES))
    .map((v) => ({ ...v, valores: [v.valor1, v.valor2, v.valor3].filter((x) => x !== null).join(' / ') }));

  // Si se sigue vendiendo como en los últimos 30 días, ¿en cuántos días se acaba cada variante?
  const aLaVenta = await db
    .prepare(
      `SELECT v.sku, v.stock, p.id, p.nombre, v.valor1, v.valor2, v.valor3, s.unidades, v.stock * ${DIAS_PARA_VENDER}.0 / s.unidades AS dias
       FROM variantes v JOIN productos p ON p.id = v.producto_id
       JOIN (SELECT i.sku, sum(i.cantidad) AS unidades
             FROM pedido_items i JOIN pedidos o ON o.id = i.pedido_id
             WHERE o.tienda_id = ? AND o.estado IN ('pagado', 'enviado', 'entregado') AND o.creado_en >= ? GROUP BY i.sku) s ON s.sku = v.sku
       WHERE v.tienda_id = ? AND v.stock > 0 AND s.unidades > 0
       ORDER BY dias, p.nombre LIMIT 8`,
    )
    .all(tiendaId, haceDias(ahora, DIAS_PARA_VENDER), tiendaId);
  const seAcaban = aLaVenta
    .filter((v) => v.dias <= DIAS_PARA_VENDER)
    .map((v) => ({ ...v, valores: [v.valor1, v.valor2, v.valor3].filter((x) => x !== null).join(' / '), dias: Math.max(1, Math.round(v.dias)) }));

  // Productos con stock que no se vendieron en tres meses (y que ya tenían tres meses en el catálogo).
  const limite = haceDias(ahora, DIAS_SIN_MOVIMIENTO);
  const dormido = await db
    .prepare(
      `WITH vendidos AS (
         SELECT DISTINCT v.producto_id
         FROM pedidos o JOIN pedido_items i ON i.pedido_id = o.id JOIN variantes v ON v.tienda_id = o.tienda_id AND v.sku = i.sku
         WHERE o.tienda_id = ? AND o.estado IN ('pagado', 'enviado', 'entregado') AND o.creado_en >= ?
       )
       SELECT p.id, p.nombre, sum(v.stock) AS unidades, sum(v.stock * ${PRECIO_VIGENTE}) AS valor,
              count(*) OVER () AS total, sum(sum(v.stock * ${PRECIO_VIGENTE})) OVER () AS "valorTotal"
       FROM productos p JOIN variantes v ON v.producto_id = p.id
       WHERE p.tienda_id = ? AND p.creado_en < ? AND v.stock > 0 AND NOT EXISTS (SELECT 1 FROM vendidos x WHERE x.producto_id = p.id)
       GROUP BY p.id, p.nombre ORDER BY valor DESC, p.nombre LIMIT 8`,
    )
    .all(tiendaId, limite, tiendaId, limite);

  // Con más stock.
  const masStock = await db
    .prepare(
      `SELECT p.id, p.nombre, sum(v.stock) AS unidades, sum(v.stock * ${PRECIO_VIGENTE}) AS valor
       FROM productos p JOIN variantes v ON v.producto_id = p.id WHERE p.tienda_id = ?
       GROUP BY p.id, p.nombre HAVING sum(v.stock) > 0 ORDER BY valor DESC, p.nombre LIMIT 8`,
    )
    .all(tiendaId);

  return {
    ...totales,
    productosSinStock,
    agotados: agotados.map(({ total, ...p }) => p),
    pocas,
    seAcaban,
    diasParaVender: DIAS_PARA_VENDER,
    dormido: { total: dormido[0]?.total ?? 0, valor: dormido[0]?.valorTotal ?? 0, lista: dormido, dias: DIAS_SIN_MOVIMIENTO },
    masStock,
    pocasUnidades: POCAS_UNIDADES,
  };
}

// ---------- Todo junto ----------

async function primerDiaConPedidos(db, tiendaId) {
  const { primero } = await db.prepare('SELECT min(creado_en) AS primero FROM pedidos WHERE tienda_id = ?').get(tiendaId);
  if (!primero) return null;
  const instante = new Date(`${primero.replace(' ', 'T')}Z`);
  return new Date(instante.getTime() - HORAS_DE_DIFERENCIA * 3_600_000).toISOString().slice(0, 10);
}

// Los datos que necesita un panel del Dashboard para un período. Solo calcula lo que ese panel muestra.
// entrada: { periodo, desde, hasta, panel } tal como vienen en la URL. hoy: el día de hoy en Argentina (para los tests).
export async function datosDashboard(db, tiendaId, entrada = {}, { hoy = hoyEnArgentina(), ahora = new Date() } = {}) {
  const panel = esPanel(entrada.panel) ? entrada.panel : PANEL_INICIAL;
  const periodo = resolverPeriodo(entrada, { hoy, primerDia: texto(entrada.periodo) === 'todo' ? await primerDiaConPedidos(db, tiendaId) : null });
  const datos = { panel, periodo, hoy, valoresRango: { desde: texto(entrada.desde), hasta: texto(entrada.hasta) } };
  const sumar = (obj) => Object.assign(datos, obj);

  if (panel === 'resumen') {
    const totales = await totalesDelPeriodo(db, tiendaId, periodo);
    const anteriores = periodo.anterior ? await totalesDelPeriodo(db, tiendaId, periodo.anterior) : null;
    sumar({
      totales,
      anteriores,
      cambios: compararTotales(totales, anteriores),
      serie: await ventasPorDia(db, tiendaId, periodo),
      estados: await pedidosPorEstado(db, tiendaId, periodo),
      pagos: await ventasPorPago(db, tiendaId, periodo),
      productos: await productosVendidos(db, tiendaId, periodo, { conVariantes: false }),
      demorados: await pedidosDemorados(db, tiendaId, ahora),
      // Con un solo día, un gráfico de "ventas por día" es una sola columna: se muestra cómo se repartieron los pedidos en las horas.
      ...(periodo.dias === 1 && { momentos: await momentosDeCompra(db, tiendaId, periodo) }),
    });
  } else if (panel === 'ventas') {
    const totales = await totalesDelPeriodo(db, tiendaId, periodo);
    const anteriores = periodo.anterior ? await totalesDelPeriodo(db, tiendaId, periodo.anterior) : null;
    sumar({
      totales,
      anteriores,
      cambios: compararTotales(totales, anteriores),
      serie: await ventasPorDia(db, tiendaId, periodo),
      momentos: await momentosDeCompra(db, tiendaId, periodo),
      pagos: await ventasPorPago(db, tiendaId, periodo),
      entregas: await ventasPorEntrega(db, tiendaId, periodo),
      lugares: await ventasPorLugar(db, tiendaId, periodo),
      categorias: await ventasPorCategoria(db, tiendaId, periodo),
    });
  } else if (panel === 'pedidos') {
    const totales = await totalesDelPeriodo(db, tiendaId, periodo);
    const anteriores = periodo.anterior ? await totalesDelPeriodo(db, tiendaId, periodo.anterior) : null;
    sumar({
      totales,
      cambios: compararTotales(totales, anteriores),
      estados: await pedidosPorEstado(db, tiendaId, periodo),
      demorados: await pedidosDemorados(db, tiendaId, ahora),
      tiempo: await tiempoHastaEntregar(db, tiendaId, periodo),
      momentos: await momentosDeCompra(db, tiendaId, periodo),
      entregas: await ventasPorEntrega(db, tiendaId, periodo),
    });
  } else if (panel === 'clientes') {
    const totales = await totalesDelPeriodo(db, tiendaId, periodo);
    const anteriores = periodo.anterior ? await totalesDelPeriodo(db, tiendaId, periodo.anterior) : null;
    sumar({
      totales,
      cambios: compararTotales(totales, anteriores),
      clientes: await clientesDelPeriodo(db, tiendaId, periodo),
      lugares: await ventasPorLugar(db, tiendaId, periodo),
    });
  } else if (panel === 'productos') {
    sumar({
      totales: await totalesDelPeriodo(db, tiendaId, periodo),
      vendidos: await productosVendidos(db, tiendaId, periodo),
      categorias: await ventasPorCategoria(db, tiendaId, periodo),
      marcas: await ventasPorMarca(db, tiendaId, periodo),
      sinVentas: await productosSinVentas(db, tiendaId, periodo),
      catalogo: await resumenDelCatalogo(db, tiendaId, periodo),
    });
  } else {
    sumar({ inventario: await inventario(db, tiendaId, ahora) });
  }
  return datos;
}
