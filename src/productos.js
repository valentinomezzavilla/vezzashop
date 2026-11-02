// Productos desde el panel: listado con búsqueda y filtros, alta y edición de a uno, fotos.
// La carga masiva por Excel está en importacion/; las dos usan las mismas tablas y reglas.
import { enTransaccion } from './db.js';
import { slugificar } from './util/slug.js';
import { ErrorDeValor, parsearPrecio, parsearEntero } from './importacion/valores.js';

export const MAX_ATRIBUTOS = 3;
export const MAX_FOTOS = 10;

export const FILTROS = {
  todos: { titulo: 'Todos', sql: '' },
  visibles: { titulo: 'Visibles', sql: 'AND p.visible = 1' },
  ocultos: { titulo: 'Ocultos', sql: 'AND p.visible = 0' },
  destacados: { titulo: 'Destacados', sql: 'AND p.destacado = 1' },
  'sin-stock': { titulo: 'Sin stock', sql: 'AND NOT exists (SELECT 1 FROM variantes s WHERE s.producto_id = p.id AND s.stock > 0)' },
  'sin-foto': { titulo: 'Sin foto', sql: 'AND NOT exists (SELECT 1 FROM producto_fotos f WHERE f.producto_id = p.id)' },
};
export const esFiltro = (valor) => typeof valor === 'string' && Object.hasOwn(FILTROS, valor);

// "50%_off" -> "50\%\_off" para buscarlo literal con LIKE ... ESCAPE '\'.
const escaparLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

const PRIMERA_FOTO = '(SELECT archivo FROM producto_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1)';

export function listarProductosAdmin(db, tiendaId, { busqueda = '', filtro = 'todos' } = {}) {
  const texto = busqueda.trim();
  const parametros = [tiendaId];
  let condicionBusqueda = '';
  if (texto) {
    condicionBusqueda = `AND (p.nombre LIKE ? ESCAPE '\\' OR p.marca LIKE ? ESCAPE '\\'
      OR exists (SELECT 1 FROM variantes b WHERE b.producto_id = p.id AND b.sku LIKE ? ESCAPE '\\'))`;
    const patron = `%${escaparLike(texto)}%`;
    parametros.push(patron, patron, patron);
  }
  return db
    .prepare(
      `SELECT p.id, p.slug, p.nombre, p.marca, p.visible, p.destacado, ${PRIMERA_FOTO} AS foto,
              count(v.id) AS variantes, ifnull(sum(v.stock), 0) AS stock,
              sum(v.stock = 0) AS variantesSinStock,
              min(v.precio_centavos) AS precioMinimo, max(v.precio_centavos) AS precioMaximo
       FROM productos p LEFT JOIN variantes v ON v.producto_id = p.id
       WHERE p.tienda_id = ? ${(esFiltro(filtro) ? FILTROS[filtro] : FILTROS.todos).sql} ${condicionBusqueda}
       GROUP BY p.id
       ORDER BY p.nombre COLLATE NOCASE`,
    )
    .all(...parametros);
}

export function contarPorFiltro(db, tiendaId) {
  const cuentas = {};
  for (const [clave, filtro] of Object.entries(FILTROS)) {
    cuentas[clave] = db.prepare(`SELECT count(*) AS n FROM productos p WHERE p.tienda_id = ? ${filtro.sql}`).get(tiendaId).n;
  }
  return cuentas;
}

// 1250000 -> "12.500"; 1250050 -> "12.500,50". Es lo que acepta parsearPrecio de vuelta.
export function precioParaEditar(centavos) {
  if (centavos === null || centavos === undefined) return '';
  const decimales = centavos % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: 2 }).format(centavos / 100);
}

export function leerProducto(db, tiendaId, id) {
  const p = db
    .prepare(
      `SELECT id, slug, nombre, descripcion, marca, visible, destacado, atributo1, atributo2, atributo3
       FROM productos WHERE id = ? AND tienda_id = ?`,
    )
    .get(id, tiendaId);
  if (!p) return null;
  const atributos = [p.atributo1, p.atributo2, p.atributo3].filter((a) => a !== null);
  return {
    id: p.id,
    slug: p.slug,
    nombre: p.nombre,
    descripcion: p.descripcion,
    marca: p.marca,
    visible: Boolean(p.visible),
    destacado: Boolean(p.destacado),
    atributos,
    variantes: db
      .prepare(
        `SELECT id, sku, valor1, valor2, valor3, precio_centavos AS precio, precio_promocional_centavos AS precioPromocional, stock
         FROM variantes WHERE producto_id = ? ORDER BY id`,
      )
      .all(p.id)
      .map((v) => ({
        id: v.id,
        sku: v.sku,
        valores: [v.valor1, v.valor2, v.valor3].slice(0, atributos.length),
        precio: v.precio,
        precioPromocional: v.precioPromocional,
        stock: v.stock,
      })),
    categoriaIds: db
      .prepare('SELECT categoria_id AS id FROM producto_categorias WHERE producto_id = ?')
      .all(p.id)
      .map((f) => f.id),
  };
}

