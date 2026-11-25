# Precio de envío por provincia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada forma de entrega a domicilio pueda tener un precio por provincia cargado a mano en el panel, y que el checkout cobre según la provincia elegida.

**Architecture:** Una tabla nueva `metodo_entrega_provincias` cuelga de `metodos_entrega`. Cada método leído trae `preciosProvincia: { [provincia]: centavos }` (vacío si no hay). La regla de costo vive en `src/pagos.js` y la usan `src/pedidos.js` (servidor, el que manda) y el script del checkout (espejo, solo para mostrar).

**Tech Stack:** Node 22, Express 5, EJS, PostgreSQL (PGlite en tests), `node --test`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-24-precio-envio-por-provincia-design.md`

## Global Constraints

- Textos de pantalla en español rioplatense con voseo ("Elegí", "Escribí"), como el resto del panel.
- Montos en centavos (`BIGINT`); se leen con `parsearPrecio`; mensaje de error de monto: `Escribí el monto en pesos, por ejemplo 4500 o 4.500`.
- `express.urlencoded({ extended: false })`: los campos del formulario son planos. Los precios van en campos `precioProvincia_<i>`, con `<i>` = posición de la provincia en `PROVINCIAS`.
- Todo objeto "entrega" puede venir sin `preciosProvincia` (se trata como `{}`): lo existente no cambia.
- Provincia con precio propio → ese precio (0 es gratis). Sin precio propio → `costo` base (si es `null`, "a coordinar"). "Gratis desde" vale por encima de cualquiera.
- Entrega con tabla y provincia todavía sin elegir → costo desconocido (`null`), el checkout dice "Elegí la provincia".
- Un retiro nunca lleva tabla. Las consultas siempre filtran por `tienda_id` (vía `metodos_entrega`).
- No hacer commit salvo que Valentino lo pida. Referencia: la suite tiene 6 fallas conocidas (apariencia CSS del panel, banners x2, migración de imágenes x2, recorte); no deben aparecer otras.

## Review Focus

1. Provincia que no existe (`Narnia`) o vacía en un envío a domicilio: se rechaza y no se crea el pedido (Task 3).
2. Un precio cargado con `0`: es "gratis" para esa provincia, no "usar el base" (Task 1).
3. Una forma de entrega que pasa de domicilio a retiro: la tabla desaparece (Task 2).
4. Borrar la forma de entrega borra sus precios por provincia (Task 2).
5. Un monto inválido en una provincia marca solo ese campo y conserva lo escrito en las demás (Task 2).

---

### Task 1: Regla de costo por provincia

**Files:**
- Create: `src/provincias.js`
- Modify: `src/pagos.js`, `src/pedidos.js`
- Test: `test/checkout.test.js` (sección "Cuentas")

**Interfaces:**
- Produces (`src/provincias.js`): `PROVINCIAS` (la lista actual, movida tal cual; `src/pedidos.js` la sigue re-exportando para no tocar a quien ya la importa de ahí).
- Produces (`src/pagos.js`):
  - `dependeDeProvincia(entrega): boolean` — hay al menos un precio por provincia.
  - `costoParaProvincia(entrega, provincia = ''): number | null` — precio propio de la provincia si existe (incluido 0), si no `entrega.costo`.
  - `textoCosto(metodo, provincia = ''): string` — "Según provincia" si `dependeDeProvincia` y no hay provincia; si no, "A coordinar" / "Gratis" / monto, según `costoParaProvincia`.
- Produces (`src/pedidos.js`): `costoEnvio(entrega, subtotal, provincia = '')` y `calcularTotales(subtotal, entrega, pago, provincia = '')`.

- [ ] **Step 1: Escribir los tests que fallan** (importar `costoParaProvincia`, `textoCosto` de `../src/pagos.js` y `validarCheckout` de `../src/pedidos.js`)

```js
test('el costo del envío sigue a la provincia: sin precio propio rige el base, y 0 es gratis', () => {
  const pais = { costo: 800000, gratisDesde: 6000000, preciosProvincia: { Córdoba: 450000, Jujuy: 0, 'Tierra del Fuego': 1200000 } };
  assert.equal(costoParaProvincia(pais, 'Córdoba'), 450000);
  assert.equal(costoParaProvincia(pais, 'Santa Fe'), 800000);
  assert.equal(costoParaProvincia(pais, 'Jujuy'), 0, 'un 0 cargado es gratis, no "usar el base"');
  assert.equal(costoEnvio(pais, 3000000, 'Córdoba'), 450000);
  assert.equal(costoEnvio(pais, 6000000, 'Tierra del Fuego'), 0, 'gratis desde vale sobre el precio de la provincia');
  assert.equal(costoEnvio(pais, 3000000, ''), null, 'con tabla y sin provincia todavía no se sabe');
  const coordinar = { costo: null, gratisDesde: null, preciosProvincia: { Córdoba: 450000 } };
  assert.equal(costoEnvio(coordinar, 3000000, 'Córdoba'), 450000);
  assert.equal(costoEnvio(coordinar, 3000000, 'Salta'), null, 'base a coordinar: la provincia sin precio queda a coordinar');
  assert.equal(costoEnvio({ costo: 450000, gratisDesde: null }, 3000000, 'Salta'), 450000, 'sin tabla nada cambia');
  assert.equal(calcularTotales(3000000, pais, null, 'Córdoba').total, 3450000);
  assert.equal(textoCosto(pais), 'Según provincia');
  assert.equal(textoCosto(pais, 'Jujuy'), 'Gratis');
  assert.match(textoCosto(pais, 'Córdoba'), /4\.500,00/);
});

