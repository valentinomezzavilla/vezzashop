// Administración de la plataforma, para quien la opera (el superadministrador): sus cuentas, los planes y los clientes.
import { enTransaccion } from './db.js';
import { generarClave, hashClave, verificarClave } from './claves.js';
import { crearTienda } from './tiendas.js';
import { estadoDeCobro, limitesDeTienda, usoDeTienda } from './limites.js';
import { MAX_FOTOS } from './productos.js';
import { MAX_BANNERS } from './diseno.js';
import { armarPlanDeDiseno, datosDeDiseno, esFuncion, funcionesDePreset, funcionesDeTexto, normalizarFunciones, textoDeFunciones } from './diseno-por-plan.js';
import { parsearPrecio, ErrorDeValor } from './importacion/valores.js';
import { esDiaValido, hoy, sumarDias, sumarMeses } from './util/fechas.js';
import { estadoEfectivo } from './estado.js';

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
  dias_prueba AS "diasPrueba", (suspender_al_vencer = 1) AS "suspenderAlVencer",
  funciones, descripcion, caracteristicas, (destacado = 1) AS "destacado",
  (SELECT count(*) FROM tiendas t WHERE t.plan_id = planes.id) AS clientes`;

// Los textos de la tarjeta del plan (landing y suscripción). Vacíos, la tarjeta se arma sola con los topes, la prueba y el diseño.
export const MAX_DESCRIPCION_PLAN = 160;
export const MAX_CARACTERISTICAS = 12;
export const MAX_LARGO_CARACTERISTICA = 90;

// "una\ndos" -> ['una', 'dos']: una por línea, sin espacios de más ni líneas vacías.
const lineasDe = (valor) => (Array.isArray(valor) ? valor : String(valor ?? '').split(/\r?\n/)).map((linea) => String(linea).replace(/\s+/g, ' ').trim()).filter(Boolean);

// La fila de la base como la usa el resto: las funciones de diseño y las características como listas, y "Recomendado" como booleano.
const armarPlan = (fila) => (fila ? { ...fila, funciones: funcionesDeTexto(fila.funciones), caracteristicas: lineasDe(fila.caracteristicas) } : fila);

export async function listarPlanes(db) {
  return (await db.prepare(`SELECT ${COLUMNAS_PLAN} FROM planes ORDER BY (activo = 1) DESC, precio_centavos, lower(nombre)`).all()).map(armarPlan);
}

export async function leerPlan(db, id) {
  return armarPlan(await db.prepare(`SELECT ${COLUMNAS_PLAN} FROM planes WHERE id = ?`).get(id)) ?? null;
}

// Se ofrecen a clientes los planes activos con precio o con período de prueba. Un plan gratis y sin prueba (como "Sin límites",
// el que la migración 007 les puso a las tiendas que ya existían) es interno y no sale.
export const seOfrece = (plan) => Boolean(plan.activo) && (plan.precioCentavos > 0 || plan.diasPrueba > 0);

// Los que alguien puede contratar solo, sin hablar con nosotros: los que se ofrecen y tienen tope de productos. Un plan sin
// tope ("A medida") se consulta: se arma a medida de cada negocio.
export const esAutoservicio = (plan) => seOfrece(plan) && plan.maxProductos !== null;

// El plan de una tienda para las pantallas de su panel: lo que incluye de diseño y qué planes de los que se ofrecen incluyen lo que le falta.
export async function planDeDiseno(db, tiendaId) {
  const ofrecidos = (await listarPlanes(db)).filter(seOfrece).map(({ id, nombre, precioCentavos, funciones }) => ({ id, nombre, precioCentavos, funciones }));
  return armarPlanDeDiseno(await datosDeDiseno(db, tiendaId), ofrecidos);
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

// Devuelve { datos, errores }. datos solo sirve si no hay errores. Lo que no viene en `campos` (las funciones de diseño y los textos de la
// tarjeta) queda como estaba en el plan guardado.
export async function validarPlan(db, id, campos) {
  const errores = {};
  const actual = id ? await leerPlan(db, id) : null;
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

  // Las funciones de diseño que incluye el plan (ver diseno-por-plan.js): las tildadas en el formulario. Como una casilla sin tildar no viaja, el
  // formulario manda `funcionesEnviadas` para distinguir "ninguna" de "no se tocó".
  let funciones = actual?.funciones ?? [];
  if (campos.funciones !== undefined || campos.funcionesEnviadas !== undefined) {
    const pedidas = [].concat(campos.funciones ?? []).map(texto).filter(Boolean);
    if (pedidas.some((clave) => !esFuncion(clave))) errores.funciones = 'Elegí funciones de la lista';
    funciones = normalizarFunciones(pedidas);
  }

  // Los textos de la tarjeta del plan.
  const descripcion = campos.descripcion === undefined ? (actual?.descripcion ?? '') : texto(campos.descripcion).replace(/\s+/g, ' ');
  if (descripcion.length > MAX_DESCRIPCION_PLAN) errores.descripcion = `Máximo ${MAX_DESCRIPCION_PLAN} caracteres (tiene ${descripcion.length})`;
  const caracteristicas = campos.caracteristicas === undefined ? (actual?.caracteristicas ?? []) : lineasDe(campos.caracteristicas);
  if (caracteristicas.length > MAX_CARACTERISTICAS) errores.caracteristicas = `Máximo ${MAX_CARACTERISTICAS} líneas (tiene ${caracteristicas.length})`;
  else if (caracteristicas.some((linea) => linea.length > MAX_LARGO_CARACTERISTICA)) {
    errores.caracteristicas = `Cada línea puede tener hasta ${MAX_LARGO_CARACTERISTICA} caracteres: acortá "${caracteristicas.find((linea) => linea.length > MAX_LARGO_CARACTERISTICA).slice(0, 30)}…"`;
  }

  const datos = {
    nombre,
    precioCentavos,
    maxProductos: tope(campos.maxProductos, 1, 1_000_000, 'Productos', errores, 'maxProductos'),
    maxFotos: tope(campos.maxFotos, 1, MAX_FOTOS, 'Fotos por producto', errores, 'maxFotos'),
    maxBanners: tope(campos.maxBanners, 0, MAX_BANNERS, 'Banners', errores, 'maxBanners'),
    activo: campos.activo === '1' || campos.activo === 'on' || campos.activo === true,
    diasPrueba: null,
    suspenderAlVencer: campos.suspenderAlVencer === '1' || campos.suspenderAlVencer === 'on' || campos.suspenderAlVencer === true,
    funciones,
    descripcion,
    caracteristicas,
    // "Recomendado" en la tarjeta: lo tiene un solo plan (al guardar uno, se le saca a los demás).
    destacado: campos.destacado === '1' || campos.destacado === 'on' || campos.destacado === true,
  };
  // Días de prueba: vacío es "sin prueba". Al darle este plan a un cliente, vence a los N días.
  const dias = texto(campos.diasPrueba);
  if (dias !== '') {
    if (!/^\d+$/.test(dias) || Number(dias) < 1 || Number(dias) > 365) errores.diasPrueba = 'Días de prueba: escribí un número entre 1 y 365, o dejalo vacío si el plan no tiene prueba';
    else datos.diasPrueba = Number(dias);
  }
  return { datos, errores };
}

// `datos.funciones`, `descripcion`, `caracteristicas` y `destacado` son opcionales: sin ellos, el plan arranca sin funciones de diseño y con la
// tarjeta armada sola. Un plan "Recomendado" se lo saca al que lo tenía.
export async function crearPlan(db, datos) {
  const { rows } = await db
    .prepare(
      `INSERT INTO planes (nombre, precio_centavos, max_productos, max_fotos, max_banners, activo, dias_prueba, suspender_al_vencer,
                           funciones, descripcion, caracteristicas, destacado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .run(
      datos.nombre, datos.precioCentavos, datos.maxProductos, datos.maxFotos, datos.maxBanners, Number(datos.activo), datos.diasPrueba ?? null,
      Number(Boolean(datos.suspenderAlVencer)), textoDeFunciones(datos.funciones), datos.descripcion ?? '', lineasDe(datos.caracteristicas).join('\n'),
      Number(Boolean(datos.destacado)),
    );
  if (datos.destacado) await db.prepare('UPDATE planes SET destacado = 0 WHERE id <> ?').run(rows[0].id);
  return rows[0].id;
}

