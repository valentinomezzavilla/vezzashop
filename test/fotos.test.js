// Fotos de la carga masiva: huellas, fotos por fila y por producto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { agregarFoto } from '../src/productos.js';
import { huellaDe } from '../src/imagenes.js';
import { completarHuellas, obtenerFotos, asignarFotos } from '../src/importacion/fotos.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { ErrorDeDescarga } from '../src/importacion/descargar.js';
import { crearTiendaVacia, PNG, otraFoto } from './ayudantes.js';

test('completarHuellas calcula la huella de las fotos viejas y saltea las que no tienen archivo', async (t) => {
  const db = abrirBase(':memory:');
  const tiendaId = crearTiendaVacia(db, 'huellas');
  const dir = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const productoId = Number(
    db.prepare("INSERT INTO productos (tienda_id, slug, nombre) VALUES (?, 'p', 'P')").run(tiendaId).lastInsertRowid,
  );
  mkdirSync(path.join(dir, String(tiendaId)));
  writeFileSync(path.join(dir, String(tiendaId), 'vieja.png'), PNG);
  agregarFoto(db, tiendaId, productoId, 'vieja.png');
  agregarFoto(db, tiendaId, productoId, 'perdida.png');

  await completarHuellas(db, dir, tiendaId);

  assert.deepEqual(
    db.prepare('SELECT archivo, huella FROM producto_fotos ORDER BY id').all().map((f) => ({ ...f })),
    [
      { archivo: 'vieja.png', huella: huellaDe(PNG) },
      { archivo: 'perdida.png', huella: null },
    ],
  );
});

// ---------- Fotos por fila ----------

const ENCABEZADOS = ['SKU', 'Nombre', 'Precio', 'img', 'link-img']; // img es la columna 3

function descargadorFalso() {
  const pedidos = [];
  const descargar = async (link) => {
    pedidos.push(link);
    if (link.endsWith('/caido')) throw new ErrorDeDescarga('el link respondió con un error (404)');
    return otraFoto(9);
  };
  return { pedidos, descargar };
}

function obtener(filas, { fotosExcel = [], descargar = descargadorFalso().descargar, encabezados = ENCABEZADOS, ...opciones } = {}) {
  const { productos, columnaImg, errores } = interpretarHoja([encabezados, ...filas]);
  assert.deepEqual(errores, [], 'la hoja de prueba no debería tener errores de formato');
  return obtenerFotos({ productos, columnaImg, fotosExcel, descargar, ...opciones });
}

test('la foto pegada gana sobre el link de la misma fila', async () => {
  const { pedidos, descargar } = descargadorFalso();
  const { fotosPorFila, errores } = await obtener([['A', 'Uno', 100, null, 'https://ejemplo.com/a.png']], {
    fotosExcel: [{ fila: 2, columna: 3, contenido: PNG }],
    descargar,
  });
  assert.deepEqual(errores, []);
  assert.deepEqual(fotosPorFila.get(2), [PNG]);
  assert.deepEqual(pedidos, []);
});

test('sin foto pegada se usa el link, una sola vez aunque se repita', async () => {
  const { pedidos, descargar } = descargadorFalso();
  const link = 'https://ejemplo.com/a.png';
  const { fotosPorFila, errores } = await obtener([['A', 'Uno', 100, null, link], ['B', 'Dos', 100, null, link]], { descargar });
  assert.deepEqual(errores, []);
  assert.deepEqual([fotosPorFila.get(2), fotosPorFila.get(3)], [[otraFoto(9)], [otraFoto(9)]]);
  assert.deepEqual(pedidos, [link]);
});

test('los links compartidos de Drive se descargan con su link de descarga', async () => {
  const { pedidos, descargar } = descargadorFalso();
  await obtener([['A', 'Uno', 100, null, 'https://drive.google.com/file/d/XYZ/view?usp=sharing']], { descargar });
  assert.deepEqual(pedidos, ['https://drive.google.com/uc?export=download&id=XYZ']);
});

