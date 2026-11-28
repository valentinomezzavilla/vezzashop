// Maquetas web (función "Kit de marca y maqueta web" del plan). El cliente sube el material de su marca (marca.js) y pide una maqueta de su tienda; la plataforma le avisa
// a un flujo de n8n (evento "maqueta_solicitada") y n8n, cuando la termina, la entrega en POST /webhooks/maquetas/:id (ver rutas/webhooks.js).
//
// El pedido y la entrega se cuidan así:
//  - Cada pedido tiene un token al azar. Viaja una sola vez, en el aviso a n8n, y n8n lo devuelve al entregar. En la base queda solo su
//    SHA-256: quien no recibió el pedido no puede completarlo, y una maqueta ya resuelta no se pisa.
//  - Lo que entrega n8n es HTML, y el HTML de afuera nunca se confía: limpiarHtml() lo deja solo con lo permitido (sin scripts, formularios,
//    eventos ni links que salgan) y se muestra dentro de un iframe aislado y con CSP (ver rutas/admin-marca.js).
//  - Una maqueta en camino por tienda, tres por día y un tiempo máximo de espera: si n8n nunca contesta, el pedido pasa a error.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { arbolCategorias } from './vidriera.js';
import { urlMiniatura } from './imagenes.js';
import { formatearPesos } from './util/formato.js';

export const MAX_POR_DIA = 3;
export const MAX_GUARDADAS = 5;
export const MINUTOS_DE_ESPERA = 15;
export const MAX_HTML = 300_000;
const LARGO_RESUMEN = 300;

// Los textos que escribe la IA para una maqueta y el largo máximo de cada uno (los mismos que usa el flujo de n8n). `valores` son tres de {titulo, texto}.
export const TEXTOS_DE_MAQUETA = { anuncio: 70, eslogan: 60, bajada: 140, boton: 24, sobreTitulo: 50, sobreTexto: 260, cierre: 70 };
const LARGOS_DE_VALOR = { titulo: 28, texto: 90 };

export const ESTADOS = {
  pendiente: { titulo: 'Generando', enCurso: true },
  generando: { titulo: 'Generando', enCurso: true },
  lista: { titulo: 'Lista', enCurso: false },
  error: { titulo: 'Con problemas', enCurso: false },
};
export const esEstadoDeMaqueta = (valor) => typeof valor === 'string' && Object.hasOwn(ESTADOS, valor);

// Las fechas de la base son texto UTC "2026-11-12 01:03:25".
const comoTexto = (fecha) => fecha.toISOString().slice(0, 19).replace('T', ' ');
const antesDe = (ahora, milisegundos) => comoTexto(new Date(ahora.getTime() - milisegundos));
const unaLinea = (valor, max) => String(valor ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- Token del pedido ----------

export const crearToken = () => randomBytes(32).toString('base64url');
export const hashDeToken = (token) => createHash('sha256').update(String(token)).digest('hex');
function tokenValido(token, hashGuardado) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return false;
  const a = Buffer.from(hashDeToken(token));
  const b = Buffer.from(String(hashGuardado));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------- Lectura ----------

const COLUMNAS = `id, estado, resumen, error, creado_en AS "creadoEn", actualizado_en AS "actualizadoEn", (html IS NOT NULL) AS "tieneHtml"`;
const conDatos = (fila) => (fila ? { ...fila, enCurso: ESTADOS[fila.estado].enCurso } : null);

export async function leerMaqueta(db, tiendaId, id) {
  return conDatos(await db.prepare(`SELECT ${COLUMNAS} FROM maquetas WHERE id = ? AND tienda_id = ?`).get(id, tiendaId));
}

// Las maquetas de la tienda, la más nueva primero (sin el HTML, que pesa).
export async function listarMaquetas(db, tiendaId) {
  return (await db.prepare(`SELECT ${COLUMNAS} FROM maquetas WHERE tienda_id = ? ORDER BY id DESC`).all(tiendaId)).map(conDatos);
}

// Los textos que la IA escribió para la maqueta, ya validados, o null si no hay (la maqueta es de antes, o salió con textos de ejemplo).
export function limpiarTextos(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) return null;
  const textos = {};
  for (const [clave, max] of Object.entries(TEXTOS_DE_MAQUETA)) {
    const valor = typeof entrada[clave] === 'string' ? unaLinea(entrada[clave], max) : '';
    if (valor) textos[clave] = valor;
  }
  if (Array.isArray(entrada.valores)) {
    const valores = entrada.valores.slice(0, 3).map((v) => ({
      titulo: typeof v?.titulo === 'string' ? unaLinea(v.titulo, LARGOS_DE_VALOR.titulo) : '',
      texto: typeof v?.texto === 'string' ? unaLinea(v.texto, LARGOS_DE_VALOR.texto) : '',
    }));
    if (valores.some((v) => v.titulo || v.texto)) textos.valores = valores;
  }
  return Object.keys(textos).length > 0 ? textos : null;
}

