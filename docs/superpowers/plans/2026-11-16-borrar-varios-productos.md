# Borrar varios productos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** marcar varios productos en la lista del panel y borrarlos juntos, después de confirmar en una pantalla que los muestra.

**Architecture:** las casillas de la lista se asocian (con el atributo `form`) a un formulario aparte que hace POST a `/admin/productos/borrar-varios`. Esa ruta muestra la confirmación. La confirmación hace POST a `/borrar-varios/confirmar`, que borra en una transacción y después borra los archivos de las fotos. El JavaScript solo mejora la experiencia: barra con contador y "seleccionar todos".

**Tech Stack:** Express 5, EJS, PostgreSQL (`pg`, y PGlite en tests) con la capa async de `src/db.js`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-borrar-varios-productos-design.md`

## Global Constraints

- Solo se borran productos de `req.session.usuario.tiendaId`. Los ids ajenos, inexistentes o que no son números se ignoran.
- Todos los POST pasan por `verificarCsrf`. `volver` solo acepta rutas que empiezan con `/admin/` y no con `//`; si no, se usa `/admin/productos`.
- Textos exactos:
  - botón de la barra: `Borrar seleccionados (N)`;
  - aviso de la confirmación: `También se borran sus fotos y variantes. Los pedidos ya hechos no cambian.`;
  - botón de confirmar: `Sí, borrar N producto(s)`;
  - aviso al terminar: `Borramos N producto(s).`;
  - aviso sin selección: `Elegí al menos un producto para borrar.`
- Sin JavaScript tiene que funcionar igual: la barra se ve siempre y el contador no hace falta.
- En el celular (≤ 700px) la casilla va a la izquierda del nombre, en la misma línea.
- Tests: `npm test` (PGlite). Rama `borrar-varios-productos`, que al final se mergea a `master` y se pushea (autorizado por Valentino).

## Review Focus

1. **Doble envío o ids repetidos** (`ids=5&ids=5`): borra una vez y el aviso cuenta 1. Test en la Tarea 1.
2. **Un producto que se borró desde otra pestaña entre la confirmación y el "Sí, borrar"**: el aviso cuenta solo los que realmente se borraron. Si no quedó ninguno, avisa "Elegí al menos…". Test en la Tarea 1.
3. **`volver` con un sitio externo**: redirige a `/admin/productos`. Test en la Tarea 1.
4. **Productos con pedidos**: `pedido_items` no tiene clave foránea a productos, así que borrar no falla y el pedido sigue mostrando lo comprado. Test en la Tarea 1 (pedido de la vidriera, después borrar, después el pedido sigue en el panel).
5. **Ruta `/productos/borrar-varios` contra `/productos/:productoId`**: las rutas nuevas se registran antes de las que tienen `:productoId`.

---

### Task 1: Borrar varios productos

**Files:**
- Modify: `src/productos.js` (junto a `borrarProducto`), `src/rutas/admin-tienda.js`, `src/vistas/admin/productos.ejs`, `src/publico/admin.js`, `src/publico/admin.css`, `README.md` (lista de lo que hace el panel)
- Create: `src/vistas/admin/borrar-productos.ejs`
- Test: `test/gestion.test.js`

**Interfaces:**
- Produces, en `src/productos.js`:
  - `idsDeFormulario(valor: unknown): number[]`. Normaliza `req.body.ids`, que puede ser string, arreglo o nada. Deja enteros positivos, sin repetidos, hasta 1000.
  - `productosParaBorrar(db, tiendaId, ids): Promise<Array<{ id, nombre, variantes: number, foto: string|null }>>`. Solo los de la tienda, ordenados por `lower(nombre), id`.
  - `borrarProductos(db, tiendaId, ids): Promise<{ borrados: number, fotos: string[] }>`. Una sola transacción, con `= ANY(?)` y un arreglo de JS.
- En `admin-tienda.js`, un helper `volverSeguro(valor): string` que reemplaza la validación que hoy está en línea en la ruta de marcas (mismo comportamiento).

