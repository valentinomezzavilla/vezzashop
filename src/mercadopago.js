// Cliente de Mercado Pago para cobrar las suscripciones a los planes (la plataforma como vendedora, no las tiendas de los clientes).
// Todo lo que sabe cómo habla Mercado Pago está acá, así si su API cambia se toca un solo archivo.
//  - Suscripciones: POST /preapproval (sin plan asociado, en estado "pending": devuelve un init_point al que se manda al cliente
//    para que cargue su tarjeta), GET /preapproval/{id}, PUT /preapproval/{id} (cancelar y cambiar el monto).
//  - Cobros: GET /authorized_payments/{id}, uno por cada mes que Mercado Pago le cobra al cliente.
//  - Avisos (webhooks): llegan firmados; la firma se valida con verificarFirma y después se consulta la API, porque lo que
//    trae el aviso no se usa para decidir nada.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { hoy } from './util/fechas.js';

const API = 'https://api.mercadopago.com';
const TIEMPO_MAXIMO_MS = 15_000;

export class ErrorDeMercadoPago extends Error {
  constructor(mensaje, { status = null, detalle = null } = {}) {
    super(mensaje);
    this.name = 'ErrorDeMercadoPago';
    this.status = status;
    this.detalle = detalle;
  }
}

// Estados de una suscripción en Mercado Pago -> los nuestros. La baja aparece escrita de las dos maneras en su documentación.
const ESTADOS = { pending: 'pendiente', authorized: 'autorizada', paused: 'pausada', cancelled: 'cancelada', canceled: 'cancelada' };

const centavos = (pesos) => Math.round(Number(pesos) * 100);
const dia = (iso) => (iso ? hoy(new Date(iso)) : null);

// Una función para hablar con la API de Mercado Pago: llamar(metodo, ruta, cuerpo) devuelve los datos de la respuesta o tira ErrorDeMercadoPago.
// Sin accessToken no manda autorización (el canje de códigos de OAuth se identifica con el cuerpo). La usan el cliente de las suscripciones
// (acá abajo) y el de cada tienda (mercadopago-tiendas.js), cada uno con su propio token.
export function crearLlamada({ accessToken, apiUrl = API, tiempoMaximoMs = TIEMPO_MAXIMO_MS }) {
  return async function llamar(metodo, ruta, cuerpo) {
    let respuesta;
    try {
      respuesta = await fetch(`${apiUrl}${ruta}`, {
        method: metodo,
        headers: { ...(accessToken && { authorization: `Bearer ${accessToken}` }), 'content-type': 'application/json', accept: 'application/json' },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(tiempoMaximoMs),
      });
    } catch (error) {
      throw new ErrorDeMercadoPago(`No se pudo conectar con Mercado Pago: ${error.message}`);
    }
    const texto = await respuesta.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      // Una respuesta que no es JSON se trata como error más abajo si no fue un 2xx.
    }
    if (!respuesta.ok) {
      throw new ErrorDeMercadoPago(`Mercado Pago respondió ${respuesta.status}`, { status: respuesta.status, detalle: datos ?? texto.slice(0, 300) });
    }
    return datos;
  };
}

