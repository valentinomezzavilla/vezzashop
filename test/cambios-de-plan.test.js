// Cambios en un plan que ya tienen clientes: confirmación, aumentos con excepciones (precio fijo), Mercado Pago y avisos por mail.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, crearSuperadmin, leerPlan, leerCliente, resumenPlataforma, fijarPrecioDeCliente, cambiarPlanDeCliente, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { compararPlan, afectaAClientes, precioTexto } from '../src/cambios-de-plan.js';
import { crearNavegador } from './ayudantes.js';
import { TOKEN_MP, crearMpFalso, crearN8nFalso } from './mercadopago-falso.js';

let mp;
let n8n;
let db;
let planes;
let servidor;
let puerto;
let admin;

before(async () => {
  mp = crearMpFalso();
  n8n = crearN8nFalso();
  for (const falso of [mp, n8n]) {
    falso.servidor.listen(0, '127.0.0.1');
    await once(falso.servidor, 'listening');
    falso.puerto = falso.servidor.address().port;
  }
});

async function cerrar() {
  if (!servidor) return;
  servidor.closeAllConnections();
  servidor.close();
  servidor = null;
}

after(async () => {
  await cerrar();
  for (const falso of [mp, n8n]) {
    falso.servidor.closeAllConnections();
    falso.servidor.close();
  }
});

async function levantar({ pagos = true, correo = true } = {}) {
  await cerrar();
  mp.suscripciones.clear();
  mp.cobros.clear();
  mp.pedidos.length = 0;
  mp.fallar = false;
  mp.contador = 0;
  mp.rechazarMonto.clear();
  n8n.recibidos.length = 0;
  n8n.fallar = false;
  db = await abrirBase(':memory:');
  const crear = (nombre) => crearPlan(db, { ...PLANES_SUGERIDOS.find((p) => p.nombre === nombre), activo: true });
  planes = { esencial: await crear('Esencial'), acompanado: await crear('Acompañado') };
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    ...(pagos && { mercadopago: { accessToken: TOKEN_MP, webhookSecret: 'secreto-del-webhook', apiUrl: `http://127.0.0.1:${mp.puerto}` } }),
    ...(correo && { n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' } }),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  const { clave } = await crearSuperadmin(db, { email: 'yo@vezza.dev' });
  admin = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await admin.enviar('/plataforma/ingresar', { email: 'yo@vezza.dev', clave })).status, 302);
}

beforeEach(() => levantar());

const pagina = async (ruta) => (await admin.pedir(ruta)).text();
const putsDeMp = () => mp.pedidos.filter((p) => p.metodo === 'PUT');
const avisosDe = (evento) => n8n.recibidos.filter((r) => r.cuerpo.evento === evento).map((r) => r.cuerpo);
const montoMp = (id) => mp.suscripciones.get(id).auto_recurring.transaction_amount;
const montoDb = async (id) => (await db.prepare('SELECT monto_centavos AS m FROM suscripciones WHERE mp_id = ?').get(id)).m;
const precioFijoDe = async (tiendaId) => (await db.prepare('SELECT precio_fijo_centavos AS p FROM tiendas WHERE id = ?').get(tiendaId)).p;
const PROXIMO_COBRO = '2030-02-10T12:00:00.000-03:00';
// Los precios llevan un espacio "duro" (U+00A0) entre el $ y el número, para que no se corten en dos renglones: acá se comparan con espacio común.
const sp = (texto) => texto.replace(/ /g, ' ');

// Un cliente del plan Esencial. Con `mpId`, tiene débito automático en (el) Mercado Pago de mentira por $12.900.
let contadorClientes = 0;
async function cliente(nombre, { plan = planes.esencial, mpId = null, fijo = null, email = `${nombre.toLowerCase().replace(/\W/g, '')}@correo.com`, monto = 12900 } = {}) {
  contadorClientes++;
  const { tienda } = await crearTienda(db, { nombre, email, planId: plan, slug: `cliente-${contadorClientes}`, titular: { nombre, apellido: 'Prueba' } });
  if (fijo !== null) await db.prepare('UPDATE tiendas SET precio_fijo_centavos = ? WHERE id = ?').run(fijo, tienda.id);
  if (mpId) {
    mp.suscripciones.set(mpId, { id: mpId, status: 'authorized', auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: monto, currency_id: 'ARS' }, next_payment_date: PROXIMO_COBRO });
    await db.prepare("INSERT INTO suscripciones (tienda_id, plan_id, mp_id, estado, monto_centavos, email_pagador, proximo_cobro) VALUES (?, ?, ?, 'autorizada', ?, ?, '2030-02-10')").run(tienda.id, plan, mpId, monto * 100, email);
  }
  return tienda.id;
}