- [ ] **Step 0:** `git checkout -b borrar-varios-productos` y commit del spec y el plan.

- [ ] **Step 1: Write the failing tests** en `test/gestion.test.js`, después de `'ocultar y destacar desde el listado'`.
```js
test('borrar varios desde el listado: se confirma viendo la lista y se borran solo esos, con sus fotos', async () => {
  const { nav, tiendaId } = await tiendaConPanel('borrarvarios');
  const crear = async (nombre, sku) => (await nav.enviar('/admin/productos/nuevo',
    comoPares(formularioProducto({ nombre, variantes: [{ sku, precio: '1000', stock: '1' }] })), { desde: '/admin/productos/nuevo' })).headers.get('location');
  const a = await crear('Taza Roja', 'T1'); const b = await crear('Plato Azul', 'P1'); await crear('Vaso Verde', 'V1');
  await nav.enviarArchivos(`${a}/fotos`, { fotos: [{ contenido: PNG, nombre: 'a.png' }] }, { desde: a });
  const id = (ubicacion) => ubicacion.split('/').pop();
  const volver = '/admin/productos?filtro=todos&q=a';

  const lista = await (await nav.pedir('/admin/productos')).text();
  assert.match(lista, /data-seleccionar-todos/);
  assert.match(lista, new RegExp(`name="ids" value="${id(a)}" form="borrar-varios"`));

  const pares = [['ids', id(a)], ['ids', id(b)], ['ids', id(b)], ['volver', volver]];
  const confirmacion = await nav.enviar('/admin/productos/borrar-varios', pares, { desde: '/admin/productos' });
  assert.equal(confirmacion.status, 200);
  const html = await confirmacion.text();
  assert.match(html, /Taza Roja/); assert.match(html, /Plato Azul/); assert.doesNotMatch(html, /Vaso Verde/);
  assert.match(html, /Sí, borrar 2 productos/);
  assert.match(html, /Los pedidos ya hechos no cambian/);
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Taza Roja/, 'mostrar la confirmación no borra nada');

  const borrado = await nav.enviar('/admin/productos/borrar-varios/confirmar', pares, { desde: '/admin/productos' });
  assert.equal(borrado.headers.get('location'), volver);
  const despues = await (await nav.pedir('/admin/productos')).text();
  assert.match(despues, /Borramos 2 productos/);
  assert.doesNotMatch(despues, /Taza Roja|Plato Azul/);
  assert.match(despues, /Vaso Verde/);
  assert.equal(readdirSync(path.join(dirSubidas, String(tiendaId))).length, 0, 'se borran las fotos');

  const otraVez = await nav.enviar('/admin/productos/borrar-varios/confirmar', pares, { desde: '/admin/productos' });
  assert.equal(otraVez.headers.get('location'), volver);
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Elegí al menos un producto para borrar/);
});

test('borrar varios no toca productos de otra tienda ni redirige afuera', async () => {
  const { nav: navA } = await tiendaConPanel('borrara');
  const ajeno = (await navA.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' }))
    .headers.get('location').split('/').pop();
  const { nav: navB } = await tiendaConPanel('borrarb');

  const sinNada = await navB.enviar('/admin/productos/borrar-varios', [['ids', ajeno], ['ids', 'x']], { desde: '/admin/productos/nuevo' });
  assert.equal(sinNada.headers.get('location'), '/admin/productos');
  await navB.enviar('/admin/productos/borrar-varios/confirmar', [['ids', ajeno], ['volver', 'https://otro-sitio.com']], { desde: '/admin/productos/nuevo' })
    .then((r) => assert.equal(r.headers.get('location'), '/admin/productos'));
  assert.match(await (await navA.pedir('/admin/productos')).text(), /Remera Básica/);
});

test('borrar un producto que ya tiene pedidos no cambia el pedido', async () => {
  const { nav, tiendaId } = await tiendaConPanel('borrarconpedido');
  const ubicacion = (await nav.enviar('/admin/productos/nuevo',
    comoPares(formularioProducto({ nombre: 'Taza Vendida', variantes: [{ sku: 'TV1', precio: '1000', stock: '5' }] })), { desde: '/admin/productos/nuevo' })).headers.get('location');
  const pedido = await crearPedido(db, tiendaId, [{ sku: 'TV1', cantidad: 1 }], DATOS_PEDIDO); // DATOS_PEDIDO = el DATOS de test/concurrencia.test.js
  await nav.enviar('/admin/productos/borrar-varios/confirmar', [['ids', ubicacion.split('/').pop()]], { desde: '/admin/productos' });
  const vista = await nav.pedir(`/admin/pedidos/${pedido.id}`); // si la ruta usa el número de pedido, usar ese campo
  assert.equal(vista.status, 200);
  assert.match(await vista.text(), /Taza Vendida/);
});
```