// Lo que tenía el kit de marca cuando se pidió la maqueta: el color principal y el nombre del archivo del logo y de la primera foto, que son los que
// usa el flujo de n8n. Se guarda con el pedido para poder llevar a la tienda lo que se ve en esa maqueta (ver usar-maqueta.js).
export function instantaneaDelKit({ marca, archivos }) {
  return {
    colorPrincipal: marca.colorPrincipal || '',
    logo: archivos.find((a) => a.tipo === 'logo')?.archivo ?? null,
    foto: archivos.find((a) => a.tipo === 'foto')?.archivo ?? null,
  };
}
const ARCHIVO_DEL_KIT = /^[\w-]{1,80}\.webp$/;
function kitGuardado(texto) {
  let crudo;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!crudo || typeof crudo !== 'object') return null;
  const archivo = (valor) => (typeof valor === 'string' && ARCHIVO_DEL_KIT.test(valor) ? valor : null);
  return { colorPrincipal: /^#[0-9a-f]{6}$/.test(String(crudo.colorPrincipal)) ? crudo.colorPrincipal : '', logo: archivo(crudo.logo), foto: archivo(crudo.foto) };
}

// Lo que hace falta para llevar una maqueta lista a la tienda: sus textos y el kit de cuando se pidió (null si no se guardaron).
export async function datosParaUsar(db, tiendaId, id) {
  const fila = await db.prepare('SELECT estado, textos, kit FROM maquetas WHERE id = ? AND tienda_id = ?').get(id, tiendaId);
  if (!fila || fila.estado !== 'lista') return null;
  let textos = null;
  try {
    textos = fila.textos ? limpiarTextos(JSON.parse(fila.textos)) : null;
  } catch {
    textos = null;
  }
  return { textos, kit: fila.kit ? kitGuardado(fila.kit) : null };
}

export async function htmlDeMaqueta(db, tiendaId, id) {
  const fila = await db.prepare("SELECT html FROM maquetas WHERE id = ? AND tienda_id = ? AND estado = 'lista'").get(id, tiendaId);
  return fila?.html ?? null;
}

// ---------- Pedido ----------

// Las que n8n nunca entregó (se cayó, se trabó) pasan a error pasado el tiempo de espera, así no bloquean un pedido nuevo.
export async function vencerPendientes(db, tiendaId, ahora = new Date()) {
  const { changes } = await db
    .prepare(
      `UPDATE maquetas SET estado = 'error', error = ?, actualizado_en = ?
       WHERE tienda_id = ? AND estado IN ('pendiente', 'generando') AND creado_en < ?`,
    )
    .run('Tardó más de lo esperado y no llegó. Probá de nuevo.', comoTexto(ahora), tiendaId, antesDe(ahora, MINUTOS_DE_ESPERA * 60_000));
  return changes;
}

