-- Huella (SHA-256 del contenido) de cada foto de producto: la carga masiva la usa para no duplicar fotos.
ALTER TABLE producto_fotos ADD COLUMN huella TEXT;
CREATE INDEX fotos_por_huella ON producto_fotos (producto_id, huella);