- [ ] **Step 2: Run** `node --test test/gestion.test.js`. Expected: FAIL. La lista no tiene `data-seleccionar-todos` y la ruta nueva no existe (la respuesta no es 200).

- [ ] **Step 3: Implementar.**
  - **Funciones en `productos.js`:** según la interfaz de arriba.
  - **Rutas en `admin-tienda.js`,** antes de `router.get('/productos/:productoId', …)`:
    - `POST /productos/borrar-varios`: renderiza `admin/borrar-productos` con `{ productos (con urlFoto), volver }`. Si no queda ninguno válido, avisa con `avisar(req, 'error', …)` y redirige a `volverSeguro(volver)`.
    - `POST /productos/borrar-varios/confirmar`: `borrarProductos`, después `borrarImagen` por cada foto. El aviso es ok `` `Borramos ${plural(n, 'producto', 'productos')}.` `` o error si `n === 0`. Al final redirige a `volverSeguro(volver)`.
  - **Lista (`productos.ejs`):**
    - un `<form id="borrar-varios" … data-barra-seleccion>` antes de la tabla, con `_csrf`, `volver` y el botón `boton boton-peligro-suave boton-chico` con `Borrar seleccionados (<span data-cuenta-seleccion>0</span>)`;
    - una primera columna `th/td.celda-seleccion`: en el encabezado, `<input type="checkbox" data-seleccionar-todos aria-label="Seleccionar todos los productos de la lista">`; en cada fila, `<input type="checkbox" name="ids" value="<%= p.id %>" form="borrar-varios" aria-label="Seleccionar <%= p.nombre %>">`.
  - **Pantalla de confirmación (`borrar-productos.ejs`):**
    - título `Borrar N producto(s)`;
    - una tarjeta con la lista (miniatura, nombre, `N variante(s)`) y el aviso de las fotos y los pedidos;
    - un formulario a `/admin/productos/borrar-varios/confirmar` con `_csrf`, `volver` y un `ids` oculto por producto, con el botón `boton boton-peligro` `Sí, borrar …` y el enlace `Cancelar` a `volver`.
  - **JavaScript (`admin.js`),** si existe `[data-barra-seleccion]`:
    - la barra se oculta (`hidden`) mientras no haya nada marcado, y el contador se actualiza;
    - "seleccionar todos" marca o desmarca todas las casillas, y queda `indeterminate` si solo hay algunas marcadas.
  - **CSS:** una columna angosta para la casilla. En el bloque de ≤ 700px, la celda de selección no ocupa la línea completa (cambiar `td:first-child { flex: 1 1 100% }` para que aplique a la celda del producto).
  - **README:** en la lista de lo que hace el panel, "borrar varios productos a la vez desde la lista, con confirmación".

- [ ] **Step 4: Run** `npm test`. Expected: todo PASS.

- [ ] **Step 5: Prueba a mano** con `npm run dev` en un navegador de escritorio y con el ancho de un celular: marcar, ver el contador, usar "seleccionar todos", ver la confirmación, cancelar y confirmar.

- [ ] **Step 6: Commit** `git commit -m "Borrar varios productos desde la lista, con confirmación"`. Después: revisión final, merge a `master` y `git push origin master`.