test('Mercado Pago en línea: que el costo se coordine depende de la provincia', () => {
  const entrega = { id: 1, tipo: 'domicilio', nombre: 'Todo el país', costo: null, gratisDesde: null, aceptaEfectivo: false, preciosProvincia: { Córdoba: 450000 } };
  const pagos = [{ clave: 'mercadopago', descuento: 0, enLinea: true }];
  const campos = { nombre: 'Lucía Gómez', telefono: '351 15 123 4567', entrega: '1', pago: 'mercadopago', calle: 'Obispo Trejo 300', ciudad: 'Córdoba' };
  assert.equal(validarCheckout({ ...campos, provincia: 'Córdoba' }, { entregas: [entrega], pagos }).errores.pago, undefined);
  assert.match(validarCheckout({ ...campos, provincia: 'Salta' }, { entregas: [entrega], pagos }).errores.pago, /Mercado Pago/);
});
```

- [ ] **Step 2: Correr y ver que fallan** — `node --test test/checkout.test.js` → FAIL (`costoParaProvincia` no existe).
- [ ] **Step 3: Implementar** las tres funciones de `src/pagos.js`, mover `PROVINCIAS` a `src/provincias.js`, y en `src/pedidos.js`: `costoEnvio` devuelve `null` si no hay entrega, si `dependeDeProvincia(entrega) && !provincia`, o si `costoParaProvincia` da `null`; si no, aplica "gratis desde" y devuelve el costo. `crearPedido` pasa `datos.direccion.provincia` a `calcularTotales`. En `validarCheckout`, la condición de Mercado Pago pasa de `entrega.costo === null` a `costoParaProvincia(entrega, valores.provincia) === null`.
- [ ] **Step 4: Correr** `node --test test/checkout.test.js` → los tests nuevos y los de antes pasan.

### Task 2: Datos y panel de la forma de entrega

**Files:**
- Create: `src/migraciones/017_precio_envio_provincia.sql`
- Modify: `src/pagos.js`, `src/rutas/admin-pedidos.js` (`mostrarEntrega` pasa `provincias: PROVINCIAS` a la vista), `src/vistas/admin/entrega.ejs`, `src/publico/admin.js`
- Test: `test/checkout.test.js` (sección "Vidriera" o nueva sección "Precio por provincia")

**Interfaces:**
- Consumes: `PROVINCIAS`, `dependeDeProvincia`, `textoCosto` (Task 1).
- Produces: tabla `metodo_entrega_provincias (metodo_id INTEGER NOT NULL REFERENCES metodos_entrega(id) ON DELETE CASCADE, provincia TEXT NOT NULL, costo_centavos BIGINT NOT NULL CHECK (costo_centavos >= 0), PRIMARY KEY (metodo_id, provincia))`.
- Produces: `listarMetodosEntrega` y `leerMetodoEntrega` devuelven cada método con `preciosProvincia` (una sola consulta extra por llamada, filtrada por tienda).
- Produces: `validarMetodoEntrega(campos)` agrega `datos.preciosProvincia: { [provincia]: centavos }` y `formulario.preciosProvincia: { [provincia]: texto }`; errores con clave `precioProvincia_<i>`. `crearMetodoEntrega` / `editarMetodoEntrega` guardan la tabla en la misma transacción (editar reemplaza el conjunto entero). `formularioEntrega` devuelve `preciosProvincia` con `precioParaEditar`.

- [ ] **Step 1: Escribir los tests que fallan** (helper `const campo = (provincia) => \`precioProvincia_${PROVINCIAS.indexOf(provincia)}\`;` importando `PROVINCIAS` de `../src/provincias.js`, `listarMetodosEntrega` y `leerMetodoEntrega` de `../src/pagos.js`, `precioParaEditar` de `../src/productos.js`)

