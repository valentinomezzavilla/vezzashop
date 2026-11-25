// El código del nodo "Validar y armar mail" del flujo de n8n (n8n/validar-y-armar-mail.js), probado con los avisos que de verdad arma la app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { armarAvisoPlanModificado } from '../src/cambios-de-plan.js';
import { avisoDePedido } from '../src/envios.js';
import { armarAvisoCuentaCreada } from '../src/notificaciones.js';

const codigo = readFileSync(path.join(import.meta.dirname, '..', 'n8n', 'validar-y-armar-mail.js'), 'utf8');
// Lo que hace n8n: el código corre como el cuerpo de una función con $input (el JSON que mandó la app, dentro de `body`).
const correr = (body) => new Function('$input', codigo)({ first: () => ({ json: { body } }) })[0].json;
// Como el notificador: { evento, ...datos }, que viaja como JSON.
const aviso = (evento, datos) => ({ evento, ...JSON.parse(JSON.stringify(datos)) });
const sinNbsp = (texto) => texto.replace(/ /g, ' ');

function sinBasura(resultado, etiqueta) {
  for (const campo of ['html', 'text', 'asunto']) {
    assert.doesNotMatch(resultado[campo], /undefined|\[object Object\]|NaN|\bnull\b/, `${etiqueta}: "${campo}" tiene basura`);
  }
}

test('el código del nodo compila', () => {
  assert.doesNotThrow(() => new Function('$input', codigo));
});

test('cuenta_creada y pago_recibido (los de siempre) siguen armándose bien', () => {
  const cuenta = correr(aviso('cuenta_creada', armarAvisoCuentaCreada({
    email: 'Ana@Correo.com', nombre: 'Ana', apellido: 'Pérez', tiendaNombre: 'Casa <Ana>', tiendaUrl: 'https://casa-ana.vezzashop.com',
    planNombre: 'Esencial', precio: '$ 12.900 / mes', urlPanel: 'https://vezzashop.com/admin',
  })));
  assert.equal(cuenta.valido, true);
  assert.equal(cuenta.destino, 'ana@correo.com');
  assert.equal(cuenta.asunto, 'Tu cuenta de VEZZA Shop está lista');
  assert.equal(cuenta.desde, 'VEZZA Shop <info@vezzadev.com>');
  assert.equal(cuenta.responderA, 'info@vezzadev.com');
  assert.ok(cuenta.html.includes('href="https://vezzashop.com/admin"'));
  assert.ok(cuenta.html.includes('Casa &lt;Ana&gt;') && !cuenta.html.includes('Casa <Ana>'), 'escapa el HTML del nombre de la tienda');
  assert.ok(cuenta.html.includes('https://casa-ana.vezzashop.com'));
  assert.ok(cuenta.text.includes('https://vezzashop.com/admin') && !cuenta.text.includes('<br>'));
  sinBasura(cuenta, 'cuenta_creada');

  const pago = correr(aviso('pago_recibido', { email: 'ana@correo.com', plan: { nombre: 'Esencial', precio: '$ 12.900 / mes' }, urlCuenta: 'https://vezzashop.com/suscribirse/cuenta?t=1.abc' }));
  assert.equal(pago.valido, true);
  assert.equal(pago.asunto, 'Recibimos tu pago · creá tu cuenta de VEZZA Shop');
  assert.ok(pago.html.includes('Crear mi cuenta'));
  sinBasura(pago, 'pago_recibido');
  assert.equal(correr(aviso('pago_recibido', { email: 'ana@correo.com', urlCuenta: 'http://inseguro.com/x' })).valido, false, 'solo links https');
  assert.equal(correr(aviso('cuenta_creada', { email: 'no-es-un-mail', urlPanel: 'https://x.com/admin' })).valido, false);
  assert.equal(correr(aviso('evento_raro', { email: 'ana@correo.com' })).valido, false);
});

