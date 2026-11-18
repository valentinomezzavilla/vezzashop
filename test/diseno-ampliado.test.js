import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { validarAjustes, leerAjustes, estiloDeTienda, FUENTES, ESQUINAS, TARJETAS } from '../src/diseno.js';
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

// Lo que el formulario viejo ya mandaba: sirve para probar que lo nuevo es opcional.
const BASE = { colorPrincipal: '#0a3d62', franjaTexto: '', ordenCatalogo: 'nombre', whatsapp: '', instagram: '', facebook: '', tiktok: '', emailContacto: '', direccion: '' };
const NUEVOS = ['colorFranja', 'franjaEnlace', 'fuente', 'esquinas', 'tarjetas', 'tituloDestacados', 'tituloCatalogo', 'descripcion', 'horarios', 'direccionMapa', 'notaPie'];

test('validarAjustes: los campos nuevos son opcionales y, si no vienen, el ajuste queda como estaba', () => {
  const { ajustes, errores } = validarAjustes(BASE);
  assert.deepEqual(errores, {});
  for (const campo of NUEVOS) assert.equal(campo in ajustes, false, `${campo} no se toca si no viene`);
});

test('validarAjustes: tipografía, esquinas y tarjetas aceptan solo las opciones de la lista', () => {
  const bien = validarAjustes({ ...BASE, fuente: 'elegante', esquinas: 'rectas', tarjetas: 'chicas' });
  assert.deepEqual(bien.errores, {});
  assert.deepEqual([bien.ajustes.fuente, bien.ajustes.esquinas, bien.ajustes.tarjetas], ['elegante', 'rectas', 'chicas']);
  const mal = validarAjustes({ ...BASE, fuente: 'Comic Sans', esquinas: 'constructor', tarjetas: '__proto__' });
  assert.deepEqual(Object.keys(mal.errores).sort(), ['esquinas', 'fuente', 'tarjetas']);
  // Cada opción de la lista es una opción válida (y las tres listas tienen su valor de siempre).
  for (const [campo, opciones, base] of [['fuente', FUENTES, 'sistema'], ['esquinas', ESQUINAS, 'redondeadas'], ['tarjetas', TARJETAS, 'normales']]) {
    assert.ok(base in opciones);
    for (const clave of Object.keys(opciones)) assert.equal(validarAjustes({ ...BASE, [campo]: clave }).ajustes[campo], clave);
  }
});

test('validarAjustes: títulos y textos del pie', () => {
  const { ajustes, errores } = validarAjustes({
    ...BASE,
    tituloDestacados: '  Lo más   vendido ',
    tituloCatalogo: '',
    descripcion: '  Una tienda\nfamiliar   de Córdoba ',
    horarios: 'Lunes a viernes de 9 a 18',
    notaPie: 'Precios con IVA incluido',
  });
  assert.deepEqual(errores, {});
  assert.equal(ajustes.tituloDestacados, 'Lo más vendido', 'se juntan los espacios');
  assert.equal(ajustes.tituloCatalogo, 'Todos los productos', 'vacío vuelve al título de siempre');
  assert.equal(ajustes.descripcion, 'Una tienda familiar de Córdoba');

  const largos = validarAjustes({ ...BASE, tituloDestacados: 'x'.repeat(61), tituloCatalogo: 'x'.repeat(61), descripcion: 'x'.repeat(301), horarios: 'x'.repeat(151), notaPie: 'x'.repeat(301) }).errores;
  assert.deepEqual(Object.keys(largos).sort(), ['descripcion', 'horarios', 'notaPie', 'tituloCatalogo', 'tituloDestacados']);
  // Vaciar los opcionales los borra.
  const vacios = validarAjustes({ ...BASE, descripcion: '', horarios: '', notaPie: '' }).ajustes;
  assert.deepEqual([vacios.descripcion, vacios.horarios, vacios.notaPie], ['', '', '']);
});

test('validarAjustes: los links de la franja y del mapa son páginas de la tienda o https, y nada más', () => {
  const bien = validarAjustes({ ...BASE, franjaEnlace: '/categoria/ofertas', direccionMapa: 'https://maps.app.goo.gl/abc' });
  assert.deepEqual(bien.errores, {});
  assert.equal(bien.ajustes.franjaEnlace, '/categoria/ofertas');
  assert.equal(validarAjustes({ ...BASE, franjaEnlace: '' }).ajustes.franjaEnlace, '');
  const mal = validarAjustes({ ...BASE, franjaEnlace: 'javascript:alert(1)', direccionMapa: '//otro-sitio.com' }).errores;
  assert.deepEqual(Object.keys(mal).sort(), ['direccionMapa', 'franjaEnlace']);
  assert.match(mal.franjaEnlace, /^Link de la franja: /);
});

