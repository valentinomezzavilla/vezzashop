// Convierte la hoja del Excel (filas como arrays) en productos con variantes.
// Cada fila es una variante; las filas con el mismo nombre son el mismo producto.
// No toca la base de datos: lo que depende de lo ya cargado se valida en aplicar.js.

import { slugificar } from '../util/slug.js';
import {
  ErrorDeValor,
  textoCelda,
  parsearPrecio,
  parsearDecimal,
  parsearEntero,
  parsearSiNo,
} from './valores.js';

export const COLUMNAS = [
  { clave: 'sku', titulo: 'SKU', obligatoria: true },
  { clave: 'nombre', titulo: 'Nombre', obligatoria: true },
  { clave: 'descripcion', titulo: 'Descripción' },
  { clave: 'categorias', titulo: 'Categorías', alias: ['categoria'] },
  { clave: 'marca', titulo: 'Marca' },
  { clave: 'precio', titulo: 'Precio' },
  { clave: 'precioPromocional', titulo: 'Precio promocional', alias: ['precio oferta'] },
  { clave: 'stock', titulo: 'Stock' },
  { clave: 'atributo1', titulo: 'Atributo 1' },
  { clave: 'valor1', titulo: 'Valor 1' },
  { clave: 'atributo2', titulo: 'Atributo 2' },
  { clave: 'valor2', titulo: 'Valor 2' },
  { clave: 'atributo3', titulo: 'Atributo 3' },
  { clave: 'valor3', titulo: 'Valor 3' },
  { clave: 'pesoKg', titulo: 'Peso (kg)', alias: ['peso'] },
  { clave: 'altoCm', titulo: 'Alto (cm)', alias: ['alto'] },
  { clave: 'anchoCm', titulo: 'Ancho (cm)', alias: ['ancho'] },
  { clave: 'profundidadCm', titulo: 'Profundidad (cm)', alias: ['profundidad'] },
  { clave: 'visible', titulo: 'Visible' },
];

const MAX_ATRIBUTOS = 3;

