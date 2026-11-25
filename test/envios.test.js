// Envíos de los pedidos a domicilio: pasos, empresa y número de seguimiento, historial, avisos al comprador (mail y WhatsApp) y lo que ve quien compró.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { actualizarAjustes, leerAjustes } from '../src/diseno.js';
import { crearPedido, cambiarEstado, cancelarPedido, leerPedido, siguientePaso, tituloVisible } from '../src/pedidos.js';
import {
  validarEnvio,
  actualizarEnvio,
  leerEventos,
  armarSeguimiento,
  descripcionDeEstado,
  mensajeDeEstado,
  enlaceDeSeguimiento,
  ESTADOS_ENVIO,
} from '../src/envios.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';
import { crearN8nFalso } from './mercadopago-falso.js';

let n8n;
let db;
let servidor;
let puerto;
let contador = 0;

before(async () => {
  n8n = crearN8nFalso();
  n8n.servidor.listen(0, '127.0.0.1');
  await once(n8n.servidor, 'listening');
  n8n.puerto = n8n.servidor.address().port;
});

after(async () => {
  servidor?.closeAllConnections();
  servidor?.close();
  n8n.servidor.closeAllConnections();
  n8n.servidor.close();
});

beforeEach(async () => {
  servidor?.closeAllConnections();
  servidor?.close();
  n8n.recibidos.length = 0;
  n8n.fallar = false;
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirImportaciones: '.',
    dirSubidas: '.',
    n8n: { url: `http://127.0.0.1:${n8n.puerto}/hook`, secreto: 'secreto-de-n8n' },
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

const avisosDe = (evento) => n8n.recibidos.filter((r) => r.cuerpo.evento === evento).map((r) => r.cuerpo);

async function tienda() {
  contador++;
  const slug = `tienda-envios-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Nube ${contador}`, email: `${slug}@ejemplo.com`, slug });
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 1500, 100]]);
  await aplicarImportacion(db, creada.id, productos);
  await actualizarAjustes(db, creada.id, { whatsapp: '5493511234567', emailContacto: 'hola@nube.com', direccion: 'Av. Colón 1234, Córdoba' });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug, nombre: `Nube ${contador}` };
}

const DIRECCION = { calle: 'Obispo Trejo 300', piso: '2 B', ciudad: 'Córdoba', provincia: 'Córdoba', cp: '5000', referencias: 'Portón negro' };
const SIN_DIRECCION = { calle: '', piso: '', ciudad: '', provincia: '', cp: '', referencias: '' };

// Un pedido a domicilio (por defecto, paga por transferencia y dejó su email).
async function pedidoADomicilio(tiendaId, { pago = 'transferencia', email = 'lucia@correo.com', nombre = 'Lucía Gómez' } = {}) {
  const { id, numero, token } = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 2 }], {
    cliente: { nombre, telefono: '351 123 4567', email },
    entrega: { tipo: 'domicilio', nombre: 'Moto en Córdoba', descripcion: '', costo: 450000, gratisDesde: null },
    direccion: DIRECCION,
    pago: { clave: pago, descuento: 0 },
    notas: '',
  });
  return { id, numero, token };
}

async function pedidoConRetiro(tiendaId, { pago = 'efectivo' } = {}) {
  const { id, numero, token } = await crearPedido(db, tiendaId, [{ sku: 'TAZA', cantidad: 1 }], {
    cliente: { nombre: 'Marcos Paz', telefono: '351 765 4321', email: 'marcos@correo.com' },
    entrega: { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null },
    direccion: SIN_DIRECCION,
    pago: { clave: pago, descuento: 0 },
    notas: '',
  });
  return { id, numero, token };
}

const estadoDe = async (id) => (await db.prepare('SELECT estado, envio_estado AS envio FROM pedidos WHERE id = ?').get(id));
const vidriera = (slug, ruta) => pedirConHost(puerto, `${slug}.localhost`, ruta);

// ---------- Validación ----------

test('validarEnvio acepta el paso, la empresa de la lista u otra, y solo links https; lo que no viene se deja como estaba', () => {
  const ok = validarEnvio({ estado: 'despachado', empresa: 'andreani', seguimiento: ' AB 123 ', enlace: 'https://seguimiento.andreani.com/AB123', detalle: 'Llega el 12', avisarEmail: '1' });
  assert.deepEqual(ok.errores, {});
  assert.deepEqual(ok.datos, { estado: 'despachado', avisarEmail: true, empresa: 'Andreani', seguimiento: 'AB 123', enlace: 'https://seguimiento.andreani.com/AB123', detalle: 'Llega el 12' });
  assert.equal(validarEnvio({ estado: 'en_camino', empresa: 'otra', empresaOtra: 'Expreso Sur' }).datos.empresa, 'Expreso Sur');
  assert.equal(validarEnvio({ estado: 'en_camino', empresa: '' }).datos.empresa, '', 'sin empresa: se borra');
  // Un botón de un clic manda solo el paso: nada más cambia.
  const solo = validarEnvio({ estado: 'en_camino' });
  assert.deepEqual(solo.datos, { estado: 'en_camino', avisarEmail: false });
  assert.equal(solo.datos.empresa, undefined);

  assert.ok(validarEnvio({ estado: 'volando' }).errores.estado);
  assert.ok(validarEnvio({ estado: 'despachado', empresa: 'correo-fantasma' }).errores.empresa);
  assert.ok(validarEnvio({ estado: 'despachado', enlace: 'http://inseguro.com' }).errores.enlace);
  assert.ok(validarEnvio({ estado: 'despachado', enlace: 'javascript:alert(1)' }).errores.enlace);
  assert.ok(validarEnvio({ estado: 'despachado', enlace: 'https://' }).errores.enlace);
  assert.equal(validarEnvio({ estado: 'despachado', seguimiento: 'x'.repeat(200) }).datos.seguimiento.length, 60, 'los textos tienen tope');
});

