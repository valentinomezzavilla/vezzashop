// Alta de una cuenta nueva desde la landing: elegir plan -> pagar en Mercado Pago -> completar el formulario de la cuenta.
//  GET  /suscribirse?plan=<id>    paso 1: el plan y el email (Mercado Pago lo pide para crear la suscripción)
//  POST /suscribirse              crea la suscripción y manda al cliente a pagar (o, en la prueba gratis, al formulario)
//  GET  /suscribirse/volver?t=    a donde vuelve el cliente desde Mercado Pago: confirma el pago y sigue
//  GET  /suscribirse/cuenta?t=    el formulario de la cuenta (nombre, apellido, email, clave y datos de la tienda)
//  POST /suscribirse/cuenta       crea la cuenta, inicia la sesión y avisa a n8n para que mande el mail de bienvenida
// El link con el token es lo que da permiso para crear la cuenta, y solo funciona si el pago está autorizado (ver suscripciones.js).
import express from 'express';
import { autenticar, LARGO_MINIMO_CLAVE } from '../tiendas.js';
import { esAutoservicio, leerPlan } from '../plataforma.js';
import { armarPlanes, precioDe } from '../landing.js';
import { armarAvisoCuentaCreada } from '../notificaciones.js';
import { crearCuentaDeSuscripcion, estadoDelEnlace, idDeToken, iniciarSuscripcion, leerSuscripcion, sincronizarSuscripcion } from '../suscripciones.js';
import { tokenCsrf, verificarCsrf } from '../csrf.js';
import { crearLimite } from '../util/limite.js';
import { dominioDeTiendas, urlPanel, urlTienda } from '../util/dominios.js';

const regenerarSesion = (req) => new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));

// Cuántas veces se recarga sola la pantalla "estamos confirmando tu pago" antes de rendirse (cada 4 segundos).
const RECARGAS_MAXIMAS = 15;

// Lo que se le dice al cliente cuando el link no sirve para abrir el formulario.
const ESTADOS = {
  invalido: { titulo: 'Este link no es válido', mensaje: 'Revisá que esté completo, tal cual lo recibiste por mail. Si el problema sigue, escribinos y lo resolvemos.' },
  vencido: { titulo: 'Este link venció', mensaje: 'Pasaron más de 14 días. Escribinos y te mandamos uno nuevo: tu pago está registrado.' },
  'sin-pago': { titulo: 'No pudimos confirmar el pago', mensaje: 'La suscripción no quedó activa. Podés elegir un plan de nuevo; si ya se te cobró, escribinos y lo resolvemos.' },
  usado: { titulo: 'Tu cuenta ya está creada', mensaje: 'Ingresá a tu panel con el email y la clave que elegiste.', accion: { texto: 'Ingresar a mi panel', href: '/admin' } },
};