```js
test('validarMetodoEntrega lee el precio por provincia', () => {
  const ok = validarMetodoEntrega({ tipo: 'domicilio', nombre: 'Todo el país', costo: '8000', [campo('Córdoba')]: '4.500', [campo('Jujuy')]: '0', [campo('Salta')]: '  ' });
  assert.deepEqual(ok.errores, {});
  assert.deepEqual(ok.datos.preciosProvincia, { Córdoba: 450000, Jujuy: 0 }, 'vacío usa el base; 0 es gratis');
  const mal = validarMetodoEntrega({ tipo: 'domicilio', nombre: 'X', costo: '8000', [campo('Córdoba')]: 'abc', [campo('Chaco')]: '2000' });
  assert.deepEqual(Object.keys(mal.errores), [campo('Córdoba')], 'solo marca el campo con problemas');
  assert.equal(mal.formulario.preciosProvincia.Chaco, '2000', 'conserva lo escrito');
  assert.deepEqual(validarMetodoEntrega({ tipo: 'retiro', nombre: 'Local', costo: '0', [campo('Córdoba')]: '4500' }).datos.preciosProvincia, {});
  const coordinar = validarMetodoEntrega({ tipo: 'domicilio', nombre: 'Correo', aCoordinar: '1', gratisDesde: '60000', [campo('Córdoba')]: '4500' });
  assert.equal(coordinar.datos.gratisDesde, 6000000, '"gratis desde" se conserva si alguna provincia tiene precio');
});

test('el precio por provincia se guarda, se edita, se limpia al pasar a retiro y se borra con la forma de entrega', async () => {
  const { nav, tiendaId } = await tienda('porprovincia');
  const datos = { tipo: 'domicilio', nombre: 'Todo el país', costo: '8000', activo: '1' };
  assert.equal((await nav.enviar('/admin/pagos/entregas/nueva', { ...datos, [campo('Córdoba')]: '4500', [campo('Jujuy')]: '0' })).status, 302);
  const [metodo] = await listarMetodosEntrega(db, tiendaId);
  assert.deepEqual(metodo.preciosProvincia, { Córdoba: 450000, Jujuy: 0 });
  const formulario = await (await nav.pedir(`/admin/pagos/entregas/${metodo.id}`)).text();
  assert.match(formulario, new RegExp(`name="${campo('Córdoba')}"[^>]*value="${precioParaEditar(450000)}"`));
  await nav.enviar(`/admin/pagos/entregas/${metodo.id}`, { ...datos, [campo('Salta')]: '6000' });
  assert.deepEqual((await leerMetodoEntrega(db, tiendaId, metodo.id)).preciosProvincia, { Salta: 600000 }, 'editar reemplaza la tabla');
  await nav.enviar(`/admin/pagos/entregas/${metodo.id}`, { tipo: 'retiro', nombre: 'Local', costo: '0', activo: '1', [campo('Salta')]: '6000' });
  assert.deepEqual((await leerMetodoEntrega(db, tiendaId, metodo.id)).preciosProvincia, {}, 'un retiro no lleva tabla');
  await nav.enviar(`/admin/pagos/entregas/${metodo.id}`, { ...datos, [campo('Salta')]: '6000' });
  await nav.enviar(`/admin/pagos/entregas/${metodo.id}/borrar`, {});
  assert.equal((await db.prepare('SELECT count(*) AS n FROM metodo_entrega_provincias').get()).n, 0);
});
```

