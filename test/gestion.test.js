// Gestión de la tienda desde el panel: productos de a uno, fotos, categorías, cuenta e inicio.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda, autenticar } from '../src/tiendas.js';
import { validarProducto, guardarProducto, leerProducto, precioParaEditar } from '../src/productos.js';
import { crearCategoria } from '../src/categorias.js';
import { crearNavegador, pedirConHost, crearTiendaVacia } from './ayudantes.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let servidor;
let puerto;
let db;
let dirSubidas;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = (await abrirBase(':memory:'));
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

async function tiendaConPanel(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: tienda.id, clave };
}

// Arma el formulario del editor de producto como lo manda el navegador: listas paralelas por variante.
function formularioProducto({ nombre, descripcion = '', atributos = [], variantes, visible = true, destacado = false, categorias = [] }) {
  const pares = [['nombre', nombre], ['descripcion', descripcion], ['marca', '']];
  if (visible) pares.push(['visible', '1']);
  if (destacado) pares.push(['destacado', '1']);
  for (const id of categorias) pares.push(['categorias', String(id)]);
  for (let n = 0; n < 3; n++) pares.push([`atributo${n + 1}`, atributos[n] ?? '']);
  for (const v of variantes) {
    pares.push(['varianteId', String(v.id ?? '')]);
    for (let n = 0; n < 3; n++) pares.push([`valor${n + 1}`, v.valores?.[n] ?? '']);
    pares.push(['sku', v.sku], ['precio', v.precio ?? ''], ['precioPromocional', v.oferta ?? ''], ['stock', v.stock ?? '0']);
  }
  return Object.fromEntries(Map.groupBy(pares, ([k]) => k).entries().map(([k, lista]) => [k, lista.length === 1 ? lista[0][1] : lista.map(([, v]) => v)]));
}
const comoPares = (campos) => Object.entries(campos).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]));

const REMERA = {
  nombre: 'Remera Básica',
  atributos: ['Talle'],
  variantes: [
    { sku: 'REM-S', valores: ['S'], precio: '12.500', stock: '4' },
    { sku: 'REM-M', valores: ['M'], precio: '12500', oferta: '9.900,50', stock: '0' },
  ],
};

// ---------- Validación y guardado ----------

test('validarProducto acepta un producto con variantes y convierte precios y stock', async () => {
  const db = (await abrirBase(':memory:'));
  const tiendaId = (await crearTiendaVacia(db, 'a'));
  const { datos, errores } = (await validarProducto(db, tiendaId, null, formularioProducto(REMERA)));
  assert.deepEqual(errores, {});
  assert.equal(datos.slug, 'remera-basica');
  assert.deepEqual(
    datos.variantes.map((v) => [v.sku, v.valores, v.precio, v.precioPromocional, v.stock]),
    [['REM-S', ['S'], 1250000, null, 4], ['REM-M', ['M'], 1250000, 990050, 0]],
  );
});

test('validarProducto marca cada problema en su fila', async () => {
  const db = (await abrirBase(':memory:'));
  const tiendaId = (await crearTiendaVacia(db, 'a'));
  const { errores } = (await validarProducto(db, tiendaId, null, formularioProducto({
    nombre: 'Buzo',
    atributos: ['Talle'],
    variantes: [
      { sku: 'B-1', valores: ['M'], precio: '100' },
      { sku: 'b-1', valores: ['m'], precio: '100', oferta: '200' },
      { sku: 'B-3', valores: [''], precio: 'gratis' },
      { sku: '', valores: [''], precio: '', stock: '0' }, // vacía: se ignora
    ],
  })));
  assert.deepEqual(errores.filas[0], undefined);
  assert.match(errores.filas[1].join(' | '), /SKU "b-1" está repetido/);
  assert.match(errores.filas[1].join(' | '), /oferta tiene que ser menor/);
  assert.match(errores.filas[1].join(' | '), /M está repetida/i);
  assert.match(errores.filas[2].join(' | '), /Precio inválido/);
  assert.match(errores.filas[2].join(' | '), /Falta talle/);
  assert.equal(errores.filas[3], undefined);
});