// Los campos del formulario de edición de un plan, como los manda el navegador (el Esencial sugerido: $12.900, 150 productos, 4 fotos, 2 banners).
const camposEsencial = (cambios = {}) => ({ nombre: 'Esencial', precio: '12.900', maxProductos: '150', maxFotos: '4', maxBanners: '2', diasPrueba: '', activo: '1', ...cambios });
const editar = (planId, campos) => admin.enviar(`/plataforma/planes/${planId}`, campos, { desde: `/plataforma/planes/${planId}` });
const confirmar = (planId, campos, { visto = [], aplicar = [], avisarPorMail = true } = {}) =>
  admin.enviar(
    `/plataforma/planes/${planId}/confirmar`,
    [...Object.entries(campos), ...visto.map((id) => ['visto', String(id)]), ...aplicar.map((id) => ['aplicar', String(id)]), ...(avisarPorMail ? [['avisarPorMail', '1']] : [])],
    { desde: `/plataforma/planes/${planId}` },
  );

// ---------- Qué cambió ----------

test('compararPlan lista lo que cambió con textos listos, e ignora lo que queda igual', () => {
  const antes = { nombre: 'Esencial', precioCentavos: 1290000, maxProductos: 150, maxFotos: 4, maxBanners: 2, diasPrueba: null, suspenderAlVencer: false, activo: true };
  const igual = compararPlan(antes, { ...antes, maxFotos: 4 });
  assert.deepEqual(igual, []);
  const cambios = compararPlan(antes, { ...antes, precioCentavos: 1490000, maxProductos: null, suspenderAlVencer: true, nombre: 'Esencial Plus', diasPrueba: 7 });
  assert.deepEqual(
    cambios.map(({ campo, antes: a, despues: d, afecta, precio }) => [campo, sp(a), sp(d), afecta, precio]),
    [
      ['precioCentavos', '$ 12.900 / mes', '$ 14.900 / mes', true, true],
      ['maxProductos', 'Hasta 150', 'Sin tope', true, false],
      ['suspenderAlVencer', 'Solo se avisa del vencimiento', 'La tienda se cierra al vencer', true, false],
      ['nombre', 'Esencial', 'Esencial Plus', false, false],
      ['diasPrueba', 'Sin prueba', '7 días', false, false],
    ],
  );
  assert.equal(afectaAClientes(cambios), true);
  assert.equal(afectaAClientes(compararPlan(antes, { ...antes, nombre: 'Otro', diasPrueba: 3, activo: false })), false, 'nombre, prueba y pausa no le cambian nada a quien ya lo tiene');
  // "Sin tope de fotos" y "hasta 10" son lo mismo.
  assert.deepEqual(compararPlan({ ...antes, maxFotos: null }, { ...antes, maxFotos: 10 }), []);
  assert.equal(precioTexto(0), 'Gratis');
});

// ---------- Editar un plan ----------

