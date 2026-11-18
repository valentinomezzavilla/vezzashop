# Sistema de diseño

Guía corta para que las pantallas nuevas se vean como las que ya existen. Todo sale de variables CSS: los componentes
no usan colores ni medidas sueltas.

## Panel y plataforma (`src/publico/admin.css`)

Estilo de producto profesional: superficies neutras, un solo color de marca, bordes finos y movimientos cortos.

- **Tipografía:** Inter (con la del sistema de respaldo). Cuerpo de 15 px; títulos de página de 26 px (24 px en el celular).
- **Color de marca:** azul `--primario` (`#2563eb`). Se usa en botones principales, la sección activa del menú, foco,
  interruptores y links. Nada más es azul.
- **Estados:** `--ok` (verde), `--error` (rojo), `--ambar`, `--violeta` (enviado), cada uno con su `-fondo` y `-borde`.
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
