-- Precio de envío por provincia, cargado a mano desde el panel.
--
-- Cada forma de entrega a domicilio puede tener un precio distinto por provincia. Una provincia sin fila usa el costo base de la
-- forma de entrega (metodos_entrega.costo_centavos); si ese costo es "a coordinar" (NULL), la provincia queda "a coordinar".
-- Un 0 es envío gratis a esa provincia. Sin filas, la forma de entrega funciona exactamente igual que antes.
-- Se borra junto con la forma de entrega.
CREATE TABLE metodo_entrega_provincias (
  metodo_id INTEGER NOT NULL REFERENCES metodos_entrega(id) ON DELETE CASCADE,
  provincia TEXT NOT NULL,
  costo_centavos BIGINT NOT NULL CHECK (costo_centavos >= 0),
  PRIMARY KEY (metodo_id, provincia)
);
