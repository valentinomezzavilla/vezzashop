// Dominio propio de una tienda (una función del plan: la tienen los planes que la tildan): pedirlo, verificar el DNS, activarlo y que la tienda se vea ahí.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda, buscarTienda, buscarTiendaPorDominio } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { crearPlan, crearSuperadmin } from '../src/plataforma.js';
import { funcionesDePreset } from '../src/diseno-por-plan.js';
import { urlPublicaDeTienda } from '../src/util/dominios.js';
import {
  cambiarActivacion,
  comprobarDns,
  esDominioRaiz,
  leerDominio,
  quitarDominio,
  registrosDns,
  solicitarDominio,
  validarDominio,
  verificarDominio,
} from '../src/dominios-propios.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

const PLATAFORMA = { dominioPanel: 'tiendas.vezzadev.com', dominioTiendas: 'vezzadev.com' };

// Un DNS de mentira: los registros que se le cargan, por dominio. Lo que no tiene, falla como un dominio sin ese registro.
function dnsFalso(registros = {}) {
  const pedir = (tipo) => async (dominio) => {
    const valor = registros[dominio]?.[tipo];
    if (!valor) throw Object.assign(new Error('ENODATA'), { code: 'ENODATA' });
    return valor;
  };
  return { resolveCname: pedir('cname'), resolve4: pedir('a') };
}

// ---------- Validación y registros ----------

test('validarDominio: deja el dominio en minúsculas y sin "https://" ni ruta, y rechaza lo que no es un dominio o es de la plataforma', () => {
  assert.equal(validarDominio('  https://WWW.MiTienda.com/inicio?x=1 ', PLATAFORMA).valor, 'www.mitienda.com');
  assert.equal(validarDominio('mitienda.com.ar', PLATAFORMA).valor, 'mitienda.com.ar');
  assert.equal(validarDominio('xn--cafe-yma.com', PLATAFORMA).valor, 'xn--cafe-yma.com');
  for (const malo of ['', 'mitienda', 'mi tienda.com', 'mitienda.c', '-x.com', 'x-.com', 'mitienda.com:8080', '192.168.0.1', 'localhost', 'http://', 'ex@mple.com', '..com', 'a'.repeat(70) + '.com']) {
    assert.ok(validarDominio(malo, PLATAFORMA).error, `debería rechazar: ${malo}`);
  }
  for (const propio of ['tiendas.vezzadev.com', 'demo.vezzadev.com', 'vezzadev.com', 'www.tiendas.vezzadev.com']) {
    assert.match(validarDominio(propio, PLATAFORMA).error, /de la plataforma/, propio);
  }
  assert.equal(validarDominio('otravezzadev.com', PLATAFORMA).valor, 'otravezzadev.com', 'un dominio que solo termina parecido no es de la plataforma');
});

test('registrosDns: un subdominio (www) es un CNAME al panel; un dominio sin www, un registro A', () => {
  const opciones = { panel: 'tiendas.vezzadev.com', ip: '203.0.113.7' };
  assert.deepEqual(registrosDns('www.mitienda.com', opciones), [{ tipo: 'CNAME', nombre: 'www', valor: 'tiendas.vezzadev.com' }]);
  assert.deepEqual(registrosDns('tienda.mitienda.com.ar', opciones), [{ tipo: 'CNAME', nombre: 'tienda', valor: 'tiendas.vezzadev.com' }]);
  assert.deepEqual(registrosDns('mitienda.com', opciones), [{ tipo: 'A', nombre: '@ (o el mismo dominio)', valor: '203.0.113.7' }]);
  assert.deepEqual(registrosDns('mitienda.com.ar', opciones), [{ tipo: 'A', nombre: '@ (o el mismo dominio)', valor: '203.0.113.7' }]);
  assert.equal(registrosDns('mitienda.com', { panel: 'tiendas.vezzadev.com' })[0].valor, null, 'sin IP configurada, se avisa que hay que pedirla');
  assert.ok(esDominioRaiz('mitienda.com') && esDominioRaiz('mitienda.com.ar') && !esDominioRaiz('www.mitienda.com') && !esDominioRaiz('shop.mitienda.com.ar'));
});

