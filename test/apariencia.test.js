import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

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

const css = (nombre) => readFileSync(new URL(`../src/publico/${nombre}`, import.meta.url), 'utf8');

test('el panel ofrece Automático, Claro y Oscuro, también en la pantalla de ingreso, y recuerda la elección antes de pintar', async () => {
  const ingreso = (await pedirConHost(puerto, 'localhost', '/admin/ingresar')).cuerpo;
  for (const opcion of ['auto', 'claro', 'oscuro']) assert.match(ingreso, new RegExp(`data-tema-elegir="${opcion}"`));
  assert.match(ingreso, /class="tema tema-flotante"/, 'en el ingreso el selector flota arriba');
  // El script del <head> va antes de la hoja de estilos: así no hay parpadeo entre claro y oscuro al cambiar de página.
  assert.ok(ingreso.indexOf('localStorage.getItem("tema")') > 0);
  assert.ok(ingreso.indexOf('localStorage.getItem("tema")') < ingreso.indexOf('/admin.css'));

  const { clave } = await crearTienda(db, { nombre: 'Apariencia', email: 'apariencia@ejemplo.com' });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  await nav.enviar('/admin/ingresar', { email: 'apariencia@ejemplo.com', clave });
  const inicio = await (await nav.pedir('/admin/inicio')).text();
  assert.equal([...inicio.matchAll(/data-tema-elegir="/g)].length, 3);
  assert.match(inicio, /<div class="lateral-pie">\s*<div class="tema" role="group" aria-label="Apariencia">/);
});

test('el CSS del panel: los dos temas oscuros iguales, Claro forzable, y las listas de los desplegables con color propio', () => {
  const panel = css('admin.css');
  const oscuroSistema = panel.match(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-tema="claro"\]\) \{([\s\S]*?)\n  \}\n\}/)?.[1];
  const oscuroElegido = panel.match(/:root\[data-tema="oscuro"\] \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(oscuroSistema && oscuroElegido, 'están los dos bloques');
  const variables = (texto) => [...texto.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => `${m[1]}:${m[2].trim()}`).sort();
  assert.deepEqual(variables(oscuroElegido), variables(oscuroSistema), 'Oscuro elegido y oscuro del sistema valen lo mismo');
  assert.match(panel, /:root\[data-tema="claro"\] \{ color-scheme: light; \}/);
  // Sin esto, en tema oscuro la lista nativa quedaba con texto claro sobre fondo claro.
  assert.match(panel, /select option, select optgroup \{ background-color: var\(--campo-solido\); color: var\(--texto\); \}/);
  assert.match(panel, /--campo-solido: #2c2c2e/);
});

test('la vidriera usa la tipografía del sistema con Inter de respaldo, queda siempre clara y respeta "reducir movimiento"', async () => {
  const tienda = await db.prepare("INSERT INTO tiendas (nombre, slug) VALUES ('Estilo', 'estilo') RETURNING id").run();
  assert.ok(tienda.rows[0].id);
  const portada = (await pedirConHost(puerto, 'estilo.localhost', '/')).cuerpo;
  assert.match(portada, /family=Inter:wght@400;500;600;700/);
  assert.doesNotMatch(portada, /Nunito|Rubik/);

  const vidriera = css('tienda.css');
  assert.match(vidriera, /--fuente-texto: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter/);
  assert.match(vidriera, /color-scheme: light;/);
  assert.match(vidriera, /@media \(prefers-reduced-motion: reduce\) \{[^}]*animation-duration: 0s !important/);
  // Todas las animaciones con el scroll van dentro de "sin preferencia de movimiento reducido".
  for (const [, bloque] of vidriera.matchAll(/@supports \(animation-timeline: (?:view|scroll)\(\)\) \{([\s\S]*?)\n\}\n/g)) {
    assert.match(bloque, /prefers-reduced-motion: no-preference/);
  }
});
