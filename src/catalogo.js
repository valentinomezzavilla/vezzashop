export function listarProductos(db, tiendaId) {
  return db
    .prepare(
      `SELECT p.id, p.nombre, p.visible,
              count(v.id) AS variantes, ifnull(sum(v.stock), 0) AS stock,
              min(v.precio_centavos) AS precioMinimo, max(v.precio_centavos) AS precioMaximo
       FROM productos p LEFT JOIN variantes v ON v.producto_id = p.id
       WHERE p.tienda_id = ?
       GROUP BY p.id
       ORDER BY p.nombre COLLATE NOCASE`,
    )
    .all(tiendaId);
}
