// Cambios en un plan que alcanzan a quienes ya lo tienen contratado: qué cambió, a quiénes les toca, cómo se aplica un aumento de
// precio (con excepciones, que quedan como "precio fijo" del cliente) y a quiénes se les avisa por mail.
//
// Reglas:
//  - Un cambio de precio se propaga a las suscripciones de Mercado Pago de los clientes del plan (sube o baja el monto desde el próximo cobro).
//  - Un cliente con precio fijo no lo sufre: ni los aumentos ni las bajas lo tocan. Al sacar a alguien de un aumento, su precio de hoy
//    queda como su precio fijo, hasta que se cambie en su ficha (o hasta que cambie de plan).
//  - Los topes y las condiciones del plan valen para todos sus clientes desde ya, y también se les avisa.
//  - Si Mercado Pago rechaza el cambio de algún cliente, el plan igual se guarda y ese cliente queda listado para reintentar desde su ficha.
import { enTransaccion } from './db.js';
import { editarPlan, leerPlan } from './plataforma.js';
import { precioDe } from './landing.js';
import { MAX_FOTOS } from './productos.js';
import { MAX_BANNERS } from './diseno.js';
import { nombreDeDiseno } from './diseno-por-plan.js';
import { diasEntre, formatearDiaLargo, hoy } from './util/fechas.js';

const NUMERO = new Intl.NumberFormat('es-AR', { useGrouping: 'always' });

// "$ 12.900 / mes", "Gratis"
export function precioTexto(centavos) {
  const { precio, unidad } = precioDe({ precioCentavos: centavos, diasPrueba: null });
  return `${precio} ${unidad}`.trim();
}

// Lo que se compara de un plan. `afecta`: le cambia algo a quien lo tiene contratado (si no, es un cambio que se guarda sin más).
const CAMPOS = [
  { campo: 'precioCentavos', etiqueta: 'Precio', afecta: true, precio: true, formato: precioTexto },
  { campo: 'maxProductos', etiqueta: 'Productos', afecta: true, formato: (n) => (n === null ? 'Sin tope' : `Hasta ${NUMERO.format(n)}`) },
  { campo: 'maxFotos', etiqueta: 'Fotos por producto', afecta: true, formato: (n) => `Hasta ${n ?? MAX_FOTOS}` },
  { campo: 'maxBanners', etiqueta: 'Banners de la portada', afecta: true, formato: (n) => `Hasta ${n ?? MAX_BANNERS}` },
  { campo: 'funciones', etiqueta: 'Diseño de la tienda', afecta: true, formato: (funciones) => nombreDeDiseno(funciones ?? []) },
  { campo: 'suspenderAlVencer', etiqueta: 'Si no se paga a tiempo', afecta: true, formato: (v) => (v ? 'La tienda se cierra al vencer' : 'Solo se avisa del vencimiento') },
  { campo: 'nombre', etiqueta: 'Nombre del plan', afecta: false, formato: String },
  { campo: 'diasPrueba', etiqueta: 'Días de prueba', afecta: false, formato: (n) => (n ? `${n} días` : 'Sin prueba') },
  // Lo que se lee en la tarjeta del plan: se guarda sin más, a los clientes no les cambia nada.
  { campo: 'descripcion', etiqueta: 'Descripción en la tarjeta', afecta: false, formato: (texto) => texto || 'La de siempre' },
  { campo: 'caracteristicas', etiqueta: 'Lista de la tarjeta', afecta: false, formato: (lineas) => (lineas?.length ? lineas.join(' · ') : 'La de siempre') },
  { campo: 'destacado', etiqueta: 'Recomendado', afecta: false, formato: (valor) => (valor ? 'Sí' : 'No') },
];

// Qué cambió entre el plan guardado (`antes`, de leerPlan) y los datos nuevos (`despues`, de validarPlan).
// Devuelve [{ campo, etiqueta, antes, despues, afecta, precio }] con los textos listos para mostrar; lo que no cambia no aparece.
export function compararPlan(antes, despues) {
  const cambios = [];
  for (const { campo, etiqueta, afecta = false, precio = false, formato } of CAMPOS) {
    const textoAntes = formato(antes[campo] ?? null);
    const textoDespues = formato(despues[campo] ?? null);
    if (textoAntes !== textoDespues) cambios.push({ campo, etiqueta, antes: textoAntes, despues: textoDespues, afecta, precio });
  }
  return cambios;
}

export const afectaAClientes = (cambios) => cambios.some((c) => c.afecta);

