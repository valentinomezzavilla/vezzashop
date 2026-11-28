// Planes editables desde la plataforma: las funciones de diseño de cada plan (en vez de tres niveles fijos) y los textos de su tarjeta
// (la frase, la lista de lo que incluye y "Recomendado"). Lo que se edita se ve en la landing, en el panel de los clientes y en su tienda.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearPlan, crearSuperadmin, leerPlan, listarPlanes } from '../src/plataforma.js';
import { crearTienda } from '../src/tiendas.js';
import { actualizarAjustes } from '../src/diseno.js';
import { CLAVES_DE_FUNCIONES, funcionesDePreset } from '../src/diseno-por-plan.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';
import { crearN8nFalso } from './mercadopago-falso.js';

let n8n;
let db;
let servidor;
let puerto;
let admin;

before(async () => {
  n8n = crearN8nFalso();
  n8n.servidor.listen(0, '127.0.0.1');
  await once(n8n.servidor, 'listening');
  n8n.puerto = n8n.servidor.address().port;
});

async function cerrar() {
  servidor?.closeAllConnections();
  servidor?.close();
  servidor = null;
}

after(async () => {
  await cerrar();
  n8n.servidor.closeAllConnections();
  n8n.servidor.close();
});

beforeEach(async () => {
  await cerrar();
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
  const { clave } = await crearSuperadmin(db, { email: 'yo@vezza.dev' });
  admin = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await admin.enviar('/plataforma/ingresar', { email: 'yo@vezza.dev', clave })).status, 302);
});

const pagina = async (ruta) => (await admin.pedir(ruta)).text();
const landing = async () => (await pedirConHost(puerto, 'localhost', '/')).cuerpo;
const avisosDe = (evento) => n8n.recibidos.filter((r) => r.cuerpo.evento === evento).map((r) => r.cuerpo);
// Los campos de un plan como los manda el formulario; las funciones tildadas viajan como una casilla por cada una.
const campos = ({ funciones, ...resto }) => [
  ...Object.entries({ nombre: 'Plan', precio: '12.900', maxProductos: '150', maxFotos: '4', maxBanners: '2', diasPrueba: '', activo: '1', ...resto }),
  ['funcionesEnviadas', '1'],
  ...(funciones ?? []).map((funcion) => ['funciones', funcion]),
];
const crear = (datos) => admin.enviar('/plataforma/planes/nuevo', campos(datos), { desde: '/plataforma/planes/nuevo' });
const editar = (planId, datos) => admin.enviar(`/plataforma/planes/${planId}`, campos(datos), { desde: `/plataforma/planes/${planId}` });
const planPor = async (nombre) => (await listarPlanes(db)).find((p) => p.nombre === nombre);
const nuevoPlan = (datos) => crearPlan(db, { precioCentavos: 1_290_000, maxProductos: 150, maxFotos: 4, maxBanners: 2, activo: true, ...datos });

// ---------- El formulario ----------

test('el formulario de un plan trae una casilla por función, los tres puntos de partida y los textos de la tarjeta', async () => {
  const html = await pagina('/plataforma/planes/nuevo');
  const casillas = [...html.matchAll(/<input type="checkbox" name="funciones" value="([a-z_]+)"( checked)?>/g)];
  assert.deepEqual(casillas.map((m) => m[1]), CLAVES_DE_FUNCIONES, 'una casilla por cada función del catálogo, en su orden');
  assert.ok(casillas.every((m) => !m[2]), 'un plan nuevo arranca sin ninguna tildada');
  for (const texto of ['Colores de la tienda', 'Logo y cabecera', 'Portada personalizable', 'Tarjetas de producto', 'Pie de página', 'Tipografías a elección', 'Ancho de la página', 'CSS propio', 'Dominio propio', 'Códigos de seguimiento', 'Kit de marca y maqueta web']) {
    assert.ok(html.includes(`<strong>${texto}</strong>`), texto);
  }
  assert.ok(html.includes('name="funcionesEnviadas" value="1"'), 'avisa que las casillas viajaron (aunque no haya ninguna tildada)');
  // Los puntos de partida son botones (no envían nada) con las funciones que tildan.
  assert.ok(html.includes('data-funciones-preset=""'), 'Esencial: ninguna');
  assert.ok(html.includes(`data-funciones-preset="${funcionesDePreset('acompanado').join(',')}"`));
  assert.ok(html.includes(`data-funciones-preset="${CLAVES_DE_FUNCIONES.join(',')}"`));
  assert.equal([...html.matchAll(/<button class="boton boton-secundario boton-chico" type="button" data-funciones-preset/g)].length, 3);
  // Lo básico, que tienen todos los planes, se lista aparte.
  assert.ok(html.includes('Lo básico, que tienen todos los planes') && html.includes('Cabecera y menú de categorías'));
  // Los textos de la tarjeta.
  assert.match(html, /<input id="descripcion" type="text" name="descripcion" value="" maxlength="160"/);
  assert.match(html, /<textarea id="caracteristicas" name="caracteristicas"/);
  assert.match(html, /<input type="checkbox" name="destacado" value="1">/);
  assert.ok(!html.includes('name="nivelDiseno"'), 'el selector de tres niveles ya no está');

  // Un plan existente vuelve con sus funciones tildadas y sus textos.
  const id = await nuevoPlan({ nombre: 'Medio', funciones: ['colores', 'css'], descripcion: 'Mi frase', caracteristicas: ['Una', 'Dos'], destacado: true });
  const editando = await pagina(`/plataforma/planes/${id}`);
  const tildadas = [...editando.matchAll(/<input type="checkbox" name="funciones" value="([a-z_]+)" checked>/g)].map((m) => m[1]);
  assert.deepEqual(tildadas, ['colores', 'css']);
  assert.ok(editando.includes('value="Mi frase"'));
  assert.match(editando, /<textarea[^>]*>Una\nDos<\/textarea>/);
  assert.match(editando, /<input type="checkbox" name="destacado" value="1" checked>/);
  // Con el plan guardado, el formulario muestra cómo se arma la tarjeta si se dejan vacíos los textos.
  assert.ok(editando.includes('Vacía, se muestra la que ves en gris.') && editando.includes('hoy diría: Hasta 150 productos · 4 fotos por producto'));
});

