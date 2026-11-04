import express from 'express';
import {
  arbolCategorias,
  buscarCategoria,
  productosVisibles,
  contarVisibles,
  rangoDePrecios,
  productosRelacionados,
  productoVisible,
  variantesParaCarrito,
  ORDENES,
  esOrden,
} from '../vidriera.js';
import { leerAjustes, listarBanners, colorDeTextoSobre, precioConDescuento, valorCuota } from '../diseno.js';
import { urlImagen } from '../imagenes.js';
import { formatearPrecio } from '../util/formato.js';
import { urlPanel } from '../util/dominios.js';
import { crearLimite } from '../util/limite.js';
import { estadoCheckout, textoCosto, instruccionesMercadopago } from '../pagos.js';
import {
  leerItems,
  lineasDelCarrito,
  subtotalDe,
  calcularTotales,
  costoEnvio,
  validarCheckout,
  crearPedido,
  ErrorDeStock,
  leerPedidoPorToken,
  tituloEstado,
  direccionEnUnaLinea,
  resumenEnTexto,
  PROVINCIAS,
} from '../pedidos.js';

const POCAS_UNIDADES = 3;
const MAX_DESTACADOS = 8;
const POR_PAGINA = 24;
const MAX_SUGERENCIAS = 6;
const MAX_EN_CARRITO = 50;

export function estadoStock(stock) {
  if (stock <= 0) return { texto: 'Sin stock', clase: 'sin-stock' };
  if (stock <= POCAS_UNIDADES) return { texto: stock === 1 ? '¡Última unidad!' : `¡Últimas ${stock} unidades!`, clase: 'pocas' };
  return { texto: 'En stock', clase: 'en-stock' };
}

const urlCategoria = (categoria) => `/categoria/${categoria.ruta.join('/')}`;

function indexarCategorias(arbol, indice = new Map()) {
  for (const categoria of arbol) {
    indice.set(categoria.id, categoria);
    indexarCategorias(categoria.hijas, indice);
  }
  return indice;
}

// Precio con transferencia y cuotas de un precio final, según los ajustes de la tienda (null si no aplican).
// Solo se muestran si la tienda ofrece esa forma de pago: las cuotas son con Mercado Pago.
function preciosExtra(centavos, ajustes) {
  return {
    transferencia: ajustes.pagoTransferencia && ajustes.descuentoTransferencia
      ? formatearPrecio(precioConDescuento(centavos, ajustes.descuentoTransferencia))
      : null,
    cuota: ajustes.pagoMercadopago && ajustes.cuotasSinInteres ? formatearPrecio(valorCuota(centavos, ajustes.cuotasSinInteres)) : null,
  };
}

// Pedidos que se pueden hacer desde una misma IP por hora (frena a quien quiera reservar todo el stock).
const PEDIDOS_POR_HORA = 10;

// "-20%" de un precio promocional sobre el de lista (null si no hay promoción).
export const porcentajeOff = (precioLista, precioFinal) =>
  precioFinal < precioLista ? Math.round((1 - precioFinal / precioLista) * 100) : null;

const enlaceWhatsapp = (numero, texto) => (numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null);

// Todo lo que muestra la ficha para una variante, con los precios ya formateados.
// Se usa para el primer render y, como JSON, para el script que cambia de variante.
function datosVariante(variante, producto, ajustes) {
  const final = variante.precioPromocional ?? variante.precio;
  const detalle = producto.atributos.map((atributo, n) => `${atributo} ${variante.valores[n]}`).join(', ');
  const nombre = `${producto.nombre}${detalle ? ` (${detalle})` : ''}`;
  return {
    valores: variante.valores,
    sku: variante.sku,
    precio: formatearPrecio(final),
    precioLista: variante.precioPromocional === null ? null : formatearPrecio(variante.precio),
    off: porcentajeOff(variante.precio, final),
    ...preciosExtra(final, ajustes),
    hayStock: variante.stock > 0,
    disponibles: Math.min(variante.stock, MAX_EN_CARRITO),
    stock: estadoStock(variante.stock),
    whatsapp: enlaceWhatsapp(ajustes.whatsapp, `¡Hola! Quiero consultar por ${nombre}. SKU ${variante.sku}`),
    avisame: enlaceWhatsapp(ajustes.whatsapp, `¡Hola! ¿Me avisan cuando vuelva a haber stock de ${nombre}? SKU ${variante.sku}`),
  };
}

// El orden que eligió el visitante, o el que configuró la tienda.
const ordenElegido = (req, ajustes) => (esOrden(req.query.orden) ? req.query.orden : ajustes.ordenCatalogo);