// Los clientes que tienen el plan, con su titular y su suscripción de Mercado Pago (la que hoy les cobra, si hay).
export function clientesDelPlan(db, planId) {
  return db
    .prepare(
      `SELECT t.id, t.nombre, t.slug, t.vence_en AS "venceEn", t.precio_fijo_centavos AS "precioFijo",
              u.email, u.nombre AS "titularNombre", u.apellido AS "titularApellido",
              s.id AS "suscripcionId", s.mp_id AS "mpId", s.estado AS "estadoSuscripcion",
              s.monto_centavos AS "montoCentavos", s.proximo_cobro AS "proximoCobro"
       FROM tiendas t
       LEFT JOIN LATERAL (SELECT email, nombre, apellido FROM usuarios WHERE tienda_id = t.id ORDER BY id LIMIT 1) u ON true
       LEFT JOIN LATERAL (
         SELECT id, mp_id, estado, monto_centavos, proximo_cobro FROM suscripciones
         WHERE tienda_id = t.id AND estado IN ('autorizada', 'pausada') ORDER BY id DESC LIMIT 1
       ) s ON true
       WHERE t.plan_id = ? ORDER BY lower(t.nombre), t.id`,
    )
    .all(planId);
}

// Lo que paga hoy un cliente por mes: lo que le cobra Mercado Pago si está suscripto; si no, su precio fijo o el del plan.
export const pagaAhora = (cliente, precioDelPlanCentavos) => cliente.montoCentavos ?? cliente.precioFijo ?? precioDelPlanCentavos;

// Para la pantalla de confirmación: los cambios y, por cada cliente del plan, qué le pasaría.
// `plan`: el guardado (leerPlan). `datos`: lo que se quiere guardar (validarPlan). Devuelve { cambios, clientes, sube, baja }.
export async function prepararConfirmacion(db, plan, datos, dia = hoy()) {
  const cambios = compararPlan(plan, datos);
  const sube = datos.precioCentavos > plan.precioCentavos;
  const baja = datos.precioCentavos < plan.precioCentavos;
  const clientes = (await clientesDelPlan(db, plan.id)).map((c) => ({
    ...c,
    paga: pagaAhora(c, plan.precioCentavos),
    // Un cliente con precio fijo no se ve afectado por el precio; el resto, sí.
    alcanzado: c.precioFijo === null,
    cobraPronto: Boolean(c.proximoCobro) && diasEntre(dia, c.proximoCobro) >= 0 && diasEntre(dia, c.proximoCobro) < 7,
  }));
  return { cambios, clientes, sube, baja };
}

// El cuerpo del aviso "plan_modificado" para un cliente. `lineas`: los cambios que le tocan (de compararPlan).
export function armarAvisoPlanModificado(cliente, planNombre, lineas, urlBase) {
  const proximo = cliente.proximoCobro ? formatearDiaLargo(cliente.proximoCobro) : null;
  return {
    email: cliente.email,
    nombre: cliente.titularNombre ?? '',
    tienda: { nombre: cliente.nombre },
    plan: { nombre: planNombre },
    cambios: lineas.map((l) => ({
      etiqueta: l.etiqueta,
      antes: l.antes,
      despues: l.despues,
      cuando: l.precio ? (proximo ? `desde tu próximo cobro (${proximo})` : 'desde tu próximo pago') : 'desde ya',
    })),
    urlPanel: `${urlBase}/admin`,
  };
}

// Guarda un plan modificado y lo aplica a sus clientes. `servicios`: { db, mp (o null sin Mercado Pago), avisar }.
//  mantener: ids de clientes que no sufren el aumento (solo vale si el precio sube): su precio de hoy queda como precio fijo.
//  avisarPorMail: si se les manda el aviso `plan_modificado` a los que les cambia algo.
// Devuelve { cambios, actualizados, mantenidos, fallidos: [{ id, nombre, motivo }], avisados, sinEmail, noEnviados }.
export async function aplicarCambioDePlan(servicios, planId, datos, { mantener = new Set(), avisarPorMail = true, urlBase } = {}) {
  const { db, mp = null, avisar } = servicios;
  const antes = await leerPlan(db, planId);
  const cambios = compararPlan(antes, datos);
  const sube = datos.precioCentavos > antes.precioCentavos;
  const cambiaPrecio = datos.precioCentavos !== antes.precioCentavos;
  const resultado = { cambios, actualizados: 0, mantenidos: 0, fallidos: [], avisados: 0, sinEmail: 0, noEnviados: 0 };

  const clientes = await clientesDelPlan(db, planId);
  await enTransaccion(db, async (tx) => {
    await editarPlan(tx, planId, datos);
    if (!sube) return;
    // Los que no sufren el aumento conservan lo que pagan hoy, y así se los reconoce en los aumentos que vengan.
    for (const c of clientes) {
      if (!mantener.has(c.id) || c.precioFijo !== null) continue;
      c.precioFijo = pagaAhora(c, antes.precioCentavos);
      await tx.prepare('UPDATE tiendas SET precio_fijo_centavos = ? WHERE id = ?').run(c.precioFijo, c.id);
      resultado.mantenidos++;
    }
  });

  for (const c of clientes) {
    const leToca = cambiaPrecio && c.precioFijo === null; // el precio nuevo les llega a los que no tienen precio fijo
    let precioAplicado = leToca;
    if (leToca && c.mpId) {
      try {
        if (!mp) throw new Error('Los pagos con Mercado Pago no están configurados');
        if (datos.precioCentavos <= 0) throw new Error('El plan pasó a ser gratis y Mercado Pago no cobra $0: hay que cancelar su suscripción');
        await mp.actualizarMonto(c.mpId, datos.precioCentavos / 100);
        await db.prepare('UPDATE suscripciones SET monto_centavos = ?, actualizada_en = ahora() WHERE id = ?').run(datos.precioCentavos, c.suscripcionId);
        resultado.actualizados++;
      } catch (error) {
        precioAplicado = false;
        resultado.fallidos.push({ id: c.id, nombre: c.nombre, motivo: error.detalle?.message ?? error.message });
        console.error(`No se pudo actualizar el monto de la suscripción ${c.mpId} (${c.nombre}):`, error.message);
      }
    }

    if (!avisarPorMail) continue;
    // Lo que le cambia a este cliente: el precio solo si le llegó; el resto (topes y condiciones) siempre.
    const lineas = cambios.filter((l) => l.afecta && (!l.precio || precioAplicado));
    if (lineas.length === 0) continue;
    if (!c.email) {
      resultado.sinEmail++;
      continue;
    }
    const enviado = await avisar('plan_modificado', armarAvisoPlanModificado(c, datos.nombre, lineas, urlBase));
    if (enviado) resultado.avisados++;
    else resultado.noEnviados++;
  }
  return resultado;
}

