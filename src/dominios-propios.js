// Dominio propio de una tienda (plan a medida): que se vea en mitienda.com en vez de en <slug>.<dominio de la plataforma>.
// El recorrido, con quién hace cada cosa:
//  1. solicitado: el cliente escribe su dominio en su panel (o quien administra la plataforma lo carga en la ficha).
//  2. verificado: el DNS del dominio ya apunta a la plataforma (CNAME al dominio del panel, o un registro A a la misma IP). Se comprueba con
//     "Verificar ahora"; si todavía no apunta, se explica qué falta.
//  3. activo: quien administra la plataforma agregó el dominio en Coolify (Domains), comprobó que carga con https y lo activó desde la ficha.
//     Recién ahí la tienda se resuelve por ese dominio (buscarTiendaPorDominio) y el subdominio de siempre redirige (301) al dominio propio.
// Los mails y los links de pedidos usan el dominio propio cuando está activo (urlPublicaDeTienda en util/dominios.js).
import dns from 'node:dns/promises';

// Un dominio: letras, números y guiones separados por puntos, con una terminación de 2 letras o más (ya sin "https://", la ruta ni el puerto).
const DOMINIO = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const ESTADOS_DOMINIO = {
  solicitado: { titulo: 'Solicitado', ayuda: 'Falta apuntar el dominio a la plataforma (ver los pasos).' },
  verificado: { titulo: 'DNS verificado', ayuda: 'El dominio ya apunta a la plataforma. Falta activarlo.' },
  activo: { titulo: 'Activo', ayuda: 'Tu tienda ya se ve en este dominio.' },
};

