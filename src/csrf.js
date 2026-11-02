// Protección CSRF: cada formulario manda un token que tiene que coincidir con el de la sesión.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function tokenCsrf(req) {
  req.session.csrf ??= randomBytes(24).toString('base64url');
  return req.session.csrf;
}

export function verificarCsrf(req, res, next) {
  const esperado = req.session?.csrf;
  const enviado = req.body?._csrf;
  const valido =
    typeof esperado === 'string' &&
    typeof enviado === 'string' &&
    esperado.length === enviado.length &&
    timingSafeEqual(Buffer.from(esperado), Buffer.from(enviado));
  if (!valido) {
    return res.status(403).render('error', {
      titulo: 'La página venció',
      mensaje: 'Volvé a cargar la página e intentá de nuevo.',
    });
  }
  next();
}
