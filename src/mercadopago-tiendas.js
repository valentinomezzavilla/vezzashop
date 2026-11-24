// Mercado Pago para las ventas de cada tienda: la tienda conecta SU cuenta y el comprador le paga a ella (no a la plataforma).
// Es otro cliente que el de mercadopago.js (las suscripciones a los planes cobran con el token de la plataforma): acá cada llamada va con el
// token de la tienda. Como allá, todo lo que sabe cómo habla Mercado Pago está en este archivo.
//  - OAuth: la tienda autoriza a la plataforma desde Mercado Pago (urlDeAutorizacion) y se canjea el código por sus tokens (canjearCodigo);
//    el token vence a los 180 días y se renueva con el refresh token (renovar).
//  - Cobro: POST /checkout/preferences arma el pago de un pedido (devuelve el link al que se manda al comprador) y GET /v1/payments/{id}
//    dice si se pagó. Lo que trae un aviso (webhook) no se usa para decidir nada: siempre se consulta el pago con el token de la tienda.
import { crearLlamada, ErrorDeMercadoPago } from './mercadopago.js';
import { hoy } from './util/fechas.js';

export const API = 'https://api.mercadopago.com';
export const AUTORIZACION = 'https://auth.mercadopago.com.ar';

const centavos = (pesos) => Math.round(Number(pesos) * 100);
const texto = (valor) => (valor === null || valor === undefined ? '' : String(valor));

// A dónde se manda a la tienda para que autorice la conexión. `estado` es el valor que se compara al volver (protege contra links armados por otro).
export function urlDeAutorizacion({ authUrl = AUTORIZACION, clientId, urlVuelta, estado }) {
  const url = new URL('/authorization', authUrl);
  url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', platform_id: 'mp', state: estado, redirect_uri: urlVuelta }).toString();
  return url.toString();
}

function normalizarTokens(datos) {
  if (!datos?.access_token) throw new ErrorDeMercadoPago('Mercado Pago no devolvió el token de la tienda', { detalle: datos });
  const segundos = Number(datos.expires_in);
  return {
    accessToken: String(datos.access_token),
    refreshToken: texto(datos.refresh_token),
    // Cuándo vence, para renovarlo antes (null si Mercado Pago no lo informa).
    expiraEn: Number.isFinite(segundos) && segundos > 0 ? new Date(Date.now() + segundos * 1000).toISOString() : null,
    userId: texto(datos.user_id),
  };
}

// El canje de códigos y la renovación de tokens se identifican con el client_id y el client_secret de la aplicación de la plataforma (no con un token).
export function crearOAuth({ clientId, clientSecret, apiUrl = API }) {
  const llamar = crearLlamada({ accessToken: null, apiUrl });
  return {
    // { accessToken, refreshToken, expiraEn, userId }
    async canjearCodigo({ codigo, urlVuelta }) {
      return normalizarTokens(
        await llamar('POST', '/oauth/token', { client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: codigo, redirect_uri: urlVuelta }),
      );
    },
    // Devuelve tokens nuevos; el refresh token que viene en la respuesta es el que vale de ahí en adelante.
    async renovar(refreshToken) {
      return normalizarTokens(
        await llamar('POST', '/oauth/token', { client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
      );
    },
  };
}

// Un pago de Mercado Pago, con lo que usamos: { id, estado ('approved', 'pending', 'rejected', 'refunded'...), referenciaExterna, montoCentavos,
// netoCentavos (lo que le llega a la tienda), comisionCentavos (lo que Mercado Pago se queda: solo en pagos aprobados), acreditacion ('2026-12-01' o '') }.
function normalizarPago(datos) {
  const monto = datos.transaction_amount == null ? null : centavos(datos.transaction_amount);
  const neto = datos.transaction_details?.net_received_amount == null ? null : centavos(datos.transaction_details.net_received_amount);
  const aprobado = datos.status === 'approved';
  return {
    id: String(datos.id),
    estado: texto(datos.status),
    detalleEstado: texto(datos.status_detail),
    referenciaExterna: datos.external_reference == null ? null : String(datos.external_reference),
    montoCentavos: monto,
    netoCentavos: aprobado ? neto : null,
    comisionCentavos: aprobado && monto !== null && neto !== null ? monto - neto : null,
    acreditacion: aprobado && datos.money_release_date ? hoy(new Date(datos.money_release_date)) : '',
  };
}

export function crearClienteMpTienda({ accessToken, apiUrl = API, tiempoMaximoMs }) {
  const llamar = crearLlamada({ accessToken, apiUrl, ...(tiempoMaximoMs && { tiempoMaximoMs }) });
  return {
    // Quién es el dueño del token: { id, apodo, sitio ('MLA' = Argentina) }. Sirve para comprobar que el token anda y mostrar la cuenta en el panel.
    async usuarioActual() {
      const datos = await llamar('GET', '/users/me');
      if (!datos?.id) throw new ErrorDeMercadoPago('Mercado Pago no devolvió los datos de la cuenta', { detalle: datos });
      return { id: String(datos.id), apodo: texto(datos.nickname), sitio: texto(datos.site_id) };
    },

    // Arma el pago de un pedido. items: [{ titulo, cantidad, precioCentavos }]. referenciaExterna vuelve en el pago: es lo que lo une al pedido.
    // urlsVuelta: { ok, pendiente, error } a donde Mercado Pago devuelve al comprador. urlAviso: a dónde avisa cada novedad del pago.
    // vence (ISO): hasta cuándo se puede pagar. Devuelve { id, initPoint }: initPoint es el link de pago al que se manda al comprador.
    async crearPreferencia({ items, emailPagador = '', referenciaExterna, urlsVuelta, urlAviso = '', vence }) {
      const publica = (url) => typeof url === 'string' && url.startsWith('https://');
      const datos = await llamar('POST', '/checkout/preferences', {
        items: items.map((i) => ({ title: String(i.titulo).slice(0, 250), quantity: i.cantidad, unit_price: i.precioCentavos / 100, currency_id: 'ARS' })),
        ...(emailPagador && { payer: { email: emailPagador } }),
        external_reference: referenciaExterna,
        back_urls: { success: urlsVuelta.ok, pending: urlsVuelta.pendiente, failure: urlsVuelta.error },
        // Mercado Pago solo acepta volver solo y avisar a direcciones públicas: en tu compu (http) se omiten.
        ...(publica(urlsVuelta.ok) && { auto_return: 'approved' }),
        ...(publica(urlAviso) && { notification_url: urlAviso }),
        ...(vence && { expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: vence }),
      });
      if (!datos?.id || !datos?.init_point) throw new ErrorDeMercadoPago('Mercado Pago no devolvió el link de pago', { detalle: datos });
      return { id: String(datos.id), initPoint: datos.init_point };
    },

    async leerPago(id) {
      return normalizarPago(await llamar('GET', `/v1/payments/${encodeURIComponent(id)}`));
    },

    // Los pagos de un pedido, del más nuevo al más viejo (por si volvió el comprador sin el número de pago).
    async buscarPagosPorReferencia(referencia) {
      const parametros = new URLSearchParams({ external_reference: referencia, sort: 'date_created', criteria: 'desc', limit: '10' });
      const datos = await llamar('GET', `/v1/payments/search?${parametros}`);
      return (datos?.results ?? []).map(normalizarPago);
    },
  };
}
