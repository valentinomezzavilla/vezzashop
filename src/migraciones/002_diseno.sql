-- Cómo se ve la vidriera de cada tienda. Una fila por tienda; si no hay fila, se usan los valores por defecto.
CREATE TABLE ajustes_tienda (
  tienda_id INTEGER PRIMARY KEY REFERENCES tiendas(id),
  logo TEXT,                                  -- nombre del archivo en la carpeta de subidas de la tienda
  color_principal TEXT NOT NULL DEFAULT '#1a1a1a',
  franja_texto TEXT NOT NULL DEFAULT '',
  descuento_transferencia INTEGER NOT NULL DEFAULT 0 CHECK (descuento_transferencia BETWEEN 0 AND 90),
  cuotas_sin_interes INTEGER NOT NULL DEFAULT 0 CHECK (cuotas_sin_interes BETWEEN 0 AND 24),
  orden_catalogo TEXT NOT NULL DEFAULT 'nombre',
  whatsapp TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  facebook TEXT NOT NULL DEFAULT '',
  tiktok TEXT NOT NULL DEFAULT '',
  email_contacto TEXT NOT NULL DEFAULT '',
  direccion TEXT NOT NULL DEFAULT ''
);

-- Imágenes del carrusel de la portada.
CREATE TABLE banners (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  imagen TEXT NOT NULL,
  imagen_movil TEXT,
  enlace TEXT NOT NULL DEFAULT '',
  texto_alternativo TEXT NOT NULL DEFAULT '',
  orden INTEGER NOT NULL
);
CREATE INDEX banners_por_tienda ON banners (tienda_id, orden);