// JSON seguro para meter dentro de <script>.
const jsonEnScript = (valor) => JSON.stringify(valor).replace(/</g, '\\u003c');

// "15000" -> 1500000 centavos. Solo pesos enteros: es lo que escribe el visitante en el filtro.
const pesosACentavos = (valor) => (/^\d{1,9}$/.test(String(valor ?? '').trim()) ? Number(valor) * 100 : null);

// Filtros del catálogo que vienen en la URL.
function filtrosDe(query) {
  return {
    conStock: query.stock === '1',
    enOferta: query.oferta === '1',
    precioMin: pesosACentavos(query.min),
    precioMax: pesosACentavos(query.max),
  };
}

// La misma URL con algunos parámetros cambiados (null los saca).
function conParametros(req, cambios) {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(req.query)) if (typeof valor === 'string' && valor) parametros.set(clave, valor);
  for (const [clave, valor] of Object.entries(cambios)) {
    if (valor === null) parametros.delete(clave);
    else parametros.set(clave, valor);
  }
  const texto = parametros.toString();
  return `${req.path}${texto ? `?${texto}` : ''}`;
}

// Vidriera de una tienda. Se monta solo cuando el host es el subdominio de una tienda (req.tienda).
export function rutasTienda({ db, config }) {
  const router = express.Router();
  const limitePedidos = crearLimite({ maximo: PEDIDOS_POR_HORA, ventanaMs: 60 * 60 * 1000 });

  router.use((req, res, next) => {
    const arbol = arbolCategorias(db, req.tienda.id);
    const ajustes = leerAjustes(db, req.tienda.id);
    const checkout = estadoCheckout(db, req.tienda.id, ajustes);
    const origen = `${req.protocol}://${req.host}`;
    Object.assign(res.locals, {
      tienda: req.tienda,
      categorias: arbol,
      ajustes,
      origen,
      urlActual: `${origen}${req.path}`,
      urlLogo: urlImagen(req.tienda.id, ajustes.logo),
      colorTexto: colorDeTextoSobre(ajustes.colorPrincipal),
      urlCategoria,
      estadoStock,
      porcentajeOff,
      preciosExtra: (centavos) => preciosExtra(centavos, ajustes),
      meta: { descripcion: `Comprá online en ${req.tienda.nombre}.`, imagen: null, tipo: 'website' },
      busqueda: '',
      // Con checkout el carrito termina en /checkout; si no, el pedido se manda por WhatsApp.
      checkoutActivo: checkout.activo,
      noIndexar: false,
    });
    req.arbol = arbol;
    req.ajustes = ajustes;
    req.checkout = checkout;
    next();
  });

  // El panel vive en el dominio principal, para que la sesión sea una sola.
  router.use('/admin', (req, res) => res.redirect(`${urlPanel(req, config.dominio)}/admin`));

  const conFotos = (tiendaId, productos) =>
    productos.map((p) => ({ ...p, urlFoto: urlImagen(tiendaId, p.foto), urlFotoAlternativa: urlImagen(tiendaId, p.fotoAlternativa) }));

  // Una página del catálogo con filtros, orden y paginación. `base` son los filtros fijos (categoría o búsqueda).
  function listado(req, base) {
    const tiendaId = req.tienda.id;
    const orden = ordenElegido(req, req.ajustes);
    const filtros = filtrosDe(req.query);
    const opciones = { ...base, ...filtros };
    const total = contarVisibles(db, tiendaId, opciones);
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    const pagina = Math.min(paginas, Math.max(1, Number.parseInt(req.query.pagina, 10) || 1));
    const rango = rangoDePrecios(db, tiendaId);
    const activos = [
      filtros.conStock && { texto: 'Con stock', url: conParametros(req, { stock: null, pagina: null }) },
      filtros.enOferta && { texto: 'En oferta', url: conParametros(req, { oferta: null, pagina: null }) },
      filtros.precioMin !== null && { texto: `Desde ${formatearPrecio(filtros.precioMin)}`, url: conParametros(req, { min: null, pagina: null }) },
      filtros.precioMax !== null && { texto: `Hasta ${formatearPrecio(filtros.precioMax)}`, url: conParametros(req, { max: null, pagina: null }) },
    ].filter(Boolean);
    return {
      productos: conFotos(tiendaId, productosVisibles(db, tiendaId, { ...opciones, orden, limite: POR_PAGINA, desde: (pagina - 1) * POR_PAGINA })),
      total,
      pagina,
      paginas,
      mostrados: Math.min(total, pagina * POR_PAGINA),
      urlSiguiente: pagina < paginas ? conParametros(req, { pagina: String(pagina + 1) }) : null,
      filtros: {
        ...filtros,
        min: filtros.precioMin === null ? '' : filtros.precioMin / 100,
        max: filtros.precioMax === null ? '' : filtros.precioMax / 100,
        activos,
        urlLimpiar: conParametros(req, { stock: null, oferta: null, min: null, max: null, pagina: null }),
        rango: { minimo: Math.floor((rango.minimo ?? 0) / 100), maximo: Math.ceil((rango.maximo ?? 0) / 100) },
      },
      ordenes: ORDENES,
      orden,
      hayFiltros: activos.length > 0,
    };
  }

  router.get('/', (req, res) => {
    const datos = listado(req, {});
    // Los destacados y los banners van arriba solo en la primera vista de la portada, sin filtros ni orden elegido.
    const portada = !req.query.orden && !datos.hayFiltros && datos.pagina === 1;
    const banners = portada
      ? listarBanners(db, req.tienda.id).map((b) => ({
          ...b,
          urlImagen: urlImagen(req.tienda.id, b.imagen),
          urlImagenMovil: urlImagen(req.tienda.id, b.imagenMovil),
        }))
      : [];
    const destacados = portada
      ? productosVisibles(db, req.tienda.id, { soloDestacados: true, orden: req.ajustes.ordenCatalogo, limite: MAX_DESTACADOS })
      : [];
    res.locals.meta.imagen = banners[0]?.urlImagen ?? res.locals.urlLogo;
    res.render('tienda/catalogo', {
      titulo: req.tienda.nombre,
      migas: [],
      subcategorias: req.arbol,
      banners,
      destacados: conFotos(req.tienda.id, destacados),
      ...datos,
    });
  });

  router.get('/categoria/*ruta', (req, res, next) => {
    const encontrada = buscarCategoria(req.arbol, req.params.ruta);
    if (!encontrada) return next();
    const { categoria, migas } = encontrada;
    res.locals.meta.descripcion = `${categoria.nombre} en ${req.tienda.nombre}. Comprá online.`;
    res.render('tienda/catalogo', {
      titulo: categoria.nombre,
      migas,
      subcategorias: categoria.hijas,
      banners: [],
      destacados: [],
      ...listado(req, { categoriaId: categoria.id }),
    });
  });

  router.get('/buscar', (req, res) => {
    const busqueda = String(req.query.q ?? '').trim().slice(0, 80);
    res.locals.busqueda = busqueda;
    const datos = listado(req, { busqueda });
    // Sin nada escrito no se muestra todo el catálogo: solo el buscador y las categorías para empezar.
    if (!busqueda) Object.assign(datos, { productos: [], total: 0, mostrados: 0, urlSiguiente: null });
    res.render('tienda/catalogo', {
      titulo: busqueda ? `Resultados para "${busqueda}"` : 'Buscar',
      migas: [],
      subcategorias: [],
      banners: [],
      destacados: [],
      ...datos,
      paginaBusqueda: true,
    });
  });

  // Sugerencias del buscador mientras se escribe.
  router.get('/api/buscar', (req, res) => {
    const busqueda = String(req.query.q ?? '').trim().slice(0, 80);
    if (busqueda.length < 2) return res.json({ total: 0, productos: [] });
    const opciones = { busqueda };
    const productos = productosVisibles(db, req.tienda.id, { ...opciones, orden: 'nombre', limite: MAX_SUGERENCIAS });
    res.json({
      total: contarVisibles(db, req.tienda.id, opciones),
      productos: productos.map((p) => ({
        nombre: p.nombre,
        url: `/producto/${p.slug}`,
        precio: `${p.precioHasta !== p.precioDesde ? 'Desde ' : ''}${formatearPrecio(p.precioDesde)}`,
        foto: urlImagen(req.tienda.id, p.foto),
      })),
    });
  });

  // Precios y stock actuales de lo que hay en el carrito (el carrito vive en el navegador).
  router.get('/api/carrito', (req, res) => {
    const skus = [...new Set(String(req.query.skus ?? '').split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_EN_CARRITO);
    res.json({
      variantes: variantesParaCarrito(db, req.tienda.id, skus).map((v) => ({
        ...v,
        foto: urlImagen(req.tienda.id, v.foto),
        url: `/producto/${v.slug}`,
        disponibles: Math.min(v.stock, MAX_EN_CARRITO),
      })),
    });
  });

  router.get('/producto/:slug', (req, res, next) => {
    const producto = productoVisible(db, req.tienda.id, req.params.slug);
    if (!producto) return next();
    const indice = indexarCategorias(req.arbol);
    const variantes = producto.variantes.map((v) => datosVariante(v, producto, req.ajustes));
    const inicial = variantes.find((v) => v.hayStock) ?? variantes[0];
    const valoresPorAtributo = producto.atributos.map((_, n) => [...new Set(producto.variantes.map((v) => v.valores[n]))]);
    const fotos = producto.fotos.map((archivo) => urlImagen(req.tienda.id, archivo));
    const relacionados = productosRelacionados(db, req.tienda.id, { slug: producto.slug, categoriaIds: producto.categoriaIds });

    // Para la vista previa al compartir el link y para Google.
    const { origen } = res.locals;
    const finales = producto.variantes.map((v) => v.precioPromocional ?? v.precio);
    res.locals.meta = {
      descripcion: (producto.descripcion || `${producto.nombre} en ${req.tienda.nombre}.`).replace(/\s+/g, ' ').slice(0, 160),
      imagen: fotos[0] ?? res.locals.urlLogo,
      tipo: 'product',
      precio: Math.min(...finales) / 100,
    };
    const datosEstructurados = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: producto.nombre,
      description: producto.descripcion || undefined,
      image: fotos.map((url) => `${origen}${url}`),
      sku: producto.variantes[0].sku,
      brand: producto.marca ? { '@type': 'Brand', name: producto.marca } : undefined,
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'ARS',
        lowPrice: Math.min(...finales) / 100,
        highPrice: Math.max(...finales) / 100,
        offerCount: producto.variantes.length,
        availability: producto.variantes.some((v) => v.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    };

    res.render('tienda/producto', {
      titulo: producto.nombre,
      producto,
      inicial,
      valoresPorAtributo,
      categoriasProducto: producto.categoriaIds.map((id) => indice.get(id)).filter(Boolean),
      fotos,
      relacionados: conFotos(req.tienda.id, relacionados),
      variantesJson: jsonEnScript(variantes),
      datosEstructurados: jsonEnScript(datosEstructurados),
    });
  });

  // ---------- Checkout ----------
  // El carrito vive en el navegador y llega en la URL (?sku=A&cantidad=2&sku=B&cantidad=1). Todo se vuelve
  // a calcular acá con los precios y el stock de la base: lo que manda el navegador es solo qué y cuánto.

  // Las opciones de entrega y pago listas para mostrar, con lo que necesita el script para recalcular el total.
  function opcionesCheckout(req, subtotal) {
    const { entregas, pagos } = req.checkout;
    return {
      entregas: entregas.map((e) => {
        const envio = costoEnvio(e, subtotal);
        return {
          ...e,
          textoCosto: envio === 0 && e.costo > 0 ? 'Gratis' : textoCosto(e),
          // "Gratis desde $X" solo si todavía no se llegó.
          textoGratis: e.gratisDesde !== null && envio !== 0 ? `Gratis desde ${formatearPrecio(e.gratisDesde)}` : null,
        };
      }),
      pagos: pagos.map((p) => ({
        ...p,
        detalle:
          p.clave === 'transferencia' ? 'Te mostramos los datos de la cuenta al confirmar el pedido.'
          : p.clave === 'efectivo' ? 'Pagás cuando retirás o recibís el pedido.'
          : `Tarjeta de crédito, débito o dinero en cuenta.${req.ajustes.cuotasSinInteres ? ` Hasta ${req.ajustes.cuotasSinInteres} cuotas sin interés.` : ''}`,
      })),
    };
  }

  // sinItems: se entró a /checkout sin productos en la URL (el script usa el carrito guardado en el navegador).
  function mostrarCheckout(req, res, { lineas, cambios = [], valores = {}, errores = {}, status = 200, sinItems = false }) {
    const subtotal = subtotalDe(lineas);
    const { entregas, pagos } = opcionesCheckout(req, subtotal);
    // Si hay una sola opción, ya viene elegida.
    const elegida = {
      entrega: valores.entrega ?? (entregas.length === 1 ? String(entregas[0].id) : ''),
      pago: valores.pago ?? (pagos.length === 1 ? pagos[0].clave : ''),
    };
    const entrega = entregas.find((e) => String(e.id) === elegida.entrega) ?? null;
    const pago = pagos.find((p) => p.clave === elegida.pago) ?? null;
    res.locals.noIndexar = true;
    res.set('Cache-Control', 'private, no-store');
    res.status(status).render('tienda/checkout', {
      titulo: 'Finalizar compra',
      sinWhatsappFlotante: true,
      lineas: lineas.map((l) => ({ ...l, urlFoto: urlImagen(req.tienda.id, l.foto) })),
      cambios,
      valores: { provincia: '', ...valores, ...elegida },
      errores,
      entregas,
      pagos,
      entregaElegida: entrega,
      totales: calcularTotales(subtotal, entrega, pago),
      provincias: PROVINCIAS,
      datosCheckout: jsonEnScript({
        subtotal,
        entregas: entregas.map(({ id, tipo, costo, gratisDesde, aceptaEfectivo }) => ({ id: String(id), tipo, costo, gratisDesde, aceptaEfectivo })),
        pagos: pagos.map(({ clave, descuento }) => ({ clave, descuento })),
        carrito: lineas.map(({ sku, cantidad }) => ({ sku, cantidad })),
        sinItems,
      }),
    });
  }

  router.get('/checkout', (req, res) => {
    if (!req.checkout.activo) return res.redirect('/');
    const items = leerItems(req.query);
    const { lineas, cambios } = lineasDelCarrito(db, req.tienda.id, items);
    mostrarCheckout(req, res, { lineas, cambios, sinItems: items.length === 0 });
  });

  router.post('/checkout', express.urlencoded({ extended: false, limit: '64kb' }), (req, res) => {
    // Un formulario de otro sitio no puede hacer pedidos en nombre de nadie.
    const origen = req.get('origin');
    if (origen && origen !== res.locals.origen) return res.status(403).render('tienda/no-encontrado', { titulo: 'No encontrado' });
    if (!req.checkout.activo) return res.redirect(303, '/');
    // Campo trampa: lo completan los robots, las personas no lo ven.
    if (req.body.sitio) return res.redirect(303, '/');

    const items = leerItems(req.body);
    const { lineas, cambios } = lineasDelCarrito(db, req.tienda.id, items);
    const { valores, errores, datos } = validarCheckout(req.body, req.checkout);
    const volver = (extra) => mostrarCheckout(req, res, { lineas, cambios, valores, errores, status: 400, ...extra });

    if (lineas.length === 0) return volver({ cambios: [...cambios, 'Tu carrito está vacío.'] });
    if (cambios.length > 0 || Object.keys(errores).length > 0) return volver();
    if (!limitePedidos.puede(req.ip)) {
      return volver({ cambios: ['Hiciste muchos pedidos seguidos. Esperá un rato o escribinos para terminar la compra.'] });
    }

    let pedido;
    try {
      pedido = crearPedido(db, req.tienda.id, items, datos);
    } catch (error) {
      if (!(error instanceof ErrorDeStock)) throw error;
      // Alguien compró lo mismo mientras tanto: se muestra el carrito actualizado.
      const actual = lineasDelCarrito(db, req.tienda.id, items);
      return volver({ lineas: actual.lineas, cambios: error.problemas });
    }
    limitePedidos.registrar(req.ip);
    res.redirect(303, `/pedido/${pedido.token}?nuevo=1`);
  });

  // El pedido, para el cliente: qué compró, cómo pagar y en qué estado está. El link no se puede adivinar.
  router.get('/pedido/:token', (req, res, next) => {
    const pedido = leerPedidoPorToken(db, req.tienda.id, req.params.token);
    if (!pedido) return next();
    const { ajustes } = req;
    const urlPedido = `${res.locals.origen}/pedido/${pedido.token}`;
    const whatsapp = ajustes.whatsapp
      ? `https://wa.me/${ajustes.whatsapp}?text=${encodeURIComponent(resumenEnTexto(pedido, { tienda: req.tienda.nombre, urlPedido }))}`
      : null;
    const comprobante = ajustes.whatsapp
      ? `https://wa.me/${ajustes.whatsapp}?text=${encodeURIComponent(`¡Hola ${req.tienda.nombre}! Te mando el comprobante de la transferencia del pedido #${pedido.numero} por ${formatearPrecio(pedido.total)}.`)}`
      : null;
    res.locals.noIndexar = true;
    res.set('Cache-Control', 'private, no-store');
    res.render('tienda/pedido', {
      titulo: `Pedido #${pedido.numero}`,
      pedido,
      nuevo: req.query.nuevo === '1',
      estado: tituloEstado(pedido.estado, pedido.entrega.tipo, { paraCliente: true }),
      direccion: direccionEnUnaLinea(pedido.direccion),
      instruccionesMercadopago: instruccionesMercadopago(ajustes),
      whatsapp,
      comprobante,
      urlPedido,
    });
  });

  router.use((req, res) => {
    res.status(404).render('tienda/no-encontrado', { titulo: 'No encontrado' });
  });

  return router;
}