test('plan_modificado lista lo que cambió y desde cuándo', () => {
  const cliente = { email: 'Ana@Correo.com', titularNombre: 'Ana', nombre: 'Casa <Ana> & "Hijos"', proximoCobro: '2026-12-25' };
  const cambios = [
    { etiqueta: 'Precio', antes: '$ 12.900 / mes', despues: '$ 14.900 / mes', precio: true },
    { etiqueta: 'Productos', antes: 'Hasta 150', despues: 'Hasta 300', precio: false },
  ];
  const plan = correr(aviso('plan_modificado', armarAvisoPlanModificado(cliente, 'Esencial', cambios, 'https://tiendas.vezzadev.com')));
  assert.equal(plan.valido, true, JSON.stringify(plan.errores));
  assert.equal(plan.destino, 'ana@correo.com');
  assert.equal(plan.asunto, 'Cambios en tu plan Esencial de VEZZA Shop');
  assert.equal(plan.desde, 'VEZZA Shop <info@vezzadev.com>');
  assert.ok(plan.html.includes('Hola Ana,<br>cambió tu plan'));
  assert.ok(plan.html.includes('Casa &lt;Ana&gt; &amp; &quot;Hijos&quot;') && !plan.html.includes('Casa <Ana>'));
  assert.ok(sinNbsp(plan.html).includes('$ 12.900 / mes') && sinNbsp(plan.html).includes('$ 14.900 / mes'));
  assert.ok(plan.html.includes('desde tu próximo cobro (25 de diciembre de 2026)'));
  assert.ok(plan.html.includes('desde ya'));
  assert.ok(plan.html.includes('href="https://tiendas.vezzadev.com/admin"'));
  assert.ok(sinNbsp(plan.text).includes('• Precio: $ 12.900 / mes → $ 14.900 / mes (desde tu próximo cobro (25 de diciembre de 2026))'));
  assert.ok(plan.text.includes('• Productos: Hasta 150 → Hasta 300 (desde ya)'));
  sinBasura(plan, 'plan_modificado');
  assert.equal(correr(aviso('plan_modificado', { email: 'ana@correo.com', cambios: [], urlPanel: 'https://x.com/admin' })).valido, false, 'sin cambios no hay mail');
  assert.equal(correr(aviso('plan_modificado', { email: 'ana@correo.com', cambios: [{ etiqueta: 'Precio', despues: '$ 1' }], urlPanel: 'ftp://x.com' })).valido, false);
  // Sin nombre del titular, el saludo no lo lleva.
  assert.ok(correr(aviso('plan_modificado', armarAvisoPlanModificado({ ...cliente, titularNombre: '' }, 'Esencial', cambios, 'https://t.com'))).html.includes('Cambió tu plan'));
});

test('suscripcion_cancelada dice hasta cuándo sigue la tienda, o que ya no tiene días pagos', () => {
  const base = { email: 'luz@taller.com', nombre: 'Luz', apellido: 'Díaz', tienda: { nombre: 'Taller Luz' }, plan: { nombre: 'Esencial' }, urlReactivar: 'https://tiendas.vezzadev.com/admin/suscripcion' };
  const vigente = correr(aviso('suscripcion_cancelada', { ...base, accesoHasta: '2026-11-25', accesoHastaTexto: '25 de noviembre de 2026', vencida: false }));
  assert.equal(vigente.valido, true);
  assert.equal(vigente.asunto, 'Cancelaste tu suscripción de VEZZA Shop');
  assert.ok(vigente.html.includes('sigue funcionando hasta el 25 de noviembre de 2026'));
  assert.ok(vigente.html.includes('Reactivar mi suscripción') && vigente.html.includes('href="https://tiendas.vezzadev.com/admin/suscripcion"'));
  assert.ok(vigente.text.includes('sigue funcionando hasta el 25 de noviembre de 2026'));
  assert.ok(vigente.html.includes('Hola Luz,<br>cancelaste tu suscripción'));
  sinBasura(vigente, 'suscripcion_cancelada vigente');
  const vencida = correr(aviso('suscripcion_cancelada', { ...base, accesoHasta: null, accesoHastaTexto: '', vencida: true }));
  assert.equal(vencida.valido, true);
  assert.ok(vencida.html.includes('ya no tiene días pagos') && !vencida.html.includes('sigue funcionando hasta'));
  sinBasura(vencida, 'suscripcion_cancelada vencida');
  assert.equal(correr(aviso('suscripcion_cancelada', { ...base, urlReactivar: '' })).valido, false);
});

const PEDIDO = {
  numero: 12, estado: 'enviado', total: 4300000, envio: 450000,
  cliente: { nombre: 'Lucía Gómez', telefono: '351 123 4567', email: 'Lucia@Correo.com' },
  entrega: { tipo: 'domicilio', nombre: 'Moto', descripcion: '' },
  despacho: { estado: 'en_camino', empresa: 'Andreani', seguimiento: 'AB123', enlace: '', detalle: 'Llega entre el 12 y el 14' },
};
const TIENDA = {
  tienda: 'Nube <Studio> "Casa", S.A.', urlTienda: 'https://nube.vezzadev.com', emailTienda: 'Hola@Nube.com',
  whatsappTienda: 'https://wa.me/5493511234567', urlPedido: 'https://nube.vezzadev.com/pedido/abc123', direccionTienda: 'Av. Colón 1234',
};