- [ ] **Step 2: Correr y ver que fallan** — `node --test test/checkout.test.js` → FAIL (no existe la tabla / `preciosProvincia`).
- [ ] **Step 3: Migración y capa de datos.** Crear la migración 017 con la tabla de arriba. En `src/pagos.js`: `filaAMetodo` agrega `preciosProvincia: {}` y las dos lecturas lo completan con la consulta de la tabla unida a `metodos_entrega` por `tienda_id`; `validarMetodoEntrega` lee los 24 campos con el mismo `precio()` interno, ignora la tabla si `tipo !== 'domicilio'`, y cambia la regla de "gratis desde" a: se descarta solo si ni el base ni ninguna provincia tienen precio mayor a 0; `crearMetodoEntrega` y `editarMetodoEntrega` van dentro de `enTransaccion` y escriben la tabla.
- [ ] **Step 4: Formulario del panel.** En `entrega.ejs`, dentro del formulario principal y debajo de "Costo", una tarjeta "Precio por provincia" (`data-precios-provincia`) con un campo por provincia (`<input name="precioProvincia_<i>" value=…>`, `name` antes de `value`, prefijo `$`, mensaje de error debajo de cada uno) y la ayuda: "Si dejás una provincia vacía, se cobra el costo de arriba. 0 es envío gratis a esa provincia." En `admin.js`: la tarjeta se oculta cuando el tipo elegido es retiro (también al cargar); el interruptor "a coordinar" deshabilita solo `[data-costo]`, y `[data-gratis-desde]` solo si además no hay ninguna provincia con monto. En `admin/pagos.ejs` no hace falta tocar nada: `textoCosto` ya dice "Según provincia".
- [ ] **Step 5: Correr** `node --test test/checkout.test.js` → pasan los tests nuevos y los de antes.

### Task 3: Checkout según la provincia, README y suite completa

**Files:**
- Modify: `src/rutas/tienda.js` (`opcionesCheckout`, `mostrarCheckout`), `src/vistas/tienda/checkout.ejs`, `src/publico/tienda.js` (función `checkout`), `README.md`
- Test: `test/checkout.test.js`

**Interfaces:**
- Consumes: `costoParaProvincia`, `dependeDeProvincia`, `textoCosto(metodo, provincia)`, `costoEnvio`/`calcularTotales` con provincia (Tasks 1 y 2).
- Produces: `datosCheckout.entregas[].preciosProvincia`; el `<select id="provincia">` lleva `data-provincia` y dispara el recálculo al cambiar.

- [ ] **Step 1: Escribir los tests que fallan**

