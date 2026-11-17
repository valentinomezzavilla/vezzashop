import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { migrarImagenes } from '../src/migrar-imagenes.js';
import { guardarImagen, borrarImagen, dimensionesDe, huellaDe, ErrorDeImagen, nombreMiniatura, urlMiniatura } from '../src/imagenes.js';
import { crearTiendaVacia, pedirConHost } from './ayudantes.js';

let dirSubidas;
let db;
let servidor;
let puerto;

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

// Una "foto de cámara": degradados con un poco de ruido suavizado.
async function fotoDeCamara(ancho, alto, { formato = 'jpeg', orientacion } = {}) {
  const crudo = Buffer.alloc(ancho * alto * 3);
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const i = (y * ancho + x) * 3;
      const ruido = (Math.sin(x / 40) + Math.cos(y / 30)) * 25 + ((x * 7 + y * 13) % 11);
      crudo[i] = Math.min(255, (x * 255) / ancho + ruido);
      crudo[i + 1] = Math.min(255, (y * 255) / alto + ruido);
      crudo[i + 2] = Math.min(255, ((x + y) % 256) + ruido);
    }
  }
  let imagen = sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } }).blur(0.8);
  if (orientacion) imagen = imagen.withMetadata({ orientation: orientacion });
  return formato === 'png' ? imagen.png().toBuffer() : imagen.jpeg({ quality: 90 }).toBuffer();
}

const carpeta = (tiendaId) => path.join(dirSubidas, String(tiendaId));
const medidas = async (tiendaId, archivo) => {
  const { width, height, format } = await sharp(path.join(carpeta(tiendaId), archivo)).metadata();
  return { ancho: width, alto: height, formato: format };
};
const peso = (tiendaId, archivo) => statSync(path.join(carpeta(tiendaId), archivo)).size;

// ---------- Subida ----------

test('una foto se guarda como WebP grande (hasta 1600 px) y dos miniaturas, y no se guarda el original', async () => {
  const original = await fotoDeCamara(4000, 3000);
  const archivo = await guardarImagen(dirSubidas, 10, original);

  assert.match(archivo, /^[0-9a-f-]{36}\.webp$/);
  assert.deepEqual(readdirSync(carpeta(10)).sort(), [archivo, nombreMiniatura(archivo, 'm'), nombreMiniatura(archivo, 's')].sort());
  assert.deepEqual(await medidas(10, archivo), { ancho: 1600, alto: 1200, formato: 'webp' });
  assert.deepEqual(await medidas(10, nombreMiniatura(archivo, 'm')), { ancho: 540, alto: 405, formato: 'webp' });
  assert.deepEqual(await medidas(10, nombreMiniatura(archivo, 's')), { ancho: 128, alto: 96, formato: 'webp' });
  assert.ok(peso(10, nombreMiniatura(archivo, 'm')) <= 100 * 1024, 'la miniatura pesa menos de 100 KB');
  assert.ok(peso(10, archivo) < original.length, 'la grande pesa menos que el original');
  assert.equal(urlMiniatura(10, archivo, 's'), `/subidas/10/${nombreMiniatura(archivo, 's')}`);
});

test('las fotos de cámara se enderezan según EXIF y no se agrandan las chicas', async () => {
  // 400x200 con orientación 6 (girada 90°): la foto real es vertical, de 200x400.
  const girada = await guardarImagen(dirSubidas, 11, await fotoDeCamara(400, 200, { orientacion: 6 }));
  assert.deepEqual(await medidas(11, girada), { ancho: 200, alto: 400, formato: 'webp' });
  assert.equal((await sharp(path.join(carpeta(11), girada)).metadata()).orientation, undefined, 'ya no queda la etiqueta de rotación');
  // Una foto chica no se estira hasta 1600 ni hasta 540.
  const chica = await guardarImagen(dirSubidas, 11, await fotoDeCamara(300, 300));
  assert.deepEqual(await medidas(11, chica), { ancho: 300, alto: 300, formato: 'webp' });
  assert.deepEqual(await medidas(11, nombreMiniatura(chica, 'm')), { ancho: 300, alto: 300, formato: 'webp' });
});