test('pedido_actualizado sale con el nombre de la tienda, responde a su contacto y lleva el seguimiento', () => {
  const r = correr(aviso('pedido_actualizado', avisoDePedido(PEDIDO, TIENDA)));
  assert.equal(r.valido, true, JSON.stringify(r.errores));
  assert.equal(r.destino, 'lucia@correo.com');
  assert.equal(r.desde, 'Nube Studio Casa S.A. <info@vezzadev.com>', 'el remitente no lleva comillas, <>, comas ni :;');
  assert.equal(r.responderA, 'hola@nube.com');
  assert.ok(r.asunto.startsWith('Tu pedido #12 está en camino · '));
  assert.ok(r.html.includes('Nube &lt;Studio&gt; &quot;Casa&quot;, S.A.') && !r.html.includes('Nube <Studio>'));
  assert.ok(r.html.includes('Tu pedido #12 está en camino'));
  assert.ok(r.html.includes('AB123') && r.html.includes('Andreani') && r.html.includes('Llega entre el 12 y el 14'));
  assert.ok(r.html.includes('href="https://www.andreani.com"') && r.html.includes('Seguir mi envío'));
  assert.ok(r.html.includes('href="https://nube.vezzadev.com/pedido/abc123"') && r.html.includes('Ver mi pedido'));
  assert.ok(r.html.includes('href="mailto:hola@nube.com"') && r.html.includes('href="https://wa.me/5493511234567"'));
  assert.ok(r.text.includes('N.º de seguimiento: AB123'));
  assert.ok(r.text.includes('Seguir mi envío: https://www.andreani.com'));
  assert.ok(r.text.includes('Ver mi pedido: https://nube.vezzadev.com/pedido/abc123'));
  assert.match(sinNbsp(r.text), /Pedido #12 · Estado: En camino · Total: \$ 43\.000,00/);
  sinBasura(r, 'pedido_actualizado');
});

test('pedido_actualizado sin seguimiento no muestra el bloque, y sin contacto de la tienda responde a la plataforma', () => {
  const preparacion = correr(aviso('pedido_actualizado', avisoDePedido({ ...PEDIDO, estado: 'nuevo', despacho: { estado: 'preparacion', empresa: '', seguimiento: '', enlace: '', detalle: '' } }, TIENDA)));
  assert.equal(preparacion.valido, true);
  assert.ok(!preparacion.html.includes('Seguir mi envío') && !preparacion.html.includes('N.º de seguimiento'));
  sinBasura(preparacion, 'pedido en preparación');

  const sinContacto = correr(aviso('pedido_actualizado', avisoDePedido({ ...PEDIDO, despacho: { ...PEDIDO.despacho, enlace: 'javascript:alert(1)' } }, { ...TIENDA, emailTienda: '', whatsappTienda: '' })));
  assert.equal(sinContacto.responderA, 'info@vezzadev.com');
  assert.ok(!sinContacto.html.includes('javascript:'), 'un link que no es https no sale como botón');
  assert.ok(!sinContacto.html.includes('mailto:'));
});

test('pedido_actualizado rechaza lo incompleto, los links que no son https y los saltos de línea en el remitente', () => {
  assert.equal(correr(aviso('pedido_actualizado', avisoDePedido(PEDIDO, { ...TIENDA, urlPedido: 'http://inseguro.com/pedido/1' }))).valido, false);
  assert.equal(correr(aviso('pedido_actualizado', { email: 'a@b.com', titulo: '', tienda: { nombre: 'X' }, pedido: { url: 'https://x.com/p' } })).valido, false);
  assert.equal(correr(aviso('pedido_actualizado', { email: 'a@b.com', titulo: 'Hola', tienda: { nombre: '' }, pedido: { url: 'https://x.com/p' } })).valido, false);
  // Un nombre que es pura puntuación de remitente: cae a la marca de la plataforma.
  assert.equal(correr(aviso('pedido_actualizado', avisoDePedido(PEDIDO, { ...TIENDA, tienda: '<<>>' }))).desde, 'VEZZA Shop <info@vezzadev.com>');
  const inyeccion = correr(aviso('pedido_actualizado', avisoDePedido(PEDIDO, { ...TIENDA, tienda: 'Tienda\r\nBcc: robo@malo.com' })));
  assert.ok(!/[\r\n]/.test(inyeccion.desde), 'el remitente no puede llevar saltos de línea');
  assert.ok(!/[\r\n]/.test(inyeccion.asunto), 'ni el asunto');
});
