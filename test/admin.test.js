import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import writeExcelFile from 'write-excel-file/node';
import { readSheet } from 'read-excel-file/node';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { COLUMNAS, interpretarHoja } from '../src/importacion/interpretar.js';
import { crearNavegador, conFotoEnCelda, PNG, otraFoto } from './ayudantes.js';

let servidor;
let base;
let db;
let dirImportaciones;
let dirSubidas;
let servidorFotos;
let fotos; // base de las URLs del servidor de fotos de prueba

before(async () => {
  dirImportaciones = mkdtempSync(path.join(tmpdir(), 'importaciones-'));
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dirImportaciones,
    dirSubidas,
    permitirLinksLocales: true, // el servidor de fotos de prueba está en 127.0.0.1
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;

  servidorFotos = http.createServer((req, res) => {
    if (req.url === '/foto.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(otraFoto(7));
    res.writeHead(404).end();
  });
  servidorFotos.listen(0, '127.0.0.1');
  await once(servidorFotos, 'listening');
  fotos = `http://127.0.0.1:${servidorFotos.address().port}`;
});

after(() => {
  servidor.close();
  servidorFotos.close();
  rmSync(dirImportaciones, { recursive: true, force: true });
  rmSync(dirSubidas, { recursive: true, force: true });
});

const tiendaIdDe = async (slug) => (await db.prepare('SELECT id FROM tiendas WHERE slug = ?').get(slug)).id;

const navegador = () => crearNavegador(base);

async function ingresarComoNuevaTienda(nombre) {
  const { clave } = await crearTienda(db, { nombre, email: `${nombre}@ejemplo.com` });
  const nav = navegador();
  const respuesta = await nav.enviar('/admin/ingresar', { email: `${nombre}@ejemplo.com`, clave });
  assert.equal(respuesta.status, 302);
  return nav;
}

const excel = (filas) => writeExcelFile(filas).toBuffer();

test('sin ingresar, el panel manda al login', async () => {
  const respuesta = await navegador().pedir('/admin/productos');
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/ingresar');
});

test('con clave incorrecta no deja entrar', async () => {
  await crearTienda(db, { nombre: 'clavemal', email: 'clavemal@ejemplo.com' });
  const nav = navegador();

  const respuesta = await nav.enviar('/admin/ingresar', { email: 'clavemal@ejemplo.com', clave: 'cualquiera' });

  assert.equal(respuesta.status, 401);
  assert.match(await respuesta.text(), /Email o clave incorrectos/);
  assert.equal((await nav.pedir('/admin/productos')).status, 302);
});

test('un formulario sin token CSRF se rechaza', async () => {
  const respuesta = await navegador().pedir('/admin/ingresar', {
    method: 'POST',
    body: new URLSearchParams({ email: 'x@ejemplo.com', clave: 'x' }),
  });
  assert.equal(respuesta.status, 403);
});

test('carga masiva: subir Excel, ver resumen, confirmar y ver los productos', async () => {
  const nav = await ingresarComoNuevaTienda('ropita');
  const archivo = await excel([
    ['SKU', 'Nombre', 'Precio', 'Stock', 'Atributo 1', 'Valor 1'],
    ['REM-S', 'Remera Básica', 12500, 10, 'Talle', 'S'],
    ['REM-M', 'Remera Básica', 12500, 5, null, 'M'],
    ['GORRA', 'Gorra', 8000, 3, null, null],
  ]);

  const vistaPrevia = await nav.subirExcel(archivo);
  assert.equal(vistaPrevia.status, 200);
  const htmlVistaPrevia = await vistaPrevia.text();
  assert.match(htmlVistaPrevia, /data-dato="productos-nuevos">2</);
  assert.match(htmlVistaPrevia, /data-dato="variantes-nuevas">3</);

  const productosAntes = await (await nav.pedir('/admin/productos')).text();
  assert.doesNotMatch(productosAntes, /Remera Básica/, 'antes de confirmar no se guarda nada');

  const confirmacion = await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  assert.equal(confirmacion.status, 302);
  assert.equal(confirmacion.headers.get('location'), '/admin/productos');

  const productos = await (await nav.pedir('/admin/productos')).text();
  assert.match(productos, /Remera Básica/);
  assert.match(productos, /Gorra/);
  assert.match(productos, /12\.500,00/);
  assert.match(productos, /se cargaron 2 productos nuevos/i);
  assert.deepEqual(readdirSync(dirImportaciones), [], 'el archivo temporal se borra al confirmar');
});

test('un Excel con errores muestra las filas y no deja confirmar', async () => {
  const nav = await ingresarComoNuevaTienda('conerrores');
  const archivo = await excel([
    ['SKU', 'Nombre', 'Precio'],
    ['A', 'Taza', 1000],
    ['B', 'Plato', 'gratis'],
  ]);

  const html = await (await nav.subirExcel(archivo)).text();
  assert.match(html, /Fila 3/);
  assert.match(html, /Precio inválido/);
  assert.doesNotMatch(html, /action="\/admin\/importar\/confirmar"/);

  const confirmacion = await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  assert.equal(confirmacion.headers.get('location'), '/admin/importar');
  assert.doesNotMatch(await (await nav.pedir('/admin/productos')).text(), /Taza/);
});

test('un archivo que no es Excel muestra un error entendible', async () => {
  const nav = await ingresarComoNuevaTienda('noexcel');
  const respuesta = await nav.subirExcel(Buffer.from('nombre,precio\nTaza,100'), 'productos.csv');
  assert.equal(respuesta.status, 400);
  assert.match(await respuesta.text(), /No pudimos leer el archivo/);
});

test('cada cliente ve solo los productos de su tienda', async () => {
  const navA = await ingresarComoNuevaTienda('tiendaa');
  await navA.subirExcel(await excel([['SKU', 'Nombre', 'Precio'], ['X1', 'Producto Secreto De A', 1000]]));
  await navA.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });

  const navB = await ingresarComoNuevaTienda('tiendab');
  assert.doesNotMatch(await (await navB.pedir('/admin/productos')).text(), /Producto Secreto De A/);
});

