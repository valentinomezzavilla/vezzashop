// Envíos y pagos: las formas de entrega y de pago que cada tienda ofrece en el checkout.
import { entero } from './diseno.js';
import { enTransaccion } from './db.js';
import { parsearPrecio, ErrorDeValor } from './importacion/valores.js';
import { precioParaEditar } from './productos.js';
import { formatearPrecio } from './util/formato.js';

export const MAX_METODOS_ENTREGA = 10;

export const TIPOS_ENTREGA = {
  retiro: { titulo: 'Retiro en el local', ayuda: 'El cliente lo busca. No pide dirección.' },
  domicilio: { titulo: 'Envío a domicilio', ayuda: 'Le pide la dirección al cliente (moto, cadete, correo...).' },
};

// Las formas de pago son fijas: cada una tiene su comportamiento en el checkout.
export const FORMAS_DE_PAGO = {
  transferencia: { titulo: 'Transferencia bancaria', corto: 'Transferencia' },
  efectivo: { titulo: 'Efectivo', corto: 'Efectivo' },
  mercadopago: { titulo: 'Mercado Pago', corto: 'Mercado Pago' },
};
export const esFormaDePago = (valor) => typeof valor === 'string' && Object.hasOwn(FORMAS_DE_PAGO, valor);

const INSTRUCCIONES_MERCADOPAGO =
  'Te mandamos el link de pago por WhatsApp para que pagues con tarjeta de crédito, débito o dinero en cuenta.';

// Modelos para cargar rápido las formas de entrega más comunes. Se abren en el formulario para revisar
// el costo antes de guardar: no se guarda nada sin que la tienda lo vea.
export const MODELOS_ENTREGA = {
  retiro: {
    tipo: 'retiro',
    nombre: 'Retiro en el local',
    descripcion: 'Coordinamos el día y el horario por WhatsApp.',
    costo: '0',
    aceptaEfectivo: true,
  },
  moto: {
    tipo: 'domicilio',
    nombre: 'Envío en moto en Córdoba Capital',
    descripcion: 'Te llega en 24 a 48 hs hábiles.',
    costo: '',
    aceptaEfectivo: true,
  },
  pais: {
    tipo: 'domicilio',
    nombre: 'Envío a todo el país',
    descripcion: 'Por Correo Argentino o Andreani. Te pasamos el costo según tu código postal.',
    costo: '',
    aCoordinar: true,
    aceptaEfectivo: false,
  },
};

const texto = (valor) => String(valor ?? '').trim();
const marcado = (valor) => valor === '1' || valor === 'on' || valor === true;

// ---------- Formas de pago ----------

// Las formas de pago activas de la tienda, en el orden en que se ofrecen, con su descuento.
export function formasDePagoActivas(ajustes) {
  return [
    ajustes.pagoTransferencia && { clave: 'transferencia', descuento: ajustes.descuentoTransferencia },
    ajustes.pagoEfectivo && { clave: 'efectivo', descuento: ajustes.descuentoEfectivo },
    ajustes.pagoMercadopago && { clave: 'mercadopago', descuento: 0 },
  ]
    .filter(Boolean)
    .map((forma) => ({ ...forma, ...FORMAS_DE_PAGO[forma.clave] }));
}

export const instruccionesMercadopago = (ajustes) => ajustes.mercadopagoInstrucciones || INSTRUCCIONES_MERCADOPAGO;

