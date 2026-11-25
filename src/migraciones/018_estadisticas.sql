-- Dashboard del Inicio: casi todas sus cuentas filtran los pedidos de una tienda por fecha.
-- IF NOT EXISTS: esta migración se llamó 011_estadisticas.sql en la rama donde se hizo; si alguna base ya la aplicó con ese nombre, no falla.
CREATE INDEX IF NOT EXISTS pedidos_por_fecha ON pedidos (tienda_id, creado_en);