// ---------- Pasos del envío y estado general ----------

test('cada paso del envío mueve el estado general como corresponde y deja su movimiento en el historial', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  assert.deepEqual(await estadoDe(id), { estado: 'nuevo', envio: null });

  const prep = await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion' });
  assert.equal(prep.estadoGeneral, 'nuevo', 'preparar no cambia el estado general (puede no estar pago todavía)');
  assert.deepEqual(await estadoDe(id), { estado: 'nuevo', envio: 'preparacion' });

  const desp = await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'Andreani', seguimiento: 'AB123', detalle: 'Llega el 12' });
  assert.equal(desp.estadoGeneral, 'enviado');
  assert.deepEqual(await estadoDe(id), { estado: 'enviado', envio: 'despachado' });

  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  const camino = await leerPedido(db, tiendaId, id);
  assert.equal(camino.estado, 'enviado');
  assert.equal(camino.despacho.empresa, 'Andreani', 'un paso sin datos nuevos conserva la empresa');
  assert.equal(camino.despacho.seguimiento, 'AB123');
  assert.equal(camino.despacho.detalle, 'Llega el 12');

  await actualizarEnvio(db, tiendaId, id, { estado: 'entregado' });
  assert.deepEqual(await estadoDe(id), { estado: 'entregado', envio: 'entregado' });

  const eventos = await leerEventos(db, id);
  assert.deepEqual(eventos.map((e) => [e.paso, e.titulo, e.visible]), [
    ['recibido', 'Recibimos tu pedido', true],
    ['preparacion', 'En preparación', true],
    ['despachado', 'Despachado', true],
    ['en_camino', 'En camino', true],
    ['entregado', 'Entregado', true],
  ]);
  assert.equal(eventos[2].detalle, 'Andreani · N.º AB123 · Llega el 12');
});

test('volver a un paso anterior es una corrección: se anota pero el comprador no la ve, y el estado general retrocede', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  const atras = await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion' });
  assert.equal(atras.retroceso, true);
  assert.deepEqual(await estadoDe(id), { estado: 'pagado', envio: 'preparacion' });
  const eventos = await leerEventos(db, id);
  assert.equal(eventos.at(-1).visible, false);
  assert.equal((await leerEventos(db, id, { soloCliente: true })).length, eventos.length - 1);
  // Si se paga al recibir, la corrección lo deja como nuevo.
  const efectivo = await pedidoADomicilio(tiendaId, { pago: 'efectivo' });
  await actualizarEnvio(db, tiendaId, efectivo.id, { estado: 'despachado' });
  await actualizarEnvio(db, tiendaId, efectivo.id, { estado: 'preparacion' });
  assert.equal((await estadoDe(efectivo.id)).estado, 'nuevo');
  // Repetir el mismo paso (para corregir el número de seguimiento) no es una corrección.
  const igual = await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion', seguimiento: 'X1' });
  assert.equal(igual.retroceso, false);
});

test('no se puede tocar el envío de un retiro, de un pedido cancelado ni de otra tienda', async () => {
  const { tiendaId } = await tienda();
  const otra = await tienda();
  const retiro = await pedidoConRetiro(tiendaId);
  assert.equal(await actualizarEnvio(db, tiendaId, retiro.id, { estado: 'despachado' }), null);
  const cancelado = await pedidoADomicilio(tiendaId);
  await cancelarPedido(db, tiendaId, cancelado.id);
  assert.equal(await actualizarEnvio(db, tiendaId, cancelado.id, { estado: 'despachado' }), null);
  const ajeno = await pedidoADomicilio(otra.tiendaId);
  assert.equal(await actualizarEnvio(db, tiendaId, ajeno.id, { estado: 'despachado' }), null);
  assert.equal((await estadoDe(ajeno.id)).envio, null);
});

