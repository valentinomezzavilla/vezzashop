// Consultas de la vidriera pública. Solo muestran productos visibles y con al menos una variante.
import { slugificar } from './util/slug.js';

// Árbol de categorías de la tienda, sin las que no tienen productos visibles (ni ellas ni sus hijas).
// Cada nodo: { id, nombre, slug, ruta: ['ropa', 'remeras'], hijas: [...] }
export function arbolCategorias(db, tiendaId) {
  const categorias = db
    .prepare(
      `SELECT c.id, c.padre_id AS padreId, c.nombre, c.slug,
              exists (SELECT 1 FROM producto_categorias pc
                      JOIN productos p ON p.id = pc.producto_id AND p.visible = 1
                      WHERE pc.categoria_id = c.id
                        AND exists (SELECT 1 FROM variantes v WHERE v.producto_id = p.id)) AS conProductos
       FROM categorias c WHERE c.tienda_id = ?
       ORDER BY c.nombre COLLATE NOCASE`,
    )
    .all(tiendaId);

  const hijasDe = Map.groupBy(categorias, (c) => c.padreId ?? 0);
  const armar = (padreId, rutaPadre) =>
    (hijasDe.get(padreId) ?? [])
      .map((c) => {
        const ruta = [...rutaPadre, c.slug];
        const hijas = armar(c.id, ruta);
        return { id: c.id, nombre: c.nombre, slug: c.slug, ruta, hijas, conProductos: c.conProductos || hijas.length > 0 };
      })
      .filter((c) => c.conProductos);
  return armar(0, []);
}

// Busca la categoría por su ruta de slugs (['ropa', 'remeras']) dentro del árbol.
// Devuelve { categoria, migas } o null. migas = las categorías desde la raíz hasta ella.
export function buscarCategoria(arbol, slugs) {
  const migas = [];
  let nivel = arbol;
  for (const slug of slugs) {
    const categoria = nivel.find((c) => c.slug === slug);
    if (!categoria) return null;
    migas.push(categoria);
    nivel = categoria.hijas;
  }
  return migas.length ? { categoria: migas.at(-1), migas } : null;
}

// Órdenes posibles del catálogo. El SQL sale de acá, nunca de lo que manda el visitante.
export const ORDENES = {
  nombre: { titulo: 'Nombre (A-Z)', sql: 'p.nombre COLLATE NOCASE' },
  nuevos: { titulo: 'Más nuevos', sql: 'p.id DESC' },
  'precio-menor': { titulo: 'Precio: menor a mayor', sql: 'precioDesde, p.nombre COLLATE NOCASE' },
  'precio-mayor': { titulo: 'Precio: mayor a menor', sql: 'precioDesde DESC, p.nombre COLLATE NOCASE' },
};
export const esOrden = (valor) => typeof valor === 'string' && Object.hasOwn(ORDENES, valor);

const FOTO_EN = (posicion) =>
  `(SELECT archivo FROM producto_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1 OFFSET ${posicion})`;

// "50%_off" -> "50\%\_off" para buscarlo literal con LIKE ... ESCAPE '\'.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

// Arma el SELECT de productos visibles con todos los filtros posibles. Devuelve { sql, parametros }.
//  - categoriaId: esa categoría y sus subcategorías. categoriaIds: cualquiera de esas (sin subcategorías).
//  - busqueda: cada palabra tiene que aparecer en el nombre, la marca o algún SKU. Sin importar tildes.
//  - conStock, enOferta, precioMin/precioMax (centavos, sobre el precio final más bajo), excluirSlug.
function consultaVisibles(tiendaId, opciones) {
  const { categoriaId = null, categoriaIds = null, soloDestacados = false, busqueda = '', excluirSlug = null } = opciones;
  const { conStock = false, enOferta = false, precioMin = null, precioMax = null } = opciones;
  const donde = ['p.tienda_id = ?', 'p.visible = 1'];
  const parametros = [tiendaId];
  const tener = [];

  if (soloDestacados) donde.push('p.destacado = 1');
  if (excluirSlug) {
    donde.push('p.slug <> ?');
    parametros.push(excluirSlug);
  }
  if (categoriaId !== null) {
    donde.push(`p.id IN (
      WITH RECURSIVE arbol(id) AS (SELECT ? UNION ALL SELECT c.id FROM categorias c JOIN arbol a ON c.padre_id = a.id)
      SELECT producto_id FROM producto_categorias WHERE categoria_id IN (SELECT id FROM arbol))`);
    parametros.push(categoriaId);
  }
  if (categoriaIds) {
    donde.push(`p.id IN (SELECT producto_id FROM producto_categorias WHERE categoria_id IN (${categoriaIds.map(() => '?').join(', ') || 'NULL'}))`);
    parametros.push(...categoriaIds);
  }
  for (const palabra of busqueda.split(/\s+/).map(slugificar).filter(Boolean).slice(0, 6)) {
    const patron = `%${escaparLike(palabra)}%`;
    donde.push(`(p.slug LIKE ? ESCAPE '\\' OR slugificar(p.marca) LIKE ? ESCAPE '\\'
      OR exists (SELECT 1 FROM variantes b WHERE b.producto_id = p.id AND lower(b.sku) LIKE ? ESCAPE '\\'))`);
    parametros.push(patron, patron, patron);
  }
  if (conStock) tener.push('sum(v.stock) > 0');
  if (enOferta) tener.push('max(v.precio_promocional_centavos IS NOT NULL) = 1');
  const parametrosTener = [];
  if (precioMin !== null) {
    tener.push('precioDesde >= ?');
    parametrosTener.push(precioMin);
  }
  if (precioMax !== null) {
    tener.push('precioDesde <= ?');
    parametrosTener.push(precioMax);
  }

  return {
    sql: `SELECT p.id, p.slug, p.nombre, p.marca, p.destacado, ${FOTO_EN(0)} AS foto, ${FOTO_EN(1)} AS fotoAlternativa,
                 min(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS precioDesde,
                 max(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS precioHasta,
                 min(v.precio_centavos) AS precioLista,
                 sum(v.stock) AS stock
          FROM productos p JOIN variantes v ON v.producto_id = p.id
          WHERE ${donde.join(' AND ')}
          GROUP BY p.id
          ${tener.length ? `HAVING ${tener.join(' AND ')}` : ''}`,
    parametros: [...parametros, ...parametrosTener],
  };
}

