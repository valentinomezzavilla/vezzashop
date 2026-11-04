import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { validarAjustes, validarEnlace, colorDeTextoSobre, precioConDescuento, valorCuota } from '../src/diseno.js';
import { tipoDeImagen } from '../src/imagenes.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

// PNG real de 1x1.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let servidor;
let puerto;
let db;
let dirSubidas;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirSubidas,
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

const vidriera = (slug, ruta = '/') => pedirConHost(puerto, `${slug}.localhost`, ruta);

// Crea una tienda con un par de productos y devuelve el navegador ya logueado en su panel.
async function tiendaConPanel(slug) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock', 'Atributo 1', 'Valor 1'],
    ['B-1', 'Buzo', 30000, 3, 'Talle', 'M'],
    ['A-1', 'Ambo', 12000, 5, null, null],
  ]);
  aplicarImportacion(db, tienda.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: tienda.id };
}

const AJUSTES = {
  colorPrincipal: '#0a3d62',
  franjaTexto: 'Envío gratis desde $100.000',
  ordenCatalogo: 'precio-mayor',
  whatsapp: '+54 9 351 123-4567',
  instagram: '@mitienda',
  facebook: '',
  tiktok: '',
  emailContacto: 'hola@mitienda.com',
  direccion: 'Av. Siempre Viva 742',
};

test('validarAjustes normaliza WhatsApp y redes, y rechaza valores inválidos', () => {
  const { ajustes, errores } = validarAjustes(AJUSTES);
  assert.deepEqual(errores, {});
  assert.equal(ajustes.whatsapp, '5493511234567');
  assert.equal(ajustes.instagram, 'https://www.instagram.com/mitienda');
  assert.equal('descuentoTransferencia' in ajustes, false, 'los descuentos ahora son de Envíos y pagos');

  const malos = validarAjustes({
    ...AJUSTES,
    colorPrincipal: 'rojo',
    ordenCatalogo: 'constructor',
    whatsapp: '123',
    tiktok: 'no vale con espacios',
  }).errores;
  assert.deepEqual(Object.keys(malos).sort(), ['colorPrincipal', 'ordenCatalogo', 'tiktok', 'whatsapp']);
});

test('validarEnlace acepta páginas de la tienda y links https, y rechaza el resto', () => {
  assert.equal(validarEnlace('/categoria/ofertas').valor, '/categoria/ofertas');
  assert.equal(validarEnlace('https://ejemplo.com/x').valor, 'https://ejemplo.com/x');
  assert.equal(validarEnlace('').valor, '');
  assert.ok(validarEnlace('javascript:alert(1)').error);
  assert.ok(validarEnlace('//otro-sitio.com').error);
});

test('cuentas de precios y colores', () => {
  assert.equal(precioConDescuento(2000000, 15), 1700000);
  assert.equal(valorCuota(2000000, 6), 333333);
  assert.equal(colorDeTextoSobre('#ffffff'), '#111111');
  assert.equal(colorDeTextoSobre('#0a3d62'), '#ffffff');
});