```js
test('el checkout cobra el envío según la provincia elegida', async () => {
  const { nav, tiendaId } = await tienda('porprov');
  await configurar(nav);
  await nav.enviar('/admin/pagos/entregas/nueva', {
    tipo: 'domicilio', nombre: 'Correo a provincias', costo: '8000', gratisDesde: '100000', activo: '1',
    [campo('Córdoba')]: '4500', [campo('Tierra del Fuego')]: '12000',
  });
  const correo = (await listarMetodosEntrega(db, tiendaId)).find((e) => e.nombre === 'Correo a provincias');
  const pagina = (await vidriera('porprov', '/checkout?sku=BUZO-M&cantidad=1')).cuerpo;
  assert.match(pagina, new RegExp(`data-entrega-costo="${correo.id}">Según provincia<`));
  const datos = JSON.parse(pagina.match(/<script type="application\/json" id="datos-checkout">([^<]+)<\/script>/)[1]);
  assert.deepEqual(datos.entregas.find((e) => e.id === String(correo.id)).preciosProvincia, { Córdoba: 450000, 'Tierra del Fuego': 1200000 });

  const comprarEn = (provincia) => comprar('porprov', [
    ['sku', 'BUZO-M'], ['cantidad', '1'], ...Object.entries(CLIENTE), ...Object.entries({ ...DIRECCION, provincia }),
    ['entrega', String(correo.id)], ['pago', 'transferencia'],
  ]);
  const envioDe = async (provincia) => {
    const respuesta = await comprarEn(provincia);
    assert.equal(respuesta.status, 303);
    return (await db.prepare('SELECT envio_centavos FROM pedidos WHERE token = ?').get(respuesta.location.match(/\/pedido\/([\w-]+)/)[1])).envio_centavos;
  };
  assert.equal(await envioDe('Córdoba'), 450000);
  assert.equal(await envioDe('Santa Fe'), 800000, 'sin precio propio rige el base');
  assert.equal(await envioDe('Tierra del Fuego'), 1200000);

  const sinProvincia = await comprarEn('');
  assert.equal(sinProvincia.status, 400);
  assert.match(sinProvincia.cuerpo, /Elegí la provincia/);
  assert.equal((await comprarEn('Narnia')).status, 400, 'una provincia inventada se rechaza');
  const conError = await comprar('porprov', [
    ['sku', 'BUZO-M'], ['cantidad', '1'], ['nombre', 'Lu'], ['telefono', '12'], ...Object.entries({ ...DIRECCION, provincia: 'Córdoba' }),
    ['entrega', String(correo.id)], ['pago', 'transferencia'],
  ]);
  assert.equal(conError.status, 400);
  assert.match(conError.cuerpo, new RegExp(`data-entrega-costo="${correo.id}">\\$\\s4\\.500,00<`), 'al volver con errores muestra el costo de la provincia');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM pedidos WHERE tienda_id = ?').get(tiendaId)).n, 3);
});
```
- [ ] **Step 2: Correr y ver que falla** — `node --test test/checkout.test.js` → FAIL.
- [ ] **Step 3: Servidor y vista.** `opcionesCheckout(req, subtotal, provincia)` calcula `costoEnvio(e, subtotal, provincia)`, usa `textoCosto(e, provincia)` y marca "Gratis" solo si `costoParaProvincia(e, provincia) > 0` y el envío es 0; `mostrarCheckout` le pasa `valores.provincia`, calcula `calcularTotales(subtotal, entrega, pago, valores.provincia)`, agrega `preciosProvincia` a `datosCheckout.entregas` y pasa a la vista `costoEntregaElegida` (`costoParaProvincia` de la entrega elegida, o `undefined`). En `checkout.ejs`: `data-provincia` en el select; la condición de Mercado Pago usa `costoEntregaElegida === null`; la fila de envío dice "Elegí la provincia" cuando `totales.envio === null` y la entrega elegida `dependeDeProvincia` sin provincia, y "A coordinar" en los demás casos de `null`.
- [ ] **Step 4: Script del checkout** (`src/publico/tienda.js`, es un script plano sin imports: la regla se repite en miniatura). En `actualizar()`: leer `provincia` del select `[data-provincia]`; `costoLista(e)` = precio de la provincia si `Object.hasOwn(e.preciosProvincia, provincia)`, si no `e.costo`; `entrega.costo === null` pasa a `costoLista(entrega) === null` (Mercado Pago no disponible); el envío es `null` si la entrega tiene tabla y no hay provincia; el texto es "Elegí la entrega" / "Elegí la provincia" / "A coordinar" / "Gratis" / monto; recalcular también al cambiar `[data-provincia]`; y actualizar el texto de cada `[data-entrega-costo]` de las entregas con tabla ("Según provincia" sin provincia, si no el costo de esa provincia, con "Gratis" si el "gratis desde" ya se alcanzó).
- [ ] **Step 5: Correr** `node --test test/checkout.test.js` → pasan todos.
- [ ] **Step 6: Verificar en el navegador** (el script no tiene tests): con una tienda de prueba y una entrega con tabla, comprobar que (a) antes de elegir provincia el resumen dice "Elegí la provincia" y el total no suma envío; (b) al elegir Córdoba aparece $4.500 y el total se actualiza; (c) una provincia sin precio muestra el costo base; (d) con Mercado Pago conectado y base "a coordinar", el pago no está disponible hasta elegir una provincia con precio.
- [ ] **Step 7: README.** En "Envíos y pagos → Formas de entrega" describir el precio por provincia (vacío usa el base, 0 es gratis, el "gratis desde" vale encima); en "Qué falta" punto 3, aclarar que hoy hay costo fijo, precio por provincia cargado a mano o "a coordinar".
- [ ] **Step 8: Suite completa** — `npm test` → solo las 6 fallas conocidas.
