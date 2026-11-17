// Administración de la plataforma, para quien la opera (el superadministrador): sus cuentas, los planes y los clientes.
import { enTransaccion } from './db.js';
import { generarClave, hashClave, verificarClave } from './claves.js';
import { crearTienda } from './tiendas.js';
import { estadoDeCobro, limitesDeTienda, usoDeTienda } from './limites.js';
import { MAX_FOTOS } from './productos.js';
import { MAX_BANNERS } from './diseno.js';
import { parsearPrecio, ErrorDeValor } from './importacion/valores.js';
import { esDiaValido, hoy, sumarMeses } from './util/fechas.js';

const texto = (valor) => String(valor ?? '').trim();
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------- Cuentas de superadministrador ----------

export const LARGO_MINIMO_CLAVE_SUPERADMIN = 12;

// Crea la cuenta y devuelve la clave generada, que solo se ve esta vez.
export async function crearSuperadmin(db, { email }) {
  const limpio = texto(email);
  if (!EMAIL.test(limpio)) throw new Error(`Email inválido: ${email}`);
  if (await db.prepare('SELECT 1 FROM superadmins WHERE lower(email) = lower(?)').get(limpio)) {
    throw new Error(`Ya existe un superadministrador con el email ${limpio}`);
  }
  const clave = generarClave();
  await db.prepare('INSERT INTO superadmins (email, hash_clave) VALUES (?, ?)').run(limpio, await hashClave(clave));
  return { email: limpio, clave };
}

// Para cuando se olvida la clave: genera una nueva (no hay recuperación por email).
export async function resetearClaveSuperadmin(db, email) {
  const clave = generarClave();
  const { changes } = await db.prepare('UPDATE superadmins SET hash_clave = ? WHERE lower(email) = lower(?)').run(await hashClave(clave), texto(email));
  if (changes === 0) throw new Error(`No existe un superadministrador con el email ${email}`);
  return { email: texto(email), clave };
}

let hashDeRelleno;

// Devuelve { id, email } o null. Tarda lo mismo con un email que no existe, para no revelar cuáles existen.
export async function autenticarSuperadmin(db, email, clave) {
  const fila = await db.prepare('SELECT id, email, hash_clave AS hash FROM superadmins WHERE lower(email) = lower(?)').get(texto(email));
  if (!fila) {
    hashDeRelleno ??= await hashClave(generarClave());
    await verificarClave(String(clave ?? ''), hashDeRelleno);
    return null;
  }
  return (await verificarClave(String(clave ?? ''), fila.hash)) ? { id: fila.id, email: fila.email } : null;
}

// Devuelve null si se cambió, o { campo, mensaje }.
export async function cambiarClaveSuperadmin(db, id, { actual, nueva, repetida }) {
  const fila = await db.prepare('SELECT hash_clave AS hash FROM superadmins WHERE id = ?').get(id);
  if (!fila || !(await verificarClave(String(actual ?? ''), fila.hash))) return { campo: 'claveActual', mensaje: 'La clave actual no es correcta' };
  const clave = String(nueva ?? '');
  if (clave.length < LARGO_MINIMO_CLAVE_SUPERADMIN) return { campo: 'claveNueva', mensaje: `La clave nueva tiene que tener al menos ${LARGO_MINIMO_CLAVE_SUPERADMIN} caracteres` };
  if (clave !== String(repetida ?? '')) return { campo: 'claveRepetida', mensaje: 'Las dos claves nuevas no coinciden' };
  await db.prepare('UPDATE superadmins SET hash_clave = ? WHERE id = ?').run(await hashClave(clave), id);
  return null;
}

// ---------- Planes ----------

const COLUMNAS_PLAN = `id, nombre, precio_centavos AS "precioCentavos", max_productos AS "maxProductos",
  max_fotos AS "maxFotos", max_banners AS "maxBanners", (activo = 1) AS "activo",
  (SELECT count(*) FROM tiendas t WHERE t.plan_id = planes.id) AS clientes`;

export function listarPlanes(db) {
  return db.prepare(`SELECT ${COLUMNAS_PLAN} FROM planes ORDER BY (activo = 1) DESC, precio_centavos, lower(nombre)`).all();
}