// Crea el pedido. Devuelve { id, token } o { error: 'en-curso' | 'limite' }. El token en claro solo existe acá: se lo llevan al aviso a n8n.
// `kit` (instantaneaDelKit) queda guardado con el pedido, para poder usar esa maqueta en la tienda tal como se vio.
export async function pedirMaqueta(db, tiendaId, ahora = new Date(), kit = null) {
  await vencerPendientes(db, tiendaId, ahora);
  if (await db.prepare("SELECT 1 FROM maquetas WHERE tienda_id = ? AND estado IN ('pendiente', 'generando')").get(tiendaId)) return { error: 'en-curso' };
  if ((await pedidasEnElDia(db, tiendaId, ahora)) >= MAX_POR_DIA) return { error: 'limite' };

  const token = crearToken();
  let id;
  try {
    const { rows } = await db
      .prepare('INSERT INTO maquetas (tienda_id, token_hash, creado_en, actualizado_en, kit) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .run(tiendaId, hashDeToken(token), comoTexto(ahora), comoTexto(ahora), kit ? JSON.stringify(kit) : '');
    id = rows[0].id;
  } catch (error) {
    if (error.code === '23505') return { error: 'en-curso' }; // dos pedidos a la vez: la base solo deja pasar uno
    throw error;
  }
  // Se guardan las últimas MAX_GUARDADAS: las más viejas se borran.
  await db
    .prepare('DELETE FROM maquetas WHERE tienda_id = ? AND id NOT IN (SELECT id FROM maquetas WHERE tienda_id = ? ORDER BY id DESC LIMIT ?)')
    .run(tiendaId, tiendaId, MAX_GUARDADAS);
  return { id, token };
}

// n8n no pudo recibir el pedido: la maqueta nunca empezó, así que no ocupa un lugar ni cuenta para el tope del día. Devuelve false si ya no
// se puede descartar porque n8n llegó a empezarla (la respuesta se demoró, pero el pedido sí había llegado).
export async function descartarPedido(db, tiendaId, id) {
  const { changes } = await db.prepare("DELETE FROM maquetas WHERE id = ? AND tienda_id = ? AND estado = 'pendiente'").run(id, tiendaId);
  return changes > 0;
}

// Cuántas maquetas pidió la tienda en las últimas 24 horas (cuentan para el tope diario).
export async function pedidasEnElDia(db, tiendaId, ahora = new Date()) {
  return (await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ? AND creado_en >= ?').get(tiendaId, antesDe(ahora, 24 * 3_600_000))).n;
}

export async function borrarMaqueta(db, tiendaId, id) {
  const { changes } = await db.prepare("DELETE FROM maquetas WHERE id = ? AND tienda_id = ? AND estado IN ('lista', 'error')").run(id, tiendaId);
  return changes > 0;
}

// ---------- Entrega (lo que manda n8n) ----------

// cuerpo: { token, estado: 'generando' | 'lista' | 'error', html?, resumen?, textos?, error? }. `textos` son los que escribió la IA (limpiarTextos): n8n
// solo los manda cuando de verdad los redactó la IA, no cuando salió con textos de ejemplo.
// Devuelve { status, ...} para responderle a n8n: 200 listo, 400 mal armado, 401 token que no corresponde, 409 ya estaba resuelta, 422 HTML inválido.
export async function entregarMaqueta(db, id, cuerpo, ahora = new Date()) {
  const fila = await db.prepare('SELECT estado, token_hash AS "tokenHash" FROM maquetas WHERE id = ?').get(id);
  // Con un id que no existe responde igual que con un token malo: no se puede averiguar qué pedidos existen.
  if (!fila || !tokenValido(cuerpo?.token, fila.tokenHash)) return { status: 401, error: 'Token inválido' };
  const estado = cuerpo.estado;
  if (!['generando', 'lista', 'error'].includes(estado)) return { status: 400, error: 'estado tiene que ser generando, lista o error' };
  // Repetir lo mismo (un reintento de n8n cuando la respuesta se perdió) no es un problema; cambiar una maqueta resuelta, sí.
  if (!ESTADOS[fila.estado].enCurso) return fila.estado === estado ? { status: 200, ok: true, repetida: true } : { status: 409, error: 'La maqueta ya estaba resuelta' };

  const momento = comoTexto(ahora);
  let cambios;
  if (estado === 'generando') {
    cambios = await db.prepare("UPDATE maquetas SET estado = 'generando', actualizado_en = ? WHERE id = ? AND estado IN ('pendiente', 'generando')").run(momento, id);
  } else if (estado === 'lista') {
    const html = limpiarHtml(cuerpo.html);
    if (!html) {
      await db
        .prepare("UPDATE maquetas SET estado = 'error', error = ?, actualizado_en = ? WHERE id = ? AND estado IN ('pendiente', 'generando')")
        .run('La maqueta que se generó no se pudo mostrar. Probá de nuevo.', momento, id);
      return { status: 422, error: 'El HTML no es válido o es demasiado grande' };
    }
    const textos = limpiarTextos(cuerpo.textos);
    cambios = await db
      .prepare("UPDATE maquetas SET estado = 'lista', html = ?, resumen = ?, textos = ?, error = '', actualizado_en = ? WHERE id = ? AND estado IN ('pendiente', 'generando')")
      .run(html, unaLinea(cuerpo.resumen, LARGO_RESUMEN), textos ? JSON.stringify(textos) : '', momento, id);
  } else {
    const motivo = unaLinea(cuerpo.error, LARGO_RESUMEN) || 'No pudimos generar la maqueta. Probá de nuevo.';
    cambios = await db
      .prepare("UPDATE maquetas SET estado = 'error', error = ?, actualizado_en = ? WHERE id = ? AND estado IN ('pendiente', 'generando')")
      .run(motivo, momento, id);
  }
  return cambios.changes ? { status: 200, ok: true } : { status: 409, error: 'La maqueta ya estaba resuelta' };
}

// ---------- Lo que se le manda a n8n ----------

// Hasta `limite` productos visibles para que la maqueta se parezca a la tienda: primero los que tienen foto y los destacados.
// `precio` va ya como texto ("$ 12.900"). Y las categorías de primer nivel que tienen productos.
export async function catalogoDeMuestra(db, tiendaId, { limite = 8 } = {}) {
  const productos = await db
    .prepare(
      `SELECT nombre, foto, precio FROM (
         SELECT p.id, p.nombre, p.destacado,
                (SELECT archivo FROM producto_fotos f WHERE f.producto_id = p.id ORDER BY f.orden, f.id LIMIT 1) AS foto,
                min(coalesce(v.precio_promocional_centavos, v.precio_centavos)) AS precio
         FROM productos p JOIN variantes v ON v.producto_id = p.id
         WHERE p.tienda_id = ? AND p.visible = 1
         GROUP BY p.id
       ) AS visibles
       ORDER BY (foto IS NULL), destacado DESC, id DESC
       LIMIT ?`,
    )
    .all(tiendaId, limite);
  const categorias = (await arbolCategorias(db, tiendaId)).slice(0, limite).map((c) => c.nombre);
  return {
    categorias,
    productos: productos.map((p) => ({ nombre: p.nombre, precio: formatearPesos(p.precio), foto: p.foto })),
  };
}

// El cuerpo del aviso "maqueta_solicitada". `urlBase` es la dirección pública del panel (con ella se arman los links absolutos: n8n y la IA
// no ven la carpeta de subidas de la plataforma, solo lo que sirve por internet).
//  { maqueta: { id, token, respuesta }, tienda: { nombre, url }, marca: { colores: { principal, secundario, acento }, rubro, estilo,
//    descripcion, referencias }, archivos: [{ tipo, nombre, url, miniatura }], logoTienda, catalogo: { categorias, productos: [{ nombre, precio, foto }] } }
export function armarPedido({ id, token, urlBase, tienda, urlTienda, marca, colorTienda, archivos, logoTienda, catalogo }) {
  const absoluta = (ruta) => (ruta ? `${urlBase}${ruta}` : null);
  return {
    maqueta: { id, token, respuesta: `${urlBase}/webhooks/maquetas/${id}` },
    tienda: { nombre: tienda.nombre, url: urlTienda },
    marca: {
      colores: { principal: marca.colorPrincipal || colorTienda, secundario: marca.colorSecundario || null, acento: marca.colorAcento || null },
      rubro: marca.rubro,
      estilo: marca.estilo,
      descripcion: marca.descripcion,
      referencias: marca.referencias,
    },
    archivos: archivos.map((a) => ({ tipo: a.tipo, nombre: a.nombre, url: absoluta(a.url), miniatura: absoluta(a.miniatura) })),
    logoTienda: absoluta(logoTienda),
    catalogo: {
      categorias: catalogo.categorias,
      productos: catalogo.productos.map((p) => ({ nombre: p.nombre, precio: p.precio, foto: absoluta(urlMiniatura(tienda.id, p.foto, 'm')) })),
    },
  };
}

// ---------- HTML de afuera: solo lo permitido ----------

const ETIQUETAS_SVG = new Set(['svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g']);
const ETIQUETAS = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'style',
  'div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'figure', 'figcaption', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'ul', 'ol', 'li', 'img', 'button', 'br', 'hr',
  'strong', 'em', 'b', 'i', 'u', 's', 'small', 'sup', 'sub', 'mark', 'address', 'time',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  ...ETIQUETAS_SVG,
]);
const VACIAS = new Set(['meta', 'link', 'img', 'br', 'hr']);
// Estas se descartan con todo lo que llevan adentro (un <script> no puede dejar su texto suelto en la página).
// (<embed> y <frame> no están: no tienen cierre, y esperar uno se tragaría el resto de la página. Como cualquier etiqueta que no está en
// la lista de permitidas, se descartan solas.)
const CON_CONTENIDO_FUERA = new Set([
  'script', 'iframe', 'object', 'applet', 'noscript', 'template', 'textarea', 'select', 'option', 'optgroup', 'frameset',
  'xmp', 'plaintext', 'noembed', 'noframes', 'audio', 'video', 'canvas', 'math', 'foreignobject', 'datalist', 'dialog',
]);
const ATRIBUTOS_SVG = new Set([
  'viewbox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-opacity', 'fill-opacity', 'fill-rule', 'clip-rule', 'opacity',
  'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'xmlns', 'preserveaspectratio', 'focusable',
]);
const ATRIBUTOS_GLOBALES = new Set(['class', 'id', 'lang', 'title', 'role', 'width', 'height']);