// Lo que `datos` no trae (las funciones de diseño, los textos de la tarjeta, "Recomendado") queda como estaba.
export async function editarPlan(db, id, datos) {
  const aTexto = (valor, convertir) => (valor === undefined ? null : convertir(valor));
  const cambios = (
    await db
      .prepare(
        `UPDATE planes SET nombre = ?, precio_centavos = ?, max_productos = ?, max_fotos = ?, max_banners = ?, activo = ?,
         dias_prueba = ?, suspender_al_vencer = ?, funciones = COALESCE(?, funciones), descripcion = COALESCE(?, descripcion),
         caracteristicas = COALESCE(?, caracteristicas), destacado = COALESCE(?, destacado) WHERE id = ?`,
      )
      .run(
        datos.nombre, datos.precioCentavos, datos.maxProductos, datos.maxFotos, datos.maxBanners, Number(datos.activo), datos.diasPrueba ?? null,
        Number(Boolean(datos.suspenderAlVencer)), aTexto(datos.funciones, textoDeFunciones), aTexto(datos.descripcion, String),
        aTexto(datos.caracteristicas, (lineas) => lineasDe(lineas).join('\n')), aTexto(datos.destacado, (valor) => Number(Boolean(valor))), id,
      )
  ).changes;
  if (datos.destacado) await db.prepare('UPDATE planes SET destacado = 0 WHERE id <> ?').run(id);
  return cambios > 0;
}