test('un plan sin clientes se guarda directo, sin confirmación', async () => {
  const r = await editar(planes.acompanado, camposEsencial({ nombre: 'Acompañado', precio: '39.900', maxProductos: '1000', maxFotos: '8', maxBanners: '4' }));
  assert.equal(r.status, 302);
  assert.equal((await leerPlan(db, planes.acompanado)).precioCentavos, 3990000);
  assert.match(await pagina('/plataforma/planes'), /Guardamos el plan &#34;Acompañado&#34;|Guardamos el plan "Acompañado"/);
});

test('un cambio que no afecta a los clientes (solo el nombre) se guarda directo aunque haya clientes', async () => {
  await cliente('Ana', { mpId: 'mp1' });
  const r = await editar(planes.esencial, camposEsencial({ nombre: 'Esencial Plus' }));
  assert.equal(r.status, 302);
  assert.equal((await leerPlan(db, planes.esencial)).nombre, 'Esencial Plus');
  assert.equal(putsDeMp().length, 0);
  assert.equal(n8n.recibidos.length, 0);
});

test('subir el precio de un plan con clientes no guarda nada: muestra a quiénes les toca y deja elegir', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const beto = await cliente('Beto', { mpId: 'mp2', fijo: 1290000 });
  const sinMp = await cliente('Carla');
  const r = await editar(planes.esencial, camposEsencial({ precio: '14.900' }));
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Confirmá los cambios en &#34;Esencial&#34;|Confirmá los cambios en "Esencial"/);
  assert.match(html, /Este plan lo tienen 3 clientes\. Todavía no se guardó nada/);
  assert.match(html, /\$\s12\.900 \/ mes/);
  assert.match(html, /\$\s14\.900 \/ mes/);
  // Cada cliente: Ana y Carla se pueden sacar del aumento; Beto ya tiene precio fijo.
  assert.match(html, new RegExp(`name="aplicar" value="${ana}" checked`));
  assert.match(html, new RegExp(`name="aplicar" value="${sinMp}" checked`));
  assert.doesNotMatch(html, new RegExp(`name="aplicar" value="${beto}"`));
  assert.match(html, /Precio fijo/);
  assert.match(html, /name="avisarPorMail" value="1" checked/);
  for (const id of [ana, beto, sinMp]) assert.match(html, new RegExp(`name="visto" value="${id}"`));
  // Los datos que se editaron viajan escondidos para el segundo paso.
  assert.match(html, /name="precio" value="14\.900"/);
  // Nada se guardó ni se tocó en Mercado Pago.
  assert.equal((await leerPlan(db, planes.esencial)).precioCentavos, 1290000);
  assert.equal(putsDeMp().length, 0);
  assert.equal(n8n.recibidos.length, 0);
});

test('confirmar un aumento: sube el cobro de los que no se sacaron, conserva el precio de los que sí y avisa por mail', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const beto = await cliente('Beto', { mpId: 'mp2' });
  const sinMp = await cliente('Carla');
  const campos = camposEsencial({ precio: '14.900' });
  // Ana y Carla: "Aplicar" tildado. Beto: destildado (no sufre el aumento).
  const r = await confirmar(planes.esencial, campos, { visto: [ana, beto, sinMp], aplicar: [ana, sinMp] });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/plataforma/planes');

  assert.equal((await leerPlan(db, planes.esencial)).precioCentavos, 1490000, 'el plan se guardó');
  // Ana: el cobro de Mercado Pago y nuestra copia pasan a $14.900.
  assert.equal(montoMp('mp1'), 14900);
  assert.equal(await montoDb('mp1'), 1490000);
  assert.equal(await precioFijoDe(ana), null);
  // Beto: sigue con $12.900 y queda con precio fijo.
  assert.equal(montoMp('mp2'), 12900);
  assert.equal(await montoDb('mp2'), 1290000);
  assert.equal(await precioFijoDe(beto), 1290000);
  assert.equal(putsDeMp().length, 1, 'solo se le tocó a Ana');
  assert.deepEqual(putsDeMp()[0].cuerpo, { auto_recurring: { transaction_amount: 14900, currency_id: 'ARS' } });
  assert.equal(montoMp('mp1') > 0 && mp.suscripciones.get('mp1').auto_recurring.frequency, 1, 'el cambio de monto no borra el resto de la recurrencia');

  // Mails: Ana (con su próximo cobro) y Carla (cobra a mano); Beto no, porque el precio no le toca.
  const avisos = avisosDe('plan_modificado');
  assert.deepEqual(avisos.map((a) => a.email).sort(), ['ana@correo.com', 'carla@correo.com']);
  const aviso = avisos.find((a) => a.email === 'ana@correo.com');
  aviso.cambios = aviso.cambios.map((c) => ({ ...c, antes: sp(c.antes), despues: sp(c.despues) }));
  assert.deepEqual(aviso, {
    evento: 'plan_modificado',
    email: 'ana@correo.com',
    nombre: 'Ana',
    tienda: { nombre: 'Ana' },
    plan: { nombre: 'Esencial' },
    cambios: [{ etiqueta: 'Precio', antes: '$ 12.900 / mes', despues: '$ 14.900 / mes', cuando: 'desde tu próximo cobro (10 de febrero de 2030)' }],
    urlPanel: `http://localhost:${puerto}/admin`,
  });
  assert.equal(avisos.find((a) => a.email === 'carla@correo.com').cambios[0].cuando, 'desde tu próximo pago');
  assert.equal(n8n.recibidos[0].secreto, 'secreto-de-n8n');

  const resumen = await pagina('/plataforma/planes');
  assert.match(resumen, /Actualizamos el cobro de 1 cliente en Mercado Pago/);
  assert.match(resumen, /1 cliente conserva su precio de hoy \(quedó como precio fijo\)/);
  assert.match(resumen, /Avisamos por mail a 2 clientes/);
});

