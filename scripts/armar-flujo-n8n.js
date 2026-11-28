// Arma el flujo de n8n "VEZZA Shop · Maquetas web" (n8n/maqueta-web.json) a partir del código de sus dos nodos Code, que viven en el repo:
// n8n/maqueta-pedido.js y n8n/maqueta-armar.js. Así el flujo que se importa en n8n y el código que prueban los tests son el mismo.
//
//   node scripts/armar-flujo-n8n.js          escribe n8n/maqueta-web.json
//
// En n8n: Workflows → Import from file → n8n/maqueta-web.json. Después, en el nodo Webhook elegí la credencial Header Auth con el secreto
// (el mismo valor que N8N_WEBHOOK_SECRET), en "Redactar los textos" la de Google Gemini, y activá el flujo. Su URL de producción
// (https://tu-n8n/webhook/vezza-shop-maquetas) va en N8N_MAQUETAS_URL. Ver "Maquetas web con n8n" en el README.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(import.meta.dirname, '..');
const ARCHIVO_DEL_FLUJO = path.join(RAIZ, 'n8n', 'maqueta-web.json');

// Las credenciales y el flujo de errores del n8n de VEZZA (solo el id y el nombre, nunca el valor del secreto). Si se importa en otro n8n,
// hay que volver a elegirlas en cada nodo.
const CREDENCIALES = {
  secretoDelWebhook: { id: 'HrCioYqdRu6KDiM6', name: 'VEZZA Shop · Secreto del webhook de cuentas' },
  gemini: { id: 'Mr4Q9UJBLiPegvv2', name: 'Google Gemini(PaLM) Api account' },
};
const FLUJO_DE_ERRORES = 'uvPis6hStR8EmYoX'; // "VEZZA · Alerta de errores"
export const MODELO_DE_GEMINI = 'models/gemini-3.5-flash-lite';

const id = (n) => `b7e4c2a1-5d3f-4a6b-8c90-0000000000${String(n).padStart(2, '0')}`;

const NOTA_DEL_FLUJO = [
  '## VEZZA Shop · Maquetas web',
  'Lo llama VEZZA Shop cuando un cliente del plan Acompañado pide la maqueta de su tienda (evento `maqueta_solicitada`, ver `src/maquetas.js` en el repo).',
  '',
  '1. **Pedido de VEZZA Shop**: recibe el pedido. El secreto lo valida el nodo (Header Auth).',
  '2. **Validar y armar el pedido**: revisa todo y arma el texto para la IA. La entrega solo puede ir a `/webhooks/maquetas/<id>` de la plataforma.',
  '3. **Responder 202**: le contesta enseguida a la plataforma (la IA tarda más que lo que espera) y el resto sigue por su cuenta.',
  '4. **Redactar los textos**: Gemini escribe los textos de la maqueta. Si falla, la maqueta sale igual con textos de ejemplo.',
  '5. **Armar la maqueta**: el diseño es una plantilla propia con los colores, el logo, las fotos y los productos de la tienda.',
  '6. **Entregar la maqueta**: la manda a la plataforma con el token de ese pedido. Si no llega, la plataforma la da por fallida a los 15 minutos.',
  '',
  'El código de los dos nodos Code vive en el repo (`n8n/maqueta-pedido.js` y `n8n/maqueta-armar.js`) y este flujo se arma con `node scripts/armar-flujo-n8n.js`.',
].join('\n');

