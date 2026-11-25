// Panel: la suscripción de la tienda a su plan (Mercado Pago). Se monta después del login.
//  GET  /suscripcion           estado, planes para contratar o cambiar, y los pagos
//  POST /suscripcion/iniciar   contrata un plan (o cambia de plan): lleva a pagar a Mercado Pago
//  GET  /suscripcion/pagar     retoma un pago que quedó a medias
//  GET  /suscripcion/volver    a donde vuelve el cliente de Mercado Pago: confirma el pago
//  POST /suscripcion/cancelar  da de baja el débito automático (la tienda sigue abierta hasta el vencimiento ya pago)
import express from 'express';
import { verificarCsrf } from '../csrf.js';
import { armarPlanes } from '../landing.js';
import { esAutoservicio, listarPagos, listarPlanes } from '../plataforma.js';
import { limitesDeTienda } from '../limites.js';
import { buscarTienda } from '../tiendas.js';
import { cancelarSuscripcionDeTienda, estadoDeSuscripcion, iniciarSuscripcion, retomarPago, sincronizarSuscripcion } from '../suscripciones.js';
import { urlPanel } from '../util/dominios.js';
import { formatearFecha } from '../util/formato.js';
import { formatearDiaLargo, hoy } from '../util/fechas.js';

// El aviso de una baja (la de un cliente en su panel y la que hace el administrador): hasta cuándo sigue activa la tienda y que se puede reactivar.
export function textoDeBaja(venceEn, dia = hoy()) {
  const vigente = Boolean(venceEn) && venceEn >= dia;
  return vigente
    ? `Cancelaste la suscripción: no se te cobran más meses. Tu tienda sigue activa hasta el ${formatearDiaLargo(venceEn)} (lo que ya pagaste). Podés reactivarla cuando quieras desde esta pantalla.`
    : 'Cancelaste la suscripción: no se te cobran más meses. Podés reactivarla cuando quieras desde esta pantalla.';
}

export function rutasAdminSuscripcion({ db, config, servicios }) {
  const router = express.Router();
  const avisar = (req, tipo, texto) => (req.session.aviso = { tipo, texto });
  const urlBase = (req) => urlPanel(req, config.dominio);
  const volver = (res) => res.redirect('/admin/suscripcion');

  router.get('/suscripcion', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const tienda = await buscarTienda(db, tiendaId);
    const limites = await limitesDeTienda(db, tiendaId);
    const estado = servicios ? await estadoDeSuscripcion(db, tiendaId) : { activa: null, pendiente: null, cancelada: null };
    // Los planes que se pueden contratar solos y se cobran: la prueba gratis es solo para cuentas nuevas.
    const contratables = servicios ? (await listarPlanes(db)).filter((p) => esAutoservicio(p) && p.precioCentavos > 0) : [];
    const planes = armarPlanes(contratables);
    // Con la suscripción cancelada: ¿todavía tiene días pagos? ¿Se puede volver al mismo plan? Si le quedan días, el primer cobro de la reactivación es el día
    // en que vencen (no se cobra de más); si no, se cobra apenas autoriza.
    const acceso = Boolean(limites.venceEn) && limites.cobro.estado !== 'vencido';
    res.render('admin/suscripcion', {
      tienda,
      limites,
      ...estado,
      acceso,
      primerCobroAlReactivar: acceso && limites.cobro.dias > 0 ? limites.venceEn : null,
      planAnterior: estado.cancelada ? (planes.find((p) => p.id === estado.cancelada.planId) ?? null) : null,
      planes,
      pagos: await listarPagos(db, tiendaId),
      formatearFecha,
      pagosActivos: Boolean(servicios),
      contactoPlataforma: config.contactoPlataforma,
    });
  });

  // Las demás rutas solo existen con los pagos configurados.
  router.use('/suscripcion', (req, res, next) => {
    if (servicios) return next();
    avisar(req, 'error', 'Los pagos en línea no están disponibles por ahora. Contactanos y lo resolvemos.');
    volver(res);
  });

  router.post('/suscripcion/iniciar', verificarCsrf, async (req, res) => {
    const { tiendaId, email } = req.session.usuario;
    const { activa } = await estadoDeSuscripcion(db, tiendaId);
    const planId = /^\d+$/.test(String(req.body.plan ?? '')) ? Number(req.body.plan) : null;
    if (activa && activa.planId === planId) {
      avisar(req, 'error', 'Ya estás suscripto a ese plan.');
      return volver(res);
    }
    let resultado;
    try {
      resultado = await iniciarSuscripcion(servicios, {
        planId,
        email,
        tiendaId,
        reemplazaAId: activa?.id ?? null,
        urlVuelta: `${urlBase(req)}/admin/suscripcion/volver`,
      });
    } catch (error) {
      console.error('No se pudo crear la suscripción en Mercado Pago:', error);
      avisar(req, 'error', 'No pudimos conectarnos con Mercado Pago. Probá de nuevo en un rato.');
      return volver(res);
    }
    if (resultado.error) {
      avisar(req, 'error', resultado.error);
      return volver(res);
    }
    res.redirect(resultado.initPoint);
  });

  router.get('/suscripcion/pagar', async (req, res) => {
    let resultado;
    try {
      resultado = await retomarPago(servicios, req.session.usuario.tiendaId, { urlBase: urlBase(req) });
    } catch (error) {
      console.error('No se pudo retomar el pago:', error);
      resultado = { error: 'No pudimos conectarnos con Mercado Pago. Probá de nuevo en un rato.' };
    }
    if (resultado.initPoint) return res.redirect(resultado.initPoint);
    if (resultado.autorizada) avisar(req, 'ok', '¡Listo! Tu suscripción está activa.');
    else avisar(req, 'error', resultado.error);
    volver(res);
  });

  router.get('/suscripcion/volver', async (req, res) => {
    const { pendiente, activa } = await estadoDeSuscripcion(db, req.session.usuario.tiendaId);
    if (pendiente) {
      try {
        await sincronizarSuscripcion(servicios, pendiente.mpId, { urlBase: urlBase(req) });
      } catch (error) {
        console.error('No se pudo consultar la suscripción en Mercado Pago:', error.message);
      }
    }
    const despues = await estadoDeSuscripcion(db, req.session.usuario.tiendaId);
    if (despues.activa && despues.activa.id !== activa?.id) {
      const proximo = despues.activa.proximoCobro ? ` Tu próximo cobro es el ${formatearDiaLargo(despues.activa.proximoCobro)}.` : '';
      avisar(req, 'ok', `¡Listo! Tu suscripción al plan ${despues.activa.planNombre} está activa.${proximo}`);
    }
    else if (despues.pendiente) avisar(req, 'ok', 'Estamos confirmando tu pago. En unos minutos se actualiza esta pantalla.');
    volver(res);
  });

  router.post('/suscripcion/cancelar', verificarCsrf, async (req, res) => {
    let resultado;
    try {
      resultado = await cancelarSuscripcionDeTienda(servicios, req.session.usuario.tiendaId, { urlBase: urlBase(req) });
    } catch (error) {
      console.error('No se pudo cancelar la suscripción en Mercado Pago:', error);
      avisar(req, 'error', 'No pudimos cancelar la suscripción: Mercado Pago no respondió. Probá de nuevo en un rato.');
      return volver(res);
    }
    if (resultado.error) avisar(req, 'error', resultado.error);
    else avisar(req, 'ok', textoDeBaja(resultado.venceEn));
    volver(res);
  });

  return router;
}
