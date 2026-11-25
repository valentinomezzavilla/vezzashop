// Cifrado de los secretos que la plataforma guarda por las tiendas (hoy: los tokens de Mercado Pago), para que no queden en claro en la base.
// AES-256-GCM, con una clave que se deriva (HKDF) de SECRETO_SESION y de un texto fijo que dice para qué sirve: la misma variable que firma
// las sesiones no se usa directamente como clave. Consecuencia: igual que con las sesiones, SECRETO_SESION no puede cambiar (si cambia, los
// tokens guardados no se pueden leer y cada tienda tiene que volver a conectar Mercado Pago).
// Formato: "v1.<iv>.<etiqueta>.<texto cifrado>", todo en base64url. Cada cifrado lleva su propio iv, así el mismo texto da resultados distintos.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const USO = 'vezzashop/secretos/v1';

function claveDe(secreto) {
  if (typeof secreto !== 'string' || secreto.length < 32) throw new Error('El secreto para cifrar tiene que tener al menos 32 caracteres');
  return Buffer.from(hkdfSync('sha256', secreto, 'vezzashop', USO, 32));
}

export function cifrar(texto, secreto) {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', claveDe(secreto), iv);
  const cifrado = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  return [VERSION, iv.toString('base64url'), cifrador.getAuthTag().toString('base64url'), cifrado.toString('base64url')].join('.');
}

// El texto original, o null si no se puede leer (otro secreto, valor alterado o formato que no es el nuestro). Nunca tira por un valor malo.
export function descifrar(valor, secreto) {
  const partes = String(valor ?? '').split('.');
  if (partes.length !== 4 || partes[0] !== VERSION) return null;
  try {
    const [, iv, etiqueta, cifrado] = partes.map((parte, n) => (n === 0 ? parte : Buffer.from(parte, 'base64url')));
    const descifrador = createDecipheriv('aes-256-gcm', claveDe(secreto), iv);
    descifrador.setAuthTag(etiqueta);
    return Buffer.concat([descifrador.update(cifrado), descifrador.final()]).toString('utf8');
  } catch {
    return null;
  }
}