// pedido, armar: el código (el texto) de los dos nodos Code. Devuelve el flujo listo para importar en n8n o crear con su API.
export function armarFlujo({ pedido, armar }) {
  return {
    name: 'VEZZA Shop · Maquetas web',
    nodes: [
      {
        id: id(1),
        name: 'Qué hace este flujo',
        type: 'n8n-nodes-base.stickyNote',
        typeVersion: 1,
        position: [0, -300],
        parameters: { content: NOTA_DEL_FLUJO, height: 260, width: 1100 },
      },
      {
        id: id(2),
        name: 'Pedido de VEZZA Shop',
        webhookId: 'e2a9f6d4-7b1c-4c85-9a3e-5f0d8b6c4a21',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2.1,
        position: [0, 176],
        parameters: { httpMethod: 'POST', path: 'vezza-shop-maquetas', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
        credentials: { httpHeaderAuth: CREDENCIALES.secretoDelWebhook },
      },
      {
        id: id(3),
        name: 'Validar y armar el pedido',
        notes: 'Why Code: valida el pedido (ids, token, destino de la entrega, colores, links) y arma el texto para la IA; con nodos nativos serían más de cuatro. El código vive en el repo: n8n/maqueta-pedido.js.',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [224, 176],
        parameters: { jsCode: pedido },
      },
      {
        id: id(4),
        name: '¿Pedido válido?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2.2,
        position: [448, 176],
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: 'c1', leftValue: '={{ $json.valido }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
            combinator: 'and',
          },
          options: {},
        },
      },
      {
        id: id(5),
        name: 'Responder 202',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.5,
        position: [672, 80],
        parameters: { respondWith: 'json', responseBody: '={{ { recibido: true } }}', options: { responseCode: 202 } },
      },
      {
        id: id(6),
        name: 'Responder error 400',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.5,
        position: [672, 320],
        parameters: { respondWith: 'json', responseBody: '={{ { ok: false, errors: $json.errores } }}', options: { responseCode: 400 } },
      },
      {
        id: id(7),
        name: 'Redactar los textos',
        notes: 'Gemini escribe solo los textos (título, bajada, valores...). Si falla o contesta cualquier cosa, el nodo siguiente usa textos de ejemplo.',
        type: '@n8n/n8n-nodes-langchain.googleGemini',
        typeVersion: 1.2,
        position: [896, 80],
        parameters: {
          resource: 'text',
          operation: 'message',
          modelId: { __rl: true, value: MODELO_DE_GEMINI, mode: 'id' },
          messages: { values: [{ content: '={{ $json.prompt }}', role: 'user' }] },
          simplify: true,
          jsonOutput: true,
          options: { temperature: 0.7 },
        },
        credentials: { googlePalmApi: CREDENCIALES.gemini },
        onError: 'continueRegularOutput',
      },
      {
        id: id(8),
        name: 'Armar la maqueta',
        notes: 'Why Code: la maqueta es una plantilla HTML con la marca de la tienda y los textos de la IA; con nodos nativos no se puede armar. El código vive en el repo: n8n/maqueta-armar.js.',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1120, 80],
        parameters: { jsCode: armar },
      },
      {
        id: id(9),
        name: 'Entregar la maqueta',
        notes: 'POST a la plataforma con el token de este pedido. Si falla tres veces, el flujo falla y avisa el flujo de errores; la plataforma da el pedido por fallido a los 15 minutos.',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.5,
        position: [1344, 80],
        retryOnFail: true,
        maxTries: 3,
        waitBetweenTries: 3000,
        parameters: {
          method: 'POST',
          url: '={{ $json.respuesta }}',
          sendBody: true,
          contentType: 'json',
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ token: $json.token, estado: $json.estado, html: $json.html, resumen: $json.resumen, error: $json.error }) }}',
          options: { timeout: 20000 },
        },
      },
    ],
    connections: {
      'Pedido de VEZZA Shop': { main: [[{ node: 'Validar y armar el pedido', type: 'main', index: 0 }]] },
      'Validar y armar el pedido': { main: [[{ node: '¿Pedido válido?', type: 'main', index: 0 }]] },
      '¿Pedido válido?': {
        main: [[{ node: 'Responder 202', type: 'main', index: 0 }], [{ node: 'Responder error 400', type: 'main', index: 0 }]],
      },
      'Responder 202': { main: [[{ node: 'Redactar los textos', type: 'main', index: 0 }]] },
      'Redactar los textos': { main: [[{ node: 'Armar la maqueta', type: 'main', index: 0 }]] },
      'Armar la maqueta': { main: [[{ node: 'Entregar la maqueta', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1', executionTimeout: 180, errorWorkflow: FLUJO_DE_ERRORES },
  };
}

export function flujoDesdeElRepo() {
  const leer = (nombre) => readFileSync(path.join(RAIZ, 'n8n', nombre), 'utf8');
  return armarFlujo({ pedido: leer('maqueta-pedido.js'), armar: leer('maqueta-armar.js') });
}

export const textoDelFlujo = () => `${JSON.stringify(flujoDesdeElRepo(), null, 2)}\n`;
export { ARCHIVO_DEL_FLUJO };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(ARCHIVO_DEL_FLUJO, textoDelFlujo());
  console.log(`Listo: ${path.relative(process.cwd(), ARCHIVO_DEL_FLUJO)}`);
}
