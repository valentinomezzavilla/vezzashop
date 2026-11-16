// Fotos pegadas en la primera hoja de un .xlsx. read-excel-file solo lee valores, así que acá se abre el archivo
// (es un zip) y se siguen las referencias entre sus partes. Hay dos formas de pegar una foto:
//  - flotando encima de la hoja: un dibujo anclado a la celda de su esquina de arriba a la izquierda;
//  - "Colocar en celda" (Excel 365): la celda apunta a la foto a través de metadata.xml y xl/richData.
// Los XML los genera el programa, así que alcanza con expresiones regulares que acepten cualquier prefijo de namespace.
//
// Del zip se descomprimen solo las partes que hacen falta, y las fotos solo si pesan hasta 5 MB: un .xlsx de pocos
// KB puede declarar partes de gigas. Una foto que no se puede usar no se descarta en silencio: vuelve marcada
// ({ contenido: null, problema: 'pesada' | 'ilegible' }) para que la vista previa la muestre como problema.

import { unzipSync, strFromU8 } from 'fflate';
import path from 'node:path';
import { TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';

const PREFIJO = '(?:[\\w.-]+:)?';

// Cada aparición de <nombre ...> o <nombre .../>: sus atributos y lo que tiene adentro.
function etiquetas(xml, nombre) {
  const patron = new RegExp(`<${PREFIJO}${nombre}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</${PREFIJO}${nombre}>)`, 'g');
  return [...xml.matchAll(patron)].map((m) => ({ atributos: atributos(m[1]), contenido: m[2] ?? '' }));
}

const primera = (xml, nombre) => etiquetas(xml, nombre)[0] ?? null;

// Los atributos se guardan por nombre local: r:id -> id. Acepta comillas dobles o simples.
function atributos(texto) {
  const resultado = {};
  for (const [, nombre, dobles, simples] of texto.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    resultado[nombre.slice(nombre.indexOf(':') + 1)] = dobles ?? simples;
  }
  return resultado;
}

const entero = (texto) => (texto === undefined || texto === null || texto.trim() === '' ? null : Number(texto.trim()));

// "AB12" -> { fila: 12, columna: 27 } (fila en base 1, columna en base 0)
function celda(referencia) {
  const m = /^([A-Z]+)(\d+)$/i.exec(referencia ?? '');
  if (!m) return null;
  let columna = 0;
  for (const letra of m[1].toUpperCase()) columna = columna * 26 + (letra.charCodeAt(0) - 64);
  return { fila: Number(m[2]), columna: columna - 1 };
}

function crearLector(buffer) {
  const datos = new Uint8Array(buffer);
  const textos = new Map();

  // Descomprime una sola parte, y solo si no pasa del tope. Devuelve { datos }, { tamano } (si pasa) o null.
  function parte(ruta, tope = Infinity) {
    if (!ruta) return null;
    let tamano = null;
    const encontradas = unzipSync(datos, {
      filter: (archivo) => {
        if (archivo.name !== ruta) return false;
        tamano = archivo.originalSize;
        return archivo.originalSize <= tope;
      },
    });
    if (encontradas[ruta]) return { datos: encontradas[ruta] };
    return tamano === null ? null : { tamano };
  }

  function texto(ruta) {
    if (!textos.has(ruta)) {
      const encontrada = parte(ruta);
      textos.set(ruta, encontrada?.datos ? strFromU8(encontrada.datos) : null);
    }
    return textos.get(ruta);
  }

  // Id -> ruta de la parte destino, resuelta desde la carpeta de la parte de origen.
  function relaciones(rutaParte) {
    const carpeta = path.posix.dirname(rutaParte);
    const xml = texto(path.posix.join(carpeta, '_rels', `${path.posix.basename(rutaParte)}.rels`));
    const mapa = new Map();
    if (!xml) return mapa;
    for (const { atributos: a } of etiquetas(xml, 'Relationship')) {
      if (!a.Id || !a.Target || a.TargetMode === 'External') continue;
      const destino = a.Target.startsWith('/') ? a.Target.slice(1) : path.posix.normalize(path.posix.join(carpeta, a.Target));
      mapa.set(a.Id, destino);
    }
    return mapa;
  }

  // { contenido } o { problema: 'pesada' | 'ilegible' }
  function foto(ruta) {
    const encontrada = parte(ruta, TAMANO_MAXIMO_IMAGEN);
    if (encontrada?.datos) return { contenido: Buffer.from(encontrada.datos) };
    return { problema: encontrada ? 'pesada' : 'ilegible' };
  }
  return { texto, relaciones, foto };
}

const ilegible = { problema: 'ilegible' };

function rutaPrimeraHoja(lector) {
  const libro = lector.texto('xl/workbook.xml');
  const hoja = libro && primera(libro, 'sheet');
  return hoja ? (lector.relaciones('xl/workbook.xml').get(hoja.atributos.id) ?? null) : null;
}

function fotosFlotantes(lector, rutaHoja, xmlHoja) {
  const fotos = [];
  for (const { atributos: a } of etiquetas(xmlHoja, 'drawing')) {
    const rutaDibujo = lector.relaciones(rutaHoja).get(a.id);
    const dibujo = lector.texto(rutaDibujo);
    if (!dibujo) continue;
    const relDibujo = lector.relaciones(rutaDibujo);
    const anclas = [...etiquetas(dibujo, 'twoCellAnchor'), ...etiquetas(dibujo, 'oneCellAnchor')];
    for (const ancla of anclas) {
      if (!primera(ancla.contenido, 'pic')) continue; // formas, gráficos: no son fotos
      const desde = primera(ancla.contenido, 'from');
      const columna = desde ? entero(primera(desde.contenido, 'col')?.contenido) : null;
      const fila = desde ? entero(primera(desde.contenido, 'row')?.contenido) : null;
      if (columna === null || fila === null) continue;
      const desplazamiento = entero(primera(desde.contenido, 'colOff')?.contenido) ?? 0;
      // Las fotos agrupadas no se leen: se marcan para que el cliente las pegue sueltas.
      const blip = primera(ancla.contenido, 'grpSp') ? null : primera(ancla.contenido, 'blip');
      const resultado = blip ? lector.foto(relDibujo.get(blip.atributos.embed)) : ilegible;
      fotos.push({ fila: fila + 1, columna, desplazamiento, ...resultado });
    }
  }
  return fotos;
}

// Celda con vm="N" -> N-ésimo <bk> de valueMetadata -> <bk> de futureMetadata XLRICHVALUE -> <rv> de rdrichvalue.xml
// -> el valor de la clave _rvRel:LocalImageIdentifier -> <rel> de richValueRel.xml -> xl/media/...
function fotosEnCelda(lector, xmlHoja) {
  const celdas = etiquetas(xmlHoja, 'c').filter((c) => entero(c.atributos.vm) !== null && celda(c.atributos.r));
  if (celdas.length === 0) return [];
  const metadata = lector.texto('xl/metadata.xml') ?? '';
  const valores = lector.texto('xl/richData/rdrichvalue.xml') ?? '';
  const estructuras = lector.texto('xl/richData/rdrichvaluestructure.xml') ?? '';
  const rels = lector.texto('xl/richData/richValueRel.xml') ?? '';

  const bloquesValor = etiquetas(primera(metadata, 'valueMetadata')?.contenido ?? '', 'bk');
  const futuro = etiquetas(metadata, 'futureMetadata').find((f) => f.atributos.name === 'XLRICHVALUE');
  const bloquesFuturo = etiquetas(futuro?.contenido ?? '', 'bk');
  const valoresRicos = etiquetas(valores, 'rv');
  const posicionDeLaFoto = etiquetas(estructuras, 's').map((s) =>
    etiquetas(s.contenido, 'k').findIndex((k) => k.atributos.n === '_rvRel:LocalImageIdentifier'),
  );
  const destinos = etiquetas(rels, 'rel').map((r) => r.atributos.id);
  const relDestinos = lector.relaciones('xl/richData/richValueRel.xml');

  // Si algún eslabón falta (otro tipo de valor, como IMAGE() o un tipo de datos), la celda queda marcada.
  function resolver(vm) {
    const rc = primera(bloquesValor[vm - 1]?.contenido ?? '', 'rc');
    const rvb = primera(bloquesFuturo[entero(rc?.atributos.v)]?.contenido ?? '', 'rvb');
    const rv = valoresRicos[entero(rvb?.atributos.i)];
    if (!rv) return ilegible;
    const posicion = posicionDeLaFoto[entero(rv.atributos.s)];
    if (posicion === undefined || posicion < 0) return ilegible;
    const indice = entero(etiquetas(rv.contenido, 'v')[posicion]?.contenido);
    const ruta = indice === null ? undefined : relDestinos.get(destinos[indice]);
    return ruta ? lector.foto(ruta) : ilegible;
  }

  return celdas.map(({ atributos: a }) => ({ ...celda(a.r), desplazamiento: 0, ...resolver(entero(a.vm)) }));
}

// [{ fila (base 1), columna (base 0), contenido }], ordenadas por fila, columna y de izquierda a derecha.
// Las que no se pueden usar vienen con contenido: null y problema: 'pesada' (más de 5 MB) o 'ilegible'.
export function leerFotosExcel(buffer) {
  const lector = crearLector(buffer);
  const rutaHoja = rutaPrimeraHoja(lector);
  const xmlHoja = lector.texto(rutaHoja);
  if (!xmlHoja) return [];
  return [...fotosFlotantes(lector, rutaHoja, xmlHoja), ...fotosEnCelda(lector, xmlHoja)]
    .sort((a, b) => a.fila - b.fila || a.columna - b.columna || a.desplazamiento - b.desplazamiento)
    .map(({ fila, columna, contenido = null, problema }) =>
      problema ? { fila, columna, contenido, problema } : { fila, columna, contenido });
}
