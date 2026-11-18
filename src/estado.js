// Si una tienda está abierta o cerrada. Hay dos motivos para que esté cerrada:
//  - la suspendió el administrador a mano (tiendas.estado = 'suspendida'), o
//  - su plan cierra la tienda al vencer y la fecha de vencimiento ya pasó (el período de prueba terminó, o no se pagó a tiempo).
// Lo segundo no se guarda: se calcula cada vez, así que registrar un pago (o extender la fecha) la reabre en el acto.
import { hoy } from './util/fechas.js';

export const MOTIVO_PRUEBA_TERMINADA = 'Terminó el período de prueba';
export const MOTIVO_PLAZO_VENCIDO = 'Venció el plazo de pago';

// fila: { estado, venceEn, suspenderAlVencer, diasPrueba, motivoSuspension }
// Devuelve { estado: 'activa' | 'suspendida', cerradaAlVencer, motivo }.
export function estadoEfectivo(fila, dia = hoy()) {
  if (fila.estado === 'suspendida') return { estado: 'suspendida', cerradaAlVencer: false, motivo: fila.motivoSuspension ?? '' };
  const vencida = Boolean(fila.suspenderAlVencer) && Boolean(fila.venceEn) && fila.venceEn < dia;
  if (!vencida) return { estado: 'activa', cerradaAlVencer: false, motivo: '' };
  return { estado: 'suspendida', cerradaAlVencer: true, motivo: fila.diasPrueba ? MOTIVO_PRUEBA_TERMINADA : MOTIVO_PLAZO_VENCIDO };
}