test('los botones del estado general acompañan al envío (y dejan su movimiento); una vuelta atrás no se le muestra al comprador', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await cambiarEstado(db, tiendaId, id, 'pagado');
  assert.deepEqual(await estadoDe(id), { estado: 'pagado', envio: null });
  await cambiarEstado(db, tiendaId, id, 'enviado');
  assert.deepEqual(await estadoDe(id), { estado: 'enviado', envio: 'despachado' });
  await cambiarEstado(db, tiendaId, id, 'entregado');
  assert.deepEqual(await estadoDe(id), { estado: 'entregado', envio: 'entregado' });
  const volver = await cambiarEstado(db, tiendaId, id, 'pagado');
  assert.equal(volver.cambio.retroceso, true);
  assert.deepEqual(await estadoDe(id), { estado: 'pagado', envio: 'preparacion' });
  await cambiarEstado(db, tiendaId, id, 'nuevo');
  assert.deepEqual(await estadoDe(id), { estado: 'nuevo', envio: 'preparacion' }, 'en preparación se queda: no estaba más adelante');
  const eventos = await leerEventos(db, id);
  assert.deepEqual(eventos.map((e) => [e.paso, e.visible]), [
    ['recibido', true], ['pagado', true], ['despachado', true], ['entregado', true], ['pagado', false], ['recibido', false],
  ]);
  assert.match(eventos[4].titulo, /^Corrección: pasó a Pagado$/);
  // El mismo estado otra vez no deja nada.
  const antes = (await leerEventos(db, id)).length;
  assert.deepEqual(await cambiarEstado(db, tiendaId, id, 'nuevo'), { cambio: null });
  assert.equal((await leerEventos(db, id)).length, antes);
  assert.equal(await cambiarEstado(db, tiendaId, id, 'cancelado'), false);
  assert.equal(await cambiarEstado(db, tiendaId, id, 'inventado'), false);
});

test('en un retiro los estados de siempre siguen igual, sin pasos de envío', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoConRetiro(tiendaId);
  await cambiarEstado(db, tiendaId, id, 'enviado');
  assert.deepEqual(await estadoDe(id), { estado: 'enviado', envio: null });
  const eventos = await leerEventos(db, id);
  assert.equal(eventos.at(-1).titulo, 'Listo para retirar');
  await cambiarEstado(db, tiendaId, id, 'entregado');
  assert.equal((await leerEventos(db, id)).at(-1).titulo, 'Retirado');
});

test('cancelar deja su movimiento en el historial', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await cancelarPedido(db, tiendaId, id);
  const eventos = await leerEventos(db, id);
  assert.deepEqual([eventos.at(-1).paso, eventos.at(-1).titulo], ['cancelado', 'Pedido cancelado']);
});

test('el paso siguiente de un pedido a domicilio es el del envío; el de un retiro, el de siempre', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId, { pago: 'efectivo' });
  const paso = async () => siguientePaso(await leerPedido(db, tiendaId, id));
  assert.deepEqual(await paso(), { envio: 'preparacion', texto: 'Empezar a preparar el pedido' });
  await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion' });
  assert.deepEqual(await paso(), { envio: 'despachado', ancla: 'envio', texto: 'Marcar como despachado…' });
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado' });
  assert.deepEqual(await paso(), { envio: 'en_camino', texto: 'Marcar como en camino' });
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  assert.deepEqual(await paso(), { envio: 'entregado', texto: 'Marcar como entregado' });
  await actualizarEnvio(db, tiendaId, id, { estado: 'entregado' });
  assert.equal(await paso(), null);
  // Con transferencia, primero el pago.
  const transf = await pedidoADomicilio(tiendaId);
  assert.deepEqual(siguientePaso(await leerPedido(db, tiendaId, transf.id)), { estado: 'pagado', texto: 'Marcar como pagado' });
  const retiro = await pedidoConRetiro(tiendaId);
  assert.deepEqual(siguientePaso(await leerPedido(db, tiendaId, retiro.id)), { estado: 'enviado', texto: 'Marcar como listo para retirar' });
});

// ---------- Textos de los avisos ----------

test('el aviso de cada estado dice qué pasó, con el seguimiento cuando el pedido ya salió', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  const texto = async () => {
    const pedido = await leerPedido(db, tiendaId, id);
    return { pedido, ...descripcionDeEstado(pedido, { tienda: 'Nube 1', direccionTienda: 'Av. Colón 1234' }) };
  };
  assert.deepEqual((({ titulo }) => titulo)(await texto()), 'Recibimos tu pedido #1');
  await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion' });
  assert.match((await texto()).titulo, /Estamos preparando tu pedido #1/);
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'Andreani', seguimiento: 'AB123', detalle: 'Llega entre el 12 y el 14' });
  let { pedido, titulo, texto: cuerpo } = await texto();
  assert.equal(titulo, 'Tu pedido #1 fue despachado');
  assert.equal(cuerpo, 'Tu pedido #1 de Nube 1 fue despachado con Andreani.');
  const whatsapp = mensajeDeEstado(pedido, { tienda: 'Nube 1', urlPedido: 'https://nube-1.vezzadev.com/pedido/abc' });
  assert.equal(whatsapp, [
    '¡Hola Lucía! Tu pedido #1 de Nube 1 fue despachado con Andreani.',
    'N.º de seguimiento: AB123',
    'Llega entre el 12 y el 14',
    'Seguilo acá: https://www.andreani.com',
    'Podés ver el estado de tu pedido acá: https://nube-1.vezzadev.com/pedido/abc',
  ].join('\n'));
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  assert.equal((await texto()).titulo, 'Tu pedido #1 está en camino');
  await actualizarEnvio(db, tiendaId, id, { estado: 'entregado' });
  assert.equal((await texto()).titulo, 'Tu pedido #1 fue entregado');
  assert.doesNotMatch(mensajeDeEstado((await texto()).pedido, { tienda: 'Nube 1' }), /seguimiento/i, 'una vez entregado ya no hace falta');

  const retiro = await leerPedido(db, tiendaId, (await pedidoConRetiro(tiendaId)).id);
  await cambiarEstado(db, tiendaId, retiro.id, 'enviado');
  const listo = descripcionDeEstado(await leerPedido(db, tiendaId, retiro.id), { tienda: 'Nube 1', direccionTienda: 'Av. Colón 1234' });
  assert.equal(listo.titulo, `Tu pedido #${retiro.numero} está listo para retirar`);
  assert.match(listo.texto, /ya está listo para retirar en Av\. Colón 1234\. ¡Te esperamos!/);
});