test('los metadatos (como la ubicación) no llegan a lo guardado', async () => {
  const conGps = await sharp(await fotoDeCamara(200, 200))
    .withExif({ IFD0: { Copyright: 'Alguien' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '31/1 25/1 0/1' } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(conGps).metadata()).exif, 'la foto de partida trae EXIF');
  const archivo = await guardarImagen(dirSubidas, 12, conGps);
  assert.equal((await sharp(path.join(carpeta(12), archivo)).metadata()).exif, undefined);
});

test('el logo queda a 2x de lo que se muestra y conserva la transparencia', async () => {
  const logo = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const archivo = await guardarImagen(dirSubidas, 13, logo, { perfil: 'logo' });
  assert.deepEqual(readdirSync(carpeta(13)), [archivo], 'el logo no lleva miniaturas');
  const { ancho, alto } = await medidas(13, archivo);
  assert.ok(ancho <= 360 && alto <= 80 && (ancho === 360 || alto === 80), `${ancho}x${alto}`);
  assert.equal((await sharp(path.join(carpeta(13), archivo)).metadata()).hasAlpha, true);
  assert.ok(peso(13, archivo) < 10 * 1024);
});

test('un banner queda en 1200 px de ancho, y el de celular en 800', async () => {
  const grande = await guardarImagen(dirSubidas, 14, await fotoDeCamara(3000, 1000), { perfil: 'banner' });
  const movil = await guardarImagen(dirSubidas, 14, await fotoDeCamara(2000, 2500), { perfil: 'bannerMovil' });
  assert.equal((await medidas(14, grande)).ancho, 1200);
  assert.equal((await medidas(14, movil)).ancho, 800);
  assert.equal(readdirSync(carpeta(14)).length, 2);
});

test('una imagen rota o que no es imagen se rechaza y no deja archivos', async () => {
  await assert.rejects(guardarImagen(dirSubidas, 15, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), ErrorDeImagen);
  const rota = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('esto no es un jpeg de verdad'.repeat(20))]);
  await assert.rejects(guardarImagen(dirSubidas, 15, rota), ErrorDeImagen);
  assert.equal(existsSync(carpeta(15)) ? readdirSync(carpeta(15)).length : 0, 0);
});

test('borrar una imagen borra sus tres versiones, y también sirve para una subida vieja', async () => {
  const archivo = await guardarImagen(dirSubidas, 16, await fotoDeCamara(800, 600));
  assert.equal(readdirSync(carpeta(16)).length, 3);
  await borrarImagen(dirSubidas, 16, archivo);
  assert.equal(readdirSync(carpeta(16)).length, 0);
  writeFileSync(path.join(carpeta(16), 'vieja.jpg'), await fotoDeCamara(100, 100));
  await borrarImagen(dirSubidas, 16, 'vieja.jpg');
  assert.equal(readdirSync(carpeta(16)).length, 0);
  await borrarImagen(dirSubidas, 16, null);
});

test('dimensionesDe lee el alto y el ancho, con la rotación de cámara aplicada, y devuelve null si falta el archivo', async () => {
  mkdirSync(carpeta(17), { recursive: true });
  writeFileSync(path.join(carpeta(17), 'girada.jpg'), await fotoDeCamara(400, 200, { orientacion: 6 }));
  assert.deepEqual(await dimensionesDe(dirSubidas, 17, 'girada.jpg'), { ancho: 200, alto: 400 });
  assert.equal(await dimensionesDe(dirSubidas, 17, 'no-existe.jpg'), null);
  assert.equal(await dimensionesDe(dirSubidas, 17, null), null);
});

// ---------- Servidor: miniaturas que faltan y compresión ----------

const pedir = (ruta, headers = {}) => fetch(`http://127.0.0.1:${puerto}${ruta}`, { redirect: 'manual', headers });

