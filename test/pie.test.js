import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { actualizarAjustes } from '../src/diseno.js';
import { pedirConHost } from './ayudantes.js';

let servidor;
let puerto;
let db;
let dirSubidas;

before(async () => {
  dirSubidas = mkdtempSync(path.join(tmpdir(), 'subidas-'));
  db = await abrirBase(':memory:');
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirSubidas };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

after(() => {
  servidor.close();
  rmSync(dirSubidas, { recursive: true, force: true });
});

const pie = async (slug) => {
  const { cuerpo } = await pedirConHost(puerto, `${slug}.localhost`, '/');
  return cuerpo.slice(cuerpo.indexOf('<footer class="pie">'), cuerpo.indexOf('</footer>'));
};

test('el pie junta categorías y contacto en botones en fila, con las redes y la dirección en el bloque de la marca', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'Pie Completo', email: 'piecompleto@ejemplo.com' });
  const { productos } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock', 'Categorías'],
    ['R-1', 'Remera', 10000, 5, 'Ropa'],
    ['P-1', 'Pelota', 20000, 5, 'Deportes'],
  ]);
  await aplicarImportacion(db, tienda.id, productos);
  await actualizarAjustes(db, tienda.id, { whatsapp: '5493511234567', emailContacto: 'hola@ejemplo.com', instagram: 'https://instagram.com/pie', direccion: 'Colón 123' });

  const html = await pie(tienda.slug);
  const marca = html.match(/<div class="pie-marca">([\s\S]*?)\n    <\/div>/)?.[1] ?? '';
  assert.match(marca, /class="red" href="https:\/\/instagram\.com\/pie"/);
  assert.match(marca, /<p class="pie-dato">[\s\S]*Colón 123/);

  const categorias = html.match(/<nav class="pie-bloque pie-categorias"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.match(categorias, /<div class="pie-enlaces">/);
  assert.equal([...categorias.matchAll(/<a href="[^"]+">(Ropa|Deportes)<\/a>/g)].length, 2, 'cada categoría es un enlace dentro de la fila');

  const contacto = html.slice(html.indexOf('pie-bloque pie-contacto'), html.indexOf('<p class="pie-copyright">'));
  assert.ok(contacto, 'hay bloque de contacto');
  assert.match(contacto, /href="https:\/\/wa\.me\/5493511234567"[^>]*>[\s\S]*<span>WhatsApp<\/span>/);
  assert.match(contacto, /href="mailto:hola@ejemplo\.com"[^>]*>[\s\S]*<span>hola@ejemplo\.com<\/span>/);

  // Ya no hay columnas de una sola fila de enlaces: el alto del pie depende de cuántas categorías caben por renglón.
  assert.ok(!html.includes('pie-columna'));
  assert.match(html, /<p class="pie-copyright">/);
});

test('el pie sigue bien armado cuando la tienda no tiene categorías, contacto, redes ni dirección', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'Pie Vacío', email: 'pievacio@ejemplo.com' });
  const html = await pie(tienda.slug);
  assert.match(html, /<div class="pie-marca">\s*<a class="marca" href="\/">Pie Vacío<\/a>\s*<\/div>/);
  for (const ausente of ['pie-categorias', 'pie-contacto', 'class="redes"', 'pie-dato']) assert.ok(!html.includes(ausente), `sin ${ausente}`);
  assert.match(html, /© \d{4} Pie Vacío\. Todos los derechos reservados\./);
});

test('el CSS del pie: los bloques se pueden encoger (un email largo no ensancha la página) y los botones se tocan bien', () => {
  const css = readFileSync(new URL('../src/publico/tienda.css', import.meta.url), 'utf8');
  for (const bloque of ['pie-marca', 'pie-categorias', 'pie-contacto']) {
    assert.match(css, new RegExp(`\\.${bloque} \\{[^}]*min-width: 0;`), `${bloque} con min-width: 0`);
  }
  assert.match(css, /\.pie-enlaces a \{[^}]*min-height: 32px;/);
  assert.match(css, /\.pie-enlaces a span \{[^}]*text-overflow: ellipsis;/);
});
