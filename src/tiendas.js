import { enTransaccion } from './db.js';
import { generarClave, hashClave, verificarClave } from './claves.js';
import { slugificar } from './util/slug.js';
import { SUBDOMINIOS_RESERVADOS } from './util/dominios.js';
import { estadoEfectivo } from './estado.js';

const LARGO_MAXIMO_SUBDOMINIO = 63;

// Valida el link (subdominio) que se quiere para una tienda. `texto` puede venir con tildes, espacios o mayúsculas (se arma
// el slug como siempre) o pegado como "https://mitienda.dominio.com". `tiendaId` es la tienda que lo pide: su propio link
// actual y los que tuvo antes no cuentan como ocupados. Devuelve { slug } o { error }.
export async function validarLink(db, texto, { tiendaId = null } = {}) {
  const pegado = String(texto ?? '').trim().match(/^https?:\/\/([^./:\s]+)/i);
  const slug = slugificar(pegado ? pegado[1] : texto ?? '');
  if (!slug) return { error: 'Escribí el link con letras, números o guiones' };
  if (slug.length > LARGO_MAXIMO_SUBDOMINIO) return { error: `El link es muy largo (máximo ${LARGO_MAXIMO_SUBDOMINIO} letras)` };
  if (SUBDOMINIOS_RESERVADOS.has(slug)) return { error: `"${slug}" no se puede usar: está reservado para el sistema` };
  const propia = tiendaId ?? -1;
  if (await db.prepare('SELECT 1 FROM tiendas WHERE slug = ? AND id <> ?').get(slug, propia)) return { error: 'Ese link ya lo usa otra tienda' };
  if (await db.prepare('SELECT 1 FROM tienda_enlaces_anteriores WHERE slug = ? AND tienda_id <> ?').get(slug, propia)) {
    return { error: 'Ese link era de otra tienda y todavía redirige a ella. Para usarlo, primero soltalo desde la ficha de esa tienda.' };
  }
  return { slug };
}

// planId y venceEn son opcionales: una tienda sin plan no tiene topes, y sin vencimiento no vence.
// `slug` también: si no se pasa, el link sale del nombre ("Ufo Ambos" -> ufo-ambos).
// `clave`: la que eligió el dueño; si no se pasa, se genera una y se devuelve para mostrarla una sola vez.
// `titular`: { nombre, apellido } de quien usa la cuenta (opcional).
// `tx`: para crearla dentro de una transacción que ya está abierta (por ejemplo, al crear una cuenta ya paga).
export async function crearTienda(db, { nombre, email, planId = null, venceEn = null, slug: enlace = '', clave: claveElegida = null, titular = null }, { tx = null } = {}) {
  const lector = tx ?? db;
  const conLinkElegido = String(enlace ?? '').trim() !== '';
  let slug;
  if (conLinkElegido) {
    const link = await validarLink(lector, enlace);
    if (link.error) throw new Error(link.error);
    slug = link.slug;
  } else {
    slug = slugificar(nombre ?? '');
    if (!slug) throw new Error('El nombre de la tienda tiene que tener letras o números');
    // El slug es el subdominio de la tienda, así que tiene que ser un subdominio válido.
    if (slug.length > LARGO_MAXIMO_SUBDOMINIO) {
      throw new Error(`El nombre de la tienda es muy largo para usarlo de link (máximo ${LARGO_MAXIMO_SUBDOMINIO} letras)`);
    }
    if (SUBDOMINIOS_RESERVADOS.has(slug)) throw new Error(`"${nombre}" no se puede usar como nombre de tienda`);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) throw new Error(`Email inválido: ${email}`);
  if (await lector.prepare('SELECT 1 FROM tiendas WHERE slug = ?').get(slug)) {
    throw new Error(`Ya existe una tienda con el nombre "${nombre}"`);
  }
  if (await lector.prepare('SELECT 1 FROM tienda_enlaces_anteriores WHERE slug = ?').get(slug)) {
    throw new Error(`El link "${slug}" era de otra tienda y todavía redirige a ella`);
  }
  if (await lector.prepare('SELECT 1 FROM usuarios WHERE lower(email) = lower(?)').get(email)) {
    throw new Error(`Ya existe un usuario con el email ${email}`);
  }

  if (planId !== null && !(await lector.prepare('SELECT 1 FROM planes WHERE id = ?').get(planId))) throw new Error('El plan elegido no existe');
  if (claveElegida !== null && String(claveElegida).length < LARGO_MINIMO_CLAVE) {
    throw new Error(`La clave tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres`);
  }

  const clave = claveElegida ?? generarClave();
  const hash = await hashClave(clave);
  const insertar = async (conexion) => {
    const { rows } = await conexion
      .prepare('INSERT INTO tiendas (nombre, slug, plan_id, vence_en) VALUES (?, ?, ?, ?) RETURNING id')
      .run(nombre, slug, planId, venceEn);
    const tiendaId = rows[0].id;
    await conexion
      .prepare('INSERT INTO usuarios (tienda_id, email, hash_clave, nombre, apellido) VALUES (?, ?, ?, ?, ?)')
      .run(tiendaId, email, hash, titular?.nombre || null, titular?.apellido || null);
    return { tienda: { id: tiendaId, nombre, slug }, email, clave };
  };
  return tx ? insertar(tx) : enTransaccion(db, insertar);
}

