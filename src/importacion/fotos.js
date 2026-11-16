// Fotos de la carga masiva.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { huellaDe } from '../imagenes.js';

// Las fotos subidas antes de que existieran las huellas no tienen una: se calcula leyendo el archivo.
// Si el archivo no está, la foto queda sin huella.
export async function completarHuellas(db, dirSubidas, tiendaId) {
  const sinHuella = db
    .prepare('SELECT id, archivo FROM producto_fotos WHERE tienda_id = ? AND huella IS NULL')
    .all(tiendaId);
  const guardar = db.prepare('UPDATE producto_fotos SET huella = ? WHERE id = ?');
  for (const foto of sinHuella) {
    let contenido;
    try {
      contenido = await readFile(path.join(dirSubidas, String(tiendaId), path.basename(foto.archivo)));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    guardar.run(huellaDe(contenido), foto.id);
  }
}
