// Suscripciones a los planes: el cliente elige un plan, paga con débito automático (Mercado Pago) y, recién después de pagar,
// completa un formulario que crea su cuenta. Cada cobro aprobado de Mercado Pago suma un mes pagado a la tienda
// (el mismo vencimiento que antes se movía registrando pagos a mano).
//
// Todas las funciones reciben `servicios`: { db, mp, avisar, secreto }
//  - mp: el cliente de Mercado Pago (src/mercadopago.js)
//  - avisar: avisa por webhook al flujo de n8n que manda los mails (src/notificaciones.js)
//  - secreto: la clave con la que se firman los links para completar la cuenta
import { createHmac, timingSafeEqual } from 'node:crypto';
import { enTransaccion } from './db.js';
import { crearTienda, validarLink, LARGO_MINIMO_CLAVE } from './tiendas.js';
import { aplicarPago, esAutoservicio, leerPlan } from './plataforma.js';
import { precioDe } from './landing.js';
import { hoy, sumarDias } from './util/fechas.js';

// Al crear la cuenta antes de que llegue el primer cobro (Mercado Pago lo hace un rato después de autorizar), la tienda
// queda abierta este tiempo; el cobro, al llegar, suma su mes desde ahí.
export const DIAS_DE_GRACIA_ALTA = 2;
// Cuánto vale el link para completar la cuenta, contado desde que se creó la suscripción (o desde que se reenvió).
export const VIGENCIA_ENLACE_DIAS = 14;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const texto = (valor) => String(valor ?? '').trim();

// ---------- El link para completar la cuenta ----------
// No se guarda: sale del id firmado con el secreto del servidor, así se puede volver a mandar cuando haga falta.

export function tokenDeAlta(secreto, id) {
  const firma = createHmac('sha256', secreto).update(`alta:${id}`).digest('base64url').slice(0, 32);
  return `${id}.${firma}`;
}

// El id de la suscripción si el token es auténtico; si no, null.
export function idDeToken(secreto, token) {
  const partes = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(token ?? ''));
  if (!partes) return null;
  const esperado = Buffer.from(tokenDeAlta(secreto, partes[1]));
  const recibido = Buffer.from(partes[0]);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido) ? Number(partes[1]) : null;
}

export const enlaceDeAlta = (servicios, id, urlBase) => `${urlBase}/suscribirse/cuenta?t=${tokenDeAlta(servicios.secreto, id)}`;

// "$ 12.900 / mes", para los mails.
const precioTexto = (montoCentavos) => {
  const { precio, unidad } = precioDe({ precioCentavos: montoCentavos, diasPrueba: null });
  return `${precio} ${unidad}`.trim();
};

// ---------- Lectura ----------

const SELECCION = `
  SELECT s.id, s.tienda_id AS "tiendaId", s.plan_id AS "planId", s.mp_id AS "mpId", s.estado, s.monto_centavos AS "montoCentavos",
         s.email_pagador AS "emailPagador", s.proximo_cobro AS "proximoCobro", s.aviso_pago_enviado_en AS "avisoPagoEnviadoEn",
         s.enlace_renovado_en AS "enlaceRenovadoEn", s.reemplaza_a_id AS "reemplazaAId", s.creada_en AS "creadaEn",
         p.nombre AS "planNombre"
  FROM suscripciones s JOIN planes p ON p.id = s.plan_id`;

export async function leerSuscripcion(db, id) {
  return (await db.prepare(`${SELECCION} WHERE s.id = ?`).get(id)) ?? null;
}

// La suscripción que hoy le cobra a la tienda (autorizada o pausada), o null.
export async function suscripcionActivaDeTienda(db, tiendaId) {
  return (await db.prepare(`${SELECCION} WHERE s.tienda_id = ? AND s.estado IN ('autorizada', 'pausada') ORDER BY s.id DESC LIMIT 1`).get(tiendaId)) ?? null;
}

// Cómo está la tienda con sus suscripciones, para la pantalla del panel: { activa, pendiente, cancelada }.
//  activa: la que hoy le cobra (autorizada o pausada)
//  pendiente: un pago que empezó y no terminó (por ejemplo, un cambio de plan sin completar)
//  cancelada: la última que dio de baja, si ya no tiene ninguna activa
export async function estadoDeSuscripcion(db, tiendaId) {
  const activa = await suscripcionActivaDeTienda(db, tiendaId);
  const pendiente = (await db.prepare(`${SELECCION} WHERE s.tienda_id = ? AND s.estado = 'pendiente' AND s.mp_id IS NOT NULL ORDER BY s.id DESC LIMIT 1`).get(tiendaId)) ?? null;
  const cancelada = activa ? null : ((await db.prepare(`${SELECCION} WHERE s.tienda_id = ? AND s.estado = 'cancelada' ORDER BY s.id DESC LIMIT 1`).get(tiendaId)) ?? null);
  return { activa, pendiente, cancelada };
}

