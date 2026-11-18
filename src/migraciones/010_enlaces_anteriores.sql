-- Links (subdominios) que una tienda usó antes. Cuando se le cambia el link desde la plataforma, el anterior queda acá y
-- redirige al nuevo, así no se rompen los links que ya se compartieron ni lo que Google guardó.
-- Un link anterior no puede usarlo otra tienda (se le robaría el tráfico) hasta que se lo libere desde la ficha de la tienda.
CREATE TABLE tienda_enlaces_anteriores (
  slug TEXT PRIMARY KEY,
  tienda_id INTEGER NOT NULL REFERENCES tiendas(id),
  cambiado_en TEXT NOT NULL DEFAULT ahora()
);
CREATE INDEX enlaces_anteriores_por_tienda ON tienda_enlaces_anteriores (tienda_id);