test('comprobarDns: apunta por CNAME al panel, o por IP (la del panel o la configurada); cualquier otra cosa, no', async () => {
  const panel = 'tiendas.vezzadev.com';
  const resolver = dnsFalso({
    [panel]: { a: ['203.0.113.7'] },
    'www.uno.com': { cname: ['tiendas.vezzadev.com.'] },
    'www.dos.com': { cname: ['otro.proveedor.com'], a: ['198.51.100.9'] },
    'tres.com': { a: ['203.0.113.7'] },
    'cuatro.com': { a: ['198.51.100.9'] },
    'www.cinco.com': { cname: ['edge.tiendas.vezzadev.com'] },
  });
  const verificar = (dominio, extra = {}) => comprobarDns(dominio, { panel, resolver, ...extra });
  assert.deepEqual(await verificar('www.uno.com'), { ok: true, por: 'cname', cname: ['tiendas.vezzadev.com'], a: [] });
  assert.equal((await verificar('www.cinco.com')).por, 'cname', 'un CNAME a un subdominio del panel también');
  assert.equal((await verificar('tres.com')).por, 'ip', 'sin www: sus direcciones son las del panel');
  assert.equal((await verificar('www.dos.com')).ok, false, 'un CNAME a otro lado, no');
  assert.equal((await verificar('cuatro.com')).ok, false);
  assert.equal((await verificar('cuatro.com', { ip: '198.51.100.9' })).ok, true, 'con la IP del servidor configurada, se compara con ésa');
  assert.equal((await verificar('tres.com', { ip: '198.51.100.9' })).ok, false, 'y ya no con las del panel');
  assert.deepEqual(await verificar('no-existe.com'), { ok: false, por: null, cname: [], a: [] }, 'un dominio sin registros no falla: no apunta todavía');
});

// ---------- Estados en la base ----------

test('el recorrido de un dominio: solicitado, verificado, activo; se puede desactivar, quitar, y dos tiendas no comparten dominio', async () => {
  const db = await abrirBase(':memory:');
  const { tienda } = await crearTienda(db, { nombre: 'Uno', email: 'uno@ejemplo.com', slug: 'uno' });
  const { tienda: otra } = await crearTienda(db, { nombre: 'Dos', email: 'dos@ejemplo.com', slug: 'dos' });
  assert.equal(await leerDominio(db, tienda.id), null);
  assert.deepEqual(await solicitarDominio(db, tienda.id, 'https://WWW.Uno.com/', PLATAFORMA), { dominio: 'www.uno.com' });
  assert.deepEqual(await leerDominio(db, tienda.id), { dominio: 'www.uno.com', estado: 'solicitado' });
  assert.deepEqual(await solicitarDominio(db, otra.id, 'www.uno.com', PLATAFORMA), { error: 'Ese dominio ya lo usa otra tienda' });
  assert.ok((await solicitarDominio(db, tienda.id, 'tiendas.vezzadev.com', PLATAFORMA)).error);
  assert.equal(await buscarTiendaPorDominio(db, 'www.uno.com'), null, 'solo se resuelve cuando está activo');

  // Verificar: sin el registro, sigue solicitado; con él, pasa a verificado; si lo sacan, vuelve.
  const panel = 'tiendas.vezzadev.com';
  assert.equal((await verificarDominio(db, tienda.id, { panel, resolver: dnsFalso() })).ok, false);
  assert.equal((await leerDominio(db, tienda.id)).estado, 'solicitado');
  const apunta = dnsFalso({ 'www.uno.com': { cname: [panel] } });
  assert.equal((await verificarDominio(db, tienda.id, { panel, resolver: apunta })).ok, true);
  assert.equal((await leerDominio(db, tienda.id)).estado, 'verificado');
  assert.equal((await verificarDominio(db, tienda.id, { panel, resolver: dnsFalso() })).ok, false);
  assert.equal((await leerDominio(db, tienda.id)).estado, 'solicitado', 'si el DNS deja de apuntar, vuelve al primer paso');
  assert.equal(await verificarDominio(db, otra.id, { panel, resolver: apunta }), null, 'sin dominio, no hay qué verificar');

  // Activar: la tienda se resuelve por su dominio, con sus campos de dominio.
  assert.ok(await cambiarActivacion(db, tienda.id, true));
  assert.equal((await leerDominio(db, tienda.id)).estado, 'activo');
  const porDominio = await buscarTiendaPorDominio(db, 'www.uno.com');
  assert.equal(porDominio.id, tienda.id);
  assert.deepEqual([porDominio.dominioPropio, porDominio.dominioEstado], ['www.uno.com', 'activo']);
  // Un dominio activo no vuelve a "solicitado" porque el DNS no conteste en una verificación.
  await verificarDominio(db, tienda.id, { panel, resolver: dnsFalso() });
  assert.equal((await leerDominio(db, tienda.id)).estado, 'activo');
  assert.equal(await cambiarActivacion(db, otra.id, true), false, 'sin dominio cargado no se activa nada');

  await cambiarActivacion(db, tienda.id, false);
  assert.equal(await buscarTiendaPorDominio(db, 'www.uno.com'), null);
  assert.ok(await quitarDominio(db, tienda.id));
  assert.equal(await leerDominio(db, tienda.id), null);
  // Liberado, otra tienda lo puede tomar.
  assert.deepEqual(await solicitarDominio(db, otra.id, 'www.uno.com', PLATAFORMA), { dominio: 'www.uno.com' });
});

