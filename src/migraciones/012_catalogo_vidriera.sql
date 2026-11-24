-- Dos ajustes del catálogo de la vidriera. Los valores por defecto la dejan exactamente como estaba.
--  sin_stock: qué se hace con los productos que no tienen stock. 'mostrar' (como siempre), 'al-final' (van al final de cada lista)
--             u 'ocultar' (no aparecen en el catálogo, el buscador ni las categorías; la ficha sigue abierta por su link).
--  categorias_portada: cuántas categorías se muestran como botones en la portada. 'pocas' (las primeras 8 y un "Ver todas"),
--                      'todas' o 'ninguna'.
ALTER TABLE ajustes_tienda ADD COLUMN sin_stock TEXT NOT NULL DEFAULT 'mostrar' CHECK (sin_stock IN ('mostrar', 'al-final', 'ocultar'));
ALTER TABLE ajustes_tienda ADD COLUMN categorias_portada TEXT NOT NULL DEFAULT 'pocas' CHECK (categorias_portada IN ('pocas', 'todas', 'ninguna'));