// El aviso que ve el administrador después de aplicar un cambio de plan: qué se hizo y qué quedó pendiente.
// Devuelve { tipo: 'ok' | 'error', texto }.
export function resumenDeResultado(resultado, nombrePlan) {
  const n = (cantidad, singular, plural) => `${cantidad} ${cantidad === 1 ? singular : plural}`;
  const partes = [`Guardamos el plan "${nombrePlan}".`];
  if (resultado.actualizados) partes.push(`Actualizamos el cobro de ${n(resultado.actualizados, 'cliente', 'clientes')} en Mercado Pago.`);
  if (resultado.mantenidos) partes.push(`${n(resultado.mantenidos, 'cliente conserva', 'clientes conservan')} su precio de hoy (quedó como precio fijo).`);
  if (resultado.avisados) partes.push(`Avisamos por mail a ${n(resultado.avisados, 'cliente', 'clientes')}.`);
  if (resultado.sinEmail) partes.push(`${n(resultado.sinEmail, 'cliente no tiene', 'clientes no tienen')} email cargado, así que no se les avisó.`);
  if (resultado.noEnviados) partes.push(`No salió el mail a ${n(resultado.noEnviados, 'cliente', 'clientes')}: revisá que N8N_WEBHOOK_URL esté configurada y que el flujo de n8n esté activo.`);
  if (resultado.fallidos.length) {
    partes.push(`No pudimos actualizar en Mercado Pago a: ${resultado.fallidos.map((f) => `${f.nombre} (${f.motivo})`).join(', ')}. Probá de nuevo desde la ficha de cada uno.`);
  }
  return { tipo: resultado.fallidos.length || resultado.noEnviados ? 'error' : 'ok', texto: partes.join(' ') };
}

// Le pone al cliente el monto que le corresponde en Mercado Pago (su precio fijo o el del plan): sirve para reintentar un cambio que falló
// o para aplicar un precio fijo recién cargado. Devuelve { error } o { montoCentavos, avisado }.
export async function actualizarCobroDeCliente(servicios, tiendaId, { avisarPorMail = false, urlBase } = {}) {
  const { db, mp, avisar } = servicios;
  if (!mp) return { error: 'Los pagos con Mercado Pago no están configurados.' };
  const fila = await db
    .prepare(
      `SELECT t.plan_id AS "planId", COALESCE(t.precio_fijo_centavos, p.precio_centavos) AS "montoCentavos", p.nombre AS "planNombre"
       FROM tiendas t JOIN planes p ON p.id = t.plan_id WHERE t.id = ?`,
    )
    .get(tiendaId);
  if (!fila) return { error: 'Este cliente no tiene plan.' };
  const cliente = (await clientesDelPlan(db, fila.planId)).find((c) => c.id === tiendaId);
  if (!cliente?.mpId) return { error: 'Este cliente no tiene una suscripción activa en Mercado Pago.' };
  if (fila.montoCentavos <= 0) return { error: 'El monto es $0: Mercado Pago no cobra $0.' };
  const antes = cliente.montoCentavos;
  await mp.actualizarMonto(cliente.mpId, fila.montoCentavos / 100);
  await db.prepare('UPDATE suscripciones SET monto_centavos = ?, actualizada_en = ahora() WHERE id = ?').run(fila.montoCentavos, cliente.suscripcionId);
  let avisado = false;
  if (avisarPorMail && cliente.email && antes !== fila.montoCentavos) {
    const linea = { etiqueta: 'Precio', antes: precioTexto(antes), despues: precioTexto(fila.montoCentavos), precio: true };
    avisado = await avisar('plan_modificado', armarAvisoPlanModificado(cliente, fila.planNombre, [linea], urlBase));
  }
  return { montoCentavos: fila.montoCentavos, antes, avisado };
}
