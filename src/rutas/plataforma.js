// Panel del administrador de la plataforma (/plataforma): clientes, planes y su propia cuenta.
// Es independiente del panel de cada tienda (/admin): tiene su propio ingreso y su propia sesión (req.session.superadmin).
import express from 'express';
import { tokenCsrf, verificarCsrf } from '../csrf.js';
import { crearLimite } from '../util/limite.js';
import { dominioDeTiendas, urlPanel, urlTienda } from '../util/dominios.js';
import { formatearFecha, formatearPrecio, plural } from '../util/formato.js';
import { formatearDia, formatearDiaLargo, hoy, sumarMeses } from '../util/fechas.js';
import { precioParaEditar } from '../productos.js';
import { precioDe } from '../landing.js';
import { NIVELES, datosDeNivel, incluyeNivel } from '../diseno-por-plan.js';
import { ESTADOS_DOMINIO, cambiarActivacion, leerDominio, quitarDominio, registrosDns, solicitarDominio, verificarDominio } from '../dominios-propios.js';
import { armarAvisoCuentaCreada } from '../notificaciones.js';
import { cancelarSuscripcionDeTienda, estadoDeSuscripcion, leerSuscripcion, listarAltasSinCuenta, reenviarEnlaceDeAlta, sincronizarSuscripcion } from '../suscripciones.js';
import { actualizarCobroDeCliente, afectaAClientes, aplicarCambioDePlan, clientesDelPlan, prepararConfirmacion, resumenDeResultado } from '../cambios-de-plan.js';
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
  fijarPrecioDeCliente,
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
import { cambiarLinkDeTienda, listarEnlacesAnteriores, soltarEnlaceAnterior } from '../tiendas.js';

// Cuánto HTML se puede cargar en cada código de seguimiento.
const MAX_CODIGO = 10_000;
const id = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);
const regenerarSesion = (req) =>
  new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));

// ids que llegan de un formulario (uno, varios o ninguno): enteros positivos, sin repetir.
const idsDe = (valor) => new Set((Array.isArray(valor) ? valor : valor === undefined ? [] : [valor]).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0));