test('validarAjustes: la franja solo tiene color propio si se marcó la casilla', () => {
  assert.equal(validarAjustes({ ...BASE, franjaColorPropio: '1', colorFranja: '#F5C518' }).ajustes.colorFranja, '#f5c518');
  assert.equal(validarAjustes({ ...BASE, colorFranja: '#f5c518' }).ajustes.colorFranja, '', 'sin la casilla, usa el color principal');
  assert.equal(validarAjustes({ ...BASE, franjaColorPropio: '1' }).errores.colorFranja, 'Elegí un color');
  assert.equal(validarAjustes({ ...BASE, franjaColorPropio: '1', colorFranja: 'amarillo' }).errores.colorFranja, 'Elegí un color');
  assert.equal(validarAjustes({ ...BASE, franjaColorPropio: '1', colorFranja: 'red;}</style>' }).errores.colorFranja, 'Elegí un color');
});

test('estiloDeTienda: con los valores de siempre no agrega nada, y con los elegidos arma las variables', () => {
  const defecto = { fuente: 'sistema', esquinas: 'redondeadas', tarjetas: 'normales', colorFranja: '' };
  assert.deepEqual(estiloDeTienda(defecto), { variables: '', hojaDeFuente: null });

  const elegidos = estiloDeTienda({ fuente: 'elegante', esquinas: 'rectas', tarjetas: 'grandes', colorFranja: '#f5c518' });
  assert.match(elegidos.variables, /--fuente-titulos: "Playfair Display", Georgia/);
  assert.ok(!elegidos.variables.includes('--fuente-texto'), 'Elegante deja el texto del sistema');
  assert.match(elegidos.variables, /--radio-boton: 0px/);
  assert.match(elegidos.variables, /--columnas-media: 2; --columnas: 3/);
  assert.match(elegidos.variables, /--franja: #f5c518; --franja-texto: #111111/);
  assert.equal(elegidos.hojaDeFuente, 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap');

  // Lo que no está en las listas, o no es un color, se ignora: nada de lo guardado llega al <style> sin pasar por acá.
  assert.deepEqual(estiloDeTienda({ fuente: 'x', esquinas: 'y', tarjetas: 'z', colorFranja: 'red;}</style><script>' }), { variables: '', hojaDeFuente: null });
});

test('los valores por defecto de la base coinciden con los del código', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'Defectos', email: 'defectos@ejemplo.com' });
  const sinFila = await leerAjustes(db, tienda.id);
  await db.prepare('INSERT INTO ajustes_tienda (tienda_id) VALUES (?)').run(tienda.id);
  assert.deepEqual(await leerAjustes(db, tienda.id), sinFila, 'una fila nueva dice lo mismo que no tener fila');
  assert.deepEqual([sinFila.fuente, sinFila.esquinas, sinFila.tarjetas, sinFila.tituloDestacados, sinFila.tituloCatalogo], ['sistema', 'redondeadas', 'normales', 'Destacados', 'Todos los productos']);
});

async function tiendaConPanel(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  const guardar = (campos) => nav.enviar('/admin/diseno', { ...BASE, ...campos });
  const vidriera = async (ruta = '/') => (await pedirConHost(puerto, `${slug}.localhost`, ruta)).cuerpo;
  return { nav, tienda, guardar, vidriera };
}

test('una tienda sin tocar nada se ve como siempre: sin tipografía extra ni variables nuevas', async () => {
  const { vidriera } = await tiendaConPanel('comosiempre');
  const html = await vidriera();
  assert.ok(!html.includes('family=Playfair') && !html.includes('family=Poppins'));
  assert.doesNotMatch(html, /--radio|--columnas|--franja|--fuente/);
  assert.match(html, /<h1>Todos los productos<\/h1>/);
  assert.match(html, /Comprá online en comosiempre\./);
  assert.doesNotMatch(html, /pie-descripcion|pie-nota|pie-horarios|Cómo llegar/);
});