test('validarProducto pide atributos para tener varias variantes y no deja repetir nombres ni SKU de otro producto', async () => {
  const db = (await abrirBase(':memory:'));
  const tiendaId = (await crearTiendaVacia(db, 'a'));
  (await guardarProducto(db, tiendaId, null, (await validarProducto(db, tiendaId, null, formularioProducto(REMERA))).datos));

  const { errores } = (await validarProducto(db, tiendaId, null, formularioProducto({
    nombre: 'remera  BÁSICA',
    variantes: [{ sku: 'REM-S', precio: '1' }, { sku: 'OTRO', precio: '1' }],
  })));
  assert.match(errores.nombre, /otro producto con este nombre/);
  assert.match(errores.variantes, /qué cambia entre ellas/);
  assert.match(errores.filas[0][0], /ya lo usa otro producto/);
});

test('guardarProducto actualiza, borra variantes quitadas y permite intercambiar SKU', async () => {
  const db = (await abrirBase(':memory:'));
  const tiendaId = (await crearTiendaVacia(db, 'a'));
  const id = (await guardarProducto(db, tiendaId, null, (await validarProducto(db, tiendaId, null, formularioProducto(REMERA))).datos));
  const [s, m] = (await leerProducto(db, tiendaId, id)).variantes;

  const edicion = formularioProducto({
    ...REMERA,
    variantes: [
      { id: s.id, sku: 'REM-M', valores: ['S'], precio: '13000', stock: '2' },
      { id: m.id, sku: 'REM-S', valores: ['M'], precio: '13000', stock: '1' },
      { sku: 'REM-L', valores: ['L'], precio: '13000', stock: '5' },
    ],
  });
  const { datos, errores } = (await validarProducto(db, tiendaId, id, edicion));
  assert.deepEqual(errores, {});
  (await guardarProducto(db, tiendaId, id, datos));
  assert.deepEqual((await leerProducto(db, tiendaId, id)).variantes.map((v) => [v.sku, v.valores[0], v.precio, v.stock]), [
    ['REM-M', 'S', 1300000, 2], ['REM-S', 'M', 1300000, 1], ['REM-L', 'L', 1300000, 5],
  ]);

  const quitando = formularioProducto({ ...REMERA, variantes: [{ id: s.id, sku: 'REM-M', valores: ['S'], precio: '13000' }] });
  (await guardarProducto(db, tiendaId, id, (await validarProducto(db, tiendaId, id, quitando)).datos));
  assert.equal((await leerProducto(db, tiendaId, id)).variantes.length, 1);
});

test('precioParaEditar devuelve un texto que se puede volver a cargar', async () => {
  assert.equal(precioParaEditar(1250000), '12.500');
  assert.equal(precioParaEditar(1250050), '12.500,50');
  assert.equal(precioParaEditar(null), '');
});

// ---------- Productos desde el panel ----------

test('crear un producto desde el panel lo muestra en la tienda', async () => {
  const { nav } = await tiendaConPanel('creando');
  const respuesta = await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)));
  assert.equal(respuesta.status, 302);
  const ubicacion = respuesta.headers.get('location');
  assert.match(ubicacion, /^\/admin\/productos\/\d+$/);
  assert.match(await (await nav.pedir(ubicacion)).text(), /Creamos el producto/);

  const ficha = await vidriera('creando', '/producto/remera-basica');
  assert.equal(ficha.status, 200);
  assert.match(ficha.cuerpo, /\$\s12\.500,00/);
  // La ficha arranca en la S (la primera con stock); la oferta de la M está en los datos del selector.
  assert.match(ficha.cuerpo, /data-sku>REM-S</);
  assert.match(ficha.cuerpo, /"sku":"REM-M","precio":"\$\s9\.900,50","precioLista":"\$\s12\.500,00","off":21/);
});

test('con errores, el editor vuelve con lo escrito y no guarda nada', async () => {
  const { nav } = await tiendaConPanel('conerror');
  const campos = formularioProducto({ nombre: 'Taza', variantes: [{ sku: 'T-1', precio: 'mucho' }] });
  const respuesta = await nav.enviar('/admin/productos/nuevo', comoPares(campos), { desde: '/admin/productos/nuevo' });
  assert.equal(respuesta.status, 400);
  const html = await respuesta.text();
  assert.match(html, /Hay datos para revisar/);
  assert.match(html, /Precio inválido/);
  assert.match(html, /value="mucho"/);
  assert.equal((await vidriera('conerror', '/producto/taza')).status, 404);
});

