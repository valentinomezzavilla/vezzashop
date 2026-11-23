// Avisos (webhooks) que manda Mercado Pago cuando cambia una suscripción o se cobra un mes.
// Dos reglas: el aviso tiene que venir firmado, y su contenido no se usa para nada más que saber qué mirar: el estado real se
// consulta a la API de Mercado Pago. Así, nadie puede activar una cuenta mandando un POST armado a mano.
import express from 'express';
import { verificarFirma } from '../mercadopago.js';
import { procesarCobro, sincronizarSuscripcion } from '../suscripciones.js';
import { urlPanel } from '../util/dominios.js';

export function rutasWebhooks({ servicios, config }) {
  const router = express.Router();

  router.post('/mercadopago', express.json({ limit: '100kb' }), async (req, res) => {
    if (!servicios) return res.status(404).end(); // los pagos están apagados
    const dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
    const firmado = verificarFirma({
      xSignature: req.get('x-signature'),
      xRequestId: req.get('x-request-id'),
      dataId,
      secreto: config.mercadopago.webhookSecret,
    });
    if (!firmado) return res.status(401).end();

    const tema = String(req.body?.type ?? req.query.type ?? req.query.topic ?? '');
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