test('una miniatura que no existe redirige al original viejo, con caché corta; si existe, se sirve con caché larga', async () => {
  const uuid = '0a1b2c3d-0000-4000-8000-000000000001';
  mkdirSync(carpeta(20), { recursive: true });
  writeFileSync(path.join(carpeta(20), `${uuid}.jpg`), await fotoDeCamara(300, 300));

  const redirigida = await pedir(`/subidas/20/${uuid}-m.webp`);
  assert.equal(redirigida.status, 302);
  assert.equal(redirigida.headers.get('location'), `/subidas/20/${uuid}.jpg`);
  assert.equal(redirigida.headers.get('cache-control'), 'public, max-age=300');
  assert.doesNotMatch(redirigida.headers.get('cache-control'), /immutable/);

  const original = await pedir(`/subidas/20/${uuid}.jpg`);
  assert.equal(original.status, 200);
  assert.match(original.headers.get('cache-control'), /immutable/);

  // Con la miniatura ya hecha, se sirve ella.
  writeFileSync(path.join(carpeta(20), `${uuid}-m.webp`), await sharp(await fotoDeCamara(100, 100)).webp().toBuffer());
  const miniatura = await pedir(`/subidas/20/${uuid}-m.webp`);
  assert.equal(miniatura.status, 200);
  assert.match(miniatura.headers.get('cache-control'), /max-age=31536000.*immutable/);
  assert.equal(miniatura.headers.get('content-type'), 'image/webp');

  assert.equal((await pedir('/subidas/20/sin-original-m.webp')).status, 404);
  assert.equal((await pedir('/subidas/abc/x-m.webp')).status, 404);
});

