-- Más cosas que cada tienda puede editar en Diseño. Los valores por defecto dejan la vidriera exactamente como estaba.
--  color_franja: fondo de la franja de anuncios ('' = el color principal). franja_enlace: a dónde lleva al tocarla.
--  fuente / esquinas / tarjetas: tipografía, redondeo de botones y tarjetas, y tamaño de las tarjetas de producto.
--  titulo_destacados / titulo_catalogo: los títulos de la portada.
--  descripcion: "sobre la tienda" (pie y descripción para buscadores). horarios, direccion_mapa y nota_pie: pie de la tienda.
ALTER TABLE ajustes_tienda ADD COLUMN color_franja TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN franja_enlace TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN fuente TEXT NOT NULL DEFAULT 'sistema' CHECK (fuente IN ('sistema', 'moderna', 'elegante', 'geometrica', 'suave'));
ALTER TABLE ajustes_tienda ADD COLUMN esquinas TEXT NOT NULL DEFAULT 'redondeadas' CHECK (esquinas IN ('redondeadas', 'suaves', 'rectas'));
ALTER TABLE ajustes_tienda ADD COLUMN tarjetas TEXT NOT NULL DEFAULT 'normales' CHECK (tarjetas IN ('chicas', 'normales', 'grandes'));
ALTER TABLE ajustes_tienda ADD COLUMN titulo_destacados TEXT NOT NULL DEFAULT 'Destacados';
ALTER TABLE ajustes_tienda ADD COLUMN titulo_catalogo TEXT NOT NULL DEFAULT 'Todos los productos';
ALTER TABLE ajustes_tienda ADD COLUMN descripcion TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN horarios TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN direccion_mapa TEXT NOT NULL DEFAULT '';
ALTER TABLE ajustes_tienda ADD COLUMN nota_pie TEXT NOT NULL DEFAULT '';