// Lo que escribe una persona ("https://www.MiTienda.com/", "mitienda.com") queda como "www.mitienda.com". Devuelve { valor } o { error }.
// No se aceptan los dominios de la plataforma ni los que no son un nombre (IP, localhost, con puerto).
export function validarDominio(entrada, { dominioPanel = '', dominioTiendas = '' } = {}) {
  const limpio = String(entrada ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (limpio === '') return { error: 'Escribí tu dominio, por ejemplo www.mitienda.com' };
  if (limpio.includes(':')) return { error: 'Escribilo sin el puerto ni símbolos, por ejemplo www.mitienda.com' };
  if (!DOMINIO.test(limpio)) return { error: 'Ese no parece un dominio. Escribilo así: www.mitienda.com (sin espacios ni "https://")' };
  for (const propio of [dominioPanel, dominioTiendas].filter(Boolean)) {
    if (limpio === propio || limpio.endsWith(`.${propio}`)) return { error: 'Ese dominio es de la plataforma: escribí el tuyo, por ejemplo www.mitienda.com' };
  }
  return { valor: limpio };
}

// Un dominio sin "www." ni subdominio (mitienda.com) no puede ser un CNAME: necesita un registro A. Es una aproximación: sirve para mostrar el registro que corresponde.
export const esDominioRaiz = (dominio) => dominio.split('.').length <= 2 || /\.(com|net|org|edu|gov)\.[a-z]{2}$/.test(dominio) && dominio.split('.').length <= 3;

// ---------- Lectura y cambios ----------

export async function leerDominio(db, tiendaId) {
  const fila = await db.prepare('SELECT dominio_propio AS dominio, dominio_estado AS estado FROM tiendas WHERE id = ?').get(tiendaId);
  return fila?.dominio ? { dominio: fila.dominio, estado: fila.estado ?? 'solicitado' } : null;
}

// Guarda el dominio como solicitado (si ya tenía otro, lo reemplaza y vuelve al primer paso). Devuelve { dominio } o { error }.
export async function solicitarDominio(db, tiendaId, entrada, dominios) {
  const validado = validarDominio(entrada, dominios);
  if (validado.error) return validado;
  try {
    const { changes } = await db
      .prepare("UPDATE tiendas SET dominio_propio = ?, dominio_estado = 'solicitado' WHERE id = ?")
      .run(validado.valor, tiendaId);
    if (changes === 0) return { error: 'La tienda no existe' };
  } catch (error) {
    if (error.code === '23505') return { error: 'Ese dominio ya lo usa otra tienda' };
    throw error;
  }
  return { dominio: validado.valor };
}

export async function quitarDominio(db, tiendaId) {
  return (await db.prepare('UPDATE tiendas SET dominio_propio = NULL, dominio_estado = NULL WHERE id = ?').run(tiendaId)).changes > 0;
}

// Quien administra la plataforma lo activa (cuando ya lo agregó en Coolify y carga con https) o lo desactiva (vuelve a "solicitado").
export async function cambiarActivacion(db, tiendaId, activo) {
  const estado = activo ? 'activo' : 'solicitado';
  return (await db.prepare('UPDATE tiendas SET dominio_estado = ? WHERE id = ? AND dominio_propio IS NOT NULL').run(estado, tiendaId)).changes > 0;
}

// ---------- Verificación del DNS ----------

const sinPunto = (nombre) => String(nombre).replace(/\.$/, '').toLowerCase();

// ¿El dominio ya apunta a la plataforma? Sí si es un CNAME al dominio del panel, o si sus direcciones (A) coinciden con las del panel
// (o con `ip`, la IP del servidor, si se configuró): eso cubre los dominios sin "www", que no pueden ser CNAME, y las cadenas de CNAME.
// `resolver` se puede reemplazar (los tests no salen a internet). Devuelve { ok, por ('cname' | 'ip' | null), cname, a }.
export async function comprobarDns(dominio, { panel, ip = '', resolver = dns } = {}) {
  const listar = async (funcion) => {
    try {
      return (await funcion()).map(sinPunto);
    } catch {
      return []; // sin registro de ese tipo, o el DNS no contestó: cuenta como "no apunta todavía"
    }
  };
  const cname = await listar(() => resolver.resolveCname(dominio));
  const a = await listar(() => resolver.resolve4(dominio));
  if (cname.some((destino) => destino === panel || destino.endsWith(`.${panel}`))) return { ok: true, por: 'cname', cname, a };
  const destinos = ip ? [ip] : await listar(() => resolver.resolve4(panel));
  if (a.some((direccion) => destinos.includes(direccion))) return { ok: true, por: 'ip', cname, a };
  return { ok: false, por: null, cname, a };
}

// Verifica el DNS de la tienda y actualiza su paso: apunta -> "verificado" (si estaba "solicitado"); no apunta -> vuelve a "solicitado"
// (si estaba "verificado"). Un dominio "activo" se queda activo: lo desactiva quien administra la plataforma. Devuelve { ok, ...detalle } o null.
export async function verificarDominio(db, tiendaId, opciones) {
  const actual = await leerDominio(db, tiendaId);
  if (!actual) return null;
  const resultado = await comprobarDns(actual.dominio, opciones);
  if (resultado.ok && actual.estado === 'solicitado') await db.prepare("UPDATE tiendas SET dominio_estado = 'verificado' WHERE id = ?").run(tiendaId);
  else if (!resultado.ok && actual.estado === 'verificado') await db.prepare("UPDATE tiendas SET dominio_estado = 'solicitado' WHERE id = ?").run(tiendaId);
  return { ...resultado, dominio: actual.dominio };
}

// Los registros que hay que cargar en el proveedor del dominio, para mostrarlos tal cual.
export function registrosDns(dominio, { panel, ip = '' }) {
  if (esDominioRaiz(dominio)) {
    return ip
      ? [{ tipo: 'A', nombre: '@ (o el mismo dominio)', valor: ip }]
      : [{ tipo: 'A', nombre: '@ (o el mismo dominio)', valor: null }];
  }
  const nombre = dominio.split('.')[0];
  return [{ tipo: 'CNAME', nombre, valor: panel }];
}
