-- Mercado Pago dentro de cada tienda: la tienda conecta SU cuenta y el cliente paga en el momento, sin links armados a mano.
--
-- tienda_mercadopago: la conexión de la tienda. Los tokens se guardan CIFRADOS (src/secretos.js), nunca en claro.
--  modo: 'oauth' (la tienda tocó "Conectar con Mercado Pago": el token vence y se renueva solo con refresh_token) o 'token' (pegó su
--  Access Token a mano: no vence ni se renueva). mp_user_id / mp_apodo: la cuenta de Mercado Pago, para mostrarla en el panel.
CREATE TABLE tienda_mercadopago (
  tienda_id INTEGER PRIMARY KEY REFERENCES tiendas(id) ON DELETE CASCADE,
  modo TEXT NOT NULL CHECK (modo IN ('oauth', 'token')),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL DEFAULT '',
  expira_en TEXT,
  mp_user_id TEXT NOT NULL DEFAULT '',
  mp_apodo TEXT NOT NULL DEFAULT '',
  conectada_en TEXT NOT NULL DEFAULT ahora()
);

-- Para la calculadora de comisiones del panel: cuándo cobra la tienda su plata (instante, o a los 10, 18 o 35 días: cada plazo tiene su
-- tasa) y otros costos en centésimas de punto porcentual (150 = 1,5 %): retenciones, cuotas sin interés. Solo sirven para los cálculos.
ALTER TABLE ajustes_tienda ADD COLUMN mp_plazo TEXT NOT NULL DEFAULT 'instante' CHECK (mp_plazo IN ('instante', '10', '18', '35'));
ALTER TABLE ajustes_tienda ADD COLUMN mp_otros_bp INTEGER NOT NULL DEFAULT 0 CHECK (mp_otros_bp BETWEEN 0 AND 3000);

-- El cobro de un pedido con Mercado Pago.
--  mp_preferencia_id / mp_init_point: el pago que se le armó al comprador y la dirección a la que se lo manda (se reutiliza mientras no venza).
--  mp_pago_id / mp_pago_estado: el pago que informó Mercado Pago ('approved', 'pending', 'rejected', 'refunded'...).
--  mp_comision_centavos / mp_neto_centavos / mp_acreditacion: lo que Mercado Pago se queda, lo que le llega a la tienda y cuándo (NULL / ''
--  mientras no se sabe). Son los valores reales que informa Mercado Pago, no los de la calculadora.
ALTER TABLE pedidos ADD COLUMN mp_preferencia_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN mp_init_point TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN mp_preferencia_creada_en TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN mp_pago_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN mp_pago_estado TEXT NOT NULL DEFAULT '';
ALTER TABLE pedidos ADD COLUMN mp_comision_centavos BIGINT;
ALTER TABLE pedidos ADD COLUMN mp_neto_centavos BIGINT;
ALTER TABLE pedidos ADD COLUMN mp_acreditacion TEXT NOT NULL DEFAULT '';
