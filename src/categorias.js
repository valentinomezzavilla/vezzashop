// Categorías desde el panel: árbol con cantidad de productos, alta, edición (nombre y categoría padre) y borrado.
import { enTransaccion } from './db.js';
import { slugificar } from './util/slug.js';

// Árbol completo (incluye las vacías). Cada nodo: { id, nombre, slug, padreId, productos, nivel, hijas }.
export function arbolCategoriasAdmin(db, tiendaId) {
  const filas = db
    .prepare(
      `SELECT c.id, c.nombre, c.slug, c.padre_id AS padreId,
              (SELECT count(*) FROM producto_categorias pc WHERE pc.categoria_id = c.id) AS productos
       FROM categorias c WHERE c.tienda_id = ? ORDER BY c.nombre COLLATE NOCASE`,
    )
    .all(tiendaId);
  const hijasDe = Map.groupBy(filas, (c) => c.padreId ?? 0);
  const armar = (padreId, nivel) => (hijasDe.get(padreId) ?? []).map((c) => ({ ...c, nivel, hijas: armar(c.id, nivel + 1) }));
  return armar(0, 0);
}

// El árbol aplanado en orden, para listas y <select>: [{ id, nombre, nivel, ... }].
export function aplanar(arbol) {
  return arbol.flatMap((c) => [c, ...aplanar(c.hijas)]);
}

function descendientes(db, id) {
  return db
    .prepare(
      `WITH RECURSIVE arbol(id) AS (SELECT ? UNION ALL SELECT c.id FROM categorias c JOIN arbol a ON c.padre_id = a.id)
       SELECT id FROM arbol`,
    )
    .all(id)
    .map((f) => f.id);
}

// Valida nombre y padre. Devuelve { datos: { nombre, slug, padreId }, error }.
export function validarCategoria(db, tiendaId, id, campos) {
  const nombre = String(campos.nombre ?? '').trim().replace(/\s+/g, ' ');
  const slug = slugificar(nombre);
  const padreId = campos.padreId ? Number(campos.padreId) : null;
  const datos = { nombre, slug, padreId };

  if (!nombre) return { datos, error: 'Escribí el nombre de la categoría' };
  if (nombre.length > 60) return { datos, error: 'El nombre puede tener hasta 60 caracteres' };
  if (!slug) return { datos, error: 'El nombre tiene que tener al menos una letra o número' };
  if (padreId !== null) {
    const padre = db.prepare('SELECT id FROM categorias WHERE id = ? AND tienda_id = ?').get(padreId, tiendaId);
    if (!padre) return { datos, error: 'La categoría de arriba no existe' };
    if (id !== null && descendientes(db, id).includes(padreId)) {
      return { datos, error: 'Una categoría no puede ir adentro de sí misma ni de una de sus subcategorías' };
    }
  }
  const repetida = db
    .prepare('SELECT id FROM categorias WHERE tienda_id = ? AND ifnull(padre_id, 0) = ? AND slug = ? AND id IS NOT ?')
    .get(tiendaId, padreId ?? 0, slug, id);
  if (repetida) return { datos, error: `Ya hay una categoría "${nombre}" en ese lugar` };
  return { datos, error: null };
}

export function crearCategoria(db, tiendaId, { nombre, slug, padreId }) {
  return Number(
    db.prepare('INSERT INTO categorias (tienda_id, padre_id, nombre, slug) VALUES (?, ?, ?, ?)').run(tiendaId, padreId, nombre, slug)
      .lastInsertRowid,
  );
}

export function editarCategoria(db, tiendaId, id, { nombre, slug, padreId }) {
  return (
    db.prepare('UPDATE categorias SET nombre = ?, slug = ?, padre_id = ? WHERE id = ? AND tienda_id = ?').run(nombre, slug, padreId, id, tiendaId)
      .changes > 0
  );
}

// Borra la categoría y sus subcategorías. Los productos no se borran: solo dejan de estar en ellas.
// Devuelve cuántas categorías se borraron (0 si no es de la tienda).
export function borrarCategoria(db, tiendaId, id) {
  return enTransaccion(db, () => {
    if (!db.prepare('SELECT 1 FROM categorias WHERE id = ? AND tienda_id = ?').get(id, tiendaId)) return 0;
    const ids = descendientes(db, id).reverse(); // primero las más profundas, por la referencia al padre
    const borrar = db.prepare('DELETE FROM categorias WHERE id = ?');
    for (const categoriaId of ids) borrar.run(categoriaId);
    return ids.length;
  });
}