test('el link de seguimiento es el que se pegó o, si no, el sitio de la empresa; sin empresa conocida, ninguno', () => {
  assert.equal(enlaceDeSeguimiento({ empresa: 'Andreani', enlace: '' }), 'https://www.andreani.com');
  assert.equal(enlaceDeSeguimiento({ empresa: 'OCA', enlace: '' }), 'https://www.oca.com.ar');
  assert.equal(enlaceDeSeguimiento({ empresa: 'Correo Argentino', enlace: '' }), 'https://www.correoargentino.com.ar');
  assert.equal(enlaceDeSeguimiento({ empresa: 'Andreani', enlace: 'https://exacto.com/AB1' }), 'https://exacto.com/AB1');
  assert.equal(enlaceDeSeguimiento({ empresa: 'Moto o cadete propio', enlace: '' }), null);
  assert.equal(enlaceDeSeguimiento({ empresa: 'Expreso Sur', enlace: '' }), null);
  assert.equal(enlaceDeSeguimiento({ empresa: '', enlace: '' }), null);
});

// ---------- Línea de tiempo del comprador ----------

test('armarSeguimiento: los pasos cambian según cómo recibe y cómo paga, y marcan lo hecho, lo actual y lo que falta', async () => {
  const { tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await cambiarEstado(db, tiendaId, id, 'pagado');
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'OCA', seguimiento: '999' });
  const pedido = await leerPedido(db, tiendaId, id);
  const { pasos, envio } = armarSeguimiento(pedido, await leerEventos(db, id, { soloCliente: true }));
  assert.deepEqual(pasos.map((p) => [p.titulo, p.estado]), [
    ['Recibimos tu pedido', 'hecho'],
    ['Pago confirmado', 'hecho'],
    ['En preparación', 'hecho'],
    ['Despachado', 'actual'],
    ['En camino', 'pendiente'],
    ['Entregado', 'pendiente'],
  ]);
  assert.ok(pasos[0].fecha && pasos[3].fecha, 'lo que ya pasó tiene su fecha');
  assert.equal(pasos[4].fecha, null);
  assert.deepEqual(envio, { empresa: 'OCA', codigo: '999', detalle: '', enlace: 'https://www.oca.com.ar', conEnlaceExacto: false });

  // Se paga al recibir: no hay paso de pago.
  const efectivo = await leerPedido(db, tiendaId, (await pedidoADomicilio(tiendaId, { pago: 'efectivo' })).id);
  assert.deepEqual(armarSeguimiento(efectivo, []).pasos.map((p) => p.titulo), ['Recibimos tu pedido', 'En preparación', 'Despachado', 'En camino', 'Entregado']);
  // Retiro.
  const retiro = await leerPedido(db, tiendaId, (await pedidoConRetiro(tiendaId, { pago: 'transferencia' })).id);
  assert.deepEqual(armarSeguimiento(retiro, []).pasos.map((p) => p.titulo), ['Recibimos tu pedido', 'Pago confirmado', 'Listo para retirar', 'Retirado']);
  assert.equal(armarSeguimiento(retiro, []).envio, null);
  // Entregado: todo hecho.
  await actualizarEnvio(db, tiendaId, id, { estado: 'entregado' });
  const entregado = armarSeguimiento(await leerPedido(db, tiendaId, id), []);
  assert.ok(entregado.pasos.every((p) => p.estado === 'hecho'));
  assert.equal(tituloVisible(await leerPedido(db, tiendaId, id)), 'Entregado');
});