const MS_POR_DIA = 86_400_000;
const enlaceVigente = (suscripcion, ahora) => {
  const desde = Date.parse(`${(suscripcion.enlaceRenovadoEn ?? suscripcion.creadaEn).replace(' ', 'T')}Z`);
  return ahora - desde < VIGENCIA_ENLACE_DIAS * MS_POR_DIA;
};

// Qué se puede hacer con el link de una suscripción:
//  'ok' (formulario abierto: está paga o es una prueba) | 'pendiente' (todavía no se confirmó el pago) | 'sin-pago' (se canceló o se pausó)
//  'usado' (la cuenta ya se creó) | 'vencido' | 'invalido'
export function estadoDelEnlace(suscripcion, ahora = Date.now()) {
  if (!suscripcion) return 'invalido';
  if (suscripcion.tiendaId) return 'usado';
  if (!enlaceVigente(suscripcion, ahora)) return 'vencido';
  if (suscripcion.estado === 'autorizada' || suscripcion.estado === 'prueba') return 'ok';
  return suscripcion.estado === 'pendiente' ? 'pendiente' : 'sin-pago';
}

// ---------- Paso 1: elegir plan y pagar ----------

// Crea la suscripción. Para una cuenta nueva (tiendaId null) también sirve de "reserva" del link para completar la cuenta.
// `urlVuelta` es a dónde vuelve el cliente desde Mercado Pago: un texto, o una función que recibe el token del link.
// Devuelve { error, campo } o { suscripcionId, token, initPoint }: initPoint es el link de pago (null en el plan de prueba gratis).
export async function iniciarSuscripcion(servicios, { planId, email, tiendaId = null, reemplazaAId = null, urlVuelta }) {
  const { db, mp, secreto } = servicios;
  const plan = await leerPlan(db, planId);
  if (!plan || !esAutoservicio(plan)) return { error: 'Ese plan no está disponible. Elegí otro.', campo: 'plan' };
  const correo = texto(email);
  if (!EMAIL.test(correo)) return { error: 'Escribí un email válido', campo: 'email' };
  if (tiendaId === null && (await db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = lower(?)').get(correo))) {
    return { error: 'Ya hay una cuenta con ese email. Ingresá a tu panel para suscribirte o cambiar de plan.', campo: 'email' };
  }

  if (plan.precioCentavos === 0) {
    // Prueba gratis: sin Mercado Pago, la cuenta se crea directo.
    if (tiendaId !== null) return { error: 'La prueba gratis es solo para cuentas nuevas.', campo: 'plan' };
    const { rows } = await db.prepare("INSERT INTO suscripciones (plan_id, estado, monto_centavos, email_pagador) VALUES (?, 'prueba', 0, ?) RETURNING id").run(plan.id, correo);
    return { suscripcionId: rows[0].id, token: tokenDeAlta(secreto, rows[0].id), initPoint: null };
  }
  if (!mp) return { error: 'Los pagos no están disponibles por ahora. Escribinos y te ayudamos.', campo: 'plan' };

  const { rows } = await db
    .prepare("INSERT INTO suscripciones (tienda_id, plan_id, estado, monto_centavos, email_pagador, reemplaza_a_id) VALUES (?, ?, 'pendiente', ?, ?, ?) RETURNING id")
    .run(tiendaId, plan.id, plan.precioCentavos, correo, reemplazaAId);
  const id = rows[0].id;
  const token = tokenDeAlta(secreto, id);
  try {
    const remota = await mp.crearSuscripcion({
      monto: plan.precioCentavos / 100,
      motivo: `VEZZA Shop · Plan ${plan.nombre}`,
      emailPagador: correo,
      referenciaExterna: id,
      urlVuelta: typeof urlVuelta === 'function' ? urlVuelta(token) : urlVuelta,
    });
    await db.prepare('UPDATE suscripciones SET mp_id = ? WHERE id = ?').run(remota.id, id);
    return { suscripcionId: id, token, initPoint: remota.initPoint };
  } catch (error) {
    await db.prepare('DELETE FROM suscripciones WHERE id = ?').run(id); // no quedó nada en Mercado Pago: no dejamos una fila colgada
    throw error;
  }
}

// ---------- Estado de la suscripción (viene de Mercado Pago) ----------

// Lee en Mercado Pago cómo está la suscripción y lo aplica acá. Se puede llamar las veces que haga falta (webhook, vuelta del
// pago, botón del superadmin): lo que hace después de autorizarse es idempotente. Devuelve la suscripción actualizada, o null
// si no es nuestra. `urlBase` ("https://dominio"): para armar el link del mail "creá tu cuenta".
export async function sincronizarSuscripcion(servicios, mpId, { urlBase = null } = {}) {
  const { db, mp } = servicios;
  const suscripcion = await db.prepare(`${SELECCION} WHERE s.mp_id = ?`).get(String(mpId));
  if (!suscripcion) return null;
  const remota = await mp.leerSuscripcion(mpId);
  // Los avisos pueden llegar desordenados: una suscripción que ya avanzó no vuelve a "pendiente".
  const nuevo = remota.estado === null || (remota.estado === 'pendiente' && suscripcion.estado !== 'pendiente') ? suscripcion.estado : remota.estado;
  const proximoCobro = remota.proximoCobro ?? suscripcion.proximoCobro;
  await db.prepare('UPDATE suscripciones SET estado = ?, proximo_cobro = ?, actualizada_en = ahora() WHERE id = ?').run(nuevo, proximoCobro, suscripcion.id);
  const actual = { ...suscripcion, estado: nuevo, proximoCobro };
  if (nuevo === 'autorizada') await alEstarAutorizada(servicios, actual, urlBase);
  return actual;
}

// Lo que corresponde cuando la suscripción está autorizada. Se repite en cada sincronización hasta que quede hecho.
async function alEstarAutorizada(servicios, suscripcion, urlBase) {
  const { db, mp, avisar } = servicios;
  if (suscripcion.tiendaId) {
    // Un cliente que ya existe: pasa al plan de esta suscripción y, si cambió de plan, se da de baja la anterior para no cobrar dos veces.
    await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ? AND plan_id IS DISTINCT FROM ?').run(suscripcion.planId, suscripcion.tiendaId, suscripcion.planId);
    if (suscripcion.reemplazaAId) {
      const anterior = await leerSuscripcion(db, suscripcion.reemplazaAId);
      if (anterior?.mpId && anterior.estado !== 'cancelada') {
        await mp.cancelarSuscripcion(anterior.mpId); // si falla, el aviso se reintenta y se vuelve a intentar acá
        await db.prepare("UPDATE suscripciones SET estado = 'cancelada', actualizada_en = ahora() WHERE id = ?").run(anterior.id);
      }
    }
    return;
  }
  // Una cuenta nueva: se le manda el link al formulario por mail, una sola vez (por si cierra la pestaña antes de completarlo).
  if (!urlBase || suscripcion.avisoPagoEnviadoEn) return;
  const { rows } = await db.prepare('UPDATE suscripciones SET aviso_pago_enviado_en = ahora() WHERE id = ? AND aviso_pago_enviado_en IS NULL RETURNING id').run(suscripcion.id);
  if (rows.length === 0) return;
  await avisar('pago_recibido', {
    email: suscripcion.emailPagador,
    plan: { nombre: suscripcion.planNombre, precio: precioTexto(suscripcion.montoCentavos) },
    urlCuenta: enlaceDeAlta(servicios, suscripcion.id, urlBase),
  });
}

// Mercado Pago cobró un mes: si fue aprobado, suma un mes pagado a la tienda (o lo deja anotado hasta que la cree).
// Devuelve { ignorado } | { aprobado: false } | { repetido } | { aplicado }.
export async function procesarCobro(servicios, cobroId, { urlBase = null } = {}) {
  const { db, mp } = servicios;
  const cobro = await mp.leerCobro(cobroId);
  if (!cobro.suscripcionId) return { ignorado: true };
  // Primero se pone al día la suscripción: un cobro puede avisar antes que la autorización.
  const suscripcion = await sincronizarSuscripcion(servicios, cobro.suscripcionId, { urlBase });
  if (!suscripcion) return { ignorado: true };
  if (!cobro.aprobado) return { aprobado: false };
  return enTransaccion(db, async (tx) => {
    // La fila de la suscripción se bloquea: si en este mismo momento se está creando la cuenta, uno espera al otro y el cobro no se pierde.
    const { tiendaId } = await tx.prepare('SELECT tienda_id AS "tiendaId" FROM suscripciones WHERE id = ? FOR UPDATE').get(suscripcion.id);
    const { rows } = await tx
      .prepare('INSERT INTO suscripcion_cobros (suscripcion_id, mp_cobro_id, monto_centavos) VALUES (?, ?, ?) ON CONFLICT (mp_cobro_id) DO NOTHING RETURNING id')
      .run(suscripcion.id, cobro.id, cobro.montoCentavos);
    if (rows.length === 0) return { repetido: true };
    if (!tiendaId) return { aplicado: false }; // todavía no creó la cuenta: se aplica cuando la cree
    await aplicarCobro(tx, tiendaId, { id: rows[0].id, mpCobroId: cobro.id, montoCentavos: cobro.montoCentavos });
    return { aplicado: true };
  });
}

async function aplicarCobro(tx, tiendaId, cobro) {
  await aplicarPago(tx, tiendaId, { meses: 1, montoCentavos: cobro.montoCentavos, nota: `Mercado Pago · cobro ${cobro.mpCobroId}` });
  await tx.prepare('UPDATE suscripcion_cobros SET aplicado_en = ahora() WHERE id = ?').run(cobro.id);
}

// Retoma un pago que quedó a medias: le pide a Mercado Pago el link de esa suscripción. Si ya se autorizó, la deja al día.
// Devuelve { initPoint } o { autorizada: true } o { error }.
export async function retomarPago(servicios, tiendaId, { urlBase = null } = {}) {
  const { pendiente } = await estadoDeSuscripcion(servicios.db, tiendaId);
  if (!pendiente) return { error: 'No hay ningún pago pendiente.' };
  const remota = await servicios.mp.leerSuscripcion(pendiente.mpId);
  if (remota.estado === 'autorizada') {
    await sincronizarSuscripcion(servicios, pendiente.mpId, { urlBase });
    return { autorizada: true };
  }
  if (remota.estado !== 'pendiente' || !remota.initPoint) return { error: 'Ese pago ya no se puede completar. Elegí el plan de nuevo.' };
  return { initPoint: remota.initPoint };
}

// Da de baja la suscripción de la tienda: no se cobran más meses. La tienda sigue abierta hasta el vencimiento ya pago.
// Devuelve { error } o { suscripcion }.
export async function cancelarSuscripcionDeTienda(servicios, tiendaId) {
  const { db, mp } = servicios;
  const suscripcion = await suscripcionActivaDeTienda(db, tiendaId);
  if (!suscripcion?.mpId) return { error: 'No hay una suscripción activa para cancelar.' };
  await mp.cancelarSuscripcion(suscripcion.mpId);
  await db.prepare("UPDATE suscripciones SET estado = 'cancelada', actualizada_en = ahora() WHERE id = ?").run(suscripcion.id);
  return { suscripcion };
}

// ---------- Paso 5: crear la cuenta ----------

// Valida el formulario de la cuenta. Devuelve { datos, errores }.
export async function validarCuenta(db, campos) {
  const errores = {};
  const nombre = texto(campos.nombre).replace(/\s+/g, ' ');
  const apellido = texto(campos.apellido).replace(/\s+/g, ' ');
  const email = texto(campos.email);
  const clave = String(campos.clave ?? '');
  const nombreTienda = texto(campos.nombreTienda).replace(/\s+/g, ' ');
  const enlace = texto(campos.slug);

  if (!nombre) errores.nombre = 'Escribí tu nombre';
  else if (nombre.length > 60) errores.nombre = 'Máximo 60 caracteres';
  if (!apellido) errores.apellido = 'Escribí tu apellido';
  else if (apellido.length > 60) errores.apellido = 'Máximo 60 caracteres';
  if (!EMAIL.test(email)) errores.email = 'Escribí un email válido';
  else if (await db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = lower(?)').get(email)) {
    errores.email = 'Ya hay una cuenta con ese email. Probá con otro, o ingresá a tu panel.';
  }
  if (clave.length < LARGO_MINIMO_CLAVE) errores.clave = `La clave tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres`;
  else if (clave !== String(campos.claveRepetida ?? '')) errores.claveRepetida = 'Las dos claves no coinciden';
  if (!nombreTienda) errores.nombreTienda = 'Escribí el nombre de tu tienda';
  else if (nombreTienda.length > 80) errores.nombreTienda = 'Máximo 80 caracteres';
  else {
    const link = await validarLink(db, enlace || nombreTienda);
    if (link.error) errores[enlace ? 'slug' : 'nombreTienda'] = link.error;
  }
  return { datos: { nombre, apellido, email, clave, nombreTienda, slug: enlace }, errores };
}

// Crea la tienda y el usuario de una suscripción ya paga (o de una prueba gratis). Todo en una transacción: si dos envíos
// llegan juntos, la cuenta se crea una sola vez.
// Devuelve { error } (el link no sirve: 'invalido' | 'vencido' | 'usado' | 'pendiente' | 'sin-pago'), { errores, datos } (el
// formulario tiene problemas) o { tienda, plan, datos }.
export async function crearCuentaDeSuscripcion(servicios, token, campos) {
  const { db, secreto } = servicios;
  const id = idDeToken(secreto, token);
  const suscripcion = id === null ? null : await leerSuscripcion(db, id);
  const estado = estadoDelEnlace(suscripcion);
  if (estado !== 'ok') return { error: estado };

  const { datos, errores } = await validarCuenta(db, campos);
  if (Object.keys(errores).length > 0) return { errores, datos };

  try {
    return await enTransaccion(db, async (tx) => {
      const fresca = await tx.prepare(`${SELECCION} WHERE s.id = ? FOR UPDATE OF s`).get(id);
      const estadoFresco = estadoDelEnlace(fresca);
      if (estadoFresco !== 'ok') return { error: estadoFresco };
      const plan = await leerPlan(tx, fresca.planId);
      const cobros = await tx
        .prepare('SELECT id, mp_cobro_id AS "mpCobroId", monto_centavos AS "montoCentavos" FROM suscripcion_cobros WHERE suscripcion_id = ? AND aplicado_en IS NULL ORDER BY id')
        .all(id);
      let venceEn = null;
      if (fresca.estado === 'prueba') venceEn = plan.diasPrueba ? sumarDias(hoy(), plan.diasPrueba) : null;
      else if (cobros.length === 0) venceEn = sumarDias(hoy(), DIAS_DE_GRACIA_ALTA);
      const { tienda } = await crearTienda(
        db,
        { nombre: datos.nombreTienda, email: datos.email, planId: plan.id, venceEn, slug: datos.slug, clave: datos.clave, titular: { nombre: datos.nombre, apellido: datos.apellido } },
        { tx },
      );
      await tx.prepare('UPDATE suscripciones SET tienda_id = ?, actualizada_en = ahora() WHERE id = ?').run(tienda.id, id);
      for (const cobro of cobros) await aplicarCobro(tx, tienda.id, cobro);
      return { tienda, plan, datos };
    });
  } catch (error) {
    if (error.code === '23505') return { errores: { general: 'Ese email o ese link ya se usó. Probá con otro.' }, datos };
    if (error.code) throw error; // un error de la base no se le muestra a nadie
    return { errores: { general: error.message }, datos }; // crearTienda avisa con un mensaje claro (link reservado, etc.)
  }
}

// Las suscripciones que todavía no tienen cuenta: pagaron (o empezaron la prueba) y no completaron el formulario. Para el superadmin.
export async function listarAltasSinCuenta(db, { limite = 200 } = {}) {
  const filas = await db.prepare(`${SELECCION} WHERE s.tienda_id IS NULL ORDER BY s.id DESC LIMIT ?`).all(limite);
  return filas.map((s) => ({ ...s, enlaceVigente: enlaceVigente(s, Date.now()) }));
}

// Reenvía por n8n el mail con el link para crear la cuenta (y le da 14 días más de vigencia). Solo si el pago está autorizado.
// Devuelve { error } o { enviado }.
export async function reenviarEnlaceDeAlta(servicios, id, urlBase) {
  const suscripcion = await leerSuscripcion(servicios.db, id);
  if (!suscripcion || suscripcion.tiendaId) return { error: 'Esa suscripción ya tiene su cuenta creada.' };
  if (suscripcion.estado !== 'autorizada') return { error: 'Solo se puede reenviar el link cuando el pago está confirmado.' };
  await renovarEnlace(servicios.db, id);
  const enviado = await servicios.avisar('pago_recibido', {
    email: suscripcion.emailPagador,
    plan: { nombre: suscripcion.planNombre, precio: precioTexto(suscripcion.montoCentavos) },
    urlCuenta: enlaceDeAlta(servicios, id, urlBase),
  });
  return { enviado };
}

// Vuelve a dar vigencia al link (14 días desde ahora). Para reenviarlo desde la ficha del cliente.
export async function renovarEnlace(db, id) {
  await db.prepare('UPDATE suscripciones SET enlace_renovado_en = ahora() WHERE id = ?').run(id);
}
