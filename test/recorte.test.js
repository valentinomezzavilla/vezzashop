import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { PROPORCION_BANNER, convertirAWebp, leerRecorte } from '../src/imagenes.js';
import { crearNavegador } from './ayudantes.js';

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

const ROJO = [255, 0, 0];
const VERDE = [0, 255, 0];
const AZUL = [0, 0, 255];

// Imagen de `ancho` x `alto` dividida en franjas verticales de los colores dados.
async function franjas(ancho, alto, colores, { formato = 'png', orientacion } = {}) {
  const crudo = Buffer.alloc(ancho * alto * 3);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) crudo.set(colores[Math.min(colores.length - 1, Math.floor((x / ancho) * colores.length))], (y * ancho + x) * 3);
  }
  const base = sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } });
  return formato === 'jpeg' ? base.jpeg({ quality: 95 }).withMetadata({ orientation: orientacion }).toBuffer() : base.png().toBuffer();
}

// Medidas y color del píxel del medio de un archivo guardado.
async function leer(origen) {
  const { data, info } = await sharp(origen).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { ancho: info.width, alto: info.height, color: [data[i], data[i + 1], data[i + 2]] };
}

// El color dominante: el canal que más pesa (el WebP con pérdida no devuelve el valor exacto).
const dominante = ({ color }) => ['rojo', 'verde', 'azul'][color.indexOf(Math.max(...color))];

test('leerRecorte: acepta "x,y,ancho,alto" entre 0 y 1 y descarta lo que no sea válido', () => {
  assert.deepEqual(leerRecorte('0.25,0,0.5,1'), { x: 0.25, y: 0, ancho: 0.5, alto: 1 });
  assert.deepEqual(leerRecorte(' 0,0.16611,1,0.66778 '), { x: 0, y: 0.16611, ancho: 1, alto: 0.66778 });
  // Un redondeo que se pasa apenas del borde se ajusta en vez de descartarse.
  assert.deepEqual(leerRecorte('0.5,0,0.5004,1'), { x: 0.5, y: 0, ancho: 0.5, alto: 1 });
  for (const malo of [undefined, null, '', 'basura', 'a,b,c,d', '0,0,0,1', '0,0,1,0', '0.6,0,0.5,1', '0,0.7,1,0.5', '0,0,1.2,1', '-0.1,0,1,1', '0,0,1,1,1', '0,0,1', '1e0,0,1,1', '0,0,NaN,1', ['0,0,1,1']]) {
    assert.equal(leerRecorte(malo), null, `descarta ${JSON.stringify(malo)}`);
  }
});

test('el recorte se aplica antes de achicar y deja solo la parte elegida', async () => {
  const original = await franjas(400, 200, [ROJO, AZUL]);
  const derecha = await leer(await convertirAWebp(original, { ancho: 1200, recorte: leerRecorte('0.5,0,0.5,1') }));
  assert.deepEqual([derecha.ancho, derecha.alto], [200, 200], 'sale solo la mitad derecha, sin agrandarla');
  assert.equal(dominante(derecha), 'azul');

  const izquierda = await leer(await convertirAWebp(original, { ancho: 1200, recorte: leerRecorte('0,0,0.5,1') }));
  assert.equal(dominante(izquierda), 'rojo');

  // Sin recorte, la imagen queda entera como siempre.
  assert.deepEqual(Object.values(await leer(await convertirAWebp(original, { ancho: 1200 }))).slice(0, 2), [400, 200]);
  // Y el ancho máximo del perfil sigue valiendo después de recortar.
  assert.equal((await leer(await convertirAWebp(await franjas(2000, 1000, [ROJO, AZUL]), { ancho: 800, recorte: leerRecorte('0,0,0.5,1') }))).ancho, 800);
});

test('con una foto de cámara girada (EXIF), el recorte es sobre lo que se ve en pantalla', async () => {
  // Guardada de 300 x 100 con la orientación 6: en pantalla se ve de 100 x 300 y lo que estaba a la izquierda queda arriba.
  const foto = await franjas(300, 100, [ROJO, VERDE, AZUL], { formato: 'jpeg', orientacion: 6 });
  const arriba = await leer(await convertirAWebp(foto, { ancho: 1200, recorte: leerRecorte('0,0,1,0.3333') }));
  assert.deepEqual([arriba.ancho, arriba.alto], [100, 100]);
  assert.equal(dominante(arriba), 'rojo');
  const medio = await leer(await convertirAWebp(foto, { ancho: 1200, recorte: leerRecorte('0,0.3333,1,0.3333') }));
  assert.equal(dominante(medio), 'verde');
  const abajo = await leer(await convertirAWebp(foto, { ancho: 1200, recorte: leerRecorte('0,0.6667,1,0.3333') }));
  assert.equal(dominante(abajo), 'azul');
});