test('el HTML, el CSS y el JS salen comprimidos (brotli o gzip) y las imágenes no se vuelven a comprimir', async () => {
  for (const ruta of ['/admin.css', '/tienda.js', '/admin/ingresar']) {
    const br = await pedir(ruta, { 'accept-encoding': 'br, gzip' });
    assert.equal(br.headers.get('content-encoding'), 'br', ruta);
    const gz = await pedir(ruta, { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers.get('content-encoding'), 'gzip', ruta);
  }
  const sinCompresion = await pedir('/admin.css', { 'accept-encoding': 'identity' });
  assert.equal(sinCompresion.headers.get('content-encoding'), null);
  const uuid = '0a1b2c3d-0000-4000-8000-000000000002';
  mkdirSync(carpeta(21), { recursive: true });
  writeFileSync(path.join(carpeta(21), `${uuid}.webp`), await sharp(await fotoDeCamara(100, 100)).webp().toBuffer());
  assert.equal((await pedir(`/subidas/21/${uuid}.webp`, { 'accept-encoding': 'br, gzip' })).headers.get('content-encoding'), null);
});

// ---------- La vidriera ----------

test('la vidriera usa miniaturas con width y height, y carga la foto alternativa recién al pasar el mouse', async () => {
  const tienda = await crearTiendaVacia(db, 'fotos-vidriera');
  const id = tienda.id ?? tienda;
  const logo = await guardarImagen(dirSubidas, id, await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#c00' } }).png().toBuffer(), { perfil: 'logo' });
  await db.prepare('INSERT INTO ajustes_tienda (tienda_id, logo) VALUES (?, ?) ON CONFLICT (tienda_id) DO UPDATE SET logo = excluded.logo').run(id, logo);

  const fotos = [];
  for (let n = 0; n < 6; n++) {
    const { rows } = await db.prepare(`INSERT INTO productos (slug, nombre, descripcion, marca, visible, destacado, tienda_id) VALUES (?, ?, '', '', 1, 0, ?) RETURNING id`).run(`p${n}`, `Producto ${n}`, id);
    await db.prepare('INSERT INTO variantes (tienda_id, producto_id, sku, precio_centavos, stock) VALUES (?, ?, ?, 1000000, 5)').run(id, rows[0].id, `P${n}`);
    const lista = [];
    for (let f = 0; f < 2; f++) {
      const archivo = await guardarImagen(dirSubidas, id, await fotoDeCamara(2400, 3000));
      await db.prepare('INSERT INTO producto_fotos (tienda_id, producto_id, archivo, orden) VALUES (?, ?, ?, ?)').run(id, rows[0].id, archivo, f);
      lista.push(archivo);
    }
    fotos.push(lista);
  }

  const portada = (await pedirConHost(puerto, 'fotos-vidriera.localhost', '/')).cuerpo;
  const imgs = [...portada.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
  const tarjetas = imgs.filter((i) => /alt="Producto \d"/.test(i));
  assert.equal(tarjetas.length, 6);
  for (const img of tarjetas) {
    assert.match(img, /src="\/subidas\/\d+\/[0-9a-f-]{36}-m\.webp"/, 'la grilla usa la miniatura de 540 px');
    assert.match(img, /width="540" height="675"/);
    assert.match(img, /decoding="async"/);
  }
  // Sin banners ni destacados arriba, las 4 primeras van sin lazy y el resto con lazy.
  assert.equal(tarjetas.filter((i) => !i.includes('loading="lazy"')).length, 4);
  // La segunda foto no tiene src: no se descarga hasta el primer hover.
  const alternativas = imgs.filter((i) => i.includes('foto-alternativa'));
  assert.equal(alternativas.length, 6);
  for (const img of alternativas) {
    assert.doesNotMatch(img, / src=/);
    assert.match(img, /data-src="\/subidas\/\d+\/[0-9a-f-]{36}-m\.webp"/);
  }
  const grandes = imgs.filter((i) => !i.includes('class="logo"') && /src="[^"]*\/[0-9a-f-]{36}\.webp"/.test(i));
  assert.deepEqual(grandes, [], 'la portada no pide ninguna foto grande');

  // El logo, con las medidas del archivo guardado (2x de lo que se muestra).
  const { ancho, alto } = await dimensionesDe(dirSubidas, id, logo);
  assert.match(portada, new RegExp(`<img class="logo"[^>]*width="${ancho}" height="${alto}"`));
  assert.ok(ancho <= 360 && alto <= 80);

  // La ficha: la primera foto sin lazy y con prioridad, srcset con mediana y grande, tira con las chicas, visor sin foto hasta abrirlo.
  const ficha = (await pedirConHost(puerto, 'fotos-vidriera.localhost', '/producto/p0')).cuerpo;
  const slides = [...ficha.matchAll(/<img class="galeria-foto"[\s\S]*?>/g)].map((m) => m[0]);
  assert.equal(slides.length, 2);
  assert.match(slides[0], /fetchpriority="high"/);
  assert.doesNotMatch(slides[0], /loading="lazy"/);
  assert.match(slides[1], /loading="lazy"/);
  assert.match(slides[0], new RegExp(`srcset="/subidas/${id}/${nombreMiniatura(fotos[0][0], 'm')} 540w, /subidas/${id}/${fotos[0][0]} 1600w"`));
  assert.match(slides[0], /width="540" height="675"/);
  assert.match(ficha, new RegExp(`<img src="/subidas/${id}/${nombreMiniatura(fotos[0][1], 's')}" alt="" width="128" height="160" loading="lazy"`));
  assert.match(ficha, /<img class="visor-foto"(?![^>]* src=)[^>]*data-visor-foto>/);
  // Los datos para Google y el visor siguen con la versión grande.
  assert.ok(ficha.includes(`"/subidas/${id}/${fotos[0][0]}"`));
});

// ---------- Migración ----------

async function tiendaConImagenesViejas() {
  const tienda = await crearTiendaVacia(db, `migrar-${Math.random().toString(36).slice(2, 8)}`);
  const id = tienda.id ?? tienda;
  const dir = carpeta(id);
  mkdirSync(dir, { recursive: true });
  const jpg = await fotoDeCamara(3000, 2000);
  const png = await fotoDeCamara(1200, 800, { formato: 'png' });
  const logoPng = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: { r: 10, g: 80, b: 200, alpha: 1 } } }).png().toBuffer();
  const webpChico = await sharp(await fotoDeCamara(900, 600)).webp().toBuffer();
  const webpGrande = await sharp(await fotoDeCamara(2400, 1600)).webp().toBuffer();
  const archivos = {
    'viejo-1.jpg': jpg, 'viejo-2.png': png, 'viejo-3.webp': webpChico, 'viejo-4.webp': webpGrande, 'logo.png': logoPng, 'banner.jpg': await fotoDeCamara(2400, 800), 'banner-movil.jpg': await fotoDeCamara(1500, 1800),
  };
  for (const [nombre, contenido] of Object.entries(archivos)) writeFileSync(path.join(dir, nombre), contenido);

  const { rows } = await db.prepare(`INSERT INTO productos (slug, nombre, descripcion, marca, visible, destacado, tienda_id) VALUES ('viejo', 'Viejo', '', '', 1, 0, ?) RETURNING id`).run(id);
  await db.prepare('INSERT INTO variantes (tienda_id, producto_id, sku, precio_centavos, stock) VALUES (?, ?, ?, 100000, 1)').run(id, rows[0].id, `V-${id}`);
  const insertar = db.prepare('INSERT INTO producto_fotos (tienda_id, producto_id, archivo, orden, huella) VALUES (?, ?, ?, ?, ?)');
  // La primera sin huella (como las subidas antes de que existieran), las otras con la suya.
  await insertar.run(id, rows[0].id, 'viejo-1.jpg', 0, null);
  await insertar.run(id, rows[0].id, 'viejo-2.png', 1, huellaDe(png));
  await insertar.run(id, rows[0].id, 'viejo-3.webp', 2, huellaDe(webpChico));
  await insertar.run(id, rows[0].id, 'viejo-4.webp', 3, huellaDe(webpGrande));
  await insertar.run(id, rows[0].id, 'fantasma.jpg', 4, null);
  await db.prepare('INSERT INTO ajustes_tienda (tienda_id, logo) VALUES (?, ?) ON CONFLICT (tienda_id) DO UPDATE SET logo = excluded.logo').run(id, 'logo.png');
  await db.prepare('INSERT INTO banners (tienda_id, imagen, imagen_movil, orden) VALUES (?, ?, ?, 0)').run(id, 'banner.jpg', 'banner-movil.jpg');
  return { id, dir, jpg, originales: archivos };
}

