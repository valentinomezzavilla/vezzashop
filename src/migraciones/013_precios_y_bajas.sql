-- Aumentos de precio con excepciones, y aviso de baja de la suscripción.
--  tiendas.precio_fijo_centavos: lo que paga este cliente por mes aunque el precio de su plan cambie (NULL = paga el del plan).
--    Se fija al sacar a un cliente de un aumento, o a mano desde su ficha; se borra al cambiarlo de plan.
--  suscripciones.aviso_baja_enviado_en: cuándo se le mandó el mail "cancelaste tu suscripción, tu tienda sigue activa hasta...".
--    Vale una sola vez por suscripción, la haya dado de baja el cliente (en su panel o en su cuenta de Mercado Pago) o el administrador.
ALTER TABLE tiendas ADD COLUMN precio_fijo_centavos BIGINT CHECK (precio_fijo_centavos >= 0);
ALTER TABLE suscripciones ADD COLUMN aviso_baja_enviado_en TEXT;