export async function leerPlan(db, id) {
  return (await db.prepare(`SELECT ${COLUMNAS_PLAN} FROM planes WHERE id = ?`).get(id)) ?? null;
}

// Un tope vacío es "sin límite" (null); si se escribe, tiene que ser un entero dentro del rango.
function tope(valor, minimo, maximo, nombre, errores, campo) {
  const limpio = texto(valor);
  if (limpio === '') return null;
  const numero = Number(limpio);
  if (!/^\d+$/.test(limpio) || numero < minimo || numero > maximo) {
    errores[campo] = `${nombre}: escribí un número entero entre ${minimo} y ${maximo}, o dejalo vacío para no poner tope`;
    return null;
  }
  return numero;
}

// Devuelve { datos, errores }. datos solo sirve si no hay errores.
export async function validarPlan(db, id, campos) {
  const errores = {};
  const nombre = texto(campos.nombre).replace(/\s+/g, ' ');
  if (!nombre) errores.nombre = 'Escribí el nombre del plan';
  else if (nombre.length > 40) errores.nombre = 'Máximo 40 caracteres';
  else if (await db.prepare('SELECT 1 FROM planes WHERE lower(nombre) = lower(?) AND id IS DISTINCT FROM ?').get(nombre, id)) {
    errores.nombre = 'Ya hay un plan con ese nombre';
  }

  let precioCentavos = 0;
  try {
    precioCentavos = parsearPrecio(texto(campos.precio) === '' ? 0 : campos.precio) ?? 0;
  } catch (error) {
    if (!(error instanceof ErrorDeValor)) throw error;
    errores.precio = 'Escribí el precio por mes en pesos, por ejemplo 15000 o 15.000,50';
  }

  const datos = {
    nombre,
    precioCentavos,
    maxProductos: tope(campos.maxProductos, 1, 1_000_000, 'Productos', errores, 'maxProductos'),
    maxFotos: tope(campos.maxFotos, 1, MAX_FOTOS, 'Fotos por producto', errores, 'maxFotos'),
    maxBanners: tope(campos.maxBanners, 0, MAX_BANNERS, 'Banners', errores, 'maxBanners'),
    activo: campos.activo === '1' || campos.activo === 'on' || campos.activo === true,
  };
  return { datos, errores };
}