// Valida el formulario de formas de pago. Devuelve { ajustes, errores }.
export function validarPagos(campos) {
  const errores = {};
  const ajustes = {
    pagoTransferencia: marcado(campos.pagoTransferencia),
    pagoEfectivo: marcado(campos.pagoEfectivo),
    pagoMercadopago: marcado(campos.pagoMercadopago),
    transferenciaAlias: texto(campos.transferenciaAlias),
    transferenciaCbu: texto(campos.transferenciaCbu).replace(/[\s-]/g, ''),
    transferenciaTitular: texto(campos.transferenciaTitular).slice(0, 100),
    transferenciaBanco: texto(campos.transferenciaBanco).slice(0, 60),
    mercadopagoInstrucciones: texto(campos.mercadopagoInstrucciones).replace(/\s+/g, ' '),
  };

  // Los datos de la cuenta se revisan si la transferencia está activa (si no, sus campos ni se ven).
  if (ajustes.pagoTransferencia) {
    if (ajustes.transferenciaAlias && !/^[a-zA-Z0-9.-]{6,20}$/.test(ajustes.transferenciaAlias)) {
      errores.transferenciaAlias = 'El alias tiene entre 6 y 20 letras, números, puntos o guiones';
    }
    if (ajustes.transferenciaCbu && !/^\d{22}$/.test(ajustes.transferenciaCbu)) {
      errores.transferenciaCbu = 'El CBU o CVU tiene 22 números';
    }
    if (!ajustes.transferenciaAlias && !ajustes.transferenciaCbu) {
      errores.transferenciaAlias = 'Para cobrar por transferencia, escribí tu alias o tu CBU/CVU';
    }
  } else {
    ajustes.transferenciaAlias = ajustes.transferenciaAlias.slice(0, 20);
    ajustes.transferenciaCbu = ajustes.transferenciaCbu.slice(0, 30);
  }
  if (ajustes.mercadopagoInstrucciones.length > 300) errores.mercadopagoInstrucciones = 'Máximo 300 caracteres';

  const porcentaje = (campo) => {
    const resultado = entero(campos[campo], 0, 90, 'Tiene que ser un número entero entre 0 y 90');
    if (resultado.error) errores[campo] = resultado.error;
    else ajustes[campo] = resultado.valor;
  };
  porcentaje('descuentoTransferencia');
  porcentaje('descuentoEfectivo');

  const cuotas = entero(campos.cuotasSinInteres, 0, 24, 'Tiene que ser un número entero entre 0 y 24');
  if (cuotas.error) errores.cuotasSinInteres = cuotas.error;
  else if (cuotas.valor === 1) errores.cuotasSinInteres = 'Poné 0 para no mostrar cuotas, o 2 o más';
  else ajustes.cuotasSinInteres = cuotas.valor;

  return { ajustes, errores };
}

// ---------- Formas de entrega ----------

function filaAMetodo(fila) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    costo: fila.costo,
    gratisDesde: fila.gratisDesde,
    aceptaEfectivo: Boolean(fila.aceptaEfectivo),
    activo: Boolean(fila.activo),
  };
}

const SELECCION_METODO = `SELECT id, tipo, nombre, descripcion, costo_centavos AS costo, gratis_desde_centavos AS "gratisDesde",
  acepta_efectivo AS "aceptaEfectivo", activo FROM metodos_entrega`;

export async function listarMetodosEntrega(db, tiendaId, { soloActivos = false } = {}) {
  return (await db
    .prepare(`${SELECCION_METODO} WHERE tienda_id = ?${soloActivos ? ' AND activo = 1' : ''} ORDER BY orden, id`)
    .all(tiendaId))
    .map(filaAMetodo);
}

export async function leerMetodoEntrega(db, tiendaId, id) {
  const fila = await db.prepare(`${SELECCION_METODO} WHERE tienda_id = ? AND id = ?`).get(tiendaId, id);
  return fila ? filaAMetodo(fila) : null;
}

// "Gratis", "$ 4.500,00", "A coordinar"; con "gratis desde" si corresponde.
export function textoCosto(metodo) {
  if (metodo.costo === null) return 'A coordinar';
  return metodo.costo === 0 ? 'Gratis' : formatearPrecio(metodo.costo);
}

// Lo que se muestra en el formulario: de un método guardado, de un modelo o vacío.
export function formularioEntrega(metodo) {
  if (!metodo) return { tipo: 'domicilio', nombre: '', descripcion: '', costo: '', aCoordinar: false, gratisDesde: '', aceptaEfectivo: false, activo: true };
  if (!('id' in metodo)) return { gratisDesde: '', aCoordinar: false, activo: true, ...metodo };
  return {
    tipo: metodo.tipo,
    nombre: metodo.nombre,
    descripcion: metodo.descripcion,
    costo: metodo.costo === null ? '' : precioParaEditar(metodo.costo),
    aCoordinar: metodo.costo === null,
    gratisDesde: metodo.gratisDesde === null ? '' : precioParaEditar(metodo.gratisDesde),
    aceptaEfectivo: metodo.aceptaEfectivo,
    activo: metodo.activo,
  };
}

