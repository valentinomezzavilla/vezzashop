-- Usar una maqueta en la tienda real, y deshacerlo.
--
-- maquetas.textos: los textos que escribió la IA para esa maqueta (JSON: anuncio, eslogan, bajada, boton, sobreTitulo, sobreTexto, valores, cierre),
--   para poder llevarlos a la tienda. Vacío: la maqueta no los guardó (es de antes, o salió con textos de ejemplo, que no se llevan a una tienda real).
-- maquetas.kit: lo que tenía el kit de marca cuando se pidió la maqueta (JSON: colorPrincipal y el nombre del archivo del logo y de la primera foto),
--   para que "usar esta maqueta" lleve lo que se ve en ella aunque el kit haya cambiado después. Vacío: las maquetas de antes usan el kit de hoy.
ALTER TABLE maquetas ADD COLUMN textos TEXT NOT NULL DEFAULT '';
ALTER TABLE maquetas ADD COLUMN kit TEXT NOT NULL DEFAULT '';

-- La última vez que la tienda usó una maqueta: qué había antes y qué se puso, para poder deshacerlo.
-- Una fila por tienda: usar otra maqueta reemplaza a la anterior (solo se deshace lo último).
--  cambios: JSON [{ clave, antes, despues }]; clave es colorPrincipal, logo, franjaTexto, descripcion o banner.
--  maqueta_id va sin clave foránea: la maqueta se puede borrar sin perder cómo deshacer lo que se aplicó.
CREATE TABLE maqueta_usada (
  tienda_id INTEGER PRIMARY KEY REFERENCES tiendas(id),
  maqueta_id INTEGER,
  cambios TEXT NOT NULL,
  usada_en TEXT NOT NULL DEFAULT ahora()
);
