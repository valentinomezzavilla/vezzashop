# Plataforma de tiendas

Plataforma propia de tiendas online. Varias tiendas (una por cliente) conviven en la misma
instalación, y cada cliente entra a su panel en `/admin` con su email y clave.

**Estado:** ya funcionan el panel (inicio, pedidos, productos con fotos, categorías, carga masiva desde Excel,
diseño, envíos y pagos, y cuenta), la **vidriera pública de cada tienda en su subdominio** y el **checkout**:
el cliente elige cómo recibir el pedido y cómo pagar, y el pedido llega al panel. Cada tienda puede **conectar su cuenta
de Mercado Pago** para que el cliente pague en el momento (y el pedido pase a Pagado solo); sin conectarla, el cobro con
tarjeta sigue siendo manual (link de pago que manda la tienda; ver [Mercado Pago en cada tienda](#mercado-pago-en-cada-tienda)).

## El panel

| Sección | Qué hace el cliente |
|---|---|
| **Inicio** | Ve el link de su tienda, el aviso de pedidos nuevos, números (visibles, ocultos, sin stock, unidades), una lista de pasos para completar la tienda y alertas de productos sin stock o con pocas unidades. Cuando ya está hecho el último paso, la lista desaparece y en su lugar se ven los últimos pedidos. |
| **Pedidos** | Ve los pedidos que llegan desde la tienda (por atender, nuevos, pagados, enviados, entregados, cancelados), busca por número, nombre, teléfono o email, y en cada uno: productos, datos del cliente, entrega, pago, el próximo paso con un botón ("Marcar como pagado", "Enviado" / "Listo para retirar", "Entregado"), WhatsApp al cliente y cancelar (devuelve el stock). Cada fila de la lista tiene un menú **Acciones** (ver el pedido, el paso siguiente, escribirle por WhatsApp, cancelar); en el celular, donde la fila es una tarjeta, hay un botón **Ver**. |
| **Productos** | Busca por nombre, marca o SKU; filtra (visibles, ocultos, destacados, con stock, pocas unidades, sin stock, en oferta, sin foto) y por categoría (con sus subcategorías, o sin categoría); ordena por nombre, precio, stock o antigüedad; oculta o destaca con un clic; crea, edita y borra productos. Con varios marcados en la lista: mostrar, ocultar, destacar, quitar de destacados o borrar (se confirma viendo cuáles). **"Ocultar los sin stock"** saca de la tienda, de una vez, todo lo visible que no tiene stock. |
| **Editor de producto** | Nombre, descripción, marca, visible, destacado, categorías y variantes (hasta 3 tipos, por ejemplo Talle y Color) con SKU, precio, oferta y stock. Crea todas las combinaciones de una vez y aplica un precio o stock a todas las variantes. Hasta 10 fotos por producto, ordenables; la primera es la principal. |
| **Categorías** | Crea, renombra, mueve dentro de otra y borra (con sus subcategorías; los productos no se borran). |
| **Carga masiva** | Ver más abajo. |
| **Diseño** | Ver más abajo. |
| **Envíos y pagos** | Ver más abajo. |
| **Cuenta** | Cambia el nombre de la tienda (el link no cambia; lo cambia quien administra la plataforma) y su clave (mínimo 6 caracteres). |

Todos los campos de clave (ingreso y cambio de clave, en el panel y en la plataforma) tienen un **ojo** al costado para ver lo
que se escribe; `admin.js` lo agrega solo y la clave vuelve a ocultarse al enviar el formulario.

Los productos **destacados** aparecen en una sección propia arriba de la portada (hasta 8).

## Página de presentación (landing)

El dominio principal (`/`) muestra la página que presenta la plataforma: para qué sirve, capturas, objetivos, planes, lo que
viene y preguntas frecuentes. El panel sigue en `/admin` (la landing tiene el link "Ingresar a mi panel"). Es una vista EJS sin
sesión ni cookies: `src/vistas/landing.ejs` (HTML, CSS y JS juntos, con los colores y tipografías de la marca VEZZA), sus datos en
`src/landing.js` y sus imágenes en `src/publico/landing/img/` (capturas en WebP y `og.png`, la imagen que se ve al compartir el link).

- **Movimiento.** Las animaciones viven aparte del HTML, en `src/publico/landing/movimiento.css` y `movimiento.js` (landing) y en `src/publico/alta.css` y `alta.js`
  (alta de cuentas y pantalla de suscripción), sin librerías: titulares que suben palabra por palabra, escena 3D que sigue al mouse, cifras que
  cuentan, animaciones atadas al scroll, píldora deslizante en las pestañas, borde de colores en el plan recomendado, transición de vista entre
  la landing y el alta (la tarjeta del plan viaja de una página a otra), medidor de fuerza de la clave y confeti al confirmarse el pago. Todo está
  dentro de `prefers-reduced-motion: no-preference` (con "reducir movimiento" la página queda quieta y completa), anima solo `transform` y
  `opacity`, y lo más nuevo (`animation-timeline`, `@view-transition`, `::details-content`) está detrás de `@supports`: los navegadores que no lo
  tienen ven la versión de siempre. Un test (`test/landing.test.js`) verifica que ninguna animación quede fuera de ese bloque.
- **Planes: salen de la base.** Las tarjetas de la sección Planes y los precios de los datos estructurados para Google se arman
  con los planes de `/plataforma/planes`: lo que editás ahí (nombre, precio, topes, días de prueba) se ve en la landing en el acto.
  Salen los planes **activos** con precio o con período de prueba, del más barato al más caro; un plan **pausado**, o uno gratis y
  sin prueba (como "Sin límites", el interno de las tiendas que ya existían), no se muestra. Cada tarjeta lista los topes de
  productos, fotos y banners (un tope vacío se muestra como "sin tope" o con el máximo de la plataforma: 10 fotos y 6 banners). El
  texto de arriba de cada tarjeta sale de los topes y de la prueba, y el **Recomendado** es el plan pago más barato (si hay más de
  uno). Si no hay planes para mostrar, la sección queda con un botón para consultar. Se ordenan y redactan en `armarPlanes`.
- **Contacto.** Los botones "Probar gratis" y "Elegir plan" abren WhatsApp con un mensaje armado (el número está en `WHATSAPP`,
  al final del `<script>` de `landing.ejs`). Si lo dejás vacío, llevan a la sección de contacto, que apunta a `vezzadev.com` e Instagram.
- **Capturas.** Son de una tienda de ejemplo ("Nube Studio") con datos inventados. Para renovarlas, levantá la app con datos de
  prueba, sacá las pantallas a 1440 px de ancho y convertilas a WebP de unos 1500 px (`sharp`).
- **Dominio.** La imagen para compartir (`og:image`) usa `https://vezzashop.com`; cambiala en el `<head>` si el dominio es otro.
- Lo cubre `test/landing.test.js` (la portada responde, no crea sesión, sus imágenes existen y los planes siguen a la base).

## Requisitos

- Node.js 22 o más nuevo.
- PostgreSQL en producción (en Coolify se crea con un clic). Para desarrollar y correr los tests no hace falta instalar nada:
  sin `DATABASE_URL` se usa PGlite, un Postgres que corre dentro de Node y guarda sus datos en `data/pglite`.

## Instalación

```bash
npm install
```

## Configuración

Las credenciales van en un archivo `.env` **fuera del repo**. Se busca en este orden:

1. La ruta que indique la variable `ARCHIVO_ENV`.
2. `~/.config/plataforma-tiendas/.env` (en Windows: `C:\Users\<usuario>\.config\plataforma-tiendas\.env`).
3. `.env` en la raíz del proyecto (está en `.gitignore`, pero si el proyecto está en OneDrive se sincroniza).

Copiá `.env.example` a alguna de esas ubicaciones y completá `SECRETO_SESION`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

En el servidor, poné también `DOMINIO` con tu dominio (por ejemplo `vezzashop.com`). En tu compu
dejalo vacío y se usa `localhost`.

`DATABASE_URL` es la conexión a PostgreSQL (`postgres://usuario:clave@host:5432/base`) y en producción es
obligatoria. En tu compu dejala vacía y se usa PGlite. Las migraciones (`src/migraciones/*.sql`) se aplican solas al arrancar.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com` | Da de alta un cliente: crea la tienda y su usuario, y muestra la clave **una sola vez**. |
| `npm run migrar-imagenes -- --dry-run` | Muestra qué haría para pasar las imágenes subidas antes del formato WebP al formato nuevo (ver [Imágenes](#imágenes)). Sin `--dry-run` las convierte. |
| `npm run crear-superadmin -- --email vos@ejemplo.com` | Crea **tu** cuenta de administrador de la plataforma (ver [Administración de la plataforma](#administración-de-la-plataforma)). Con `--resetear` genera una clave nueva si la olvidás. |
| `npm run cargar-planes` | Crea los planes sugeridos si no existen (ver [Administración de la plataforma](#administración-de-la-plataforma)). |
| `npm run dev` | Levanta el servidor y lo reinicia cuando cambia el código. Panel en http://localhost:3000/admin y cada tienda en http://&lt;slug&gt;.localhost:3000 |
| `npm start` | Levanta el servidor (para producción). |
| `npm test` | Corre todos los tests (con PGlite, sin instalar nada). Para probar contra un PostgreSQL de verdad: `PRUEBAS_DATABASE_URL=postgres://usuario:clave@host:5432/base npm test` (cada prueba usa su propio esquema y lo borra al terminar). |

## Carga masiva desde Excel

En el panel, **Carga masiva**: el cliente descarga la plantilla, la completa y la sube. Antes de
guardar ve un resumen (o la lista de errores, con el número de fila) y confirma.

Reglas:

- Cada fila es una variante. Las filas con el mismo **Nombre** forman un solo producto.
- Obligatorios: **SKU** y **Nombre** en todas las filas, y **Precio** en las variantes nuevas.
- Hasta 3 atributos por producto (`Atributo 1` / `Valor 1`, por ejemplo Talle / M).
- Categorías con `>` para subcategorías y coma para varias: `Ropa > Remeras, Ofertas`.
- Precios en pesos: `12500`, `12.500` y `12.500,50` son válidos. Se guardan en centavos.
- Volver a subir la planilla **no duplica**: actualiza por SKU. Las celdas vacías no borran nada,
  y los productos que no están en la planilla no se tocan.
- Si hay un solo error, no se guarda nada (tampoco las fotos).
- Archivo `.xlsx` de hasta 30 MB.

Fotos, con las columnas **img** y **link-img**:

- **img**: la foto pegada en la celda (Excel 365: Insertar > Imágenes > Colocar en celda) o flotando encima,
  con su esquina de arriba a la izquierda en esa celda. Varias fotos flotantes en la misma celda entran todas,
  de izquierda a derecha.
- **link-img**: el link de la foto. Se descarga en la vista previa; los links compartidos de Google Drive y
  Dropbox se convierten al link de descarga. Hasta 200 links por planilla, 15 s y 5 MB por foto.
- Si están las dos, gana **img**. Una foto pegada fuera de la columna img, texto en img o una foto pegada que no
  se puede leer (por ejemplo, agrupada con otras) es un error: ninguna fila se queda sin foto en silencio.
- Por planilla: hasta 90 s de descargas y 200 MB de fotos en total. Si se pasa, es un error y hay que subirla en
  partes. Del Excel se descomprimen solo las partes necesarias, y cada foto solo si pesa hasta 5 MB.
- Las fotos son del producto: se suman las de todas sus filas, en orden (si no tenía fotos, la primera queda
  como principal). Se reconocen por su contenido (huella SHA-256), así que volver a subir la planilla no las
  duplica. Hasta 10 fotos por producto, JPG, PNG o WEBP.
- Las descargas solo van a direcciones públicas: se rechazan localhost, las redes privadas y las que aparecen
  después de una redirección.
- Entre la vista previa y la confirmación, el Excel y las fotos esperan en `DIR_IMPORTACIONES`, en una carpeta
  por importación que se borra al confirmar o a las 24 horas.

## Vidriera de cada tienda

Cada tienda se ve en un subdominio del `DOMINIO`, armado con su slug (el nombre sin tildes ni
espacios): la tienda "Ropa Linda" queda en `ropa-linda.vezzashop.com`. El dominio a secas (y `www`)
es el del panel; si un cliente entra a `/admin` desde su subdominio, lo manda al panel.

- Catálogo, categorías (incluye los productos de las subcategorías) y ficha de producto con selector
  de variantes.
- **Buscador** (lupa o tecla `/`) con sugerencias mientras se escribe y página `/buscar`. Busca en el
  nombre, la marca y los SKU, sin importar tildes ni mayúsculas.
- **Filtros** (con stock, en oferta, rango de precio) y **orden**, en la URL para poder compartirlos.
  El catálogo se pagina de a 24 con "Ver más productos".
- **Carrito**: se agrega con cantidad, vive en el navegador (`localStorage`) y al abrirlo se piden precios y
  stock actuales a `/api/carrito`. Muestra el subtotal y avisa los descuentos por forma de pago, sin dar por
  hecho cómo se va a pagar. Si la tienda configuró envíos y pagos, sigue en el **checkout**; si no, el pedido
  se manda armado por WhatsApp (solo si la tienda cargó su WhatsApp).
- **Checkout** (`/checkout`): datos del cliente, forma de entrega (con la dirección si es envío), forma de pago y
  notas, con el total recalculado en vivo (descuento de la forma de pago sobre los productos + envío, gratis
  desde un monto o "a coordinar"). Todo se vuelve a calcular en el servidor con los precios y el stock de la
  base. Al confirmar se crea el pedido y **se descuenta el stock**; si alguien compró lo mismo mientras tanto,
  avisa y no crea nada. Tiene campo trampa para robots, chequeo de origen y hasta 10 pedidos por hora por IP.
- **Página del pedido** (`/pedido/<código>`, el link no se puede adivinar): estado, cómo pagar (alias/CBU con
  botón para copiar y "Enviar el comprobante por WhatsApp"; link de pago de Mercado Pago; efectivo), entrega y
  detalle. Al llegar desde el checkout, vacía el carrito.
- Ficha: galería con visor a pantalla completa, compartir, "Avisame cuando haya stock",
  "También te puede gustar" y barra fija para agregar en el celular.
- Vista previa al compartir el link (Open Graph), datos de producto para Google (JSON-LD),
  `canonical` e ícono de la pestaña con el logo (o la inicial en el color de la tienda).
- Transiciones entre páginas con View Transitions; todo respeta "reducir movimiento".
- Solo se muestran los productos visibles y con al menos una variante. Las categorías sin productos
  visibles no aparecen en el menú.
- **Productos sin stock:** cada tienda elige en Diseño qué hacer con ellos: mostrarlos como a los demás (lo de siempre), mostrarlos al final de cada lista u ocultarlos
  del catálogo, las categorías y el buscador (su link directo sigue abierto, con la etiqueta "Sin stock").
- **Muchas categorías:** la portada muestra las primeras 8 como botones y un "Ver todas (N)" con el resto (el pie, las primeras 12); en Diseño se puede elegir mostrar todas
  o ninguna.
- No pueden usarse como nombre de tienda: `www`, `admin`, `panel`, `api`, `app`, `mail`.

## Diseño de la tienda

En el panel, **Diseño**: cada cliente configura cómo se ve su vidriera. Todo lo nuevo viene con el valor de siempre
(la migración `009` no cambia ninguna tienda existente) y se guarda en `ajustes_tienda`. La vidriera lo aplica con
variables CSS que pone `estiloDeTienda` en el `<head>`, así que no hay estilos sueltos por tienda.

- **Identidad:** logo y color principal (botones y, si no se elige otro, la franja; el color del texto se elige solo
  para que se lea bien).
- **Franja de anuncios:** el texto de arriba de todo (envío gratis, descuentos, etc.), con un **link** opcional
  (una página de la tienda o un `https://`) y un **color propio** opcional.
- **Estilo:** la **tipografía** (la del sistema, Moderna/Poppins, Elegante/Playfair Display, Geométrica/Montserrat o
  Suave/Nunito; las que no son la del sistema se piden a Google Fonts solo si la tienda las elige) y las **esquinas**
  de botones, tarjetas y fotos (redondeadas, suaves o rectas). Ver `FUENTES` y `ESQUINAS` en `src/diseno.js`.
- **Cabecera y menú:** con vista previa en vivo. El **estilo del menú** puede ser una *barra de categorías* (las
  que no entran en la pantalla pasan solas a un botón "Más", con sus subcategorías) o un *menú desplegable* (un botón
  abre la lista, también en la computadora). Se elige el **tamaño del logo** (32, 40 o 56 px de alto; en el celular no
  pasa de 44) y **qué categorías de primer nivel aparecen en el menú de arriba** (el pie de página las muestra todas).
  Una categoría sin productos visibles no se muestra, la elijan o no.
- **Catálogo:** orden por defecto (nombre, más nuevos o precio; el visitante lo puede cambiar), **tamaño de las
  tarjetas** (chicas, normales o grandes: 5, 4 o 3 por fila en la computadora; en el celular siempre 2), qué hacer con los **productos sin stock**
  (mostrar, al final u ocultar), cuántas **categorías** se ven en la portada (las primeras 8, todas o ninguna) y los
  **títulos** de la portada ("Todos los productos" y "Destacados" se pueden cambiar).
- **Sobre la tienda:** una **descripción** corta (sale en el pie y como descripción para buscadores y para el link
  que se comparte) y una **nota al pie** (condiciones de compra, aclaraciones).
- **Contacto y redes:** WhatsApp (botón flotante), Instagram, Facebook, TikTok, email, dirección (con un link al
  mapa que agrega "Cómo llegar") y horario de atención.
- **Banners de bienvenida:** hasta 6 imágenes para el carrusel de la portada, con imagen opcional
  para celular, link y orden. Al elegir la imagen aparece el **recortador**: un marco con la proporción
  exacta del banner en la tienda (3:1 en la computadora, cuadrado en el celular, ver `PROPORCION_BANNER`
  en `src/imagenes.js`) donde se arrastra y se acerca la imagen, con los puntitos y las flechas del carrusel
  dibujados encima y un aviso si la parte elegida es chica y se va a ver borrosa. El celular usa la misma
  imagen con su propio recorte, o una aparte si se sube. Lo que se ve en el marco es lo que muestra la tienda:
  el navegador manda qué parte quedó a la vista (`recorteComputadora` y `recorteCelular`, como
  `x,y,ancho,alto` entre 0 y 1) y el servidor recorta con sharp antes de achicar. Sin JavaScript la imagen se
  guarda entera, como siempre.

Las imágenes (JPG, PNG o WEBP, hasta 5 MB) se guardan en `data/subidas/<id de tienda>/`. El tipo se
reconoce por el contenido del archivo; los SVG no se aceptan porque pueden traer scripts. En
producción, `data/` tiene que estar en un volumen persistente (la base de datos no: está en PostgreSQL).

Para producción hace falta un solo dominio, con dos registros DNS apuntando al servidor:
`vezzashop.com` y `*.vezzashop.com`. El certificado HTTPS de `*.vezzashop.com` necesita un comodín
(DNS challenge en el proxy). Ver [Publicar en Coolify](#publicar-en-coolify).
Detrás del proxy, `NODE_ENV=production` hace que se respete el host original (`trust proxy`).

### Diseño por plan

Cada plan tiene un **nivel de diseño** (se elige en `/plataforma/planes`) que dice cuánto de la vidriera puede personalizar quien lo tiene. En **Diseño**,
lo que el plan no incluye aparece **bloqueado** (con el nivel que lo trae) y arriba hay una comparación de qué incluye cada nivel:

| Nivel | Qué suma |
| --- | --- |
| **Esencial** | Lo que ya existía: logo, color principal, franja, tipografía y esquinas, cabecera y menú, catálogo (orden, tamaño de tarjetas, sin stock, categorías), sobre la tienda, contacto, banners. |
| **Acompañado** | **Colores** de fondo, texto, tarjetas y cabecera (el texto tiene que leerse: se exige un contraste mínimo de 4,5 a 1 y, si solo se cambia el fondo, el texto se ajusta solo); **logo** a la izquierda, al centro o a la derecha; cabecera fija o que se va con el scroll; **portada** con las secciones que se quieren (banners, **ofertas** —los productos con precio promocional— y destacados) en el orden que se elija, y banners dentro de la página o de punta a punta; **tarjetas de producto** sin marco, con borde o con sombra, foto vertical, cuadrada o apaisada y texto a la izquierda o centrado; **pie** claro, oscuro, del color de la marca o de otro color. |
| **A medida** | **CSS propio** (hasta 20.000 caracteres; sin `<`, `@import`, `expression()`, `javascript:` ni `url()` que no sean https o rutas de la tienda), **tipografías de Google Fonts** a elección para títulos y texto, **ancho de la página** (angosto, normal, ancho, todo el ancho), **dominio propio** y **códigos de seguimiento** (píxeles, analítica) en la cabecera y el pie, que carga quien administra la plataforma desde la ficha del cliente. |

El nivel se aplica **al leer**: si un cliente baja de plan, lo que había elegido de más queda guardado pero la vidriera deja de aplicarlo, y vuelve si sube.
Una tienda sin plan, o con el plan interno "Sin límites", vale como A medida (nada cambia para las que ya existían). Las migraciones asignan Acompañado y A medida a los
planes de esos nombres; los demás quedan en Esencial. Todo lo nuevo tiene como valor por defecto la vidriera de siempre: mientras la tienda no elija nada, no cambia nada.
Los colores no se aplican al checkout ni a la página del pedido (tienen sus propias tarjetas y fondos fijos); el CSS propio, sí. El nivel viaja también en la tarjeta de cada
plan de la landing y de `/admin/suscripcion`, y un cambio de nivel figura entre los cambios de un plan que se avisan por mail a sus clientes. Todo está en `src/diseno-por-plan.js`.

### Dominio propio

Los clientes del plan **A medida** pueden usar su propio dominio (`www.mitienda.com`). El recorrido tiene tres pasos:

1. **Solicitado.** El cliente lo escribe en *Cuenta → Dominio propio* (o lo carga la plataforma desde su ficha). El panel le muestra el registro DNS que tiene que crear en el proveedor
   del dominio: un **CNAME** al dominio del panel (para `www.` o cualquier subdominio) o un registro **A** (para el dominio sin `www`, que no puede ser un CNAME; para mostrarlo hace falta
   `IP_SERVIDOR`, la IP pública del servidor).
2. **DNS verificado.** *Verificar ahora* comprueba el DNS (CNAME al panel, o direcciones A iguales a las del panel o a `IP_SERVIDOR`). Si más tarde deja de apuntar, vuelve al primer paso.
3. **Activo.** Lo activás vos desde la ficha del cliente en `/plataforma` (en la lista de clientes aparece "Dominio por activar" mientras falte). **Antes**, agregalo en Coolify:
   aplicación → *Configuration* → *Domains* → sumá `https://www.mitienda.com` a los que ya hay (separados por coma) y *Redeploy*; Coolify pide solo el certificado. Abrí
   `https://www.mitienda.com`, comprobá que carga con el candado y recién ahí tocá **Activar**.

Con el dominio activo, la tienda se resuelve por ese host (`buscarTiendaPorDominio`), el subdominio de siempre **redirige con un 301** (con el mismo camino y las mismas búsquedas), y los mails,
los links de pedidos, "Ver mi tienda" y las vueltas de Mercado Pago usan el dominio propio. Una vez activo, el cliente ya no lo puede cambiar ni quitar desde su panel (lo hacés vos: *Desactivar* o *Quitar*).
Si usan Cloudflare, el registro tiene que estar en "solo DNS" (nube gris): con el proxy, el DNS no apunta al servidor y no se puede verificar (igual podés activarlo a mano si ya anda).
Un dominio no puede ser de la plataforma ni de otra tienda. Dominios sin `www` (`mitienda.com`) y subdominios del cliente sirven por igual.

## Envíos y pagos

En el panel, **Envíos y pagos**: lo que el cliente elige al finalizar la compra. La tienda vende online cuando
tiene al menos una forma de entrega y una de pago activas (si no, el carrito sigue por WhatsApp).

- **Formas de entrega** (hasta 10, ordenables, se pueden pausar): *retiro en el local* (no pide dirección) o
  *envío a domicilio* (pide calle, ciudad, provincia y código postal). Cada una con nombre, detalle (zona,
  demora, horarios), costo, "gratis desde $X" o costo "a coordinar", y si acepta efectivo. Hay modelos para
  empezar: retiro en el local (con la dirección de la tienda), envío en moto en Córdoba Capital y envío a
  todo el país; se abren completos para revisar el costo antes de guardar.
- **Formas de pago:** *transferencia* (alias, CBU/CVU, titular, banco y % de descuento; el descuento también
  se muestra en cada producto), *efectivo* (% de descuento; solo con entregas que lo aceptan) y *Mercado Pago*
  (con la cuenta de la tienda conectada, el cliente paga en el momento; si no, la tienda manda un link de pago por
  el total; texto para el cliente y cuotas sin interés, que se muestran en cada producto). El descuento se aplica
  solo sobre los productos, no sobre el envío.

### Mercado Pago en cada tienda

Cada tienda cobra con **su propia cuenta** de Mercado Pago (la plata va directo a ella; la plataforma no la toca). Desde *Envíos y pagos →
Mercado Pago* se conecta de dos maneras: el botón **Conectar con Mercado Pago** (la tienda autoriza desde Mercado Pago, sin ver ni copiar
claves; requiere que cargues `MP_CLIENT_ID` y `MP_CLIENT_SECRET`, ver abajo) o **pegando su Access Token** (siempre disponible: el panel explica
dónde se saca). Los tokens se guardan **cifrados** (AES-256-GCM, con una clave derivada de `SECRETO_SESION`: igual que las sesiones, esa variable
no puede cambiar, o cada tienda tiene que volver a conectar) y nunca se vuelven a mostrar. El token del botón vence a los 180 días y se **renueva
solo** (se guarda el refresh token que devuelve cada renovación).

Con la cuenta conectada:

1. **Cobro en el momento.** Si el comprador elige Mercado Pago, al confirmar el pedido se lo lleva **directo a Mercado Pago** (se arma el pago con los
   productos y el envío, con el pedido como referencia; vale 3 días). Si algo falla, el pedido igual queda hecho y en su página tiene un botón
   **Pagar con Mercado Pago** para intentar de nuevo (reutiliza el mismo pago mientras no venza). Con una entrega de costo "a coordinar" Mercado Pago
   no se puede elegir (todavía no hay un monto final).
2. **El pedido pasa a Pagado solo.** Cuando Mercado Pago avisa (`POST /webhooks/mercadopago/tienda/<id>`) o el comprador vuelve a la tienda, la
   plataforma **consulta el pago a Mercado Pago con el token de la tienda** y recién ahí, si está aprobado, es de ese pedido y por su monto
   exacto, lo pasa a *Pagado* (queda en el historial y, si la tienda activó los avisos por mail, le llega el mail al comprador). Lo que trae el
   aviso o la URL nunca decide nada: un aviso armado a mano no logra nada. Es idempotente (Mercado Pago repite los avisos). Un pago que llega a
   un pedido cancelado, un segundo pago a un pedido ya pago o una devolución dejan una **nota interna** (no la ve el comprador) y no cambian el
   estado: reembolsar o no lo decide la tienda desde Mercado Pago. Si el aviso no llegó, **Verificar pago** en el pedido lo consulta a mano.
3. **Cuánto cobró Mercado Pago.** En el pedido pago, la tienda ve el estado del pago, lo que se quedó Mercado Pago (comisión e impuestos), lo que le
   llega y cuándo se acredita: son los valores **reales** que informa Mercado Pago.
4. **Calculadora de comisiones** (misma sección, también sin conectar): la tienda elige cuándo quiere recibir la plata y otros costos (cuotas sin interés,
   retenciones) y ve **cuánto le queda** de una venta (por ejemplo $50.000) y, al revés, **a cuánto tiene que vender** para que le queden $50.000,
   más una tabla con los cuatro plazos. Las tasas son las que publica Mercado Pago para link de pago y Checkout Pro en Argentina, **sin IVA**: 6,29 % al
   instante, 4,39 % a los 10 días, 3,39 % a los 18 y 1,49 % a los 35, más 21 % de IVA sobre la comisión, sin cargo fijo; pueden variar por provincia
   (consultadas en noviembre de 2026; si cambian, se editan en `src/publico/comisiones-mp.js`, el único lugar). La cuenta la hace el mismo código
   en el servidor y en el navegador.

Sin la cuenta conectada nada cambia: el cliente recibe el link de pago por WhatsApp y la tienda marca el pedido como pagado a mano.

**Para activar el botón "Conectar con Mercado Pago"** (una sola vez, en tu aplicación de [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app)):
habilitá OAuth/"Redirect URLs" y cargá `https://<tu dominio del panel>/admin/pagos/mercadopago/volver` (exactamente así), y poné en el `.env`
(en Coolify, como variables de entorno) `MP_CLIENT_ID` y `MP_CLIENT_SECRET` (los de la aplicación; las dos juntas o ninguna). Sin ellas el botón no aparece
y queda el token pegado. Probalo con una cuenta de prueba de vendedor y otra de comprador antes de usarlo con clientes: los tests automáticos usan
un Mercado Pago de mentira, así que lo que **no** está probado contra el de verdad es el canje del código OAuth, la renovación del token (si el
refresh token es de un solo uso) y el formato exacto de las fechas del pago; todo eso está en `src/mercadopago-tiendas.js`.

Los pedidos guardan una copia de lo comprado (productos, precios, entrega, dirección), así no cambian si después
cambia el catálogo. Cancelar un pedido devuelve el stock de lo que todavía existe.

**Envío de los pedidos a domicilio.** El estado general del pedido (nuevo, pagado, enviado, entregado, cancelado) sigue siendo el de los filtros, el stock y cancelar;
en un pedido a domicilio, su **paso del envío** lo afina: *En preparación → Despachado → En camino → Entregado* (preparar no cambia el estado general; despachado y en camino
son "enviado"; entregado es "entregado"). En el detalle del pedido, la tarjeta **Envío** deja elegir el paso, la **empresa** (Correo Argentino, Andreani, OCA, moto o cadete propio u otra),
el **n.º de seguimiento**, un link de seguimiento exacto (opcional) y una aclaración para el comprador ("Llega entre el 12 y el 14"). Los botones de un clic del listado y del "¿Qué sigue?"
pasan al paso siguiente; despachar lleva a la tarjeta para cargar los datos. Cada movimiento queda en el **historial** del pedido (una vuelta atrás por un error se anota, pero el
comprador no la ve), el pedido tiene una **nota interna** que solo ve la tienda y una hoja para **imprimir el remito** (dirección grande, productos y control de bultos).
Sin un link exacto, "Seguir mi envío" lleva al sitio de la empresa (correoargentino.com.ar, andreani.com, oca.com.ar), donde el comprador escribe el número: no se inventan links
directos porque cada empresa cambia los suyos.

**Lo que ve quien compró.** La página de su pedido (`/pedido/<código>`) trae una **línea de tiempo** con lo que ya pasó (con su fecha), el paso de ahora y lo que falta: *Recibimos tu pedido →
Pago confirmado → En preparación → Despachado → En camino → Entregado* (sin el pago si se paga al recibir; en un retiro, *Listo para retirar → Retirado*), y, cuando ya salió, la empresa, el número
con un botón para copiarlo, la aclaración y "Seguir mi envío".

**Avisarle a quien compró.** Cada movimiento se puede comunicar de tres maneras: la propia página del pedido; **WhatsApp**, con un mensaje armado según el estado (con el seguimiento cuando ya salió);
y **mail** (lo manda n8n, ver [Mails con n8n](#mails-con-n8n)), desde el nombre de la tienda y respondiendo a su email de contacto. El mail se tilda en cada actualización del envío; y en
*Envíos y pagos → Avisos al cliente* la tienda puede activar que **cada cambio de estado** le llegue solo al comprador (por defecto está apagado: nada cambia hasta que la tienda lo active).
Una corrección hacia atrás nunca se avisa. Aparte, "Volver a avisar por mail" reenvía el estado de ahora.

## Administración de la plataforma

Quien opera la plataforma tiene su propio panel en **`/plataforma`** (en el dominio principal, no en un subdominio), con una
cuenta aparte de las de los clientes: un superadministrador no pertenece a ninguna tienda, y ningún dueño de tienda puede
entrar ahí. Se crea con un comando, desde la Terminal del servidor:

```bash
npm run crear-superadmin -- --email vos@ejemplo.com
```

Muestra una clave generada **una sola vez**. Entrá a `https://<tu dominio>/plataforma` y cambiala en **Mi cuenta**
(mínimo 12 caracteres). Si la olvidás: el mismo comando con `--resetear`. El ingreso frena a quien prueba claves
(8 intentos fallidos en 15 minutos, por IP y por email).

- **Clientes.** Listado con filtros (activos, suspendidos, por vencer, vencidos), búsqueda y el ingreso mensual esperado.
  **Nuevo cliente** crea la tienda y su acceso, y te muestra la clave **una sola vez** junto con un mensaje listo para
  mandarle (con el link de la tienda y del panel). Desde la ficha de cada cliente: cambiarle el plan, registrar pagos,
  fijar el vencimiento, fijarle un precio (que no cambie con los aumentos del plan), suspender o reactivar, generarle una clave nueva,
  cambiarle el email y tomar notas internas.
- **Link de la tienda.** El link (subdominio) sale del nombre al dar de alta, o se elige a mano en el campo *Link*. Se cambia desde
  la ficha del cliente, en **Link de la tienda**: el link se normaliza (sin tildes ni espacios), tiene que ser un subdominio
  válido, no estar reservado (`www`, `admin`, `plataforma`…) ni usarlo otra tienda. **El link anterior sigue funcionando y redirige
  al nuevo** (301 en las visitas, 308 en los envíos, con el mismo camino y las mismas búsquedas, sin caché), así que no se rompen
  los links compartidos ni lo que Google guardó. Los anteriores quedan registrados en `tienda_enlaces_anteriores` (migración
  `010`) y ninguna otra tienda los puede usar hasta que los sueltes con *Dejar de redirigir*. Cambiar el nombre de la tienda no
  cambia el link, y el cliente no puede cambiarlo solo. Al cambiarlo, los carritos que los compradores tengan abiertos se vacían:
  el navegador los guarda por dirección. Un dominio propio (`www.sutienda.com`) es otra cosa y no está soportado.
- **Planes.** Nombre, precio por mes y topes: **productos**, **fotos por producto** (hasta 10) y **banners** (hasta 6).
  Un tope vacío es "sin límite". Al llegar a un tope, el cliente no puede cargar más y se le avisa que amplíe su plan;
  editar lo que ya tiene sigue andando, y vale también para la carga masiva por Excel. Las tiendas que ya existían quedaron
  en el plan **Sin límites**, para que nada cambie para ellas. Un plan con clientes no se puede borrar: se **pausa** (botón *Pausar* en la lista): deja de ofrecerse al dar de alta o cambiar de
  plan, y los clientes que ya lo tienen no notan nada. *Reanudar* lo vuelve a ofrecer. Si editás el precio o los topes de un plan que ya tiene clientes, antes de guardar
  ves a quiénes les toca (ver *Aumentos de precio* más abajo).
- **Período de prueba.** Un plan puede tener **días de prueba** (el plan *Prueba* trae 7): a cada cliente que entra al plan, ya sea al darlo
  de alta o al cambiarle el plan, le vence a los N días de ese momento. Si al dar de alta elegís una fecha, vale esa (para darle más o menos
  días a un cliente puntual); cambiar a un plan sin prueba no toca el vencimiento.
- **Cerrar la tienda sola al vencer.** Una opción de cada plan (activa en *Prueba*): cuando pasa la fecha de vencimiento, los compradores ven
  que la tienda no está disponible y el panel del cliente queda en solo lectura. No se guarda como una suspensión ni hace falta ninguna
  tarea programada: se calcula al atender cada pedido, así que registrar un pago (o extender la fecha) la reabre en el acto. El día del
  vencimiento todavía está abierta. Sin la opción, el vencimiento solo avisa.
- **Planes sugeridos.** `npm run cargar-planes` crea cuatro planes de arranque (Prueba, Esencial, Acompañado y A medida) si todavía no
  existen; no toca los que ya hay, así que se puede correr de nuevo. Los precios son un punto de partida: ajustalos en **Planes**.
- **Cobro manual.** Cobrás por fuera (transferencia, Mercado Pago…). Cada pago que registrás extiende el vencimiento
  desde la fecha en que vence (si todavía no venció) o desde hoy, y queda en un historial. Un cliente figura *al día*,
  *por vencer* (faltan 7 días o menos) o *vencido*, y él lo ve en su Inicio y en Cuenta. **Un vencimiento solo avisa**, salvo que el plan tenga
  activado *Cerrar la tienda sola cuando venza* (ver arriba).
- **Suspender.** La tienda deja de estar disponible para los compradores (página de aviso, HTTP 503) y el panel del cliente
  queda **en solo lectura**: puede mirar sus datos y pedidos, pero cualquier cambio vuelve con un aviso. Ve el motivo que
  anotaste. Reactivar la vuelve a abrir. No hay un botón de borrar clientes: borrar una tienda arrastraría sus productos,
  pedidos y fotos, así que se suspende.

Para que los avisos a los clientes digan cómo contactarte, definí `CONTACTO_PLATAFORMA` (por ejemplo `WhatsApp 351 123 4567`).
Los datos viven en las tablas `planes`, `superadmins`, `pagos_plataforma` y en columnas nuevas de `tiendas`; la migración
`007` se aplica sola al arrancar.

**Sesiones.** La plataforma y el panel de cada tienda tienen cada uno su propia cookie (`sesion-plataforma` y `sesion`),
así que ingresar o salir de una tienda, aunque sea en el mismo navegador, no cierra la sesión del superadmin ni al revés.
La de la plataforma dura 15 días y se renueva cada vez que se usa; la de una tienda, 8 horas desde que ingresa. Para que no
se cierre al reiniciar o redesplegar, `SECRETO_SESION` tiene que ser siempre el mismo.

## Suscripciones a los planes (Mercado Pago)

Cualquiera puede contratar un plan desde la landing y pagar con **débito automático mensual de Mercado Pago**; la cuenta se crea
**después de pagar** y un flujo de **n8n** le manda el mail de bienvenida. Es la cuenta de Mercado Pago **de la plataforma** (la tuya),
aparte de la que usa cada tienda para cobrarle a sus compradores. **Sin `MP_ACCESS_TOKEN` todo esto queda apagado**: la landing sigue
mandando por WhatsApp, `/suscribirse` vuelve a la portada y nada más cambia.

**El recorrido de un visitante nuevo**

1. En la landing elige un plan y llega a `/suscribirse?plan=<id>`: ve el plan y escribe su email (Mercado Pago lo pide para crear la suscripción).
2. Lo mandamos a Mercado Pago, donde carga su tarjeta y autoriza el débito.
3. Al volver (`/suscribirse/volver`) confirmamos el pago en el momento, sin esperar al webhook, y se abre el **formulario de la cuenta**:
   nombre, apellido, email, clave y nombre de la tienda (el link es opcional: sale del nombre). Ese formulario **solo se abre con el pago
   autorizado**: el link lleva un token firmado con `SECRETO_SESION`, de un solo uso y que vale 14 días.
4. Al enviarlo se crea la tienda y su usuario, queda con la sesión iniciada en `/admin` y **n8n le manda el mail** con el link a su panel.
   Si paga y cierra la pestaña antes de completar el formulario, otro mail de n8n le manda el link para crear la cuenta.
5. El plan **Prueba** (gratis) hace el mismo recorrido sin Mercado Pago: va directo al formulario y la tienda queda abierta los días de prueba.

**Cobros.** Cada cobro mensual aprobado por Mercado Pago **suma un mes pagado** (`vence_en`, igual que registrar un pago a mano) y queda en
el historial con la nota *Mercado Pago · cobro N*. Si el cobro llega antes de que el cliente cree su cuenta, queda guardado y se aplica al
crearla. Al crear la cuenta antes del primer cobro, la tienda queda abierta 2 días hasta que llegue. Cancelar el débito **no cierra la
tienda**: sigue abierta hasta el vencimiento ya pago, y después rige lo que diga el plan (*Cerrar la tienda sola al vencer*).

**Aumentos de precio.** Al editar un plan que ya tienen clientes (`/plataforma/planes`), si cambia el precio, los topes o lo que pasa al vencer,
**no se guarda de entrada**: primero se ve a qué clientes les toca, con lo que pagan hoy, lo que pasarían a pagar y su próximo cobro. En un aumento
se puede **sacar de él** a quien no tenga que pagar más (casilla *Aplicar* sin marcar): conserva lo que paga hoy como **precio fijo**, y los aumentos
que vengan tampoco lo alcanzan hasta que se cambie en su ficha (sección *Precio*) o lo pasen de plan. Al confirmar, el precio nuevo se aplica al
cobro de Mercado Pago de cada cliente alcanzado (`PUT /preapproval/{id}`, vale desde su próximo cobro); si Mercado Pago rechaza el cambio de alguno, el plan igual
se guarda y ese cliente queda listado para reintentar desde su ficha (*Actualizar el cobro a $X*). Una baja se aplica a todos los que no tienen precio fijo.
Y por cada cliente al que algo le cambia (el precio solo si no tiene precio fijo; los topes a todos) se le manda un mail por n8n (evento `plan_modificado`).

**Bajas.** Cuando una suscripción se cancela, por el cliente en su panel, por vos desde la ficha o por el propio cliente desde su cuenta de Mercado
Pago, se le manda **una sola vez** un mail (`suscripcion_cancelada`) que dice hasta cuándo sigue activa su tienda (el vencimiento ya pago: si pagó por última vez
el 25 de octubre y cancela el 10 de noviembre, sigue activa hasta el 25 de noviembre) y que puede reactivarla cuando quiera. En su panel el aviso también dice la fecha, y la
pantalla *Suscripción* ofrece **Reactivar mi suscripción**: si todavía le quedan días pagos, el primer cobro se programa para el día en que vencen (`start_date`),
así no se cobra de más ni se interrumpe la tienda; si ya venció, cobra apenas autoriza. El cambio de plan (que da de baja la suscripción anterior a propósito) no manda ese aviso.

**Los clientes que ya existen** contratan, cambian de plan o cancelan en **Cuenta → Pagar o cambiar de plan** (`/admin/suscripcion`).
Al cambiar de plan se crea una suscripción nueva al precio nuevo y, cuando se autoriza, se da de baja la anterior (sin prorrateo). Una
tienda suspendida puede pagar aunque el resto del panel esté en solo lectura. Los planes sin tope de productos (*A medida*) y los que no
se ofrecen no se contratan solos: se consultan por WhatsApp.

**En `/plataforma`.** **Altas** lista a quienes pagaron y todavía no crearon su cuenta (con *Sincronizar* con Mercado Pago y *Reenviar
link por mail*). En la ficha de cada cliente aparece **Suscripción** (estado, próximo cobro, *Sincronizar*, *Cancelar el cobro automático*
y *Reenviar mail de bienvenida*) y el titular de la cuenta.

### Configurar Mercado Pago

1. En [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/panel/app) creá una aplicación con tu cuenta (la que va a cobrar).
2. En **Webhooks → Configurar notificaciones** cargá `https://<tu dominio>/webhooks/mercadopago` (una URL para pruebas y otra para producción),
   con los eventos **Planes y suscripciones** (`subscription_preapproval` y `subscription_authorized_payment`). Al guardar te da una
   **clave secreta**.
3. Cargá en el `.env` (en Coolify, como variables de entorno):

```
MP_ACCESS_TOKEN=APP_USR-...      # Credenciales → Access Token (de prueba primero, de producción después)
MP_WEBHOOK_SECRET=...            # la clave secreta del paso 2
URL_TERMINOS=https://...         # opcional: si la ponés, el alta pide aceptar los términos y condiciones
```

4. **Probalo con credenciales de prueba antes de salir a producción**: creá usuarios de prueba (vendedor y comprador) en *Cuentas de prueba*,
   y recorré: elegir plan → pagar → formulario de la cuenta → panel → cancelar. Los tests automáticos usan un Mercado Pago de mentira, así que
   lo que **no** está probado contra el de verdad es: la fórmula exacta de la firma `x-signature` de los webhooks de suscripciones, si
   `payer_email` tiene que coincidir con el email de la cuenta de Mercado Pago de quien paga, y cómo reintenta Mercado Pago ante una tarjeta
   rechazada (la baja llega por webhook y la suscripción queda *cancelada*). Todo eso está en `src/mercadopago.js`, un solo archivo.

### Mails con n8n

La plataforma **no manda mails**: le avisa a un flujo de n8n por webhook y n8n arma y envía el mail. Configurá:

```
N8N_WEBHOOK_URL=https://tu-n8n/webhook/vezza-cuentas   # la URL de producción del nodo Webhook
N8N_WEBHOOK_SECRET=...                                 # un secreto compartido (opcional pero recomendado)
```

Cada aviso es un `POST` con JSON y el secreto en el header `X-Webhook-Secret` (el nodo Webhook de n8n lo valida con *Header Auth*). Si n8n
no está configurado, se cae o responde con error, queda en el log y **no se rompe nada**: el alta y los cobros siguen. El campo `evento` dice
cuál es:

| `evento` | Cuándo | Cuerpo |
| --- | --- | --- |
| `cuenta_creada` | Al crear la cuenta (y desde *Reenviar mail de bienvenida*) | `email`, `nombre`, `apellido`, `tienda: { nombre, url }`, `plan: { nombre, precio }`, `urlPanel` |
| `pago_recibido` | Al confirmarse el pago, mientras no haya creado la cuenta (y desde *Reenviar link por mail*) | `email`, `plan: { nombre, precio }`, `urlCuenta` |
| `plan_modificado` | Al confirmar un cambio de precio o de topes de un plan que tiene clientes (y desde *Actualizar el cobro* en la ficha) | `email`, `nombre`, `tienda: { nombre }`, `plan: { nombre }`, `cambios: [{ etiqueta, antes, despues, cuando }]`, `urlPanel` |
| `suscripcion_cancelada` | Al cancelarse una suscripción (una sola vez por suscripción) | `email`, `nombre`, `apellido`, `tienda: { nombre }`, `plan: { nombre }`, `accesoHasta`, `accesoHastaTexto`, `vencida`, `urlReactivar` |
| `pedido_actualizado` | Al cambiar el estado o el envío de un pedido (y desde *Volver a avisar por mail*), si hay email del comprador | `email`, `cliente: { nombre }`, `tienda: { nombre, url, email, whatsapp }`, `pedido: { numero, url, total, estado }`, `titulo`, `mensaje`, `seguimiento: { empresa, codigo, url, detalle }` o `null` |

**El código del nodo está en el repo:** `n8n/validar-y-armar-mail.js` es el contenido del nodo *Code* "Validar y armar mail" del flujo (valida cada aviso, arma el HTML y el texto del mail y decide el
remitente: `VEZZA Shop` para los mails de la plataforma y el nombre de la tienda para `pedido_actualizado`, con `Reply-To` al email de contacto de la tienda). Para actualizar el flujo, pegá ese
archivo en el nodo y, en el nodo *Send Email*, poné como remitente `{{ $json.desde }}` y, en las opciones, *Reply To* = `{{ $json.responderA }}`. Lo prueba `test/n8n-mails.test.js` (con los avisos
reales que arma la app), así que si se cambia un aviso, el test avisa si el nodo quedó desactualizado.

`cuenta_creada` es el mail de "tu cuenta está lista" con el link `urlPanel` para entrar a gestionarla; **nunca lleva la clave**.
`pago_recibido` lleva `urlCuenta`, el link para completar el formulario. Un flujo mínimo: *Webhook* (POST, Header Auth) → *Switch* por
`evento` → un nodo *Send Email* (Gmail o SMTP) para cada uno → *Respond to Webhook* con 200.

## Logo de Vezza

La firma "Desarrollado por VEZZA" aparece en la pantalla de ingreso y en el menú de la plataforma (donde además es el
logo de la administración), en el ingreso y el menú de cada panel de tienda y en el pie de cada vidriera. La pestaña del
navegador de los paneles usa el ícono `/vezza/icono.svg`.

Los archivos están en `src/publico/vezza/`: `logo.svg` (símbolo y nombre), `marca.svg` (solo el símbolo), sus versiones
`*-oscuro.svg` / `*-oscura.svg` para fondos oscuros (para usar afuera de la app, por ejemplo en un mail) e `icono.svg`.
Están trazados a partir del PNG original del logo (`imgs/vezza-logo.png` del repo `vezza`) y coinciden con él en más de un 99 % de
los píxeles. Dentro de la app el SVG se incrusta con `vezza()` (`src/util/vezza.js`) y toma los colores del CSS (`--vezza-tinta` y
`--vezza-acento`), así que sigue solo el modo claro u oscuro. Para cambiar el logo se reemplazan esos SVG, con el negro
`#13121a` y el índigo `#3b2ee4` como únicos colores; el helper los reemplaza por los del tema.

## Imágenes

Los clientes suben fotos de hasta 5 MB (JPG, PNG o WEBP; las de cámara pesan 2 a 5 MB y miden 4000 a 6000 px de lado).
Para que la tienda cargue rápido **no se guarda el original**: cada subida se convierte con `sharp` a WebP, se endereza
según la orientación de la cámara (EXIF) y se descartan los metadatos, como la ubicación. Se guardan en
`<DIR_SUBIDAS>/<tiendaId>/` y se sirven en `/subidas/<tiendaId>/<archivo>`:

| Imagen | Archivos | Medidas |
|---|---|---|
| Foto de producto | `<uuid>.webp` · `<uuid>-m.webp` · `<uuid>-s.webp` | 1600 px de ancho (la que se abre al ampliar) · 540 px (grilla y ficha) · 128 px (carrito, buscador, tira de fotos) |
| Banner | `<uuid>.webp` | recortado a la proporción de la tienda: hasta 1200 px de ancho (800 px el de celular) |
| Logo | `<uuid>.webp` | hasta 504 × 112 px: el doble del tamaño más grande que se puede elegir en Diseño (56 px de alto) |

La base de datos sigue guardando un solo nombre (el de la versión grande, `archivo` / `logo` / `imagen`); las miniaturas
se encuentran por nombre. En la vidriera, las grillas usan las miniaturas, la ficha usa `srcset` (mediana o grande según la
pantalla) y la versión grande solo se baja al tocar una foto para ampliarla. La segunda foto de cada tarjeta (la que aparece al
pasar el mouse) no se descarga hasta el primer hover. Todos los `<img>` llevan `width` y `height` para que la página no salte.

**Imágenes subidas antes de este formato.** Siguen funcionando: si falta una miniatura, `/subidas` redirige al original
(con caché corta). Para convertirlas, dentro del contenedor (Terminal de Coolify):

```bash
npm run migrar-imagenes -- --dry-run   # muestra qué haría, sin escribir nada
npm run migrar-imagenes                # convierte todas las tiendas (o --tienda 3 para una sola)
```

- No borra nada: los originales quedan donde están. Cuando verifiques que todo se ve bien, `--mover-originales` los
  pasa a `data/subidas-originales/` (o a la carpeta de `--respaldo <carpeta>`) para ocupar menos lugar en `/subidas`.
- Se puede correr varias veces: lo ya convertido se saltea, y si se corta a la mitad se completa en la siguiente.
- La base solo cambia cuando los archivos nuevos ya están escritos, así que la tienda sigue andando mientras corre.
- Antes de convertir completa la huella de las fotos que no tenían, para que la carga masiva siga sin repetir fotos.
- Informa los archivos que la base usa pero ya no existen en disco (y sale con código 2 si hay alguno).

**Compresión y caché.** La app comprime con gzip o brotli el HTML, CSS, JS y JSON (`compression`), y sirve `/subidas`
con `Cache-Control: public, max-age=31536000, immutable`: los nombres llevan un UUID y nunca se reutilizan. Las imágenes
WebP no se vuelven a comprimir. El repo no trae configuración de Nginx: en Coolify el proxy es Traefik, que no hace falta
tocar. Para comprobarlo en producción:

```bash
curl -sI -H 'Accept-Encoding: br, gzip' https://tienda.ejemplo.com/tienda.css | grep -i 'content-encoding\|cache-control'
curl -sI https://tienda.ejemplo.com/subidas/1/<archivo>.webp | grep -i 'cache-control'
```

## Publicar en Coolify

El repo trae un `Dockerfile` (Node 24 Alpine, corre sin root y responde `ok` en `/salud` para el chequeo de
salud). En los ejemplos el dominio es `vezzashop.com`: cambialo por el tuyo.

1. **DNS:** dos registros `A`, `vezzashop.com` y `*.vezzashop.com`, con la IP del servidor. Si usás Cloudflare,
   dejalos en **solo DNS** (nube gris). Con el proxy de Cloudflare todas las visitas llegan con la IP de
   Cloudflare y el límite de pedidos por IP del checkout las cuenta juntas.
2. **Certificado comodín (una sola vez por servidor):** el certificado de `*.vezzashop.com` solo se consigue con el
   DNS challenge. Seguí la guía de Coolify
   ([DNS challenge](https://coolify.io/docs/knowledge-base/proxy/traefik/dns-challenge) y
   [certificados comodín](https://coolify.io/docs/core/networking/proxy/traefik/wildcard-certs)): token de la API
   de tu DNS en **Servers → Proxy → Configuration**, **Restart Proxy**, y una *Dynamic Configuration* que pida
   `vezzashop.com` con `*.vezzashop.com` como SAN.
3. **Base de datos:** **+ New → Database → PostgreSQL** (versión 16 o más nueva) en el mismo proyecto y servidor.
   Dejá las opciones por defecto, iniciala y copiá la **Postgres URL (internal)**: es el valor de `DATABASE_URL` del paso 6.
   Después, en la pestaña **Backups** del recurso, programá copias automáticas (idealmente a un S3 externo).
4. **Nueva aplicación:** **+ New → Public Repository**, URL `https://github.com/valentinomezzavilla/vezzashop`,
   rama `master`, **Build Pack: Dockerfile**, **Ports Exposes: `3000`**. Si el repo pasa a ser privado,
   usá **Private Repository (with GitHub App)**.
5. **Domains:** `https://vezzashop.com` (el panel).
6. **Environment Variables:**
   - `SECRETO_SESION`: generalo con el comando de [Configuración](#configuración). No lo marques como
     variable de build.
   - `DOMINIO=vezzashop.com`
   - `DOMINIO_TIENDAS` (opcional): el dominio donde viven las tiendas, si no es el mismo del panel. Por ejemplo
     `DOMINIO=tiendas.vezzadev.com` y `DOMINIO_TIENDAS=vezzadev.com` dan el panel en `tiendas.vezzadev.com` y las
     tiendas en `<nombre>.vezzadev.com`. Los nombres `www`, `admin`, `panel`, `api`, `app`, `mail`, `tiendas` y
     `coolify` no se pueden usar como tienda.
   - `DATABASE_URL`: la **Postgres URL (internal)** del recurso del paso 3. Si la base y la aplicación están en el
     mismo servidor de Coolify, usá la interna (no sale a internet).
   - `NODE_ENV=production` y `PUERTO=3000` ya vienen en la imagen.
7. **Persistent Storage → + Add → Volume Mount**, destino **`/app/data`**. Ahí van las imágenes y los Excel
   pendientes. **Sin el volumen, cada deploy borra las imágenes subidas.**
8. **Healthcheck:** activalo con path `/salud` y puerto `3000`.
9. **Subdominios de las tiendas:** el campo Domains no alcanza para `*.vezzashop.com`. Guardá una vez para
   que Coolify genere las etiquetas y destildá **Readonly labels**. Después agregá al final de
   **Container Labels** (Traefik v3, el de las instalaciones nuevas):

   ```ini
   traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https
   traefik.http.routers.tiendas-http.rule=HostRegexp(`^[a-z0-9-]+\.vezzashop\.com$`)
   traefik.http.routers.tiendas-http.entryPoints=http
   traefik.http.routers.tiendas-http.middlewares=redirect-to-https
   traefik.http.routers.tiendas-http.service=tiendas
   traefik.http.routers.tiendas-https.rule=HostRegexp(`^[a-z0-9-]+\.vezzashop\.com$`)
   traefik.http.routers.tiendas-https.entryPoints=https
   traefik.http.routers.tiendas-https.tls=true
   traefik.http.routers.tiendas-https.tls.certresolver=letsencrypt
   traefik.http.routers.tiendas-https.service=tiendas
   traefik.http.services.tiendas.loadbalancer.server.port=3000
   ```

   Con las etiquetas en manual, Coolify ya no las actualiza solo: si cambiás el dominio, revisalas a mano.
10. **Deploy.** Después, en la **Terminal** de la aplicación, creá la primera tienda:
   `npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com`.
11. Probá `https://vezzashop.com/admin` y el subdominio de la tienda. Entrá siempre por **https**: en
    producción la cookie de sesión solo viaja por HTTPS, y por http el login no anda.

Para desplegar solo con cada push a `master`: con la GitHub App es automático; con repo público, copiá la
URL de la pestaña **Webhooks** de la aplicación en GitHub (Settings → Webhooks). Si no, usá **Redeploy**.
Las migraciones de la base se aplican solas al arrancar.

## Estructura

```
src/
  servidor.js            arranque
  app.js                 Express: sesiones, vistas, rutas
  config.js              lectura del .env
  db.js                  PostgreSQL (pg en producción, PGlite en desarrollo y tests) + migraciones (src/migraciones/*.sql)
  tiendas.js             alta de tiendas y login
  claves.js              hash de claves (scrypt)
  csrf.js                protección de formularios
  almacen-sesiones.js    sesiones guardadas en la base de datos
  productos.js           productos desde el panel: listado, validación, guardado y fotos
  categorias.js          árbol de categorías del panel, alta, edición y borrado
  inicio.js              datos del tablero de Inicio
  vidriera.js            consultas de la vidriera pública
  diseno.js              ajustes de diseño de cada tienda y banners
  diseno-por-plan.js     niveles de diseño (esencial, acompañado, a medida): qué puede personalizar cada plan, validaciones y el estilo que se genera
  dominios-propios.js    dominio propio de una tienda: validar, pedir, verificar el DNS, activar
  pagos.js               formas de entrega y de pago (Envíos y pagos)
  secretos.js            cifrado (AES-256-GCM) de los tokens de Mercado Pago de cada tienda
  mercadopago-tiendas.js cliente de Mercado Pago con el token de una tienda: OAuth, armar el pago y consultarlo
  tienda-mercadopago.js  la conexión de cada tienda con su cuenta: guardar (cifrado), renovar el token y desconectar
  cobros-mp.js           cobrar un pedido con Mercado Pago: armar el pago, comprobarlo y pasar el pedido a Pagado
  comisiones-mp.js       cuánto cobra Mercado Pago y cuánto le queda a la tienda (el código vive en publico/comisiones-mp.js)
  pedidos.js             checkout: totales, validación, crear el pedido; pedidos del panel
  estados-pedido.js      los estados de un pedido y cómo se llaman (para el negocio y para el comprador)
  envios.js              envío de los pedidos a domicilio: pasos, empresas, historial, línea de tiempo y avisos al comprador
  imagenes.js            imágenes subidas: conversión a WebP, miniaturas y medidas
  landing.js             datos de la landing: tarjetas de planes y precios para Google (la vista es vistas/landing.ejs)
  suscripciones.js       suscripciones a los planes: contratar, cobros, crear la cuenta después de pagar, cancelar y reactivar
  cambios-de-plan.js     cambios en un plan con clientes: qué cambió, aumentos con excepciones (precio fijo), Mercado Pago y avisos
  mercadopago.js         cliente de la API de Mercado Pago y validación de la firma de los webhooks
  notificaciones.js      avisos a n8n (el flujo que manda los mails de alta)
  plataforma.js          superadmin: cuentas, planes y clientes (alta, cobro, suspensión)
  estado.js              si una tienda está abierta o cerrada (suspensión a mano o cierre al vencer)
  limites.js             topes del plan de cada tienda, uso y estado de cobro
  migrar-imagenes.js     convierte al formato nuevo las imágenes subidas antes (lo usa scripts/migrar-imagenes.js)
  util/dominios.js       qué tienda corresponde a cada subdominio
  importacion/
    valores.js           interpreta celdas (precios, números, sí/no)
    interpretar.js       planilla -> productos con variantes + errores por fila
    aplicar.js           cruza con la base y guarda (todo o nada)
    leer-excel.js        lectura del .xlsx
    plantilla.js         plantilla descargable
    fotos-excel.js       fotos pegadas en el .xlsx (flotantes y colocadas en celda)
    descargar.js         descarga de fotos por link, solo a direcciones públicas
    fotos.js             fotos de cada fila y de cada producto, huellas
    pendiente.js         carpeta de la importación que espera confirmación
  rutas/admin.js         panel /admin: login, carga masiva y diseño
  rutas/admin-tienda.js  panel /admin: inicio, productos, fotos, categorías y cuenta
  rutas/admin-pedidos.js panel /admin: pedidos, y envíos y pagos
  rutas/tienda.js        vidriera (catálogo, destacados, categorías, ficha, checkout y pedido)
  rutas/plataforma.js    panel /plataforma del administrador de la plataforma
  rutas/suscribirse.js   alta pública: elegir plan, pagar y crear la cuenta (/suscribirse)
  rutas/admin-suscripcion.js  panel /admin: la suscripción del cliente a su plan
  rutas/webhooks.js      avisos de Mercado Pago (/webhooks/mercadopago y /webhooks/mercadopago/tienda/:id)
  util/iconos.js         íconos SVG de las vistas
  util/vezza.js          logo y firma de Vezza (SVG de publico/vezza/ incrustado en las vistas)
  vistas/                pantallas (EJS): admin/, tienda/ y parciales/
  publico/               CSS y scripts del panel (admin.js) y de la vidriera (tienda.js)
scripts/crear-tienda.js
scripts/crear-superadmin.js
scripts/cargar-planes.js
scripts/migrar-imagenes.js
test/                    tests (node:test)
```

## Qué falta

Etapas siguientes, en orden sugerido:

1. Cancelar solos los pedidos de Mercado Pago que no se pagan (hoy reservan el stock hasta que la tienda los cancela) y devolver el
   dinero desde la plataforma (hoy el reembolso se hace desde Mercado Pago).
2. Avisos por email: a la tienda cuando entra un pedido y al comprador con el detalle al hacerlo (los cambios de estado y de envío ya le llegan por mail y por WhatsApp;
   hoy la tienda se entera de un pedido nuevo por el contador del panel).
3. Cotizar envíos con Correo Argentino / Andreani según el código postal (hoy: costo fijo o "a coordinar").
4. Que el dominio propio se agregue solo en Coolify (hoy lo hacés a mano, ver [Dominio propio](#dominio-propio)) y un aviso por mail cuando un cliente pide o verifica el suyo.
5. Páginas institucionales (cambios, cómo comprar), botón de arrepentimiento, SEO, píxel de Meta y GA4.
6. Foto por color en las variantes.
7. Para producción: límite de intentos de login en el panel de cada tienda (el de `/plataforma` ya lo tiene), que cada dueño
   recupere su clave solo (hoy se la genera el administrador desde `/plataforma`), cerrar otras sesiones al cambiar la clave,
   programar las copias de seguridad de la base en Coolify (pestaña Backups del recurso PostgreSQL).