test('la página del pedido muestra el seguimiento, el número con su botón y el link; nunca la nota interna ni las correcciones', async () => {
  const { nav, tiendaId, slug } = await tienda();
  const { id, token } = await pedidoADomicilio(tiendaId);
  await cambiarEstado(db, tiendaId, id, 'pagado');
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino', empresa: 'Andreani', seguimiento: 'AB123', detalle: 'Llega entre el 12 y el 14' });
  await actualizarEnvio(db, tiendaId, id, { estado: 'preparacion' }); // corrección: no se ve
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  await nav.enviar(`/admin/pedidos/${id}/nota`, { nota: 'El cliente es difícil de ubicar' }, { desde: `/admin/pedidos/${id}` });

  const { status, cuerpo } = await vidriera(slug, `/pedido/${token}`);
  assert.equal(status, 200);
  assert.match(cuerpo, /<h2 id="titulo-seguimiento">[\s\S]*Seguimiento<\/h2>/);
  for (const titulo of ['Recibimos tu pedido', 'Pago confirmado', 'En preparación', 'Despachado', 'En camino', 'Entregado']) assert.ok(cuerpo.includes(`<strong>${titulo}</strong>`), titulo);
  assert.match(cuerpo, /seguimiento-paso seguimiento-actual" aria-current="step"/);
  assert.match(cuerpo, /<span class="dato-cuenta">Andreani<\/span>/);
  assert.match(cuerpo, /<span class="dato-cuenta">AB123<\/span>/);
  assert.match(cuerpo, /data-copiar="AB123"/);
  assert.match(cuerpo, /Llega entre el 12 y el 14/);
  assert.match(cuerpo, /<a class="boton boton-contorno" href="https:\/\/www\.andreani\.com"[^>]*>[\s\S]*Seguir mi envío/);
  assert.match(cuerpo, /En el sitio de la empresa, escribí el número de seguimiento/);
  assert.match(cuerpo, /Tu pedido está en camino/);
  assert.doesNotMatch(cuerpo, /difícil de ubicar/, 'la nota interna no sale');
  assert.doesNotMatch(cuerpo, /Corrección/);
  // Con un link exacto, es ése y no pide escribir el número.
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino', enlace: 'https://seguimiento.andreani.com/AB123' });
  const conLink = (await vidriera(slug, `/pedido/${token}`)).cuerpo;
  assert.match(conLink, /href="https:\/\/seguimiento\.andreani\.com\/AB123"/);
  assert.doesNotMatch(conLink, /En el sitio de la empresa/);
});

test('un pedido cancelado no muestra línea de tiempo; uno nuevo, sí, con el primer paso', async () => {
  const { tiendaId, slug } = await tienda();
  const nuevo = await pedidoADomicilio(tiendaId);
  const html = (await vidriera(slug, `/pedido/${nuevo.token}`)).cuerpo;
  assert.match(html, /seguimiento-paso seguimiento-actual/);
  assert.doesNotMatch(html, /Seguir mi envío/, 'todavía no hay nada que seguir');
  await cancelarPedido(db, tiendaId, nuevo.id);
  const cancelado = (await vidriera(slug, `/pedido/${nuevo.token}`)).cuerpo;
  assert.doesNotMatch(cancelado, /pedido-seguimiento/);
  assert.match(cancelado, /Este pedido se canceló/);
});

// ---------- Panel ----------

test('el detalle de un pedido a domicilio tiene la tarjeta del envío, el historial y el botón de imprimir; el de un retiro no tiene envío', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  const html = await (await nav.pedir(`/admin/pedidos/${id}`)).text();
  assert.match(html, /<section class="tarjeta seccion-editor" id="envio">/);
  for (const paso of Object.values(ESTADOS_ENVIO)) assert.ok(html.includes(`<strong>${paso.titulo}</strong>`) || html.includes(paso.titulo), paso.titulo);
  assert.match(html, /<option value="andreani">Andreani<\/option>/);
  assert.match(html, /<option value="otra">Otra<\/option>/);
  assert.match(html, /name="avisarEmail" value="1"[^>]*>/);
  assert.match(html, /Avisarle al cliente por mail \(lucia@correo\.com\)/);
  assert.match(html, /<section class="tarjeta seccion-editor" id="historial">/);
  assert.match(html, /Recibimos tu pedido/);
  assert.match(html, new RegExp(`href="/admin/pedidos/${id}/imprimir"`));
  assert.match(html, /id="nota"/);
  assert.match(html, /Marcar como pagado/, 'con transferencia, primero el pago');

  const retiro = await pedidoConRetiro(tiendaId);
  const detalle = await (await nav.pedir(`/admin/pedidos/${retiro.id}`)).text();
  assert.doesNotMatch(detalle, /id="envio"/);
  assert.match(detalle, /Marcar como listo para retirar/);
  // Sin email, la casilla del mail está apagada y avisa que hay que usar WhatsApp.
  const sinEmail = await pedidoADomicilio(tiendaId, { email: '' });
  const sin = await (await nav.pedir(`/admin/pedidos/${sinEmail.id}`)).text();
  assert.match(sin, /name="avisarEmail" value="1" disabled/);
  assert.match(sin, /No dejó su email: avisale por WhatsApp/);
});

