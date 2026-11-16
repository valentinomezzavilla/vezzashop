// Datos del tablero de Inicio del panel: qué le falta a la tienda, números y alertas de stock.
import { leerAjustes, listarBanners } from './diseno.js';
import { estadoCheckout } from './pagos.js';
import { contarPedidosPorFiltro } from './pedidos.js';

const POCAS_UNIDADES = 3;
const COLOR_POR_DEFECTO = '#1a1a1a';

export async function resumenTienda(db, tiendaId) {
  const contar = async (sql, ...parametros) => (await db.prepare(sql).get(tiendaId, ...parametros)).n;
  const ajustes = await leerAjustes(db, tiendaId);

  const numeros = {
    visibles: await contar('SELECT count(*) AS n FROM productos WHERE tienda_id = ? AND visible = 1'),
    ocultos: await contar('SELECT count(*) AS n FROM productos WHERE tienda_id = ? AND visible = 0'),
    sinStock: await contar(
      `SELECT count(*) AS n FROM productos p WHERE p.tienda_id = ?
       AND NOT exists (SELECT 1 FROM variantes v WHERE v.producto_id = p.id AND v.stock > 0)`,
    ),
    unidades: await contar('SELECT coalesce(sum(stock), 0) AS n FROM variantes WHERE tienda_id = ?'),
  };
  const visiblesSinFoto = await contar(
    `SELECT count(*) AS n FROM productos p WHERE p.tienda_id = ? AND p.visible = 1
     AND NOT exists (SELECT 1 FROM producto_fotos f WHERE f.producto_id = p.id)`,
  );
  const categorias = await contar('SELECT count(*) AS n FROM categorias WHERE tienda_id = ?');

  const pasos = [
    { clave: 'productos', hecho: numeros.visibles > 0, titulo: 'Cargá tus productos', detalle: 'De a uno o muchos juntos con un Excel.', enlace: '/admin/productos/nuevo', accion: 'Agregar producto' },
    {
      clave: 'fotos',
      hecho: numeros.visibles > 0 && visiblesSinFoto === 0,
      titulo: 'Sumá fotos a los productos',
      detalle: visiblesSinFoto ? `${visiblesSinFoto} producto${visiblesSinFoto === 1 ? '' : 's'} visible${visiblesSinFoto === 1 ? '' : 's'} sin foto.` : 'Los productos con foto se venden mucho más.',
      enlace: '/admin/productos?filtro=sin-foto',
      accion: 'Ver productos sin foto',
    },
    { clave: 'categorias', hecho: categorias > 0, titulo: 'Ordená el catálogo en categorías', detalle: 'Aparecen en el menú de la tienda.', enlace: '/admin/categorias', accion: 'Ir a categorías' },
    { clave: 'logo', hecho: Boolean(ajustes.logo), titulo: 'Subí tu logo', detalle: 'Se muestra arriba, en todas las páginas.', enlace: '/admin/diseno', accion: 'Subir logo' },
    { clave: 'color', hecho: ajustes.colorPrincipal !== COLOR_POR_DEFECTO, titulo: 'Elegí el color de tu marca', detalle: 'Para la franja de anuncios y los botones.', enlace: '/admin/diseno', accion: 'Elegir color' },
    { clave: 'banners', hecho: (await listarBanners(db, tiendaId)).length > 0, titulo: 'Agregá un banner de bienvenida', detalle: 'La imagen grande de la portada.', enlace: '/admin/diseno#banners', accion: 'Agregar banner' },
    { clave: 'whatsapp', hecho: Boolean(ajustes.whatsapp), titulo: 'Conectá tu WhatsApp', detalle: 'Para que te consulten desde cada producto.', enlace: '/admin/diseno', accion: 'Agregar WhatsApp' },
    {
      clave: 'checkout',
      hecho: (await estadoCheckout(db, tiendaId, ajustes)).activo,
      titulo: 'Activá la compra online',
      detalle: 'Elegí cómo entregás y cómo cobrás, y te compran desde la tienda.',
      enlace: '/admin/pagos',
      accion: 'Configurar envíos y pagos',
    },
  ];
  const pedidos = await contarPedidosPorFiltro(db, tiendaId);

  const sinStock = await db
    .prepare(
      `SELECT p.id, p.nombre FROM productos p WHERE p.tienda_id = ?
       AND NOT exists (SELECT 1 FROM variantes v WHERE v.producto_id = p.id AND v.stock > 0)
       ORDER BY p.visible DESC, lower(p.nombre) LIMIT 5`,
    )
    .all(tiendaId);
  const pocasUnidades = (await db
    .prepare(
      `SELECT p.id, p.nombre, v.sku, v.stock, v.valor1, v.valor2, v.valor3
       FROM variantes v JOIN productos p ON p.id = v.producto_id
       WHERE v.tienda_id = ? AND v.stock BETWEEN 1 AND ? ORDER BY v.stock, lower(p.nombre) LIMIT 6`,
    )
    .all(tiendaId, POCAS_UNIDADES))
    .map((v) => ({ ...v, valores: [v.valor1, v.valor2, v.valor3].filter((x) => x !== null).join(' / ') }));

  return { numeros, pasos, hechos: pasos.filter((p) => p.hecho).length, sinStock, pocasUnidades, pedidos };
}
