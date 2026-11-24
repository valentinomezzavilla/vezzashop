// Vidriera: qué se hace con los productos sin stock y cómo se muestran las categorías cuando son muchas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { leerAjustes, actualizarAjustes, SIN_STOCK, CATEGORIAS_PORTADA } from '../src/diseno.js';
import { arbolCategorias, productosVisibles, contarVisibles } from '../src/vidriera.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

let servidor;
let puerto;
let db;
let dirSubidas;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = await abrirBase(':memory:');
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

const vidriera = (slug, ruta = '/') => pedirConHost(puerto, `${slug}.localhost`, ruta);
const nombresEn = (html) => [...html.matchAll(/<span class="nombre">([^<]+)<\/span>/g)].map((m) => m[1]);

// Tres productos en la categoría "Hogar" (Zeta con stock; Agotado y Rota sin stock) y uno solo de agotados en "Liquidación".
async function tiendaConStock(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Categorías', 'Precio', 'Stock'],
    ['Z-1', 'Zeta', 'Hogar', 1000, 3],
    ['A-1', 'Agotado', 'Hogar', 2000, 0],
    ['R-1', 'Rota', 'Liquidación', 3000, 0],
  ]);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tienda.id, productos);
  return { tiendaId: tienda.id, slug, clave };
}

test('sinStock "mostrar" (lo de siempre): todo aparece, cada uno en su lugar', async () => {
  const { slug, tiendaId } = await tiendaConStock('stock-mostrar');
  assert.equal((await leerAjustes(db, tiendaId)).sinStock, 'mostrar', 'por defecto no cambia nada');
  assert.deepEqual(nombresEn((await vidriera(slug)).cuerpo), ['Agotado', 'Rota', 'Zeta']);
  assert.equal(await contarVisibles(db, tiendaId, {}), 3);
});

test('sinStock "al-final": los que no tienen stock van después, en cualquier orden', async () => {
  const { slug, tiendaId } = await tiendaConStock('stock-final');
  await actualizarAjustes(db, tiendaId, { sinStock: 'al-final' });
  assert.deepEqual(nombresEn((await vidriera(slug)).cuerpo), ['Zeta', 'Agotado', 'Rota']);
  assert.deepEqual(nombresEn((await vidriera(slug, '/?orden=precio-mayor')).cuerpo), ['Zeta', 'Rota', 'Agotado'], 'primero el stock, y adentro de cada grupo el orden elegido');
  assert.deepEqual(nombresEn((await vidriera(slug, '/categoria/hogar')).cuerpo), ['Zeta', 'Agotado']);
  assert.equal(await contarVisibles(db, tiendaId, { sinStock: 'al-final' }), 3, 'no se oculta nada');
});

test('sinStock "ocultar": no salen del catálogo, ni del conteo, ni del buscador, ni de las categorías; su link sigue abierto', async () => {
  const { slug, tiendaId } = await tiendaConStock('stock-ocultar');
  await actualizarAjustes(db, tiendaId, { sinStock: 'ocultar' });
  const portada = (await vidriera(slug)).cuerpo;
  assert.deepEqual(nombresEn(portada), ['Zeta']);
  assert.match(portada, /1 producto</);
  assert.doesNotMatch(portada, /Liquidación/, 'una categoría con solo productos sin stock no se muestra');
  assert.match(portada, /Hogar/);
  assert.equal((await vidriera(slug, '/categoria/liquidacion')).status, 404);
  assert.deepEqual(nombresEn((await vidriera(slug, '/categoria/hogar')).cuerpo), ['Zeta']);
  assert.deepEqual(JSON.parse((await vidriera(slug, '/api/buscar?q=agotado')).cuerpo), { total: 0, productos: [] });
  assert.deepEqual(JSON.parse((await vidriera(slug, '/api/buscar?q=zeta')).cuerpo).productos.map((p) => p.nombre), ['Zeta']);
  assert.equal((await vidriera(slug, '/producto/agotado')).status, 200, 'quien tiene el link lo sigue viendo, con su etiqueta de sin stock');
  assert.match((await vidriera(slug, '/producto/agotado')).cuerpo, /Sin stock/);
  // Y con "mostrar" la categoría vuelve.
  assert.deepEqual((await arbolCategorias(db, tiendaId, { sinStock: 'ocultar' })).map((c) => c.nombre), ['Hogar']);
  assert.deepEqual((await arbolCategorias(db, tiendaId)).map((c) => c.nombre), ['Hogar', 'Liquidación']);
  assert.deepEqual((await productosVisibles(db, tiendaId, { sinStock: 'ocultar' })).map((p) => p.nombre), ['Zeta']);
});

// Una tienda con 14 categorías de primer nivel, todas con un producto a la vista.
async function tiendaConCategorias(slug, cantidad) {
  const { tienda } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const categorias = Array.from({ length: cantidad }, (_, n) => `Cat ${String(n + 1).padStart(2, '0')}`).join(', ');
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Categorías', 'Precio', 'Stock'],
    ['P-1', 'Producto', categorias, 1000, 5],
  ]);
  await aplicarImportacion(db, tienda.id, productos);
  return { slug, tiendaId: tienda.id };
}

