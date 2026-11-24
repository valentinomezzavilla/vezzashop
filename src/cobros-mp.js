// El cobro de los pedidos con Mercado Pago, de punta a punta:
//  1. iniciarCobro: al confirmar el pedido se le arma el pago al comprador (con el token de la tienda) y se lo manda a Mercado Pago en el acto.
//  2. sincronizarPedido / avisoDePago: cuando Mercado Pago avisa (webhook) o el comprador vuelve, se CONSULTA el pago a Mercado Pago, y recién
//     ahí, si está aprobado, es del pedido y por el monto exacto, el pedido pasa a Pagado. Lo que trae un aviso o una URL nunca decide nada.
// Todo es idempotente: Mercado Pago repite los avisos y el comprador puede volver varias veces.
import { enTransaccion } from './db.js';
import { leerAjustes } from './diseno.js';
import { avisoDePedido, marcarEventoAvisado, registrarEvento } from './envios.js';
import { crearClienteMpTienda } from './mercadopago-tiendas.js';
import { cambiarEstado, leerPedido } from './pedidos.js';
import { configMp, tokenVigente } from './tienda-mercadopago.js';

const UN_DIA_MS = 24 * 60 * 60 * 1000;
// El pago que se le arma al comprador vale 3 días. Un link armado hace menos de 2 días se reutiliza; si no, se arma uno nuevo.
const VIGENCIA_COBRO_MS = 3 * UN_DIA_MS;
const REUTILIZAR_HASTA_MS = 2 * UN_DIA_MS;
// Para el comprador que está esperando en la página de su pedido, no vale la pena esperar más que esto a Mercado Pago.
const ESPERA_AL_VOLVER_MS = 8000;

// Cómo se llama el estado de un pago de Mercado Pago, para mostrárselo a la tienda.
const TITULOS_PAGO_MP = {
  approved: 'Aprobado',
  pending: 'Pendiente de acreditación',
  in_process: 'En revisión',
  authorized: 'Autorizado',
  in_mediation: 'En disputa',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
  refunded: 'Devuelto',
  charged_back: 'Contracargo',
};
export const tituloPagoMp = (estado) => TITULOS_PAGO_MP[estado] ?? (estado || 'Todavía sin pago');

// Lo que une un pago de Mercado Pago con un pedido: viaja en el pago como "external_reference".
export const referenciaDePedido = (tiendaId, pedidoId) => `vezza-${tiendaId}-${pedidoId}`;
export function leerReferencia(texto) {
  const partes = /^vezza-(\d{1,9})-(\d{1,9})$/.exec(String(texto ?? ''));
  return partes ? { tiendaId: Number(partes[1]), pedidoId: Number(partes[2]) } : null;
}

const secretoDe = (config) => config.secretoSesion;

// Los renglones del pago: cada producto y el envío. Si por algún motivo no suman el total del pedido (un descuento, que no se puede mandar
// como renglón), va un solo renglón por el total: el monto cobrado siempre es el del pedido.
export function itemsDelCobro(pedido) {
  const items = pedido.items.map((i) => ({ titulo: i.detalle ? `${i.nombre} (${i.detalle})` : i.nombre, cantidad: i.cantidad, precioCentavos: i.precio }));
  if (pedido.envio > 0) items.push({ titulo: `Envío: ${pedido.entrega.nombre}`, cantidad: 1, precioCentavos: pedido.envio });
  const suma = items.reduce((total, i) => total + i.cantidad * i.precioCentavos, 0);
  return suma === pedido.total ? items : [{ titulo: `Pedido #${pedido.numero}`, cantidad: 1, precioCentavos: pedido.total }];
}

const esLinkDePago = (url) => typeof url === 'string' && url.startsWith('https://');

// El link de pago de Mercado Pago de un pedido, para mandar al comprador: { initPoint }. null si no se puede (el pedido no es de Mercado Pago o ya no
// está esperando el pago, la tienda no tiene la cuenta conectada, el envío todavía no tiene costo, o Mercado Pago falló): quien llama sigue con
// el cobro manual, así un problema con Mercado Pago nunca se lleva puesto un pedido. `pedido` viene de leerPedido (con su `mp`).
export async function iniciarCobro({ db, config, tienda, pedido, urlPedido, urlAviso }) {
  if (pedido.pago !== 'mercadopago' || pedido.estado !== 'nuevo' || pedido.envio === null) return null;
  const token = await tokenVigente(db, tienda.id, { config, secreto: secretoDe(config) });
  if (!token) return null;

  const { initPoint, preferenciaCreadaEn } = pedido.mp;
  if (esLinkDePago(initPoint) && preferenciaCreadaEn && Date.now() - Date.parse(preferenciaCreadaEn) < REUTILIZAR_HASTA_MS) return { initPoint };

  try {
    const preferencia = await crearClienteMpTienda({ accessToken: token, apiUrl: configMp(config).apiUrl }).crearPreferencia({
      items: itemsDelCobro(pedido),
      emailPagador: pedido.cliente.email,
      referenciaExterna: referenciaDePedido(tienda.id, pedido.id),
      urlsVuelta: { ok: `${urlPedido}?mp=ok`, pendiente: `${urlPedido}?mp=pendiente`, error: `${urlPedido}?mp=error` },
      urlAviso,
      vence: new Date(Date.now() + VIGENCIA_COBRO_MS).toISOString(),
    });
    if (!esLinkDePago(preferencia.initPoint)) throw new Error('Mercado Pago devolvió un link de pago que no es https');
    await db
      .prepare('UPDATE pedidos SET mp_preferencia_id = ?, mp_init_point = ?, mp_preferencia_creada_en = ? WHERE tienda_id = ? AND id = ?')
      .run(preferencia.id, preferencia.initPoint, new Date().toISOString(), tienda.id, pedido.id);
    return { initPoint: preferencia.initPoint };
  } catch (error) {
    console.error(`Mercado Pago: no se pudo armar el cobro del pedido ${pedido.id} (tienda ${tienda.id}):`, error.status ?? '', error.message, JSON.stringify(error.detalle ?? '').slice(0, 300));
    return null;
  }
}

