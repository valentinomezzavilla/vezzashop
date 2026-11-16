// Pedidos: del carrito al pedido (checkout) y su seguimiento desde el panel.
import { randomBytes } from 'node:crypto';
import { enTransaccion } from './db.js';
import { variantesParaCarrito } from './vidriera.js';
import { FORMAS_DE_PAGO } from './pagos.js';
import { formatearPrecio } from './util/formato.js';
import { slugificar } from './util/slug.js';

export const MAX_LINEAS = 50;
export const MAX_POR_LINEA = 50;
// Primer número del par de pg_advisory_xact_lock(<este>, <id de tienda>): un candado por tienda para crear pedidos.
const CANDADO_PEDIDOS = 727_002;

export const PROVINCIAS = [
  'Buenos Aires', 'Ciudad de Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos',
  'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan',
  'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

// Estados de un pedido. "enviado" se lee "Listo para retirar" cuando el cliente lo busca.
export const ESTADOS = {
  nuevo: { titulo: 'Nuevo', cliente: 'Recibido' },
  pagado: { titulo: 'Pagado', cliente: 'Pago confirmado' },
  enviado: { titulo: 'Enviado', tituloRetiro: 'Listo para retirar', cliente: 'En camino', clienteRetiro: 'Listo para retirar' },
  entregado: { titulo: 'Entregado', cliente: 'Entregado' },
  cancelado: { titulo: 'Cancelado', cliente: 'Cancelado' },
};
export const esEstado = (valor) => typeof valor === 'string' && Object.hasOwn(ESTADOS, valor);

export function tituloEstado(estado, tipoEntrega, { paraCliente = false } = {}) {
  const datos = ESTADOS[estado];
  if (paraCliente) return (tipoEntrega === 'retiro' && datos.clienteRetiro) || datos.cliente;
  return (tipoEntrega === 'retiro' && datos.tituloRetiro) || datos.titulo;
}

export class ErrorDeStock extends Error {
  constructor(problemas) {
    super('Cambió el stock de algunos productos');
    this.problemas = problemas;
  }
}

const texto = (valor, largo = 200) => String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, largo);
const lista = (valor) => (Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]);

// ---------- Carrito ----------

// Lo que viene en la URL o en el formulario: sku=A&cantidad=2&sku=B&cantidad=1. Sin repetidos y con topes.
export function leerItems(campos) {
  const skus = lista(campos.sku);
  const cantidades = lista(campos.cantidad);
  const items = new Map();
  skus.forEach((sku, n) => {
    const limpio = String(sku ?? '').trim();
    const cantidad = Number.parseInt(cantidades[n], 10);
    if (!limpio || limpio.length > 100 || !Number.isInteger(cantidad) || cantidad < 1) return;
    items.set(limpio, Math.min((items.get(limpio) ?? 0) + cantidad, MAX_POR_LINEA));
  });
  return [...items].slice(0, MAX_LINEAS).map(([sku, cantidad]) => ({ sku, cantidad }));
}

// Las líneas del carrito con los precios y el stock de ahora. Lo que ya no está o no tiene stock suficiente
// se ajusta, y se avisa qué cambió.
export async function lineasDelCarrito(db, tiendaId, items) {
  const porSku = new Map((await variantesParaCarrito(db, tiendaId, items.map((i) => i.sku))).map((v) => [v.sku, v]));
  const lineas = [];
  const cambios = [];
  for (const item of items) {
    const variante = porSku.get(item.sku);
    if (!variante || variante.stock <= 0) {
      cambios.push(`${variante?.nombre ?? 'Un producto'} ya no tiene stock y lo sacamos.`);
      continue;
    }
    const disponibles = Math.min(variante.stock, MAX_POR_LINEA);
    if (item.cantidad > disponibles) {
      cambios.push(`De ${variante.nombre} quedan ${disponibles}: ajustamos la cantidad.`);
    }
    lineas.push({
      sku: variante.sku,
      nombre: variante.nombre,
      detalle: variante.detalle,
      slug: variante.slug,
      foto: variante.foto,
      precio: variante.precioFinal,
      precioLista: variante.precioFinal < variante.precio ? variante.precio : null,
      cantidad: Math.min(item.cantidad, disponibles),
      disponibles,
    });
  }
  return { lineas, cambios };
}