// ---------- Guardar ----------

test('un plan se arma a gusto: funciones sueltas, frase y lista propias y "Recomendado"; la lista de planes y la landing lo reflejan', async () => {
  const respuesta = await crear({
    nombre: 'A mi manera', precio: '25.000', funciones: ['pie', 'colores', 'css'],
    descripcion: '  Para quien quiere su estilo  ', caracteristicas: '  Hasta 500 productos \r\n\r\nSoporte por WhatsApp\nTu CSS propio   ', destacado: '1',
  });
  assert.equal(respuesta.status, 302);
  const plan = await planPor('A mi manera');
  assert.deepEqual(plan.funciones, ['colores', 'pie', 'css'].sort((a, b) => CLAVES_DE_FUNCIONES.indexOf(a) - CLAVES_DE_FUNCIONES.indexOf(b)), 'en el orden del catálogo');
  assert.equal(plan.descripcion, 'Para quien quiere su estilo');
  assert.deepEqual(plan.caracteristicas, ['Hasta 500 productos', 'Soporte por WhatsApp', 'Tu CSS propio'], 'una por línea, sin vacías ni espacios de más');
  assert.equal(plan.destacado, true);

  // La lista de planes: "Personalizado" con lo que incluye, y "Recomendado" junto al nombre.
  const lista = await pagina('/plataforma/planes');
  assert.ok(lista.includes('Personalizado') && lista.includes('colores, pie y CSS propio'));
  assert.match(lista, /A mi manera<\/span>\s*<span class="pastilla pastilla-ok">Recomendado<\/span>/);

  // La landing usa su frase y su lista, no las automáticas, y lo marca como recomendado.
  const html = await landing();
  assert.ok(html.includes('Para quien quiere su estilo'));
  for (const linea of ['Hasta 500 productos', 'Soporte por WhatsApp', 'Tu CSS propio']) assert.ok(html.includes(`<li>${linea}</li>`) || html.includes(linea), linea);
  assert.ok(!html.includes('Todo lo del panel y la tienda'), 'la lista propia reemplaza a la automática');
  assert.ok(html.includes('<span class="plan__badge">Recomendado</span>'));

  // Se vuelve a dejar vacío: la tarjeta vuelve a armarse sola.
  await editar(plan.id, { nombre: 'A mi manera', precio: '25.000', funciones: ['colores'], descripcion: '', caracteristicas: '' });
  const vacia = await landing();
  assert.ok(!vacia.includes('Para quien quiere su estilo') && !vacia.includes('Soporte por WhatsApp'));
  assert.ok(vacia.includes('Más controles de diseño: colores') && vacia.includes('Todo lo del panel y la tienda'));
  assert.ok(!vacia.includes('<span class="plan__badge">'), 'sin marcar, nadie lleva "Recomendado"');
});

