// Panel: pedidos que llegan desde la vidriera, y las formas de entrega y de pago del checkout.
import express from 'express';
import { verificarCsrf } from '../csrf.js';
import { leerAjustes, actualizarAjustes } from '../diseno.js';
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
  telefonoParaWhatsapp,
  direccionEnUnaLinea,
} from '../pedidos.js';
import { buscarTienda } from '../tiendas.js';
import { dominioDeTiendas, urlTienda } from '../util/dominios.js';
import { formatearFecha, formatearPrecio } from '../util/formato.js';

const id = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// El paso siguiente de un pedido, para el botón principal del detalle.
function siguientePaso(pedido) {
  const retiro = pedido.entrega.tipo === 'retiro';
  if (pedido.estado === 'nuevo' && pedido.pago !== 'efectivo') return { estado: 'pagado', texto: 'Marcar como pagado' };
  if (pedido.estado === 'nuevo' || pedido.estado === 'pagado') {
    return { estado: 'enviado', texto: retiro ? 'Marcar como listo para retirar' : 'Marcar como enviado' };
  }
  if (pedido.estado === 'enviado') return { estado: 'entregado', texto: retiro ? 'Marcar como retirado' : 'Marcar como entregado' };
  return null;
}

export function rutasAdminPedidos({ db, config }) {
  const router = express.Router();
  const avisar = (req, tipo, texto) => (req.session.aviso = { tipo, texto });

  // ---------- Pedidos ----------

  router.get('/pedidos', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const filtro = esFiltroPedidos(req.query.filtro) ? req.query.filtro : 'abiertos';
    const busqueda = String(req.query.q ?? '').slice(0, 100);
    const ajustes = await leerAjustes(db, tiendaId);
    res.render('admin/pedidos', {
      pedidos: (await listarPedidos(db, tiendaId, { filtro, busqueda })).map((p) => ({
        ...p,
        fecha: formatearFecha(p.creadoEn),
        tituloEstado: tituloEstado(p.estado, p.entrega.tipo),
      })),
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

  router.get('/pedidos/:pedidoId', cargarPedido, async (req, res) => {
    const { pedido } = req;
    const tienda = await buscarTienda(db, req.session.usuario.tiendaId);
    const urlCliente = `${urlTienda(req, dominioDeTiendas(config), tienda.slug)}/pedido/${pedido.token}`;
    const saludo = `¡Hola ${pedido.cliente.nombre.split(' ')[0]}! Te escribimos de ${tienda.nombre} por tu pedido #${pedido.numero}.`;
    res.render('admin/pedido', {
      pedido,
      fecha: formatearFecha(pedido.creadoEn),
      tituloEstado: tituloEstado(pedido.estado, pedido.entrega.tipo),
      direccion: direccionEnUnaLinea(pedido.direccion),
      siguiente: siguientePaso(pedido),
      estados: ['nuevo', 'pagado', 'enviado', 'entregado'].map((estado) => ({ estado, titulo: tituloEstado(estado, pedido.entrega.tipo) })),
      whatsappCliente: `https://wa.me/${telefonoParaWhatsapp(pedido.cliente.telefono)}?text=${encodeURIComponent(saludo)}`,
      urlCliente,
    });
  });

  router.post('/pedidos/:pedidoId/estado', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    if (await cambiarEstado(db, req.session.usuario.tiendaId, pedido.id, req.body.estado)) {
      avisar(req, 'ok', `El pedido #${pedido.numero} quedó como "${tituloEstado(req.body.estado, pedido.entrega.tipo)}".`);
    }
    res.redirect(`/admin/pedidos/${pedido.id}`);
  });

  router.post('/pedidos/:pedidoId/cancelar', cargarPedido, verificarCsrf, async (req, res) => {
    const { pedido } = req;
    if (await cancelarPedido(db, req.session.usuario.tiendaId, pedido.id)) {
      avisar(req, 'ok', `Cancelamos el pedido #${pedido.numero} y devolvimos los productos al stock.`);
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
      instruccionesMercadopago: instruccionesMercadopago({}),
    });
  }

  router.get('/pagos', (req, res) => mostrarPagos(req, res));

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
