// Imágenes que suben los clientes (fotos de productos, logo, banners).
//
// Nunca se guarda el original: cada subida se convierte a WebP, se corrige la rotación de la cámara (EXIF) y se
// descartan los metadatos (incluida la ubicación). Según el perfil se guardan estos archivos en
// <dirSubidas>/<tiendaId>/ y se sirven en /subidas/<tiendaId>/<archivo>:
//
//   foto    <uuid>.webp      versión grande, de hasta 1600 px de ancho (la que se abre al ampliar)
//           <uuid>-m.webp    miniatura de 540 px (grillas de productos y portada de la ficha)
//           <uuid>-s.webp    miniatura de 128 px (carrito, buscador, tira de fotos, listados del panel)
//   banner  <uuid>.webp      hasta 1200 px de ancho (800 px la versión para celular)
//   logo    <uuid>.webp      hasta 360 × 80 px: el doble de lo que se muestra, para pantallas retina
//
// La base de datos guarda solo el nombre de la versión grande (<uuid>.webp); las miniaturas se encuentran por nombre
// (urlMiniatura). Las imágenes subidas antes de este formato (<uuid>.jpg / .png) siguen funcionando tal cual
// hasta que scripts/migrar-imagenes.js las convierta; mientras tanto las miniaturas que faltan redirigen al original
// (ver app.js).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const TAMANO_MAXIMO_IMAGEN = 5 * 1024 * 1024;
// Tope de píxeles al decodificar: un PNG de pocos MB puede declarar decenas de miles de píxeles de lado
// y ocupar gigas en memoria. Una cámara de 60 megapíxeles entra.
const MAXIMO_PIXELES = 100_000_000;

export class ErrorDeImagen extends Error {}

// Qué se guarda de cada tipo de imagen. `miniaturas` son [sufijo, ancho].
export const PERFILES = {
  foto: { ancho: 1600, calidad: 78, miniaturas: [['m', 540], ['s', 128]] },
  banner: { ancho: 1200, calidad: 80, miniaturas: [] },
  bannerMovil: { ancho: 800, calidad: 80, miniaturas: [] },
  logo: { ancho: 360, alto: 80, calidad: 88, miniaturas: [] },
};

// El tipo se decide por el contenido, no por el nombre del archivo. No se aceptan SVG: pueden traer scripts.
export function tipoDeImagen(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

// "<uuid>.jpg" -> "<uuid>-m.webp"
export const nombreMiniatura = (archivo, sufijo = 'm') => `${path.basename(archivo).replace(/\.[^.]+$/, '')}-${sufijo}.webp`;

// Redimensiona y codifica a WebP. Con `.rotate()` sin argumentos se aplica la orientación EXIF y se quita la etiqueta.
// Nunca agranda: una foto chica queda como está.
export async function convertirAWebp(entrada, { ancho, alto, calidad = 78 }) {
  try {
    return await sharp(entrada, { limitInputPixels: MAXIMO_PIXELES, failOn: 'error' })
      .rotate()
      .resize({ width: ancho, height: alto, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: calidad, alphaQuality: 100, effort: 4 })
      .toBuffer();
  } catch {
    // Una imagen con el formato roto (o con demasiados píxeles) no es un error del servidor: se le avisa a quien la subió.
    throw new ErrorDeImagen('No pudimos leer la imagen. Probá con otra o guardala de nuevo desde tu editor de fotos.');
  }
}

// Genera y escribe todas las versiones de `entrada` (un buffer o la ruta de un archivo) en `dir`.
// El nombre de la versión grande es `nombre`; las miniaturas se derivan de él. Devuelve los archivos escritos.
// Si algo falla, no queda ninguno.
export async function escribirVersiones(entrada, dir, nombre, perfil) {
  const { miniaturas, ...medidas } = PERFILES[perfil];
  const escritos = [];
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, nombre), await convertirAWebp(entrada, medidas));
    escritos.push(nombre);
    for (const [sufijo, ancho] of miniaturas) {
      const archivo = nombreMiniatura(nombre, sufijo);
      await writeFile(path.join(dir, archivo), await convertirAWebp(entrada, { ancho, calidad: medidas.calidad - 2 }));
      escritos.push(archivo);
    }
  } catch (error) {
    await Promise.all(escritos.map((archivo) => rm(path.join(dir, archivo), { force: true })));
    throw error;
  }
  return escritos;
}

// Guarda la imagen subida y devuelve el nombre del archivo guardado (la versión grande).
// perfil: 'foto' (por defecto), 'banner', 'bannerMovil' o 'logo'.
export async function guardarImagen(dirSubidas, tiendaId, buffer, { perfil = 'foto' } = {}) {
  const tipo = tipoDeImagen(buffer);
  if (!tipo) throw new ErrorDeImagen('La imagen tiene que ser JPG, PNG o WEBP.');
  const archivo = `${randomUUID()}.webp`;
  await escribirVersiones(buffer, path.join(dirSubidas, String(tiendaId)), archivo, perfil);
  return archivo;
}

// Borra la imagen con sus miniaturas (si las tiene). También sirve para las subidas viejas, que no las tienen.
export async function borrarImagen(dirSubidas, tiendaId, archivo) {
  if (!archivo) return;
  const dir = path.join(dirSubidas, String(tiendaId));
  const nombres = [path.basename(archivo), ...PERFILES.foto.miniaturas.map(([sufijo]) => nombreMiniatura(archivo, sufijo))];
  await Promise.all(nombres.map((nombre) => rm(path.join(dir, nombre), { force: true })));
}

// Identifica una imagen por su contenido: dos archivos iguales tienen la misma huella.
// Se calcula sobre lo que subió el cliente, no sobre lo que se guarda: así la carga masiva reconoce una foto repetida.
export const huellaDe = (buffer) => createHash('sha256').update(buffer).digest('hex');

export const urlImagen = (tiendaId, archivo) => (archivo ? `/subidas/${tiendaId}/${archivo}` : null);
// sufijo: 'm' (540 px) o 's' (128 px)
export const urlMiniatura = (tiendaId, archivo, sufijo = 'm') => (archivo ? `/subidas/${tiendaId}/${nombreMiniatura(archivo, sufijo)}` : null);

// Ancho y alto de una imagen guardada, para ponerlos en el <img> y que la página no salte al cargar.
// Los nombres de archivo no se reutilizan, así que alcanza con leerlos una vez por proceso.
const dimensiones = new Map();
export async function dimensionesDe(dirSubidas, tiendaId, archivo) {
  if (!archivo) return null;
  const clave = `${tiendaId}/${archivo}`;
  if (dimensiones.has(clave)) return dimensiones.get(clave);
  try {
    const { width, height, orientation = 1 } = await sharp(path.join(dirSubidas, String(tiendaId), path.basename(archivo))).metadata();
    // Las subidas viejas pueden traer la orientación de la cámara sin aplicar: con 5 a 8 el ancho y el alto se invierten.
    const medidas = orientation >= 5 ? { ancho: height, alto: width } : { ancho: width, alto: height };
    dimensiones.set(clave, medidas);
    return medidas;
  } catch {
    return null; // el archivo falta o no se puede leer: sin medidas, la imagen se muestra igual
  }
}