// Valida el formulario de una forma de entrega. Devuelve { datos, formulario, errores }.
export function validarMetodoEntrega(campos) {
  const errores = {};
  const formulario = {
    tipo: texto(campos.tipo),
    nombre: texto(campos.nombre).replace(/\s+/g, ' '),
    descripcion: texto(campos.descripcion).replace(/\s+/g, ' '),
    costo: texto(campos.costo),
    aCoordinar: marcado(campos.aCoordinar),
    gratisDesde: texto(campos.gratisDesde),
    aceptaEfectivo: marcado(campos.aceptaEfectivo),
    activo: marcado(campos.activo),
  };
  if (!Object.hasOwn(TIPOS_ENTREGA, formulario.tipo)) errores.tipo = 'Elegí si es retiro o envío';
  if (!formulario.nombre) errores.nombre = 'Poné un nombre, por ejemplo "Envío en moto en Córdoba Capital"';
  else if (formulario.nombre.length > 80) errores.nombre = 'Máximo 80 caracteres';
  if (formulario.descripcion.length > 200) errores.descripcion = 'Máximo 200 caracteres';

  const precio = (valor) => {
    try {
      return { valor: parsearPrecio(valor) };
    } catch (error) {
      if (!(error instanceof ErrorDeValor)) throw error;
      return { error: 'Escribí el monto en pesos, por ejemplo 4500 o 4.500' };
    }
  };

  let costo = null;
  if (!formulario.aCoordinar) {
    const resultado = precio(formulario.costo);
    if (resultado.error) errores.costo = resultado.error;
    else if (resultado.valor === null) errores.costo = 'Poné el costo (0 si es gratis) o marcá que se coordina después';
    else costo = resultado.valor;
  }

  let gratisDesde = null;
  if (formulario.gratisDesde) {
    const resultado = precio(formulario.gratisDesde);
    if (resultado.error) errores.gratisDesde = resultado.error;
    else if (resultado.valor === 0) errores.gratisDesde = 'Dejalo vacío si no hay envío gratis';
    else gratisDesde = resultado.valor;
  }
  if (costo === 0 || formulario.aCoordinar) gratisDesde = null;

  return {
    datos: {
      tipo: formulario.tipo,
      nombre: formulario.nombre,
      descripcion: formulario.descripcion,
      costo,
      gratisDesde,
      aceptaEfectivo: formulario.aceptaEfectivo,
      activo: formulario.activo,
    },
    formulario,
    errores,
  };
}

export async function contarMetodosEntrega(db, tiendaId) {
  return (await db.prepare('SELECT count(*) AS n FROM metodos_entrega WHERE tienda_id = ?').get(tiendaId)).n;
}

export async function crearMetodoEntrega(db, tiendaId, datos) {
  const { rows } = await db
    .prepare(
      `INSERT INTO metodos_entrega (tienda_id, tipo, nombre, descripcion, costo_centavos, gratis_desde_centavos, acepta_efectivo, activo, orden)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(orden), 0) + 1 FROM metodos_entrega WHERE tienda_id = ?))
       RETURNING id`,
    )
    .run(tiendaId, datos.tipo, datos.nombre, datos.descripcion, datos.costo, datos.gratisDesde,
      Number(datos.aceptaEfectivo), Number(datos.activo), tiendaId);
  return rows[0].id;
}

export async function editarMetodoEntrega(db, tiendaId, id, datos) {
  return (
    (await db
      .prepare(
        `UPDATE metodos_entrega SET tipo = ?, nombre = ?, descripcion = ?, costo_centavos = ?, gratis_desde_centavos = ?,
         acepta_efectivo = ?, activo = ? WHERE id = ? AND tienda_id = ?`,
      )
      .run(datos.tipo, datos.nombre, datos.descripcion, datos.costo, datos.gratisDesde,
        Number(datos.aceptaEfectivo), Number(datos.activo), id, tiendaId)).changes > 0
  );
}

export async function activarMetodoEntrega(db, tiendaId, id, activo) {
  return (await db.prepare('UPDATE metodos_entrega SET activo = ? WHERE id = ? AND tienda_id = ?').run(Number(activo), id, tiendaId)).changes > 0;
}

export async function borrarMetodoEntrega(db, tiendaId, id) {
  return (await db.prepare('DELETE FROM metodos_entrega WHERE id = ? AND tienda_id = ?').run(id, tiendaId)).changes > 0;
}

// Intercambia la forma de entrega con la anterior (-1) o la siguiente (+1).
export function moverMetodoEntrega(db, tiendaId, id, direccion) {
  return enTransaccion(db, async (tx) => {
    const metodos = await tx.prepare('SELECT id FROM metodos_entrega WHERE tienda_id = ? ORDER BY orden, id').all(tiendaId);
    const i = metodos.findIndex((m) => m.id === id);
    const j = i + direccion;
    if (i === -1 || j < 0 || j >= metodos.length) return;
    [metodos[i], metodos[j]] = [metodos[j], metodos[i]];
    const actualizar = tx.prepare('UPDATE metodos_entrega SET orden = ? WHERE id = ?');
    for (const [n, metodo] of metodos.entries()) await actualizar.run(n + 1, metodo.id);
  });
}

// La tienda vende desde su vidriera si ofrece al menos una forma de entrega y una de pago que se puedan combinar
// (el efectivo solo sirve con entregas que lo aceptan).
export async function estadoCheckout(db, tiendaId, ajustes) {
  const entregas = await listarMetodosEntrega(db, tiendaId, { soloActivos: true });
  const pagos = formasDePagoActivas(ajustes);
  const combinable = entregas.some((entrega) => pagos.some((pago) => pago.clave !== 'efectivo' || entrega.aceptaEfectivo));
  return { entregas, pagos, activo: combinable };
}
