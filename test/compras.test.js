// Vidriera: buscador, filtros, paginación, carrito, relacionados y datos para compartir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { leerAjustes, guardarAjustes } from '../src/diseno.js';
import { pedirConHost } from './ayudantes.js';

const ENCABEZADOS = ['SKU', 'Nombre', 'Marca', 'Categorías', 'Precio', 'Precio promocional', 'Stock', 'Atributo 1', 'Valor 1', 'Visible'];

let servidor;
let puerto;

before(async () => {
  const db = (await abrirBase(':memory:'));
  const moda = await crearTienda(db, { nombre: 'Moda', email: 'moda@ejemplo.com' });
  const muchos = await crearTienda(db, { nombre: 'Muchos', email: 'muchos@ejemplo.com' });
  (await importar(db, moda.tienda.id, [
    ENCABEZADOS,
    ['CAM-S', 'Camión de Juguete', 'Jugueterías Ñandú', 'Juguetes', 12500, 9900, 3, 'Color', 'Rojo', 'Sí'],
    ['CAM-M', 'Camión de Juguete', null, null, 12500, null, 0, null, 'Azul', null],
    ['BUZO-1', 'Buzo Frisa', 'Vezza', 'Ropa', 30000, null, 2, null, null, null],
    ['GOR-1', 'Gorra Sin Stock', null, 'Ropa', 5000, null, 0, null, null, null],
    ['OCU-1', 'Producto Oculto Camión', null, 'Ropa', 5000, null, 5, null, null, 'No'],
  ]));
  (await guardarAjustes(db, moda.tienda.id, { ...(await leerAjustes(db, moda.tienda.id)), whatsapp: '5493511234567', descuentoTransferencia: 10 }));
  (await importar(db, muchos.tienda.id, [
    ['SKU', 'Nombre', 'Precio', 'Stock'],
    ...Array.from({ length: 30 }, (_, i) => [`P-${i}`, `Producto ${String(i).padStart(2, '0')}`, 1000 + i, 1]),
  ]));

  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas: mkdtempSync(path.join(tmpdir(), 'subidas-')) };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => servidor.close());

async function importar(db, tiendaId, hoja) {
  const { productos, errores } = interpretarHoja(hoja);
  assert.deepEqual(errores, []);
  (await aplicarImportacion(db, tiendaId, productos));
}

const pedir = (ruta, tienda = 'moda') => pedirConHost(puerto, `${tienda}.localhost`, ruta);
const json = async (ruta, tienda) => JSON.parse((await pedir(ruta, tienda)).cuerpo);
const nombresEnGrilla = (html) =>
  [...(html.split('data-grilla')[1] ?? '').matchAll(/<span class="nombre">([^<]+)<\/span>/g)].map((m) => m[1]);

// ---------- Buscador ----------

test('el buscador encuentra sin importar tildes ni mayúsculas, y no muestra ocultos', async () => {
  for (const q of ['camion', 'CAMIÓN', 'juguete camión']) {
    const nombres = nombresEnGrilla((await pedir(`/buscar?q=${encodeURIComponent(q)}`)).cuerpo);
    assert.deepEqual(nombres, ['Camión de Juguete'], `buscando "${q}"`);
  }
  assert.deepEqual(nombresEnGrilla((await pedir('/buscar?q=nandu')).cuerpo), ['Camión de Juguete'], 'busca también en la marca');
  assert.deepEqual(nombresEnGrilla((await pedir('/buscar?q=buzo-1')).cuerpo), ['Buzo Frisa'], 'y en el SKU');
});

test('búsqueda vacía o sin resultados guía al visitante en vez de dejarlo en blanco', async () => {
  const vacia = (await pedir('/buscar')).cuerpo;
  assert.match(vacia, /¿Qué estás buscando\?/);
  assert.deepEqual(nombresEnGrilla(vacia), []);
  const nada = (await pedir('/buscar?q=heladera')).cuerpo;
  assert.match(nada, /No encontramos "heladera"/);
  assert.match(nada, /class="chip" href="\/categoria\/juguetes"/, 'sugiere las categorías');
});

test('las sugerencias del buscador vienen en JSON, sin productos ocultos', async () => {
  const { total, productos } = await json('/api/buscar?q=cami');
  assert.equal(total, 1);
  assert.deepEqual(productos.map((p) => [p.nombre, p.url]), [['Camión de Juguete', '/producto/camion-de-juguete']]);
  assert.match(productos[0].precio, /Desde \$\s9\.900,00/);
  assert.deepEqual(await json('/api/buscar?q=c'), { total: 0, productos: [] }, 'con una sola letra no busca');
});

// ---------- Filtros y paginación ----------

test('filtros de stock, oferta y precio, con chips para quitarlos', async () => {
  assert.deepEqual(nombresEnGrilla((await pedir('/?stock=1')).cuerpo).sort(), ['Buzo Frisa', 'Camión de Juguete']);
  assert.deepEqual(nombresEnGrilla((await pedir('/?oferta=1')).cuerpo), ['Camión de Juguete']);
  const caros = (await pedir('/?min=20000&max=40000')).cuerpo;
  assert.deepEqual(nombresEnGrilla(caros), ['Buzo Frisa']);
  assert.match(caros, /aria-label="Quitar filtro: Desde \$\s20\.000,00"/);
  const nada = (await pedir('/?min=999999')).cuerpo;
  assert.match(nada, /Ningún producto cumple esos filtros/);
  assert.equal((await pedir('/?min=abc')).status, 200, 'un valor raro se ignora');
});