const SELECCION_TIENDA = `
  SELECT t.id, t.nombre, t.slug, t.estado, t.motivo_suspension AS "motivoSuspension", t.vence_en AS "venceEn",
         (p.suspender_al_vencer = 1) AS "suspenderAlVencer", p.dias_prueba AS "diasPrueba",
         t.dominio_propio AS "dominioPropio", t.dominio_estado AS "dominioEstado"
  FROM tiendas t LEFT JOIN planes p ON p.id = t.plan_id`;

// `estado` es el que vale ahora: 'suspendida' si la suspendieron o si su plan la cierra al vencer y ya venció.
function conEstado(fila) {
  if (!fila) return null;
  const { estado, motivo } = estadoEfectivo(fila);
  // dominioPropio / dominioEstado: el dominio propio de la tienda (plan a medida) y en qué paso está; solo con estado 'activo' se ve ahí (ver dominios-propios.js).
  return { id: fila.id, nombre: fila.nombre, slug: fila.slug, estado, motivoSuspension: motivo, dominioPropio: fila.dominioPropio ?? null, dominioEstado: fila.dominioEstado ?? null };
}

export async function buscarTiendaPorSlug(db, slug) {
  return conEstado(await db.prepare(`${SELECCION_TIENDA} WHERE t.slug = ?`).get(slug));
}

// La tienda que se ve en este dominio (su dominio propio, ya activo), o null.
export async function buscarTiendaPorDominio(db, dominio) {
  return conEstado(await db.prepare(`${SELECCION_TIENDA} WHERE t.dominio_propio = ? AND t.dominio_estado = 'activo'`).get(dominio));
}

export async function buscarTienda(db, id) {
  return conEstado(await db.prepare(`${SELECCION_TIENDA} WHERE t.id = ?`).get(id));
}

export function listarTiendas(db) {
  return db.prepare('SELECT id, nombre, slug FROM tiendas ORDER BY lower(nombre)').all();
}

// Cambia el link de una tienda (solo desde la plataforma). El anterior queda registrado y redirige al nuevo.
// Devuelve { error } o { slug, anterior }.
export async function cambiarLinkDeTienda(db, tiendaId, texto) {
  const actual = await db.prepare('SELECT slug FROM tiendas WHERE id = ?').get(tiendaId);
  if (!actual) return { error: 'La tienda no existe' };
  const link = await validarLink(db, texto, { tiendaId });
  if (link.error) return link;
  if (link.slug === actual.slug) return { error: 'Ese ya es el link de la tienda' };
  try {
    await enTransaccion(db, async (tx) => {
      await tx
        .prepare(
          `INSERT INTO tienda_enlaces_anteriores (slug, tienda_id) VALUES (?, ?)
           ON CONFLICT (slug) DO UPDATE SET tienda_id = excluded.tienda_id, cambiado_en = ahora()`,
        )
        .run(actual.slug, tiendaId);
      // Si vuelve a un link que ya tuvo, deja de ser "anterior".
      await tx.prepare('DELETE FROM tienda_enlaces_anteriores WHERE slug = ? AND tienda_id = ?').run(link.slug, tiendaId);
      await tx.prepare('UPDATE tiendas SET slug = ? WHERE id = ?').run(link.slug, tiendaId);
    });
  } catch (error) {
    if (error.code === '23505') return { error: 'Ese link ya lo usa otra tienda' }; // otra persona lo tomó justo ahora
    throw error;
  }
  return { slug: link.slug, anterior: actual.slug };
}

export function listarEnlacesAnteriores(db, tiendaId) {
  return db
    .prepare('SELECT slug, cambiado_en AS "cambiadoEn" FROM tienda_enlaces_anteriores WHERE tienda_id = ? ORDER BY cambiado_en DESC, slug')
    .all(tiendaId);
}

// Deja de redirigir un link anterior: queda libre para otra tienda. Devuelve true si era de esa tienda.
export async function soltarEnlaceAnterior(db, tiendaId, slug) {
  const { rows } = await db.prepare('DELETE FROM tienda_enlaces_anteriores WHERE slug = ? AND tienda_id = ? RETURNING slug').run(String(slug ?? ''), tiendaId);
  return rows.length > 0;
}

// Si `slug` fue el link de una tienda, el link que tiene ahora; si no, null.
export async function enlaceActualDeAnterior(db, slug) {
  const fila = await db
    .prepare('SELECT t.slug FROM tienda_enlaces_anteriores a JOIN tiendas t ON t.id = a.tienda_id WHERE a.slug = ?')
    .get(slug);
  return fila?.slug ?? null;
}

// Cambia el nombre que se muestra. El link de la tienda no cambia con el nombre: se cambia aparte (cambiarLinkDeTienda).
export async function renombrarTienda(db, tiendaId, nombre) {
  const limpio = String(nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!limpio) return 'Escribí el nombre de la tienda';
  if (limpio.length > 80) return 'El nombre puede tener hasta 80 caracteres';
  await db.prepare('UPDATE tiendas SET nombre = ? WHERE id = ?').run(limpio, tiendaId);
  return null;
}

export const LARGO_MINIMO_CLAVE = 6;

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