test('la plantilla descargada trae todas las columnas que se pueden importar', async () => {
  const nav = await ingresarComoNuevaTienda('plantilla');
  const respuesta = await nav.pedir('/admin/importar/plantilla.xlsx');
  assert.equal(respuesta.status, 200);

  const filas = await readSheet(Buffer.from(await respuesta.arrayBuffer()));
  assert.deepEqual(filas[0], COLUMNAS.map((c) => c.titulo));
  assert.deepEqual(interpretarHoja(filas).errores, []);
});

test('salir cierra la sesión', async () => {
  const nav = await ingresarComoNuevaTienda('salir');
  const respuesta = await nav.enviar('/admin/salir', {}, { desde: '/admin/productos' });
  assert.equal(respuesta.status, 302);
  assert.equal((await nav.pedir('/admin/productos')).status, 302);
});

// ---------- Fotos en la carga masiva ----------

test('carga masiva con fotos pegadas y por link, sin duplicar al volver a subir', async () => {
  const nav = await ingresarComoNuevaTienda('confotos');
  const hoja = [
    ['SKU', 'Nombre', 'Precio', 'img', 'link-img'],
    ['A1', 'Flotante', 1000, null, null],
    ['B1', 'Por Link', 1000, null, `${fotos}/foto.png`],
    ['C1', 'En Celda', 1000, null, null],
  ];
  const imagen = { content: PNG, contentType: 'image/png', width: 10, height: 10, dpi: 96, anchor: { row: 2, column: 4 } };
  const xlsx = conFotoEnCelda(await writeExcelFile(hoja, { images: [imagen] }).toBuffer(), 'D4', otraFoto(3));

  const vistaPrevia = await (await nav.subirExcel(xlsx)).text();
  assert.match(vistaPrevia, /data-dato="fotos-nuevas">3</);
  const confirmacion = await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  assert.equal(confirmacion.headers.get('location'), '/admin/productos');
  assert.match(await (await nav.pedir('/admin/productos')).text(), /Se agregaron 3 fotos/);

  const tiendaId = await tiendaIdDe('confotos');
  const filas = await db
    .prepare(`SELECT p.nombre, f.archivo FROM producto_fotos f JOIN productos p ON p.id = f.producto_id
              WHERE f.tienda_id = ? ORDER BY p.nombre`)
    .all(tiendaId);
  assert.deepEqual(filas.map((f) => f.nombre), ['En Celda', 'Flotante', 'Por Link']);
  for (const { archivo } of filas) assert.ok(existsSync(path.join(dirSubidas, String(tiendaId), archivo)), archivo);

  assert.match(await (await nav.subirExcel(xlsx)).text(), /data-dato="fotos-nuevas">0</);
});

test('un link caído se ve en la vista previa y no deja confirmar', async () => {
  const nav = await ingresarComoNuevaTienda('linkcaido');
  const archivo = await excel([['SKU', 'Nombre', 'Precio', 'link-img'], ['X', 'Algo', 1000, `${fotos}/no-existe`]]);
  const html = await (await nav.subirExcel(archivo)).text();
  assert.match(html, /Fila 2/);
  assert.match(html, /Foto de &#34;link-img&#34;: el link respondió con un error \(404\)/);
  assert.doesNotMatch(html, /action="\/admin\/importar\/confirmar"/);
});

test('subir otro archivo descarta la carpeta pendiente anterior', async () => {
  const nav = await ingresarComoNuevaTienda('dosveces');
  const archivo = await excel([['SKU', 'Nombre', 'Precio'], ['Z', 'Zeta', 1000]]);
  await nav.subirExcel(archivo);
  await nav.subirExcel(archivo);
  const prefijo = `${await tiendaIdDe('dosveces')}-`;
  assert.equal(readdirSync(dirImportaciones).filter((n) => n.startsWith(prefijo)).length, 1);
});

test('una importación pendiente del formato viejo se trata como si no hubiera ninguna', async () => {
  const nav = await ingresarComoNuevaTienda('sesionvieja');
  await nav.subirExcel(await excel([['SKU', 'Nombre', 'Precio'], ['V', 'Vieja', 1000]]));
  await db.prepare(
    `UPDATE sesiones SET datos = jsonb_set(datos::jsonb, '{importacion}', ?::jsonb)::text
     WHERE (datos::jsonb #>> '{usuario,tiendaId}')::int = ?`,
  ).run(JSON.stringify({ archivo: 'viejo.xlsx', nombreOriginal: 'viejo.xlsx' }), await tiendaIdDe('sesionvieja'));
  const respuesta = await nav.enviar('/admin/importar/confirmar', {}, { desde: '/admin/importar' });
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/importar');
  assert.doesNotMatch(await (await nav.pedir('/admin/productos')).text(), /Vieja/);
});

test('un Excel de más de 30 MB se rechaza con un mensaje claro', async () => {
  const nav = await ingresarComoNuevaTienda('pesado');
  const respuesta = await nav.subirExcel(Buffer.alloc(31 * 1024 * 1024));
  assert.equal(respuesta.status, 400);
  assert.match(await respuesta.text(), /pesa más de 30 MB/);
});
