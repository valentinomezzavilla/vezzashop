-- Productos destacados en la portada y fotos de producto.
ALTER TABLE productos ADD COLUMN destacado INTEGER NOT NULL DEFAULT 0;

-- Fotos de cada producto, en orden: la primera es la principal.
CREATE TABLE producto_fotos (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  archivo TEXT NOT NULL,
  orden INTEGER NOT NULL
);
CREATE INDEX fotos_por_producto ON producto_fotos (producto_id, orden);