// Lo que se muestra en el formulario: lo guardado, o lo que se mandó si hubo errores.
export function formularioDesdeProducto(producto) {
  return {
    nombre: producto?.nombre ?? '',
    descripcion: producto?.descripcion ?? '',
    marca: producto?.marca ?? '',
    visible: producto?.visible ?? true,
    destacado: producto?.destacado ?? false,
    atributos: producto?.atributos ?? [],
    categoriaIds: producto?.categoriaIds ?? [],
    variantes: (producto?.variantes ?? [{ id: null, sku: '', valores: [], precio: null, precioPromocional: null, stock: 0 }]).map(
      (v) => ({
        id: v.id ?? '',
        sku: v.sku,
        valores: v.valores,
        precio: precioParaEditar(v.precio),
        precioPromocional: precioParaEditar(v.precioPromocional),
        stock: String(v.stock ?? 0),
      }),
    ),
  };
}

const lista = (valor) => (valor === undefined ? [] : Array.isArray(valor) ? valor : [valor]);
const texto = (valor) => String(valor ?? '').trim();

// Interpreta y valida el formulario de un producto.
// Devuelve { datos, formulario, errores }: datos listos para guardar (si no hay errores), el formulario
// tal como vino (para volver a mostrarlo) y errores = { campo: mensaje, filas: { indice: [mensajes] } }.
export function validarProducto(db, tiendaId, productoId, campos) {
  const errores = { filas: {} };
  const errorFila = (i, mensaje) => (errores.filas[i] ??= []).push(mensaje);

  const nombre = texto(campos.nombre);
  const slug = slugificar(nombre);
  if (!nombre) errores.nombre = 'Escribí el nombre del producto';
  else if (nombre.length > 150) errores.nombre = 'Máximo 150 caracteres';
  else if (!slug) errores.nombre = 'El nombre tiene que tener al menos una letra o número';
  else {
    const otro = db.prepare('SELECT id FROM productos WHERE tienda_id = ? AND slug = ? AND id IS NOT ?').get(tiendaId, slug, productoId);
    if (otro) errores.nombre = 'Ya tenés otro producto con este nombre';
  }

  const descripcion = texto(campos.descripcion);
  if (descripcion.length > 5000) errores.descripcion = 'Máximo 5000 caracteres';
  const marca = texto(campos.marca);
  if (marca.length > 100) errores.marca = 'Máximo 100 caracteres';

  const atributosCrudos = Array.from({ length: MAX_ATRIBUTOS }, (_, n) => texto(campos[`atributo${n + 1}`]));
  const ultimo = atributosCrudos.findLastIndex((a) => a !== '');
  const atributos = atributosCrudos.slice(0, ultimo + 1);
  if (atributos.includes('')) errores.atributos = 'Completá las variantes en orden: primero la 1, después la 2';
  else if (new Set(atributos.map((a) => a.toLowerCase())).size !== atributos.length) {
    errores.atributos = 'Dos tipos de variante tienen el mismo nombre';
  } else if (atributos.some((a) => a.length > 40)) errores.atributos = 'Máximo 40 caracteres por nombre';

  // Las filas del formulario vienen como listas paralelas: sku[0], precio[0], ...
  const columnas = {
    id: lista(campos.varianteId),
    sku: lista(campos.sku),
    precio: lista(campos.precio),
    precioPromocional: lista(campos.precioPromocional),
    stock: lista(campos.stock),
    valores: Array.from({ length: MAX_ATRIBUTOS }, (_, n) => lista(campos[`valor${n + 1}`])),
  };
  const filasFormulario = columnas.sku.map((_, i) => ({
    id: texto(columnas.id[i]),
    sku: texto(columnas.sku[i]),
    valores: atributos.map((_, n) => texto(columnas.valores[n][i])),
    precio: texto(columnas.precio[i]),
    precioPromocional: texto(columnas.precioPromocional[i]),
    stock: texto(columnas.stock[i]),
  }));
  const vacia = (f) => !f.sku && !f.precio && !f.precioPromocional && (!f.stock || f.stock === '0') && f.valores.every((v) => !v);

  const idsPropios = new Set(
    productoId === null ? [] : db.prepare('SELECT id FROM variantes WHERE producto_id = ?').all(productoId).map((f) => f.id),
  );
  const buscarSku = db.prepare('SELECT producto_id AS productoId FROM variantes WHERE tienda_id = ? AND sku = ?');
  const skus = new Map();
  const combinaciones = new Map();
  const variantes = [];

  filasFormulario.forEach((fila, i) => {
    if (vacia(fila)) return;
    const variante = { id: null, sku: fila.sku, valores: fila.valores, precio: null, precioPromocional: null, stock: 0 };

    if (fila.id) {
      const id = Number(fila.id);
      if (!idsPropios.has(id)) return errorFila(i, 'Esta variante no es de este producto. Recargá la página');
      variante.id = id;
    }

    if (!fila.sku) errorFila(i, 'Falta el SKU');
    else if (fila.sku.length > 64) errorFila(i, 'El SKU puede tener hasta 64 caracteres');
    else if (skus.has(fila.sku.toLowerCase())) errorFila(i, `El SKU "${fila.sku}" está repetido`);
    else {
      skus.set(fila.sku.toLowerCase(), i);
      const duenio = buscarSku.get(tiendaId, fila.sku);
      if (duenio && duenio.productoId !== productoId) errorFila(i, `El SKU "${fila.sku}" ya lo usa otro producto`);
    }

    try {
      variante.precio = parsearPrecio(fila.precio);
      if (variante.precio === null) errorFila(i, 'Falta el precio');
      else if (variante.precio === 0) errorFila(i, 'El precio tiene que ser mayor a 0');
    } catch (error) {
      if (!(error instanceof ErrorDeValor)) throw error;
      errorFila(i, error.message);
    }
    try {
      variante.precioPromocional = parsearPrecio(fila.precioPromocional);
      if (variante.precioPromocional !== null && variante.precio !== null && variante.precioPromocional >= variante.precio) {
        errorFila(i, 'El precio de oferta tiene que ser menor que el precio');
      }
      if (variante.precioPromocional === 0) errorFila(i, 'El precio de oferta tiene que ser mayor a 0');
    } catch (error) {
      if (!(error instanceof ErrorDeValor)) throw error;
      errorFila(i, `Oferta: ${error.message}`);
    }
    try {
      variante.stock = parsearEntero(fila.stock) ?? 0;
    } catch (error) {
      if (!(error instanceof ErrorDeValor)) throw error;
      errorFila(i, `Stock: ${error.message}`);
    }

    atributos.forEach((atributo, n) => {
      if (!fila.valores[n]) errorFila(i, `Falta ${atributo.toLowerCase()}`);
      else if (fila.valores[n].length > 60) errorFila(i, `${atributo}: máximo 60 caracteres`);
    });
    if (atributos.length && fila.valores.every(Boolean)) {
      const clave = fila.valores.map((v) => v.toLowerCase()).join('\u0000');
      if (combinaciones.has(clave)) errorFila(i, `${fila.valores.join(' / ')} está repetida`);
      else combinaciones.set(clave, i);
    }
    variantes.push(variante);
  });

  if (variantes.length === 0) errores.variantes = 'Cargá al menos una variante con su SKU y su precio';
  else if (atributos.length === 0 && variantes.length > 1) {
    errores.variantes = 'Para tener varias variantes, poné qué cambia entre ellas (por ejemplo Talle o Color)';
  }

  const categoriasValidas = new Set(db.prepare('SELECT id FROM categorias WHERE tienda_id = ?').all(tiendaId).map((c) => c.id));
  const categoriaIds = [...new Set(lista(campos.categorias).map(Number))].filter((id) => categoriasValidas.has(id));

  const formulario = {
    nombre,
    descripcion,
    marca,
    visible: Boolean(campos.visible),
    destacado: Boolean(campos.destacado),
    atributos,
    categoriaIds,
    variantes: filasFormulario.length ? filasFormulario : formularioDesdeProducto(null).variantes,
  };
  if (Object.keys(errores.filas).length === 0) delete errores.filas;
  return {
    datos: { slug, nombre, descripcion, marca, visible: formulario.visible, destacado: formulario.destacado, atributos, categoriaIds, variantes },
    formulario,
    errores,
  };
}

