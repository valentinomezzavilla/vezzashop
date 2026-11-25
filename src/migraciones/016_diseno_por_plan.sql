-- Diseño por plan y dominio propio.
--
-- planes.nivel_diseno: cuánto del diseño de la vidriera puede personalizar quien tiene el plan.
--  esencial: lo que ya existía (identidad, tipografía, esquinas, cabecera, catálogo, banners).
--  acompanado: suma colores, posición del logo, portada ordenable, estilo de las tarjetas y del pie.
--  a_medida: suma CSS propio, tipografías a elección, ancho de la página y dominio propio.
-- Las tiendas sin plan, o con el plan interno "Sin límites", valen como a_medida: nada cambia para ellas.
ALTER TABLE planes ADD COLUMN nivel_diseno TEXT NOT NULL DEFAULT 'esencial' CHECK (nivel_diseno IN ('esencial', 'acompanado', 'a_medida'));
UPDATE planes SET nivel_diseno = 'acompanado' WHERE lower(nombre) = 'acompañado';
UPDATE planes SET nivel_diseno = 'a_medida' WHERE lower(nombre) IN ('a medida', 'sin límites');

-- Lo que elige cada tienda. Todos los valores por defecto reproducen la vidriera de siempre: hasta que la tienda elige algo, no cambia nada.
-- Los colores son #rrggbb, o '' para el de siempre. portada_secciones: las secciones de arriba de la portada que se ven, en orden.
ALTER TABLE ajustes_tienda ADD COLUMN color_fondo TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN color_texto TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN color_tarjetas TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN color_cabecera TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN color_pie TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN logo_posicion TEXT NOT NULL DEFAULT 'izquierda' CHECK (logo_posicion IN ('izquierda', 'centro', 'derecha'));
ALTER TABLE ajustes_tienda ADD COLUMN cabecera_fija INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ajustes_tienda ADD COLUMN pie_estilo TEXT NOT NULL DEFAULT 'claro' CHECK (pie_estilo IN ('claro', 'oscuro', 'marca', 'propio'));
ALTER TABLE ajustes_tienda ADD COLUMN portada_secciones TEXT NOT NULL DEFAULT 'banners,destacados';
ALTER TABLE ajustes_tienda ADD COLUMN tarjeta_estilo TEXT NOT NULL DEFAULT 'plana' CHECK (tarjeta_estilo IN ('plana', 'borde', 'sombra'));
ALTER TABLE ajustes_tienda ADD COLUMN tarjeta_foto TEXT NOT NULL DEFAULT 'vertical' CHECK (tarjeta_foto IN ('vertical', 'cuadrada', 'apaisada'));
ALTER TABLE ajustes_tienda ADD COLUMN tarjeta_texto TEXT NOT NULL DEFAULT 'izquierda' CHECK (tarjeta_texto IN ('izquierda', 'centro'));
ALTER TABLE ajustes_tienda ADD COLUMN banners_ancho TEXT NOT NULL DEFAULT 'contenedor' CHECK (banners_ancho IN ('contenedor', 'completo'));
-- Solo el plan a medida: CSS propio, tipografías de Google Fonts (el nombre de la familia) y el ancho de la página.
ALTER TABLE ajustes_tienda ADD COLUMN css_propio TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN fuente_titulos TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN fuente_texto TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN ancho_pagina TEXT NOT NULL DEFAULT 'normal' CHECK (ancho_pagina IN ('angosto', 'normal', 'ancho', 'completo'));

-- Dominio propio de una tienda (plan a medida).
--  dominio_estado: solicitado (lo pidió el cliente) -> verificado (el DNS ya apunta a la plataforma) -> activo (la plataforma lo agregó en
--  Coolify y la tienda ya se ve ahí). NULL: sin dominio propio.
--  codigo_cabecera / codigo_pie: HTML (píxeles, analítica) que carga solo quien administra la plataforma; se usa únicamente con el plan a medida.
ALTER TABLE tiendas ADD COLUMN dominio_propio TEXT;
CREATE UNIQUE INDEX tiendas_dominio_propio ON tiendas (dominio_propio) WHERE dominio_propio IS NOT NULL;
ALTER TABLE tiendas ADD COLUMN dominio_estado TEXT CHECK (dominio_estado IN ('solicitado', 'verificado', 'activo'));
ALTER TABLE tiendas ADD COLUMN codigo_cabecera TEXT NOT NULL DEFAULT '';
ALTER TABLE tiendas ADD COLUMN codigo_pie TEXT NOT NULL DEFAULT '';
