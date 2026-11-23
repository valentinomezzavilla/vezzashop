import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, editarPlan, pausarPlan, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { armarPlanes, ofertasJsonLd } from '../src/landing.js';
import { pedirConHost } from './ayudantes.js';

const PUBLICO = path.join(import.meta.dirname, '..', 'src', 'publico');
let servidor;
let puerto;
let db;

before(async () => {
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => servidor.close());

test('el dominio principal muestra la landing, sin crear sesión', async () => {
  const respuesta = await pedirConHost(puerto, 'localhost', '/');
  assert.equal(respuesta.status, 200);
  assert.match(respuesta.headers['content-type'], /text\/html/);
  assert.match(respuesta.cuerpo, /<title>VEZZA Shop/);
  assert.equal(respuesta.headers['set-cookie'], undefined);
});

test('la landing lleva al panel, que sigue en /admin', async () => {
  const landing = (await pedirConHost(puerto, 'localhost', '/')).cuerpo;
  assert.match(landing, /href="\/admin"/);
  const panel = await pedirConHost(puerto, 'localhost', '/admin');
  assert.equal(panel.status, 302);
  assert.equal(panel.location, '/admin/ingresar');
});

test('todas las imágenes y archivos que usa la landing existen', async () => {
  const landing = (await pedirConHost(puerto, 'localhost', '/')).cuerpo;
  const locales = [...landing.matchAll(/(?:src|href|content)="(\/(?:landing|vezza)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(locales.length > 10, 'la landing debería usar varias imágenes');
  for (const ruta of new Set(locales)) {
    assert.ok(existsSync(path.join(PUBLICO, ruta)), `falta ${ruta}`);
    assert.equal((await pedirConHost(puerto, 'localhost', ruta)).status, 200, `${ruta} no se sirve`);
  }
});

test('la landing no rompe las tiendas: un subdominio sin tienda sigue dando 404', async () => {
  assert.equal((await pedirConHost(puerto, 'no-existe.localhost', '/')).status, 404);
});

// ---------- Planes: la sección sale de la base ----------

const plan = (datos) => ({ id: 1, activo: true, diasPrueba: null, suspenderAlVencer: false, maxProductos: 150, maxFotos: 4, maxBanners: 2, precioCentavos: 1_290_000, nombre: 'Esencial', ...datos });
const pagina = async () => (await pedirConHost(puerto, 'localhost', '/')).cuerpo;

test('armarPlanes: precio, topes y botón de cada tarjeta, del más barato al más caro', () => {
  const tarjetas = armarPlanes([
    plan({ id: 3, nombre: 'A medida', precioCentavos: 8_990_000, maxProductos: null, maxFotos: null, maxBanners: null }),
    plan({ id: 1, nombre: 'Prueba', precioCentavos: 0, maxProductos: 20, maxFotos: 3, maxBanners: 1, diasPrueba: 7, suspenderAlVencer: true }),
    plan({ id: 2 }),
  ]);
  assert.deepEqual(tarjetas.map((t) => t.nombre), ['Prueba', 'Esencial', 'A medida']);
  const [prueba, esencial, medida] = tarjetas;

  assert.equal(prueba.precio, 'Gratis');
  assert.equal(prueba.unidad, '7 días');
  assert.deepEqual(prueba.items, ['Hasta 20 productos', '3 fotos por producto', '1 banner de bienvenida', 'Al terminar, la tienda se pausa hasta que elijas un plan']);
  assert.equal(prueba.boton.texto, 'Empezar prueba');

  assert.match(esencial.precio.replace(/\s/g, ' '), /^\$ 12\.900$/);
  assert.equal(esencial.unidad, '/ mes');
  assert.deepEqual(esencial.items, ['Hasta 150 productos', '4 fotos por producto', '2 banners de bienvenida', 'Todo lo del panel y la tienda']);
  assert.equal(esencial.boton.texto, 'Elegir Esencial');
  assert.equal(esencial.boton.mensaje, 'Hola, quiero contratar el plan Esencial de VEZZA Shop.');

  assert.deepEqual(medida.items.slice(0, 3), ['Productos sin tope', 'Hasta 10 fotos por producto', 'Hasta 6 banners de bienvenida']);
  assert.equal(medida.boton.texto, 'Consultar');
});

test('armarPlanes: el recomendado es el plan pago más barato, y solo si hay con quién compararlo', () => {
  const tarjetas = armarPlanes([plan({ id: 1, nombre: 'Prueba', precioCentavos: 0, diasPrueba: 7 }), plan({ id: 2 }), plan({ id: 3, nombre: 'Pro', precioCentavos: 5_000_000, maxProductos: 1000 })]);
  assert.deepEqual(tarjetas.filter((t) => t.destacado).map((t) => t.nombre), ['Esencial']);
  assert.equal(armarPlanes([plan()])[0].destacado, false);
});

test('armarPlanes: los miles se separan con punto, los centavos solo aparecen si hay, y los planes pausados no salen', () => {
  const tarjetas = armarPlanes([plan({ id: 1, maxProductos: 1000 }), plan({ id: 2, nombre: 'Raro', precioCentavos: 1_250_050 }), plan({ id: 3, nombre: 'Pausado', activo: false })]);
  assert.equal(tarjetas.length, 2);
  const mil = tarjetas.find((t) => t.nombre === 'Esencial');
  const centavos = tarjetas.find((t) => t.nombre === 'Raro');
  assert.ok(mil.items[0].endsWith('1.000 productos'), mil.items[0]);
  assert.match(centavos.precio, /12\.500,50/);
  assert.equal(armarPlanes([plan({ activo: false })]).length, 0);
});

test('armarPlanes: un plan gratis y sin prueba (como "Sin límites") es interno y no se muestra', () => {
  assert.equal(armarPlanes([plan({ nombre: 'Sin límites', precioCentavos: 0, maxProductos: null, maxFotos: null, maxBanners: null })]).length, 0);
  assert.equal(armarPlanes([plan({ nombre: 'Prueba', precioCentavos: 0, diasPrueba: 7 })]).length, 1);
  assert.equal(JSON.parse(ofertasJsonLd([plan({ nombre: 'Sin límites', precioCentavos: 0 })])).length, 0);
});

test('ofertasJsonLd: lista los planes activos y no deja cerrar el <script>', () => {
  const json = ofertasJsonLd([plan({ nombre: '</script><b>' }), plan({ id: 2, nombre: 'Pausado', activo: false })]);
  assert.ok(!json.includes('<'));
  const ofertas = JSON.parse(json);
  assert.equal(ofertas.length, 1);
  assert.deepEqual(ofertas[0], { '@type': 'Offer', name: '</script><b>', price: '12900', priceCurrency: 'ARS' });
});

test('la landing muestra los planes de la base y se actualiza cuando se editan o se pausan', async () => {
  // Sin planes para ofrecer (la base solo trae el interno "Sin límites"): la sección sigue, con un llamado a consultar.
  let html = await pagina();
  assert.match(html, /id="planes"/);
  assert.match(html, /Consultar planes/);
  assert.ok(!html.includes('class="plans"'));

  const [esencial, medida] = PLANES_SUGERIDOS.filter((p) => ['Esencial', 'A medida'].includes(p.nombre));
  const idEsencial = await crearPlan(db, { ...esencial, activo: true });
  const idMedida = await crearPlan(db, { ...medida, activo: true });
  html = await pagina();
  assert.ok(html.includes('<h3>Esencial</h3>'));
  assert.ok(html.includes('<h3>A medida</h3>'));
  assert.match(html, /Hasta 150 productos/);
  assert.match(html, /Productos sin tope/);
  assert.match(html, /"price": "12900"/);
  assert.match(html, /plan plan--hl reveal/);

  // Se edita el precio y el tope desde la plataforma: la landing lo refleja en el acto.
  await editarPlan(db, idEsencial, { ...esencial, activo: true, nombre: 'Esencial Plus', precioCentavos: 1_500_000, maxProductos: 300 });
  html = await pagina();
  assert.ok(html.includes('<h3>Esencial Plus</h3>'));
  assert.match(html, /Hasta 300 productos/);
  assert.match(html, /"price": "15000"/);
  assert.ok(!html.includes('Hasta 150 productos'));

  // Un plan pausado deja de mostrarse.
  await pausarPlan(db, idMedida, true);
  html = await pagina();
  assert.ok(!html.includes('<h3>A medida</h3>'));
  assert.ok(!html.includes('Productos sin tope'));
});