test('un cliente con precio fijo no sufre el aumento, aunque el formulario lo marque', async () => {
  const beto = await cliente('Beto', { mpId: 'mp2', fijo: 1290000 });
  const r = await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [beto], aplicar: [beto] });
  assert.equal(r.status, 302);
  assert.equal(await precioFijoDe(beto), 1290000);
  assert.equal(montoMp('mp2'), 12900);
  assert.equal(putsDeMp().length, 0);
  assert.equal(avisosDe('plan_modificado').length, 0, 'tampoco se le avisa de un precio que no le toca');
});

test('quien no se vio en la pantalla (apareció después) recibe el aumento como todos; los ids de otro plan se ignoran', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const tarde = await cliente('Tarde', { mpId: 'mp2' });
  const deOtroPlan = await cliente('Otro', { plan: planes.acompanado, mpId: 'mp3', monto: 34900 });
  // Se vio solo a Ana y se la sacó del aumento; "Tarde" no estaba en la pantalla. Además llega un id ajeno.
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana, deOtroPlan], aplicar: [] });
  assert.equal(await precioFijoDe(ana), 1290000, 'a quien se sacó, se lo respeta');
  assert.equal(await precioFijoDe(tarde), null);
  assert.equal(montoMp('mp2'), 14900, 'el que no se vio recibe el aumento');
  assert.equal(await precioFijoDe(deOtroPlan), null);
  assert.equal(montoMp('mp3'), 34900, 'un cliente de otro plan no se toca');
});

test('bajar el precio se aplica a todos los que no tienen precio fijo, sin elegir a nadie', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const beto = await cliente('Beto', { mpId: 'mp2', fijo: 1290000 });
  const html = await (await editar(planes.esencial, camposEsencial({ precio: '9.900' }))).text();
  assert.match(html, /La baja se aplica a todos los que no tienen precio fijo/);
  assert.doesNotMatch(html, /name="aplicar"/, 'en una baja no hay casillas');
  await confirmar(planes.esencial, camposEsencial({ precio: '9.900' }), { visto: [ana, beto] });
  assert.equal(montoMp('mp1'), 9900);
  assert.equal(montoMp('mp2'), 12900);
  assert.equal(await precioFijoDe(beto), 1290000);
  assert.equal(await precioFijoDe(ana), null, 'una baja no deja a nadie con precio fijo');
  assert.deepEqual(avisosDe('plan_modificado').map((a) => a.email), ['ana@correo.com']);
});

test('cambiar los topes alcanza a todos los clientes desde ya, también a los de precio fijo, sin tocar Mercado Pago', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const beto = await cliente('Beto', { mpId: 'mp2', fijo: 1290000 });
  const campos = camposEsencial({ maxProductos: '300', maxBanners: '3' });
  const html = await (await editar(planes.esencial, campos)).text();
  assert.match(html, /Confirmá los cambios/);
  assert.doesNotMatch(html, /Hoy paga/, 'sin cambio de precio no hay columnas de precio');
  assert.doesNotMatch(html, /name="aplicar"/);
  await confirmar(planes.esencial, campos, { visto: [ana, beto] });
  assert.equal((await leerPlan(db, planes.esencial)).maxProductos, 300);
  assert.equal(putsDeMp().length, 0);
  const avisos = avisosDe('plan_modificado');
  assert.deepEqual(avisos.map((a) => a.email).sort(), ['ana@correo.com', 'beto@correo.com']);
  assert.deepEqual(avisos[0].cambios.map((c) => [c.etiqueta, c.antes, c.despues, c.cuando]), [
    ['Productos', 'Hasta 150', 'Hasta 300', 'desde ya'],
    ['Banners de la portada', 'Hasta 2', 'Hasta 3', 'desde ya'],
  ]);
});

