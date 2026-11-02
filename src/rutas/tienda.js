import express from 'express';
import { arbolCategorias, buscarCategoria, productosVisibles, productoVisible, ORDENES, esOrden } from '../vidriera.js';
import { leerAjustes, listarBanners, colorDeTextoSobre, precioConDescuento, valorCuota } from '../diseno.js';
import { urlImagen } from '../imagenes.js';
import { formatearPrecio } from '../util/formato.js';
import { urlPanel } from '../util/dominios.js';

const POCAS_UNIDADES = 3;
const MAX_DESTACADOS = 8;

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
function preciosExtra(centavos, ajustes) {
  return {
    transferencia: ajustes.descuentoTransferencia
      ? formatearPrecio(precioConDescuento(centavos, ajustes.descuentoTransferencia))
      : null,
    cuota: ajustes.cuotasSinInteres ? formatearPrecio(valorCuota(centavos, ajustes.cuotasSinInteres)) : null,
  };
}

// "-20%" de un precio promocional sobre el de lista (null si no hay promoción).
export const porcentajeOff = (precioLista, precioFinal) =>
  precioFinal < precioLista ? Math.round((1 - precioFinal / precioLista) * 100) : null;

// Link de WhatsApp con el mensaje armado para consultar por una variante.
function whatsappVariante(numero, producto, variante) {
  if (!numero) return null;
  const detalle = producto.atributos.map((atributo, n) => `${atributo} ${variante.valores[n]}`).join(', ');
  const texto = `¡Hola! Quiero consultar por ${producto.nombre}${detalle ? ` (${detalle})` : ''}. SKU ${variante.sku}`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

// Todo lo que muestra la ficha para una variante, con los precios ya formateados.
// Se usa para el primer render y, como JSON, para el script que cambia de variante.
function datosVariante(variante, producto, ajustes) {
  const final = variante.precioPromocional ?? variante.precio;
  return {
    valores: variante.valores,
    sku: variante.sku,
    precio: formatearPrecio(final),
    precioLista: variante.precioPromocional === null ? null : formatearPrecio(variante.precio),
    off: porcentajeOff(variante.precio, final),
    ...preciosExtra(final, ajustes),
    hayStock: variante.stock > 0,
    stock: estadoStock(variante.stock),
    whatsapp: whatsappVariante(ajustes.whatsapp, producto, variante),
  };
}

// El orden que eligió el visitante, o el que configuró la tienda.
const ordenElegido = (req, ajustes) => (esOrden(req.query.orden) ? req.query.orden : ajustes.ordenCatalogo);

// JSON seguro para meter dentro de <script>.
const jsonEnScript = (valor) => JSON.stringify(valor).replace(/</g, '\\u003c');

// Vidriera de una tienda. Se monta solo cuando el host es el subdominio de una tienda (req.tienda).
export function rutasTienda({ db, config }) {
  const router = express.Router();

  router.use((req, res, next) => {
    const arbol = arbolCategorias(db, req.tienda.id);
    const ajustes = leerAjustes(db, req.tienda.id);
    Object.assign(res.locals, {
      tienda: req.tienda,
      categorias: arbol,
      ajustes,
      urlLogo: urlImagen(req.tienda.id, ajustes.logo),
      colorTexto: colorDeTextoSobre(ajustes.colorPrincipal),
      urlCategoria,
      estadoStock,
      porcentajeOff,
      preciosExtra: (centavos) => preciosExtra(centavos, ajustes),
    });
    req.arbol = arbol;
    req.ajustes = ajustes;
    next();
  });

  // El panel vive en el dominio principal, para que la sesión sea una sola.
  router.use('/admin', (req, res) => res.redirect(`${urlPanel(req, config.dominio)}/admin`));

  const conFotos = (tiendaId, productos) =>
    productos.map((p) => ({ ...p, urlFoto: urlImagen(tiendaId, p.foto), urlFotoAlternativa: urlImagen(tiendaId, p.fotoAlternativa) }));

  router.get('/', (req, res) => {
    const orden = ordenElegido(req, req.ajustes);
    // Los destacados van arriba en la portada, pero no cuando el visitante eligió un orden.
    const destacados = req.query.orden
      ? []
      : productosVisibles(db, req.tienda.id, { soloDestacados: true, orden: req.ajustes.ordenCatalogo }).slice(0, MAX_DESTACADOS);
    res.render('tienda/catalogo', {
      titulo: req.tienda.nombre,
      migas: [],
      subcategorias: req.arbol,
      banners: listarBanners(db, req.tienda.id).map((b) => ({
        ...b,
        urlImagen: urlImagen(req.tienda.id, b.imagen),
        urlImagenMovil: urlImagen(req.tienda.id, b.imagenMovil),
      })),
      destacados: conFotos(req.tienda.id, destacados),
      productos: conFotos(req.tienda.id, productosVisibles(db, req.tienda.id, { orden })),
      ordenes: ORDENES,
      orden,
    });
  });

  router.get('/categoria/*ruta', (req, res, next) => {
    const encontrada = buscarCategoria(req.arbol, req.params.ruta);
    if (!encontrada) return next();
    const { categoria, migas } = encontrada;
    const orden = ordenElegido(req, req.ajustes);
    res.render('tienda/catalogo', {
      titulo: categoria.nombre,
      migas,
      subcategorias: categoria.hijas,
      banners: [],
      destacados: [],
      productos: conFotos(req.tienda.id, productosVisibles(db, req.tienda.id, { categoriaId: categoria.id, orden })),
      ordenes: ORDENES,
      orden,
    });
  });

  router.get('/producto/:slug', (req, res, next) => {
    const producto = productoVisible(db, req.tienda.id, req.params.slug);
    if (!producto) return next();
    const indice = indexarCategorias(req.arbol);
    const variantes = producto.variantes.map((v) => datosVariante(v, producto, req.ajustes));
    const inicial = variantes.find((v) => v.hayStock) ?? variantes[0];
    const valoresPorAtributo = producto.atributos.map((_, n) => [...new Set(producto.variantes.map((v) => v.valores[n]))]);
    res.render('tienda/producto', {
      titulo: producto.nombre,
      producto,
      inicial,
      valoresPorAtributo,
      categoriasProducto: producto.categoriaIds.map((id) => indice.get(id)).filter(Boolean),
      fotos: producto.fotos.map((archivo) => urlImagen(req.tienda.id, archivo)),
      variantesJson: jsonEnScript(variantes),
    });
  });

  router.use((req, res) => {
    res.status(404).render('tienda/no-encontrado', { titulo: 'No encontrado' });
  });

  return router;
}
