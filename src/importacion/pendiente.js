// Importaciones que esperan confirmación. Entre la vista previa y "Confirmar" se guarda, en una carpeta propia:
//   planilla.xlsx           el Excel tal cual se subió
//   fotos/<huella>          cada foto ya obtenida (pegada o descargada), una vez por contenido
//   fotos.json              [[fila, [huella, ...]], ...]
// Así, al confirmar no se vuelve a descargar nada.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { huellaDe } from '../imagenes.js';

const VIDA_PENDIENTE_MS = 24 * 60 * 60 * 1000;

const rutaDe = (dir, carpeta) => path.join(dir, path.basename(carpeta));

export async function guardarPendiente(dir, tiendaId, { excel, fotosPorFila }) {
  const carpeta = `${tiendaId}-${randomUUID()}`;
  const ruta = rutaDe(dir, carpeta);
  await mkdir(path.join(ruta, 'fotos'), { recursive: true });
  await writeFile(path.join(ruta, 'planilla.xlsx'), excel);
  const indice = [];
  const escritas = new Set();
  for (const [fila, fotos] of fotosPorFila) {
    const huellas = [];
    for (const contenido of fotos) {
      const huella = huellaDe(contenido);
      if (!escritas.has(huella)) await writeFile(path.join(ruta, 'fotos', huella), contenido);
      escritas.add(huella);
      huellas.push(huella);
    }
    indice.push([fila, huellas]);
  }
  await writeFile(path.join(ruta, 'fotos.json'), JSON.stringify(indice));
  return carpeta;
}

export async function leerPendiente(dir, carpeta) {
  const ruta = rutaDe(dir, carpeta);
  const excel = await readFile(path.join(ruta, 'planilla.xlsx'));
  const fotosPorFila = new Map();
  for (const [fila, huellas] of JSON.parse(await readFile(path.join(ruta, 'fotos.json'), 'utf8'))) {
    const fotos = [];
    for (const huella of huellas) fotos.push(await readFile(path.join(ruta, 'fotos', path.basename(huella))));
    fotosPorFila.set(fila, fotos);
  }
  return { excel, fotosPorFila };
}

export async function borrarPendiente(dir, carpeta) {
  await rm(rutaDe(dir, carpeta), { recursive: true, force: true });
}

// Limpia las importaciones que nadie confirmó.
export async function borrarPendientesViejos(dir) {
  const limite = Date.now() - VIDA_PENDIENTE_MS;
  for (const nombre of await readdir(dir)) {
    const ruta = path.join(dir, nombre);
    if ((await stat(ruta)).mtimeMs < limite) await rm(ruta, { recursive: true, force: true });
  }
}
