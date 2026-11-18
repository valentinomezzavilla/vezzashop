// Panel del administrador de la plataforma (/plataforma): clientes, planes y su propia cuenta.
// Es independiente del panel de cada tienda (/admin): tiene su propio ingreso y su propia sesión (req.session.superadmin).
import express from 'express';
import { tokenCsrf, verificarCsrf } from '../csrf.js';
import { crearLimite } from '../util/limite.js';
import { dominioDeTiendas, urlPanel, urlTienda } from '../util/dominios.js';
import { formatearFecha, plural } from '../util/formato.js';
import { formatearDia, hoy, sumarMeses } from '../util/fechas.js';
import { precioParaEditar } from '../productos.js';
import {
  autenticarSuperadmin,
  cambiarClaveSuperadmin,
  LARGO_MINIMO_CLAVE_SUPERADMIN,
  listarPlanes,
  leerPlan,
  validarPlan,
  crearPlan,
  editarPlan,
  borrarPlan,
  pausarPlan,
  listarClientes,
  leerCliente,
  resumenPlataforma,
  validarCliente,
  crearCliente,
  cambiarPlanDeCliente,
  suspenderCliente,
  reactivarCliente,
  fijarVencimiento,
  guardarNotas,
  registrarPago,
  listarPagos,
  resetearClaveDeCliente,
  cambiarEmailDeCliente,
  usoDeCliente,
  FILTROS_CLIENTES,
  esFiltroClientes,
} from '../plataforma.js';

const id = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);
const regenerarSesion = (req) =>
  new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));