export function rutasSuscribirse({ servicios, config }) {
  const { db } = servicios;
  const router = express.Router();
  // Frena a quien intente armar cuentas a lo bruto: 10 intentos por hora y por dirección, en cada paso.
  const altas = crearLimite({ maximo: 10, ventanaMs: 60 * 60 * 1000 });
  const cuentas = crearLimite({ maximo: 10, ventanaMs: 60 * 60 * 1000 });

  router.use((req, res, next) => {
    res.locals.csrf = tokenCsrf(req);
    res.locals.usuario = null; // estas pantallas son públicas: no llevan el menú del panel
    res.locals.contactoPlataforma = config.contactoPlataforma;
    next();
  });

  const urlBase = (req) => urlPanel(req, config.dominio);
  const tarjetaDe = (plan) => armarPlanes([plan])[0];
  const mostrarEstado = (res, { titulo, mensaje, accion = null, recargar = null, status = 200 }) =>
    res.status(status).render('suscribirse-estado', { titulo, mensaje, accion: accion ?? { texto: 'Ver los planes', href: '/#planes' }, recargar });

  // ---------- Paso 1: el plan y el email ----------

  async function mostrarPaso1(req, res, plan, { valores = {}, errores = {}, status = 200 } = {}) {
    res.status(status).render('suscribirse', { plan: tarjetaDe(plan), planId: plan.id, gratis: plan.precioCentavos === 0, valores, errores, urlTerminos: config.urlTerminos });
  }

  const planDelPedido = async (valor) => {
    const plan = /^\d+$/.test(String(valor ?? '')) ? await leerPlan(db, Number(valor)) : null;
    return plan && esAutoservicio(plan) ? plan : null;
  };

  router.get('/', async (req, res) => {
    const plan = await planDelPedido(req.query.plan);
    if (!plan) return res.redirect('/#planes');
    mostrarPaso1(req, res, plan);
  });

  router.post('/', verificarCsrf, async (req, res) => {
    const plan = await planDelPedido(req.body.plan);
    if (!plan) return res.redirect('/#planes');
    const mostrar = (errores, status = 400) => mostrarPaso1(req, res, plan, { valores: req.body, errores, status });
    if (config.urlTerminos && req.body.terminos !== '1') return mostrar({ terminos: 'Para seguir tenés que aceptar los términos y condiciones' });
    if (!altas.puede(req.ip)) return mostrar({ general: 'Hiciste demasiados intentos. Probá de nuevo en un rato.' }, 429);
    altas.registrar(req.ip);

    let resultado;
    try {
      resultado = await iniciarSuscripcion(servicios, {
        planId: plan.id,
        email: req.body.email,
        urlVuelta: (token) => `${urlBase(req)}/suscribirse/volver?t=${token}`,
      });
    } catch (error) {
      console.error('No se pudo crear la suscripción en Mercado Pago:', error);
      return mostrar({ general: 'No pudimos conectarnos con Mercado Pago. Probá de nuevo en un rato.' }, 502);
    }
    if (resultado.error) return mostrar({ [resultado.campo === 'plan' ? 'general' : resultado.campo]: resultado.error });
    // Pago: a Mercado Pago, que al terminar vuelve a /suscribirse/volver. Prueba gratis: directo al formulario de la cuenta.
    res.redirect(resultado.initPoint ?? `/suscribirse/cuenta?t=${resultado.token}`);
  });

  // ---------- A dónde vuelve el cliente desde Mercado Pago ----------

  // Lee la suscripción del link y, si el pago todavía figura pendiente, le pregunta a Mercado Pago (no espera al webhook).
  async function resolverEnlace(req) {
    const id = idDeToken(servicios.secreto, req.query.t ?? req.body?.t);
    let suscripcion = id === null ? null : await leerSuscripcion(db, id);
    if (suscripcion?.mpId && suscripcion.estado === 'pendiente') {
      try {
        await sincronizarSuscripcion(servicios, suscripcion.mpId, { urlBase: urlBase(req) });
        suscripcion = await leerSuscripcion(db, id);
      } catch (error) {
        console.error('No se pudo consultar la suscripción en Mercado Pago:', error.message);
      }
    }
    return { suscripcion, estado: estadoDelEnlace(suscripcion) };
  }

  router.get('/volver', async (req, res) => {
    const { suscripcion, estado } = await resolverEnlace(req);
    if (estado === 'ok') return res.redirect(`/suscribirse/cuenta?t=${req.query.t}`);
    if (estado !== 'pendiente') return mostrarEstado(res, ESTADOS[estado]);
    // Mercado Pago a veces tarda unos segundos en avisar: se vuelve a mirar sola.
    const intento = Math.max(0, Number.parseInt(req.query.n ?? '0', 10) || 0);
    if (intento >= RECARGAS_MAXIMAS) {
      return mostrarEstado(res, {
        titulo: 'Todavía no vemos tu pago',
        mensaje: `Si ya pagaste, en unos minutos te mandamos un mail a ${suscripcion.emailPagador} con el link para crear tu cuenta. Si cerraste la ventana de pago antes de terminar, podés elegir tu plan de nuevo.`,
      });
    }
    mostrarEstado(res, {
      titulo: 'Estamos confirmando tu pago',
      mensaje: 'Un momento, esta pantalla se actualiza sola. No la cierres.',
      recargar: `/suscribirse/volver?t=${encodeURIComponent(req.query.t)}&n=${intento + 1}`,
    });
  });

  // ---------- El formulario de la cuenta ----------

  async function mostrarFormulario(req, res, suscripcion, { valores = {}, errores = {}, status = 200 } = {}) {
    const plan = await leerPlan(db, suscripcion.planId);
    res.status(status).render('suscribirse-cuenta', {
      token: req.query.t ?? req.body.t,
      plan: tarjetaDe(plan),
      prueba: suscripcion.estado === 'prueba',
      largoMinimoClave: LARGO_MINIMO_CLAVE,
      valores: { email: suscripcion.emailPagador, ...valores },
      errores,
      // Para mostrar el link alrededor del campo: "https://" + lo que escribe + ".dominio".
      partesLink: urlTienda(req, dominioDeTiendas(config), '\0').split('\0'),
    });
  }

  router.get('/cuenta', async (req, res) => {
    const { suscripcion, estado } = await resolverEnlace(req);
    if (estado === 'pendiente') return res.redirect(`/suscribirse/volver?t=${encodeURIComponent(req.query.t)}`);
    if (estado !== 'ok') return mostrarEstado(res, ESTADOS[estado]);
    mostrarFormulario(req, res, suscripcion);
  });

  router.post('/cuenta', verificarCsrf, async (req, res) => {
    const { suscripcion, estado } = await resolverEnlace(req);
    if (estado === 'pendiente') return res.redirect(`/suscribirse/volver?t=${encodeURIComponent(req.body.t)}`);
    if (estado !== 'ok') return mostrarEstado(res, ESTADOS[estado]);
    if (!cuentas.puede(req.ip)) {
      return mostrarFormulario(req, res, suscripcion, { valores: req.body, errores: { general: 'Hiciste demasiados intentos. Probá de nuevo en un rato.' }, status: 429 });
    }
    cuentas.registrar(req.ip);

    const resultado = await crearCuentaDeSuscripcion(servicios, req.body.t, req.body);
    if (resultado.error) return mostrarEstado(res, ESTADOS[resultado.error] ?? ESTADOS.invalido);
    if (resultado.errores) {
      // Las claves no vuelven a la pantalla.
      const { clave, claveRepetida, ...valores } = req.body;
      return mostrarFormulario(req, res, suscripcion, { valores, errores: resultado.errores, status: 400 });
    }

    const { tienda, plan, datos } = resultado;
    // Queda adentro del panel, con la clave que acaba de elegir.
    const usuario = await autenticar(db, datos.email, datos.clave);
    await regenerarSesion(req);
    req.session.usuario = usuario;
    req.session.aviso = { tipo: 'ok', texto: '¡Listo! Tu cuenta está creada. Te mandamos un mail con el link para entrar cuando quieras.' };
    // El mail lo manda n8n. No se espera la respuesta: que tarde o falle no tiene que demorar ni romper el alta.
    const { precio, unidad } = precioDe(plan);
    void servicios.avisar('cuenta_creada', armarAvisoCuentaCreada({
      email: datos.email,
      nombre: datos.nombre,
      apellido: datos.apellido,
      tiendaNombre: datos.nombreTienda,
      tiendaUrl: urlTienda(req, dominioDeTiendas(config), tienda.slug),
      planNombre: plan.nombre,
      precio: `${precio} ${unidad}`.trim(),
      urlPanel: `${urlBase(req)}/admin`,
    }));
    res.redirect('/admin/inicio');
  });

  return router;
}
