-- Dashboard del Inicio: casi todas sus cuentas filtran los pedidos de una tienda por fecha.
CREATE INDEX pedidos_por_fecha ON pedidos (tienda_id, creado_en);
