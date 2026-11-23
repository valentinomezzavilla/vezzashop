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
      const suscripcion = { ...cuerpo, id, status: 'pending', init_point: `https://www.mercadopago.test/subscriptions/checkout?preapproval_id=${id}`, next_payment_date: '2030-01-15T12:00:00.000-03:00' };
      falso.suscripciones.set(id, suscripcion);
      return responder(201, suscripcion);
    }
    const suscripcion = /^\/preapproval\/([^/]+)$/.exec(req.url);
    if (suscripcion && req.method === 'GET') return falso.suscripciones.has(suscripcion[1]) ? responder(200, falso.suscripciones.get(suscripcion[1])) : responder(404, {});
    if (suscripcion && req.method === 'PUT') {
      if (falso.rechazarCancelled && cuerpo.status === 'cancelled') return responder(400, { message: 'invalid status' });
      Object.assign(falso.suscripciones.get(suscripcion[1]), cuerpo);
      return responder(200, falso.suscripciones.get(suscripcion[1]));
    }
    const cobro = /^\/authorized_payments\/([^/]+)$/.exec(req.url);
    if (cobro && req.method === 'GET') return falso.cobros.has(cobro[1]) ? responder(200, falso.cobros.get(cobro[1])) : responder(404, {});
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