test('editar: cambiar precio y quitar una variante', async () => {
  const { nav, tiendaId } = await tiendaConPanel('editando');
  const ubicacion = (await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' })).headers.get('location');
  const id = Number(ubicacion.split('/').at(-1));
  const [s] = (await leerProducto(db, tiendaId, id)).variantes;

  const edicion = formularioProducto({ ...REMERA, variantes: [{ id: s.id, sku: 'REM-S', valores: ['S'], precio: '15000', stock: '3' }] });
  assert.equal((await nav.enviar(ubicacion, comoPares(edicion))).status, 302);
  const guardado = (await leerProducto(db, tiendaId, id));
  assert.deepEqual(guardado.variantes.map((v) => [v.sku, v.precio]), [['REM-S', 1500000]]);

  const html = await (await nav.pedir(ubicacion)).text();
  assert.match(html, /name="precio" value="15\.000"/);
});

test('ocultar y destacar desde el listado', async () => {
  const { nav } = await tiendaConPanel('marcas');
  const ubicacion = (await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' })).headers.get('location');

  await nav.enviar(`${ubicacion}/destacado`, { valor: '1' }, { desde: '/admin/productos' });
  let portada = (await vidriera('marcas')).cuerpo;
  assert.match(portada, /id="titulo-destacados"/);

  const oculto = await nav.enviar(`${ubicacion}/visible`, { valor: '0', volver: '/admin/productos?filtro=ocultos' }, { desde: '/admin/productos' });
  assert.equal(oculto.headers.get('location'), '/admin/productos?filtro=ocultos');
  portada = (await vidriera('marcas')).cuerpo;
  assert.doesNotMatch(portada, /Remera Básica/);
  assert.match(await (await nav.pedir('/admin/productos?filtro=ocultos')).text(), /Remera Básica/);

  const afuera = await nav.enviar(`${ubicacion}/visible`, { valor: '1', volver: 'https://otro-sitio.com' }, { desde: '/admin/productos' });
  assert.equal(afuera.headers.get('location'), '/admin/productos', 'no redirige a otros sitios');
});

test('buscar y filtrar en el listado', async () => {
  const { nav } = await tiendaConPanel('buscando');
  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' });
  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto({ nombre: 'Gorra 50%_off', variantes: [{ sku: 'GOR', precio: '1', stock: '0' }] })), { desde: '/admin/productos/nuevo' });

  const porSku = await (await nav.pedir('/admin/productos?q=rem-m')).text();
  assert.match(porSku, /Remera Básica/);
  assert.doesNotMatch(porSku, /Gorra/);
  const literal = await (await nav.pedir(`/admin/productos?q=${encodeURIComponent('%_')}`)).text();
  assert.match(literal, /Gorra 50%_off/);
  assert.doesNotMatch(literal, /Remera Básica/, 'los comodines de LIKE se buscan literales');
  const sinStock = await (await nav.pedir('/admin/productos?filtro=sin-stock')).text();
  assert.match(sinStock, /Gorra/);
  assert.doesNotMatch(sinStock, /Remera Básica/);
});