export async function crearPlan(db, datos) {
  const { rows } = await db
    .prepare('INSERT INTO planes (nombre, precio_centavos, max_productos, max_fotos, max_banners, activo) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .run(datos.nombre, datos.precioCentavos, datos.maxProductos, datos.maxFotos, datos.maxBanners, Number(datos.activo));
  return rows[0].id;
}

export async function editarPlan(db, id, datos) {
  return (
    (await db
      .prepare('UPDATE planes SET nombre = ?, precio_centavos = ?, max_productos = ?, max_fotos = ?, max_banners = ?, activo = ? WHERE id = ?')
      .run(datos.nombre, datos.precioCentavos, datos.maxProductos, datos.maxFotos, datos.maxBanners, Number(datos.activo), id)).changes > 0
  );
}

// Devuelve null si se borró, o el motivo por el que no se puede.
export async function borrarPlan(db, id) {
  const { n } = await db.prepare('SELECT count(*) AS n FROM tiendas WHERE plan_id = ?').get(id);
  if (Number(n) > 0) return `No se puede borrar: ${n === 1 ? 'hay 1 cliente' : `hay ${n} clientes`} con este plan. Cambialos de plan, o desactivá este para que no se ofrezca más.`;
  await db.prepare('DELETE FROM planes WHERE id = ?').run(id);
  return null;
}

// ---------- Clientes ----------

export const FILTROS_CLIENTES = {
  todos: { titulo: 'Todos' },
  activos: { titulo: 'Activos' },
  suspendidos: { titulo: 'Suspendidos' },
  'por-vencer': { titulo: 'Por vencer' },
  vencidos: { titulo: 'Vencidos' },
};
export const esFiltroClientes = (valor) => typeof valor === 'string' && Object.hasOwn(FILTROS_CLIENTES, valor);

const SELECCION_CLIENTE = `
  SELECT t.id, t.nombre, t.slug, t.estado, t.motivo_suspension AS "motivoSuspension", t.vence_en AS "venceEn", t.notas,
         t.creada_en AS "creadaEn", t.plan_id AS "planId", p.nombre AS "planNombre", p.precio_centavos AS "precioCentavos",
         p.max_productos AS "maxProductos",
         (SELECT u.email FROM usuarios u WHERE u.tienda_id = t.id ORDER BY u.id LIMIT 1) AS email,
         (SELECT count(*) FROM productos x WHERE x.tienda_id = t.id) AS productos,
         (SELECT count(*) FROM pedidos o WHERE o.tienda_id = t.id) AS pedidos
  FROM tiendas t LEFT JOIN planes p ON p.id = t.plan_id`;

function conCobro(cliente, dia) {
  return { ...cliente, productos: Number(cliente.productos), pedidos: Number(cliente.pedidos), cobro: estadoDeCobro(cliente.venceEn, dia) };
}

// Devuelve { clientes, cuentas }: la lista según el filtro y la búsqueda, y cuántos hay en cada filtro.
export async function listarClientes(db, { filtro = 'todos', busqueda = '', dia = hoy() } = {}) {
  const todos = (await db.prepare(`${SELECCION_CLIENTE} ORDER BY lower(t.nombre)`).all()).map((c) => conCobro(c, dia));
  const cumple = {
    todos: () => true,
    activos: (c) => c.estado === 'activa',
    suspendidos: (c) => c.estado === 'suspendida',
    'por-vencer': (c) => c.cobro.estado === 'por-vencer',
    vencidos: (c) => c.cobro.estado === 'vencido',
  };
  const cuentas = Object.fromEntries(Object.keys(FILTROS_CLIENTES).map((clave) => [clave, todos.filter(cumple[clave]).length]));
  const q = texto(busqueda).toLowerCase();
  const clientes = todos.filter(cumple[filtro]).filter((c) => !q || [c.nombre, c.slug, c.email ?? ''].some((v) => v.toLowerCase().includes(q)));
  return { clientes, cuentas };
}

export async function leerCliente(db, id, dia = hoy()) {
  const fila = await db.prepare(`${SELECCION_CLIENTE} WHERE t.id = ?`).get(id);
  return fila ? conCobro(fila, dia) : null;
}

// Números de arriba del listado: clientes, su estado y lo que se espera cobrar por mes (planes de los clientes activos).
export async function resumenPlataforma(db, dia = hoy()) {
  const { clientes } = await listarClientes(db, { dia });
  const activos = clientes.filter((c) => c.estado === 'activa');
  return {
    clientes: clientes.length,
    activos: activos.length,
    suspendidos: clientes.length - activos.length,
    porVencer: clientes.filter((c) => c.cobro.estado === 'por-vencer').length,
    vencidos: clientes.filter((c) => c.cobro.estado === 'vencido').length,
    ingresoMensualCentavos: activos.reduce((suma, c) => suma + Number(c.precioCentavos ?? 0), 0),
  };
}

// Devuelve { datos, errores }. `vence` es opcional ("2026-12-31").
export async function validarCliente(db, campos) {
  const errores = {};
  const planId = /^\d+$/.test(texto(campos.planId)) ? Number(campos.planId) : null;
  if (planId === null || !(await db.prepare('SELECT 1 FROM planes WHERE id = ?').get(planId))) errores.planId = 'Elegí un plan';
  const venceEn = texto(campos.venceEn) || null;
  if (venceEn !== null && !esDiaValido(venceEn)) errores.venceEn = 'Elegí una fecha válida';
  return { datos: { nombre: texto(campos.nombre).replace(/\s+/g, ' '), email: texto(campos.email), planId, venceEn }, errores };
}

// Alta de un cliente: su tienda, su usuario y una clave que se muestra una sola vez.
export function crearCliente(db, datos) {
  return crearTienda(db, datos);
}

export async function cambiarPlanDeCliente(db, tiendaId, planId) {
  if (!(await db.prepare('SELECT 1 FROM planes WHERE id = ?').get(planId))) return 'El plan no existe';
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planId, tiendaId);
  return null;
}