test('tipoDeImagen reconoce por contenido y no acepta otras cosas', () => {
  assert.equal(tipoDeImagen(PNG), 'png');
  assert.equal(tipoDeImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(tipoDeImagen(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('una tienda sin ajustes se ve con los valores por defecto', async () => {
  await tiendaConPanel('pordefecto');
  const { status, cuerpo } = await vidriera('pordefecto');
  assert.equal(status, 200);
  assert.doesNotMatch(cuerpo, /class="franja"/);
  assert.doesNotMatch(cuerpo, /con transferencia/);
  assert.doesNotMatch(cuerpo, /boton-whatsapp/);
  assert.ok(cuerpo.indexOf('Ambo') < cuerpo.indexOf('Buzo'), 'por defecto ordena por nombre');
});

test('lo que se guarda en Diseño se ve en la vidriera', async () => {
  const { nav } = await tiendaConPanel('disenada');
  const respuesta = await nav.enviarArchivos('/admin/diseno', { ...AJUSTES, logo: { contenido: PNG, nombre: 'logo.png' } });
  assert.equal(respuesta.status, 302);
  assert.match(await (await nav.pedir('/admin/diseno')).text(), /guardamos los cambios/);
  // El descuento por transferencia y las cuotas se configuran en Envíos y pagos.
  const pagos = await nav.enviar('/admin/pagos', {
    pagoTransferencia: '1', transferenciaAlias: 'mi.tienda.mp', descuentoTransferencia: '15',
    pagoMercadopago: '1', cuotasSinInteres: '6', descuentoEfectivo: '0',
  });
  assert.equal(pagos.status, 302);

  const { cuerpo } = await vidriera('disenada');
  assert.match(cuerpo, /--acento: #0a3d62; --acento-texto: #ffffff;/);
  assert.match(cuerpo, /<div class="franja"><p>Envío gratis desde \$100\.000<\/p><\/div>/);
  assert.match(cuerpo, /\$\s25\.500,00 con transferencia/, '15% off de $30.000');
  assert.match(cuerpo, /href="https:\/\/wa\.me\/5493511234567"/);
  assert.match(cuerpo, /href="https:\/\/www\.instagram\.com\/mitienda"/);
  assert.match(cuerpo, /Av\. Siempre Viva 742/);
  assert.ok(cuerpo.indexOf('Buzo') < cuerpo.indexOf('Ambo'), 'ordena por precio de mayor a menor');

  const logo = cuerpo.match(/<img class="logo" src="([^"]+)"/)[1];
  const archivo = await vidriera('disenada', logo);
  assert.equal(archivo.status, 200);

  const ficha = await vidriera('disenada', '/producto/buzo');
  assert.match(ficha.cuerpo, /6 cuotas sin interés<\/strong> de <span data-cuota>\$\s5\.000,00/);
  const consulta = ficha.cuerpo.match(/href="(https:\/\/wa\.me\/5493511234567\?text=[^"]+)"[^>]*data-whatsapp/);
  assert.ok(consulta, 'la ficha tiene el botón para consultar por WhatsApp');
  assert.equal(
    decodeURIComponent(new URL(consulta[1]).searchParams.get('text')),
    '¡Hola! Quiero consultar por Buzo (Talle M). SKU B-1',
  );

  const ordenDelVisitante = await vidriera('disenada', '/?orden=nombre');
  assert.ok(ordenDelVisitante.cuerpo.indexOf('Ambo') < ordenDelVisitante.cuerpo.indexOf('Buzo'));
});

test('con campos inválidos no guarda nada y marca qué revisar', async () => {
  const { nav } = await tiendaConPanel('invalida');
  const respuesta = await nav.enviarArchivos('/admin/diseno', { ...AJUSTES, whatsapp: '12' });
  assert.equal(respuesta.status, 400);
  const html = await respuesta.text();
  assert.match(html, /Hay campos para revisar/);
  assert.match(html, /código de país/);
  assert.match(html, /value="Envío gratis desde \$100\.000"/, 'conserva lo que se escribió');
  assert.doesNotMatch((await vidriera('invalida')).cuerpo, /class="franja"/);
});

test('un logo que no es imagen se rechaza', async () => {
  const { nav } = await tiendaConPanel('logomalo');
  const respuesta = await nav.enviarArchivos('/admin/diseno', {
    ...AJUSTES,
    logo: { contenido: Buffer.from('<svg onload="alert(1)"></svg>'), nombre: 'logo.svg' },
  });
  assert.equal(respuesta.status, 400);
  assert.match(await respuesta.text(), /JPG, PNG o WEBP/);
});

test('banners: agregar, ordenar, mostrar en la portada y borrar con su archivo', async () => {
  const { nav, tiendaId } = await tiendaConPanel('conbanners');
  const agregar = (texto, enlace) =>
    nav.enviarArchivos('/admin/diseno/banners', { imagen: { contenido: PNG, nombre: 'b.png' }, enlace, textoAlternativo: texto }, {
      desde: '/admin/diseno',
    });

  assert.equal((await agregar('Primero', '/categoria/ofertas')).status, 302);
  assert.equal((await agregar('Segundo', '')).status, 302);

  let portada = (await vidriera('conbanners')).cuerpo;
  assert.ok(portada.indexOf('alt="Primero"') < portada.indexOf('alt="Segundo"'));
  assert.match(portada, /<a href="\/categoria\/ofertas">/);

  const html = await (await nav.pedir('/admin/diseno')).text();
  const [idPrimero, idSegundo] = [...html.matchAll(/\/admin\/diseno\/banners\/(\d+)\/borrar/g)].map((m) => m[1]);
  await nav.enviar(`/admin/diseno/banners/${idSegundo}/subir`, {}, { desde: '/admin/diseno' });
  portada = (await vidriera('conbanners')).cuerpo;
  assert.ok(portada.indexOf('alt="Segundo"') < portada.indexOf('alt="Primero"'));

  assert.equal(readdirSync(path.join(dirSubidas, String(tiendaId))).length, 2);
  await nav.enviar(`/admin/diseno/banners/${idPrimero}/borrar`, {}, { desde: '/admin/diseno' });
  portada = (await vidriera('conbanners')).cuerpo;
  assert.doesNotMatch(portada, /alt="Primero"/);
  assert.equal(readdirSync(path.join(dirSubidas, String(tiendaId))).length, 1, 'se borra el archivo del banner');
});

test('un banner con un link peligroso no se guarda', async () => {
  const { nav, tiendaId } = await tiendaConPanel('linkmalo');
  const respuesta = await nav.enviarArchivos(
    '/admin/diseno/banners',
    { imagen: { contenido: PNG, nombre: 'b.png' }, enlace: 'javascript:alert(1)' },
    { desde: '/admin/diseno' },
  );
  assert.equal(respuesta.status, 302);
  assert.match(await (await nav.pedir('/admin/diseno')).text(), /Link del banner/);
  assert.equal(existsSync(path.join(dirSubidas, String(tiendaId))), false, 'no queda ninguna imagen guardada');
});

test('una tienda no puede borrar ni mover banners de otra', async () => {
  const duenia = await tiendaConPanel('duenia');
  await duenia.nav.enviarArchivos('/admin/diseno/banners', { imagen: { contenido: PNG, nombre: 'b.png' } }, {
    desde: '/admin/diseno',
  });
  const html = await (await duenia.nav.pedir('/admin/diseno')).text();
  const id = html.match(/\/admin\/diseno\/banners\/(\d+)\/borrar/)[1];

  const intrusa = await tiendaConPanel('intrusa');
  await intrusa.nav.enviar(`/admin/diseno/banners/${id}/borrar`, {}, { desde: '/admin/diseno' });
  assert.match((await vidriera('duenia')).cuerpo, /carrusel-diapositiva/, 'el banner sigue estando');
});
