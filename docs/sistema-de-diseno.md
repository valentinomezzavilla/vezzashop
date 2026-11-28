# Sistema de diseño

Guía corta para que las pantallas nuevas se vean como las que ya existen. Todo sale de variables CSS: los componentes
no usan colores ni medidas sueltas.

## Panel y plataforma (`src/publico/admin.css`)

Estilo de producto profesional: superficies neutras, un solo color de marca, bordes finos y movimientos cortos.

- **Tipografía:** Inter (con la del sistema de respaldo). Cuerpo de 15 px; títulos de página de 26 px (24 px en el celular).
- **Colores del logo de Vezza:** la marca es el índigo `--primario` (`#3b2ee4`, `#4b40ec` en oscuro) y el texto es la
  tinta del logo (`--texto: #13121a`; en oscuro, el blanco `#f5f5f7`). Los grises llevan un matiz índigo (248°) para que
  las superficies combinen con el logo, con la misma luminosidad de antes. `--primario` se usa en botones principales,
  la sección activa del menú, foco, interruptores y links; `--primario-texto` es la versión para texto (en oscuro,
  `#8f89ff`). Todos los pares de texto cumplen contraste AA; si cambiás un valor, revisalo. Nada más es índigo.
- **Estados:** `--ok` (verde), `--error` (rojo), `--ambar`, `--violeta` (enviado, en fucsia para que no se confunda con
  el índigo de la marca), cada uno con su `-fondo` y `-borde`.
  Las pastillas (`.pastilla-*`) y los avisos (`.aviso-*`) ya los combinan.
- **Claro y oscuro:** los dos temas tienen los mismos tokens. Los valores oscuros están dos veces (media query y
  `data-tema="oscuro"`) y tienen que ser iguales: lo controla `test/apariencia.test.js`.
- **Campos:** borde `--borde-campo`, con contraste 3:1 (es lo único que muestra dónde se escribe). En el celular miden
  44 px y 16 px de letra (con menos, Safari agranda la página).
- **Tamaños táctiles:** con `pointer: coarse` los botones miden al menos 40-44 px.
- **Radios:** 6 px pastillas, 8 px botones y campos, 12 px tarjetas, 16 px paneles grandes.
- **Estructura:** menú lateral fijo en la computadora. Hasta 860 px: barra arriba, accesos rápidos abajo
  (Inicio, Pedidos, Productos, Diseño y "Más") y el menú completo como panel lateral (`#menu-panel`; sin JavaScript
  funciona con `:target`, con JavaScript lo maneja `admin.js`).
- **Tablas:** cada `.tabla-contenedor` es un *container*: cuando la tabla no entra, las filas pasan a tarjetas según el
  ancho real (no el de la pantalla), así también se ve bien en una notebook chica con el menú abierto.

- **Gráficos y números del Dashboard** (`.dash-*`, `.grafico`, `.ranking`, `.apilada`): son HTML y CSS, sin librerías ni imágenes, así el
  texto se lee igual en el celular y sigue al tema claro y al oscuro. Las columnas y barras van en `--primario-texto` (en oscuro
  tiene contraste suficiente sobre la superficie; `--primario` no). Para varias series se usan en este orden `--primario-texto`,
  `--ok-solido`, `--ambar-solido`, `--violeta`, `--texto-tenue` y `--error-solido` (`.dc-1` a `.dc-6`), y los estados de un pedido
  usan los mismos colores que sus pastillas (`.dc-nuevo`, `.dc-pagado`...). **El color nunca va solo**: cada serie tiene su leyenda con
  texto y cada columna su detalle (al pasar el mouse o tocarla, y en una tabla aparte). El contenido de la pestaña es un *container*
  (`.dashboard-contenido`): los números se acomodan según su ancho real, y nada puede ensanchar la página (`overflow-x: clip`, y las
  grillas con `minmax(0, 1fr)`). Los números y los bloques son tarjetas sobre el fondo de la página (`--superficie`, `--borde-tarjeta`).
  Los gráficos se arman en `src/util/grafico.js`; los parciales están en `src/vistas/parciales/dashboard/` y la página, en `admin/dashboard.ejs`.
- **Card que lleva a otra pantalla** (`.dashboard-acceso`, la del Dashboard en el Inicio): el título es el único link y se estira con `::after`
  para que toda la card sea clickeable (sin links anidados); el foco se ve en la card entera (`:has(a:focus-visible)`).
  La card de Diseño que lleva al kit de marca (`.marca-acceso`, `parciales/marca-acceso.ejs`) reusa el mismo patrón y solo cambia la grilla.
- **Kit de marca y maqueta** (`.marca-*`, `.maqueta-*`; `admin/marca.ejs` y `admin/maqueta.ejs`): los archivos del kit son una grilla de tarjetas (`.marca-archivos`) con la imagen sobre un
  fondo ajedrezado, para que se vean los logos transparentes, y su nombre con elipsis; los colores usan `.selector-color` y las opciones de estilo, `.opcion-tipo`. Lo bloqueado por el plan usa
  `.nivel-bloqueado` como en Diseño. La maqueta se ve en un `<iframe sandbox="">` (`.maqueta-iframe`, siempre sobre fondo blanco: es otra página con sus propios colores) con un selector
  de tamaño (computadora o celular) hecho solo con CSS (`:has(input:checked)`), y mientras se genera hay un bloque de espera con `role="status"`; `admin.js` lo consulta y recarga la página
  cuando termina (sin JavaScript queda el botón "Actualizar"). El estado nunca va solo en color: lleva su texto (*Generando*, *Lista*, *Con problemas*).

## Vidriera (`src/publico/tienda.css`)

Editorial y limpia: mucho blanco, las fotos mandan, siempre en modo claro.

- **Identidad de cada tienda:** `--acento` (su color principal) y `--acento-texto` (blanco o negro, el que se lea).
  Todo lo que va sobre el acento usa `--acento-texto`.
- **Tipografía:** la del sistema en Apple (San Francisco) e Inter en el resto.
- **Botones:** píldora; el principal usa el acento, el secundario es `.boton-contorno`.
- **Fotos de producto:** 4:5, radio de 12 px, fondo suave mientras cargan; al pasar el mouse, la segunda foto o un zoom leve.
- **Celular:** carrusel y galería de borde a borde, carrito como hoja que sube desde abajo, barra de compra fija en la ficha.

## Movimiento

Transiciones de 140-320 ms con una sola curva (`--suave`). Nada se mueve solo en bucle. Todo respeta
"reducir movimiento" del sistema.