const estado = async (id) => ({
  fotos: (await db.prepare('SELECT archivo FROM producto_fotos WHERE tienda_id = ? ORDER BY orden').all(id)).map((f) => f.archivo),
  logo: (await db.prepare('SELECT logo FROM ajustes_tienda WHERE tienda_id = ?').get(id)).logo,
  banner: await db.prepare('SELECT imagen, imagen_movil FROM banners WHERE tienda_id = ?').get(id),
});

test('migración --dry-run: cuenta lo que haría y no cambia ni archivos ni base', async () => {
  const { id, dir } = await tiendaConImagenesViejas();
  const antesArchivos = readdirSync(dir).sort();
  const antesBase = await estado(id);
  const lineas = [];
  const resumen = await migrarImagenes({ db, dirSubidas, tiendaId: id, dryRun: true, log: (l) => lineas.push(l) });

  assert.deepEqual(readdirSync(dir).sort(), antesArchivos);
  assert.deepEqual(await estado(id), antesBase);
  assert.equal((await db.prepare('SELECT huella FROM producto_fotos WHERE tienda_id = ? AND archivo = ?').get(id, 'viejo-1.jpg')).huella, null, 'ni siquiera completa huellas');
  // viejo-1.jpg, viejo-2.png, viejo-4.webp (más ancho que 1600), logo, banner y banner móvil se convierten; viejo-3.webp solo recibe miniaturas.
  assert.equal(resumen.convertidas, 6);
  assert.equal(resumen.soloMiniaturas, 1);
  assert.deepEqual(resumen.faltan, [`${id}/fantasma.jpg`]);
  assert.ok(lineas.some((l) => l.includes('viejo-1.jpg') && l.includes('viejo-1-g.webp')));
});

