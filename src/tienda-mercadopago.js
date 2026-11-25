// La conexión de cada tienda con SU cuenta de Mercado Pago: se guarda (con los tokens cifrados), se lee, se renueva y se desconecta.
// Dos formas de conectar: el botón "Conectar con Mercado Pago" (OAuth: la tienda autoriza y llegan un token que vence y uno para renovarlo)
// o pegar el Access Token a mano (no vence, pero la tienda lo tiene que haber copiado de su cuenta). Los tokens nunca se muestran ni se guardan en claro.
import { cifrar, descifrar } from './secretos.js';
import { API, AUTORIZACION, crearClienteMpTienda, crearOAuth } from './mercadopago-tiendas.js';
import { ErrorDeMercadoPago } from './mercadopago.js';

// Un token de OAuth se renueva cuando le faltan menos de 15 días para vencer (dura 180).
const RENOVAR_ANTES_MS = 15 * 24 * 60 * 60 * 1000;

// Un problema que se le puede mostrar tal cual a la tienda.
export class ErrorDeConexion extends Error {}

// La configuración de Mercado Pago para las tiendas, con valores por defecto si quien armó `config` no la puso (los tests, por ejemplo).
export const configMp = (config) => config.mercadopagoTiendas ?? { oauth: false, clientId: '', clientSecret: '', apiUrl: API, authUrl: AUTORIZACION };

// { modo, userId, apodo, conectadaEn, expiraEn } o null si la tienda no conectó nada. Nunca devuelve los tokens.
export async function leerConexion(db, tiendaId) {
  const fila = await db
    .prepare('SELECT modo, mp_user_id AS "userId", mp_apodo AS apodo, conectada_en AS "conectadaEn", expira_en AS "expiraEn" FROM tienda_mercadopago WHERE tienda_id = ?')
    .get(tiendaId);
  return fila ?? null;
}

async function guardarConexion(db, tiendaId, { modo, accessToken, refreshToken = '', expiraEn = null, userId = '', apodo = '' }, secreto) {
  await db
    .prepare(
      `INSERT INTO tienda_mercadopago (tienda_id, modo, access_token, refresh_token, expira_en, mp_user_id, mp_apodo, conectada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ahora())
       ON CONFLICT (tienda_id) DO UPDATE SET modo = excluded.modo, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expira_en = excluded.expira_en, mp_user_id = excluded.mp_user_id, mp_apodo = excluded.mp_apodo, conectada_en = excluded.conectada_en`,
    )
    .run(tiendaId, modo, cifrar(accessToken, secreto), refreshToken ? cifrar(refreshToken, secreto) : '', expiraEn, userId, apodo);
}

export async function desconectar(db, tiendaId) {
  return (await db.prepare('DELETE FROM tienda_mercadopago WHERE tienda_id = ?').run(tiendaId)).changes > 0;
}

// Pregunta a Mercado Pago de quién es el token; traduce los problemas a algo que se le pueda decir a la tienda.
async function usuarioDelToken(accessToken, apiUrl) {
  try {
    return await crearClienteMpTienda({ accessToken, apiUrl }).usuarioActual();
  } catch (error) {
    if (error instanceof ErrorDeMercadoPago && (error.status === 401 || error.status === 403)) {
      throw new ErrorDeConexion('Mercado Pago no aceptó ese Access Token. Revisá que sea el de producción de tu aplicación y que lo copiaste entero.');
    }
    throw new ErrorDeConexion('No pudimos hablar con Mercado Pago ahora. Probá de nuevo en un rato.');
  }
}

// La tienda pegó su Access Token. Se comprueba con Mercado Pago antes de guardarlo.
export async function conectarConToken(db, tiendaId, token, { config, secreto }) {
  const limpio = String(token ?? '').trim();
  if (!/^[A-Za-z0-9_-]{20,400}$/.test(limpio)) {
    throw new ErrorDeConexion('Ese no parece un Access Token de Mercado Pago. Es un texto largo que empieza con APP_USR- (o TEST- si es de prueba).');
  }
  const usuario = await usuarioDelToken(limpio, configMp(config).apiUrl);
  await guardarConexion(db, tiendaId, { modo: 'token', accessToken: limpio, userId: usuario.id, apodo: usuario.apodo }, secreto);
  return leerConexion(db, tiendaId);
}

