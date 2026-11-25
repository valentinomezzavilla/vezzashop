// Un Mercado Pago y un n8n de mentira para los tests: servidores locales que responden como los de verdad.
import http from 'node:http';

export const TOKEN_MP = 'token-de-prueba';

// ---------- Un Mercado Pago de mentira ----------

export function crearMpFalso() {
  const falso = {
    suscripciones: new Map(),
    cobros: new Map(),
    pedidos: [], // lo que recibió, en orden: { metodo, ruta, cuerpo }
    fallar: false, // true: responde 500 a todo
    rechazarCancelled: false, // true: la baja con "cancelled" da 400 (para probar que se prueba con "canceled")
    rechazarMonto: new Set(), // ids de suscripciones a las que Mercado Pago no les acepta un cambio de monto (400)
    contador: 0,
    servidor: null,
    puerto: 0,
    autorizar(id) {
      falso.suscripciones.get(id).status = 'authorized';
    },
    // Un cobro mensual de la suscripción `id`.
    cobrar(idCobro, id, { monto = 12900, aprobado = true } = {}) {
      falso.cobros.set(idCobro, { id: Number(idCobro), preapproval_id: id, transaction_amount: monto, status: 'processed', payment: { status: aprobado ? 'approved' : 'rejected' } });
    },
  };
  falso.servidor = http.createServer(async (req, res) => {
    let texto = '';
    for await (const parte of req) texto += parte;
    const cuerpo = texto ? JSON.parse(texto) : null;
    falso.pedidos.push({ metodo: req.method, ruta: req.url, cuerpo, autorizacion: req.headers.authorization });
    const responder = (status, datos) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(datos));
    if (req.headers.authorization !== `Bearer ${TOKEN_MP}`) return responder(401, { message: 'unauthorized' });
    if (falso.fallar) return responder(500, { message: 'error' });
    if (req.method === 'POST' && req.url === '/preapproval') {
      const id = `mp${++falso.contador}abc`;
      // Con start_date, el primer cobro es ese día; sin él, uno cualquiera (el de Mercado Pago real sería apenas se autoriza).
      const suscripcion = { ...cuerpo, id, status: 'pending', init_point: `https://www.mercadopago.test/subscriptions/checkout?preapproval_id=${id}`, next_payment_date: cuerpo.auto_recurring?.start_date ?? '2030-01-15T12:00:00.000-03:00' };
      falso.suscripciones.set(id, suscripcion);
      return responder(201, suscripcion);
    }
    const suscripcion = /^\/preapproval\/([^/]+)$/.exec(req.url);
    if (suscripcion && req.method === 'GET') return falso.suscripciones.has(suscripcion[1]) ? responder(200, falso.suscripciones.get(suscripcion[1])) : responder(404, {});
    if (suscripcion && req.method === 'PUT') {
      if (falso.rechazarCancelled && cuerpo.status === 'cancelled') return responder(400, { message: 'invalid status' });
      if (!falso.suscripciones.has(suscripcion[1])) return responder(404, {});
      if (cuerpo.auto_recurring && falso.rechazarMonto.has(suscripcion[1])) return responder(400, { message: 'transaction_amount not allowed' });
      const actual = falso.suscripciones.get(suscripcion[1]);
      const { auto_recurring: recurrente, ...resto } = cuerpo;
      Object.assign(actual, resto);
      // Como Mercado Pago: un cambio de monto no borra el resto de la recurrencia (frecuencia, moneda...).
      if (recurrente) actual.auto_recurring = { ...actual.auto_recurring, ...recurrente };
      return responder(200, actual);
    }
    const cobro = /^\/authorized_payments\/([^/]+)$/.exec(req.url);
    if (cobro && req.method === 'GET') return falso.cobros.has(cobro[1]) ? responder(200, falso.cobros.get(cobro[1])) : responder(404, {});
    responder(404, {});
  });
  return falso;
}

// ---------- Un Mercado Pago de mentira, del lado de una tienda que vende ----------
// Lo que usa cada tienda con SU cuenta: quién es el dueño de un token (/users/me), el canje de códigos de OAuth (/oauth/token), los pagos que arma
// (/checkout/preferences) y los pagos que cobra (/v1/payments). Cada token es de una cuenta: un pago solo lo ve la cuenta que lo cobró.

