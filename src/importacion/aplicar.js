// Cruza los productos interpretados del Excel con lo que ya hay en la base.
// Reglas:
//  - Un producto se reconoce por su nombre (slug) y una variante por su SKU, dentro de la tienda.
//  - Una celda vacía no cambia lo que ya estaba cargado.
//  - Lo que no está en el Excel no se toca.
//  - Si hay un solo error, no se guarda nada.

import { enTransaccion } from '../db.js';
import { slugificar } from '../util/slug.js';

export class ErrorDeImportacion extends Error {
  constructor(errores) {
    super(`La importación tiene ${errores.length} error(es)`);
    this.errores = errores;
  }
}

const describir = (atributos) => (atributos.length ? `(${atributos.join(', ')})` : '(ninguno)');
const mismosAtributos = (a, b) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());
const columnasAtributos = (lista) => [lista[0] ?? null, lista[1] ?? null, lista[2] ?? null];
const aEnteroSQL = (booleano) => (booleano === null ? null : Number(booleano));

function analizar(db, tiendaId, productos) {
  const buscarProducto = db.prepare(
    'SELECT id, nombre, atributo1, atributo2, atributo3 FROM productos WHERE tienda_id = ? AND slug = ?',
  );
  const contarVariantes = db.prepare('SELECT count(*) AS n FROM variantes WHERE producto_id = ?');
  const buscarVariante = db.prepare(
    `SELECT v.id, p.slug, p.nombre FROM variantes v JOIN productos p ON p.id = v.producto_id
     WHERE v.tienda_id = ? AND v.sku = ?`,
  );

  const errores = [];
  const resumen = { productosNuevos: 0, productosActualizados: 0, variantesNuevas: 0, variantesActualizadas: 0 };
  const plan = [];

  for (const producto of productos) {
    const existente = buscarProducto.get(tiendaId, producto.slug);
    const atributosExistentes = existente
      ? [existente.atributo1, existente.atributo2, existente.atributo3].filter((a) => a !== null)
      : [];

    if (
      existente &&
      producto.atributos.length > 0 &&
      contarVariantes.get(existente.id).n > 0 &&
      !mismosAtributos(atributosExistentes, producto.atributos)
    ) {
      errores.push({
        fila: producto.primeraFila,
        mensaje:
          `"${existente.nombre}" ya tiene los atributos ${describir(atributosExistentes)} ` +
          `y en el Excel figuran ${describir(producto.atributos)}`,
      });
    }
    if (existente) resumen.productosActualizados++;
    else resumen.productosNuevos++;

    const variantes = [];
    for (const variante of producto.variantes) {
      const varianteExistente = buscarVariante.get(tiendaId, variante.sku);
      if (varianteExistente && varianteExistente.slug !== producto.slug) {
        errores.push({
          fila: variante.fila,
          mensaje: `El SKU "${variante.sku}" ya es de otro producto: "${varianteExistente.nombre}"`,
        });
        continue;
      }
      if (varianteExistente) {
        resumen.variantesActualizadas++;
      } else {
        resumen.variantesNuevas++;
        if (variante.precioCentavos === null) {
          errores.push({ fila: variante.fila, mensaje: 'Falta el precio (es obligatorio para variantes nuevas)' });
        }
        if (producto.atributos.length === 0 && atributosExistentes.length > 0) {
          errores.push({
            fila: variante.fila,
            mensaje: `Para agregar una variante a "${existente.nombre}" completá sus atributos ${describir(atributosExistentes)} y los valores`,
          });
        }
      }
      variantes.push({ ...variante, id: varianteExistente?.id ?? null });
    }
    plan.push({ ...producto, id: existente?.id ?? null, variantes });
  }

  errores.sort((a, b) => a.fila - b.fila);
  return { resumen, errores, plan };
}

export function previsualizar(db, tiendaId, productos) {
  const { resumen, errores } = analizar(db, tiendaId, productos);
  return { resumen, errores };
}