// Un panel con sesión iniciada y los banners que tiene guardados.
async function tiendaConPanel(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  const agregar = (campos) => nav.enviarArchivos('/admin/diseno/banners', campos, { desde: '/admin/diseno' });
  const guardados = () => db.prepare('SELECT imagen, imagen_movil AS "imagenMovil" FROM banners WHERE tienda_id = ? ORDER BY id').all(tienda.id);
  const archivo = (nombre) => path.join(dirSubidas, String(tienda.id), nombre);
  return { nav, agregar, guardados, archivo };
}

test('un banner con recortes se guarda recortado, y el celular sale de la misma imagen si no se sube otra', async () => {
  const { agregar, guardados, archivo } = await tiendaConPanel('recortes');
  const original = await franjas(1200, 800, [ROJO, AZUL]);
  const respuesta = await agregar({
    imagen: { contenido: original, nombre: 'b.png' },
    recorteComputadora: '0.5,0,0.5,0.5', // la mitad derecha, de la parte de arriba
    recorteCelular: '0,0,0.5,1', // la mitad izquierda, entera
  });
  assert.equal(respuesta.status, 302);
  const [banner] = await guardados();
  const computadora = await leer(archivo(banner.imagen));
  assert.deepEqual([computadora.ancho, computadora.alto], [600, 400]);
  assert.equal(dominante(computadora), 'azul');
  const celular = await leer(archivo(banner.imagenMovil));
  assert.deepEqual([celular.ancho, celular.alto], [600, 800]);
  assert.equal(dominante(celular), 'rojo');
});

test('si se sube una imagen aparte para el celular, el recorte del celular es sobre esa imagen', async () => {
  const { agregar, guardados, archivo } = await tiendaConPanel('recortes-aparte');
  await agregar({
    imagen: { contenido: await franjas(1200, 800, [ROJO]), nombre: 'b.png' },
    imagenMovil: { contenido: await franjas(400, 400, [VERDE, AZUL]), nombre: 'c.png' },
    recorteComputadora: '0,0,1,0.5',
    recorteCelular: '0.5,0.5,0.5,0.5',
  });
  const [banner] = await guardados();
  assert.deepEqual(Object.values(await leer(archivo(banner.imagen))).slice(0, 2), [1200, 400]);
  const celular = await leer(archivo(banner.imagenMovil));
  assert.deepEqual([celular.ancho, celular.alto], [200, 200]);
  assert.equal(dominante(celular), 'azul', 'es el cuarto de abajo a la derecha de la imagen del celular');
});

test('sin recortes (o con uno inválido) la imagen se guarda entera, como antes', async () => {
  const { agregar, guardados, archivo } = await tiendaConPanel('sin-recortes');
  const original = await franjas(900, 300, [ROJO, AZUL]);
  assert.equal((await agregar({ imagen: { contenido: original, nombre: 'b.png' } })).status, 302);
  assert.equal((await agregar({ imagen: { contenido: original, nombre: 'b.png' }, recorteComputadora: 'cualquier cosa', recorteCelular: '2,2,2,2' })).status, 302);
  const [sinRecorte, invalido] = await guardados();
  assert.equal(sinRecorte.imagenMovil, null, 'sin recorte para el celular no se inventa una versión');
  assert.equal(invalido.imagenMovil, null, 'un recorte inválido se ignora');
  for (const banner of [sinRecorte, invalido]) assert.deepEqual(Object.values(await leer(archivo(banner.imagen))).slice(0, 2), [900, 300]);
});

test('el formulario trae el recortador, con las proporciones de la tienda y los campos del recorte', async () => {
  const { nav } = await tiendaConPanel('recortador');
  const html = await (await nav.pedir('/admin/diseno')).text();
  const { computadora, celular } = PROPORCION_BANNER;
  assert.match(html, /<div class="recortador" data-recortador hidden>/);
  assert.match(html, new RegExp(`data-recorte="computadora" data-proporcion="${computadora.ancho}:${computadora.alto}" data-ideal="${computadora.pixelesIdeales[0]}"`));
  assert.match(html, new RegExp(`data-recorte="celular" data-proporcion="${celular.ancho}:${celular.alto}" data-ideal="${celular.pixelesIdeales[0]}"`));
  assert.match(html, /name="recorteComputadora" data-valor/);
  assert.match(html, /name="recorteCelular" data-valor/);
  assert.match(html, /Idealmente de 1200 × 400 px/);
  // Sin JavaScript el formulario sigue siendo el de siempre: la imagen es obligatoria y la del celular, opcional.
  assert.match(html, /name="imagen" accept="[^"]+" required/);
  assert.doesNotMatch(html, /name="imagenMovil"[^>]*required/);
});