// Deja una nota interna (que no ve el comprador) una sola vez: Mercado Pago repite los avisos, y no queremos diez notas iguales.
async function notaUnaVez(db, pedidoId, { titulo, detalle }) {
  const ya = await db.prepare('SELECT 1 AS ya FROM pedido_eventos WHERE pedido_id = ? AND titulo = ? AND detalle = ?').get(pedidoId, titulo, detalle);
  if (!ya) await registrarEvento(db, pedidoId, { paso: 'pagado', titulo, detalle, visible: false });
}

// Guarda lo que Mercado Pago informa de un pago y, si está aprobado, pasa el pedido a Pagado. `pago` es lo que devuelve leerPago (y ya se comprobó
// que es de este pedido y por su monto). Devuelve { pagadoAhora, cambio }: cambio es el movimiento que dejó pasar a Pagado (null si no cambió nada).
export async function aplicarPago(db, tiendaId, pedidoId, pago) {
  const anterior = await enTransaccion(db, async (tx) => {
    // El pedido queda bloqueado: dos avisos del mismo pago a la vez se procesan uno después del otro.
    const fila = await tx
      .prepare('SELECT estado, mp_pago_id AS "pagoId", mp_pago_estado AS "pagoEstado" FROM pedidos WHERE tienda_id = ? AND id = ? FOR UPDATE')
      .get(tiendaId, pedidoId);
    if (!fila) return null;
    // Un pago ya aprobado (o devuelto) no se pisa con otro pago distinto; sí se actualiza con las novedades de sí mismo.
    const cerrado = ['approved', 'refunded', 'charged_back'].includes(fila.pagoEstado);
    if (!fila.pagoId || fila.pagoId === pago.id || !cerrado) {
      await tx
        .prepare(
          `UPDATE pedidos SET mp_pago_id = ?, mp_pago_estado = ?, mp_comision_centavos = ?, mp_neto_centavos = ?, mp_acreditacion = ?
           WHERE tienda_id = ? AND id = ?`,
        )
        .run(pago.id, pago.estado, pago.comisionCentavos, pago.netoCentavos, pago.acreditacion, tiendaId, pedidoId);
    }
    return fila;
  });
  if (!anterior) return { pagadoAhora: false, cambio: null };

  const detalle = `Pago #${pago.id} de Mercado Pago.`;
  if (pago.estado === 'approved') {
    if (anterior.estado === 'nuevo') {
      const resultado = await cambiarEstado(db, tiendaId, pedidoId, 'pagado');
      if (resultado?.cambio) {
        await db.prepare('UPDATE pedido_eventos SET detalle = ? WHERE id = ?').run('Pagó con Mercado Pago.', resultado.cambio.id);
        return { pagadoAhora: true, cambio: resultado.cambio };
      }
    } else if (anterior.estado === 'cancelado') {
      await notaUnaVez(db, pedidoId, { titulo: 'Llegó un pago de Mercado Pago a un pedido cancelado', detalle: `${detalle} Reembolsalo desde tu cuenta de Mercado Pago.` });
    } else if (anterior.pagoId && anterior.pagoId !== pago.id && anterior.pagoEstado === 'approved') {
      await notaUnaVez(db, pedidoId, { titulo: 'Mercado Pago informa otro pago para este pedido', detalle: `${detalle} El pedido ya estaba pago: revisalo por si hay que reembolsar.` });
    }
  } else if (['refunded', 'charged_back'].includes(pago.estado) && anterior.pagoId === pago.id) {
    const titulo = pago.estado === 'refunded' ? 'Mercado Pago informa que el pago se devolvió' : 'Mercado Pago informa un contracargo';
    await notaUnaVez(db, pedidoId, { titulo, detalle: `${detalle} Revisalo en tu cuenta de Mercado Pago.` });
  }
  return { pagadoAhora: false, cambio: null };
}

