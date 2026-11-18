// Lo que el plan de cada tienda permite, cuánto usa y cómo está de cobro.
// Una tienda sin plan (o con un plan sin topes) no tiene límites; las constantes de siempre (10 fotos por producto,
// 6 banners) siguen valiendo como máximo absoluto.
import { MAX_FOTOS } from './productos.js';
import { MAX_BANNERS } from './diseno.js';
import { diasEntre, hoy } from './util/fechas.js';

export const DIAS_POR_VENCER = 7;

// "al-dia" | "por-vencer" (faltan 7 días o menos) | "vencido" | "sin-vencimiento"
export function estadoDeCobro(venceEn, dia = hoy()) {
  if (!venceEn) return { estado: 'sin-vencimiento', dias: null };
  const dias = diasEntre(dia, venceEn);
  return { estado: dias < 0 ? 'vencido' : dias <= DIAS_POR_VENCER ? 'por-vencer' : 'al-dia', dias };
}

// { plan: { id, nombre, precioCentavos } | null, maxProductos (null = sin tope), maxFotos, maxBanners, venceEn, cobro }
export async function limitesDeTienda(db, tiendaId) {
  const fila = await db
    .prepare(
      `SELECT t.vence_en AS "venceEn", p.id AS "planId", p.nombre, p.precio_centavos AS "precioCentavos",
              p.max_productos AS "maxProductos", p.max_fotos AS "maxFotos", p.max_banners AS "maxBanners", p.dias_prueba AS "diasPrueba"
       FROM tiendas t LEFT JOIN planes p ON p.id = t.plan_id WHERE t.id = ?`,
    )
    .get(tiendaId);
  return {
    plan: fila?.planId ? { id: fila.planId, nombre: fila.nombre, precioCentavos: fila.precioCentavos, diasPrueba: fila.diasPrueba ?? null } : null,
    maxProductos: fila?.maxProductos ?? null,
    maxFotos: Math.min(MAX_FOTOS, fila?.maxFotos ?? MAX_FOTOS),
    maxBanners: Math.min(MAX_BANNERS, fila?.maxBanners ?? MAX_BANNERS),
    venceEn: fila?.venceEn ?? null,
    cobro: estadoDeCobro(fila?.venceEn ?? null),
  };
}

export async function usoDeTienda(db, tiendaId) {
  const { productos } = await db.prepare('SELECT count(*) AS productos FROM productos WHERE tienda_id = ?').get(tiendaId);
  const { banners } = await db.prepare('SELECT count(*) AS banners FROM banners WHERE tienda_id = ?').get(tiendaId);
  return { productos: Number(productos), banners: Number(banners) };
}

// true si ya no se pueden crear más productos.
export async function llegoAlTopeDeProductos(db, tiendaId, limites) {
  if (limites.maxProductos === null) return false;
  return (await usoDeTienda(db, tiendaId)).productos >= limites.maxProductos;
}

// Texto para pedirle al cliente que suba de plan: agrega el contacto de la plataforma si está configurado.
export const ampliarPlan = (config) => (config.contactoPlataforma ? ` Para ampliarlo, contactanos: ${config.contactoPlataforma}.` : ' Para ampliarlo, contactanos.');