test('actualizar el envío desde la tarjeta: guarda el paso y los datos y le manda el mail al comprador si se tilda', async () => {
  const { nav, tiendaId, slug, nombre } = await tienda();
  const { id, token } = await pedidoADomicilio(tiendaId);
  const r = await nav.enviar(
    `/admin/pedidos/${id}/envio`,
    { completo: '1', estado: 'despachado', empresa: 'andreani', empresaOtra: '', seguimiento: 'AB123', enlace: '', detalle: 'Llega entre el 12 y el 14', avisarEmail: '1' },
    { desde: `/admin/pedidos/${id}` },
  );
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/admin/pedidos/${id}`);
  const pedido = await leerPedido(db, tiendaId, id);
  assert.deepEqual(pedido.despacho, { estado: 'despachado', empresa: 'Andreani', seguimiento: 'AB123', enlace: '', detalle: 'Llega entre el 12 y el 14' });
  assert.equal(pedido.estado, 'enviado');

  const [aviso] = avisosDe('pedido_actualizado');
  assert.equal(avisosDe('pedido_actualizado').length, 1);
  assert.equal(n8n.recibidos[0].secreto, 'secreto-de-n8n');
  assert.deepEqual(aviso, {
    evento: 'pedido_actualizado',
    email: 'lucia@correo.com',
    cliente: { nombre: 'Lucía Gómez' },
    tienda: { nombre, url: `http://${slug}.localhost:${puerto}`, email: 'hola@nube.com', whatsapp: 'https://wa.me/5493511234567' },
    pedido: {
      numero: 1,
      url: `http://${slug}.localhost:${puerto}/pedido/${token}`,
      total: aviso.pedido.total,
      estado: 'Despachado',
    },
    titulo: 'Tu pedido #1 fue despachado',
    mensaje: `Tu pedido #1 de ${nombre} fue despachado con Andreani.`,
    seguimiento: { empresa: 'Andreani', codigo: 'AB123', url: 'https://www.andreani.com', detalle: 'Llega entre el 12 y el 14' },
  });
  assert.match(aviso.pedido.total, /\$\s?\d/);
  const despues = await (await nav.pedir(`/admin/pedidos/${id}`)).text();
  assert.match(despues, /El envío del pedido #1 quedó como &#34;Despachado&#34;\. Le avisamos por mail\.|El envío del pedido #1 quedó como "Despachado"\. Le avisamos por mail\./);
  assert.match(despues, /Mail enviado/, 'el historial marca que se avisó');
  assert.match(despues, /Andreani · N\.º AB123 · Llega entre el 12 y el 14/);
  assert.match(despues, /value="AB123"/, 'el formulario viene con lo guardado');
  assert.match(despues, /<option value="andreani" selected>/);
});

test('si no se tilda el mail, no sale; sin email o con n8n caído, el aviso lo dice', async () => {
  const { nav, tiendaId } = await tienda();
  const a = await pedidoADomicilio(tiendaId);
  await nav.enviar(`/admin/pedidos/${a.id}/envio`, { completo: '1', estado: 'despachado', empresa: '', seguimiento: '' }, { desde: `/admin/pedidos/${a.id}` });
  assert.equal(n8n.recibidos.length, 0);
  assert.doesNotMatch(await (await nav.pedir(`/admin/pedidos/${a.id}`)).text(), /Le avisamos por mail/);

  const sinEmail = await pedidoADomicilio(tiendaId, { email: '' });
  await nav.enviar(`/admin/pedidos/${sinEmail.id}/envio`, { completo: '1', estado: 'despachado', avisarEmail: '1' }, { desde: `/admin/pedidos/${sinEmail.id}` });
  assert.match(await (await nav.pedir(`/admin/pedidos/${sinEmail.id}`)).text(), /No dejó su email: avisale por WhatsApp/);
  assert.equal(n8n.recibidos.length, 0);

  n8n.fallar = true;
  const caido = await pedidoADomicilio(tiendaId);
  await nav.enviar(`/admin/pedidos/${caido.id}/envio`, { completo: '1', estado: 'despachado', avisarEmail: '1' }, { desde: `/admin/pedidos/${caido.id}` });
  assert.equal((await leerPedido(db, tiendaId, caido.id)).despacho.estado, 'despachado', 'el envío se guardó igual');
  assert.match(await (await nav.pedir(`/admin/pedidos/${caido.id}`)).text(), /No pudimos mandarle el mail/);
  assert.equal((await leerEventos(db, caido.id)).at(-1).avisadoEmail, false);
});

test('una corrección del envío no le avisa al comprador, aunque esté tildado el mail', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino' });
  await nav.enviar(`/admin/pedidos/${id}/envio`, { completo: '1', estado: 'preparacion', avisarEmail: '1' }, { desde: `/admin/pedidos/${id}` });
  assert.equal(n8n.recibidos.length, 0);
});

test('datos inválidos del envío: vuelve al pedido con el error, sin guardar nada', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  const r = await nav.enviar(`/admin/pedidos/${id}/envio`, { completo: '1', estado: 'despachado', enlace: 'http://sin-https.com', seguimiento: 'AB1' }, { desde: `/admin/pedidos/${id}` });
  assert.equal(r.status, 400);
  const html = await r.text();
  assert.match(html, /El link tiene que empezar con https:\/\//);
  assert.match(html, /value="AB1"/, 'conserva lo que se escribió');
  assert.deepEqual((await estadoDe(id)), { estado: 'nuevo', envio: null });
  const sinPaso = await nav.enviar(`/admin/pedidos/${id}/envio`, { completo: '1', seguimiento: 'AB1' }, { desde: `/admin/pedidos/${id}` });
  assert.equal(sinPaso.status, 400);
});