// La tienda autorizó desde Mercado Pago y volvió con un código (de un solo uso y 10 minutos de vida).
export async function conectarConCodigo(db, tiendaId, codigo, { config, secreto, urlVuelta }) {
  const mp = configMp(config);
  if (!mp.oauth) throw new ErrorDeConexion('El botón de conexión todavía no está activado en la plataforma. Pegá tu Access Token.');
  let tokens;
  try {
    tokens = await crearOAuth({ clientId: mp.clientId, clientSecret: mp.clientSecret, apiUrl: mp.apiUrl }).canjearCodigo({ codigo, urlVuelta });
  } catch (error) {
    console.error('Mercado Pago: no se pudo canjear el código de una tienda:', error.status ?? '', error.message);
    throw new ErrorDeConexion('Mercado Pago no aceptó la autorización. Probá conectar de nuevo.');
  }
  const usuario = await usuarioDelToken(tokens.accessToken, mp.apiUrl);
  await guardarConexion(
    db,
    tiendaId,
    { modo: 'oauth', accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiraEn: tokens.expiraEn, userId: usuario.id || tokens.userId, apodo: usuario.apodo },
    secreto,
  );
  return leerConexion(db, tiendaId);
}

// Una renovación a la vez por tienda: si dos pedidos piden el token justo cuando vence, el segundo espera al primero y usa lo que ya se renovó.
const renovaciones = new Map();

async function renovarToken(db, tiendaId, { config, secreto }) {
  const leer = () => db.prepare('SELECT modo, access_token, refresh_token, expira_en FROM tienda_mercadopago WHERE tienda_id = ?').get(tiendaId);
  const fila = await leer();
  if (!fila) return null;
  const vencimiento = fila.expira_en ? Date.parse(fila.expira_en) : Infinity;
  const accesoActual = descifrar(fila.access_token, secreto);
  const sigueSirviendo = accesoActual && vencimiento > Date.now();
  const mp = configMp(config);
  const refresh = descifrar(fila.refresh_token, secreto);
  if (!mp.oauth || !refresh) return sigueSirviendo ? accesoActual : null;
  try {
    const tokens = await crearOAuth({ clientId: mp.clientId, clientSecret: mp.clientSecret, apiUrl: mp.apiUrl }).renovar(refresh);
    // El refresh token que viene ahora es el que vale: se guarda (si Mercado Pago no manda uno nuevo, queda el anterior).
    await db
      .prepare('UPDATE tienda_mercadopago SET access_token = ?, refresh_token = ?, expira_en = ? WHERE tienda_id = ?')
      .run(cifrar(tokens.accessToken, secreto), cifrar(tokens.refreshToken || refresh, secreto), tokens.expiraEn, tiendaId);
    return tokens.accessToken;
  } catch (error) {
    console.error(`Mercado Pago: no se pudo renovar el token de la tienda ${tiendaId}:`, error.status ?? '', error.message);
    return sigueSirviendo ? accesoActual : null;
  }
}

// El Access Token para llamar a Mercado Pago de parte de la tienda, renovado si hacía falta. null si no hay conexión o no se puede usar
// (por ejemplo, venció y no se pudo renovar): quien lo pide sigue con el cobro manual.
export async function tokenVigente(db, tiendaId, { config, secreto }) {
  const fila = await db.prepare('SELECT modo, access_token, expira_en FROM tienda_mercadopago WHERE tienda_id = ?').get(tiendaId);
  if (!fila) return null;
  const porVencer = fila.modo === 'oauth' && fila.expira_en && Date.parse(fila.expira_en) - Date.now() < RENOVAR_ANTES_MS;
  if (!porVencer) return descifrar(fila.access_token, secreto);
  if (!renovaciones.has(tiendaId)) {
    renovaciones.set(tiendaId, renovarToken(db, tiendaId, { config, secreto }).finally(() => renovaciones.delete(tiendaId)));
  }
  return renovaciones.get(tiendaId);
}
