// Utilidades solo para tests.

export function crearTiendaVacia(db, slug) {
  return Number(db.prepare('INSERT INTO tiendas (nombre, slug) VALUES (?, ?)').run(slug, slug).lastInsertRowid);
}

function rutaCategoria(db, id) {
  const partes = [];
  for (let actual = id; actual !== null; ) {
    const categoria = db.prepare('SELECT nombre, padre_id FROM categorias WHERE id = ?').get(actual);
    partes.unshift(categoria.nombre);
    actual = categoria.padre_id;
  }
  return partes.join(' > ');
}

// Foto del catálogo de una tienda, ordenada, para comparar con valores literales.
export function leerCatalogo(db, tiendaId) {
  const productos = db
    .prepare('SELECT * FROM productos WHERE tienda_id = ? ORDER BY nombre')
    .all(tiendaId);
  return productos.map((p) => {
    const atributos = [p.atributo1, p.atributo2, p.atributo3].filter((a) => a !== null);
    return {
      nombre: p.nombre,
      descripcion: p.descripcion,
      visible: p.visible,
      atributos,
      categorias: db
        .prepare('SELECT categoria_id FROM producto_categorias WHERE producto_id = ?')
        .all(p.id)
        .map((f) => rutaCategoria(db, f.categoria_id))
        .sort(),
      variantes: db
        .prepare('SELECT * FROM variantes WHERE producto_id = ? ORDER BY sku')
        .all(p.id)
        .map((v) => ({
          sku: v.sku,
          valores: [v.valor1, v.valor2, v.valor3].slice(0, atributos.length),
          precio: v.precio_centavos,
          stock: v.stock,
        })),
    };
  });
}