// Pausar un plan: deja de ofrecerse a clientes nuevos, pero los que ya lo tienen lo conservan y siguen igual. Reanudar lo vuelve a ofrecer.
export async function pausarPlan(db, id, pausado) {
  return (await db.prepare('UPDATE planes SET activo = ? WHERE id = ?').run(pausado ? 0 : 1, id)).changes > 0;
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
         t.precio_fijo_centavos AS "precioFijoCentavos", COALESCE(t.precio_fijo_centavos, p.precio_centavos) AS "precioEfectivoCentavos",
         p.max_productos AS "maxProductos", p.dias_prueba AS "diasPrueba", (p.suspender_al_vencer = 1) AS "suspenderAlVencer",
         t.dominio_propio AS "dominioPropio", t.dominio_estado AS "dominioEstado",
         (SELECT u.email FROM usuarios u WHERE u.tienda_id = t.id ORDER BY u.id LIMIT 1) AS email,
         (SELECT u.nombre FROM usuarios u WHERE u.tienda_id = t.id ORDER BY u.id LIMIT 1) AS "titularNombre",
         (SELECT u.apellido FROM usuarios u WHERE u.tienda_id = t.id ORDER BY u.id LIMIT 1) AS "titularApellido",
         (SELECT count(*) FROM productos x WHERE x.tienda_id = t.id) AS productos,
         (SELECT count(*) FROM pedidos o WHERE o.tienda_id = t.id) AS pedidos
  FROM tiendas t LEFT JOIN planes p ON p.id = t.plan_id`;

// `estado` es el que vale ahora (cerrada si la suspendieron o si su plan la cierra al vencer y ya venció);
// `estadoReal` es el que se guardó, y `cerradaAlVencer` avisa que el cierre es automático.
function conCobro(cliente, dia) {
  const efectivo = estadoEfectivo(cliente, dia);
  return {
    ...cliente,
    productos: Number(cliente.productos),
    pedidos: Number(cliente.pedidos),
    cobro: estadoDeCobro(cliente.venceEn, dia),
    estadoReal: cliente.estado,
    estado: efectivo.estado,
    cerradaAlVencer: efectivo.cerradaAlVencer,
    motivoCierre: efectivo.motivo,
  };
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
    // Lo que paga cada uno de verdad: el precio fijo del cliente, si lo tiene, y si no el del plan.
    ingresoMensualCentavos: activos.reduce((suma, c) => suma + Number(c.precioEfectivoCentavos ?? 0), 0),
  };
}

// Devuelve { datos, errores }. `vence` es opcional ("2026-12-31").
export async function validarCliente(db, campos) {
  const errores = {};
  const planId = /^\d+$/.test(texto(campos.planId)) ? Number(campos.planId) : null;
  if (planId === null || !(await db.prepare('SELECT 1 FROM planes WHERE id = ?').get(planId))) errores.planId = 'Elegí un plan';
  const venceEn = texto(campos.venceEn) || null;
  if (venceEn !== null && !esDiaValido(venceEn)) errores.venceEn = 'Elegí una fecha válida';
  // `slug` es el link elegido a mano; vacío, sale del nombre.
  return { datos: { nombre: texto(campos.nombre).replace(/\s+/g, ' '), email: texto(campos.email), planId, venceEn, slug: texto(campos.slug) }, errores };
}

// Alta de un cliente: su tienda, su usuario y una clave que se muestra una sola vez.
// Si no se elige una fecha de vencimiento y el plan tiene prueba, vence a los N días de hoy; con una fecha elegida, vale esa.
export async function crearCliente(db, datos, dia = hoy()) {
  let { venceEn } = datos;
  if (venceEn === null || venceEn === undefined) {
    const plan = datos.planId == null ? null : await db.prepare('SELECT dias_prueba AS "diasPrueba" FROM planes WHERE id = ?').get(datos.planId);
    venceEn = plan?.diasPrueba ? sumarDias(dia, plan.diasPrueba) : null;
  }
  return crearTienda(db, { ...datos, venceEn });
}

// Devuelve { error } o { prueba }, donde prueba es { dias, venceEn } si el plan nuevo tiene período de prueba (empieza hoy) o null.
// Cambiar a un plan sin prueba no toca el vencimiento: eso se maneja registrando pagos o fijando la fecha.
export async function cambiarPlanDeCliente(db, tiendaId, planId, dia = hoy()) {
  const plan = await db.prepare('SELECT dias_prueba AS "diasPrueba" FROM planes WHERE id = ?').get(planId);
  if (!plan) return { error: 'El plan no existe' };
  // Un precio fijo es de un plan: al pasar a otro, el cliente vuelve a pagar el precio de su plan nuevo.
  await db
    .prepare('UPDATE tiendas SET plan_id = ?, precio_fijo_centavos = CASE WHEN plan_id IS DISTINCT FROM ? THEN NULL ELSE precio_fijo_centavos END WHERE id = ?')
    .run(planId, planId, tiendaId);
  if (!plan.diasPrueba) return { prueba: null };
  const venceEn = sumarDias(dia, plan.diasPrueba);
  await db.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(venceEn, tiendaId);
  return { prueba: { dias: plan.diasPrueba, venceEn } };
}

// Fija (o quita) el precio fijo de un cliente: lo que paga por mes aunque el precio de su plan cambie. Vacío: vuelve a pagar el del plan.
// Devuelve { error } o { precioFijoCentavos } (null si se quitó). No toca a Mercado Pago: eso lo hace actualizarCobroDeCliente.
export async function fijarPrecioDeCliente(db, tiendaId, valor) {
  const limpio = texto(valor);
  let centavos = null;
  if (limpio !== '') {
    try {
      centavos = parsearPrecio(limpio);
    } catch (error) {
      if (!(error instanceof ErrorDeValor)) throw error;
      return { error: 'Escribí el monto en pesos, por ejemplo 12900 o 12.900,50' };
    }
    if (centavos === null || centavos <= 0) return { error: 'El precio fijo tiene que ser mayor a $0. Si no querés uno, dejalo vacío.' };
  }
  await db.prepare('UPDATE tiendas SET precio_fijo_centavos = ? WHERE id = ?').run(centavos, tiendaId);
  return { precioFijoCentavos: centavos };
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
  return enTransaccion(db, (tx) => aplicarPago(tx, tiendaId, { meses: cantidad, montoCentavos, nota }, dia));
}

// Suma `meses` pagados a una tienda y deja el cobro anotado. Va dentro de una transacción (tx) para que el que la llama pueda
// juntarlo con otros cambios: lo usan el cobro a mano (registrarPago) y los cobros automáticos de las suscripciones.
// Devuelve { venceDespues }.
export async function aplicarPago(tx, tiendaId, { meses, montoCentavos, nota }, dia = hoy()) {
  const { venceEn } = (await tx.prepare('SELECT vence_en AS "venceEn" FROM tiendas WHERE id = ?').get(tiendaId)) ?? {};
  const desde = venceEn && venceEn >= dia ? venceEn : dia;
  const venceDespues = sumarMeses(desde, meses);
  await tx.prepare('UPDATE tiendas SET vence_en = ? WHERE id = ?').run(venceDespues, tiendaId);
  await tx
    .prepare('INSERT INTO pagos_plataforma (tienda_id, monto_centavos, meses, vencia_antes, vence_despues, nota) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tiendaId, montoCentavos, meses, venceEn ?? null, venceDespues, texto(nota).slice(0, 200));
  return { venceDespues };
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

// ---------- Planes sugeridos ----------

// Una propuesta para arrancar: sirve como punto de partida y después se edita en /plataforma/planes (los precios son del
// momento y conviene revisarlos). Un tope en null es "sin límite". Las horas de trabajo y el soporte de cada plan no los
// aplica el sistema: se cumplen a mano.
export const PLANES_SUGERIDOS = [
  // 7 días de prueba desde que el cliente entra al plan; al terminar, la tienda se cierra hasta que se le registre un pago.
  { nombre: 'Prueba', precioCentavos: 0, maxProductos: 20, maxFotos: 3, maxBanners: 1, diasPrueba: 7, suspenderAlVencer: true },
  { nombre: 'Esencial', precioCentavos: 1_290_000, maxProductos: 150, maxFotos: 4, maxBanners: 2, funciones: funcionesDePreset('esencial'), destacado: true },
  { nombre: 'Acompañado', precioCentavos: 3_490_000, maxProductos: 1000, maxFotos: 8, maxBanners: 4, funciones: funcionesDePreset('acompanado') },
  { nombre: 'A medida', precioCentavos: 8_990_000, maxProductos: null, maxFotos: null, maxBanners: null, funciones: funcionesDePreset('a_medida') },
];

// Crea los que no existan (por nombre, sin distinguir mayúsculas) y deja intactos los demás: se puede correr de nuevo sin pisar
// lo que ya se editó. Devuelve { creados, existentes } con los nombres.
export async function cargarPlanesSugeridos(db) {
  const resultado = { creados: [], existentes: [] };
  // Si ya hay un plan recomendado (el que se eligió a mano), el sugerido no se lo saca.
  const hayRecomendado = Boolean(await db.prepare('SELECT 1 FROM planes WHERE destacado = 1').get());
  for (const plan of PLANES_SUGERIDOS) {
    if (await db.prepare('SELECT 1 FROM planes WHERE lower(nombre) = lower(?)').get(plan.nombre)) {
      resultado.existentes.push(plan.nombre);
      continue;
    }
    await crearPlan(db, { ...plan, activo: true, destacado: plan.destacado && !hayRecomendado });
    resultado.creados.push(plan.nombre);
  }
  return resultado;
}
