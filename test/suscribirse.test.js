// El alta de una cuenta nueva desde la landing, de punta a punta por HTTP: elegir plan -> pagar -> formulario -> panel.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { sumarDias, hoy } from '../src/util/fechas.js';
import { crearNavegador } from './ayudantes.js';
import { TOKEN_MP, crearMpFalso, crearN8nFalso } from './mercadopago-falso.js';

let mp;
let n8n;
let db;
let planes;
let servidor;
let navegador;
let puerto;

before(async () => {
  mp = crearMpFalso();
  n8n = crearN8nFalso();
  for (const falso of [mp, n8n]) {
    falso.servidor.listen(0, '127.0.0.1');
    await once(falso.servidor, 'listening');
    falso.puerto = falso.servidor.address().port;
  }
});

after(() => {
  for (const falso of [mp, n8n]) {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
});

// Levanta la app con Mercado Pago de mentira (o sin él, con { pagos: false }) y un navegador limpio.
async function levantar({ pagos = true, urlTerminos = '' } = {}) {
  await cerrar();
  mp.suscripciones.clear();
  mp.cobros.clear();
  mp.pedidos.length = 0;
  mp.fallar = false;
  mp.contador = 0;
  n8n.recibidos.length = 0;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { prueba: await crear('Prueba'), esencial: await crear('Esencial'), medida: await crear('A medida') };
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    urlTerminos,
    ...(pagos && {
      mercadopago: { accessToken: TOKEN_MP, webhookSecret: 'secreto-del-webhook', apiUrl: `http://127.0.0.1:${mp.puerto}` },
      n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' },
    }),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  navegador = crearNavegador(`http://127.0.0.1:${puerto}`);
}

async function cerrar() {
  if (!servidor) return;
  servidor.closeAllConnections();
  servidor.close();
  servidor = null;
}

after(cerrar);
beforeEach(() => levantar());

const FORMULARIO = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@correo.com', clave: 'una-clave-larga-1', claveRepetida: 'una-clave-larga-1', nombreTienda: 'Casa Ana', slug: '' };
const esperar = async (condicion) => {
  for (let i = 0; i < 100 && !condicion(); i++) await new Promise((r) => setTimeout(r, 20));
};
const tokenDelPago = () => new URL(mp.pedidos.find((p) => p.ruta === '/preapproval').cuerpo.back_url).searchParams.get('t');

// Elige el plan Esencial y paga (en el Mercado Pago de mentira). Devuelve el token del link.
async function pagar() {
  const r = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(r.status, 302);
  mp.autorizar([...mp.suscripciones.keys()].at(-1));
  return tokenDelPago();
}

// ---------- La landing ----------

test('con los pagos andando, la landing lleva los planes que se contratan solos al alta; el resto sigue en WhatsApp', async () => {
  const html = await (await navegador.pedir('/')).text();
  assert.ok(html.includes(`href="/suscribirse?plan=${planes.esencial}"`));
  assert.ok(html.includes(`href="/suscribirse?plan=${planes.prueba}"`));
  assert.ok(!html.includes(`/suscribirse?plan=${planes.medida}`), 'A medida se consulta');
  assert.match(html, /data-cta="Hola, quiero consultar por el plan A medida/);
});

test('sin los pagos configurados, la landing no cambia y /suscribirse vuelve a la portada', async () => {
  await levantar({ pagos: false });
  const html = await (await navegador.pedir('/')).text();
  assert.ok(!html.includes('/suscribirse'));
  assert.match(html, /data-cta="Hola, quiero contratar el plan Esencial/);
  const r = await navegador.pedir(`/suscribirse?plan=${planes.esencial}`);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
});

// ---------- Paso 1 ----------

test('el paso 1 muestra el plan y su precio; un plan que no existe o que se consulta vuelve a los planes', async () => {
  const html = await (await navegador.pedir(`/suscribirse?plan=${planes.esencial}`)).text();
  assert.match(html, /Suscribite al plan Esencial/);
  assert.match(html.replace(/\s/g, ' '), /\$ 12\.900/);
  assert.match(html, /Hasta 150 productos/);
  assert.match(html, /Continuar a Mercado Pago/);
  for (const plan of ['99999', planes.medida, 'abc', '']) {
    const r = await navegador.pedir(`/suscribirse?plan=${plan}`);
    assert.equal(r.status, 302, `plan=${plan}`);
    assert.equal(r.headers.get('location'), '/#planes');
  }
});

test('el paso 1 valida el email y no deja avanzar con uno que ya tiene cuenta', async () => {
  const intentar = (email) => navegador.enviar('/suscribirse', { plan: planes.esencial, email }, { desde: `/suscribirse?plan=${planes.esencial}` });
  const mal = await intentar('esto-no-es-un-mail');
  assert.equal(mal.status, 400);
  assert.match(await mal.text(), /Escribí un email válido/);
  await crearTienda(db, { nombre: 'Ya Existe', email: 'ya@existe.com' });
  const repetido = await intentar('ya@existe.com');
  assert.equal(repetido.status, 400);
  assert.match(await repetido.text(), /Ya hay una cuenta con ese email/);
  assert.equal(mp.pedidos.length, 0);
});

test('si Mercado Pago no responde, se avisa y no queda nada a medias', async () => {
  mp.fallar = true;
  const r = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(r.status, 502);
  assert.match(await r.text(), /No pudimos conectarnos con Mercado Pago/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM suscripciones').get()).n, 0);
});

test('si se configuran términos y condiciones, el paso 1 los pide', async () => {
  await levantar({ urlTerminos: 'https://vezzadev.com/terminos' });
  const html = await (await navegador.pedir(`/suscribirse?plan=${planes.esencial}`)).text();
  assert.ok(html.includes('href="https://vezzadev.com/terminos"'));
  const sin = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(sin.status, 400);
  assert.match(await sin.text(), /aceptar los términos/);
  const con = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com', terminos: '1' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(con.status, 302);
});

test('los formularios exigen el token CSRF', async () => {
  const r = await navegador.pedir('/suscribirse', { method: 'POST', body: new URLSearchParams({ plan: planes.esencial, email: 'ana@correo.com' }) });
  assert.equal(r.status, 403);
  assert.equal(mp.pedidos.length, 0);
});

test('hay un tope de intentos por hora en el paso 1', async () => {
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'mal' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(ultimo.status, 429);
});

// ---------- De punta a punta ----------

test('elegir plan, pagar, completar el formulario y quedar adentro del panel, con el mail de bienvenida por n8n', async () => {
  // Paso 1: va a Mercado Pago.
  const paso1 = await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(paso1.status, 302);
  assert.match(paso1.headers.get('location'), /^https:\/\/www\.mercadopago\.test\/subscriptions\/checkout\?preapproval_id=mp1abc$/);
  const token = tokenDelPago();
  assert.match(mp.pedidos[0].cuerpo.back_url, new RegExp(`^http://localhost:${puerto}/suscribirse/volver\\?t=`));

  // Vuelve antes de que Mercado Pago confirme: se queda esperando, y la pantalla se vuelve a pedir sola.
  const esperando = await navegador.pedir(`/suscribirse/volver?t=${token}`);
  assert.equal(esperando.status, 200);
  const htmlEsperando = await esperando.text();
  assert.match(htmlEsperando, /Estamos confirmando tu pago/);
  assert.match(htmlEsperando, /volver\?t=[^"']+&n=1/);
  // Mientras tanto, el formulario no abre.
  assert.equal((await navegador.pedir(`/suscribirse/cuenta?t=${token}`)).headers.get('location'), `/suscribirse/volver?t=${encodeURIComponent(token)}`);

  // Mercado Pago autoriza: la vuelta lo confirma en el momento (sin esperar al webhook) y abre el formulario.
  mp.autorizar('mp1abc');
  const vuelta = await navegador.pedir(`/suscribirse/volver?t=${token}`);
  assert.equal(vuelta.status, 302);
  assert.equal(vuelta.headers.get('location'), `/suscribirse/cuenta?t=${token}`);

  const formulario = await (await navegador.pedir(`/suscribirse/cuenta?t=${token}`)).text();
  assert.match(formulario, /Pago confirmado · Plan Esencial/);
  assert.match(formulario, /value="ana@correo\.com"/, 'el email del pago viene cargado');

  // Con errores, no se pierde lo escrito y las claves no vuelven.
  const malo = await navegador.enviar('/suscribirse/cuenta', { ...FORMULARIO, t: token, claveRepetida: 'otra-cosa-distinta' }, { desde: `/suscribirse/cuenta?t=${token}` });
  assert.equal(malo.status, 400);
  const htmlMalo = await malo.text();
  assert.match(htmlMalo, /Las dos claves no coinciden/);
  assert.match(htmlMalo, /value="Casa Ana"/);
  assert.ok(!htmlMalo.includes('una-clave-larga-1'));

  // Bien: crea la cuenta y deja al cliente adentro del panel.
  const alta = await navegador.enviar('/suscribirse/cuenta', { ...FORMULARIO, t: token }, { desde: `/suscribirse/cuenta?t=${token}` });
  assert.equal(alta.status, 302);
  assert.equal(alta.headers.get('location'), '/admin/inicio');
  const panel = await navegador.pedir('/admin/inicio');
  assert.equal(panel.status, 200, 'la sesión quedó iniciada');
  assert.match(await panel.text(), /Tu cuenta está creada/);

  // El aviso a n8n: el mail de bienvenida, sin la clave.
  await esperar(() => n8n.recibidos.some((r) => r.cuerpo.evento === 'cuenta_creada'));
  const bienvenida = n8n.recibidos.find((r) => r.cuerpo.evento === 'cuenta_creada');
  assert.equal(bienvenida.secreto, 'secreto-de-n8n');
  assert.deepEqual(bienvenida.cuerpo, {
    evento: 'cuenta_creada',
    email: 'ana@correo.com',
    nombre: 'Ana',
    apellido: 'Pérez',
    tienda: { nombre: 'Casa Ana', url: 'http://casa-ana.localhost:' + puerto },
    plan: { nombre: 'Esencial', precio: bienvenida.cuerpo.plan.precio },
    urlPanel: `http://localhost:${puerto}/admin`,
  });
  assert.match(bienvenida.cuerpo.plan.precio.replace(/\s/g, ' '), /12\.900.*\/ mes/);
  assert.ok(!JSON.stringify(n8n.recibidos).includes('una-clave-larga-1'), 'la clave nunca sale de la plataforma');

  // El link es de un solo uso.
  const otraVez = await (await navegador.pedir(`/suscribirse/cuenta?t=${token}`)).text();
  assert.match(otraVez, /Tu cuenta ya está creada/);
  assert.match(otraVez, /href="\/admin"/);
});

test('la prueba gratis va directo al formulario, sin Mercado Pago, y deja la tienda abierta 7 días', async () => {
  const paso1 = await navegador.enviar('/suscribirse', { plan: planes.prueba, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.prueba}` });
  assert.equal(paso1.status, 302);
  const destino = paso1.headers.get('location');
  assert.match(destino, /^\/suscribirse\/cuenta\?t=/);
  assert.equal(mp.pedidos.length, 0);
  assert.match(await (await navegador.pedir(destino)).text(), /Prueba gratis · 7 días/);

  const alta = await navegador.enviar('/suscribirse/cuenta', { ...FORMULARIO, t: new URL(destino, 'http://x').searchParams.get('t') }, { desde: destino });
  assert.equal(alta.status, 302);
  const { venceEn } = await db.prepare("SELECT vence_en AS \"venceEn\" FROM tiendas WHERE slug = 'casa-ana'").get();
  assert.equal(venceEn, sumarDias(hoy(), 7));
  await esperar(() => n8n.recibidos.length > 0);
  assert.equal(n8n.recibidos[0].cuerpo.evento, 'cuenta_creada');
  assert.equal(n8n.recibidos[0].cuerpo.plan.precio, 'Gratis 7 días');
});

test('un link inventado o de un pago sin confirmar no abre el formulario ni crea nada', async () => {
  const basura = await navegador.pedir('/suscribirse/cuenta?t=1.' + 'a'.repeat(32));
  assert.equal(basura.status, 200);
  assert.match(await basura.text(), /Este link no es válido/);
  assert.match(await (await navegador.pedir('/suscribirse/volver')).text(), /Este link no es válido/);

  // Pagó a medias (Mercado Pago no autorizó): el POST directo al formulario no crea la cuenta.
  await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  const token = tokenDelPago();
  const intento = await navegador.enviar('/suscribirse/cuenta', { ...FORMULARIO, t: token }, { desde: `/suscribirse?plan=${planes.esencial}` });
  assert.equal(intento.status, 302);
  assert.ok(intento.headers.get('location').startsWith('/suscribirse/volver?t='), 'lo manda a esperar la confirmación');
  assert.equal((await db.prepare('SELECT count(*) AS n FROM tiendas').get()).n, 0, 'sin pago no hay tienda');
});

test('si tarda demasiado en confirmarse el pago, se deja de recargar y se explica qué pasa', async () => {
  await navegador.enviar('/suscribirse', { plan: planes.esencial, email: 'ana@correo.com' }, { desde: `/suscribirse?plan=${planes.esencial}` });
  const html = await (await navegador.pedir(`/suscribirse/volver?t=${tokenDelPago()}&n=15`)).text();
  assert.match(html, /Todavía no vemos tu pago/);
  assert.match(html, /ana@correo\.com/);
  assert.ok(!html.includes('location.replace'));
});

test('pagar y no completar el formulario manda por n8n el link para crear la cuenta', async () => {
  const token = await pagar();
  await navegador.pedir(`/suscribirse/volver?t=${token}`); // confirma el pago, pero no completa nada
  await esperar(() => n8n.recibidos.length > 0);
  assert.equal(n8n.recibidos.length, 1);
  assert.equal(n8n.recibidos[0].cuerpo.evento, 'pago_recibido');
  assert.equal(n8n.recibidos[0].cuerpo.urlCuenta, `http://localhost:${puerto}/suscribirse/cuenta?t=${token}`);
  // Y ese link, abierto en otro navegador, anda.
  const otroNavegador = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.match(await (await otroNavegador.pedir(`/suscribirse/cuenta?t=${token}`)).text(), /Pago confirmado/);
});