export async function suspenderCliente(db, tiendaId, motivo) {
  await db.prepare("UPDATE tiendas SET estado = 'suspendida', motivo_suspension = ? WHERE id = ?").run(texto(motivo).slice(0, 300), tiendaId);
}

export async function reactivarCliente(db, tiendaId) {
  await db.prepare("UPDATE tiendas SET estado = 'activa', motivo_suspension = '' WHERE id = ?").run(tiendaId);
}

export async function fijarVencimiento(db, tiendaId, venceEn) {
  if (venceEn !== null && !esDiaValido(venceEn)) return 'Elegí una fecha válida';
  await db.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(venceEn, tiendaId);
  return null;
}

export async function guardarNotas(db, tiendaId, notas) {
  await db.prepare('UPDATE tiendas SET notas = ? WHERE id = ?').run(texto(notas).slice(0, 2000), tiendaId);
}

// Registra un cobro y extiende el vencimiento: desde la fecha en que vence (si todavía no venció) o desde hoy.
// Devuelve { error } o { venceDespues }.
export async function registrarPago(db, tiendaId, { meses, monto, nota }, dia = hoy()) {
  const cantidad = /^\d+$/.test(texto(meses)) ? Number(meses) : 0;
  if (cantidad < 1 || cantidad > 24) return { error: 'Elegí entre 1 y 24 meses' };
  let montoCentavos = 0;
  try {
    montoCentavos = parsearPrecio(texto(monto) === '' ? 0 : monto) ?? 0;
  } catch (error) {
    if (!(error instanceof ErrorDeValor)) throw error;
    return { error: 'Escribí el monto en pesos, por ejemplo 15000 o 15.000,50 (o dejalo vacío)' };
  }
  return enTransaccion(db, async (tx) => {
    const { venceEn } = (await tx.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tiendaId)) ?? {};
    const desde = venceEn && venceEn >= dia ? venceEn : dia;
    const venceDespues = sumarMeses(desde, cantidad);
    await tx.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(venceDespues, tiendaId);
    await tx
      .prepare('INSERT INTO pagos_plataforma (tienda_id, monto_centavos, meses, vencia_antes, vence_despues, nota) VALUES (?, ?, ?, ?, ?, ?)')
      .run(tiendaId, montoCentavos, cantidad, venceEn ?? null, venceDespues, texto(nota).slice(0, 200));
    return { venceDespues };
  });
}

export function listarPagos(db, tiendaId) {
  return db
    .prepare(
      `SELECT id, monto_centavos AS "montoCentavos", meses, vencia_antes AS "venciaAntes", vence_despues AS "venceDespues", nota, creado_en AS "creadoEn"
       FROM pagos_plataforma WHERE tienda_id = ? ORDER BY id DESC`,
    )
    .all(tiendaId);
}

// Nueva clave para el dueño de la tienda (el administrador se la pasa). Devuelve { email, clave } o null si no hay usuario.
export async function resetearClaveDeCliente(db, tiendaId) {
  const usuario = await db.prepare('SELECT id, email FROM usuarios WHERE tienda_id = ? ORDER BY id LIMIT 1').get(tiendaId);
  if (!usuario) return null;
  const clave = generarClave();
  await db.prepare('UPDATE usuarios SET hash_clave = ? WHERE id = ?').run(await hashClave(clave), usuario.id);
  return { email: usuario.email, clave };
}

// Devuelve null si se cambió, o el motivo.
export async function cambiarEmailDeCliente(db, tiendaId, email) {
  const limpio = texto(email);
  if (!EMAIL.test(limpio)) return 'El email no es válido';
  const usuario = await db.prepare('SELECT id FROM usuarios WHERE tienda_id = ? ORDER BY id LIMIT 1').get(tiendaId);
  if (!usuario) return 'Este cliente no tiene usuario';
  if (await db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = lower(?) AND id <> ?').get(limpio, usuario.id)) return 'Ya hay otro usuario con ese email';
  await db.prepare('UPDATE usuarios SET email = ? WHERE id = ?').run(limpio, usuario.id);
  return null;
}

// Lo que ocupa un cliente frente a los topes de su plan, para la ficha.
export async function usoDeCliente(db, tiendaId) {
  return { limites: await limitesDeTienda(db, tiendaId), uso: await usoDeTienda(db, tiendaId) };
}

