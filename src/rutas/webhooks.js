// Avisos (webhooks) que manda Mercado Pago: cuando cambia una suscripción a un plan o se cobra un mes (/mercadopago), y cuando se paga un pedido
// de una tienda (/mercadopago/tienda/:id). Y la entrega de las maquetas web que arma n8n (/maquetas/:id).
// Dos reglas: el contenido del aviso no se usa para nada más que saber qué mirar (el estado real se consulta a la API de Mercado Pago), y
// el de las suscripciones además tiene que venir firmado. Así, nadie puede activar una cuenta ni dar por pago un pedido con un POST armado a mano.
import express from 'express';
import { verificarFirma } from '../mercadopago.js';
import { procesarCobro, sincronizarSuscripcion } from '../suscripciones.js';
import { avisoDePago } from '../cobros-mp.js';
import { entregarMaqueta } from '../maquetas.js';
import { buscarTienda } from '../tiendas.js';
import { urlPanel, urlPublicaDeTienda } from '../util/dominios.js';
import { crearLimite } from '../util/limite.js';

// db y notificar son para los avisos de pago de las tiendas; servicios, para los de las suscripciones a los planes.
export function rutasWebhooks({ servicios, config, db = null, notificar = async () => false }) {
  const router = express.Router();
  // Cada aviso de pago de una tienda cuesta una consulta a Mercado Pago: un tope por IP frena a quien mande avisos armados a mano.
  const limiteAvisosTiendas = crearLimite({ maximo: 300, ventanaMs: 60_000 });

  // Avisos de pago de las ventas de una tienda (cobra con SU cuenta de Mercado Pago, ver cobros-mp.js). No llevan la firma de la plataforma:
  // el aviso solo dice "mirá el pago N", y el pago se consulta a Mercado Pago con el token de la tienda. Un aviso falso no logra nada.
  router.post('/mercadopago/tienda/:tiendaId', express.json({ limit: '100kb' }), async (req, res) => {
    if (!db || !/^\d{1,9}$/.test(req.params.tiendaId)) return res.status(404).end();
    if (!limiteAvisosTiendas.puede(req.ip)) return res.status(429).end();
    limiteAvisosTiendas.registrar(req.ip);
    // Mercado Pago manda el tema y el número en el cuerpo, en la URL, o con el formato viejo (topic e id).
    const tema = String(req.body?.type ?? req.query.type ?? req.query.topic ?? '');
    const pagoId = String(req.query['data.id'] ?? req.body?.data?.id ?? req.query.id ?? '');
    // Los demás temas (pedidos comerciales, contracargos...) no hacen falta: del pago ya se sabe todo.
    if (tema !== 'payment' || !/^\d{1,20}$/.test(pagoId)) return res.status(200).end();
    try {
      const tienda = await buscarTienda(db, Number(req.params.tiendaId));
      if (tienda) await avisoDePago({ db, config, notificar, tienda, pagoId, urlBaseTienda: urlPublicaDeTienda(req, config, tienda) });
    } catch (error) {
      // 500: Mercado Pago vuelve a mandar el aviso y se reintenta.
      console.error(`Aviso de pago de Mercado Pago (tienda ${req.params.tiendaId}, pago ${pagoId}):`, error);
      return res.status(500).end();
    }
    res.status(200).end();
  });

  // Entrega de las maquetas web (función del plan): el flujo de n8n que las genera manda acá el resultado de un pedido, con el token que
  // recibió en el aviso (ver maquetas.js). El token es de ese pedido solo: no hay una clave general que sirva para entregar cualquier maqueta.
  // Cuerpo: { token, estado: 'generando' | 'lista' | 'error', html?, resumen?, error? }. Responde JSON.
  const limiteEntregas = crearLimite({ maximo: 120, ventanaMs: 60_000 });
  router.post('/maquetas/:id', express.json({ limit: '1mb' }), async (req, res) => {
    if (!db || !/^\d{1,9}$/.test(req.params.id)) return res.status(404).json({ error: 'No existe' });
    if (!limiteEntregas.puede(req.ip)) return res.status(429).json({ error: 'Demasiados intentos' });
    limiteEntregas.registrar(req.ip);
    const { status, ...cuerpo } = await entregarMaqueta(db, Number(req.params.id), req.body && typeof req.body === 'object' ? req.body : {});
    res.status(status).json(cuerpo);
  });
  // Un JSON mal armado o demasiado grande es un error de quien lo mandó, no del servidor.
  router.use('/maquetas', (error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'El cuerpo es demasiado grande' });
    if (error.type === 'entity.parse.failed' || error.status === 400) return res.status(400).json({ error: 'El cuerpo tiene que ser un JSON válido' });
    next(error);
  });

  router.post('/mercadopago', express.json({ limit: '100kb' }), async (req, res) => {
    if (!servicios) return res.status(404).end(); // los pagos están apagados
    const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
    const firmado = verificarFirma({
      xSignature: req.get('x-signature'),
      xRequestId: req.get('x-request-id'),
      dataId,
      secreto: config.mercadopago.webhookSecret,
    });
    const tema = String(req.body?.type ?? req.query.type ?? req.query.topic ?? '');
    if (!firmado) {
      // Para que en el log se vea por qué (sin mostrar ningún secreto): qué llegó y de qué largo es la clave configurada.
      // Si el largo no coincide con el de la clave secreta del panel de Mercado Pago, la variable está mal cargada.
      console.warn(
        `Webhook de Mercado Pago rechazado (401): tema=${tema || '?'} data.id=${dataId || '-'} ` +
          `x-signature=${req.get('x-signature') ? 'sí' : 'NO'} x-request-id=${req.get('x-request-id') ? 'sí' : 'NO'} ` +
          `MP_WEBHOOK_SECRET=${config.mercadopago.webhookSecret.length} caracteres`,
      );
      return res.status(401).end();
    }

    const opciones = { urlBase: urlPanel(req, config.dominio) };
    try {
      if (tema === 'subscription_preapproval' && dataId) await sincronizarSuscripcion(servicios, dataId, opciones);
      else if (tema === 'subscription_authorized_payment' && dataId) await procesarCobro(servicios, dataId, opciones);
      // Cualquier otro tema (payment, planes...) no hace falta: los cobros de las suscripciones llegan por su propio aviso.
    } catch (error) {
      // 500: Mercado Pago vuelve a mandar el aviso (cada 15 minutos) y se reintenta.
      console.error(`Webhook de Mercado Pago (${tema} ${dataId}):`, error);
      return res.status(500).end();
    }
    res.status(200).end();
  });

  return router;
}