// Productos para las tarjetas del catálogo. Ver consultaVisibles para los filtros; además orden, limite y desde.
export function productosVisibles(db, tiendaId, opciones = {}) {
  const { orden = 'nombre', limite = null, desde = 0 } = opciones;
  const { sql, parametros } = consultaVisibles(tiendaId, opciones);
  const paginado = limite === null ? '' : ` LIMIT ${Number(limite)} OFFSET ${Number(desde)}`;
  return db.prepare(`${sql} ORDER BY ${ORDENES[esOrden(orden) ? orden : 'nombre'].sql}${paginado}`).all(...parametros);
}

export function contarVisibles(db, tiendaId, opciones = {}) {
  const { sql, parametros } = consultaVisibles(tiendaId, opciones);
  return db.prepare(`SELECT count(*) AS n FROM (${sql})`).get(...parametros).n;
}

// Rango de precios (finales) del catálogo de la tienda, para el filtro de precio.
export function rangoDePrecios(db, tiendaId) {
  return db
    .prepare(
      `SELECT min(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS minimo,
              max(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS maximo
       FROM variantes v JOIN productos p ON p.id = v.producto_id WHERE p.tienda_id = ? AND p.visible = 1`,
    )
    .get(tiendaId);
}

// Hasta `limite` productos para "También te puede gustar": primero los de las mismas categorías, después otros.
export function productosRelacionados(db, tiendaId, { slug, categoriaIds, limite = 4 }) {
  const mismas = categoriaIds.length
    ? productosVisibles(db, tiendaId, { categoriaIds, excluirSlug: slug, conStock: true, orden: 'nuevos', limite })
    : [];
  if (mismas.length >= limite) return mismas;
  const vistos = new Set([slug, ...mismas.map((p) => p.slug)]);
  const otros = productosVisibles(db, tiendaId, { conStock: true, orden: 'nuevos', limite: limite * 3 }).filter((p) => !vistos.has(p.slug));
  return [...mismas, ...otros].slice(0, limite);
}

// Datos frescos de las variantes del carrito (solo de productos visibles). Las que ya no existen no vuelven.
export function variantesParaCarrito(db, tiendaId, skus) {
  if (skus.length === 0) return [];
  return db
    .prepare(
      `SELECT v.sku, v.stock, v.precio_centavos AS precio, coalesce(v.precio_promocional_centavos, v.precio_centavos) AS precioFinal,
              v.valor1, v.valor2, v.valor3, p.atributo1, p.atributo2, p.atributo3, p.nombre, p.slug,
              (SELECT archivo FROM producto_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1) AS foto
       FROM variantes v JOIN productos p ON p.id = v.producto_id
       WHERE v.tienda_id = ? AND p.visible = 1 AND v.sku IN (${skus.map(() => '?').join(', ')})`,
    )
    .all(tiendaId, ...skus)
    .map((v) => ({
      sku: v.sku,
      stock: v.stock,
      precio: v.precio,
      precioFinal: v.precioFinal,
      nombre: v.nombre,
      slug: v.slug,
      foto: v.foto,
      detalle: [[v.atributo1, v.valor1], [v.atributo2, v.valor2], [v.atributo3, v.valor3]]
        .filter(([atributo]) => atributo)
        .map(([atributo, valor]) => `${atributo} ${valor}`)
        .join(', '),
    }));
}

// Ficha de un producto visible, con sus variantes y categorías. null si no existe o está oculto.
export function productoVisible(db, tiendaId, slug) {
  const producto = db
    .prepare(
      `SELECT id, slug, nombre, descripcion, marca, atributo1, atributo2, atributo3
       FROM productos WHERE tienda_id = ? AND slug = ? AND visible = 1`,
    )
    .get(tiendaId, slug);
  if (!producto) return null;

  const atributos = [producto.atributo1, producto.atributo2, producto.atributo3].filter((a) => a !== null);
  const variantes = db
    .prepare(
      `SELECT sku, valor1, valor2, valor3, precio_centavos AS precio,
              precio_promocional_centavos AS precioPromocional, stock
       FROM variantes WHERE producto_id = ? ORDER BY id`,
    )
    .all(producto.id)
    .map((v) => ({
      sku: v.sku,
      valores: [v.valor1, v.valor2, v.valor3].slice(0, atributos.length),
      precio: v.precio,
      precioPromocional: v.precioPromocional,
      stock: v.stock,
    }));
  if (variantes.length === 0) return null;

  const categoriaIds = db
    .prepare('SELECT categoria_id AS id FROM producto_categorias WHERE producto_id = ?')
    .all(producto.id)
    .map((f) => f.id);

  const fotos = db
    .prepare('SELECT archivo FROM producto_fotos WHERE producto_id = ? ORDER BY orden, id')
    .all(producto.id)
    .map((f) => f.archivo);

  return {
    slug: producto.slug,
    nombre: producto.nombre,
    descripcion: producto.descripcion,
    marca: producto.marca,
    atributos,
    variantes,
    categoriaIds,
    fotos,
  };
}