test('los botones de un clic cambian el paso sin tocar la empresa, y mandan mail solo si la tienda activó los avisos', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'OCA', seguimiento: '777' });
  const volver = '/admin/pedidos?filtro=abiertos';
  const r = await nav.enviar(`/admin/pedidos/${id}/envio`, { estado: 'en_camino', volver }, { desde: '/admin/pedidos' });
  assert.equal(r.headers.get('location'), volver);
  const pedido = await leerPedido(db, tiendaId, id);
  assert.equal(pedido.despacho.estado, 'en_camino');
  assert.equal(pedido.despacho.empresa, 'OCA');
  assert.equal(pedido.despacho.seguimiento, '777');
  assert.equal(n8n.recibidos.length, 0, 'por defecto, nada se manda solo');

  // Activar los avisos en Envíos y pagos.
  const pagos = await (await nav.pedir('/admin/pagos')).text();
  assert.match(pagos, /<form method="post" action="\/admin\/pagos\/avisos"/);
  assert.doesNotMatch(pagos, /name="avisosPedidoEmail" value="1" checked/);
  assert.equal((await nav.enviar('/admin/pagos/avisos', { avisosPedidoEmail: '1' }, { desde: '/admin/pagos' })).status, 302);
  assert.equal((await leerAjustes(db, tiendaId)).avisosPedidoEmail, true);
  assert.match(await (await nav.pedir('/admin/pagos')).text(), /name="avisosPedidoEmail" value="1" checked/);

  await nav.enviar(`/admin/pedidos/${id}/envio`, { estado: 'entregado' }, { desde: '/admin/pedidos' });
  assert.equal(avisosDe('pedido_actualizado').length, 1);
  assert.equal(avisosDe('pedido_actualizado')[0].titulo, 'Tu pedido #1 fue entregado');
  // Y los cambios de estado general también avisan (el botón de pagado, listo para retirar...).
  const retiro = await pedidoConRetiro(tiendaId);
  await nav.enviar(`/admin/pedidos/${retiro.id}/estado`, { estado: 'enviado' }, { desde: '/admin/pedidos' });
  assert.equal(avisosDe('pedido_actualizado').at(-1).titulo, `Tu pedido #${retiro.numero} está listo para retirar`);
  assert.equal(avisosDe('pedido_actualizado').at(-1).mensaje.includes('Av. Colón 1234'), true, 'con la dirección del local');
  // Una vuelta atrás no avisa.
  const cuenta = avisosDe('pedido_actualizado').length;
  await nav.enviar(`/admin/pedidos/${retiro.id}/estado`, { estado: 'nuevo' }, { desde: '/admin/pedidos' });
  assert.equal(avisosDe('pedido_actualizado').length, cuenta);
  // Cancelar también.
  await nav.enviar(`/admin/pedidos/${retiro.id}/cancelar`, {}, { desde: `/admin/pedidos/${retiro.id}` });
  assert.equal(avisosDe('pedido_actualizado').at(-1).titulo, `Tu pedido #${retiro.numero} fue cancelado`);
  // Se apaga.
  await nav.enviar('/admin/pagos/avisos', {}, { desde: '/admin/pagos' });
  assert.equal((await leerAjustes(db, tiendaId)).avisosPedidoEmail, false);
});

test('"Volver a avisar por mail" manda el estado de ahora y lo marca en el historial', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'Andreani', seguimiento: 'AB123' });
  const r = await nav.enviar(`/admin/pedidos/${id}/avisar-email`, {}, { desde: `/admin/pedidos/${id}` });
  assert.equal(r.status, 302);
  assert.equal(avisosDe('pedido_actualizado').length, 1);
  assert.equal(avisosDe('pedido_actualizado')[0].titulo, 'Tu pedido #1 fue despachado');
  assert.match(await (await nav.pedir(`/admin/pedidos/${id}`)).text(), /Le mandamos a lucia@correo\.com el estado de su pedido/);
  assert.equal((await leerEventos(db, id)).at(-1).avisadoEmail, true);
});

test('la nota interna se guarda y es solo del negocio', async () => {
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  const r = await nav.enviar(`/admin/pedidos/${id}/nota`, { nota: '  Llamar antes de ir  ' }, { desde: `/admin/pedidos/${id}` });
  assert.equal(r.headers.get('location'), `/admin/pedidos/${id}#nota`);
  assert.equal((await leerPedido(db, tiendaId, id)).notaInterna, 'Llamar antes de ir');
  assert.match(await (await nav.pedir(`/admin/pedidos/${id}`)).text(), /Llamar antes de ir/);
  // De otra tienda no se toca.
  const otra = await tienda();
  assert.equal((await otra.nav.enviar(`/admin/pedidos/${id}/nota`, { nota: 'intruso' }, { desde: '/admin/pedidos' })).status, 404);
  assert.equal((await leerPedido(db, tiendaId, id)).notaInterna, 'Llamar antes de ir');
});