test('migración: convierte, actualiza la base, conserva los originales y las huellas, y se puede repetir', async () => {
  const { id, dir, jpg, originales } = await tiendaConImagenesViejas();
  const resumen = await migrarImagenes({ db, dirSubidas, tiendaId: id });
  assert.equal(resumen.convertidas, 6);
  assert.equal(resumen.soloMiniaturas, 1);
  assert.ok(resumen.bytesDespues < resumen.bytesAntes, 'pesa menos');

  const base = await estado(id);
  assert.deepEqual(base.fotos, ['viejo-1-g.webp', 'viejo-2-g.webp', 'viejo-3.webp', 'viejo-4-g.webp', 'fantasma.jpg']);
  assert.equal(base.logo, 'logo-g.webp');
  assert.deepEqual({ ...base.banner }, { imagen: 'banner-g.webp', imagen_movil: 'banner-movil-g.webp' });

  // Los originales siguen donde estaban, intactos.
  for (const [nombre, contenido] of Object.entries(originales)) assert.ok(readFileSync(path.join(dir, nombre)).equals(contenido), nombre);
  // Cada foto tiene sus miniaturas, y ninguna imagen se pasa de las medidas de su perfil.
  for (const foto of base.fotos.filter((f) => f !== 'fantasma.jpg')) {
    assert.ok(existsSync(path.join(dir, nombreMiniatura(foto, 'm'))), `${foto} -m`);
    assert.ok(existsSync(path.join(dir, nombreMiniatura(foto, 's'))), `${foto} -s`);
    assert.ok((await medidas(id, foto)).ancho <= 1600);
    assert.ok(peso(id, nombreMiniatura(foto, 'm')) <= 100 * 1024);
  }
  assert.ok((await medidas(id, 'logo-g.webp')).ancho <= 360);
  assert.equal((await medidas(id, 'banner-g.webp')).ancho, 1200);
  assert.equal((await medidas(id, 'banner-movil-g.webp')).ancho, 800);
  // La huella de la foto que no tenía es la del ORIGINAL (la que usa la carga masiva para no repetir fotos).
  assert.equal((await db.prepare('SELECT huella FROM producto_fotos WHERE tienda_id = ? AND archivo = ?').get(id, 'viejo-1-g.webp')).huella, huellaDe(jpg));

  // Segunda corrida: no hay nada que hacer y no cambia nada.
  const archivosAntes = readdirSync(dir).sort();
  const repetida = await migrarImagenes({ db, dirSubidas, tiendaId: id });
  assert.equal(repetida.convertidas, 0);
  assert.equal(repetida.soloMiniaturas, 0);
  assert.equal(repetida.yaMigradas, 7, '4 fotos, el logo y los 2 banners (la foto fantasma se informa aparte)');
  assert.deepEqual(repetida.faltan, [`${id}/fantasma.jpg`]);
  assert.deepEqual(readdirSync(dir).sort(), archivosAntes);
  assert.deepEqual(await estado(id), base);
});

test('migración: una corrida cortada a la mitad se completa, y --mover-originales los pasa al respaldo', async () => {
  const { id, dir } = await tiendaConImagenesViejas();
  // Como si la corrida anterior hubiera escrito la grande y se hubiera cortado antes de las miniaturas y de la base.
  writeFileSync(path.join(dir, 'viejo-1-g.webp'), await sharp(path.join(dir, 'viejo-1.jpg')).resize({ width: 1600 }).webp().toBuffer());
  // Y otra que quedó truncada: se rehace.
  writeFileSync(path.join(dir, 'viejo-2-g.webp'), Buffer.from('RIFF....WEBPtruncado'));

  const dirRespaldo = mkdtempSync(path.join(tmpdir(), 'respaldo-'));
  const resumen = await migrarImagenes({ db, dirSubidas, tiendaId: id, moverOriginales: true, dirRespaldo });
  assert.deepEqual((await estado(id)).fotos.slice(0, 2), ['viejo-1-g.webp', 'viejo-2-g.webp']);
  assert.ok((await medidas(id, 'viejo-2-g.webp')).ancho > 0);
  assert.ok(existsSync(path.join(dir, nombreMiniatura('viejo-1-g.webp', 'm'))));
  // Se mueven los 6 originales que se reemplazaron; viejo-3.webp se queda porque la base lo sigue usando.
  assert.equal(resumen.movidas, 6);
  assert.deepEqual(readdirSync(path.join(dirRespaldo, String(id))).sort(), ['banner-movil.jpg', 'banner.jpg', 'logo.png', 'viejo-1.jpg', 'viejo-2.png', 'viejo-4.webp']);
  assert.ok(existsSync(path.join(dir, 'viejo-3.webp')));
  assert.ok(!existsSync(path.join(dir, 'viejo-1.jpg')));
  rmSync(dirRespaldo, { recursive: true, force: true });
});
