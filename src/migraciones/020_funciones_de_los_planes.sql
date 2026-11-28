-- Planes editables: cada plan tiene su propia lista de funciones de diseño (antes elegía uno de tres niveles fijos) y sus propios textos en la tarjeta.
--
-- planes.funciones: las funciones de diseño que incluye el plan, separadas por coma (el catálogo está en src/diseno-por-plan.js): colores, logo_cabecera,
--   portada, tarjetas, pie, fuentes, ancho, css, dominio, codigos y kit_de_marca. Vacío: solo lo básico, lo que tenía el nivel Esencial.
--   Los niveles de antes se copian tal cual, así a ninguna tienda le cambia nada: acompanado -> colores, logo y cabecera, portada, tarjetas, pie y
--   kit de marca; a_medida -> todas.
-- planes.descripcion: la frase corta de la tarjeta del plan. Vacía: la de siempre, según el plan.
-- planes.caracteristicas: lo que incluye el plan, una por línea, para la tarjeta. Vacío: la lista de siempre (topes, prueba y diseño).
-- planes.destacado: el plan sale con "Recomendado" en la landing y al suscribirse (uno solo). Hasta ahora era el plan pago más barato, siempre que
--   hubiera más de un plan ofrecido: se marca ese, para que lo que se ve no cambie, y desde /plataforma/planes se elige cuál.
-- planes.nivel_diseno ya no se usa: queda por si hay que volver atrás.
ALTER TABLE planes ADD COLUMN funciones TEXT NOT NULL DEFAULT '';
ALTER TABLE planes ADD COLUMN descripcion TEXT NOT NULL DEFAULT '';
ALTER TABLE planes ADD COLUMN caracteristicas TEXT NOT NULL DEFAULT '';
ALTER TABLE planes ADD COLUMN destacado INTEGER NOT NULL DEFAULT 0;
UPDATE planes SET funciones = 'colores,logo_cabecera,portada,tarjetas,pie,kit_de_marca' WHERE nivel_diseno = 'acompanado';
UPDATE planes SET funciones = 'colores,logo_cabecera,portada,tarjetas,pie,fuentes,ancho,css,dominio,codigos,kit_de_marca' WHERE nivel_diseno = 'a_medida';
UPDATE planes SET destacado = 1
  WHERE id = (SELECT id FROM planes WHERE activo = 1 AND precio_centavos > 0 AND COALESCE(dias_prueba, 0) = 0 ORDER BY precio_centavos, lower(nombre), id LIMIT 1)
    AND (SELECT count(*) FROM planes WHERE activo = 1 AND (precio_centavos > 0 OR COALESCE(dias_prueba, 0) > 0)) > 1;