export function crearClienteMp({ accessToken, apiUrl = API }) {
  const llamar = crearLlamada({ accessToken, apiUrl });

  return {
    // Crea la suscripción sin medio de pago: el cliente lo elige en el checkout de Mercado Pago (initPoint).
    // monto en pesos (no centavos). referenciaExterna vuelve en cada consulta: es nuestro id.
    // inicio ('2026-12-25', opcional): el día del primer cobro. Sin él, Mercado Pago cobra apenas el cliente autoriza; con él, el cobro
    // cae ese día y después cada mes (sirve para reactivar una suscripción sin cobrar de más: ver reactivar en suscripciones.js).
    async crearSuscripcion({ monto, motivo, emailPagador, referenciaExterna, urlVuelta, inicio = null }) {
      const datos = await llamar('POST', '/preapproval', {
        reason: motivo,
        external_reference: String(referenciaExterna),
        payer_email: emailPagador,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: monto,
          currency_id: 'ARS',
          ...(inicio && { start_date: `${inicio}T12:00:00.000-03:00` }),
        },
        back_url: urlVuelta,
        status: 'pending',
      });
      if (!datos?.id || !datos?.init_point) throw new ErrorDeMercadoPago('Mercado Pago no devolvió el link de pago', { detalle: datos });
      return { id: String(datos.id), initPoint: datos.init_point };
    },

    // { id, estado ('pendiente' | 'autorizada' | 'pausada' | 'cancelada'), referenciaExterna, proximoCobro ('2026-12-31' o null),
    //   montoCentavos (lo que cobra por mes, o null si no lo informa), initPoint (el link de pago, mientras siga pendiente) }
    async leerSuscripcion(id) {
      const datos = await llamar('GET', `/preapproval/${encodeURIComponent(id)}`);
      return {
        id: String(datos.id),
        estado: ESTADOS[datos.status] ?? null,
        referenciaExterna: datos.external_reference ?? null,
        proximoCobro: dia(datos.next_payment_date),
        montoCentavos: datos.auto_recurring?.transaction_amount == null ? null : centavos(datos.auto_recurring.transaction_amount),
        initPoint: datos.init_point ?? null,
      };
    },

    // Cambia lo que se cobra por mes (para los aumentos de precio de un plan). monto en pesos. Se aplica desde el próximo cobro.
    // Si Mercado Pago contesta con otro monto, no lo aplicó: se avisa en vez de dar el cambio por hecho.
    async actualizarMonto(id, monto) {
      const datos = await llamar('PUT', `/preapproval/${encodeURIComponent(id)}`, { auto_recurring: { transaction_amount: monto, currency_id: 'ARS' } });
      const devuelto = datos?.auto_recurring?.transaction_amount;
      if (devuelto != null && centavos(devuelto) !== centavos(monto)) {
        throw new ErrorDeMercadoPago('Mercado Pago no aplicó el monto nuevo', { detalle: datos });
      }
      return { montoCentavos: centavos(monto) };
    },

    // { id, suscripcionId (el id de Mercado Pago), aprobado, montoCentavos }
    async leerCobro(id) {
      const datos = await llamar('GET', `/authorized_payments/${encodeURIComponent(id)}`);
      return {
        id: String(datos.id),
        suscripcionId: datos.preapproval_id == null ? null : String(datos.preapproval_id),
        aprobado: datos.payment ? datos.payment.status === 'approved' : datos.status === 'processed',
        montoCentavos: centavos(datos.transaction_amount ?? 0),
      };
    },

    // Da de baja la suscripción: no se cobran más meses. Si Mercado Pago no acepta la forma de escribirlo, prueba la otra.
    async cancelarSuscripcion(id) {
      try {
        await llamar('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'cancelled' });
      } catch (error) {
        if (error.status !== 400) throw error;
        await llamar('PUT', `/preapproval/${encodeURIComponent(id)}`, { status: 'canceled' });
      }
    },
  };
}

// Valida el header x-signature ("ts=...,v1=...") de un aviso: HMAC-SHA256, con la clave secreta del webhook, del texto
// "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" (lo que falte se omite). No se exige que ts sea reciente: Mercado Pago
// reintenta los avisos que no se contestan, y repetir uno no cambia nada (el aviso solo dice "andá a mirar", y lo procesado es idempotente).
export function verificarFirma({ xSignature, xRequestId, dataId, secreto }) {
  if (!secreto || !xSignature) return false;
  const partes = new Map(
    String(xSignature)
      .split(',')
      .map((parte) => {
        const i = parte.indexOf('=');
        return i === -1 ? [parte.trim(), ''] : [parte.slice(0, i).trim(), parte.slice(i + 1).trim()];
      }),
  );
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1) return false;
  // Mercado Pago pasa a minúsculas los ids alfanuméricos antes de firmar.
  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifiesto = `${id ? `id:${id};` : ''}${xRequestId ? `request-id:${xRequestId};` : ''}ts:${ts};`;
  const esperado = Buffer.from(createHmac('sha256', secreto).update(manifiesto).digest('hex'));
  const recibido = Buffer.from(v1);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
