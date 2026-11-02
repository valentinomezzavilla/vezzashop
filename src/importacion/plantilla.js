import writeExcelFile from 'write-excel-file/node';
import { COLUMNAS } from './interpretar.js';

const INSTRUCCIONES = [
  'Cómo completar la planilla de productos',
  '',
  'Cada fila es un producto, o una variante de un producto (por ejemplo, un talle o un color).',
  'Las filas con el mismo Nombre se juntan en un solo producto: cada una es una variante.',
  'Las columnas amarillas son obligatorias. Las demás podés dejarlas vacías.',
  '',
  'SKU: código único de cada variante (por ejemplo REM-NEGRA-M). Con el SKU reconocemos la variante si volvés a subir la planilla.',
  'Precio: sin el signo $. Sirve 12500, 12.500 o 12.500,50. Es obligatorio para productos nuevos.',
  'Precio promocional: precio de oferta, menor al precio. Opcional.',
  'Stock: número entero. Si lo dejás vacío en un producto nuevo, queda en 0.',
  'Atributo 1, 2 y 3 / Valor 1, 2 y 3: para las variantes. Ejemplo: Atributo 1 = Talle, Valor 1 = M.',
  '   Los nombres de los atributos alcanza con escribirlos en la primera fila de cada producto.',
  'Categorías: usá > para subcategorías y coma para poner varias. Ejemplo: Ropa > Remeras, Ofertas',
  'Visible: Sí o No. Si lo dejás vacío, el producto se muestra en la tienda.',
  'Peso y medidas: en kilos y centímetros. Los vas a necesitar para calcular envíos.',
  '',
  'Si volvés a subir la planilla:',
  ' - Los productos que ya existen se actualizan (se reconocen por SKU y por nombre).',
  ' - Las celdas vacías no borran nada de lo que ya estaba cargado.',
  ' - Los productos que no estén en la planilla quedan como están.',
  ' - Para actualizar solo el stock alcanza con las columnas SKU, Nombre y Stock.',
  '',
  'Ejemplo (fila por fila):',
  'REM-NEG-S | Remera Lisa | Algodón peinado | Ropa > Remeras | 12500 | 15 | Talle | S | Color | Negro',
  'REM-NEG-M | Remera Lisa |                 |                | 12500 | 8  |       | M |       | Negro',
  'TAZA-01   | Taza Cerámica |               | Cocina         | 4500  | 30 |       |   |       |',
];

export function generarPlantilla() {
  const encabezados = COLUMNAS.map((columna) => ({
    value: columna.titulo,
    fontWeight: 'bold',
    backgroundColor: columna.obligatoria ? '#FFE699' : '#DDEBF7',
  }));
  return writeExcelFile([
    {
      sheet: 'Productos',
      data: [encabezados],
      columns: COLUMNAS.map((columna) => ({ width: columna.clave === 'descripcion' ? 40 : 18 })),
      stickyRowsCount: 1,
    },
    {
      sheet: 'Instrucciones',
      data: INSTRUCCIONES.map((linea, i) => [i === 0 ? { value: linea, fontWeight: 'bold' } : linea]),
      columns: [{ width: 120 }],
    },
  ]).toBuffer();
}