// ---------- Totales ----------

// Costo del envío para un subtotal: null si se coordina después.
export function costoEnvio(entrega, subtotal) {
  if (!entrega || entrega.costo === null) return null;
  if (entrega.gratisDesde !== null && subtotal >= entrega.gratisDesde) return 0;
  return entrega.costo;
}

// El descuento de la forma de pago se aplica sobre los productos, no sobre el envío.
export function calcularTotales(subtotal, entrega, pago) {
  const descuentoPorcentaje = pago?.descuento ?? 0;
  const descuento = Math.round((subtotal * descuentoPorcentaje) / 100);
  const envio = costoEnvio(entrega, subtotal);
  return { subtotal, descuentoPorcentaje, descuento, envio, total: subtotal - descuento + (envio ?? 0) };
}

export const subtotalDe = (lineas) => lineas.reduce((suma, l) => suma + l.precio * l.cantidad, 0);

// ---------- Validación del checkout ----------

const CAMPOS_TEXTO = {
  nombre: 100, telefono: 30, email: 120, calle: 150, piso: 50, ciudad: 80, provincia: 40, cp: 10, referencias: 200, notas: 500,
};

// Valida lo que completó el cliente. `entregas` y `pagos` son las opciones activas de la tienda.
// Devuelve { datos, valores, errores }; datos solo sirve si no hay errores.
export function validarCheckout(campos, { entregas, pagos }) {
  const valores = Object.fromEntries(Object.entries(CAMPOS_TEXTO).map(([campo, largo]) => [campo, texto(campos[campo], largo)]));
  valores.notas = String(campos.notas ?? '').trim().slice(0, CAMPOS_TEXTO.notas);
  valores.entrega = String(campos.entrega ?? '');
  valores.pago = String(campos.pago ?? '');
  const errores = {};

  if (valores.nombre.length < 3) errores.nombre = 'Escribí tu nombre y apellido';
  const digitos = valores.telefono.replace(/\D/g, '');
  if (digitos.length < 8 || digitos.length > 15) errores.telefono = 'Escribí tu teléfono con código de área, por ejemplo 351 123 4567';
  if (valores.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valores.email)) errores.email = 'El email no es válido';

  const entrega = entregas.find((e) => String(e.id) === valores.entrega);
  if (!entrega) errores.entrega = 'Elegí cómo querés recibir tu pedido';
  if (entrega?.tipo === 'domicilio') {
    if (!valores.calle) errores.calle = 'Escribí la calle y el número';
    if (!valores.ciudad) errores.ciudad = 'Escribí la ciudad o localidad';
    if (!PROVINCIAS.includes(valores.provincia)) errores.provincia = 'Elegí la provincia';
    if (valores.cp && !/^[A-Za-z0-9 ]{4,10}$/.test(valores.cp)) errores.cp = 'El código postal no es válido';
  }

  const pago = pagos.find((p) => p.clave === valores.pago);
  if (!pago) errores.pago = 'Elegí cómo querés pagar';
  else if (pago.clave === 'efectivo' && entrega && !entrega.aceptaEfectivo) {
    errores.pago = `El pago en efectivo no está disponible con "${entrega.nombre}". Elegí otra forma de pago.`;
  }

  const conDireccion = entrega?.tipo === 'domicilio';
  return {
    valores,
    errores,
    datos: {
      cliente: { nombre: valores.nombre, telefono: valores.telefono, email: valores.email },
      entrega,
      direccion: conDireccion
        ? { calle: valores.calle, piso: valores.piso, ciudad: valores.ciudad, provincia: valores.provincia, cp: valores.cp, referencias: valores.referencias }
        : { calle: '', piso: '', ciudad: '', provincia: '', cp: '', referencias: '' },
      pago,
      notas: valores.notas,
    },
  };
}

// ---------- Crear el pedido ----------