test('con un aumento y topes juntos, quien conserva su precio igual recibe el aviso de los topes', async () => {
  const beto = await cliente('Beto', { mpId: 'mp2' });
  const campos = camposEsencial({ precio: '14.900', maxProductos: '300' });
  await confirmar(planes.esencial, campos, { visto: [beto], aplicar: [] }); // Beto, sacado del aumento
  assert.equal(montoMp('mp2'), 12900);
  const [aviso] = avisosDe('plan_modificado');
  assert.deepEqual(aviso.cambios.map((c) => c.etiqueta), ['Productos'], 'del precio no, de los topes sí');
});

test('si no se tilda "avisarles por mail", el cambio se aplica y no sale ningún mail', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana], aplicar: [ana], avisarPorMail: false });
  assert.equal(montoMp('mp1'), 14900);
  assert.equal(n8n.recibidos.length, 0);
});

test('si Mercado Pago rechaza el cambio de un cliente, el plan se guarda, el resto se actualiza y se reintenta desde la ficha', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const beto = await cliente('Beto', { mpId: 'mp2' });
  mp.rechazarMonto.add('mp2');
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana, beto], aplicar: [ana, beto] });
  assert.equal((await leerPlan(db, planes.esencial)).precioCentavos, 1490000);
  assert.equal(montoMp('mp1'), 14900);
  assert.equal(montoMp('mp2'), 12900, 'Mercado Pago lo rechazó');
  assert.equal(await montoDb('mp2'), 1290000, 'nuestra copia sigue con lo que de verdad se cobra');
  assert.deepEqual(avisosDe('plan_modificado').map((a) => a.email), ['ana@correo.com'], 'a quien no se le pudo aplicar no se le avisa de un precio que no rige');
  const resumen = await pagina('/plataforma/planes');
  assert.match(resumen, /No pudimos actualizar en Mercado Pago a: Beto/);

  // En su ficha se ve la diferencia y se puede reintentar.
  const ficha = await pagina(`/plataforma/clientes/${beto}`);
  assert.match(ficha, /Mercado Pago le cobra <strong>\$\s?12\.900,00<\/strong> y le corresponde <strong>\$\s?14\.900,00<\/strong>/);
  mp.rechazarMonto.clear();
  const r = await admin.enviar(`/plataforma/clientes/${beto}/suscripcion/actualizar-monto`, { avisarPorMail: '1' }, { desde: `/plataforma/clientes/${beto}` });
  assert.equal(r.status, 302);
  assert.equal(montoMp('mp2'), 14900);
  assert.equal(await montoDb('mp2'), 1490000);
  assert.match(await pagina(`/plataforma/clientes/${beto}`), /Actualizamos el cobro en Mercado Pago a \$\s?14\.900,00 por mes/);
  assert.deepEqual(avisosDe('plan_modificado').map((a) => a.email).sort(), ['ana@correo.com', 'beto@correo.com']);
  assert.doesNotMatch(await pagina(`/plataforma/clientes/${beto}`), /y le corresponde/, 'ya no hay diferencia');
});

test('si n8n no responde, el cambio se aplica igual y se avisa que los mails no salieron', async () => {
  n8n.fallar = true;
  const ana = await cliente('Ana', { mpId: 'mp1' });
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana], aplicar: [ana] });
  assert.equal(montoMp('mp1'), 14900);
  assert.match(await pagina('/plataforma/planes'), /No salió el mail a 1 cliente/);
});

test('sin n8n configurado la pantalla lo advierte y el cambio se aplica sin mails', async () => {
  await levantar({ correo: false });
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const html = await (await editar(planes.esencial, camposEsencial({ precio: '14.900' }))).text();
  assert.match(html, /No hay un flujo de n8n configurado/);
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana], aplicar: [ana] });
  assert.equal(montoMp('mp1'), 14900);
  assert.equal(n8n.recibidos.length, 0);
});

