// Panel: pedidos que llegan desde la vidriera, y las formas de entrega y de pago del checkout.
import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { verificarCsrf } from '../csrf.js';
import { leerAjustes, actualizarAjustes } from '../diseno.js';
import { IVA_BP, MAX_OTROS_BP, esPlazo, listaDePlazos, calcularComision, precioParaRecibir, tablaDeComisiones } from '../comisiones-mp.js';
import { sincronizarPedido, tituloPagoMp } from '../cobros-mp.js';
import { urlDeAutorizacion } from '../mercadopago-tiendas.js';
import { ErrorDeConexion, configMp, conectarConCodigo, conectarConToken, desconectar, leerConexion } from '../tienda-mercadopago.js';
import {
  TIPOS_ENTREGA,
  MODELOS_ENTREGA,
  MAX_METODOS_ENTREGA,
  validarPagos,
  listarMetodosEntrega,
  leerMetodoEntrega,
  formularioEntrega,
  validarMetodoEntrega,
  contarMetodosEntrega,
  crearMetodoEntrega,
  editarMetodoEntrega,
  activarMetodoEntrega,
  borrarMetodoEntrega,
  moverMetodoEntrega,
  estadoCheckout,
  textoCosto,
  instruccionesMercadopago,
} from '../pagos.js';
import {
  FILTROS_PEDIDOS,
  esFiltroPedidos,
  listarPedidos,
  contarPedidosPorFiltro,
  leerPedido,
  cambiarEstado,
  cancelarPedido,
  tituloEstado,
  tituloVisible,
  telefonoParaWhatsapp,
  direccionEnUnaLinea,
  siguientePaso,
  sePuedeCancelar,
} from '../pedidos.js';
import {
  ESTADOS_ENVIO,
  ORDEN_ENVIO,
  EMPRESAS_ENVIO,
  validarEnvio,
  actualizarEnvio,
  leerEventos,
  marcarEventoAvisado,
  guardarNotaInterna,
  mensajeDeEstado,
  avisoDePedido,
} from '../envios.js';
import { buscarTienda } from '../tiendas.js';
import { urlPanel, urlPublicaDeTienda } from '../util/dominios.js';
import { formatearFecha, formatearPrecio } from '../util/formato.js';
import { volverSeguro } from '../util/volver.js';

