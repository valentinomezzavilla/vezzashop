// Consultas de la vidriera pública. Solo muestran productos visibles y con al menos una variante.

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

// Productos para las tarjetas del catálogo. Con categoriaId, incluye los de sus subcategorías.
const FOTO_EN = (posicion) =>
  `(SELECT archivo FROM producto_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1 OFFSET ${posicion})`;

export function productosVisibles(db, tiendaId, { categoriaId = null, orden = 'nombre', soloDestacados = false } = {}) {
  const filtro = categoriaId === null
    ? ''
    : `AND p.id IN (
         WITH RECURSIVE arbol(id) AS (
           SELECT ? UNION ALL SELECT c.id FROM categorias c JOIN arbol a ON c.padre_id = a.id
         )
         SELECT producto_id FROM producto_categorias WHERE categoria_id IN (SELECT id FROM arbol)
       )`;
  return db
    .prepare(
      `SELECT p.slug, p.nombre, p.marca, ${FOTO_EN(0)} AS foto, ${FOTO_EN(1)} AS fotoAlternativa,
              min(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS precioDesde,
              max(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS precioHasta,
              min(v.precio_centavos) AS precioLista,
              sum(v.stock) AS stock
       FROM productos p JOIN variantes v ON v.producto_id = p.id
       WHERE p.tienda_id = ? AND p.visible = 1 ${soloDestacados ? 'AND p.destacado = 1' : ''} ${filtro}
       GROUP BY p.id
       ORDER BY ${ORDENES[esOrden(orden) ? orden : 'nombre'].sql}`,
    )
    .all(...(categoriaId === null ? [tiendaId] : [tiendaId, categoriaId]));
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
