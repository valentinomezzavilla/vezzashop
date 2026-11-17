-- Diseño de la cabecera de la vidriera: cómo se muestra el menú de categorías y qué tan grande es el logo.
-- 'barra': las categorías van en una barra arriba y las que no entran pasan a un botón "Más".
-- 'desplegable': un botón de menú abre la lista, también en la computadora.
ALTER TABLE ajustes_tienda ADD COLUMN menu_estilo TEXT NOT NULL DEFAULT 'barra' CHECK (menu_estilo IN ('barra', 'desplegable'));
ALTER TABLE ajustes_tienda ADD COLUMN logo_tamano TEXT NOT NULL DEFAULT 'mediano' CHECK (logo_tamano IN ('chico', 'mediano', 'grande'));

-- Si una categoría de primer nivel aparece en el menú de arriba. Por defecto todas, como hasta ahora.
ALTER TABLE categorias ADD COLUMN en_menu INTEGER NOT NULL DEFAULT 1;