test('urlPublicaDeTienda: el dominio propio si está activo; si no, el subdominio de siempre', () => {
  const req = { protocol: 'https', host: 'tiendas.vezzadev.com' };
  const config = { dominio: 'tiendas.vezzadev.com', dominioTiendas: 'vezzadev.com' };
  assert.equal(urlPublicaDeTienda(req, config, { slug: 'nube' }), 'https://nube.vezzadev.com');
  assert.equal(urlPublicaDeTienda(req, config, { slug: 'nube', dominioPropio: 'www.nube.com', dominioEstado: 'solicitado' }), 'https://nube.vezzadev.com');
  assert.equal(urlPublicaDeTienda(req, config, { slug: 'nube', dominioPropio: 'www.nube.com', dominioEstado: 'verificado' }), 'https://nube.vezzadev.com');
  assert.equal(urlPublicaDeTienda(req, config, { slug: 'nube', dominioPropio: 'www.nube.com', dominioEstado: 'activo' }), 'https://www.nube.com');
});

// ---------- Con la aplicación andando ----------

let db;
let servidor;
let puerto;
let contador = 0;
let dns = dnsFalso();

after(() => {
  servidor?.closeAllConnections();
  servidor?.close();
});

beforeEach(async () => {
  servidor?.closeAllConnections();
  servidor?.close();
  db = await abrirBase(':memory:');
  dns = dnsFalso();
  // El panel se ve en localhost; "tiendas" en localhost.
  const config = {
    produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirImportaciones: '.', dirSubidas: '.',
    resolverDns: { resolveCname: (d) => dns.resolveCname(d), resolve4: (d) => dns.resolve4(d) },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

// Una tienda con la sesión iniciada, en un plan con las funciones de un punto de partida ('esencial', 'acompanado', 'a_medida') o las de una lista.
async function tienda(nivel) {
  contador++;
  const slug = `tienda-dom-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Casa ${contador}`, email: `${slug}@ejemplo.com`, slug });
  if (nivel) {
    const funciones = Array.isArray(nivel) ? nivel : funcionesDePreset(nivel);
    const planId = await crearPlan(db, { nombre: `Plan ${Array.isArray(nivel) ? funciones.join('+') : nivel} ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones });
    await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planId, creada.id);
  }
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 1500, 10]]);
  await aplicarImportacion(db, creada.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug };
}

const texto = async (respuesta) => (await respuesta.text()).replace(/&#34;|&quot;/g, '"');

test('el cliente del plan a medida pide su dominio, ve el registro que tiene que cargar y lo verifica; los otros planes lo ven bloqueado', async () => {
  const t = await tienda('a_medida');
  let pagina = await texto(await t.nav.pedir('/admin/cuenta'));
  assert.ok(pagina.includes('Dominio propio') && pagina.includes('Pedir mi dominio'));

  // Un dominio inválido o de la plataforma no se acepta.
  const malo = await t.nav.enviar('/admin/cuenta/dominio', { dominio: 'mitienda' }, { desde: '/admin/cuenta' });
  assert.equal(malo.status, 400);
  assert.ok((await texto(malo)).includes('no parece un dominio'));
  assert.equal(await leerDominio(db, t.tiendaId), null);

  const ok = await t.nav.enviar('/admin/cuenta/dominio', { dominio: 'WWW.Casa-Mia.com' }, { desde: '/admin/cuenta' });
  assert.equal(ok.status, 302);
  assert.deepEqual(await leerDominio(db, t.tiendaId), { dominio: 'www.casa-mia.com', estado: 'solicitado' });
  pagina = await texto(await t.nav.pedir('/admin/cuenta'));
  assert.ok(pagina.includes('Pedimos tu dominio www.casa-mia.com'));
  assert.ok(pagina.includes('<code>CNAME</code>') && pagina.includes('<code>www</code>') && pagina.includes('<code>localhost</code>'), 'el CNAME apunta al dominio del panel');
  assert.ok(pagina.includes('Verificar ahora'));

  // Sin el registro: avisa que todavía no. Con el registro: verificado.
  await t.nav.enviar('/admin/cuenta/dominio/verificar', {}, { desde: '/admin/cuenta' });
  assert.ok((await texto(await t.nav.pedir('/admin/cuenta'))).includes('Todavía no vemos el registro en www.casa-mia.com'));
  dns = dnsFalso({ 'www.casa-mia.com': { cname: ['localhost'] } });
  await t.nav.enviar('/admin/cuenta/dominio/verificar', {}, { desde: '/admin/cuenta' });
  assert.equal((await leerDominio(db, t.tiendaId)).estado, 'verificado');
  assert.ok((await texto(await t.nav.pedir('/admin/cuenta'))).includes('ya apunta a la plataforma'));

  // Quitarlo lo borra, y el cliente no puede activarlo él (no hay ruta: lo hace la plataforma).
  await t.nav.enviar('/admin/cuenta/dominio/quitar', {}, { desde: '/admin/cuenta' });
  assert.equal(await leerDominio(db, t.tiendaId), null);

  const esencial = await tienda('esencial');
  pagina = await texto(await esencial.nav.pedir('/admin/cuenta'));
  assert.ok(pagina.includes('no incluye <strong>Dominio propio</strong>') && !pagina.includes('Pedir mi dominio'));
  const intento = await esencial.nav.enviar('/admin/cuenta/dominio', { dominio: 'www.otra.com' }, { desde: '/admin/cuenta' });
  assert.equal(intento.status, 302);
  assert.equal(await leerDominio(db, esencial.tiendaId), null, 'un plan que no lo incluye no puede pedirlo aunque mande el formulario');
});

test('con el dominio activo el cliente ya no lo cambia ni lo quita solo', async () => {
  const t = await tienda('a_medida');
  await solicitarDominio(db, t.tiendaId, 'www.fijo.com', PLATAFORMA);
  await cambiarActivacion(db, t.tiendaId, true);
  await t.nav.enviar('/admin/cuenta/dominio', { dominio: 'www.otro.com' }, { desde: '/admin/cuenta' });
  await t.nav.enviar('/admin/cuenta/dominio/quitar', {}, { desde: '/admin/cuenta' });
  assert.deepEqual(await leerDominio(db, t.tiendaId), { dominio: 'www.fijo.com', estado: 'activo' });
  const pagina = await texto(await t.nav.pedir('/admin/cuenta'));
  assert.ok(pagina.includes('Tu dominio ya está activo') && pagina.includes('Abrir mi tienda') && !pagina.includes('Quitar este dominio'));
});

test('la tienda se ve en su dominio propio cuando está activo, y el subdominio de siempre redirige', async () => {
  const t = await tienda('a_medida');
  await solicitarDominio(db, t.tiendaId, 'www.casa-activa.com', PLATAFORMA);
  // Solicitado o verificado: el dominio todavía no es de la tienda (sigue como un host desconocido: cae en la landing del panel).
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/producto/taza')).status, 404);
  await db.prepare("UPDATE tiendas SET dominio_estado = 'verificado' WHERE id = ?").run(t.tiendaId);
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/producto/taza')).status, 404);
  assert.equal((await pedirConHost(puerto, `${t.slug}.localhost`, '/')).status, 200, 'el subdominio no redirige hasta que se activa');

  await cambiarActivacion(db, t.tiendaId, true);
  // En su dominio: la vidriera de la tienda (portada, producto, categoría que no existe).
  const portada = await pedirConHost(puerto, 'www.casa-activa.com', '/');
  assert.equal(portada.status, 200);
  assert.ok(portada.cuerpo.includes(`Casa ${contador}`) && portada.cuerpo.includes('Taza'));
  assert.ok(portada.cuerpo.includes('<link rel="canonical" href="http://www.casa-activa.com:'), 'la dirección canónica es la del dominio propio');
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/producto/taza')).status, 200);
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/producto/no-existe')).status, 404);
  // Las rutas de la plataforma no existen en el dominio de una tienda (el panel vive en el dominio del panel).
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/plataforma/ingresar')).status, 404);
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/admin/pedidos')).headers.location.startsWith('http://localhost:'), true, '/admin lleva al panel');

  // El subdominio de siempre redirige al dominio propio, con el mismo camino y las mismas búsquedas.
  const redirige = await pedirConHost(puerto, `${t.slug}.localhost`, '/categoria/ofertas?pagina=2');
  assert.equal(redirige.status, 301);
  assert.equal(redirige.location, `http://www.casa-activa.com/categoria/ofertas?pagina=2`);
  assert.equal(redirige.headers['cache-control'], 'no-store');

  // Un host cualquiera que no es de nadie sigue siendo la landing / el panel, sin romper nada.
  assert.equal((await pedirConHost(puerto, 'www.nadie.com', '/salud')).status, 200);
  // Desactivado, vuelve a como estaba.
  await cambiarActivacion(db, t.tiendaId, false);
  assert.equal((await pedirConHost(puerto, `${t.slug}.localhost`, '/')).status, 200);
  assert.equal((await pedirConHost(puerto, 'www.casa-activa.com', '/producto/taza')).status, 404);
});

test('una tienda suspendida no se ve en su dominio propio: aviso, como en su subdominio', async () => {
  const t = await tienda('a_medida');
  await solicitarDominio(db, t.tiendaId, 'www.suspendida.com', PLATAFORMA);
  await cambiarActivacion(db, t.tiendaId, true);
  await db.prepare("UPDATE tiendas SET estado = 'suspendida' WHERE id = ?").run(t.tiendaId);
  const respuesta = await pedirConHost(puerto, 'www.suspendida.com', '/');
  assert.equal(respuesta.status, 503);
  assert.equal(respuesta.headers['retry-after'], '86400');
});

test('el panel usa el dominio propio activo en "Ver mi tienda" y buscarTienda trae los campos del dominio', async () => {
  const t = await tienda('a_medida');
  await solicitarDominio(db, t.tiendaId, 'www.mia.com', PLATAFORMA);
  assert.match(await texto(await t.nav.pedir('/admin/inicio')), new RegExp(`href="http://${t.slug}\\.localhost`));
  await cambiarActivacion(db, t.tiendaId, true);
  assert.ok((await texto(await t.nav.pedir('/admin/inicio'))).includes('href="http://www.mia.com"'));
  assert.deepEqual((({ dominioPropio, dominioEstado }) => ({ dominioPropio, dominioEstado }))(await buscarTienda(db, t.tiendaId)), { dominioPropio: 'www.mia.com', dominioEstado: 'activo' });
});

test('la plataforma ve el dominio pedido, lo verifica, lo activa y carga los códigos de seguimiento del cliente', async () => {
  const cliente = await tienda('a_medida');
  await solicitarDominio(db, cliente.tiendaId, 'www.cliente.com', PLATAFORMA);
  const { clave } = await crearSuperadmin(db, { email: 'dueno@vezza.dev' });
  const dueno = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await dueno.enviar('/plataforma/ingresar', { email: 'dueno@vezza.dev', clave }, { desde: '/plataforma/ingresar' })).status, 302);

  // En la lista de clientes se ve que hay un dominio por activar.
  assert.ok((await texto(await dueno.pedir('/plataforma/clientes'))).includes('Dominio por activar'));
  const ficha = `/plataforma/clientes/${cliente.tiendaId}`;
  let pagina = await texto(await dueno.pedir(ficha));
  assert.ok(pagina.includes('www.cliente.com') && pagina.includes('Solicitado') && pagina.includes('Domains') && pagina.includes('Verificar DNS'));

  // Verificar sin el registro, luego con él; activar.
  await dueno.enviar(`${ficha}/dominio/verificar`, {}, { desde: ficha });
  assert.ok((await texto(await dueno.pedir(ficha))).includes('todavía no apunta a la plataforma'));
  dns = dnsFalso({ 'www.cliente.com': { cname: ['localhost'] } });
  await dueno.enviar(`${ficha}/dominio/verificar`, {}, { desde: ficha });
  assert.equal((await leerDominio(db, cliente.tiendaId)).estado, 'verificado');
  await dueno.enviar(`${ficha}/dominio/activar`, {}, { desde: ficha });
  assert.equal((await leerDominio(db, cliente.tiendaId)).estado, 'activo');
  assert.equal((await pedirConHost(puerto, 'www.cliente.com', '/')).status, 200);
  assert.ok(!(await texto(await dueno.pedir('/plataforma/clientes'))).includes('Dominio por activar'));

  // Un plan que no incluye dominio propio no se puede activar.
  const esencial = await tienda('esencial');
  await solicitarDominio(db, esencial.tiendaId, 'www.esencial.com', PLATAFORMA);
  await dueno.enviar(`/plataforma/clientes/${esencial.tiendaId}/dominio/activar`, {}, { desde: `/plataforma/clientes/${esencial.tiendaId}` });
  assert.equal((await leerDominio(db, esencial.tiendaId)).estado, 'solicitado');

  // Desactivar y quitar.
  await dueno.enviar(`${ficha}/dominio/desactivar`, {}, { desde: ficha });
  assert.equal((await leerDominio(db, cliente.tiendaId)).estado, 'solicitado');
  await dueno.enviar(`${ficha}/dominio/quitar`, {}, { desde: ficha });
  assert.equal(await leerDominio(db, cliente.tiendaId), null);
  // La plataforma también puede cargar el dominio de un cliente.
  await dueno.enviar(`${ficha}/dominio`, { dominio: 'https://Tienda.Cliente.com.ar' }, { desde: ficha });
  assert.deepEqual(await leerDominio(db, cliente.tiendaId), { dominio: 'tienda.cliente.com.ar', estado: 'solicitado' });

  // Códigos de seguimiento: se guardan tal cual y la vidriera los imprime (plan a medida).
  await dueno.enviar(`${ficha}/codigos`, { codigoCabecera: '<script>/* pixel */</script>', codigoPie: '<noscript>pie</noscript>' }, { desde: ficha });
  const fila = await db.prepare('SELECT codigo_cabecera AS c, codigo_pie AS p FROM tiendas WHERE id = ?').get(cliente.tiendaId);
  assert.deepEqual([fila.c, fila.p], ['<script>/* pixel */</script>', '<noscript>pie</noscript>']);
  const html = (await pedirConHost(puerto, `${cliente.slug}.localhost`, '/')).cuerpo;
  assert.ok(html.includes('<script>/* pixel */</script>') && html.includes('<noscript>pie</noscript>'));
  pagina = await texto(await dueno.pedir(ficha));
  assert.ok(pagina.includes('&lt;script&gt;/* pixel */&lt;/script&gt;'), 'en el formulario se ve escapado');
  // Demasiado largo: no se guarda.
  await dueno.enviar(`${ficha}/codigos`, { codigoCabecera: 'x'.repeat(10_001), codigoPie: '' }, { desde: ficha });
  assert.equal((await db.prepare('SELECT codigo_cabecera AS c FROM tiendas WHERE id = ?').get(cliente.tiendaId)).c, '<script>/* pixel */</script>');
});

test('el servidor atiende un dominio propio aunque llegue con puerto y mayúsculas en el host', async () => {
  const t = await tienda('a_medida');
  await solicitarDominio(db, t.tiendaId, 'www.mayus.com', PLATAFORMA);
  await cambiarActivacion(db, t.tiendaId, true);
  const respuesta = await new Promise((resolver, rechazar) => {
    http.get({ host: '127.0.0.1', port: puerto, path: '/', headers: { host: `WWW.Mayus.com:${puerto}` } }, (res) => {
      res.resume();
      res.on('end', () => resolver(res.statusCode));
    }).on('error', rechazar);
  });
  assert.equal(respuesta, 200);
});

test('el dominio propio es una función más del plan: con solo esa tildada ya se puede pedir y activar, y sin ella no, aunque el plan lleve todo lo demás', async () => {
  const soloDominio = await tienda(['dominio']);
  assert.ok((await texto(await soloDominio.nav.pedir('/admin/cuenta'))).includes('Pedir mi dominio'));
  await soloDominio.nav.enviar('/admin/cuenta/dominio', { dominio: 'www.solo-dominio.com' }, { desde: '/admin/cuenta' });
  assert.equal((await leerDominio(db, soloDominio.tiendaId))?.dominio, 'www.solo-dominio.com');

  const todoMenosDominio = await tienda(funcionesDePreset('a_medida').filter((funcion) => funcion !== 'dominio'));
  const pagina = await texto(await todoMenosDominio.nav.pedir('/admin/cuenta'));
  assert.ok(pagina.includes('no incluye <strong>Dominio propio</strong>') && !pagina.includes('Pedir mi dominio'));
  await todoMenosDominio.nav.enviar('/admin/cuenta/dominio', { dominio: 'www.sin-funcion.com' }, { desde: '/admin/cuenta' });
  assert.equal(await leerDominio(db, todoMenosDominio.tiendaId), null);
});