function normalizarEncabezado(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// { clave: índice de columna }
function mapearEncabezados(encabezados) {
  const porNombre = new Map();
  for (const col of COLUMNAS) {
    for (const nombre of [col.titulo, ...(col.alias ?? [])]) porNombre.set(normalizarEncabezado(nombre), col.clave);
  }
  const indice = {};
  encabezados.forEach((encabezado, i) => {
    const clave = porNombre.get(normalizarEncabezado(encabezado));
    if (clave && !(clave in indice)) indice[clave] = i;
  });
  return indice;
}

// "Ropa > Remeras, Ofertas" -> [['Ropa', 'Remeras'], ['Ofertas']]
function parsearCategorias(valor) {
  const texto = textoCelda(valor);
  if (texto === null) return null;
  return texto
    .split(',')
    .map((ruta) => ruta.split('>').map((parte) => parte.trim()).filter(Boolean))
    .filter((ruta) => ruta.length > 0);
}

export function interpretarHoja(filas) {
  const [encabezados = [], ...datos] = filas;
  const indice = mapearEncabezados(encabezados);

  const faltantes = COLUMNAS.filter((c) => c.obligatoria && !(c.clave in indice));
  if (faltantes.length > 0) {
    return {
      productos: [],
      errores: faltantes.map((c) => ({ fila: 1, mensaje: `Falta la columna "${c.titulo}"` })),
    };
  }

  const errores = [];
  const productos = new Map(); // slug -> producto
  const filaPorSku = new Map();

  datos.forEach((celdas, i) => {
    const fila = i + 2; // la fila 1 son los encabezados
    if (celdas.every((v) => textoCelda(v) === null)) return;

    const error = (mensaje) => errores.push({ fila, mensaje });
    const celda = (clave) => (clave in indice ? celdas[indice[clave]] : null);
    const leer = (clave, parsear) => {
      try {
        return parsear(celda(clave));
      } catch (e) {
        if (!(e instanceof ErrorDeValor)) throw e;
        error(e.message);
        return null;
      }
    };

    const sku = textoCelda(celda('sku'));
    const nombre = textoCelda(celda('nombre'));
    if (!sku) error('Falta el SKU');
    if (!nombre) error('Falta el nombre');

    const precioCentavos = leer('precio', parsearPrecio);
    const precioPromocionalCentavos = leer('precioPromocional', parsearPrecio);
    if (precioCentavos === 0) error('El precio tiene que ser mayor a 0');
    if (precioPromocionalCentavos !== null && precioCentavos !== null && precioPromocionalCentavos >= precioCentavos) {
      error('El precio promocional tiene que ser menor que el precio');
    }
    const variante = {
      fila,
      sku,
      valores: [],
      precioCentavos,
      precioPromocionalCentavos,
      stock: leer('stock', parsearEntero),
      pesoKg: leer('pesoKg', parsearDecimal),
      altoCm: leer('altoCm', parsearDecimal),
      anchoCm: leer('anchoCm', parsearDecimal),
      profundidadCm: leer('profundidadCm', parsearDecimal),
    };

    if (sku) {
      if (filaPorSku.has(sku)) error(`El SKU "${sku}" está repetido (ya aparece en la fila ${filaPorSku.get(sku)})`);
      else filaPorSku.set(sku, fila);
    }
    if (!sku || !nombre) return;

    const slug = slugificar(nombre);
    if (!slug) {
      error(`El nombre "${nombre}" tiene que tener al menos una letra o número`);
      return;
    }

    const atributosFila = [];
    for (let n = 1; n <= MAX_ATRIBUTOS; n++) atributosFila.push(textoCelda(celda(`atributo${n}`)));

    let producto = productos.get(slug);
    if (!producto) {
      const ultimo = atributosFila.findLastIndex((a) => a !== null);
      const atributos = atributosFila.slice(0, ultimo + 1);
      if (atributos.includes(null)) error('Completá los atributos en orden: Atributo 1, después Atributo 2, después Atributo 3');
      producto = {
        slug,
        nombre,
        descripcion: textoCelda(celda('descripcion')),
        marca: textoCelda(celda('marca')),
        categorias: parsearCategorias(celda('categorias')),
        visible: leer('visible', parsearSiNo),
        atributos,
        primeraFila: fila,
        variantes: [],
      };
      productos.set(slug, producto);
    } else {
      atributosFila.forEach((atributo, n) => {
        if (atributo !== null && atributo !== (producto.atributos[n] ?? null)) {
          error(
            `"Atributo ${n + 1}" dice "${atributo}" pero en la fila ${producto.primeraFila} ` +
              `dice "${producto.atributos[n] ?? '(vacío)'}"`,
          );
        }
      });
    }

    for (let n = 0; n < MAX_ATRIBUTOS; n++) {
      const valor = textoCelda(celda(`valor${n + 1}`));
      const atributo = producto.atributos[n];
      if (atributo && valor === null) error(`Falta "Valor ${n + 1}" (${atributo})`);
      if (!atributo && valor !== null) {
        error(`Hay un valor en "Valor ${n + 1}" pero el producto no tiene "Atributo ${n + 1}"`);
      }
      if (atributo) variante.valores.push(valor);
    }

    producto.variantes.push(variante);
  });

  for (const producto of productos.values()) {
    if (producto.atributos.length === 0) {
      if (producto.variantes.length > 1) {
        errores.push({
          fila: producto.primeraFila,
          mensaje:
            `"${producto.nombre}" aparece en varias filas pero no tiene atributos. ` +
            'Completá "Atributo 1" y "Valor 1" (por ejemplo Talle / M) o usá nombres distintos',
        });
      }
      continue;
    }
    const filaPorCombinacion = new Map();
    for (const variante of producto.variantes) {
      if (variante.valores.includes(null)) continue;
      const clave = variante.valores.map((v) => v.toLowerCase()).join('\u0000');
      if (filaPorCombinacion.has(clave)) {
        errores.push({
          fila: variante.fila,
          mensaje: `Repite la combinación "${variante.valores.join(' / ')}" de la fila ${filaPorCombinacion.get(clave)}`,
        });
      } else {
        filaPorCombinacion.set(clave, variante.fila);
      }
    }
  }

  errores.sort((a, b) => a.fila - b.fila);
  return { productos: [...productos.values()], errores };
}