test('un plan sin ninguna función tildada es "solo lo básico"; los puntos de partida se reconocen en la lista', async () => {
  await crear({ nombre: 'Básico', funciones: [] });
  await crear({ nombre: 'Medio', funciones: funcionesDePreset('acompanado') });
  await crear({ nombre: 'Todo', funciones: CLAVES_DE_FUNCIONES });
  assert.deepEqual((await planPor('Básico')).funciones, []);
  const lista = await pagina('/plataforma/planes');
  const celda = (nombre) => lista.match(new RegExp(`${nombre}</span>[\\s\\S]*?data-etiqueta="Diseño">([^<]*)(?:<span[^>]*>([^<]*)</span>)?</td>`));
  assert.equal(celda('Básico')[1], 'Esencial');
  assert.equal(celda('Medio')[1], 'Acompañado');
  assert.equal(celda('Todo')[1], 'A medida');
});

test('"Recomendado" lo tiene un solo plan: al marcar uno se le saca al que lo tenía', async () => {
  await crear({ nombre: 'Uno', destacado: '1' });
  await crear({ nombre: 'Dos', destacado: '1' });
  assert.deepEqual((await listarPlanes(db)).filter((p) => p.destacado).map((p) => p.nombre), ['Dos']);
  const uno = await planPor('Uno');
  await editar(uno.id, { nombre: 'Uno', destacado: '1' });
  assert.deepEqual((await listarPlanes(db)).filter((p) => p.destacado).map((p) => p.nombre), ['Uno']);
  // Sin tildarlo, un plan que lo tenía lo pierde, y no se lo da a nadie más.
  await editar(uno.id, { nombre: 'Uno' });
  assert.deepEqual((await listarPlanes(db)).filter((p) => p.destacado), []);
});

test('lo que no es válido se avisa en el formulario y no se guarda nada', async () => {
  const mal = async (datos) => {
    const respuesta = await crear({ nombre: `Malo ${Math.random()}`, ...datos });
    assert.equal(respuesta.status, 400);
    return respuesta.text();
  };
  assert.match(await mal({ descripcion: 'x'.repeat(161) }), /Máximo 160 caracteres \(tiene 161\)/);
  assert.match(await mal({ caracteristicas: Array.from({ length: 13 }, (_, i) => `Línea ${i}`).join('\n') }), /Máximo 12 líneas \(tiene 13\)/);
  assert.match(await mal({ caracteristicas: `Corta\n${'y'.repeat(91)}` }), /Cada línea puede tener hasta 90 caracteres/);
  const funcionRara = await admin.enviar('/plataforma/planes/nuevo', [...campos({ nombre: 'Rara' }), ['funciones', 'supremo']], { desde: '/plataforma/planes/nuevo' });
  assert.equal(funcionRara.status, 400);
  assert.match(await funcionRara.text(), /Elegí funciones de la lista/);
  assert.equal(await planPor('Rara'), undefined);
  // Lo que se había escrito vuelve al formulario para corregirlo.
  const html = await mal({ nombre: 'Se conserva', funciones: ['colores'], descripcion: 'z'.repeat(170), caracteristicas: 'Esto\nse conserva' });
  assert.ok(html.includes('name="funciones" value="colores" checked') && html.includes('Esto\nse conserva'));
});

// ---------- Los clientes del plan ----------

// Una tienda con su navegador del panel, en el plan dado.
let contadorClientes = 0;
async function cliente(planId) {
  contadorClientes++;
  const slug = `cliente-editable-${contadorClientes}`;
  const email = `${slug}@correo.com`;
  const { tienda, clave } = await crearTienda(db, { nombre: `Casa ${contadorClientes}`, email, planId, slug, titular: { nombre: 'Ana', apellido: 'Prueba' } });
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email, clave })).status, 302);
  return { nav, tiendaId: tienda.id, slug, email };
}