test('fotos: subir varias, elegir la principal, verlas en la tienda y borrarlas con el producto', async () => {
  const { nav, tiendaId } = await tiendaConPanel('confotos');
  const ubicacion = (await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' })).headers.get('location');

  const subida = await nav.enviarArchivos(`${ubicacion}/fotos`, { fotos: [{ contenido: PNG, nombre: 'a.png' }, { contenido: PNG, nombre: 'b.png' }] }, { desde: ubicacion });
  assert.equal(subida.status, 302);
  const carpeta = path.join(dirSubidas, String(tiendaId));
  const archivos = readdirSync(carpeta);
  assert.equal(archivos.length, 2);

  const editor = await (await nav.pedir(ubicacion)).text();
  assert.match(editor, /Agregamos 2 fotos/);
  const [primera, segunda] = [...editor.matchAll(/\/fotos\/(\d+)\/borrar/g)].map((m) => m[1]);
  await nav.enviar(`${ubicacion}/fotos/${segunda}/principal`, {}, { desde: ubicacion });

  const ficha = (await vidriera('confotos', '/producto/remera-basica')).cuerpo;
  const enFicha = [...ficha.matchAll(/class="galeria-foto" src="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(enFicha.length, 2);
  const portada = (await vidriera('confotos')).cuerpo;
  assert.ok(portada.includes(`src="${enFicha[0]}"`), 'la tarjeta usa la foto principal');
  assert.ok(enFicha[0] !== enFicha[1]);
  assert.match(portada, /class="foto-alternativa"/);

  await nav.enviar(`${ubicacion}/fotos/${primera}/borrar`, {}, { desde: ubicacion });
  assert.equal(readdirSync(carpeta).length, 1);
  await nav.enviar(`${ubicacion}/borrar`, {}, { desde: ubicacion });
  assert.equal(readdirSync(carpeta).length, 0, 'borrar el producto borra sus fotos');
  assert.equal((await vidriera('confotos', '/producto/remera-basica')).status, 404);
});

test('una foto que no es imagen no se guarda, ni las demás del mismo envío', async () => {
  const { nav, tiendaId } = await tiendaConPanel('fotomala');
  const ubicacion = (await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' })).headers.get('location');
  await nav.enviarArchivos(`${ubicacion}/fotos`, {
    fotos: [{ contenido: PNG, nombre: 'bien.png' }, { contenido: Buffer.from('<svg/>'), nombre: 'mal.svg' }],
  }, { desde: ubicacion });
  assert.match(await (await nav.pedir(ubicacion)).text(), /No subimos nada/);
  assert.equal(existsSync(path.join(dirSubidas, String(tiendaId))) ? readdirSync(path.join(dirSubidas, String(tiendaId))).length : 0, 0);
});

test('una tienda no puede ver, editar ni borrar productos de otra', async () => {
  const duenia = await tiendaConPanel('duenia2');
  const ubicacion = (await duenia.nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' })).headers.get('location');

  const intrusa = await tiendaConPanel('intrusa2');
  assert.equal((await intrusa.nav.pedir(ubicacion)).status, 404);
  assert.equal((await intrusa.nav.enviar(`${ubicacion}/borrar`, {}, { desde: '/admin/productos' })).status, 404);
  assert.equal((await intrusa.nav.enviar(`${ubicacion}/visible`, { valor: '0' }, { desde: '/admin/productos' })).status, 404);
  assert.equal((await vidriera('duenia2', '/producto/remera-basica')).status, 200);
});

// ---------- Categorías ----------

test('categorías: crear, anidar, renombrar y borrar con subcategorías sin borrar productos', async () => {
  const { nav, tiendaId } = await tiendaConPanel('concategorias');
  assert.equal((await nav.enviar('/admin/categorias', { nombre: 'Ropa', padreId: '' })).status, 302);
  const ropa = (await db.prepare('SELECT id FROM categorias WHERE tienda_id = ? AND slug = ?').get(tiendaId, 'ropa')).id;
  await nav.enviar('/admin/categorias', { nombre: 'Remeras', padreId: String(ropa) });
  const remeras = (await db.prepare('SELECT id FROM categorias WHERE tienda_id = ? AND slug = ?').get(tiendaId, 'remeras')).id;

  const repetida = await nav.enviar('/admin/categorias', { nombre: 'remeras', padreId: String(ropa) });
  assert.equal(repetida.status, 400);
  assert.match(await repetida.text(), /Ya hay una categoría/);

  const ciclo = await nav.enviar(`/admin/categorias/${ropa}`, { nombre: 'Ropa', padreId: String(remeras) }, { desde: '/admin/categorias' });
  assert.equal(ciclo.status, 400);
  assert.match(await ciclo.text(), /no puede ir adentro de sí misma/);

  await nav.enviar(`/admin/categorias/${remeras}`, { nombre: 'Remeras y musculosas', padreId: String(ropa) }, { desde: '/admin/categorias' });
  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto({ ...REMERA, categorias: [remeras] })), { desde: '/admin/productos/nuevo' });
  assert.match((await vidriera('concategorias', '/categoria/ropa/remeras-y-musculosas')).cuerpo, /Remera Básica/);

  await nav.enviar(`/admin/categorias/${ropa}/borrar`, {}, { desde: '/admin/categorias' });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM categorias WHERE tienda_id = ?').get(tiendaId)).n, 0);
  assert.equal((await vidriera('concategorias', '/producto/remera-basica')).status, 200, 'el producto sigue');
});

test('no se puede usar una categoría de otra tienda como padre ni asignarla a un producto', async () => {
  const { nav, tiendaId } = await tiendaConPanel('catpropia');
  const ajena = (await crearCategoria(db, (await crearTiendaVacia(db, 'ajena')), { nombre: 'Ajena', slug: 'ajena', padreId: null }));
  const respuesta = await nav.enviar('/admin/categorias', { nombre: 'Mía', padreId: String(ajena) });
  assert.equal(respuesta.status, 400);

  const ubicacion = (await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto({ ...REMERA, categorias: [ajena] })), { desde: '/admin/productos/nuevo' })).headers.get('location');
  assert.deepEqual((await leerProducto(db, tiendaId, Number(ubicacion.split('/').at(-1)))).categoriaIds, []);
});

// ---------- Cuenta ----------

test('cuenta: cambiar el nombre de la tienda y la clave', async () => {
  const { nav, clave } = await tiendaConPanel('cuenta');
  await nav.enviar('/admin/cuenta/tienda', { nombre: 'Mi Tienda Nueva' }, { desde: '/admin/cuenta' });
  assert.match((await vidriera('cuenta')).cuerpo, /<title>Mi Tienda Nueva<\/title>/, 'el link sigue siendo el mismo');

  const mal = await nav.enviar('/admin/cuenta/clave', { claveActual: 'otra', claveNueva: 'una-clave-larga', claveRepetida: 'una-clave-larga' }, { desde: '/admin/cuenta' });
  assert.equal(mal.status, 400);
  assert.match(await mal.text(), /clave actual no es correcta/);
  const distinta = await nav.enviar('/admin/cuenta/clave', { claveActual: clave, claveNueva: 'una-clave-larga', claveRepetida: 'otra-clave-larga' }, { desde: '/admin/cuenta' });
  assert.match(await distinta.text(), /no coinciden/);
  const corta = await nav.enviar('/admin/cuenta/clave', { claveActual: clave, claveNueva: 'corta', claveRepetida: 'corta' }, { desde: '/admin/cuenta' });
  assert.match(await corta.text(), /al menos 10 caracteres/);

  assert.equal((await nav.enviar('/admin/cuenta/clave', { claveActual: clave, claveNueva: 'una-clave-larga', claveRepetida: 'una-clave-larga' }, { desde: '/admin/cuenta' })).status, 302);
  assert.ok(await autenticar(db, 'cuenta@ejemplo.com', 'una-clave-larga'));
  assert.equal(await autenticar(db, 'cuenta@ejemplo.com', clave), null);
});

// ---------- Inicio ----------

test('inicio: muestra los pasos que faltan y las alertas de stock', async () => {
  const { nav } = await tiendaConPanel('inicio');
  let html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /0 de 8 pasos listos/);
  assert.match(html, /Todo en orden/);

  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto(REMERA)), { desde: '/admin/productos/nuevo' });
  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto({ nombre: 'Gorra', variantes: [{ sku: 'G', precio: '1', stock: '0' }] })), { desde: '/admin/productos/nuevo' });
  await nav.enviar('/admin/productos/nuevo', comoPares(formularioProducto({ nombre: 'Taza', variantes: [{ sku: 'T', precio: '1', stock: '2' }] })), { desde: '/admin/productos/nuevo' });
  html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /1 de 8 pasos listos/);
  assert.match(html, /3 productos visibles sin foto/);
  const [, sinStock, pocas] = html.split(/<h3 class="alertas-titulo[^>]*>/);
  assert.match(sinStock, /Gorra/);
  assert.doesNotMatch(sinStock, /Remera Básica/, 'la Remera tiene stock en la S');
  assert.match(pocas, /Taza/);
});

test('después de ingresar se llega al inicio', async () => {
  const { clave } = await crearTienda(db, { nombre: 'Llegada', email: 'llegada@ejemplo.com' });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  const respuesta = await nav.enviar('/admin/ingresar', { email: 'llegada@ejemplo.com', clave });
  assert.equal(respuesta.headers.get('location'), '/admin/inicio');
});
