// Las direcciones de n8n que se cargan por variable de entorno (N8N_WEBHOOK_URL para los mails y N8N_MAQUETAS_URL para las maquetas).
// Un valor mal cargado (sin https://, entre comillas, con el nombre de la variable adentro) hacía fallar cada aviso con "Failed to parse URL":
// ahora se limpia lo que se puede y, si igual no sirve, se avisa una vez en el log y la función queda apagada.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { leerConfig } from '../src/config.js';
import { crearNotificador } from '../src/notificaciones.js';

const base = { SECRETO_SESION: 'secreto-de-prueba-de-al-menos-32-caracteres' };
const BUENA = 'https://n8n.ejemplo.com/webhook/vezza-shop-maquetas';

// Corre `leerConfig` y devuelve la configuración y lo que quedó escrito en el log de errores.
function leer(env) {
  const log = mock.method(console, 'error', () => {});
  try {
    const config = leerConfig({ ...base, ...env });
    return { config, avisos: log.mock.calls.map((llamada) => llamada.arguments.join(' ')) };
  } finally {
    log.mock.restore();
  }
}

test('una dirección bien cargada se usa tal cual, y el secreto de las maquetas sale de donde corresponde', () => {
  const { config, avisos } = leer({ N8N_MAQUETAS_URL: BUENA, N8N_WEBHOOK_URL: 'https://n8n.ejemplo.com/webhook/vezza-shop-cuentas', N8N_WEBHOOK_SECRET: ' compartido ' });
  assert.deepEqual(config.maquetas, { url: BUENA, secreto: 'compartido' }, 'sin N8N_MAQUETAS_SECRET usa el de los mails');
  assert.deepEqual(config.n8n, { url: 'https://n8n.ejemplo.com/webhook/vezza-shop-cuentas', secreto: 'compartido' });
  assert.deepEqual(avisos, []);
  assert.deepEqual(leer({ N8N_MAQUETAS_URL: BUENA, N8N_MAQUETAS_SECRET: 'propio', N8N_WEBHOOK_SECRET: 'compartido' }).config.maquetas, { url: BUENA, secreto: 'propio' });
  assert.deepEqual(leer({ N8N_MAQUETAS_URL: BUENA }).config.maquetas, { url: BUENA, secreto: '' });
  assert.equal(leer({ N8N_MAQUETAS_URL: 'http://127.0.0.1:5678/webhook/x' }).config.maquetas.url, 'http://127.0.0.1:5678/webhook/x', 'http también vale (n8n en la misma red)');
});

test('con espacios, comillas o el nombre de la variable de más, la dirección se limpia', () => {
  for (const valor of [`  ${BUENA}  `, `"${BUENA}"`, `'${BUENA}'`, ` " ${BUENA} " `, `N8N_MAQUETAS_URL=${BUENA}`, `N8N_MAQUETAS_URL = "${BUENA}"`, `${BUENA}\n`]) {
    const { config, avisos } = leer({ N8N_MAQUETAS_URL: valor });
    assert.equal(config.maquetas?.url, BUENA, JSON.stringify(valor));
    assert.deepEqual(avisos, [], 'se corrige sin hacer ruido');
  }
  // Lo mismo para los mails.
  assert.equal(leer({ N8N_WEBHOOK_URL: `"${BUENA}"` }).config.n8n.url, BUENA);
});

test('una dirección que no es una dirección se ignora con un aviso que dice qué llegó, en vez de fallar en cada pedido', () => {
  for (const valor of ['n8n.ejemplo.com/webhook/vezza-shop-maquetas', 'https://', 'ftp://n8n.ejemplo.com/x', 'javascript:alert(1)', 'no es una url', '"', "'", 'N8N_MAQUETAS_URL=']) {
    const { config, avisos } = leer({ N8N_MAQUETAS_URL: valor });
    if (valor === '"' || valor === "'" || valor === 'N8N_MAQUETAS_URL=') {
      // Quedan vacías después de limpiarlas: es como no haberla cargado.
      assert.equal(config.maquetas, null, JSON.stringify(valor));
      continue;
    }
    assert.equal(config.maquetas, null, `se apaga: ${JSON.stringify(valor)}`);
    assert.equal(avisos.length, 1, `un solo aviso: ${JSON.stringify(valor)}`);
    assert.match(avisos[0], /^N8N_MAQUETAS_URL no es una dirección válida y se ignora/);
    assert.ok(avisos[0].includes(JSON.stringify(valor)), 'dice el valor que llegó');
    assert.ok(avisos[0].includes('https://'), 'y cómo tiene que ser');
  }
  const { config, avisos } = leer({ N8N_WEBHOOK_URL: 'n8n.ejemplo.com/webhook/x', N8N_MAQUETAS_URL: BUENA });
  assert.equal(config.n8n, null, 'la de los mails también');
  assert.match(avisos[0], /^N8N_WEBHOOK_URL no es una dirección válida/);
  assert.equal(config.maquetas.url, BUENA, 'y una no afecta a la otra');
  // Un valor larguísimo no llena el log.
  assert.ok(leer({ N8N_MAQUETAS_URL: `x${'y'.repeat(500)}` }).avisos[0].length < 400);
});

test('sin dirección cargada no hay aviso: la función simplemente no está', () => {
  for (const env of [{}, { N8N_MAQUETAS_URL: '' }, { N8N_MAQUETAS_URL: '   ' }, { N8N_WEBHOOK_URL: '', N8N_MAQUETAS_URL: undefined }]) {
    const { config, avisos } = leer(env);
    assert.equal(config.maquetas, null);
    assert.equal(config.n8n, null);
    assert.deepEqual(avisos, []);
  }
});

test('el aviso a n8n con la dirección ya limpia llega (y con una mala no hace falta: ya quedó apagado)', async () => {
  const pedidos = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opciones) => {
    pedidos.push({ url, cuerpo: JSON.parse(opciones.body), secreto: opciones.headers['x-webhook-secret'] });
    return new Response('{}', { status: 200 });
  };
  try {
    const { config } = leer({ N8N_MAQUETAS_URL: `"${BUENA}"`, N8N_WEBHOOK_SECRET: 'compartido' });
    assert.equal(await crearNotificador(config.maquetas)('maqueta_solicitada', { maqueta: { id: 1 } }), true);
    assert.deepEqual(pedidos, [{ url: BUENA, cuerpo: { evento: 'maqueta_solicitada', maqueta: { id: 1 } }, secreto: 'compartido' }]);
    const { config: mala } = leer({ N8N_MAQUETAS_URL: 'n8n.ejemplo.com/webhook/x' });
    assert.equal(await crearNotificador(mala.maquetas)('maqueta_solicitada', {}), false, 'sin dirección válida no se intenta nada');
    assert.equal(pedidos.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
