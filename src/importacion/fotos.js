// Fotos de la carga masiva.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { huellaDe, tipoDeImagen, TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';
import { ErrorDeDescarga, linkDeDescarga } from './descargar.js';

const MB = 1024 * 1024;
export const MAX_LINKS = 200;
// Topes de toda la planilla: que la vista previa no tarde minutos ni junte en memoria más de lo razonable.
export const TIEMPO_TOTAL_MS = 90_000;
export const TOPE_BYTES_FOTOS = 200 * MB;
const DESCARGAS_A_LA_VEZ = 4;

const MENSAJES = {
  fuera: 'Hay una foto pegada fuera de la columna "img"',
  texto: 'En "img" va la foto pegada. Los links van en "link-img"',
  noEsFoto: 'La foto pegada en "img" no es JPG, PNG ni WEBP',
  pesada: 'La foto pegada en "img" pesa más de 5 MB',
  ilegible: 'No pudimos leer la foto pegada en "img". Pegala de nuevo',
  muchosLinks: `La planilla tiene más de ${MAX_LINKS} links en "link-img". Subila en partes`,
  aTiempo: 'Foto de "link-img": no llegamos a descargarla a tiempo. Subí la planilla en partes',
};
const mensajeTope = (tope) => `Las fotos de la planilla pesan más de ${tope / MB} MB en total. Subila en partes`;

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

// Corre fn sobre cada elemento, con no más de `limite` a la vez.
async function enParalelo(elementos, limite, fn) {
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) await fn(elementos[siguiente++]);
  };
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
}

// Junta las fotos de cada fila con datos: las pegadas en "img" o, si no hay, la del link de "link-img".
// fotosExcel viene de leerFotosExcel (las que no se pudieron leer vienen con problema: 'ilegible' | 'pesada').
// descargar(link, { senal }) devuelve la imagen o lanza ErrorDeDescarga.
export async function obtenerFotos({
  productos,
  columnaImg,
  fotosExcel,
  descargar,
  tiempoTotalMs = TIEMPO_TOTAL_MS,
  topeBytes = TOPE_BYTES_FOTOS,
}) {
  const variantes = productos.flatMap((p) => p.variantes).sort((a, b) => a.fila - b.fila);
  const filasConDatos = new Set(variantes.map((v) => v.fila));
  const errores = [];

  const pegadas = new Map(); // fila -> [{ contenido, problema }]
  const filasConFotoFuera = new Set();
  for (const foto of fotosExcel) {
    if (!filasConDatos.has(foto.fila)) continue;
    if (columnaImg === null || foto.columna !== columnaImg) {
      // Lo que no se pudo leer fuera de img puede no ser una foto (un tipo de datos de Excel): se ignora.
      if (foto.problema === 'ilegible') continue;
      if (!filasConFotoFuera.has(foto.fila)) errores.push({ fila: foto.fila, mensaje: MENSAJES.fuera });
      filasConFotoFuera.add(foto.fila);
      continue;
    }
    if (!pegadas.has(foto.fila)) pegadas.set(foto.fila, []);
    pegadas.get(foto.fila).push(foto);
  }

  let bytes = 0;
  let excedido = false;
  // Suma lo que pesa una foto; la primera vez que se pasa del tope, deja el problema en esa fila.
  const sumar = (fila, contenido) => {
    bytes += contenido.length;
    if (bytes > topeBytes && !excedido) {
      excedido = true;
      errores.push({ fila, mensaje: mensajeTope(topeBytes) });
    }
  };

  const fotosPorFila = new Map();
  const filasPorLink = new Map(); // link de descarga -> [filas], en el orden de la planilla
  for (const { fila, textoImg, link } of variantes) {
    if (pegadas.has(fila)) {
      const validas = [];
      for (const { contenido, problema } of pegadas.get(fila)) {
        if (problema === 'ilegible') errores.push({ fila, mensaje: MENSAJES.ilegible });
        else if (problema === 'pesada' || contenido.length > TAMANO_MAXIMO_IMAGEN) errores.push({ fila, mensaje: MENSAJES.pesada });
        else if (!tipoDeImagen(contenido)) errores.push({ fila, mensaje: MENSAJES.noEsFoto });
        else {
          validas.push(contenido);
          sumar(fila, contenido);
        }
      }
      if (validas.length > 0) fotosPorFila.set(fila, validas);
    } else if (textoImg !== null) {
      errores.push({ fila, mensaje: MENSAJES.texto });
    } else if (link !== null) {
      const deDescarga = linkDeDescarga(link);
      if (!filasPorLink.has(deDescarga)) filasPorLink.set(deDescarga, []);
      filasPorLink.get(deDescarga).push(fila);
    }
  }

  if (filasPorLink.size > MAX_LINKS) {
    errores.push({ fila: [...filasPorLink.values()][MAX_LINKS][0], mensaje: MENSAJES.muchosLinks });
  } else if (!excedido) {
    // Se corta todo si se acaba el tiempo total o si las fotos ya pasaron el tope.
    const corte = new AbortController();
    const senal = AbortSignal.any([corte.signal, AbortSignal.timeout(tiempoTotalMs)]);
    const fallar = (filas, mensaje) => filas.forEach((fila) => errores.push({ fila, mensaje }));
    await enParalelo([...filasPorLink], DESCARGAS_A_LA_VEZ, async ([link, filas]) => {
      if (excedido) return;
      if (senal.aborted) return fallar(filas, MENSAJES.aTiempo);
      try {
        const foto = await descargar(link, { senal });
        if (excedido) return;
        sumar(filas[0], foto);
        if (excedido) return corte.abort();
        for (const fila of filas) fotosPorFila.set(fila, [foto]);
      } catch (error) {
        if (!(error instanceof ErrorDeDescarga)) throw error;
        if (excedido) return;
        fallar(filas, senal.aborted ? MENSAJES.aTiempo : `Foto de "link-img": ${error.message}`);
      }
    });
  }

  errores.sort((a, b) => a.fila - b.fila);
  return { fotosPorFila, errores };
}

// Le pone a cada producto sus fotos, en el orden de sus filas y sin repetir: producto.fotos = [{ huella, contenido }].
export function asignarFotos(productos, fotosPorFila) {
  for (const producto of productos) {
    const vistas = new Set();
    producto.fotos = [];
    for (const variante of producto.variantes) {
      for (const contenido of fotosPorFila.get(variante.fila) ?? []) {
        const huella = huellaDe(contenido);
        if (vistas.has(huella)) continue;
        vistas.add(huella);
        producto.fotos.push({ huella, contenido });
      }
    }
  }
}