test('cambiar las funciones de un plan con clientes pide confirmar, les avisa por mail y se aplica a sus tiendas', async () => {
  const planId = await nuevoPlan({ nombre: 'Esencial', funciones: [] });
  const c = await cliente(planId);
  await actualizarAjustes(db, c.tiendaId, { tarjetaEstilo: 'sombra', colorFondo: '#101418' });
  const vidriera = async () => (await pedirConHost(puerto, `${c.slug}.localhost`, '/')).cuerpo;
  assert.ok(!(await vidriera()).includes('data-tarjeta'), 'sin la función, lo guardado no se ve');

  // Pasa a incluir las tarjetas y los colores: antes de guardar, la pantalla de confirmación dice qué cambia y lleva las funciones escondidas.
  const lista = 'Línea "uno"\nLínea <dos> & más';
  const confirmacion = await editar(planId, { nombre: 'Esencial', funciones: ['colores', 'tarjetas'], caracteristicas: lista });
  assert.equal(confirmacion.status, 200);
  const html = await confirmacion.text();
  assert.ok(html.includes('Confirmá los cambios en "Esencial"'));
  assert.match(html, /<td data-etiqueta="Qué">Diseño de la tienda<\/td>\s*<td data-etiqueta="Antes">Esencial<\/td>\s*<td data-etiqueta="Después"><strong>colores y tarjetas<\/strong><\/td>\s*<td data-etiqueta="Para los clientes">Desde ya<\/td>/);
  assert.ok(html.includes('<input type="hidden" name="funciones" value="colores">') && html.includes('<input type="hidden" name="funciones" value="tarjetas">'));
  assert.ok(html.includes('<input type="hidden" name="funcionesEnviadas" value="1">'));
  assert.deepEqual((await leerPlan(db, planId)).funciones, [], 'todavía no se guardó nada');

  // Se confirma con lo que viajó escondido.
  // (como el navegador, que al mandar el formulario deshace el escape de HTML de los valores escondidos)
  const desescapar = (texto) => texto.replaceAll('&#34;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escondidos = [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], desescapar(m[2])]).filter(([nombre]) => nombre !== '_csrf');
  const aplicado = await admin.enviar(`/plataforma/planes/${planId}/confirmar`, [...escondidos, ['avisarPorMail', '1']], { desde: `/plataforma/planes/${planId}` });
  assert.equal(aplicado.status, 302);
  assert.deepEqual((await leerPlan(db, planId)).funciones, ['colores', 'tarjetas']);
  assert.deepEqual((await leerPlan(db, planId)).caracteristicas, ['Línea "uno"', 'Línea <dos> & más'], 'la lista de la tarjeta viaja escondida con sus renglones y símbolos');
  const conFunciones = await vidriera();
  assert.ok(conFunciones.includes('data-tarjeta="sombra"') && conFunciones.includes('--fondo: #101418'), 'la tienda ve lo que ya tenía elegido, ahora que el plan lo incluye');

  const [aviso, ...otros] = avisosDe('plan_modificado');
  assert.equal(otros.length, 0);
  assert.equal(aviso.email, c.email);
  assert.deepEqual(aviso.cambios.map((x) => [x.etiqueta, x.antes, x.despues, x.cuando]), [['Diseño de la tienda', 'Esencial', 'colores y tarjetas', 'desde ya']]);

  // Cambiar solo la frase o la lista de la tarjeta no le cambia nada a los clientes: se guarda sin confirmar y sin mails.
  const solo = await editar(planId, { nombre: 'Esencial', funciones: ['colores', 'tarjetas'], descripcion: 'Una frase nueva', destacado: '1' });
  assert.equal(solo.status, 302);
  assert.equal((await leerPlan(db, planId)).descripcion, 'Una frase nueva');
  assert.equal(avisosDe('plan_modificado').length, 1, 'no hubo otro aviso');
});

test('un cliente sin la función ve la pantalla de Diseño bloqueada y al plan que la incluye; al pasar a ese plan, se abre', async () => {
  const chico = await nuevoPlan({ nombre: 'Chico', precioCentavos: 1_000_000, funciones: [] });
  const grande = await nuevoPlan({ nombre: 'Grande', precioCentavos: 5_000_000, funciones: ['css', 'dominio', 'kit_de_marca'] });
  const c = await cliente(chico);
  let html = await (await c.nav.pedir('/admin/diseno')).text();
  assert.ok(html.includes('no incluye <strong>CSS propio</strong>. Lo incluye el plan Grande.'));
  // El kit de marca y el dominio propio también dependen de su función.
  assert.ok((await (await c.nav.pedir('/admin/marca')).text()).includes('no incluye <strong>Kit de marca y maqueta web</strong>. Lo incluye el plan Grande.'));
  assert.ok((await (await c.nav.pedir('/admin/cuenta')).text()).includes('no incluye <strong>Dominio propio</strong>. Lo incluye el plan Grande.'));
  // En la tabla de "¿Qué incluye cada plan?" salen los dos planes, y el suyo marcado.
  assert.ok(html.includes('Tu plan: Chico') && html.includes('<th scope="col" class="nivel-actual">Chico'));
  assert.ok(html.includes('<th scope="col" class="">Grande'));

  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(grande, c.tiendaId);
  html = await (await c.nav.pedir('/admin/diseno')).text();
  assert.ok(!html.includes('no incluye <strong>CSS propio</strong>'));
  assert.ok(html.includes('id="funcion-css"') && !html.includes('funcion-bloque funcion-bloqueada" id="funcion-css"'));
  assert.ok(html.includes('no incluye <strong>Colores de la tienda</strong>'), 'lo que ese plan no trae sigue bloqueado');
  assert.ok(!(await (await c.nav.pedir('/admin/cuenta')).text()).includes('no incluye <strong>Dominio propio</strong>'));
});