function obtenerCategoria(db, tiendaId, ruta) {
  const buscar = db.prepare('SELECT id FROM categorias WHERE tienda_id = ? AND ifnull(padre_id, 0) = ? AND slug = ?');
  const crear = db.prepare('INSERT INTO categorias (tienda_id, padre_id, nombre, slug) VALUES (?, ?, ?, ?)');
  let padreId = null;
  for (const nombre of ruta) {
    const slug = slugificar(nombre);
    const existente = buscar.get(tiendaId, padreId ?? 0, slug);
    padreId = existente ? existente.id : Number(crear.run(tiendaId, padreId, nombre, slug).lastInsertRowid);
  }
  return padreId;
}

export function aplicarImportacion(db, tiendaId, productos) {
  return enTransaccion(db, () => {
    const { resumen, errores, plan } = analizar(db, tiendaId, productos);
    if (errores.length > 0) throw new ErrorDeImportacion(errores);

    const insertarProducto = db.prepare(
      `INSERT INTO productos (tienda_id, slug, nombre, descripcion, marca, atributo1, atributo2, atributo3, visible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const actualizarProducto = db.prepare(
      `UPDATE productos SET descripcion = coalesce(?, descripcion), marca = coalesce(?, marca),
       visible = coalesce(?, visible), actualizado_en = datetime('now') WHERE id = ?`,
    );
    const actualizarAtributos = db.prepare(
      'UPDATE productos SET atributo1 = ?, atributo2 = ?, atributo3 = ? WHERE id = ?',
    );
    const borrarCategorias = db.prepare('DELETE FROM producto_categorias WHERE producto_id = ?');
    const asignarCategoria = db.prepare(
      'INSERT OR IGNORE INTO producto_categorias (producto_id, categoria_id) VALUES (?, ?)',
    );
    const insertarVariante = db.prepare(
      `INSERT INTO variantes (tienda_id, producto_id, sku, valor1, valor2, valor3, precio_centavos,
       precio_promocional_centavos, stock, peso_kg, alto_cm, ancho_cm, profundidad_cm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const actualizarVariante = db.prepare(
      `UPDATE variantes SET precio_centavos = coalesce(?, precio_centavos),
       precio_promocional_centavos = coalesce(?, precio_promocional_centavos), stock = coalesce(?, stock),
       peso_kg = coalesce(?, peso_kg), alto_cm = coalesce(?, alto_cm), ancho_cm = coalesce(?, ancho_cm),
       profundidad_cm = coalesce(?, profundidad_cm), actualizado_en = datetime('now') WHERE id = ?`,
    );
    const actualizarValores = db.prepare('UPDATE variantes SET valor1 = ?, valor2 = ?, valor3 = ? WHERE id = ?');

    for (const producto of plan) {
      let productoId = producto.id;
      if (productoId === null) {
        productoId = Number(
          insertarProducto.run(
            tiendaId,
            producto.slug,
            producto.nombre,
            producto.descripcion ?? '',
            producto.marca ?? '',
            ...columnasAtributos(producto.atributos),
            aEnteroSQL(producto.visible) ?? 1,
          ).lastInsertRowid,
        );
      } else {
        actualizarProducto.run(producto.descripcion, producto.marca, aEnteroSQL(producto.visible), productoId);
        if (producto.atributos.length > 0) actualizarAtributos.run(...columnasAtributos(producto.atributos), productoId);
      }

      if (producto.categorias !== null) {
        borrarCategorias.run(productoId);
        for (const ruta of producto.categorias) asignarCategoria.run(productoId, obtenerCategoria(db, tiendaId, ruta));
      }

      for (const v of producto.variantes) {
        const medidas = [v.pesoKg, v.altoCm, v.anchoCm, v.profundidadCm];
        if (v.id === null) {
          insertarVariante.run(
            tiendaId,
            productoId,
            v.sku,
            ...columnasAtributos(v.valores),
            v.precioCentavos,
            v.precioPromocionalCentavos,
            v.stock ?? 0,
            ...medidas,
          );
        } else {
          actualizarVariante.run(v.precioCentavos, v.precioPromocionalCentavos, v.stock, ...medidas, v.id);
          if (v.valores.length > 0) actualizarValores.run(...columnasAtributos(v.valores), v.id);
        }
      }
    }
    return resumen;
  });
}