test('sin Mercado Pago configurado, el aumento queda anotado y los clientes con débito se informan como pendientes', async () => {
  await levantar({ pagos: false });
  const ana = await cliente('Ana', { mpId: 'mp1' });
  await confirmar(planes.esencial, camposEsencial({ precio: '14.900' }), { visto: [ana], aplicar: [ana] });
  assert.equal((await leerPlan(db, planes.esencial)).precioCentavos, 1490000);
  assert.match(await pagina('/plataforma/planes'), /No pudimos actualizar en Mercado Pago a: Ana/);
  assert.equal(putsDeMp().length, 0);
});

test('datos inválidos en el segundo paso: no se guarda nada y se vuelve al formulario', async () => {
  const ana = await cliente('Ana', { mpId: 'mp1' });
  const r = await confirmar(planes.esencial, camposEsencial({ precio: 'barato' }), { visto: [ana], aplicar: [ana] });
  assert.equal(r.headers.get('location'), `/plataforma/planes/${planes.esencial}`);
  assert.equal((await leerPlan(db, planes.esencial)).precioCentavos, 1290000);
  assert.equal(putsDeMp().length, 0);
});

// ---------- Precio fijo desde la ficha ----------

test('la ficha deja fijar y quitar el precio de un cliente, y valida el monto', async () => {
  const ana = await cliente('Ana');
  let ficha = await pagina(`/plataforma/clientes/${ana}`);
  assert.match(ficha, /Precio de su plan/);
  assert.doesNotMatch(ficha, /Precio fijo<\/span>/);

  const mal = await admin.enviar(`/plataforma/clientes/${ana}/precio`, { precioFijo: 'regalado' }, { desde: `/plataforma/clientes/${ana}` });
  assert.equal(mal.status, 400);
  assert.match(await mal.text(), /Escribí el monto en pesos/);
  const cero = await admin.enviar(`/plataforma/clientes/${ana}/precio`, { precioFijo: '0' }, { desde: `/plataforma/clientes/${ana}` });
  assert.equal(cero.status, 400);
  assert.equal(await precioFijoDe(ana), null);

  const bien = await admin.enviar(`/plataforma/clientes/${ana}/precio`, { precioFijo: '9.500' }, { desde: `/plataforma/clientes/${ana}` });
  assert.equal(bien.status, 302);
  assert.equal(await precioFijoDe(ana), 950000);
  ficha = await pagina(`/plataforma/clientes/${ana}`);
  assert.match(ficha, /Fijamos su precio en \$\s?9\.500,00 por mes/);
  assert.match(ficha, /<span class="pastilla pastilla-ambar">Precio fijo<\/span>/);
  assert.match(ficha, /value="9\.500"/);
  assert.equal((await leerCliente(db, ana)).precioEfectivoCentavos, 950000);

  await admin.enviar(`/plataforma/clientes/${ana}/precio`, { precioFijo: '' }, { desde: `/plataforma/clientes/${ana}` });
  assert.equal(await precioFijoDe(ana), null);
  assert.match(await pagina(`/plataforma/clientes/${ana}`), /Ahora paga el precio de su plan/);
});

test('el ingreso mensual esperado usa lo que paga cada cliente (su precio fijo, si lo tiene)', async () => {
  await cliente('Ana');
  await cliente('Beto', { fijo: 950000 });
  assert.equal((await resumenPlataforma(db)).ingresoMensualCentavos, 1290000 + 950000);
  assert.match(await pagina('/plataforma/clientes'), /\$\s22\.400</);
});

test('al pasar a un cliente a otro plan, su precio fijo se borra; al "cambiarlo" al mismo plan, no', async () => {
  const beto = await cliente('Beto', { fijo: 950000 });
  await cambiarPlanDeCliente(db, beto, planes.esencial);
  assert.equal(await precioFijoDe(beto), 950000, 'es el mismo plan: nada cambia');
  await cambiarPlanDeCliente(db, beto, planes.acompanado);
  assert.equal(await precioFijoDe(beto), null, 'otro plan: vuelve a pagar el precio de ese plan');
  assert.deepEqual(await fijarPrecioDeCliente(db, beto, '1500'), { precioFijoCentavos: 150000 });
});

test('el monto sugerido al registrar un pago a mano es el que paga el cliente', async () => {
  const ana = await cliente('Ana', { fijo: 950000 });
  assert.match(await pagina(`/plataforma/clientes/${ana}`), /id="monto"[^>]*value="9\.500"/);
});