const id = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// notificar: el aviso por mail a n8n (notificaciones.js); sin N8N_WEBHOOK_URL no manda nada, pero siempre existe.
export function rutasAdminPedidos({ db, config, notificar = async () => false }) {
  const router = express.Router();
  const avisar = (req, tipo, texto) => (req.session.aviso = { tipo, texto });

  // ---------- Pedidos ----------

  router.get('/pedidos', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const filtro = esFiltroPedidos(req.query.filtro) ? req.query.filtro : 'abiertos';
    const busqueda = String(req.query.q ?? '').slice(0, 100);
    const ajustes = await leerAjustes(db, tiendaId);
    const tienda = await buscarTienda(db, tiendaId);
    res.render('admin/pedidos', {
      pedidos: (await listarPedidos(db, tiendaId, { filtro, busqueda })).map((p) => ({
        ...p,
        fecha: formatearFecha(p.creadoEn),
        tituloEstado: tituloVisible(p),
        // Lo que se puede hacer desde el menú de acciones de cada fila.
        siguiente: siguientePaso(p),
        cancelable: sePuedeCancelar(p),
        whatsapp: `https://wa.me/${telefonoParaWhatsapp(p.cliente.telefono)}?text=${encodeURIComponent(`¡Hola ${p.cliente.nombre.split(' ')[0]}! Te escribimos de ${tienda.nombre} por tu pedido #${p.numero}.`)}`,
      })),
      // De acá se vuelve después de una acción rápida: conserva el filtro y la búsqueda.
      volver: `/admin/pedidos?filtro=${filtro}${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ''}`,
      cuentas: await contarPedidosPorFiltro(db, tiendaId),
      filtros: FILTROS_PEDIDOS,
      filtro,
      busqueda,
      checkoutActivo: (await estadoCheckout(db, tiendaId, ajustes)).activo,
    });
  });

  const cargarPedido = async (req, res, next) => {
    const pedidoId = id(req.params.pedidoId);
    req.pedido = pedidoId === null ? null : await leerPedido(db, req.session.usuario.tiendaId, pedidoId);
    next(req.pedido ? undefined : 'route');
  };

  // Los datos de la tienda que necesitan los avisos al comprador (el mail y el mensaje de WhatsApp).
  async function datosDeAviso(req, pedido) {
    const { tiendaId } = req.session.usuario;
    const tienda = await buscarTienda(db, tiendaId);
    const ajustes = await leerAjustes(db, tiendaId);
    const urlBaseTienda = urlPublicaDeTienda(req, config, tienda);
    return { tienda, ajustes, urlBaseTienda, urlPedido: `${urlBaseTienda}/pedido/${pedido.token}` };
  }

  // Le pregunta a Mercado Pago cómo está el pago del pedido (por si el aviso no llegó o se quiere confirmar ya) y, si está aprobado, lo pasa a Pagado.
  router.post('/pedidos/:pedidoId/verificar-mp', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    const volver = `/admin/pedidos/${pedido.id}`;
    if (pedido.pago !== 'mercadopago') {
      avisar(req, 'error', 'Este pedido no se paga con Mercado Pago.');
      return res.redirect(volver);
    }
    const { tienda, urlBaseTienda } = await datosDeAviso(req, pedido);
    try {
      const resultado = await sincronizarPedido({
        db, config, notificar, tienda, pedido, urlBaseTienda, pagoId: pedido.mp.pagoId || null, esperaMs: 15_000,
      });
      if (resultado.sinConexion) avisar(req, 'error', 'No tenés Mercado Pago conectado: conectalo en "Envíos y pagos" para poder verificar los pagos.');
      else if (!resultado.estadoPago) avisar(req, 'info', 'Mercado Pago todavía no informa ningún pago de este pedido. Si el cliente ya pagó, puede tardar unos minutos en aparecer.');
      else if (resultado.pagadoAhora) avisar(req, 'ok', `Mercado Pago confirma el pago: el pedido #${pedido.numero} quedó como "Pagado".${resultado.mailEnviado ? ' Le avisamos por mail.' : ''}`);
      else avisar(req, 'ok', `Mercado Pago informa el pago como "${tituloPagoMp(resultado.estadoPago)}".`);
    } catch (error) {
      console.error(`Mercado Pago: no se pudo verificar el pago del pedido ${pedido.id}:`, error.status ?? '', error.message);
      avisar(req, 'error', 'No pudimos consultar a Mercado Pago ahora. Probá de nuevo en un rato.');
    }
    res.redirect(volver);
  });

  // Le manda al comprador (por n8n) un mail con el estado actual de su pedido. Devuelve true si salió; false si no tiene email o no se pudo.
  async function mandarMail(req, pedido) {
    if (!pedido.cliente.email) return false;
    const { tienda, ajustes, urlBaseTienda, urlPedido } = await datosDeAviso(req, pedido);
    return notificar(
      'pedido_actualizado',
      avisoDePedido(pedido, {
        tienda: tienda.nombre,
        urlTienda: urlBaseTienda,
        emailTienda: ajustes.emailContacto,
        whatsappTienda: ajustes.whatsapp ? `https://wa.me/${ajustes.whatsapp}` : '',
        urlPedido,
        direccionTienda: ajustes.direccion,
      }),
    );
  }

  // " Le avisamos por mail." / un aviso de por qué no salió. `quiere`: si se pidió avisar.
  const textoDelMail = (quiere, pedido, enviado) => {
    if (!quiere) return '';
    if (!pedido.cliente.email) return ' No dejó su email: avisale por WhatsApp.';
    return enviado ? ' Le avisamos por mail.' : ' No pudimos mandarle el mail (revisá que el flujo de n8n esté activo): avisale por WhatsApp.';
  };

  // El detalle de un pedido. `errores` y `valores` son los del formulario del envío cuando se vuelve con algo para corregir.
  async function mostrarPedido(req, res, { errores = {}, valores = null, status = 200 } = {}) {
    const { pedido } = req;
    const { tienda, ajustes, urlPedido } = await datosDeAviso(req, pedido);
    const siguiente = siguientePaso(pedido);
    const guardada = pedido.despacho.empresa;
    const preset = Object.entries(EMPRESAS_ENVIO).find(([, e]) => e.nombre === guardada)?.[0] ?? null;
    const puedeAvisarEmail = Boolean(pedido.cliente.email);
    res.status(status).render('admin/pedido', {
      pedido,
      fecha: formatearFecha(pedido.creadoEn),
      tituloEstado: tituloVisible(pedido),
      direccion: direccionEnUnaLinea(pedido.direccion),
      siguiente,
      estados: ['nuevo', 'pagado', 'enviado', 'entregado'].map((estado) => ({ estado, titulo: tituloEstado(estado, pedido.entrega.tipo) })),
      // El mensaje de WhatsApp es el del estado en el que está el pedido: si ya se despachó, lleva el seguimiento.
      whatsappCliente: `https://wa.me/${telefonoParaWhatsapp(pedido.cliente.telefono)}?text=${encodeURIComponent(
        pedido.estado === 'nuevo'
          ? `¡Hola ${pedido.cliente.nombre.split(' ')[0]}! Te escribimos de ${tienda.nombre} por tu pedido #${pedido.numero}.`
          : mensajeDeEstado(pedido, { tienda: tienda.nombre, urlPedido, direccionTienda: ajustes.direccion }),
      )}`,
      urlCliente: urlPedido,
      // El envío (solo en los pedidos a domicilio que siguen abiertos): los pasos, las empresas y lo que muestra el formulario.
      envio: pedido.entrega.tipo === 'domicilio' && pedido.estado !== 'cancelado'
        ? {
            estados: ESTADOS_ENVIO,
            orden: ORDEN_ENVIO,
            empresas: EMPRESAS_ENVIO,
            errores,
            valores: valores ?? {
              // El paso de ahora (así guardar un número de seguimiento no mueve el pedido). Solo cuando lo que sigue pide cargar esos datos
              // (despachar), viene marcado ese paso: es a lo que se llega con "Marcar como despachado…".
              estado: siguiente?.ancla ? siguiente.envio : (pedido.despacho.estado ?? 'preparacion'),
              empresa: preset ?? (guardada ? 'otra' : ''),
              empresaOtra: preset || !guardada ? '' : guardada,
              seguimiento: pedido.despacho.seguimiento,
              enlace: pedido.despacho.enlace,
              detalle: pedido.despacho.detalle,
              avisarEmail: ajustes.avisosPedidoEmail && puedeAvisarEmail ? '1' : '',
            },
          }
        : null,
      eventos: (await leerEventos(db, pedido.id)).map((e) => ({ ...e, fecha: formatearFecha(e.creadoEn) })),
      puedeAvisarEmail,
      correoActivo: Boolean(config.n8n),
      avisosAutomaticos: ajustes.avisosPedidoEmail,
      // Con la cuenta de Mercado Pago conectada, el pedido pasa a Pagado solo cuando el cliente paga (y se puede verificar a mano).
      mpConectado: Boolean(await leerConexion(db, req.session.usuario.tiendaId)),
      tituloPagoMp,
    });
  }

  router.get('/pedidos/:pedidoId', cargarPedido, (req, res) => mostrarPedido(req, res));

  router.post('/pedidos/:pedidoId/estado', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    const { tiendaId } = req.session.usuario;
    const resultado = await cambiarEstado(db, tiendaId, pedido.id, req.body.estado);
    if (resultado) {
      // Con "avisar por mail cuando cambia el estado" activo en la tienda, cada avance le llega al comprador (una corrección hacia atrás, no).
      let mail = '';
      const { ajustes } = await datosDeAviso(req, pedido);
      if (ajustes.avisosPedidoEmail && resultado.cambio && !resultado.cambio.retroceso) {
        const actualizado = await leerPedido(db, tiendaId, pedido.id);
        const enviado = await mandarMail(req, actualizado);
        if (enviado) await marcarEventoAvisado(db, resultado.cambio.id);
        mail = textoDelMail(true, actualizado, enviado);
      }
      avisar(req, 'ok', `El pedido #${pedido.numero} quedó como "${tituloEstado(req.body.estado, pedido.entrega.tipo)}".${mail}`);
    }
    // Desde la lista se vuelve a la lista (con su filtro y su búsqueda); desde el detalle, al detalle.
    res.redirect(volverSeguro(req.body.volver, `/admin/pedidos/${pedido.id}`));
  });

  // El paso del envío de un pedido a domicilio: lo cambia, guarda la empresa, el número y el link si se mandan, y le avisa al comprador si se pidió.
  // Los botones de un clic mandan solo el paso; el formulario de la tarjeta del envío manda todo (y `completo`).
  router.post('/pedidos/:pedidoId/envio', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    const { tiendaId } = req.session.usuario;
    const volver = volverSeguro(req.body.volver, `/admin/pedidos/${pedido.id}`);
    if (pedido.entrega.tipo !== 'domicilio' || pedido.estado === 'cancelado') {
      avisar(req, 'error', 'Este pedido no tiene un envío para actualizar.');
      return res.redirect(volver);
    }
    const { datos, errores } = validarEnvio(req.body);
    if (Object.keys(errores).length > 0) return mostrarPedido(req, res, { errores, valores: req.body, status: 400 });

    const resultado = await actualizarEnvio(db, tiendaId, pedido.id, datos);
    if (!resultado) {
      avisar(req, 'error', 'No se pudo actualizar el envío de este pedido.');
      return res.redirect(volver);
    }
    const { ajustes } = await datosDeAviso(req, pedido);
    // Con el formulario completo manda la casilla; con un botón de un clic, lo que la tienda tenga configurado. Una corrección no se avisa.
    const quiere = !resultado.retroceso && (req.body.completo === '1' ? datos.avisarEmail : ajustes.avisosPedidoEmail);
    let enviado = false;
    const actualizado = await leerPedido(db, tiendaId, pedido.id);
    if (quiere && actualizado.cliente.email) {
      enviado = await mandarMail(req, actualizado);
      if (enviado) await marcarEventoAvisado(db, resultado.evento.id);
    }
    avisar(req, 'ok', `El envío del pedido #${pedido.numero} quedó como "${ESTADOS_ENVIO[datos.estado].titulo}".${textoDelMail(quiere, actualizado, enviado)}`);
    res.redirect(volver);
  });

  // Vuelve a mandarle al comprador el mail con el estado actual de su pedido (por si no le llegó, o para recordárselo).
  router.post('/pedidos/:pedidoId/avisar-email', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    const enviado = await mandarMail(req, pedido);
    if (enviado) {
      const ultimo = (await leerEventos(db, pedido.id)).findLast((e) => e.visible);
      if (ultimo) await marcarEventoAvisado(db, ultimo.id);
    }
    avisar(req, enviado ? 'ok' : 'error', enviado ? `Le mandamos a ${pedido.cliente.email} el estado de su pedido.` : textoDelMail(true, pedido, false).trim());
    res.redirect(`/admin/pedidos/${pedido.id}`);
  });

  router.post('/pedidos/:pedidoId/nota', cargarPedido, verificarCsrf, async (req, res) => {
    await guardarNotaInterna(db, req.session.usuario.tiendaId, req.pedido.id, req.body.nota);
    avisar(req, 'ok', 'Guardamos la nota. Solo la ves vos.');
    res.redirect(`/admin/pedidos/${req.pedido.id}#nota`);
  });

  // Para imprimir: el remito del pedido (dirección, productos y bultos) en una hoja lista para pegar en el paquete.
  router.get('/pedidos/:pedidoId/imprimir', cargarPedido, async (req, res) => {
    const { pedido } = req;
    const tienda = await buscarTienda(db, req.session.usuario.tiendaId);
    const ajustes = await leerAjustes(db, req.session.usuario.tiendaId);
    res.set('Cache-Control', 'no-store').render('admin/pedido-imprimir', {
      pedido,
      tienda,
      ajustes,
      fecha: formatearFecha(pedido.creadoEn),
      tituloEstado: tituloVisible(pedido),
      direccion: direccionEnUnaLinea(pedido.direccion),
    });
  });

  router.post('/pedidos/:pedidoId/cancelar', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    const { tiendaId } = req.session.usuario;
    if (await cancelarPedido(db, tiendaId, pedido.id)) {
      // Con los avisos por mail activos, también se le cuenta al comprador.
      let mail = '';
      const { ajustes } = await datosDeAviso(req, pedido);
      if (ajustes.avisosPedidoEmail && pedido.cliente.email) {
        const actualizado = await leerPedido(db, tiendaId, pedido.id);
        mail = textoDelMail(true, actualizado, await mandarMail(req, actualizado));
      }
      avisar(req, 'ok', `Cancelamos el pedido #${pedido.numero} y devolvimos los productos al stock.${mail}`);
    }
    res.redirect(`/admin/pedidos/${pedido.id}`);
  });

  // ---------- Envíos y pagos ----------

  async function mostrarPagos(req, res, { valores = null, errores = {}, status = 200 } = {}) {
    const { tiendaId } = req.session.usuario;
    const ajustes = await leerAjustes(db, tiendaId);
    const checkout = await estadoCheckout(db, tiendaId, ajustes);
    res.status(status).render('admin/pagos', {
      valores: valores ?? ajustes,
      errores,
      entregas: (await listarMetodosEntrega(db, tiendaId)).map((e) => ({
        ...e,
        textoCosto: textoCosto(e),
        textoGratis: e.gratisDesde === null ? null : `gratis desde ${formatearPrecio(e.gratisDesde)}`,
      })),
      tipos: TIPOS_ENTREGA,
      modelos: MODELOS_ENTREGA,
      maxEntregas: MAX_METODOS_ENTREGA,
      checkout,
      avisosPedidoEmail: ajustes.avisosPedidoEmail,
      correoActivo: Boolean(config.n8n),
      instruccionesMercadopago: instruccionesMercadopago({}),
      mercadopago: await datosMercadoPago(tiendaId, ajustes),
    });
  }

  // La sección de Mercado Pago del panel: la conexión y la calculadora de comisiones (arranca con $50.000, ya calculada con lo que la tienda guardó).
  const PRECIO_DE_EJEMPLO = 5_000_000;
  async function datosMercadoPago(tiendaId, ajustes) {
    const opciones = { plazo: ajustes.mpPlazo, otrosBp: ajustes.mpOtrosBp };
    return {
      conexion: await leerConexion(db, tiendaId),
      oauth: configMp(config).oauth,
      plazo: ajustes.mpPlazo,
      otrosPorcentaje: String(ajustes.mpOtrosBp / 100).replace('.', ','),
      plazos: listaDePlazos(),
      ivaBp: IVA_BP,
      ejemplo: {
        precio: PRECIO_DE_EJEMPLO,
        porVenta: calcularComision(PRECIO_DE_EJEMPLO, opciones),
        precioNecesario: precioParaRecibir(PRECIO_DE_EJEMPLO, opciones),
        tabla: tablaDeComisiones(PRECIO_DE_EJEMPLO, { otrosBp: ajustes.mpOtrosBp }),
      },
    };
  }

  router.get('/pagos', (req, res) => mostrarPagos(req, res));

  // Avisos al comprador: si cada cambio de estado de un pedido le llega por mail (aparte, siempre se le puede avisar pedido por pedido).
  router.post('/pagos/avisos', verificarCsrf, async (req, res) => {
    const activo = req.body.avisosPedidoEmail === '1';
    await actualizarAjustes(db, req.session.usuario.tiendaId, { avisosPedidoEmail: activo });
    avisar(req, 'ok', activo ? 'Listo: cada cambio de estado de un pedido le llega al comprador por mail (si dejó su email).' : 'Listo: ya no se manda un mail en cada cambio. Igual podés avisar pedido por pedido.');
    res.redirect('/admin/pagos#avisos');
  });

  router.post('/pagos', verificarCsrf, async (req, res) => {
    const { ajustes, errores } = validarPagos(req.body);
    if (Object.keys(errores).length > 0) {
      // Los interruptores vienen como "1" o no vienen: se pasan a booleanos para volver a mostrarlos.
      const valores = { ...req.body, ...ajustes };
      return mostrarPagos(req, res, { valores, errores, status: 400 });
    }
    await actualizarAjustes(db, req.session.usuario.tiendaId, ajustes);
    avisar(req, 'ok', 'Guardamos las formas de pago.');
    res.redirect('/admin/pagos#formas-de-pago');
  });

  // ---------- Mercado Pago: conectar la cuenta y calcular comisiones ----------
  // Con la cuenta conectada, el comprador paga en Mercado Pago en el momento y el pedido pasa a Pagado solo (ver cobros-mp.js). Sin conectarla, todo
  // sigue como antes: la tienda le manda el link de pago a mano.

  const volverAMercadoPago = (req, res, tipo, texto) => {
    avisar(req, tipo, texto);
    res.redirect('/admin/pagos#mercadopago');
  };
  // A donde Mercado Pago devuelve a la tienda después de autorizar. Tiene que ser exactamente la que está cargada en la aplicación de Mercado Pago Developers.
  const urlVueltaOAuth = (req) => `${urlPanel(req, config.dominio)}/admin/pagos/mercadopago/volver`;
  const VALIDEZ_AUTORIZACION_MS = 15 * 60 * 1000;

  // Cuando se conecta, avisa si falta algo para que los clientes puedan pagar así.
  async function textoConectada(tiendaId, conexion) {
    const cuenta = conexion.apodo ? ` (${conexion.apodo})` : '';
    const ajustes = await leerAjustes(db, tiendaId);
    return `Conectamos tu cuenta de Mercado Pago${cuenta}.${ajustes.pagoMercadopago ? ' Desde ahora tus clientes pagan en el momento.' : ' Activá "Mercado Pago" en las formas de pago para que tus clientes puedan pagar así.'}`;
  }

  // Lleva a la tienda a autorizar la conexión en Mercado Pago. El `estado` queda en la sesión y se compara al volver: así nadie puede conectarle a
  // una tienda una cuenta que no eligió, con un link armado.
  router.get('/pagos/mercadopago/conectar', (req, res) => {
    const mp = configMp(config);
    if (!mp.oauth) return volverAMercadoPago(req, res, 'error', 'El botón de conexión todavía no está activado en la plataforma. Pegá tu Access Token.');
    const estado = randomBytes(24).toString('base64url');
    req.session.mpOauth = { estado, tiendaId: req.session.usuario.tiendaId, creado: Date.now() };
    res.redirect(urlDeAutorizacion({ authUrl: mp.authUrl, clientId: mp.clientId, urlVuelta: urlVueltaOAuth(req), estado }));
  });

  router.get('/pagos/mercadopago/volver', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const guardado = req.session.mpOauth;
    delete req.session.mpOauth; // se usa una sola vez
    if (req.query.error) return volverAMercadoPago(req, res, 'error', 'No se conectó Mercado Pago: no diste el permiso o Mercado Pago lo rechazó. Podés intentar de nuevo.');
    const recibido = Buffer.from(String(req.query.state ?? ''));
    const esperado = Buffer.from(guardado?.estado ?? '');
    const valido = guardado && guardado.tiendaId === tiendaId && Date.now() - guardado.creado < VALIDEZ_AUTORIZACION_MS
      && recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
    const codigo = String(req.query.code ?? '');
    if (!valido || !/^[\w-]{6,300}$/.test(codigo)) {
      return volverAMercadoPago(req, res, 'error', 'El enlace de conexión venció o no es válido. Tocá "Conectar con Mercado Pago" de nuevo.');
    }
    try {
      const conexion = await conectarConCodigo(db, tiendaId, codigo, { config, secreto: config.secretoSesion, urlVuelta: urlVueltaOAuth(req) });
      volverAMercadoPago(req, res, 'ok', await textoConectada(tiendaId, conexion));
    } catch (error) {
      if (!(error instanceof ErrorDeConexion)) throw error;
      volverAMercadoPago(req, res, 'error', error.message);
    }
  });

  // La otra forma de conectar: pegar el Access Token. Se comprueba con Mercado Pago, se guarda cifrado y no se vuelve a mostrar.
  router.post('/pagos/mercadopago/token', verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    try {
      const conexion = await conectarConToken(db, tiendaId, req.body.accessToken, { config, secreto: config.secretoSesion });
      volverAMercadoPago(req, res, 'ok', await textoConectada(tiendaId, conexion));
    } catch (error) {
      if (!(error instanceof ErrorDeConexion)) throw error;
      volverAMercadoPago(req, res, 'error', error.message);
    }
  });

  router.post('/pagos/mercadopago/desconectar', verificarCsrf, async (req, res) => {
    await desconectar(db, req.session.usuario.tiendaId);
    volverAMercadoPago(req, res, 'ok', 'Desconectamos tu cuenta de Mercado Pago. Los pedidos nuevos vuelven a cobrarse con el link de pago que mandás a mano.');
  });

  // Lo que la tienda quiere considerar en la calculadora: cuándo cobra la plata y otros costos (en %). No cambia nada de lo que cobra Mercado Pago.
  router.post('/pagos/comisiones', verificarCsrf, async (req, res) => {
    const plazo = String(req.body.mpPlazo ?? '');
    const otros = String(req.body.mpOtros ?? '').trim().replace(',', '.');
    const porcentaje = otros === '' ? 0 : Number(otros);
    if (!esPlazo(plazo) || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje * 100 > MAX_OTROS_BP) {
      return volverAMercadoPago(req, res, 'error', `Revisá los datos de la calculadora: elegí cuándo cobrás y poné los otros costos como un porcentaje entre 0 y ${MAX_OTROS_BP / 100}.`);
    }
    await actualizarAjustes(db, req.session.usuario.tiendaId, { mpPlazo: plazo, mpOtrosBp: Math.round(porcentaje * 100) });
    volverAMercadoPago(req, res, 'ok', 'Guardamos los datos de la calculadora.');
  });

  function mostrarEntrega(req, res, { metodo = null, formulario, errores = {}, status = 200 }) {
    res.status(status).render('admin/entrega', { metodo, formulario, errores, tipos: TIPOS_ENTREGA });
  }

  router.get('/pagos/entregas/nueva', async (req, res) => {
    const clave = String(req.query.modelo);
    const modelo = Object.hasOwn(MODELOS_ENTREGA, clave) ? { ...MODELOS_ENTREGA[clave] } : null;
    // El retiro se arma con la dirección que ya cargó la tienda, si la tiene.
    if (modelo?.tipo === 'retiro') {
      const { direccion } = await leerAjustes(db, req.session.usuario.tiendaId);
      if (direccion) modelo.descripcion = `${direccion}. ${modelo.descripcion}`;
    }
    mostrarEntrega(req, res, { formulario: formularioEntrega(modelo) });
  });

  router.post('/pagos/entregas/nueva', verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, formulario, errores } = validarMetodoEntrega(req.body);
    if ((await contarMetodosEntrega(db, tiendaId)) >= MAX_METODOS_ENTREGA) {
      errores.nombre = `Podés tener hasta ${MAX_METODOS_ENTREGA} formas de entrega. Borrá alguna para agregar otra.`;
    }
    if (Object.keys(errores).length > 0) return mostrarEntrega(req, res, { formulario, errores, status: 400 });
    await crearMetodoEntrega(db, tiendaId, datos);
    avisar(req, 'ok', `Agregamos "${datos.nombre}".`);
    res.redirect('/admin/pagos');
  });

  const cargarEntrega = async (req, res, next) => {
    const entregaId = id(req.params.entregaId);
    req.metodo = entregaId === null ? null : await leerMetodoEntrega(db, req.session.usuario.tiendaId, entregaId);
    next(req.metodo ? undefined : 'route');
  };

  router.get('/pagos/entregas/:entregaId', cargarEntrega, (req, res) => {
    mostrarEntrega(req, res, { metodo: req.metodo, formulario: formularioEntrega(req.metodo) });
  });

  router.post('/pagos/entregas/:entregaId', cargarEntrega, verificarCsrf, async (req, res) => {
    const { datos, formulario, errores } = validarMetodoEntrega(req.body);
    if (Object.keys(errores).length > 0) return mostrarEntrega(req, res, { metodo: req.metodo, formulario, errores, status: 400 });
    await editarMetodoEntrega(db, req.session.usuario.tiendaId, req.metodo.id, datos);
    avisar(req, 'ok', `Guardamos "${datos.nombre}".`);
    res.redirect('/admin/pagos');
  });

  router.post('/pagos/entregas/:entregaId/:accion', cargarEntrega, verificarCsrf, async (req, res, next) => {
    const { tiendaId } = req.session.usuario;
    const { metodo } = req;
    switch (req.params.accion) {
      case 'activar':
        await activarMetodoEntrega(db, tiendaId, metodo.id, req.body.valor === '1');
        avisar(req, 'ok', req.body.valor === '1' ? `"${metodo.nombre}" ya se ofrece en la tienda.` : `"${metodo.nombre}" quedó pausada.`);
        break;
      case 'subir':
      case 'bajar':
        await moverMetodoEntrega(db, tiendaId, metodo.id, req.params.accion === 'subir' ? -1 : 1);
        break;
      case 'borrar':
        await borrarMetodoEntrega(db, tiendaId, metodo.id);
        avisar(req, 'ok', `Borramos "${metodo.nombre}". Los pedidos que ya la usaron no cambian.`);
        break;
      default:
        return next();
    }
    res.redirect('/admin/pagos');
  });

  return router;
}
