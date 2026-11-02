import { enTransaccion } from './db.js';
import { generarClave, hashClave, verificarClave } from './claves.js';
import { slugificar } from './util/slug.js';

export async function crearTienda(db, { nombre, email }) {
  const slug = slugificar(nombre ?? '');
  if (!slug) throw new Error('El nombre de la tienda tiene que tener letras o números');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) throw new Error(`Email inválido: ${email}`);
  if (db.prepare('SELECT 1 FROM tiendas WHERE slug = ?').get(slug)) {
    throw new Error(`Ya existe una tienda con el nombre "${nombre}"`);
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    throw new Error(`Ya existe un usuario con el email ${email}`);
  }

  const clave = generarClave();
  const hash = await hashClave(clave);
  return enTransaccion(db, () => {
    const { lastInsertRowid: tiendaId } = db
      .prepare('INSERT INTO tiendas (nombre, slug) VALUES (?, ?)')
      .run(nombre, slug);
    db.prepare('INSERT INTO usuarios (tienda_id, email, hash_clave) VALUES (?, ?, ?)').run(tiendaId, email, hash);
    return { tienda: { id: Number(tiendaId), nombre, slug }, email, clave };
  });
}

let hashDeRelleno;

// Devuelve { id, tiendaId, email } o null.
export async function autenticar(db, email, clave) {
  const usuario = db
    .prepare('SELECT id, tienda_id AS tiendaId, email, hash_clave AS hash FROM usuarios WHERE email = ?')
    .get(String(email ?? '').trim());
  if (!usuario) {
    // Mismo costo que una clave incorrecta, para no revelar qué emails existen.
    hashDeRelleno ??= await hashClave(generarClave());
    await verificarClave(String(clave ?? ''), hashDeRelleno);
    return null;
  }
  if (!(await verificarClave(String(clave ?? ''), usuario.hash))) return null;
  return { id: usuario.id, tiendaId: usuario.tiendaId, email: usuario.email };
}