// Solo se aceptan direcciones https:// y /subidas/…: lo demás (javascript:, data:, //otrodominio) se descarta. Como tiene que empezar con
// esas letras tal cual, no se puede esconder un "javascript:" con entidades (&#106;avascript:).
function direccionDeImagen(valor) {
  const v = valor.trim();
  if (/[\u0000- \u007f"'<>`\\]/.test(v)) return null;
  return /^(https:\/\/[^/]|\/subidas\/)/i.test(v) ? v : null;
}

const direccionDeCss = (valor) => /^(https:\/\/[^/]|\/subidas\/|data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$)/i.test(valor.trim());

// CSS (de un <style> o de un atributo style): sin @import, sin escapes que escondan palabras, sin expression()/behavior/javascript: y con
// url() solo hacia imágenes permitidas. Si encuentra algo de eso, descarta todo el CSS: es mejor una maqueta sin estilos que una trampa.
export function limpiarCss(entrada) {
  let css = String(entrada ?? '').replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  if (css.length > 150_000) return '';
  // Los textos entre comillas pueden llevar cualquier cosa (content: "\201C"): se miran aparte.
  const sinTextos = css.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  if (/\\/.test(sinTextos)) return '';
  const compacto = sinTextos.replace(/\s+/g, '').toLowerCase();
  // image-set() y src() también cargan imágenes a partir de un texto, sin pasar por url().
  if (/@import|@charset|@namespace|@font-face|expression\(|behavior:|-moz-binding|javascript:|vbscript:|image-set\(|(?<![a-z-])src\(|<|-->/.test(compacto)) return '';
  let valido = true;
  css = css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_, __, direccion) => {
    if (direccionDeCss(direccion)) return `url("${direccion.trim().replace(/"/g, '%22')}")`;
    valido = false;
    return 'none';
  });
  return valido ? css.trim() : '';
}

const escaparAtributo = (valor) => valor.replace(/&(?!(?:amp|lt|gt|quot|#39|#\d{1,6}|#x[0-9a-f]{1,6}|[a-z]{2,10});)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escaparTexto = (valor) => valor.replace(/</g, '&lt;');

// Devuelve el atributo ya limpio (`nombre="valor"`) o null si no se permite.
function atributoPermitido(etiqueta, nombre, valor) {
  if (/^aria-[a-z-]+$/.test(nombre)) return `${nombre}="${escaparAtributo(valor)}"`;
  if (nombre === 'style') {
    const css = limpiarCss(valor);
    return css ? `style="${escaparAtributo(css)}"` : null;
  }
  if (etiqueta === 'a' && nombre === 'href') return /^#[\w-]{0,60}$/.test(valor.trim()) ? `href="${valor.trim()}"` : null;
  if (etiqueta === 'img') {
    if (nombre === 'src') {
      const direccion = direccionDeImagen(valor);
      return direccion ? `src="${escaparAtributo(direccion)}"` : null;
    }
    if (nombre === 'alt') return `alt="${escaparAtributo(valor)}"`;
    if (nombre === 'loading') return /^(lazy|eager)$/.test(valor) ? `loading="${valor}"` : null;
  }
  if ((etiqueta === 'td' || etiqueta === 'th') && (nombre === 'colspan' || nombre === 'rowspan')) return /^\d{1,2}$/.test(valor) ? `${nombre}="${valor}"` : null;
  if (ETIQUETAS_SVG.has(etiqueta) && ATRIBUTOS_SVG.has(nombre)) return `${nombre}="${escaparAtributo(valor)}"`;
  if (ATRIBUTOS_GLOBALES.has(nombre)) return `${nombre}="${escaparAtributo(valor)}"`;
  return null;
}

const LINK_PERMITIDO = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com(?:\/|$)/i;
const META_PERMITIDA = new Set(['viewport', 'description', 'theme-color', 'color-scheme']);

function atributosDe(texto) {
  const lista = [];
  for (const m of texto.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    lista.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '']);
  }
  return lista;
}

// <meta> y <link> se resuelven enteros (qué es y a dónde apunta), no atributo por atributo.
function etiquetaMeta(atributos) {
  const mapa = new Map(atributos);
  if (mapa.has('charset')) return '<meta charset="utf-8">';
  const nombre = String(mapa.get('name') ?? '').toLowerCase();
  if (META_PERMITIDA.has(nombre) && mapa.has('content')) return `<meta name="${nombre}" content="${escaparAtributo(mapa.get('content'))}">`;
  return '';
}
function etiquetaLink(atributos) {
  const mapa = new Map(atributos);
  const rel = String(mapa.get('rel') ?? '').toLowerCase();
  const href = String(mapa.get('href') ?? '').trim();
  if (!['stylesheet', 'preconnect'].includes(rel) || !LINK_PERMITIDO.test(href) || /[\u0000- \u007f"'<>`\\]/.test(href)) return '';
  return `<link rel="${rel}" href="${escaparAtributo(href)}"${rel === 'preconnect' && mapa.has('crossorigin') ? ' crossorigin' : ''}>`;
}

// Devuelve el HTML limpio (siempre un documento completo, en UTF-8 y con viewport) o null si no hay nada que mostrar o es muy grande.
// Es una lista de lo permitido: lo que no está en la lista se descarta, y lo que no se entiende no pasa.
export function limpiarHtml(entrada) {
  const html = typeof entrada === 'string' ? entrada : '';
  if (html.length === 0 || html.length > MAX_HTML) return null;
  const minusculas = html.toLowerCase();
  const patron = /<!--[\s\S]*?(?:-->|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>?/g;
  let salida = '';
  let desde = 0;
  let coincidencia;
  // Salta hasta después del cierre de `nombre` (o hasta el final si no cierra).
  const saltarHasta = (nombre) => {
    const cierre = minusculas.indexOf(`</${nombre}`, patron.lastIndex);
    if (cierre === -1) return (patron.lastIndex = html.length);
    const fin = html.indexOf('>', cierre);
    return (patron.lastIndex = fin === -1 ? html.length : fin + 1);
  };

  while ((coincidencia = patron.exec(html)) !== null) {
    salida += escaparTexto(html.slice(desde, coincidencia.index));
    desde = patron.lastIndex;
    const [textoEtiqueta, cierra, nombreOriginal, atributosTexto] = coincidencia;
    if (nombreOriginal === undefined) {
      if (/^<!doctype\s+html\s*>$/i.test(textoEtiqueta)) salida += '<!doctype html>';
      continue; // comentarios, CDATA y demás: afuera
    }
    const nombre = nombreOriginal.toLowerCase();
    if (CON_CONTENIDO_FUERA.has(nombre)) {
      if (!cierra) desde = saltarHasta(nombre);
      continue;
    }
    if (nombre === 'style') {
      if (cierra) continue;
      const finEstilo = minusculas.indexOf('</style', patron.lastIndex);
      const contenido = html.slice(patron.lastIndex, finEstilo === -1 ? html.length : finEstilo);
      saltarHasta('style');
      desde = patron.lastIndex;
      const css = limpiarCss(contenido);
      if (css) salida += `<style>${css}</style>`;
      continue;
    }
    if (!ETIQUETAS.has(nombre)) continue; // se descarta la etiqueta; el texto que lleva adentro queda
    if (cierra) {
      if (!VACIAS.has(nombre)) salida += `</${nombre}>`;
      continue;
    }
    const atributos = atributosDe(atributosTexto);
    if (nombre === 'meta') {
      salida += etiquetaMeta(atributos);
      continue;
    }
    if (nombre === 'link') {
      salida += etiquetaLink(atributos);
      continue;
    }
    const permitidos = [];
    const vistos = new Set();
    for (const [atributo, valor] of atributos) {
      if (vistos.has(atributo)) continue;
      vistos.add(atributo);
      const limpio = atributoPermitido(nombre, atributo, valor);
      if (limpio) permitidos.push(limpio);
    }
    const autoCerrada = (VACIAS.has(nombre) || ETIQUETAS_SVG.has(nombre)) && /\/\s*$/.test(atributosTexto);
    salida += `<${nombre}${permitidos.length ? ` ${permitidos.join(' ')}` : ''}${autoCerrada ? '/' : ''}>`;
  }
  salida += escaparTexto(html.slice(desde));

  // Tiene que quedar algo para ver.
  const texto = salida.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  if (texto.length < 20 && !/<img\b/.test(salida)) return null;
  const metas = (/<meta charset=/.test(salida) ? '' : '<meta charset="utf-8">') + (/<meta name="viewport"/.test(salida) ? '' : '<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (!/<body[\s>]/.test(salida)) return `<!doctype html><html lang="es"><head>${metas}</head><body>${salida}</body></html>`;
  // Un documento completo: solo se asegura el modo estándar, el UTF-8 y el viewport.
  if (metas) {
    if (/<head[\s>]/.test(salida)) salida = salida.replace(/<head[^>]*>/, (m) => m + metas);
    else if (/<html[\s>]/.test(salida)) salida = salida.replace(/<html[^>]*>/, (m) => `${m}<head>${metas}</head>`);
    else salida = salida.replace(/<body/, `<head>${metas}</head><body`);
  }
  return /^\s*<!doctype html>/i.test(salida) ? salida : `<!doctype html>${salida}`;
}