export function rutasPlataforma({ db, config }) {
  const router = express.Router();
  // Frena a quien prueba claves: por IP y por email, en una ventana de 15 minutos. Solo cuentan los intentos fallidos.
  const intentos = crearLimite({ maximo: 8, ventanaMs: 15 * 60 * 1000 });
  const avisar = (req, tipo, texto) => (req.session.aviso = { tipo, texto });

  router.use((req, res, next) => {
    res.locals.csrf = tokenCsrf(req);
    res.locals.superadmin = req.session.superadmin ?? null;
    res.locals.aviso = req.session.aviso ?? null;
    delete req.session.aviso;
    // "/clientes/3" -> "clientes", para marcar la sección en el menú.
    res.locals.seccionActual = req.path.split('/')[1] || null;
    Object.assign(res.locals, { formatearDia, formatearFecha, precioParaEditar, plural, hoy: hoy() });
    // Lo que se muestra acá nunca se guarda en la caché del navegador.
    res.set('Cache-Control', 'no-store');
    next();
  });

  // ---------- Ingreso ----------

  router.get('/ingresar', (req, res) => {
    if (req.session.superadmin) return res.redirect('/plataforma/clientes');
    res.render('plataforma/ingresar', { error: null, email: '' });
  });

  router.post('/ingresar', verificarCsrf, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const claves = [`ip:${req.ip}`, `email:${email}`];
    if (!claves.every((clave) => intentos.puede(clave))) {
      return res.status(429).render('plataforma/ingresar', { error: 'Demasiados intentos. Esperá unos minutos y probá de nuevo.', email });
    }
    const superadmin = await autenticarSuperadmin(db, email, req.body.clave);
    if (!superadmin) {
      for (const clave of claves) intentos.registrar(clave);
      return res.status(401).render('plataforma/ingresar', { error: 'Email o clave incorrectos', email });
    }
    await regenerarSesion(req); // evita que alguien fije la sesión antes del ingreso
    req.session.superadmin = superadmin;
    res.redirect('/plataforma/clientes');
  });

  router.post('/salir', verificarCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('sesion-plataforma', { path: '/plataforma' }).redirect('/plataforma/ingresar');
    });
  });

  // De acá para abajo, todo requiere ser superadministrador.
  router.use((req, res, next) => {
    if (!req.session.superadmin) return res.redirect('/plataforma/ingresar');
    next();
  });

  router.get('/', (req, res) => res.redirect('/plataforma/clientes'));

  // ---------- Clientes ----------

  router.get('/clientes', async (req, res) => {
    const filtro = esFiltroClientes(req.query.filtro) ? req.query.filtro : 'todos';
    const busqueda = String(req.query.q ?? '').slice(0, 100);
    const { clientes, cuentas } = await listarClientes(db, { filtro, busqueda });
    res.render('plataforma/clientes', { clientes, cuentas, filtros: FILTROS_CLIENTES, filtro, busqueda, resumen: await resumenPlataforma(db) });
  });

  async function mostrarNuevoCliente(req, res, { valores = {}, errores = {}, status = 200 } = {}) {
    res.status(status).render('plataforma/cliente-nuevo', {
      planes: (await listarPlanes(db)).filter((p) => p.activo),
      valores,
      errores,
    });
  }

  router.get('/clientes/nuevo', (req, res) => mostrarNuevoCliente(req, res));

  router.post('/clientes/nuevo', verificarCsrf, async (req, res) => {
    const { datos, errores } = await validarCliente(db, req.body);
    if (Object.keys(errores).length > 0) return mostrarNuevoCliente(req, res, { valores: req.body, errores, status: 400 });
    let alta;
    try {
      alta = await crearCliente(db, datos);
    } catch (error) {
      // crearTienda avisa con un mensaje claro (nombre repetido, email inválido, subdominio reservado...).
      return mostrarNuevoCliente(req, res, { valores: req.body, errores: { general: error.message }, status: 400 });
    }
    // La clave se muestra en esta respuesta y no se guarda en la sesión: no se puede volver a ver.
    const { venceEn, diasPrueba } = await leerCliente(db, alta.tienda.id);
    res.render('plataforma/cliente-creado', {
      venceEn,
      diasPrueba,
      tienda: alta.tienda,
      email: alta.email,
      clave: alta.clave,
      urlPanel: `${urlPanel(req, config.dominio)}/admin`,
      urlTienda: urlTienda(req, dominioDeTiendas(config), alta.tienda.slug),
    });
  });

  // Carga el cliente; si no existe sigue de largo hasta el 404.
  const cargarCliente = async (req, res, next) => {
    const clienteId = id(req.params.clienteId);
    req.cliente = clienteId === null ? null : await leerCliente(db, clienteId);
    next(req.cliente ? undefined : 'route');
  };

  async function mostrarCliente(req, res, { errores = {}, status = 200, valores = {} } = {}) {
    const cliente = await leerCliente(db, req.cliente.id); // fresco: la ficha se muestra después de cambiarlo
    const planes = (await listarPlanes(db)).filter((p) => p.activo || p.id === cliente.planId);
    res.status(status).render('plataforma/cliente', {
      cliente,
      planes,
      pagos: await listarPagos(db, cliente.id),
      ...(await usoDeCliente(db, cliente.id)),
      urlTienda: urlTienda(req, dominioDeTiendas(config), cliente.slug),
      sugerido: sumarMeses(cliente.venceEn && cliente.venceEn >= hoy() ? cliente.venceEn : hoy(), 1),
      errores,
      valores,
    });
  }

  router.get('/clientes/:clienteId', cargarCliente, (req, res) => mostrarCliente(req, res));

  const volverAlCliente = (req, res) => res.redirect(`/plataforma/clientes/${req.cliente.id}`);

  router.post('/clientes/:clienteId/plan', cargarCliente, verificarCsrf, async (req, res) => {
    const planId = id(req.body.planId);
    const { error, prueba } = planId === null ? { error: 'Elegí un plan' } : await cambiarPlanDeCliente(db, req.cliente.id, planId);
    if (error) return mostrarCliente(req, res, { errores: { planId: error }, status: 400 });
    avisar(req, 'ok', prueba
      ? `Cambiamos el plan y empezó una prueba de ${plural(prueba.dias, 'día', 'días')}: vence el ${formatearDia(prueba.venceEn)}. Los topes nuevos valen desde ya.`
      : 'Cambiamos el plan. Los topes nuevos valen desde ya.');
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/pago', cargarCliente, verificarCsrf, async (req, res) => {
    const resultado = await registrarPago(db, req.cliente.id, { meses: req.body.meses, monto: req.body.monto, nota: req.body.nota });
    if (resultado.error) return mostrarCliente(req, res, { errores: { pago: resultado.error }, valores: req.body, status: 400 });
    avisar(req, 'ok', `Registramos el pago. Ahora vence el ${formatearDia(resultado.venceDespues)}.`);
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/vencimiento', cargarCliente, verificarCsrf, async (req, res) => {
    const fecha = String(req.body.venceEn ?? '').trim() || null; // vacío: sin vencimiento
    const error = await fijarVencimiento(db, req.cliente.id, fecha);
    if (error) return mostrarCliente(req, res, { errores: { venceEn: error }, status: 400 });
    avisar(req, 'ok', fecha ? `Ahora vence el ${formatearDia(fecha)}.` : 'Ahora no tiene vencimiento.');
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/suspender', cargarCliente, verificarCsrf, async (req, res) => {
    await suspenderCliente(db, req.cliente.id, req.body.motivo);
    avisar(req, 'ok', 'Suspendimos la tienda: los compradores ven un aviso y el cliente puede mirar su panel, pero no cambiar nada.');
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/reactivar', cargarCliente, verificarCsrf, async (req, res) => {
    await reactivarCliente(db, req.cliente.id);
    avisar(req, 'ok', 'Reactivamos la tienda: ya vuelve a estar abierta.');
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/clave', cargarCliente, verificarCsrf, async (req, res) => {
    const nueva = await resetearClaveDeCliente(db, req.cliente.id);
    if (!nueva) {
      avisar(req, 'error', 'Este cliente no tiene usuario.');
      return volverAlCliente(req, res);
    }
    res.render('plataforma/clave-nueva', {
      cliente: req.cliente,
      email: nueva.email,
      clave: nueva.clave,
      urlPanel: `${urlPanel(req, config.dominio)}/admin`,
    });
  });

  router.post('/clientes/:clienteId/email', cargarCliente, verificarCsrf, async (req, res) => {
    const error = await cambiarEmailDeCliente(db, req.cliente.id, req.body.email);
    if (error) return mostrarCliente(req, res, { errores: { email: error }, valores: req.body, status: 400 });
    avisar(req, 'ok', 'Cambiamos el email del cliente. La clave sigue siendo la misma.');
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/notas', cargarCliente, verificarCsrf, async (req, res) => {
    await guardarNotas(db, req.cliente.id, req.body.notas);
    avisar(req, 'ok', 'Guardamos las notas.');
    volverAlCliente(req, res);
  });

  // ---------- Planes ----------

  router.get('/planes', async (req, res) => res.render('plataforma/planes', { planes: await listarPlanes(db) }));

  const formularioDePlan = (plan) => ({
    nombre: plan?.nombre ?? '',
    precio: plan ? precioParaEditar(plan.precioCentavos) : '',
    maxProductos: plan?.maxProductos ?? '',
    maxFotos: plan?.maxFotos ?? '',
    maxBanners: plan?.maxBanners ?? '',
    activo: plan?.activo ?? true,
    diasPrueba: plan?.diasPrueba ?? '',
    suspenderAlVencer: plan?.suspenderAlVencer ?? false,
  });

  const mostrarPlan = (req, res, { plan = null, valores, errores = {}, status = 200 }) =>
    res.status(status).render('plataforma/plan', { plan, valores: valores ?? formularioDePlan(plan), errores });

  router.get('/planes/nuevo', (req, res) => mostrarPlan(req, res, {}));

  router.post('/planes/nuevo', verificarCsrf, async (req, res) => {
    const { datos, errores } = await validarPlan(db, null, req.body);
    if (Object.keys(errores).length > 0) return mostrarPlan(req, res, { valores: { ...req.body, activo: datos.activo, suspenderAlVencer: datos.suspenderAlVencer }, errores, status: 400 });
    await crearPlan(db, datos);
    avisar(req, 'ok', `Creamos el plan "${datos.nombre}".`);
    res.redirect('/plataforma/planes');
  });

  const cargarPlan = async (req, res, next) => {
    const planId = id(req.params.planId);
    req.plan = planId === null ? null : await leerPlan(db, planId);
    next(req.plan ? undefined : 'route');
  };

  router.get('/planes/:planId', cargarPlan, (req, res) => mostrarPlan(req, res, { plan: req.plan }));

  router.post('/planes/:planId', cargarPlan, verificarCsrf, async (req, res) => {
    const { datos, errores } = await validarPlan(db, req.plan.id, req.body);
    if (Object.keys(errores).length > 0) {
      return mostrarPlan(req, res, { plan: req.plan, valores: { ...req.body, activo: datos.activo, suspenderAlVencer: datos.suspenderAlVencer }, errores, status: 400 });
    }
    await editarPlan(db, req.plan.id, datos);
    avisar(req, 'ok', `Guardamos el plan "${datos.nombre}". Los topes nuevos valen para todos sus clientes desde ya.`);
    res.redirect('/plataforma/planes');
  });

  // Pausar / reanudar desde la lista: deja de ofrecerse a clientes nuevos (los que ya lo tienen no cambian).
  router.post('/planes/:planId/pausar', cargarPlan, verificarCsrf, async (req, res) => {
    const pausar = req.plan.activo; // si estaba ofrecido, se pausa; si estaba pausado, se reanuda
    await pausarPlan(db, req.plan.id, pausar);
    avisar(req, 'ok', pausar
      ? `Pausamos "${req.plan.nombre}": ya no se ofrece a clientes nuevos. Los que lo tienen siguen igual.`
      : `Reanudamos "${req.plan.nombre}": vuelve a ofrecerse a clientes nuevos.`);
    res.redirect('/plataforma/planes');
  });

  router.post('/planes/:planId/borrar', cargarPlan, verificarCsrf, async (req, res) => {
    const motivo = await borrarPlan(db, req.plan.id);
    avisar(req, motivo ? 'error' : 'ok', motivo ?? `Borramos el plan "${req.plan.nombre}".`);
    res.redirect('/plataforma/planes');
  });

  // ---------- Mi cuenta ----------

  const mostrarCuenta = (req, res, { errores = {}, status = 200 } = {}) =>
    res.status(status).render('plataforma/cuenta', { errores, largoMinimoClave: LARGO_MINIMO_CLAVE_SUPERADMIN });

  router.get('/cuenta', (req, res) => mostrarCuenta(req, res));

  router.post('/cuenta/clave', verificarCsrf, async (req, res) => {
    const problema = await cambiarClaveSuperadmin(db, req.session.superadmin.id, {
      actual: req.body.claveActual,
      nueva: req.body.claveNueva,
      repetida: req.body.claveRepetida,
    });
    if (problema) return mostrarCuenta(req, res, { errores: { [problema.campo]: problema.mensaje }, status: 400 });
    avisar(req, 'ok', 'Cambiamos tu clave.');
    res.redirect('/plataforma/cuenta');
  });

  return router;
}