const chips = (html) => {
  const nav = html.match(/<nav class="chips"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const resto = nav.match(/<div class="chips-resto">([\s\S]*?)<\/div>/)?.[1] ?? '';
  const enlaces = (texto) => [...texto.matchAll(/<a class="chip" href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
  return { visibles: enlaces(nav.replace(/<details[\s\S]*<\/details>/, '')), resto: enlaces(resto), desplegable: /<details class="chips-mas">/.test(nav), boton: nav.match(/Ver todas \((\d+)\)/)?.[1] ?? null };
};

test('con muchas categorías, la portada muestra las primeras 8 y el resto queda detrás de "Ver todas"', async () => {
  const { slug } = await tiendaConCategorias('chips-muchas', 14);
  const { visibles, resto, desplegable, boton } = chips((await vidriera(slug)).cuerpo);
  assert.equal(visibles.length, 8);
  assert.equal(visibles[0], 'Cat 01');
  assert.equal(desplegable, true);
  assert.equal(boton, '14');
  assert.equal(resto.length, 6);
  assert.deepEqual(resto, ['Cat 09', 'Cat 10', 'Cat 11', 'Cat 12', 'Cat 13', 'Cat 14']);
});

test('con 8 categorías o menos no hay desplegable', async () => {
  const { slug } = await tiendaConCategorias('chips-pocas', 8);
  const { visibles, desplegable } = chips((await vidriera(slug)).cuerpo);
  assert.equal(visibles.length, 8);
  assert.equal(desplegable, false);
});

test('el pie de la tienda muestra las primeras 12 categorías y un "Ver todas" con el resto', async () => {
  const { slug } = await tiendaConCategorias('pie-muchas', 14);
  const pie = (await vidriera(slug)).cuerpo.match(/<nav class="pie-bloque pie-categorias"[\s\S]*?<\/nav>/)[0];
  const enlaces = [...pie.matchAll(/<a href="\/categoria\/[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.equal(enlaces.length, 14, 'están todas en la página: las 12 de entrada y las 2 del desplegable');
  assert.match(pie, /<details class="chips-mas pie-mas">/);
  assert.match(pie, /Ver todas \(14\)/);
  const dentro = pie.match(/<details[\s\S]*<\/details>/)[0];
  assert.equal([...dentro.matchAll(/<a href=/g)].length, 2);
});

test('categoriasPortada "todas" muestra todas juntas y "ninguna" saca los botones de la portada', async () => {
  const { slug, tiendaId } = await tiendaConCategorias('chips-ajuste', 14);
  await actualizarAjustes(db, tiendaId, { categoriasPortada: 'todas' });
  const todas = chips((await vidriera(slug)).cuerpo);
  assert.equal(todas.visibles.length, 14);
  assert.equal(todas.desplegable, false);
  assert.doesNotMatch((await vidriera(slug)).cuerpo, /pie-mas/, 'el pie tampoco recorta');

  await actualizarAjustes(db, tiendaId, { categoriasPortada: 'ninguna' });
  const portada = (await vidriera(slug)).cuerpo;
  assert.doesNotMatch(portada, /<nav class="chips"/);
  assert.match(portada, /Cat 14/, 'las categorías siguen en el pie');
});

test('en Diseño se eligen los dos ajustes nuevos y se guardan; un valor inventado se rechaza', async () => {
  const { tiendaId, clave, slug } = await tiendaConStock('diseno-catalogo');
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  const formulario = await (await nav.pedir('/admin/diseno')).text();
  for (const clave of Object.keys(SIN_STOCK)) assert.match(formulario, new RegExp(`name="sinStock" value="${clave}"`));
  for (const clave of Object.keys(CATEGORIAS_PORTADA)) assert.match(formulario, new RegExp(`name="categoriasPortada" value="${clave}"`));
  assert.match(formulario, /name="sinStock" value="mostrar" checked/);
  assert.match(formulario, /name="categoriasPortada" value="pocas" checked/);

  const base = { colorPrincipal: '#1a1a1a', ordenCatalogo: 'nombre' };
  const mal = await nav.enviar('/admin/diseno', { ...base, sinStock: 'borrar-todo' }, { desde: '/admin/diseno' });
  assert.equal(mal.status, 400);
  assert.equal((await leerAjustes(db, tiendaId)).sinStock, 'mostrar');

  const bien = await nav.enviar('/admin/diseno', { ...base, sinStock: 'ocultar', categoriasPortada: 'todas' }, { desde: '/admin/diseno' });
  assert.equal(bien.status, 302);
  const ajustes = await leerAjustes(db, tiendaId);
  assert.equal(ajustes.sinStock, 'ocultar');
  assert.equal(ajustes.categoriasPortada, 'todas');
  assert.match(await (await nav.pedir('/admin/diseno')).text(), /name="sinStock" value="ocultar" checked/);

  // Otro formulario (que no manda estos campos) no los pisa.
  await nav.enviar('/admin/pagos', { pagoEfectivo: '1' }, { desde: '/admin/pagos' });
  assert.equal((await leerAjustes(db, tiendaId)).sinStock, 'ocultar');
});
