// Avisos por mail de la plataforma. No manda mails: le avisa por webhook a un flujo de n8n (N8N_WEBHOOK_URL), que arma y envía el mail.
//
// Eventos (se mandan como JSON con el campo `evento`, y el secreto compartido en el header X-Webhook-Secret):
//  - cuenta_creada:  { evento, email, nombre, apellido, tienda: { nombre, url }, plan: { nombre, precio }, urlPanel }
//                    -> "Tu cuenta está lista", con el link para entrar a gestionarla. Nunca lleva la contraseña.
//  - pago_recibido:  { evento, email, plan: { nombre, precio }, urlCuenta }
//                    -> "Recibimos tu pago, creá tu cuenta", con el link al formulario (por si cerró la pestaña antes de completarlo).
//  - plan_modificado: { evento, email, nombre, tienda: { nombre }, plan: { nombre }, cambios: [{ etiqueta, antes, despues, cuando }], urlPanel }
//                    -> "Cambió tu plan": qué cambió (precio, topes...) y desde cuándo ("desde tu próximo cobro (10 de febrero de 2030)" o
//                    "desde ya"). Va a cada cliente del plan al que le cambia algo; a quien conserva su precio no se le avisa del precio.
//  - suscripcion_cancelada: { evento, email, nombre, apellido, tienda: { nombre }, plan: { nombre }, accesoHasta, accesoHastaTexto, vencida, urlReactivar }
//                    -> "Cancelaste tu suscripción": la tienda sigue activa hasta `accesoHastaTexto` ("25 de noviembre de 2026"; si `vencida`
//                    es true ya no tiene días pagos y esos campos vienen vacíos) y se puede reactivar cuando quiera desde `urlReactivar`.

const TIEMPO_MAXIMO_MS = 8_000;

// El cuerpo del aviso "cuenta_creada". `precio` ya viene como texto ("$ 12.900 / mes").
export const armarAvisoCuentaCreada = ({ email, nombre, apellido, tiendaNombre, tiendaUrl, planNombre, precio, urlPanel }) => ({
  email,
  nombre,
  apellido,
  tienda: { nombre: tiendaNombre, url: tiendaUrl },
  plan: { nombre: planNombre, precio },
  urlPanel,
});

// Devuelve una función avisar(evento, datos) que nunca falla: si n8n no está configurado, no responde o da error, queda en el
// log y devuelve false. Un mail que no sale no tiene que romper un alta ni un cobro.
export function crearNotificador(n8n) {
  return async function avisar(evento, datos) {
    if (!n8n?.url) return false;
    try {
      const respuesta = await fetch(n8n.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(n8n.secreto && { 'x-webhook-secret': n8n.secreto }) },
        body: JSON.stringify({ evento, ...datos }),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      if (!respuesta.ok) {
        console.error(`n8n respondió ${respuesta.status} al aviso "${evento}"`);
        return false;
      }
      return true;
    } catch (error) {
      console.error(`No se pudo avisar a n8n ("${evento}"): ${error.message}`);
      return false;
    }
  };
}
