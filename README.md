# Plataforma de tiendas

Plataforma propia de tiendas online. Varias tiendas (una por cliente) conviven en la misma
instalación, y cada cliente entra a su panel en `/admin` con su email y clave.

**Estado: etapa 1.** Ya funciona el panel con login y la **carga masiva de productos desde Excel**.
Todavía no hay vidriera pública, carrito, pagos ni envíos (ver [Qué falta](#qué-falta)).

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

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com` | Da de alta un cliente: crea la tienda y su usuario, y muestra la clave **una sola vez**. |
| `npm run dev` | Levanta el servidor y lo reinicia cuando cambia el código. Panel en http://localhost:3000/admin |
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
  catalogo.js            consultas de productos
  importacion/
    valores.js           interpreta celdas (precios, números, sí/no)
    interpretar.js       planilla -> productos con variantes + errores por fila
    aplicar.js           cruza con la base y guarda (todo o nada)
    leer-excel.js        lectura del .xlsx
    plantilla.js         plantilla descargable
  rutas/admin.js         panel /admin
  vistas/                pantallas (EJS)
  publico/               CSS
scripts/crear-tienda.js
test/                    tests (node:test)
```

## Qué falta

Etapas siguientes, en orden sugerido:

1. Alta y edición de productos de a uno desde el panel.
2. Fotos de productos.
3. Vidriera pública por tienda (catálogo, ficha de producto) y dominio propio por cliente.
4. Carrito y checkout con Mercado Pago.
5. Envíos y retiro en local.
6. Páginas institucionales, SEO, botón de WhatsApp, píxel de Meta y GA4.
7. Para producción: límite de intentos de login, recuperar clave, copias de seguridad de la base.