test('la hoja para imprimir trae la dirección, los productos y el seguimiento; de otra tienda no se abre', async () => {
  const { nav, tiendaId } = await tienda();
  const { id, numero } = await pedidoADomicilio(tiendaId);
  await actualizarEnvio(db, tiendaId, id, { estado: 'despachado', empresa: 'OCA', seguimiento: '777' });
  const r = await nav.pedir(`/admin/pedidos/${id}/imprimir`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, new RegExp(`Remito del pedido #${numero}`));
  assert.match(html, /Enviar a/);
  assert.match(html, /Lucía Gómez/);
  assert.match(html, /Obispo Trejo 300, 2 B/);
  assert.match(html, /CP 5000 · Córdoba · Córdoba/);
  assert.match(html, /Referencias: Portón negro/);
  assert.match(html, /Taza/);
  assert.match(html, /OCA · N\.º 777/);
  assert.match(html, /onclick="window\.print\(\)"/);
  const otra = await tienda();
  assert.equal((await otra.nav.pedir(`/admin/pedidos/${id}/imprimir`)).status, 404);
});

test('la lista de pedidos muestra el paso del envío en la pastilla y ofrece el paso siguiente del envío en el menú', async () => {
  const { nav, tiendaId } = await tienda();
  const preparando = await pedidoADomicilio(tiendaId, { pago: 'efectivo' });
  const enCamino = await pedidoADomicilio(tiendaId, { pago: 'efectivo' });
  const nuevo = await pedidoADomicilio(tiendaId, { pago: 'efectivo' });
  await actualizarEnvio(db, tiendaId, preparando.id, { estado: 'preparacion' });
  await actualizarEnvio(db, tiendaId, enCamino.id, { estado: 'en_camino' });
  const html = await (await nav.pedir('/admin/pedidos?filtro=todos')).text();
  assert.match(html, /pastilla pastilla-enviado">En camino</);
  assert.match(html, /pastilla pastilla-nuevo">En preparación</);
  const menu = (id) => html.match(new RegExp(`id="acciones-${id}"[\\s\\S]*?</div>`))[0];
  assert.match(menu(nuevo.id), new RegExp(`action="/admin/pedidos/${nuevo.id}/envio"[\\s\\S]*name="estado" value="preparacion"[\\s\\S]*Empezar a preparar el pedido`));
  assert.match(menu(preparando.id), new RegExp(`href="/admin/pedidos/${preparando.id}#envio"[^>]*>[\\s\\S]*Marcar como despachado…`), 'pide cargar la empresa y el número: lleva a la tarjeta');
  assert.match(menu(enCamino.id), new RegExp(`action="/admin/pedidos/${enCamino.id}/envio"[\\s\\S]*name="estado" value="entregado"[\\s\\S]*Marcar como entregado`));
});

test('el WhatsApp del detalle lleva el mensaje del estado en el que está el pedido, con el seguimiento', async () => {
  const { nav, tiendaId, nombre } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  const decodificar = (html) => decodeURIComponent(html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)[1].split('text=')[1].replaceAll('&amp;', '&'));
  assert.match(decodificar(await (await nav.pedir(`/admin/pedidos/${id}`)).text()), new RegExp(`^¡Hola Lucía! Te escribimos de ${nombre} por tu pedido #1\\.$`), 'nuevo: el saludo de siempre');
  await actualizarEnvio(db, tiendaId, id, { estado: 'en_camino', empresa: 'Andreani', seguimiento: 'AB123' });
  const mensaje = decodificar(await (await nav.pedir(`/admin/pedidos/${id}`)).text());
  assert.ok(mensaje.includes(`Tu pedido #1 de ${nombre} está en camino con Andreani.`));
  assert.match(mensaje, /N\.º de seguimiento: AB123/);
});

test('sin el flujo de n8n configurado todo anda y el panel avisa que los mails no salen', async () => {
  servidor.closeAllConnections();
  servidor.close();
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirImportaciones: '.', dirSubidas: '.' };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  const { nav, tiendaId } = await tienda();
  const { id } = await pedidoADomicilio(tiendaId);
  assert.match(await (await nav.pedir(`/admin/pedidos/${id}`)).text(), /El envío de mails todavía no está activado en la plataforma/);
  assert.match(await (await nav.pedir('/admin/pagos')).text(), /El envío de mails todavía no está activado en la plataforma/);
  await nav.enviar(`/admin/pedidos/${id}/envio`, { completo: '1', estado: 'despachado', avisarEmail: '1' }, { desde: `/admin/pedidos/${id}` });
  assert.equal((await leerPedido(db, tiendaId, id)).despacho.estado, 'despachado');
  assert.match(await (await nav.pedir(`/admin/pedidos/${id}`)).text(), /No pudimos mandarle el mail/);
});