// servicios: las suscripciones con Mercado Pago (ver suscripciones.js); null si no están configuradas.
// notificar: el aviso por mail a n8n (notificaciones.js); sin N8N_WEBHOOK_URL no manda nada, pero siempre existe.
export function rutasPlataforma({ db, config, servicios = null, notificar = async () => false }) {
  const router = express.Router();
  // Frena a quien prueba claves: por IP y por email, en una ventana de 15 minutos. Solo cuentan los intentos fallidos.
  const intentos = crearLimite({ maximo: 8, ventanaMs: 15 * 60 * 1000 });
  const avisar = (req, tipo, texto) => (req.session.aviso = { tipo, texto });

  router.use((req, res, next) => {
    res.locals.csrf = tokenCsrf(req);
    res.locals.superadmin = req.session.superadmin ?? null;
    res.locals.pagosActivos = Boolean(servicios);
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
      // El link se arma como "https://" + slug + ".dominio" (con el puerto en local): las dos puntas para mostrarlas alrededor del campo.
      partesLink: urlTienda(req, dominioDeTiendas(config), '\0').split('\0'),
      enlacesAnteriores: await listarEnlacesAnteriores(db, cliente.id),
      suscripcion: servicios ? await estadoDeSuscripcion(db, cliente.id) : null,
      diseno: await datosDeDiseno(cliente.id),
      sugerido: sumarMeses(cliente.venceEn && cliente.venceEn >= hoy() ? cliente.venceEn : hoy(), 1),
      errores,
      valores,
    });
  }

  // El diseño y el dominio propio de un cliente: su nivel de diseño, el dominio (con los registros DNS que le corresponden) y los códigos de seguimiento.
  // config.resolverDns solo lo usan los tests (para no salir a internet): sin él se usa el DNS de verdad.
  const opcionesDns = { panel: config.dominio, ip: config.ipServidor ?? '', resolver: config.resolverDns };
  async function datosDeDiseno(tiendaId) {
    const { nivel } = await datosDeNivel(db, tiendaId);
    const actual = await leerDominio(db, tiendaId);
    const codigos = await db.prepare('SELECT codigo_cabecera AS cabecera, codigo_pie AS pie FROM tiendas WHERE id = ?').get(tiendaId);
    return {
      nivel,
      nivelTitulo: NIVELES[nivel].titulo,
      aMedida: incluyeNivel(nivel, 'a_medida'),
      dominio: actual,
      estadosDominio: ESTADOS_DOMINIO,
      registros: actual ? registrosDns(actual.dominio, opcionesDns) : [],
      panel: config.dominio,
      codigos,
      maxCodigo: MAX_CODIGO,
    };
  }

  router.get('/clientes/:clienteId', cargarCliente, (req, res) => mostrarCliente(req, res));

  // Dominio propio de un cliente: se carga o reemplaza, se verifica el DNS, y se activa cuando ya está agregado en Coolify (ver dominios-propios.js).
  const volverADominio = (req, res, tipo, texto) => {
    avisar(req, tipo, texto);
    res.redirect(`/plataforma/clientes/${req.cliente.id}#dominio`);
  };
  router.post('/clientes/:clienteId/dominio', cargarCliente, verificarCsrf, async (req, res) => {
    const resultado = await solicitarDominio(db, req.cliente.id, req.body.dominio, { dominioPanel: config.dominio, dominioTiendas: dominioDeTiendas(config) });
    if (resultado.error) return volverADominio(req, res, 'error', resultado.error);
    volverADominio(req, res, 'ok', `Cargamos el dominio ${resultado.dominio} para ${req.cliente.nombre}. Verificá el DNS y, cuando lo agregues en Coolify, activalo.`);
  });
  router.post('/clientes/:clienteId/dominio/verificar', cargarCliente, verificarCsrf, async (req, res) => {
    const resultado = await verificarDominio(db, req.cliente.id, opcionesDns);
    if (!resultado) return volverADominio(req, res, 'error', 'Este cliente no tiene un dominio cargado.');
    const visto = [...resultado.cname.map((c) => `CNAME ${c}`), ...resultado.a.map((a) => `A ${a}`)].join(', ') || 'ningún registro';
    if (resultado.ok) volverADominio(req, res, 'ok', `El DNS de ${resultado.dominio} apunta a la plataforma (${visto}).`);
    else volverADominio(req, res, 'error', `El DNS de ${resultado.dominio} todavía no apunta a la plataforma: encontramos ${visto}. Tiene que ser un CNAME a ${config.dominio}${config.ipServidor ? ` o un registro A a ${config.ipServidor}` : ''}.`);
  });
  router.post('/clientes/:clienteId/dominio/activar', cargarCliente, verificarCsrf, async (req, res) => {
    if (!incluyeNivel((await datosDeNivel(db, req.cliente.id)).nivel, 'a_medida')) return volverADominio(req, res, 'error', 'El plan de este cliente no incluye dominio propio (es del plan A medida).');
    if (!(await cambiarActivacion(db, req.cliente.id, true))) return volverADominio(req, res, 'error', 'Este cliente no tiene un dominio cargado.');
    volverADominio(req, res, 'ok', 'Activamos el dominio: la tienda ya se resuelve ahí y el link de siempre redirige. Si ves que no carga con https, desactivalo y revisá Coolify.');
  });
  router.post('/clientes/:clienteId/dominio/desactivar', cargarCliente, verificarCsrf, async (req, res) => {
    await cambiarActivacion(db, req.cliente.id, false);
    volverADominio(req, res, 'ok', 'Desactivamos el dominio: la tienda vuelve a verse solo en su link de siempre.');
  });
  router.post('/clientes/:clienteId/dominio/quitar', cargarCliente, verificarCsrf, async (req, res) => {
    await quitarDominio(db, req.cliente.id);
    volverADominio(req, res, 'ok', 'Sacamos el dominio de este cliente.');
  });

  // Códigos de seguimiento (píxeles, analítica) que van en la cabecera y al pie de la tienda. Solo los carga quien administra la plataforma,
  // y la vidriera los usa solo con el plan a medida. Es HTML tal cual: se imprime sin escapar.
  router.post('/clientes/:clienteId/codigos', cargarCliente, verificarCsrf, async (req, res) => {
    const limpiar = (valor) => String(valor ?? '').replace(/\r\n?/g, '\n').trim();
    const cabecera = limpiar(req.body.codigoCabecera);
    const pie = limpiar(req.body.codigoPie);
    if (cabecera.length > MAX_CODIGO || pie.length > MAX_CODIGO) return volverADominio(req, res, 'error', `Cada código puede tener hasta ${MAX_CODIGO.toLocaleString('es-AR')} caracteres.`);
    await db.prepare('UPDATE tiendas SET codigo_cabecera = ?, codigo_pie = ? WHERE id = ?').run(cabecera, pie, req.cliente.id);
    avisar(req, 'ok', 'Guardamos los códigos de seguimiento.');
    res.redirect(`/plataforma/clientes/${req.cliente.id}#codigos`);
  });

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

  router.post('/clientes/:clienteId/enlace', cargarCliente, verificarCsrf, async (req, res) => {
    const resultado = await cambiarLinkDeTienda(db, req.cliente.id, req.body.slug);
    if (resultado.error) return mostrarCliente(req, res, { errores: { enlace: resultado.error }, valores: req.body, status: 400 });
    const nuevo = urlTienda(req, dominioDeTiendas(config), resultado.slug).replace(/^https?:\/\//, '');
    avisar(req, 'ok', `Cambiamos el link: ahora la tienda está en ${nuevo}. El anterior (${resultado.anterior}) redirige al nuevo.`);
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/enlaces/soltar', cargarCliente, verificarCsrf, async (req, res) => {
    const soltado = await soltarEnlaceAnterior(db, req.cliente.id, req.body.slug);
    if (soltado) avisar(req, 'ok', `"${req.body.slug}" dejó de redirigir: ya lo puede usar otra tienda.`);
    else avisar(req, 'error', 'Ese link no estaba entre los anteriores de esta tienda.');
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

  // Precio fijo del cliente: lo que paga por mes aunque cambie el precio de su plan (vacío: vuelve a pagar el del plan).
  router.post('/clientes/:clienteId/precio', cargarCliente, verificarCsrf, async (req, res) => {
    const resultado = await fijarPrecioDeCliente(db, req.cliente.id, req.body.precioFijo);
    if (resultado.error) return mostrarCliente(req, res, { errores: { precio: resultado.error }, valores: req.body, status: 400 });
    avisar(req, 'ok', resultado.precioFijoCentavos === null
      ? 'Ahora paga el precio de su plan: los cambios de precio del plan lo alcanzan.'
      : `Fijamos su precio en ${formatearPrecio(resultado.precioFijoCentavos)} por mes: los cambios de precio del plan no lo alcanzan.`);
    volverAlCliente(req, res);
  });

  // ---------- Suscripciones (Mercado Pago) ----------

  // Estas pantallas y botones solo existen con los pagos configurados.
  const conPagos = (req, res, next) => {
    if (servicios) return next();
    avisar(req, 'error', 'Los pagos en línea no están configurados (falta MP_ACCESS_TOKEN).');
    res.redirect('/plataforma/clientes');
  };
  const urlBase = (req) => urlPanel(req, config.dominio);

  // Pone al día con Mercado Pago las suscripciones del cliente (la activa y la que quedó a medias).
  router.post('/clientes/:clienteId/suscripcion/sincronizar', cargarCliente, conPagos, verificarCsrf, async (req, res) => {
    const { activa, pendiente } = await estadoDeSuscripcion(db, req.cliente.id);
    const mpIds = [activa?.mpId, pendiente?.mpId].filter(Boolean);
    if (mpIds.length === 0) avisar(req, 'error', 'Este cliente no tiene una suscripción para sincronizar.');
    else {
      try {
        for (const mpId of mpIds) await sincronizarSuscripcion(servicios, mpId, { urlBase: urlBase(req) });
        avisar(req, 'ok', 'Sincronizamos la suscripción con Mercado Pago.');
      } catch (error) {
        console.error('No se pudo sincronizar con Mercado Pago:', error);
        avisar(req, 'error', 'Mercado Pago no respondió. Probá de nuevo en un rato.');
      }
    }
    volverAlCliente(req, res);
  });

  router.post('/clientes/:clienteId/suscripcion/cancelar', cargarCliente, conPagos, verificarCsrf, async (req, res) => {
    try {
      const resultado = await cancelarSuscripcionDeTienda(servicios, req.cliente.id, { urlBase: urlBase(req) });
      if (resultado.error) avisar(req, 'error', resultado.error);
      else {
        const hasta = resultado.venceEn && resultado.venceEn >= hoy() ? ` hasta el ${formatearDiaLargo(resultado.venceEn)}` : '';
        avisar(req, 'ok', `Cancelamos el cobro automático. La tienda sigue abierta${hasta || ' hasta el vencimiento ya pago'}, y le mandamos un mail con la fecha.`);
      }
    } catch (error) {
      console.error('No se pudo cancelar la suscripción en Mercado Pago:', error);
      avisar(req, 'error', 'Mercado Pago no respondió: la suscripción sigue activa. Probá de nuevo en un rato.');
    }
    volverAlCliente(req, res);
  });

  // Le pone a la suscripción el monto que le corresponde al cliente (su precio fijo o el de su plan): reintenta un cambio que falló
  // o aplica un precio fijo recién cargado.
  router.post('/clientes/:clienteId/suscripcion/actualizar-monto', cargarCliente, conPagos, verificarCsrf, async (req, res) => {
    try {
      const resultado = await actualizarCobroDeCliente(
        { db, mp: servicios.mp, avisar: notificar },
        req.cliente.id,
        { avisarPorMail: req.body.avisarPorMail === '1', urlBase: urlBase(req) },
      );
      if (resultado.error) avisar(req, 'error', resultado.error);
      else avisar(req, 'ok', `Actualizamos el cobro en Mercado Pago a ${formatearPrecio(resultado.montoCentavos)} por mes, desde su próximo cobro.${resultado.avisado ? ' Le avisamos por mail.' : ''}`);
    } catch (error) {
      console.error('No se pudo actualizar el monto en Mercado Pago:', error);
      avisar(req, 'error', `Mercado Pago no aceptó el cambio${error.detalle?.message ? ` (${error.detalle.message})` : ''}. La suscripción sigue con el monto anterior.`);
    }
    volverAlCliente(req, res);
  });

  // Vuelve a mandar el mail de "tu cuenta está lista" (por n8n).
  router.post('/clientes/:clienteId/bienvenida', cargarCliente, conPagos, verificarCsrf, async (req, res) => {
    const c = req.cliente;
    if (!c.email) {
      avisar(req, 'error', 'Este cliente no tiene usuario.');
      return volverAlCliente(req, res);
    }
    const { precio, unidad } = precioDe({ precioCentavos: c.precioCentavos ?? 0, diasPrueba: c.diasPrueba });
    const enviado = await servicios.avisar(
      'cuenta_creada',
      armarAvisoCuentaCreada({
        email: c.email,
        nombre: c.titularNombre ?? '',
        apellido: c.titularApellido ?? '',
        tiendaNombre: c.nombre,
        tiendaUrl: urlTienda(req, dominioDeTiendas(config), c.slug),
        planNombre: c.planNombre ?? 'Sin plan',
        precio: `${precio} ${unidad}`.trim(),
        urlPanel: `${urlBase(req)}/admin`,
      }),
    );
    if (enviado) avisar(req, 'ok', `Le mandamos el mail de bienvenida a ${c.email}.`);
    else avisar(req, 'error', 'No se pudo mandar el mail. Revisá que N8N_WEBHOOK_URL esté configurada y que el flujo de n8n esté activo.');
    volverAlCliente(req, res);
  });

  // Altas sin cuenta: pagaron (o empezaron la prueba) y no completaron el formulario.
  router.get('/altas', conPagos, async (req, res) => res.render('plataforma/altas', { altas: await listarAltasSinCuenta(db) }));

  const cargarAlta = async (req, res, next) => {
    const altaId = id(req.params.altaId);
    req.alta = altaId === null ? null : await leerSuscripcion(db, altaId);
    next(req.alta ? undefined : 'route');
  };

  router.post('/altas/:altaId/sincronizar', conPagos, cargarAlta, verificarCsrf, async (req, res) => {
    if (!req.alta.mpId) avisar(req, 'error', 'Esta alta es una prueba gratis: no pasa por Mercado Pago.');
    else {
      try {
        await sincronizarSuscripcion(servicios, req.alta.mpId, { urlBase: urlBase(req) });
        avisar(req, 'ok', 'Sincronizamos el pago con Mercado Pago.');
      } catch (error) {
        console.error('No se pudo sincronizar con Mercado Pago:', error);
        avisar(req, 'error', 'Mercado Pago no respondió. Probá de nuevo en un rato.');
      }
    }
    res.redirect('/plataforma/altas');
  });

  router.post('/altas/:altaId/reenviar', conPagos, cargarAlta, verificarCsrf, async (req, res) => {
    const resultado = await reenviarEnlaceDeAlta(servicios, req.alta.id, urlBase(req));
    if (resultado.error) avisar(req, 'error', resultado.error);
    else if (resultado.enviado) avisar(req, 'ok', `Le mandamos a ${req.alta.emailPagador} el link para crear su cuenta (vale 14 días desde ahora).`);
    else avisar(req, 'error', 'No se pudo mandar el mail. Revisá que N8N_WEBHOOK_URL esté configurada y que el flujo de n8n esté activo.');
    res.redirect('/plataforma/altas');
  });

  // ---------- Planes ----------

  router.get('/planes', async (req, res) => res.render('plataforma/planes', { niveles: NIVELES, planes: await listarPlanes(db) }));

  const formularioDePlan = (plan) => ({
    nombre: plan?.nombre ?? '',
    precio: plan ? precioParaEditar(plan.precioCentavos) : '',
    maxProductos: plan?.maxProductos ?? '',
    maxFotos: plan?.maxFotos ?? '',
    maxBanners: plan?.maxBanners ?? '',
    activo: plan?.activo ?? true,
    diasPrueba: plan?.diasPrueba ?? '',
    suspenderAlVencer: plan?.suspenderAlVencer ?? false,
    nivelDiseno: plan?.nivelDiseno ?? 'esencial',
  });

  // Los datos validados de un plan, otra vez como campos de formulario (para llevarlos escondidos a la pantalla de confirmación).
  const camposDePlan = (datos) => ({
    nombre: datos.nombre,
    precio: precioParaEditar(datos.precioCentavos),
    maxProductos: datos.maxProductos ?? '',
    maxFotos: datos.maxFotos ?? '',
    maxBanners: datos.maxBanners ?? '',
    diasPrueba: datos.diasPrueba ?? '',
    activo: datos.activo ? '1' : '',
    suspenderAlVencer: datos.suspenderAlVencer ? '1' : '',
    nivelDiseno: datos.nivelDiseno,
  });

  const mostrarPlan = (req, res, { plan = null, valores, errores = {}, status = 200 }) =>
    res.status(status).render('plataforma/plan', { plan, valores: valores ?? formularioDePlan(plan), errores, niveles: NIVELES });

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
    // Si el cambio le toca a quienes ya tienen el plan (el precio, los topes, lo que pasa al vencer), no se guarda de entrada: primero se ve a quiénes
    // alcanza, se elige a quiénes se saca de un aumento y si se les avisa por mail.
    const confirmacion = Number(req.plan.clientes) > 0 ? await prepararConfirmacion(db, req.plan, datos) : null;
    if (confirmacion && afectaAClientes(confirmacion.cambios)) {
      return res.render('plataforma/plan-confirmar', {
        plan: req.plan,
        datos,
        campos: camposDePlan(datos),
        ...confirmacion,
        hayCorreo: Boolean(config.n8n),
      });
    }
    await editarPlan(db, req.plan.id, datos);
    avisar(req, 'ok', `Guardamos el plan "${datos.nombre}".`);
    res.redirect('/plataforma/planes');
  });

  // Segundo paso: se aplica lo confirmado. Todo se vuelve a validar y la lista de clientes se vuelve a leer de la base (lo que viene en el
  // formulario solo dice a quiénes se les mostró y a quiénes se los dejó marcados).
  router.post('/planes/:planId/confirmar', cargarPlan, verificarCsrf, async (req, res) => {
    const { datos, errores } = await validarPlan(db, req.plan.id, req.body);
    if (Object.keys(errores).length > 0) {
      avisar(req, 'error', 'Revisá los datos del plan: no se guardó nada.');
      return res.redirect(`/plataforma/planes/${req.plan.id}`);
    }
    const vistos = idsDe(req.body.visto);
    const aplicar = idsDe(req.body.aplicar);
    const sube = datos.precioCentavos > req.plan.precioCentavos;
    const clientes = await clientesDelPlan(db, req.plan.id);
    // Sacan del aumento a quienes se vieron en la pantalla, no tienen ya un precio fijo y se dejaron sin marcar. Un cliente que apareció después
    // (no se vio) recibe el aumento como todos.
    const mantener = new Set(sube ? clientes.filter((c) => c.precioFijo === null && vistos.has(c.id) && !aplicar.has(c.id)).map((c) => c.id) : []);
    const resultado = await aplicarCambioDePlan(
      { db, mp: servicios?.mp ?? null, avisar: notificar },
      req.plan.id,
      datos,
      { mantener, avisarPorMail: req.body.avisarPorMail === '1', urlBase: urlBase(req) },
    );
    const { tipo, texto } = resumenDeResultado(resultado, datos.nombre);
    avisar(req, tipo, texto);
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
