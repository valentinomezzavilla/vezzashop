# Fotos en la carga masiva — diseño

Fecha: 2026-11-16 · Tamaño: cambio mediano

## Para qué

Hoy las fotos se suben de a una desde el editor de cada producto, y la carga masiva no las toca. Con un catálogo
grande, eso es lo que más tiempo le lleva al cliente. Queremos que la planilla también cargue las fotos.

## Qué se pidió (decidido con Valentino)

- La plantilla suma dos columnas: **`img`** y **`link-img`**.
- **`img`**: la foto pegada dentro del Excel, en la celda de esa fila.
- **`link-img`**: un link a la foto. El sistema la descarga al importar.
- Si una de las dos está vacía, se usa la otra.
- Las fotos se buscan **en la vista previa** (enfoque A, ver abajo): los links que no andan se ven como problemas
  antes de confirmar, igual que un precio mal escrito.

## Lo que propuse yo (corregible)

- **Si están las dos completas, gana `img`**, porque es la foto que el cliente está viendo en la planilla.
- **Las fotos son del producto**, como hoy. Si un producto ocupa varias filas (talles, colores), las fotos de todas
  sus filas se suman en el orden de las filas. Si el producto no tenía fotos, la de la primera fila queda como
  principal. Si ya tenía, las nuevas se agregan al final y la principal no cambia.
- **Sin duplicados:** una foto idéntica (mismo contenido) a otra que el producto ya tiene, o repetida en otra fila,
  no se vuelve a agregar. Así, volver a subir la misma planilla no duplica nada. Esto vale también para las fotos que
  se subieron a mano antes de este cambio.
- **Respeta el tope de 10 fotos por producto.** Si con la planilla un producto pasaría de 10, es un problema de la
  vista previa: no se guarda nada.
- **Formas de pegar la foto que se aceptan:** "Colocar en celda" de Excel (la foto queda dentro de la celda) y la
  foto flotando encima de la celda (cuenta la celda donde está su esquina de arriba a la izquierda). Si hay varias
  fotos flotando sobre la misma celda de `img`, entran todas, de izquierda a derecha.
- **Una foto pegada en una fila con datos pero fuera de la columna `img`** es un problema de la vista previa, para
  que un producto no quede sin foto sin que nadie se entere.
- **Si en `img` hay texto en vez de una foto** (por ejemplo, un link), es un problema: "los links van en link-img".
- **Links de Google Drive y Dropbox** compartidos se convierten solos al link de descarga directa.
- **El Excel puede pesar hasta 30 MB** (hoy son 5 MB, y con fotos pegadas ese límite se pasa enseguida).
- **Hasta 200 links por planilla.** Si hay más, es un problema, con la sugerencia de subirla en partes. El límite
  existe para que la vista previa no tarde minutos.
- La vista previa suma un dato: **cuántas fotos se van a agregar**.
- Encabezados alternativos que también se reconocen: `imagen` y `foto` para `img`; `link imagen`, `link foto` y
  `url imagen` para `link-img`.

## Problemas que muestra la vista previa (por fila)

- El link no responde, da error o tarda demasiado.
- El link no lleva a una imagen, o la imagen no es JPG, PNG ni WEBP.
- La foto (pegada o descargada) pesa más de 5 MB.
- La foto pegada no es JPG, PNG ni WEBP (por ejemplo, un dibujo de Office o un GIF).
- El producto pasaría de 10 fotos.
- Foto fuera de la columna `img`, texto en `img`, más de 200 links.

## Fuera de alcance

- Fotos por variante (por ejemplo, que al elegir un color cambie la foto).
- Varios links en una misma celda de `link-img`. Si hace falta, es fácil de sumar después.
- Borrar o reemplazar fotos, o cambiar la principal, desde la planilla. Una celda vacía no borra nada, como hoy.
- Descargar fotos en segundo plano.

## Lo que haría que esto salga mal aunque "funcione"

- Que un link caído deje un producto sin foto y nadie se entere.
- Que volver a subir la planilla duplique las fotos.
- Que el servidor se pueda usar para pedir direcciones internas a través de `link-img` (por ejemplo,
  `http://localhost` o la red de Coolify).

## Restricciones

- **Descargas seguras:** solo `http` y `https`. Se resuelve el nombre del servidor y se rechazan las direcciones
  privadas, locales y link-local, también después de cada redirección (máximo 3). Hay un tiempo máximo por foto
  (unos 15 s), un tope de 5 MB que corta la descarga apenas se pasa, el tipo se decide por el contenido
  (`tipoDeImagen`) y se descargan pocas a la vez (unas 4).
- **Las transacciones de `node:sqlite` son sincrónicas** (`enTransaccion`). Los archivos se escriben fuera de la
  transacción, y si la transacción falla, se borran los que se escribieron.
- **Se mantiene la regla de la carga masiva:** si hay un solo problema, no se guarda nada. Esto incluye las fotos.

## Enfoques considerados

- **A. Buscar las fotos en la vista previa (elegido).** Al subir el Excel se sacan las fotos pegadas y se descargan
  las de los links. Los errores se ven antes de confirmar y confirmar es rápido. En contra: con muchos links, la
  vista previa tarda unos segundos.
- **B. Descargar recién al confirmar.** La vista previa es instantánea, pero un link caído aparece después de
  confirmar: o falla todo, o el producto queda sin foto sin aviso.
- **C. Fotos en segundo plano.** Sirve para catálogos enormes, pero necesita una cola de tareas y una pantalla de
  seguimiento. Hoy no se justifica.

## Cómo (decidido)

- **Base de datos:** migración `005`, que suma a `producto_fotos` una columna `huella` (hash SHA-256 del
  contenido) con un índice por `(producto_id, huella)`. Las fotos que se suben desde el editor también guardan su
  huella.
- **Leer las fotos del Excel:** se abre el `.xlsx` como zip con `fflate` (ya está instalado como dependencia de
  `read-excel-file`; pasa a ser dependencia directa) y se leen dos cosas de la primera hoja: los dibujos anclados a
  celdas (`xl/drawings`) y las fotos colocadas en celda (`xl/richData` + `xl/metadata.xml`).
- **Entre la vista previa y la confirmación:** las fotos ya obtenidas (pegadas y descargadas) se guardan junto al
  Excel pendiente en `dirImportaciones`. Al confirmar se usan esas, sin volver a descargar. La limpieza de pendientes
  viejos (24 h) y el descarte al subir otro archivo también las borran.
- **Plantilla:** columnas `img` y `link-img` (en celeste, porque no son obligatorias), con la columna `img` más
  ancha. La hoja de instrucciones explica cómo pegar la foto (Insertar > Imágenes > Colocar en celda), qué links
  sirven (Drive compartido con "cualquier persona con el link") y la regla de prioridad.
- **Textos:** se actualizan la página de carga masiva (límite de 30 MB, mención de las fotos) y el README.

## A criterio de quien lo construya

- Cómo se reparte el código en módulos dentro de `src/importacion/`.
- Si el XML se lee con un parser (por ejemplo `saxen`, que ya está instalado) o con expresiones regulares tolerantes
  a prefijos de namespace.
- Cómo calcular la huella de las fotos viejas que no la tienen: al migrar, al arrancar o la primera vez que se
  necesita.
- La redacción exacta de los mensajes de error.
- Cómo armar en los tests un `.xlsx` con fotos. `write-excel-file` genera fotos flotantes; la foto "en celda" hay
  que armarla a mano con `fflate`.
