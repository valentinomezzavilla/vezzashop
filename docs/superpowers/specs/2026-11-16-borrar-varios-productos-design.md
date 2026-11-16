# Borrar varios productos desde la lista — diseño

Fecha: 2026-11-16 · Tamaño: cambio chico

## Para qué

Hoy se puede borrar un producto solo desde el final de su editor, y de a uno. En la lista solo se puede ocultar.
Valentino quiere borrar **varios a la vez** desde la lista, por ejemplo para deshacer una carga masiva que salió mal.

## Enfoques considerados

- **A. Casillas y pantalla de confirmación (elegido).** Se marcan productos y una pantalla muestra cuáles se van a
  borrar antes de hacerlo. Es un paso más, pero se ve exactamente qué se borra, y borrar no tiene vuelta atrás.
- B. Casillas y un "¿Seguro?" en el mismo lugar. Es más rápido, pero no muestra qué se borra.
- C. "Borrar todos los de este filtro o búsqueda". Es fácil borrar de más. Con A se logra lo mismo de forma segura:
  se busca, se usa "seleccionar todos" y se confirma viendo la lista.

## Cómo funciona (lo que propuse yo, corregible)

- **En la lista:**
  - Cada fila (o tarjeta, en el celular) tiene una casilla.
  - En el encabezado hay una casilla para "seleccionar todos los de la lista", que respeta el filtro y la búsqueda
    activos.
  - Al marcar alguna aparece una barra con **"Borrar seleccionados (N)"**. Sin JavaScript, la barra se ve siempre y
    funciona igual.
- **Pantalla de confirmación:**
  - Lista los productos marcados (foto, nombre y cantidad de variantes).
  - Avisa: "También se borran sus fotos y variantes. Los pedidos ya hechos no cambian."
  - Tiene dos botones: **"Sí, borrar N productos"** y "Cancelar", que vuelve a la lista con el mismo filtro y la
    misma búsqueda.
- **Al confirmar:**
  - Se borran todos en una sola transacción y después se borran los archivos de sus fotos.
  - Vuelve a la lista con el aviso "Borramos N productos."
- **Seguridad:**
  - Solo se borran productos de la tienda que ingresó; los ids de otra tienda o inexistentes se ignoran.
  - Si no se eligió ninguno válido, se vuelve a la lista con el aviso "Elegí al menos un producto para borrar."
  - Todo pasa por el token CSRF, como el resto del panel.
- **Se mantiene** el botón "Borrar producto" del editor.

## Fuera de alcance

- Ocultar, mostrar o destacar varios a la vez. Es fácil de sumar después en la misma barra.
- Papelera o deshacer.
- Borrar todo lo de un filtro sin marcar.

## A criterio de quien lo construya

- Las casillas viven dentro de filas que ya tienen sus propios formularios (destacar, ocultar), así que se asocian a
  un formulario aparte con el atributo `form`.
- La ruta nueva tiene que registrarse antes de `/productos/:productoId`, o usar otra ruta, para no chocar con ella.
- Estilos de la barra y de la casilla siguiendo los del panel. Textos exactos menores.