test('el catálogo se pagina de a 24 con "Ver más"', async () => {
  const primera = (await pedir('/?orden=nombre', 'muchos')).cuerpo;
  assert.equal(nombresEnGrilla(primera).length, 24);
  assert.match(primera, /Viendo 24 de 30/);
  assert.match(primera, /href="\/\?orden=nombre&amp;pagina=2" data-ver-mas/);
  const segunda = (await pedir('/?orden=nombre&pagina=2', 'muchos')).cuerpo;
  assert.deepEqual(nombresEnGrilla(segunda), ['Producto 24', 'Producto 25', 'Producto 26', 'Producto 27', 'Producto 28', 'Producto 29']);
  assert.doesNotMatch(segunda, /data-ver-mas/);
  assert.equal(nombresEnGrilla((await pedir('/?pagina=99', 'muchos')).cuerpo).length, 6, 'una página de más muestra la última');
});

// ---------- Carrito ----------

test('el carrito pide precios y stock frescos, solo de productos visibles', async () => {
  const { variantes } = await json('/api/carrito?skus=CAM-S,CAM-M,OCU-1,NO-EXISTE');
  assert.deepEqual(
    variantes.map((v) => [v.sku, v.nombre, v.detalle, v.precioFinal, v.disponibles]).sort(),
    [['CAM-M', 'Camión de Juguete', 'Color Azul', 1250000, 0], ['CAM-S', 'Camión de Juguete', 'Color Rojo', 990000, 3]],
  );
  assert.deepEqual(await json('/api/carrito'), { variantes: [] });
});

test('sin checkout, la ficha tiene carrito solo si la tienda tiene WhatsApp', async () => {
  const conWhatsapp = (await pedir('/producto/camion-de-juguete')).cuerpo;
  assert.match(conWhatsapp, /data-agregar/);
  assert.match(conWhatsapp, /<dialog class="panel-carrito"[^>]*data-whatsapp="5493511234567"/);
  assert.match(conWhatsapp, /Enviar pedido por WhatsApp/, 'sin formas de entrega y pago, el pedido se manda por WhatsApp');
  assert.doesNotMatch(conWhatsapp, /Con transferencia \(/, 'el carrito no da por hecho cómo se va a pagar');
  assert.match(conWhatsapp, /data-avisame hidden/, 'con stock no se ofrece el aviso');

  const sinStock = (await pedir('/producto/gorra-sin-stock')).cuerpo;
  assert.match(sinStock, /data-comprar hidden/);
  const aviso = sinStock.match(/href="([^"]+)" target="_blank" rel="noopener" data-avisame>/);
  assert.match(decodeURIComponent(aviso[1]), /avisan cuando vuelva a haber stock de Gorra Sin Stock/);

  const sinWhatsapp = (await pedir('/producto/producto-00', 'muchos')).cuerpo;
  assert.doesNotMatch(sinWhatsapp, /data-agregar|panel-carrito/);
});

// ---------- Ficha: relacionados y datos para compartir ----------

test('productos relacionados: primero de la misma categoría, sin el propio ni ocultos ni sin stock', async () => {
  const html = (await pedir('/producto/buzo-frisa')).cuerpo;
  const seccion = html.slice(html.indexOf('class="relacionados"'));
  const relacionados = [...seccion.matchAll(/<span class="nombre">([^<]+)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(relacionados, ['Camión de Juguete']);
});

test('la ficha trae la vista previa para compartir y los datos para Google', async () => {
  const html = (await pedir('/producto/camion-de-juguete')).cuerpo;
  assert.match(html, /<meta property="og:title" content="Camión de Juguete">/);
  assert.match(html, /<meta property="og:type" content="product">/);
  assert.match(html, /<meta property="product:price:amount" content="9900">/);
  assert.match(html, /<link rel="canonical" href="http:\/\/moda\.localhost:\d+\/producto\/camion-de-juguete">/);
  const datos = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  assert.equal(datos['@type'], 'Product');
  assert.deepEqual(
    [datos.offers.lowPrice, datos.offers.highPrice, datos.offers.priceCurrency, datos.offers.availability],
    [9900, 12500, 'ARS', 'https://schema.org/InStock'],
  );
  assert.equal(datos.brand.name, 'Jugueterías Ñandú');
});

test('sin logo, el ícono de la pestaña es la inicial de la tienda en su color', async () => {
  const html = (await pedir('/')).cuerpo;
  // En el atributo las comillas simples van como &#39; (el navegador las decodifica).
  const icono = decodeURIComponent(html.match(/<link rel="icon" href="data:image\/svg\+xml,([^"]+)">/)[1].replace(/&#39;/g, "'"));
  assert.match(icono, /fill='#1a1a1a'/);
  assert.match(icono, />M<\/text>/);
});