test('lo que se elige en Diseño se guarda y se ve en la vidriera', async () => {
  const { nav, guardar, vidriera } = await tiendaConPanel('personalizada');
  const respuesta = await guardar({
    franjaTexto: 'Envío gratis',
    franjaEnlace: '/categoria/ofertas',
    franjaColorPropio: '1',
    colorFranja: '#f5c518',
    fuente: 'moderna',
    esquinas: 'suaves',
    tarjetas: 'chicas',
    tituloDestacados: 'Lo más vendido',
    tituloCatalogo: 'Toda la tienda',
    descripcion: 'Una tienda <b>familiar</b> de Córdoba.',
    notaPie: 'Precios con IVA incluido.',
    direccion: 'Colón 123',
    direccionMapa: 'https://maps.app.goo.gl/abc',
    horarios: 'Lunes a viernes de 9 a 18 hs',
  });
  assert.equal(respuesta.status, 302);

  const html = await vidriera();
  assert.match(html, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Poppins:wght@400;500;600;700&amp;display=swap">/);
  assert.match(html, /--fuente-titulos: "Poppins"/);
  assert.match(html, /--radio-boton: 10px/);
  assert.match(html, /--columnas-media: 4; --columnas: 5/);
  assert.match(html, /--franja: #f5c518; --franja-texto: #111111/);
  assert.match(html, /<div class="franja"><p><a href="\/categoria\/ofertas">Envío gratis<\/a><\/p><\/div>/);
  assert.match(html, /<h1>Toda la tienda<\/h1>/);
  assert.match(html, /<meta name="description" content="Una tienda &lt;b&gt;familiar&lt;\/b&gt; de Córdoba\.">/, 'la descripción va a los buscadores, escapada');
  assert.match(html, /<p class="pie-descripcion">Una tienda &lt;b&gt;familiar&lt;\/b&gt; de Córdoba\.<\/p>/);
  assert.match(html, /Colón 123 · <a href="https:\/\/maps\.app\.goo\.gl\/abc" target="_blank" rel="noopener">Cómo llegar<\/a>/);
  assert.match(html, /<p class="pie-dato pie-horarios">[\s\S]*Lunes a viernes de 9 a 18 hs/);
  assert.match(html, /<p class="pie-nota">Precios con IVA incluido\.<\/p>/);

  // El panel muestra lo guardado.
  const panel = await (await nav.pedir('/admin/diseno')).text();
  assert.match(panel, /name="fuente" value="moderna" checked/);
  assert.match(panel, /name="esquinas" value="suaves" checked/);
  assert.match(panel, /name="tarjetas" value="chicas" checked/);
  assert.match(panel, /name="franjaColorPropio" value="1" data-franja-propio checked/);
  assert.match(panel, /id="colorFranja" type="color" name="colorFranja" value="#f5c518"/);
  assert.match(panel, /name="tituloDestacados" value="Lo más vendido"/);

  // Desmarcar el color propio vuelve a usar el color principal, y el resto queda igual.
  await guardar({ franjaTexto: 'Envío gratis', colorFranja: '#f5c518', fuente: 'moderna' });
  const despues = await vidriera();
  assert.doesNotMatch(despues, /--franja/);
  assert.match(despues, /--fuente-titulos: "Poppins"/);
});

test('un valor inválido no se guarda: vuelve con el error y no cambia nada', async () => {
  const { nav, guardar, vidriera } = await tiendaConPanel('conerrores');
  const respuesta = await guardar({ fuente: 'Comic Sans', franjaEnlace: 'javascript:alert(1)', tituloDestacados: 'x'.repeat(80) });
  assert.equal(respuesta.status, 400);
  const html = await respuesta.text();
  assert.match(html, /Link de la franja:/);
  assert.match(html, /Máximo 60 caracteres/);
  assert.match(html, /Elegí una de las opciones/);
  assert.doesNotMatch(await vidriera(), /Comic Sans|javascript:/);
  assert.match(await (await nav.pedir('/admin/diseno')).text(), /name="fuente" value="sistema" checked/);
});

test('el formulario de Diseño trae todos los campos nuevos', async () => {
  const { nav } = await tiendaConPanel('formulario');
  const html = await (await nav.pedir('/admin/diseno')).text();
  for (const campo of ['franjaEnlace', 'franjaColorPropio', 'colorFranja', 'fuente', 'esquinas', 'tarjetas', 'tituloDestacados', 'tituloCatalogo', 'descripcion', 'notaPie', 'direccionMapa', 'horarios']) {
    assert.match(html, new RegExp(`name="${campo}"`), `falta el campo ${campo}`);
  }
  assert.equal([...html.matchAll(/name="fuente" value="/g)].length, Object.keys(FUENTES).length);
  assert.equal([...html.matchAll(/name="esquinas" value="/g)].length, Object.keys(ESQUINAS).length);
  assert.equal([...html.matchAll(/name="tarjetas" value="/g)].length, Object.keys(TARJETAS).length);
});
