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
import { slugDeHost } from '../src/util/dominios.js';
import { pedirConHost } from './ayudantes.js';

const ENCABEZADOS = ['SKU', 'Nombre', 'Categorías', 'Precio', 'Precio promocional', 'Stock', 'Atributo 1', 'Valor 1', 'Visible'];

let servidor;
let puerto;

before(async () => {
  const db = await abrirBase(':memory:');
  const ropa = await crearTienda(db, { nombre: 'Ropa', email: 'ropa@ejemplo.com' });
  const parabrisas = await crearTienda(db, { nombre: 'Parabrisas', email: 'parabrisas@ejemplo.com' });
  await importar(db, ropa.tienda.id, [
    ENCABEZADOS,
    ['REM-S', 'Remera Básica', 'Ropa > Remeras', 12500, 9900, 10, 'Talle', 'S', 'Sí'],
    ['REM-M', 'Remera Básica', null, 12500, 9900, 0, null, 'M', null],
    ['BUZO', 'Buzo Frisa', 'Ropa > Buzos', 30000, null, 2, null, null, null],
    ['TOTE', 'Tote Secreta', 'Accesorios', 5000, null, 5, null, null, 'No'],
  ]);
  await importar(db, parabrisas.tienda.id, [
    ENCABEZADOS,
    ['PB-01', 'Parabrisas Gol Trend', 'Vidrios', 180000, null, 4, null, null, null],
  ]);

  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirSubidas: mkdtempSync(path.join(tmpdir(), 'subidas-')),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => servidor.close());

async function importar(db, tiendaId, hoja) {
  const { productos, errores } = interpretarHoja(hoja);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tiendaId, productos);
}

const pedir = (host, ruta) => pedirConHost(puerto, host, ruta);

test('slugDeHost reconoce el subdominio de la tienda', () => {
  assert.equal(slugDeHost('ropa.localhost', 'localhost'), 'ropa');
  assert.equal(slugDeHost('Ropa.VezzaShop.com', 'vezzashop.com'), 'ropa');
  assert.equal(slugDeHost('localhost', 'localhost'), null);
  assert.equal(slugDeHost('www.vezzashop.com', 'vezzashop.com'), null);
  assert.equal(slugDeHost('127.0.0.1', 'localhost'), null);
  assert.equal(slugDeHost('ropa.otrodominio.com', 'vezzashop.com'), null);
});

test('cada subdominio muestra solo los productos de su tienda', async () => {
  const ropa = await pedir('ropa.localhost', '/');
  assert.equal(ropa.status, 200);
  assert.match(ropa.cuerpo, /Remera Básica/);
  assert.match(ropa.cuerpo, /Buzo Frisa/);
  assert.doesNotMatch(ropa.cuerpo, /Parabrisas Gol Trend/);

  const parabrisas = await pedir('parabrisas.localhost', '/');
  assert.equal(parabrisas.status, 200);
  assert.match(parabrisas.cuerpo, /Parabrisas Gol Trend/);
  assert.doesNotMatch(parabrisas.cuerpo, /Remera Básica/);
});

test('los productos ocultos no aparecen ni se pueden abrir', async () => {
  const catalogo = await pedir('ropa.localhost', '/');
  assert.doesNotMatch(catalogo.cuerpo, /Tote Secreta/);
  assert.doesNotMatch(catalogo.cuerpo, /Accesorios/, 'una categoría sin productos visibles no va en el menú');
  assert.equal((await pedir('ropa.localhost', '/producto/tote-secreta')).status, 404);
});

test('una tienda no puede mostrar la ficha de un producto de otra', async () => {
  assert.equal((await pedir('ropa.localhost', '/producto/parabrisas-gol-trend')).status, 404);
  assert.equal((await pedir('parabrisas.localhost', '/producto/parabrisas-gol-trend')).status, 200);
});

test('una categoría incluye los productos de sus subcategorías', async () => {
  const ropa = await pedir('ropa.localhost', '/categoria/ropa');
  assert.equal(ropa.status, 200);
  assert.match(ropa.cuerpo, /Remera Básica/);
  assert.match(ropa.cuerpo, /Buzo Frisa/);

  const remeras = await pedir('ropa.localhost', '/categoria/ropa/remeras');
  assert.match(remeras.cuerpo, /Remera Básica/);
  assert.doesNotMatch(remeras.cuerpo, /Buzo Frisa/);

  assert.equal((await pedir('ropa.localhost', '/categoria/remeras')).status, 404);
});

test('la ficha muestra el precio de oferta y arranca en una variante con stock', async () => {
  const { status, cuerpo } = await pedir('ropa.localhost', '/producto/remera-basica');
  assert.equal(status, 200);
  assert.match(cuerpo, /data-precio>\$\s9\.900,00</);
  assert.match(cuerpo, /<s data-precio-lista>\$\s12\.500,00<\/s>/);
  assert.match(cuerpo, /data-sku>REM-S</);
  assert.match(cuerpo, /name="atributo-0" value="S" data-atributo="0" checked>/);
  assert.match(cuerpo, /"sku":"REM-M"/);
});

test('un subdominio que no es de ninguna tienda da 404', async () => {
  const { status, cuerpo } = await pedir('noexiste.localhost', '/');
  assert.equal(status, 404);
  assert.match(cuerpo, /Esta tienda no existe/);
});

test('el panel se usa desde el dominio principal', async () => {
  const principal = await pedir('localhost', '/');
  assert.equal(principal.status, 302);
  assert.equal(principal.location, '/admin');

  const desdeTienda = await pedir('ropa.localhost', '/admin/productos');
  assert.equal(desdeTienda.status, 302);
  assert.equal(desdeTienda.location, `http://localhost:${puerto}/admin`);
});
