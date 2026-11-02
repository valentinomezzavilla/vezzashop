// Imágenes que suben los clientes (logo, banners). Se guardan en <dirSubidas>/<tiendaId>/<uuid>.<ext>
// y se sirven en /subidas/<tiendaId>/<archivo>.
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const TAMANO_MAXIMO_IMAGEN = 5 * 1024 * 1024;

export class ErrorDeImagen extends Error {}

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

// Devuelve el nombre del archivo guardado.
export async function guardarImagen(dirSubidas, tiendaId, buffer) {
  const tipo = tipoDeImagen(buffer);
  if (!tipo) throw new ErrorDeImagen('La imagen tiene que ser JPG, PNG o WEBP.');
  const dir = path.join(dirSubidas, String(tiendaId));
  await mkdir(dir, { recursive: true });
  const archivo = `${randomUUID()}.${tipo}`;
  await writeFile(path.join(dir, archivo), buffer);
  return archivo;
}

export async function borrarImagen(dirSubidas, tiendaId, archivo) {
  if (!archivo) return;
  await rm(path.join(dirSubidas, String(tiendaId), path.basename(archivo)), { force: true });
}

export const urlImagen = (tiendaId, archivo) => (archivo ? `/subidas/${tiendaId}/${archivo}` : null);
