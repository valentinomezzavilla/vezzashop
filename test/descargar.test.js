// Descarga de fotos por link: solo imágenes, con límites, y nunca hacia direcciones internas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { crearDescargador, linkDeDescarga, esDireccionPublica } from '../src/importacion/descargar.js';
import { PNG } from './ayudantes.js';

let servidor;
let puerto;

before(async () => {
  servidor = http.createServer((req, res) => {
    const vueltas = /^\/vueltas\/(\d+)$/.exec(req.url);
    if (req.url === '/foto.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG);
    if (req.url === '/pagina') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><p>Iniciá sesión</p>');
    if (req.url === '/grande') return res.writeHead(200, { 'content-length': 6 * 1024 * 1024 }).end(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024 - PNG.length)]));
    if (req.url === '/grande-sin-largo') {
      res.writeHead(200);
      for (let i = 0; i < 6; i++) res.write(Buffer.alloc(1024 * 1024));
      return res.end();
    }
    if (req.url === '/lenta') return; // no responde nunca
    if (vueltas) return res.writeHead(302, { location: `/vueltas/${Number(vueltas[1]) + 1}` }).end();
    if (req.url === '/redirige-a-foto') return res.writeHead(301, { location: '/foto.png' }).end();
    if (req.url === '/a-privada') return res.writeHead(302, { location: 'http://10.255.255.1/x' }).end();
    res.writeHead(404).end();
  });
  servidor.listen(0, '127.0.0.1');
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const local = (ruta) => `http://127.0.0.1:${puerto}${ruta}`;
const abierto = () => crearDescargador({ permitirDireccion: () => true, tiempoMaximoMs: 500 });

test('linkDeDescarga convierte links compartidos de Drive y Dropbox', () => {
  assert.equal(linkDeDescarga('https://drive.google.com/file/d/ABC123/view?usp=sharing'), 'https://drive.google.com/uc?export=download&id=ABC123');
  assert.equal(linkDeDescarga('https://drive.google.com/open?id=ABC123'), 'https://drive.google.com/uc?export=download&id=ABC123');
  assert.equal(linkDeDescarga('https://www.dropbox.com/s/x/foto.jpg?dl=0'), 'https://www.dropbox.com/s/x/foto.jpg?dl=1');
  assert.equal(linkDeDescarga('https://www.dropbox.com/scl/fi/x/foto.jpg?rlkey=abc'), 'https://www.dropbox.com/scl/fi/x/foto.jpg?rlkey=abc&dl=1');
  assert.equal(linkDeDescarga('https://ejemplo.com/a.jpg'), 'https://ejemplo.com/a.jpg');
  assert.equal(linkDeDescarga('esto no es un link'), 'esto no es un link');
});

test('esDireccionPublica', () => {
  for (const ip of ['8.8.8.8', '200.45.1.1', '2001:4860:4860::8888']) assert.equal(esDireccionPublica(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(esDireccionPublica(ip), false, ip);
  }
});

test('por defecto no descarga de direcciones internas, ni por IP ni por nombre', async () => {
  const descargar = crearDescargador();
  const bloqueado = { message: 'el link apunta a una dirección que no está permitida' };
  await assert.rejects(descargar(local('/foto.png')), bloqueado);
  await assert.rejects(descargar(`http://localhost:${puerto}/foto.png`), bloqueado);
  await assert.rejects(descargar(`http://[::1]:${puerto}/foto.png`), bloqueado);
});

test('revisa también el destino de cada redirección', async () => {
  const descargar = crearDescargador({ permitirDireccion: (ip) => ip === '127.0.0.1' });
  await assert.rejects(descargar(local('/a-privada')), { message: 'el link apunta a una dirección que no está permitida' });
});

test('descarga una foto, también después de una redirección', async () => {
  assert.deepEqual(await abierto()(local('/foto.png')), PNG);
  assert.deepEqual(await abierto()(local('/redirige-a-foto')), PNG);
});

test('explica cada falla', async () => {
  const casos = {
    'ftp://ejemplo.com/a.png': 'el link no es válido: tiene que empezar con http:// o https://',
    'no es un link': 'el link no es válido: tiene que empezar con http:// o https://',
    [local('/no-existe')]: 'el link respondió con un error (404)',
    [local('/pagina')]: 'el link no lleva a una foto JPG, PNG o WEBP',
    [local('/grande')]: 'la foto del link pesa más de 5 MB',
    [local('/grande-sin-largo')]: 'la foto del link pesa más de 5 MB',
    [local('/lenta')]: 'el link tardó demasiado en responder',
    [local('/vueltas/0')]: 'el link redirige demasiadas veces',
    'http://127.0.0.1:1/foto.png': 'no pudimos descargar la foto del link',
  };
  for (const [link, mensaje] of Object.entries(casos)) await assert.rejects(abierto()(link), { message: mensaje }, link);
});

test('se corta si se aborta desde afuera', async () => {
  const control = new AbortController();
  setTimeout(() => control.abort(), 50);
  const descargar = crearDescargador({ permitirDireccion: () => true, tiempoMaximoMs: 5000 });
  const inicio = Date.now();
  await assert.rejects(descargar(local('/lenta'), { senal: control.signal }), { message: 'el link tardó demasiado en responder' });
  assert.ok(Date.now() - inicio < 1000, 'tiene que cortar enseguida, no esperar su propio tiempo máximo');
});
