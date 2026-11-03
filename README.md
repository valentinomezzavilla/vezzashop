# Plataforma de tiendas

Plataforma propia de tiendas online. Varias tiendas (una por cliente) conviven en la misma
instalación, y cada cliente entra a su panel en `/admin` con su email y clave.

**Estado:** ya funcionan el panel (inicio, productos con fotos, categorías, carga masiva desde Excel,
diseño y cuenta) y la **vidriera pública de cada tienda en su subdominio**. Todavía no hay carrito,
pagos ni envíos: por ahora se consulta por WhatsApp desde cada producto (ver [Qué falta](#qué-falta)).

## El panel

| Sección | Qué hace el cliente |
|---|---|
| **Inicio** | Ve el link de su tienda, números (visibles, ocultos, sin stock, unidades), una lista de pasos para completar la tienda y alertas de productos sin stock o con pocas unidades. |
| **Productos** | Busca por nombre, marca o SKU; filtra (visibles, ocultos, destacados, sin stock, sin foto); oculta o destaca con un clic; crea, edita y borra productos. |
| **Editor de producto** | Nombre, descripción, marca, visible, destacado, categorías y variantes (hasta 3 tipos, por ejemplo Talle y Color) con SKU, precio, oferta y stock. Crea todas las combinaciones de una vez y aplica un precio o stock a todas las variantes. Hasta 10 fotos por producto, ordenables; la primera es la principal. |
| **Categorías** | Crea, renombra, mueve dentro de otra y borra (con sus subcategorías; los productos no se borran). |
| **Carga masiva** | Ver más abajo. |
| **Diseño** | Ver más abajo. |
| **Cuenta** | Cambia el nombre de la tienda (el link no cambia) y su clave (mínimo 10 caracteres). |

Los productos **destacados** aparecen en una sección propia arriba de la portada (hasta 8).

## Requisitos

- Node.js 24 o más nuevo (usa el SQLite que viene con Node; no hay que instalar una base de datos).

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

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com` | Da de alta un cliente: crea la tienda y su usuario, y muestra la clave **una sola vez**. |
| `npm run dev` | Levanta el servidor y lo reinicia cuando cambia el código. Panel en http://localhost:3000/admin y cada tienda en http://&lt;slug&gt;.localhost:3000 |
| `npm start` | Levanta el servidor (para producción). |
| `npm test` | Corre todos los tests. |

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
- Si hay un solo error, no se guarda nada.
- Archivo `.xlsx` de hasta 5 MB.

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
- **Carrito con pedido por WhatsApp** (solo si la tienda cargó su WhatsApp): se agrega con cantidad,
  vive en el navegador (`localStorage`) y al abrirlo se piden precios y stock actuales a
  `/api/carrito`. El pedido se manda armado por WhatsApp con total y precio con transferencia.
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
- **Precios:** descuento por transferencia (%) y cuotas sin interés. Por ahora solo se *muestran*
  ("$X con transferencia", "6 cuotas sin interés de $Y"); el descuento se va a aplicar de verdad
  cuando esté el checkout.
- **Orden del catálogo** por defecto: nombre, más nuevos o precio. El visitante lo puede cambiar.
- **Contacto y redes:** WhatsApp (botón flotante), Instagram, Facebook, TikTok, email y dirección.
- **Banners de bienvenida:** hasta 6 imágenes para el carrusel de la portada, con imagen opcional
  para celular, link y orden.

Las imágenes (JPG, PNG o WEBP, hasta 5 MB) se guardan en `data/subidas/<id de tienda>/`. El tipo se
reconoce por el contenido del archivo; los SVG no se aceptan porque pueden traer scripts. En
producción, `data/` tiene que estar en un volumen persistente.

Para producción hace falta un solo dominio, con dos registros DNS apuntando al servidor:
`vezzashop.com` y `*.vezzashop.com`. El certificado HTTPS de `*.vezzashop.com` necesita un comodín:
lo más simple es usar Cloudflare con el proxy activado, o configurar el DNS challenge en el proxy.
Detrás del proxy, `NODE_ENV=production` hace que se respete el host original (`trust proxy`).

## Estructura

```
src/
  servidor.js            arranque
  app.js                 Express: sesiones, vistas, rutas
  config.js              lectura del .env
  db.js                  SQLite + migraciones (src/migraciones/*.sql)
  tiendas.js             alta de tiendas y login
  claves.js              hash de claves (scrypt)
  csrf.js                protección de formularios
  almacen-sesiones.js    sesiones guardadas en SQLite
  productos.js           productos desde el panel: listado, validación, guardado y fotos
  categorias.js          árbol de categorías del panel, alta, edición y borrado
  inicio.js              datos del tablero de Inicio
  vidriera.js            consultas de la vidriera pública
  diseno.js              ajustes de diseño de cada tienda y banners
  imagenes.js            imágenes subidas (validación y guardado)
  util/dominios.js       qué tienda corresponde a cada subdominio
  importacion/
    valores.js           interpreta celdas (precios, números, sí/no)
    interpretar.js       planilla -> productos con variantes + errores por fila
    aplicar.js           cruza con la base y guarda (todo o nada)
    leer-excel.js        lectura del .xlsx
    plantilla.js         plantilla descargable
  rutas/admin.js         panel /admin: login, carga masiva y diseño
  rutas/admin-tienda.js  panel /admin: inicio, productos, fotos, categorías y cuenta
  rutas/tienda.js        vidriera (catálogo, destacados, categorías, ficha)
  util/iconos.js         íconos SVG de las vistas
  vistas/                pantallas (EJS): admin/, tienda/ y parciales/
  publico/               CSS y scripts del panel (admin.js) y de la vidriera (tienda.js)
scripts/crear-tienda.js
test/                    tests (node:test)
```

## Qué falta

Etapas siguientes, en orden sugerido:

1. Checkout con Mercado Pago sobre el carrito que ya existe (hoy el pedido se manda por WhatsApp),
   aplicando de verdad el descuento por transferencia.
2. Envíos y retiro en local.
3. Dominio propio por cliente.
4. Páginas institucionales (cambios, cómo comprar), botón de arrepentimiento, SEO, píxel de Meta y GA4.
5. Achicar las fotos al subirlas (hoy se guardan tal cual) y foto por color en las variantes.
6. Para producción: límite de intentos de login, recuperar clave, cerrar otras sesiones al cambiar la clave,
   copias de seguridad de la base.
