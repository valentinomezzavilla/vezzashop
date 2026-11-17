// Convierte las imágenes que se subieron antes del formato WebP (ver src/imagenes.js) al formato nuevo.
// Lo usa scripts/migrar-imagenes.js; está acá para poder probarlo.
//
// Para cada imagen que la base de datos usa (fotos de productos, logo y banners):
//   - Si no es un WebP dentro de las medidas de su perfil, escribe la versión grande como <nombre>-g.webp y
//     actualiza la base para que apunte a ella. El original NO se toca (a menos que se pida moverlo a un respaldo).
//   - Si es una foto de producto, genera las miniaturas -m y -s que falten.
// Se puede correr las veces que haga falta: lo que ya está convertido se saltea, y una corrida cortada a la mitad
// se completa en la siguiente. Mientras corre, la tienda sigue andando: la base solo cambia cuando los archivos nuevos
// ya están escritos.
import { access, copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { enTransaccion } from './db.js';
import { completarHuellas } from './importacion/fotos.js';
import { PERFILES, convertirAWebp, escribirVersiones, nombreMiniatura } from './imagenes.js';

// Dónde guarda la base de datos el nombre de cada tipo de imagen.
const REFERENCIAS = [
  { tabla: 'producto_fotos', columna: 'archivo', perfil: 'foto' },
  { tabla: 'ajustes_tienda', columna: 'logo', perfil: 'logo' },
  { tabla: 'banners', columna: 'imagen', perfil: 'banner' },
  { tabla: 'banners', columna: 'imagen_movil', perfil: 'bannerMovil' },
];

const existe = (ruta) => access(ruta).then(() => true, () => false);
const tamano = (ruta) => stat(ruta).then((s) => s.size, () => 0);
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;

// Lee las medidas con la orientación de la cámara ya aplicada. null si el archivo no se puede leer.
async function medidasDe(ruta) {
  try {
    const { width, height, orientation = 1, format } = await sharp(ruta).metadata();
    return orientation >= 5 ? { ancho: height, alto: width, formato: format } : { ancho: width, alto: height, formato: format };
  } catch {
    return null;
  }
}

// Qué hay que hacer con un archivo: { final, convertirGrande, faltantes } o { problema }.
async function planDe(dir, archivo, perfil) {
  const origen = path.join(dir, archivo);
  if (!(await existe(origen))) return { problema: 'falta' };
  const medidas = await medidasDe(origen);
  if (!medidas) return { problema: 'ilegible' };

  const { ancho, alto, miniaturas } = PERFILES[perfil];
  const dentro = medidas.ancho <= ancho && (!alto || medidas.alto <= alto);
  const convertirGrande = !(medidas.formato === 'webp' && dentro);
  const final = convertirGrande ? `${archivo.replace(/\.[^.]+$/, '')}-g.webp` : archivo;

  const faltantes = [];
  for (const [sufijo, anchoMiniatura] of miniaturas) {
    if (!(await existe(path.join(dir, nombreMiniatura(final, sufijo))))) faltantes.push([sufijo, anchoMiniatura]);
  }
  return { final, convertirGrande, faltantes };
}

// Opciones: { db, dirSubidas, tiendaId (opcional: una sola tienda), dryRun, moverOriginales, dirRespaldo, log }
// Devuelve un resumen con los contadores.
export async function migrarImagenes({
  db,
  dirSubidas,
  tiendaId = null,
  dryRun = false,
  moverOriginales = false,
  dirRespaldo = path.join(path.dirname(path.resolve(dirSubidas)), 'subidas-originales'),
  log = () => {},
}) {
  const resumen = { revisadas: 0, convertidas: 0, soloMiniaturas: 0, yaMigradas: 0, faltan: [], ilegibles: [], movidas: 0, bytesAntes: 0, bytesDespues: 0 };
  const tiendas = tiendaId === null ? (await db.prepare('SELECT id FROM tiendas ORDER BY id').all()).map((t) => t.id) : [tiendaId];

  for (const id of tiendas) {
    const dir = path.join(dirSubidas, String(id));
    // Las fotos viejas sin huella la calculan leyendo el archivo: hay que hacerlo antes de convertirlas, porque la
    // huella es la del original y es lo que usa la carga masiva para no repetir fotos.
    if (!dryRun) await completarHuellas(db, dirSubidas, id);

    for (const { tabla, columna, perfil } of REFERENCIAS) {
      const filas = await db.prepare(`SELECT DISTINCT ${columna} AS archivo FROM ${tabla} WHERE tienda_id = ? AND ${columna} IS NOT NULL`).all(id);
      for (const { archivo } of filas) {
        resumen.revisadas++;
        const etiqueta = `tienda ${id}  ${archivo}`;
        const plan = await planDe(dir, archivo, perfil);
        if (plan.problema) {
          (plan.problema === 'falta' ? resumen.faltan : resumen.ilegibles).push(`${id}/${archivo}`);
          log(`${etiqueta}: ${plan.problema === 'falta' ? 'el archivo no existe, se saltea' : 'no se puede leer, se saltea'}`);
          continue;
        }
        const { final, convertirGrande, faltantes } = plan;
        if (!convertirGrande && faltantes.length === 0) {
          resumen.yaMigradas++;
          continue;
        }
        const accion = convertirGrande ? `convertir a ${final}` : `generar miniaturas (${faltantes.map(([s]) => s).join(', ')})`;
        if (dryRun) {
          log(`${etiqueta}: ${accion}`);
          if (convertirGrande) resumen.convertidas++;
          else resumen.soloMiniaturas++;
          continue;
        }

        const origen = path.join(dir, archivo);
        try {
          // Si la versión grande ya está de una corrida cortada, se reutiliza; si quedó a medias, se rehace.
          // escribirVersiones ya genera las miniaturas junto con la grande.
          const escritasJuntas = convertirGrande && !(await medidasDe(path.join(dir, final)));
          if (escritasJuntas) await escribirVersiones(origen, dir, final, perfil);
          else {
            const { calidad } = PERFILES[perfil];
            for (const [sufijo, anchoMiniatura] of faltantes) {
              await writeFile(path.join(dir, nombreMiniatura(final, sufijo)), await convertirAWebp(origen, { ancho: anchoMiniatura, calidad: calidad - 2 }));
            }
          }
        } catch (error) {
          resumen.ilegibles.push(`${id}/${archivo}`);
          log(`${etiqueta}: no se pudo convertir (${error.message}), se saltea`);
          continue;
        }

        if (convertirGrande) {
          await enTransaccion(db, (tx) =>
            tx.prepare(`UPDATE ${tabla} SET ${columna} = ? WHERE tienda_id = ? AND ${columna} = ?`).run(final, id, archivo),
          );
          resumen.convertidas++;
        } else {
          resumen.soloMiniaturas++;
        }

        const versiones = [final, ...PERFILES[perfil].miniaturas.map(([sufijo]) => nombreMiniatura(final, sufijo))];
        const antes = await tamano(origen);
        let despues = 0;
        for (const version of versiones) despues += await tamano(path.join(dir, version));
        resumen.bytesAntes += antes;
        resumen.bytesDespues += despues;
        log(`${etiqueta}: ${accion} (${kb(antes)} → ${kb(despues)})`);

        // Con --mover-originales, el original pasa a la carpeta de respaldo (solo si ya nada lo usa).
        if (moverOriginales && convertirGrande && !(await sigueEnUso(db, id, archivo))) {
          await mkdir(path.join(dirRespaldo, String(id)), { recursive: true });
          const destino = path.join(dirRespaldo, String(id), archivo);
          try {
            await rename(origen, destino);
          } catch (error) {
            if (error.code !== 'EXDEV') throw error; // otro disco: se copia y se borra
            await copyFile(origen, destino);
            await rm(origen);
          }
          resumen.movidas++;
        }
      }
    }
  }
  return resumen;
}

// ¿Alguna fila de la tienda todavía apunta a este archivo?
async function sigueEnUso(db, tiendaId, archivo) {
  for (const { tabla, columna } of REFERENCIAS) {
    if (await db.prepare(`SELECT 1 FROM ${tabla} WHERE tienda_id = ? AND ${columna} = ? LIMIT 1`).get(tiendaId, archivo)) return true;
  }
  return false;
}