test('foto fuera de la columna img es un problema; en una fila sin datos se ignora', async () => {
  const fuera = await obtener([['A', 'Uno', 100, null, null]], { fotosExcel: [{ fila: 2, columna: 1, contenido: PNG }] });
  assert.deepEqual(fuera.errores, [{ fila: 2, mensaje: 'Hay una foto pegada fuera de la columna "img"' }]);
  const sinDatos = await obtener([['A', 'Uno', 100, null, null]], { fotosExcel: [{ fila: 9, columna: 3, contenido: PNG }] });
  assert.deepEqual(sinDatos.errores, []);
  assert.equal(sinDatos.fotosPorFila.size, 0);
  const sinColumna = await obtener([['A', 'Uno', 100]], {
    encabezados: ['SKU', 'Nombre', 'Precio'],
    fotosExcel: [{ fila: 2, columna: 3, contenido: PNG }],
  });
  assert.deepEqual(sinColumna.errores, [{ fila: 2, mensaje: 'Hay una foto pegada fuera de la columna "img"' }]);
});

test('texto en img es un problema', async () => {
  const { errores } = await obtener([['A', 'Uno', 100, 'https://ejemplo.com/a.png', null]]);
  assert.deepEqual(errores, [{ fila: 2, mensaje: 'En "img" va la foto pegada. Los links van en "link-img"' }]);
});

test('una foto pegada que no es imagen o es muy pesada es un problema', async () => {
  const { errores, fotosPorFila } = await obtener([['A', 'Uno', 100, null, null], ['B', 'Dos', 100, null, null]], {
    fotosExcel: [
      { fila: 2, columna: 3, contenido: Buffer.from('GIF89a') },
      { fila: 3, columna: 3, contenido: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]) },
    ],
  });
  assert.deepEqual(errores, [
    { fila: 2, mensaje: 'La foto pegada en "img" no es JPG, PNG ni WEBP' },
    { fila: 3, mensaje: 'La foto pegada en "img" pesa más de 5 MB' },
  ]);
  assert.equal(fotosPorFila.size, 0);
});

test('un link que falla marca todas las filas que lo usan', async () => {
  const link = 'https://ejemplo.com/caido';
  const { errores } = await obtener([['A', 'Uno', 100, null, link], ['B', 'Dos', 100, null, link]]);
  const mensaje = 'Foto de "link-img": el link respondió con un error (404)';
  assert.deepEqual(errores, [{ fila: 2, mensaje }, { fila: 3, mensaje }]);
});

test('más de 200 links es un problema y no se descarga nada', async () => {
  const { pedidos, descargar } = descargadorFalso();
  const filas = Array.from({ length: 201 }, (_, i) => [`S${i}`, `Producto ${i}`, 100, null, `https://ejemplo.com/${i}.png`]);
  const { errores } = await obtener(filas, { descargar });
  assert.deepEqual(errores, [{ fila: 202, mensaje: 'La planilla tiene más de 200 links en "link-img". Subila en partes' }]);
  assert.deepEqual(pedidos, []);
});

test('asignarFotos junta las fotos de las filas del producto sin repetir', () => {
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Atributo 1', 'Valor 1'],
    ['R-S', 'Remera', 100, 'Talle', 'S'],
    ['R-M', 'Remera', 100, null, 'M'],
    ['R-L', 'Remera', 100, null, 'L'],
    ['G', 'Gorra', 100, null, null],
  ]);
  asignarFotos(productos, new Map([[2, [PNG]], [3, [otraFoto(1)]], [4, [PNG]]]));
  const [remera, gorra] = productos;
  assert.deepEqual(remera.fotos.map((f) => f.huella), [huellaDe(PNG), huellaDe(otraFoto(1))]);
  assert.deepEqual(remera.fotos[0].contenido, PNG);
  assert.deepEqual(gorra.fotos, []);
});

