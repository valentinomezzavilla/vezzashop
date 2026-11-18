# Plataforma de tiendas

Plataforma propia de tiendas online. Varias tiendas (una por cliente) conviven en la misma
instalación, y cada cliente entra a su panel en `/admin` con su email y clave.

**Estado:** ya funcionan el panel (inicio, pedidos, productos con fotos, categorías, carga masiva desde Excel,
diseño, envíos y pagos, y cuenta), la **vidriera pública de cada tienda en su subdominio** y el **checkout**:
el cliente elige cómo recibir el pedido y cómo pagar, y el pedido llega al panel. El cobro con tarjeta todavía
es manual (link de pago de Mercado Pago que manda la tienda; ver [Qué falta](#qué-falta)).

## El panel

| Sección | Qué hace el cliente |
|---|---|
| **Inicio** | Ve el link de su tienda, el aviso de pedidos nuevos, números (visibles, ocultos, sin stock, unidades), una lista de pasos para completar la tienda y alertas de productos sin stock o con pocas unidades. |
| **Pedidos** | Ve los pedidos que llegan desde la tienda (por atender, nuevos, pagados, enviados, entregados, cancelados), busca por número, nombre, teléfono o email, y en cada uno: productos, datos del cliente, entrega, pago, el próximo paso con un botón ("Marcar como pagado", "Enviado" / "Listo para retirar", "Entregado"), WhatsApp al cliente y cancelar (devuelve el stock). |
| **Productos** | Busca por nombre, marca o SKU; filtra (visibles, ocultos, destacados, sin stock, sin foto); oculta o destaca con un clic; crea, edita y borra productos, también varios a la vez (se marcan en la lista y se confirma viendo cuáles). |
| **Editor de producto** | Nombre, descripción, marca, visible, destacado, categorías y variantes (hasta 3 tipos, por ejemplo Talle y Color) con SKU, precio, oferta y stock. Crea todas las combinaciones de una vez y aplica un precio o stock a todas las variantes. Hasta 10 fotos por producto, ordenables; la primera es la principal. |
| **Categorías** | Crea, renombra, mueve dentro de otra y borra (con sus subcategorías; los productos no se borran). |
| **Carga masiva** | Ver más abajo. |
| **Diseño** | Ver más abajo. |
| **Envíos y pagos** | Ver más abajo. |
| **Cuenta** | Cambia el nombre de la tienda (el link no cambia) y su clave (mínimo 10 caracteres). |

Los productos **destacados** aparecen en una sección propia arriba de la portada (hasta 8).

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
- No pueden usarse como nombre de tienda: `www`, `admin`, `panel`, `api`, `app`, `mail`.

## Diseño de la tienda

En el panel, **Diseño**: cada cliente configura cómo se ve su vidriera.

- **Identidad:** logo y color principal (franja de anuncios y botones; el color del texto se elige solo
  para que se lea bien).
- **Franja de anuncios:** el texto de arriba de todo (envío gratis, descuentos, etc.).
- **Cabecera y menú:** con vista previa en vivo. El **estilo del menú** puede ser una *barra de categorías* (las
  que no entran en la pantalla pasan solas a un botón "Más", con sus subcategorías) o un *menú desplegable* (un botón
  abre la lista, también en la computadora). Se elige el **tamaño del logo** (32, 40 o 56 px de alto; en el celular no
  pasa de 44) y **qué categorías de primer nivel aparecen en el menú de arriba** (el pie de página las muestra todas).
  Una categoría sin productos visibles no se muestra, la elijan o no.
- **Orden del catálogo** por defecto: nombre, más nuevos o precio. El visitante lo puede cambiar.
- **Contacto y redes:** WhatsApp (botón flotante), Instagram, Facebook, TikTok, email y dirección.
- **Banners de bienvenida:** hasta 6 imágenes para el carrusel de la portada, con imagen opcional
  para celular, link y orden.

Las imágenes (JPG, PNG o WEBP, hasta 5 MB) se guardan en `data/subidas/<id de tienda>/`. El tipo se
reconoce por el contenido del archivo; los SVG no se aceptan porque pueden traer scripts. En
producción, `data/` tiene que estar en un volumen persistente (la base de datos no: está en PostgreSQL).

Para producción hace falta un solo dominio, con dos registros DNS apuntando al servidor:
`vezzashop.com` y `*.vezzashop.com`. El certificado HTTPS de `*.vezzashop.com` necesita un comodín
(DNS challenge en el proxy). Ver [Publicar en Coolify](#publicar-en-coolify).
Detrás del proxy, `NODE_ENV=production` hace que se respete el host original (`trust proxy`).

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
  (la tienda manda un link de pago por el total; texto para el cliente y cuotas sin interés, que se muestran en
  cada producto). El descuento se aplica solo sobre los productos, no sobre el envío.

Los pedidos guardan una copia de lo comprado (productos, precios, entrega, dirección), así no cambian si después
cambia el catálogo. Cancelar un pedido devuelve el stock de lo que todavía existe.

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
  fijar el vencimiento, suspender o reactivar, generarle una clave nueva, cambiarle el email y tomar notas internas.
- **Planes.** Nombre, precio por mes y topes: **productos**, **fotos por producto** (hasta 10) y **banners** (hasta 6).
  Un tope vacío es "sin límite". Al llegar a un tope, el cliente no puede cargar más y se le avisa que amplíe su plan;
  editar lo que ya tiene sigue andando, y vale también para la carga masiva por Excel. Las tiendas que ya existían quedaron
  en el plan **Sin límites**, para que nada cambie para ellas. Un plan con clientes no se puede borrar: se desactiva.
- **Planes sugeridos.** `npm run cargar-planes` crea cuatro planes de arranque (Prueba, Esencial, Acompañado y A medida) si todavía no
  existen; no toca los que ya hay, así que se puede correr de nuevo. Los precios son un punto de partida: ajustalos en **Planes**.
- **Cobro manual.** Cobrás por fuera (transferencia, Mercado Pago…). Cada pago que registrás extiende el vencimiento
  desde la fecha en que vence (si todavía no venció) o desde hoy, y queda en un historial. Un cliente figura *al día*,
  *por vencer* (faltan 7 días o menos) o *vencido*, y él lo ve en su Inicio y en Cuenta. **Un vencimiento solo avisa**: no
  suspende solo, lo decidís vos.
- **Suspender.** La tienda deja de estar disponible para los compradores (página de aviso, HTTP 503) y el panel del cliente
  queda **en solo lectura**: puede mirar sus datos y pedidos, pero cualquier cambio vuelve con un aviso. Ve el motivo que
  anotaste. Reactivar la vuelve a abrir. No hay un botón de borrar clientes: borrar una tienda arrastraría sus productos,
  pedidos y fotos, así que se suspende.

Para que los avisos a los clientes digan cómo contactarte, definí `CONTACTO_PLATAFORMA` (por ejemplo `WhatsApp 351 123 4567`).
Los datos viven en las tablas `planes`, `superadmins`, `pagos_plataforma` y en columnas nuevas de `tiendas`; la migración
`007` se aplica sola al arrancar.

## Imágenes

Los clientes suben fotos de hasta 5 MB (JPG, PNG o WEBP; las de cámara pesan 2 a 5 MB y miden 4000 a 6000 px de lado).
Para que la tienda cargue rápido **no se guarda el original**: cada subida se convierte con `sharp` a WebP, se endereza
según la orientación de la cámara (EXIF) y se descartan los metadatos, como la ubicación. Se guardan en
`<DIR_SUBIDAS>/<tiendaId>/` y se sirven en `/subidas/<tiendaId>/<archivo>`:

| Imagen | Archivos | Medidas |
|---|---|---|
| Foto de producto | `<uuid>.webp` · `<uuid>-m.webp` · `<uuid>-s.webp` | 1600 px de ancho (la que se abre al ampliar) · 540 px (grilla y ficha) · 128 px (carrito, buscador, tira de fotos) |
| Banner | `<uuid>.webp` | 1200 px de ancho (800 px el de celular) |
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
  pagos.js               formas de entrega y de pago (Envíos y pagos)
  pedidos.js             checkout: totales, validación, crear el pedido; pedidos del panel
  imagenes.js            imágenes subidas: conversión a WebP, miniaturas y medidas
  plataforma.js          superadmin: cuentas, planes y clientes (alta, cobro, suspensión)
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
  util/iconos.js         íconos SVG de las vistas
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

1. Cobro automático con Mercado Pago (Checkout Pro con las credenciales de cada tienda y aviso de pago por
   webhook, que marque el pedido como pagado solo). Hoy la tienda manda el link de pago a mano.
2. Avisos por email: a la tienda cuando entra un pedido y al cliente con el detalle y los cambios de estado
   (hoy se avisa por el contador del panel y por WhatsApp).
3. Cotizar envíos con Correo Argentino / Andreani según el código postal (hoy: costo fijo o "a coordinar").
4. Dominio propio por cliente.
5. Páginas institucionales (cambios, cómo comprar), botón de arrepentimiento, SEO, píxel de Meta y GA4.
6. Foto por color en las variantes.
7. Para producción: límite de intentos de login en el panel de cada tienda (el de `/plataforma` ya lo tiene), que cada dueño
   recupere su clave solo (hoy se la genera el administrador desde `/plataforma`), cerrar otras sesiones al cambiar la clave,
   programar las copias de seguridad de la base en Coolify (pestaña Backups del recurso PostgreSQL).
