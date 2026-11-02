import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const PARAMETROS = { N: 16384, r: 8, p: 1 };
const LARGO_HASH = 64;

// Formato guardado: scrypt$N$r$p$sal$hash (sal y hash en base64)
export async function hashClave(clave) {
  const sal = randomBytes(16);
  const hash = await scryptAsync(clave, sal, LARGO_HASH, PARAMETROS);
  const { N, r, p } = PARAMETROS;
  return ['scrypt', N, r, p, sal.toString('base64'), hash.toString('base64')].join('$');
}

export async function verificarClave(clave, guardado) {
  const [algoritmo, N, r, p, sal, hash] = guardado.split('$');
  if (algoritmo !== 'scrypt') return false;
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scryptAsync(clave, Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(esperado, calculado);
}

export function generarClave() {
  return randomBytes(12).toString('base64url'); // 16 caracteres
}
