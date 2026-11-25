# Precio de envío por provincia (carga manual)

Estado: aprobado por Valentino el 24/11/2026. Cambio chico: el diseño cubre lo conversado.

## Intención
Hoy cada forma de entrega a domicilio tiene un único costo para todo el país. La tienda necesita cargar a mano, desde el panel,
un precio distinto por provincia. Es una solución provisoria: más adelante se cotizará por API con Correo Argentino / Andreani / OCA
(ver "Qué falta" del README), y esto sirve de base y de respaldo.

## Objetivos
- Cada forma de entrega a domicilio puede tener una tabla "Precio por provincia" (24 provincias de `PROVINCIAS`).
- El checkout muestra el costo según la provincia elegida y recalcula el total en vivo.
- Las tiendas y formas de entrega que no cargan nada siguen funcionando **exactamente igual** que hoy.

## No objetivos
- Cotizar con las empresas por API.
- Precio por código postal, por peso o por medidas.
- "No enviamos a esta provincia": se resuelve dejándola "a coordinar".
- Un precio "a coordinar" solo para una provincia cuando el base tiene precio.

## Decisiones (de Valentino)
- La tabla vive **en cada forma de entrega** (no es global): "Moto en Córdoba" puede tener un precio único y "Todo el país" una tabla.
- **Provincia sin precio** → usa el precio base de la forma de entrega. Si el base es "a coordinar", esa provincia queda "a coordinar".
- **"Gratis desde $X"** sigue valiendo por encima del precio de la provincia.
- **Checkout:** hasta elegir provincia muestra "Elegí la provincia"; al elegirla aparece el costo y el total se actualiza.
  El servidor vuelve a calcular todo al confirmar (el navegador nunca decide el precio).

## Enfoques considerados
1. **Tabla por forma de entrega** (elegido): encaja con el modelo actual (`metodos_entrega`), no cambia lo existente y deja un lugar natural
   para que, a futuro, cada forma de entrega sea "Correo Argentino", "Andreani", etc. con su propia tabla.
2. Una tabla global por tienda: más simple de cargar, pero obliga a que todas las formas de entrega compartan precios; descartado.
3. Zonas (agrupar provincias): más cómodo con muchas provincias, pero agrega un concepto nuevo que hoy no hace falta; descartado.

## Qué decide quien construye
- Forma de la tabla (se sugiere `metodo_entrega_provincias (metodo_id, provincia, costo_centavos)`, migración 017) y su borrado en cascada.
- Diseño exacto del bloque en `admin/entrega.ejs` y validación (mismos mensajes y formato de monto que el costo base).
- Cómo llevar la provincia a `costoEnvio` en `src/pedidos.js`, a `calcularTotales`, y al script del checkout (`src/publico/tienda.js`),
  sin duplicar la regla más de lo imprescindible.
- Dónde más se usa el costo del envío (Mercado Pago en línea, resumen del pedido, mensajes) y revisarlos.
- Texto del costo en la lista de opciones del checkout antes de elegir provincia (p. ej. "Desde $X" o "Según provincia").
- Tests: costo por provincia, provincia sin precio, base "a coordinar", gratis desde, migración sin tocar lo existente.