// Crea el pedido y descuenta el stock, todo junto. Si algo ya no tiene stock suficiente no crea nada
// y tira ErrorDeStock. Los precios salen de la base, nunca de lo que mandó el navegador.
export function crearPedido(db, tiendaId, items, datos) {
  return enTransaccion(db, async (tx) => {
    // Un pedido por vez en cada tienda: el número sale de max(numero) + 1, y dos pedidos simultáneos leerían el mismo.
    // El candado se suelta solo al terminar la transacción. El stock no lo necesita: el UPDATE de abajo es atómico.
    await tx.prepare('SELECT pg_advisory_xact_lock(?, ?)').get(CANDADO_PEDIDOS, tiendaId);
    const { lineas, cambios } = await lineasDelCarrito(tx, tiendaId, items);
    if (cambios.length > 0) throw new ErrorDeStock(cambios);
    if (lineas.length === 0) throw new ErrorDeStock(['Tu carrito está vacío.']);

    const descontar = tx.prepare(
      `UPDATE variantes SET stock = stock - ?, actualizado_en = ahora() WHERE tienda_id = ? AND sku = ? AND stock >= ?`,
    );
    for (const linea of lineas) {
      if ((await descontar.run(linea.cantidad, tiendaId, linea.sku, linea.cantidad)).changes !== 1) {
        throw new ErrorDeStock([`De ${linea.nombre} ya no hay stock suficiente.`]);
      }
    }

    const totales = calcularTotales(subtotalDe(lineas), datos.entrega, datos.pago);
    const token = randomBytes(18).toString('base64url');
    const { cliente, entrega, direccion } = datos;
    const pedido = await tx
      .prepare(
        `INSERT INTO pedidos (tienda_id, numero, token, cliente_nombre, cliente_telefono, cliente_email,
           entrega_tipo, entrega_nombre, entrega_descripcion,
           direccion_calle, direccion_piso, direccion_ciudad, direccion_provincia, direccion_cp, direccion_referencias,
           pago, notas, subtotal_centavos, descuento_porcentaje, descuento_centavos, envio_centavos, total_centavos)
         VALUES (?, (SELECT coalesce(max(numero), 0) + 1 FROM pedidos WHERE tienda_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, numero, token`,
      )
      .get(
        tiendaId, tiendaId, token, cliente.nombre, cliente.telefono, cliente.email,
        entrega.tipo, entrega.nombre, entrega.descripcion,
        direccion.calle, direccion.piso, direccion.ciudad, direccion.provincia, direccion.cp, direccion.referencias,
        datos.pago.clave, datos.notas, totales.subtotal, totales.descuentoPorcentaje, totales.descuento, totales.envio, totales.total,
      );
    const insertarItem = tx.prepare(
      'INSERT INTO pedido_items (pedido_id, sku, nombre, detalle, slug, precio_centavos, cantidad) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const l of lineas) await insertarItem.run(pedido.id, l.sku, l.nombre, l.detalle, l.slug, l.precio, l.cantidad);
    return { id: pedido.id, numero: pedido.numero, token: pedido.token };
  });
}

// ---------- Lectura ----------

const SELECCION_PEDIDO = `SELECT id, numero, token, estado, creado_en AS "creadoEn", actualizado_en AS "actualizadoEn",
  cliente_nombre, cliente_telefono, cliente_email, entrega_tipo, entrega_nombre, entrega_descripcion,
  direccion_calle, direccion_piso, direccion_ciudad, direccion_provincia, direccion_cp, direccion_referencias,
  pago, notas, subtotal_centavos AS subtotal, descuento_porcentaje AS "descuentoPorcentaje", descuento_centavos AS descuento,
  envio_centavos AS envio, total_centavos AS total,
  (SELECT coalesce(sum(cantidad), 0) FROM pedido_items i WHERE i.pedido_id = pedidos.id) AS unidades
  FROM pedidos`;

function filaAPedido(f) {
  return {
    id: f.id,
    numero: f.numero,
    token: f.token,
    estado: f.estado,
    creadoEn: f.creadoEn,
    actualizadoEn: f.actualizadoEn,
    cliente: { nombre: f.cliente_nombre, telefono: f.cliente_telefono, email: f.cliente_email },
    entrega: { tipo: f.entrega_tipo, nombre: f.entrega_nombre, descripcion: f.entrega_descripcion },
    direccion: {
      calle: f.direccion_calle, piso: f.direccion_piso, ciudad: f.direccion_ciudad,
      provincia: f.direccion_provincia, cp: f.direccion_cp, referencias: f.direccion_referencias,
    },
    pago: f.pago,
    tituloPago: FORMAS_DE_PAGO[f.pago].titulo,
    notas: f.notas,
    subtotal: f.subtotal,
    descuentoPorcentaje: f.descuentoPorcentaje,
    descuento: f.descuento,
    envio: f.envio,
    total: f.total,
    unidades: f.unidades,
  };
}

async function conItems(db, pedido) {
  if (!pedido) return null;
  pedido.items = await db
    .prepare('SELECT sku, nombre, detalle, slug, precio_centavos AS precio, cantidad FROM pedido_items WHERE pedido_id = ? ORDER BY id')
    .all(pedido.id);
  return pedido;
}

export async function leerPedido(db, tiendaId, id) {
  const fila = await db.prepare(`${SELECCION_PEDIDO} WHERE tienda_id = ? AND id = ?`).get(tiendaId, id);
  return conItems(db, fila ? filaAPedido(fila) : null);
}

export async function leerPedidoPorToken(db, tiendaId, token) {
  if (typeof token !== 'string' || !/^[\w-]{10,40}$/.test(token)) return null;
  const fila = await db.prepare(`${SELECCION_PEDIDO} WHERE tienda_id = ? AND token = ?`).get(tiendaId, token);
  return conItems(db, fila ? filaAPedido(fila) : null);
}

// Filtros del listado del panel. "abiertos" son los que todavía hay que atender.
export const FILTROS_PEDIDOS = {
  abiertos: { titulo: 'Por atender', donde: "estado IN ('nuevo', 'pagado', 'enviado')" },
  nuevo: { titulo: 'Nuevos', donde: "estado = 'nuevo'" },
  pagado: { titulo: 'Pagados', donde: "estado = 'pagado'" },
  enviado: { titulo: 'Enviados', donde: "estado = 'enviado'" },
  entregado: { titulo: 'Entregados', donde: "estado = 'entregado'" },
  cancelado: { titulo: 'Cancelados', donde: "estado = 'cancelado'" },
  todos: { titulo: 'Todos', donde: 'true' },
};
export const esFiltroPedidos = (valor) => typeof valor === 'string' && Object.hasOwn(FILTROS_PEDIDOS, valor);

export async function listarPedidos(db, tiendaId, { filtro = 'abiertos', busqueda = '' } = {}) {
  const parametros = [tiendaId];
  let donde = `tienda_id = ? AND ${FILTROS_PEDIDOS[filtro].donde}`;
  const limpio = busqueda.trim().replace(/^#/, '');
  if (limpio) {
    donde += ' AND (numero = ? OR slugificar(cliente_nombre) LIKE ? OR cliente_telefono ILIKE ? OR cliente_email ILIKE ?)';
    const patron = `%${limpio}%`;
    parametros.push(Number.parseInt(limpio, 10) || -1, `%${slugificar(limpio)}%`, patron, patron);
  }
  return (await db.prepare(`${SELECCION_PEDIDO} WHERE ${donde} ORDER BY numero DESC LIMIT 200`).all(...parametros)).map(filaAPedido);
}

export async function contarPedidosPorFiltro(db, tiendaId) {
  const columnas = Object.entries(FILTROS_PEDIDOS).map(([clave, f]) => `sum(CASE WHEN ${f.donde} THEN 1 ELSE 0 END) AS "${clave}"`);
  const fila = await db.prepare(`SELECT ${columnas.join(', ')} FROM pedidos WHERE tienda_id = ?`).get(tiendaId);
  return Object.fromEntries(Object.keys(FILTROS_PEDIDOS).map((clave) => [clave, fila[clave] ?? 0]));
}

export const contarPedidosNuevos = async (db, tiendaId) =>
  (await db.prepare("SELECT count(*) AS n FROM pedidos WHERE tienda_id = ? AND estado = 'nuevo'").get(tiendaId)).n;

// ---------- Cambios de estado ----------

// Pasa un pedido a otro estado (salvo cancelar, que tiene su propia función). Un pedido cancelado no vuelve atrás.
export async function cambiarEstado(db, tiendaId, id, estado) {
  if (!esEstado(estado) || estado === 'cancelado') return false;
  return (
    (await db
      .prepare(
        `UPDATE pedidos SET estado = ?, actualizado_en = ahora()
         WHERE tienda_id = ? AND id = ? AND estado <> 'cancelado'`,
      )
      .run(estado, tiendaId, id)).changes > 0
  );
}

// Cancela el pedido y devuelve el stock de lo que todavía existe en el catálogo.
export function cancelarPedido(db, tiendaId, id) {
  return enTransaccion(db, async (tx) => {
    const cancelado = (await tx
      .prepare(
        `UPDATE pedidos SET estado = 'cancelado', actualizado_en = ahora()
         WHERE tienda_id = ? AND id = ? AND estado NOT IN ('cancelado', 'entregado')`,
      )
      .run(tiendaId, id)).changes > 0;
    if (!cancelado) return false;
    const devolver = tx.prepare(`UPDATE variantes SET stock = stock + ?, actualizado_en = ahora() WHERE tienda_id = ? AND sku = ?`);
    for (const item of await tx.prepare('SELECT sku, cantidad FROM pedido_items WHERE pedido_id = ?').all(id)) {
      await devolver.run(item.cantidad, tiendaId, item.sku);
    }
    return true;
  });
}

// ---------- Ayudas para mostrar ----------

// Número para wa.me a partir de lo que escribió el cliente: "351 15-123 4567" -> "5493511234567" (lo mejor posible).
export function telefonoParaWhatsapp(telefono) {
  let digitos = String(telefono ?? '').replace(/\D/g, '');
  if (digitos.startsWith('00')) digitos = digitos.slice(2);
  if (digitos.startsWith('54')) return digitos.startsWith('549') ? digitos : `549${digitos.slice(2)}`;
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  // Celulares escritos con 15 después del código de área (3 o 4 dígitos en el interior, 2 en Buenos Aires).
  const conQuince = digitos.match(/^(\d{2,4})15(\d{6,8})$/);
  if (conQuince && conQuince[1].length + conQuince[2].length === 10) digitos = conQuince[1] + conQuince[2];
  return `549${digitos}`;
}

export function direccionEnUnaLinea(direccion) {
  return [
    [direccion.calle, direccion.piso].filter(Boolean).join(', '),
    direccion.ciudad,
    direccion.provincia,
    direccion.cp && `CP ${direccion.cp}`,
  ].filter(Boolean).join(' · ');
}

// Resumen del pedido en texto, para mandarlo por WhatsApp.
export function resumenEnTexto(pedido, { tienda, urlPedido }) {
  const renglones = pedido.items.map((i) => `• ${i.cantidad} × ${i.nombre}${i.detalle ? ` (${i.detalle})` : ''} — ${formatearPrecio(i.precio * i.cantidad)}`);
  return [
    `¡Hola ${tienda}! Hice el pedido #${pedido.numero}:`,
    '',
    ...renglones,
    '',
    pedido.descuento ? `Descuento ${pedido.descuentoPorcentaje}%: −${formatearPrecio(pedido.descuento)}` : null,
    `Entrega: ${pedido.entrega.nombre}${pedido.envio === null ? ' (costo a coordinar)' : pedido.envio ? ` (${formatearPrecio(pedido.envio)})` : ''}`,
    pedido.entrega.tipo === 'domicilio' ? `Dirección: ${direccionEnUnaLinea(pedido.direccion)}` : null,
    `Pago: ${pedido.tituloPago}`,
    `Total: ${formatearPrecio(pedido.total)}${pedido.envio === null ? ' + envío' : ''}`,
    '',
    `A nombre de ${pedido.cliente.nombre}.`,
    urlPedido ? `Detalle: ${urlPedido}` : null,
  ].filter((r) => r !== null).join('\n');
}