test('una foto pegada en img que no se pudo leer o pesa mucho es un problema, y no se usa el link', async () => {
  const { pedidos, descargar } = descargadorFalso();
  const { errores } = await obtener([['A', 'Uno', 100, null, 'https://ejemplo.com/a.png'], ['B', 'Dos', 100, null, null]], {
    fotosExcel: [
      { fila: 2, columna: 3, contenido: null, problema: 'ilegible' },
      { fila: 3, columna: 3, contenido: null, problema: 'pesada' },
    ],
    descargar,
  });
  assert.deepEqual(errores, [
    { fila: 2, mensaje: 'No pudimos leer la foto pegada en "img". Pegala de nuevo' },
    { fila: 3, mensaje: 'La foto pegada en "img" pesa más de 5 MB' },
  ]);
  assert.deepEqual(pedidos, []);
});

test('fuera de img, algo ilegible se ignora pero una foto pesada cuenta como foto fuera de lugar', async () => {
  const { errores } = await obtener([['A', 'Uno', 100, null, null], ['B', 'Dos', 100, null, null]], {
    fotosExcel: [
      { fila: 2, columna: 1, contenido: null, problema: 'ilegible' },
      { fila: 3, columna: 1, contenido: null, problema: 'pesada' },
    ],
  });
  assert.deepEqual(errores, [{ fila: 3, mensaje: 'Hay una foto pegada fuera de la columna "img"' }]);
});

test('si las descargas pasan el tiempo total, se cortan y se avisa en cada fila que quedó', async () => {
  const descargar = (link, { senal }) => {
    if (link.endsWith('/rapida')) return Promise.resolve(otraFoto(9));
    return new Promise((_, rechazar) =>
      senal.addEventListener('abort', () => rechazar(new ErrorDeDescarga('el link tardó demasiado en responder'))),
    );
  };
  const lentas = Array.from({ length: 6 }, (_, i) => [`L${i}`, `Lenta ${i}`, 100, null, `https://ejemplo.com/lenta${i}`]);
  const { fotosPorFila, errores } = await obtener([['R', 'Rapida', 100, null, 'https://ejemplo.com/rapida'], ...lentas], {
    descargar,
    tiempoTotalMs: 100,
  });
  assert.deepEqual(fotosPorFila.get(2), [otraFoto(9)]);
  const mensaje = 'Foto de "link-img": no llegamos a descargarla a tiempo. Subí la planilla en partes';
  assert.deepEqual(errores, [3, 4, 5, 6, 7, 8].map((fila) => ({ fila, mensaje })));
});

test('si las fotos suman más del tope, es un problema y se dejan de descargar', async () => {
  const MB = 1024 * 1024;
  const grande = (n) => Buffer.concat([PNG, Buffer.alloc(0.6 * MB, n)]);
  const mensaje = 'Las fotos de la planilla pesan más de 1 MB en total. Subila en partes';

  const pegadas = await obtener([['A', 'Uno', 100, null, null], ['B', 'Dos', 100, null, null]], {
    fotosExcel: [{ fila: 2, columna: 3, contenido: grande(1) }, { fila: 3, columna: 3, contenido: grande(2) }],
    topeBytes: MB,
  });
  assert.deepEqual(pegadas.errores, [{ fila: 3, mensaje }]);

  const pedidos = [];
  const descargar = async (link) => {
    pedidos.push(link);
    return grande(pedidos.length);
  };
  const filas = Array.from({ length: 8 }, (_, i) => [`S${i}`, `Producto ${i}`, 100, null, `https://ejemplo.com/${i}.png`]);
  const descargadas = await obtener(filas, { descargar, topeBytes: MB });
  assert.deepEqual(descargadas.errores.map((e) => e.mensaje), [mensaje]);
  assert.ok(pedidos.length < filas.length, `se dejó de descargar (se pidieron ${pedidos.length})`);
});