export function crearMpVendedorFalso({ clienteId = 'cliente-de-prueba', clienteSecreto = 'secreto-de-prueba' } = {}) {
  const falso = {
    usuarios: new Map(), // access token -> { id, nickname, site_id }
    codigos: new Map(), // código de autorización -> { accessToken, refreshToken, userId }
    refrescos: new Map(), // refresh token vigente -> { userId }: cada uno vale una sola vez, como el de Mercado Pago
    preferencias: new Map(), // id -> el cuerpo que mandó la tienda (más `token`: con qué token lo mandó)
    pagos: new Map(), // id -> el pago (con `collector_id`)
    pedidos: [], // todo lo que recibió, en orden: { metodo, ruta, cuerpo, autorizacion }
    fallarPreferencias: false, // true: crear un pago da 500
    contador: 0,
    servidor: null,
    puerto: 0,
    // Registra un token como válido y devuelve el token.
    cuenta(token, { id = 1000 + falso.usuarios.size, nickname = `VENDEDOR${id}`, site = 'MLA' } = {}) {
      falso.usuarios.set(token, { id, nickname, site_id: site });
      return token;
    },
    // Un código de autorización que la tienda puede canjear (el que Mercado Pago le daría al volver a la plataforma).
    codigo(codigo, { token = `APP_USR-oauth-${codigo}`, refresh = `TG-refresh-${codigo}`, id = 2000 + falso.codigos.size, nickname = `OAUTH${id}` } = {}) {
      falso.cuenta(token, { id, nickname });
      falso.codigos.set(codigo, { accessToken: token, refreshToken: refresh, userId: id });
      falso.refrescos.set(refresh, { userId: id });
      return codigo;
    },
    // Un pago de `monto` pesos de la cuenta `cuenta` (el id del vendedor), para el pedido que dice `referencia`. Devuelve su id.
    pagar({ referencia, monto, estado = 'approved', cuenta, neto = Math.round(monto * 0.9239 * 100) / 100, id = 9000 + falso.pagos.size + 1 }) {
      falso.pagos.set(String(id), {
        id,
        status: estado,
        status_detail: estado === 'approved' ? 'accredited' : estado,
        external_reference: referencia,
        transaction_amount: monto,
        currency_id: 'ARS',
        transaction_details: { net_received_amount: estado === 'approved' ? neto : 0 },
        money_release_date: estado === 'approved' ? '2026-11-25T12:00:00.000-03:00' : null,
        collector_id: cuenta,
      });
      return String(id);
    },
    cambiarEstado(id, estado) {
      Object.assign(falso.pagos.get(String(id)), { status: estado });
    },
    ultimaPreferencia: () => [...falso.preferencias.values()].at(-1),
    llamadas: (ruta) => falso.pedidos.filter((p) => p.ruta.startsWith(ruta)),
  };
  falso.servidor = http.createServer(async (req, res) => {
    let texto = '';
    for await (const parte of req) texto += parte;
    const cuerpo = texto ? JSON.parse(texto) : null;
    falso.pedidos.push({ metodo: req.method, ruta: req.url, cuerpo, autorizacion: req.headers.authorization });
    const responder = (status, datos) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(datos));
    const url = new URL(req.url, 'http://falso');

    // El canje de códigos y la renovación se identifican con el client_id y el client_secret, no con un token.
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      if (cuerpo.client_id !== clienteId || cuerpo.client_secret !== clienteSecreto) return responder(401, { message: 'invalid client' });
      const nuevosTokens = (userId, datos) => {
        const accessToken = `APP_USR-renovado-${++falso.contador}`;
        const refreshToken = `TG-refresh-nuevo-${falso.contador}`;
        falso.cuenta(accessToken, { id: userId, nickname: datos.nickname ?? `VENDEDOR${userId}` });
        falso.refrescos.set(refreshToken, { userId });
        return { access_token: accessToken, token_type: 'bearer', expires_in: 15_552_000, scope: 'offline_access read write', user_id: userId, refresh_token: refreshToken };
      };
      if (cuerpo.grant_type === 'authorization_code') {
        const codigo = falso.codigos.get(cuerpo.code);
        if (!codigo || !cuerpo.redirect_uri) return responder(400, { message: 'invalid_grant' });
        falso.codigos.delete(cuerpo.code); // un código vale una vez
        return responder(200, { access_token: codigo.accessToken, token_type: 'bearer', expires_in: 15_552_000, user_id: codigo.userId, refresh_token: codigo.refreshToken });
      }
      if (cuerpo.grant_type === 'refresh_token') {
        const refresco = falso.refrescos.get(cuerpo.refresh_token);
        if (!refresco) return responder(400, { message: 'invalid_grant' });
        falso.refrescos.delete(cuerpo.refresh_token); // y un refresh token, también
        return responder(200, nuevosTokens(refresco.userId, {}));
      }
      return responder(400, { message: 'unsupported_grant_type' });
    }

    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const usuario = token ? falso.usuarios.get(token) : null;
    if (!usuario) return responder(401, { message: 'unauthorized' });

    if (req.method === 'GET' && url.pathname === '/users/me') return responder(200, usuario);
    if (req.method === 'POST' && url.pathname === '/checkout/preferences') {
      if (falso.fallarPreferencias) return responder(500, { message: 'error' });
      const id = `pref-${++falso.contador}`;
      falso.preferencias.set(id, { ...cuerpo, id, token, collector_id: usuario.id });
      return responder(201, { id, init_point: `https://www.mercadopago.test/checkout?pref_id=${id}`, sandbox_init_point: `https://sandbox.mercadopago.test/checkout?pref_id=${id}` });
    }
    if (req.method === 'GET' && url.pathname === '/v1/payments/search') {
      const referencia = url.searchParams.get('external_reference');
      const resultados = [...falso.pagos.values()].filter((p) => p.collector_id === usuario.id && p.external_reference === referencia).reverse();
      return responder(200, { results: resultados });
    }
    const pago = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (pago && req.method === 'GET') {
      const encontrado = falso.pagos.get(pago[1]);
      // Un pago de otra cuenta, para esta, no existe.
      return encontrado && encontrado.collector_id === usuario.id ? responder(200, encontrado) : responder(404, { message: 'Payment not found' });
    }
    responder(404, {});
  });
  return falso;
}

// ---------- Un n8n de mentira ----------

export function crearN8nFalso() {
  const falso = { recibidos: [], fallar: false, servidor: null, puerto: 0 };
  falso.servidor = http.createServer(async (req, res) => {
    let texto = '';
    for await (const parte of req) texto += parte;
    falso.recibidos.push({ cuerpo: JSON.parse(texto), secreto: req.headers['x-webhook-secret'] });
    res.writeHead(falso.fallar ? 500 : 200).end();
  });
  return falso;
}