// Cuando un pedido pasó a Pagado por Mercado Pago, se le avisa al comprador por mail si la tienda tiene activados los avisos (igual que con
// cualquier otro cambio de estado). Devuelve true si salió el mail.
async function avisarPago({ db, notificar, tienda, pedido, urlBaseTienda, cambio }) {
  const ajustes = await leerAjustes(db, tienda.id);
  if (!ajustes.avisosPedidoEmail) return false;
  const actualizado = await leerPedido(db, tienda.id, pedido.id);
  if (!actualizado?.cliente.email) return false;
  const enviado = await notificar(
    'pedido_actualizado',
    avisoDePedido(actualizado, {
      tienda: tienda.nombre,
      urlTienda: urlBaseTienda,
      emailTienda: ajustes.emailContacto,
      whatsappTienda: ajustes.whatsapp ? `https://wa.me/${ajustes.whatsapp}` : '',
      urlPedido: `${urlBaseTienda}/pedido/${pedido.token}`,
      direccionTienda: ajustes.direccion,
    }),
  );
  if (enviado && cambio) await marcarEventoAvisado(db, cambio.id);
  return Boolean(enviado);
}

// De los pagos que Mercado Pago informa para un pedido, aplica los que de verdad son de ese pedido y por su monto exacto.
async function aplicarPagos({ db, notificar, tienda, pedido, pagos, urlBaseTienda }) {
  const propios = pagos.filter((pago) => pago.referenciaExterna === referenciaDePedido(tienda.id, pedido.id) && pago.montoCentavos === pedido.total);
  if (propios.length < pagos.length) {
    console.warn(`Mercado Pago: ${pagos.length - propios.length} pago(s) no coinciden con el pedido ${pedido.id} de la tienda ${tienda.id} (otra referencia u otro monto): se ignoran`);
  }
  if (propios.length === 0) return { estadoPago: null, pagadoAhora: false, mailEnviado: false };
  // Los aprobados primero (del más viejo al más nuevo: el primero es el que paga el pedido); si no hay, el más reciente.
  const aprobados = propios.filter((pago) => pago.estado === 'approved').reverse();
  let pagadoAhora = false;
  let mailEnviado = false;
  for (const pago of aprobados.length ? aprobados : [propios[0]]) {
    const resultado = await aplicarPago(db, tienda.id, pedido.id, pago);
    if (resultado.pagadoAhora) {
      pagadoAhora = true;
      mailEnviado = await avisarPago({ db, notificar, tienda, pedido, urlBaseTienda, cambio: resultado.cambio });
    }
  }
  return { estadoPago: (aprobados[0] ?? propios[0]).estado, pagadoAhora, mailEnviado };
}

// Comprueba con Mercado Pago cómo está el pago de un pedido (por el número de pago si se lo conoce, y si no, buscándolo por la referencia).
// Lo usan la vuelta del comprador y el botón "Verificar pago" del panel. Devuelve { estadoPago, pagadoAhora, mailEnviado } o { sinConexion: true }.
export async function sincronizarPedido({ db, config, notificar = async () => false, tienda, pedido, urlBaseTienda, pagoId = null, esperaMs = ESPERA_AL_VOLVER_MS }) {
  const token = await tokenVigente(db, tienda.id, { config, secreto: secretoDe(config) });
  if (!token) return { sinConexion: true };
  const cliente = crearClienteMpTienda({ accessToken: token, apiUrl: configMp(config).apiUrl, tiempoMaximoMs: esperaMs });
  let pagos;
  try {
    pagos = pagoId ? [await cliente.leerPago(pagoId)] : await cliente.buscarPagosPorReferencia(referenciaDePedido(tienda.id, pedido.id));
  } catch (error) {
    // Un pago que no existe, o que es de otra cuenta, no es un error nuestro.
    if (error.status !== 404) throw error;
    pagos = [];
  }
  return aplicarPagos({ db, notificar, tienda, pedido, pagos, urlBaseTienda });
}

// Un aviso de Mercado Pago ("hubo novedades del pago N"): se le pregunta a Mercado Pago por el pago con el token de la tienda, y de ahí sale a
// qué pedido corresponde. Devuelve false si no hay nada que hacer (la tienda no tiene la cuenta conectada, el pago no es de ella o de un pedido
// suyo con Mercado Pago, o no coincide el monto); el aviso se da por atendido de todos modos.
export async function avisoDePago({ db, config, notificar = async () => false, tienda, pagoId, urlBaseTienda }) {
  const token = await tokenVigente(db, tienda.id, { config, secreto: secretoDe(config) });
  if (!token) return false;
  let pago;
  try {
    pago = await crearClienteMpTienda({ accessToken: token, apiUrl: configMp(config).apiUrl }).leerPago(pagoId);
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
  const referencia = leerReferencia(pago.referenciaExterna);
  if (!referencia || referencia.tiendaId !== tienda.id) return false;
  const pedido = await leerPedido(db, tienda.id, referencia.pedidoId);
  if (!pedido || pedido.pago !== 'mercadopago') return false;
  await aplicarPagos({ db, notificar, tienda, pedido, pagos: [pago], urlBaseTienda });
  return true;
}
