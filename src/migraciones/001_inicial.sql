-- Cada tabla de datos de cliente lleva tienda_id: varias tiendas conviven en la misma base.

CREATE TABLE tiendas (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  creada_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  hash_clave TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE categorias (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  padre_id INTEGER REFERENCES categorias(id),
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL
);
-- ifnull: en SQLite dos NULL no chocan en un UNIQUE, y las categorías raíz tienen padre NULL.
CREATE UNIQUE INDEX categorias_unicas ON categorias (tienda_id, ifnull(padre_id, 0), slug);

CREATE TABLE productos (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  slug TEXT NOT NULL,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  marca TEXT NOT NULL DEFAULT '',
  atributo1 TEXT,
  atributo2 TEXT,
  atributo3 TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tienda_id, slug)
);

CREATE TABLE producto_categorias (
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  PRIMARY KEY (producto_id, categoria_id)
);

CREATE TABLE variantes (
  id INTEGER PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  valor1 TEXT,
  valor2 TEXT,
  valor3 TEXT,
  precio_centavos INTEGER NOT NULL CHECK (precio_centavos > 0),
  precio_promocional_centavos INTEGER CHECK (precio_promocional_centavos > 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  peso_kg REAL,
  alto_cm REAL,
  ancho_cm REAL,
  profundidad_cm REAL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tienda_id, sku)
);
CREATE INDEX variantes_por_producto ON variantes (producto_id);

CREATE TABLE sesiones (
  sid TEXT PRIMARY KEY,
  datos TEXT NOT NULL,
  expira INTEGER NOT NULL
);
