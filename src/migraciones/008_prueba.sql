-- Período de prueba y cierre automático por vencimiento, configurables en cada plan.
--  dias_prueba: al asignarle este plan a un cliente, vence a los N días (NULL: no tiene prueba).
--  suspender_al_vencer: si la fecha de vencimiento del cliente pasa, su tienda se cierra sola hasta que se le registre un pago
--  o se extienda la fecha. No hace falta ninguna tarea programada: se calcula al atender cada pedido.
ALTER TABLE planes ADD COLUMN dias_prueba INTEGER CHECK (dias_prueba BETWEEN 1 AND 365);
ALTER TABLE planes ADD COLUMN suspender_al_vencer INTEGER NOT NULL DEFAULT 0;

-- Si ya existía un plan "Prueba" (por ejemplo, cargado con npm run cargar-planes), queda con 7 días y cierre automático.
UPDATE planes SET dias_prueba = 7, suspender_al_vencer = 1 WHERE lower(nombre) = 'prueba';
