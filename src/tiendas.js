import { enTransaccion } from './db.js';
import { generarClave, hashClave, verificarClave } from './claves.js';
import { slugificar } from './util/slug.js';
import { SUBDOMINIOS_RESERVADOS } from './util/dominios.js';

const LARGO_MAXIMO_SUBDOMINIO = 63;

export async function crearTienda(db, { nombre, email }) {
  const slug = slugificar(nombre ?? '');
  if (!slug) throw new Error('El nombre de la tienda tiene que tener letras o números');
  // El slug es el subdominio de la tienda, así que tiene que ser un subdominio válido.
  if (slug.length > LARGO_MAXIMO_SUBDOMINIO) {
    throw new Error(`El nombre de la tienda es muy largo para usarlo de link (máximo ${LARGO_MAXIMO_SUBDOMINIO} letras)`);
  }
  if (SUBDOMINIOS_RESERVADOS.has(slug)) throw new Error(`"${nombre}" no se puede usar como nombre de tienda`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) throw new Error(`Email inválido: ${email}`);
  if (await db.prepare('SELECT 1 FROM tiendas WHERE slug = ?').get(slug)) {
    throw new Error(`Ya existe una tienda con el nombre "${nombre}"`);
  }
  if (await db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = lower(?)').get(email)) {
    throw new Error(`Ya existe un usuario con el email ${email}`);
  }

  const clave = generarClave();
  const hash = await hashClave(clave);
  return enTransaccion(db, async (tx) => {
    const { rows } = await tx.prepare('INSERT INTO tiendas (nombre, slug) VALUES (?, ?) RETURNING id').run(nombre, slug);
    const tiendaId = rows[0].id;
    await tx.prepare('INSERT INTO usuarios (tienda_id, email, hash_clave) VALUES (?, ?, ?)').run(tiendaId, email, hash);
    return { tienda: { id: tiendaId, nombre, slug }, email, clave };
  });
}

export async function buscarTiendaPorSlug(db, slug) {
  return (await db.prepare('SELECT id, nombre, slug FROM tiendas WHERE slug = ?').get(slug)) ?? null;
}

export async function buscarTienda(db, id) {
  return (await db.prepare('SELECT id, nombre, slug FROM tiendas WHERE id = ?').get(id)) ?? null;
}

export function listarTiendas(db) {
  return db.prepare('SELECT id, nombre, slug FROM tiendas ORDER BY lower(nombre)').all();
}

// Cambia el nombre que se muestra. El slug (y por lo tanto el link de la tienda) no cambia.
export async function renombrarTienda(db, tiendaId, nombre) {
  const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio) return 'Escribí el nombre de la tienda';
  if (limpio.length > 80) return 'El nombre puede tener hasta 80 caracteres';
  await db.prepare('UPDATE tiendas SET nombre = ? WHERE id = ?').run(limpio, tiendaId);
  return null;
}

export const LARGO_MINIMO_CLAVE = 10;

// Devuelve null si se cambió, o { campo, mensaje } con el problema.
export async function cambiarClave(db, usuarioId, { actual, nueva, repetida }) {
  const usuario = await db.prepare('SELECT hash_clave AS hash FROM usuarios WHERE id = ?').get(usuarioId);
  if (!usuario || !(await verificarClave(String(actual ?? ''), usuario.hash))) {
    return { campo: 'claveActual', mensaje: 'La clave actual no es correcta' };
  }
  const clave = String(nueva ?? '');
  if (clave.length < LARGO_MINIMO_CLAVE) {
    return { campo: 'claveNueva', mensaje: `La clave nueva tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres` };
  }
  if (clave !== String(repetida ?? '')) return { campo: 'claveRepetida', mensaje: 'Las dos claves nuevas no coinciden' };
  await db.prepare('UPDATE usuarios SET hash_clave = ? WHERE id = ?').run(await hashClave(clave), usuarioId);
  return null;
}

let hashDeRelleno;

// Devuelve { id, tiendaId, email } o null.
export async function autenticar(db, email, clave) {
  const usuario = await db
    .prepare('SELECT id, tienda_id AS "tiendaId", email, hash_clave AS hash FROM usuarios WHERE lower(email) = lower(?)')
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