const atributosSQL = (atributos) => Array.from({ length: MAX_ATRIBUTOS }, (_, n) => atributos[n] ?? null);

// Guarda un producto ya validado. Devuelve su id.
export function guardarProducto(db, tiendaId, productoId, datos) {
  return enTransaccion(db, () => {
    const columnas = [datos.slug, datos.nombre, datos.descripcion, datos.marca, ...atributosSQL(datos.atributos), Number(datos.visible), Number(datos.destacado)];
    let id = productoId;
    if (id === null) {
      id = Number(
        db
          .prepare(
            `INSERT INTO productos (slug, nombre, descripcion, marca, atributo1, atributo2, atributo3, visible, destacado, tienda_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(...columnas, tiendaId).lastInsertRowid,
      );
    } else {
      db.prepare(
        `UPDATE productos SET slug = ?, nombre = ?, descripcion = ?, marca = ?, atributo1 = ?, atributo2 = ?, atributo3 = ?,
         visible = ?, destacado = ?, actualizado_en = datetime('now') WHERE id = ? AND tienda_id = ?`,
      ).run(...columnas, id, tiendaId);
    }

    const conservadas = new Set(datos.variantes.filter((v) => v.id !== null).map((v) => v.id));
    for (const { id: varianteId } of db.prepare('SELECT id FROM variantes WHERE producto_id = ?').all(id)) {
      if (!conservadas.has(varianteId)) db.prepare('DELETE FROM variantes WHERE id = ?').run(varianteId);
    }
    // Primero un SKU provisorio en las que se actualizan, por si dos variantes intercambian sus SKU.
    const provisorio = db.prepare("UPDATE variantes SET sku = '~' || id WHERE id = ?");
    for (const varianteId of conservadas) provisorio.run(varianteId);

    const actualizar = db.prepare(
      `UPDATE variantes SET sku = ?, valor1 = ?, valor2 = ?, valor3 = ?, precio_centavos = ?, precio_promocional_centavos = ?,
       stock = ?, actualizado_en = datetime('now') WHERE id = ?`,
    );
    const insertar = db.prepare(
      `INSERT INTO variantes (tienda_id, producto_id, sku, valor1, valor2, valor3, precio_centavos, precio_promocional_centavos, stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const v of datos.variantes) {
      const valores = [...atributosSQL(v.valores)];
      if (v.id === null) insertar.run(tiendaId, id, v.sku, ...valores, v.precio, v.precioPromocional, v.stock);
      else actualizar.run(v.sku, ...valores, v.precio, v.precioPromocional, v.stock, v.id);
    }

    db.prepare('DELETE FROM producto_categorias WHERE producto_id = ?').run(id);
    const asignar = db.prepare('INSERT INTO producto_categorias (producto_id, categoria_id) VALUES (?, ?)');
    for (const categoriaId of datos.categoriaIds) asignar.run(id, categoriaId);
    return id;
  });
}

// Borra el producto con sus variantes y fotos. Devuelve los archivos de las fotos para borrarlos, o null si no es de la tienda.
export function borrarProducto(db, tiendaId, id) {
  return enTransaccion(db, () => {
    const producto = db.prepare('SELECT id FROM productos WHERE id = ? AND tienda_id = ?').get(id, tiendaId);
    if (!producto) return null;
    const fotos = db.prepare('SELECT archivo FROM producto_fotos WHERE producto_id = ?').all(id).map((f) => f.archivo);
    db.prepare('DELETE FROM productos WHERE id = ?').run(id);
    return fotos;
  });
}

// Cambia visible o destacado. Devuelve false si el producto no es de la tienda.
export function cambiarMarca(db, tiendaId, id, campo, valor) {
  if (campo !== 'visible' && campo !== 'destacado') throw new Error(`Campo inválido: ${campo}`);
  return db.prepare(`UPDATE productos SET ${campo} = ? WHERE id = ? AND tienda_id = ?`).run(Number(valor), id, tiendaId).changes > 0;
}

export function listarFotos(db, tiendaId, productoId) {
  return db
    .prepare('SELECT id, archivo FROM producto_fotos WHERE producto_id = ? AND tienda_id = ? ORDER BY orden, id')
    .all(productoId, tiendaId);
}

export function agregarFoto(db, tiendaId, productoId, archivo) {
  db.prepare(
    `INSERT INTO producto_fotos (tienda_id, producto_id, archivo, orden)
     VALUES (?, ?, ?, (SELECT ifnull(max(orden), 0) + 1 FROM producto_fotos WHERE producto_id = ?))`,
  ).run(tiendaId, productoId, archivo, productoId);
}

// Mueve una foto un lugar (-1 antes, +1 después) o al principio ('principal').
export function moverFoto(db, tiendaId, productoId, fotoId, movimiento) {
  enTransaccion(db, () => {
    const fotos = listarFotos(db, tiendaId, productoId);
    const i = fotos.findIndex((f) => f.id === fotoId);
    if (i === -1) return;
    if (movimiento === 'principal') fotos.unshift(...fotos.splice(i, 1));
    else {
      const j = i + movimiento;
      if (j < 0 || j >= fotos.length) return;
      [fotos[i], fotos[j]] = [fotos[j], fotos[i]];
    }
    const actualizar = db.prepare('UPDATE producto_fotos SET orden = ? WHERE id = ?');
    fotos.forEach((foto, n) => actualizar.run(n + 1, foto.id));
  });
}

// Devuelve el archivo de la foto borrada, o null si no es de este producto.
export function borrarFoto(db, tiendaId, productoId, fotoId) {
  return (
    db
      .prepare('DELETE FROM producto_fotos WHERE id = ? AND producto_id = ? AND tienda_id = ? RETURNING archivo')
      .get(fotoId, productoId, tiendaId)?.archivo ?? null
  );
}
