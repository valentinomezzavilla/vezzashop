// Diseño por plan: qué puede personalizar cada tienda de su vidriera según las funciones de diseño que incluye su plan. Cada plan tilda las suyas
// (colores, portada, tarjetas, CSS propio, dominio...); esencial, acompañado y a medida son solo puntos de partida.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { leerAjustes, estiloDeTienda } from '../src/diseno.js';
import { cargarPlanesSugeridos, crearPlan, editarPlan, leerPlan, validarPlan } from '../src/plataforma.js';
import { compararPlan } from '../src/cambios-de-plan.js';
import {
  AJUSTES_AVANZADOS_POR_DEFECTO,
  CLAVES_DE_FUNCIONES,
  COLUMNAS_AVANZADAS,
  FUNCIONES,
  FUNCION_DE_AJUSTE,
  PRESETS,
  aplicarFunciones,
  contraste,
  datosDeDiseno,
  estiloAvanzado,
  funcionesDePreset,
  funcionesDeTexto,
  nombreDeDiseno,
  normalizarFunciones,
  presetDeFunciones,
  resumenDeFunciones,
  seccionesDePortada,
  textoDeFunciones,
  textoLegibleSobre,
  validarAvanzados,
  validarCssPropio,
  validarFuenteGoogle,
} from '../src/diseno-por-plan.js';
import { crearNavegador, pedirConHost } from './ayudantes.js';

const ESENCIAL = funcionesDePreset('esencial');
const ACOMPANADO = funcionesDePreset('acompanado');
const A_MEDIDA = funcionesDePreset('a_medida');

// ---------- Funciones de diseño ----------

test('el catálogo: cada ajuste de la vidriera pertenece a una sola función, y los puntos de partida son los tres niveles de siempre', () => {
  assert.deepEqual(Object.keys(FUNCION_DE_AJUSTE).sort(), Object.keys(COLUMNAS_AVANZADAS).sort(), 'ningún ajuste queda sin función ni sobra uno');
  for (const funcion of Object.values(FUNCION_DE_AJUSTE)) assert.ok(CLAVES_DE_FUNCIONES.includes(funcion), funcion);
  assert.deepEqual(CLAVES_DE_FUNCIONES, ['colores', 'logo_cabecera', 'portada', 'tarjetas', 'pie', 'fuentes', 'ancho', 'css', 'dominio', 'codigos', 'kit_de_marca']);
  for (const [clave, funcion] of Object.entries(FUNCIONES)) assert.ok(funcion.titulo && funcion.corto && funcion.ayuda, clave);
  assert.deepEqual(ESENCIAL, []);
  assert.deepEqual(ACOMPANADO, ['colores', 'logo_cabecera', 'portada', 'tarjetas', 'pie', 'kit_de_marca']);
  assert.deepEqual(A_MEDIDA, CLAVES_DE_FUNCIONES, 'a medida lleva todas');
  assert.notEqual(funcionesDePreset('esencial'), funcionesDePreset('esencial'), 'cada pedido devuelve una copia');
  assert.deepEqual(funcionesDePreset('inventado'), []);
});

test('funcionesDeTexto y normalizarFunciones: solo las que existen, sin repetidas y en el orden del catálogo', () => {
  assert.deepEqual(funcionesDeTexto('pie,colores, css ,pie,hackeo,'), ['colores', 'pie', 'css']);
  assert.deepEqual(funcionesDeTexto(''), []);
  assert.deepEqual(funcionesDeTexto(null), []);
  assert.deepEqual(normalizarFunciones(['css', 'colores', 'colores', 'otra']), ['colores', 'css']);
  assert.equal(textoDeFunciones(['css', 'colores']), 'colores,css');
  assert.equal(textoDeFunciones(undefined), '');
  assert.equal(presetDeFunciones(ACOMPANADO), 'acompanado');
  assert.equal(presetDeFunciones([...ACOMPANADO].reverse()), 'acompanado', 'el orden no importa');
  assert.equal(presetDeFunciones(['colores']), null, 'armado a gusto');
  assert.equal(presetDeFunciones([]), 'esencial');
});

test('los nombres del diseño de un plan: el del punto de partida si coincide, y si no lo que incluye', () => {
  assert.equal(nombreDeDiseno(ESENCIAL), 'Esencial');
  assert.equal(nombreDeDiseno(ACOMPANADO), 'Acompañado');
  assert.equal(nombreDeDiseno(A_MEDIDA), 'A medida');
  assert.equal(nombreDeDiseno(['colores', 'pie']), 'colores y pie');
  assert.equal(resumenDeFunciones([]), 'Lo básico');
  assert.equal(resumenDeFunciones(A_MEDIDA), 'Todo');
  assert.equal(resumenDeFunciones(['css', 'colores', 'dominio']), 'colores, CSS propio y dominio propio');
  assert.equal(PRESETS.acompanado.titulo, 'Acompañado');
});

test('aplicarFunciones: lo que el plan no incluye vuelve al valor de siempre, sin tocar el resto ni el original', () => {
  const guardados = {
    colorPrincipal: '#336699', fuente: 'moderna',
    ...AJUSTES_AVANZADOS_POR_DEFECTO,
    colorFondo: '#101418', tarjetaEstilo: 'sombra', logoPosicion: 'centro', portadaSecciones: 'ofertas,banners',
    cssPropio: 'a { color: red }', fuenteTitulos: 'Lora', anchoPagina: 'ancho',
  };
  const esencial = aplicarFunciones(guardados, ESENCIAL);
  assert.deepEqual({ ...esencial }, { colorPrincipal: '#336699', fuente: 'moderna', ...AJUSTES_AVANZADOS_POR_DEFECTO }, 'sin funciones todo lo avanzado vuelve al de siempre');
  const acompanado = aplicarFunciones(guardados, ACOMPANADO);
  assert.equal(acompanado.colorFondo, '#101418');
  assert.equal(acompanado.tarjetaEstilo, 'sombra');
  assert.equal(acompanado.portadaSecciones, 'ofertas,banners');
  assert.equal(acompanado.cssPropio, '', 'el CSS propio es de otra función');
  assert.equal(acompanado.fuenteTitulos, '');
  assert.equal(acompanado.anchoPagina, 'normal');
  assert.deepEqual(aplicarFunciones(guardados, A_MEDIDA), guardados);
  assert.equal(guardados.colorFondo, '#101418', 'no modifica lo guardado');
  // Cada función es independiente de las demás: un plan puede tener el CSS propio sin los colores, o los colores sin la portada.
  const suelto = aplicarFunciones(guardados, ['css', 'tarjetas']);
  assert.equal(suelto.cssPropio, 'a { color: red }');
  assert.equal(suelto.tarjetaEstilo, 'sombra');
  assert.equal(suelto.colorFondo, '', 'sin la función de colores');
  assert.equal(suelto.logoPosicion, 'izquierda', 'sin la de logo y cabecera');
  assert.equal(suelto.fuenteTitulos, '', 'sin la de tipografías');
});

// ---------- Contraste ----------

test('contraste y texto legible: el negro sobre el blanco es 21 a 1, y el texto elegido siempre cumple 4,5 a 1', () => {
  assert.equal(Math.round(contraste('#000000', '#ffffff')), 21);
  assert.equal(contraste('#336699', '#336699'), 1);
  assert.equal(textoLegibleSobre('#ffffff'), '#111111');
  assert.equal(textoLegibleSobre('#101418'), '#ffffff');
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
        assert.ok(contraste(hex, textoLegibleSobre(hex)) >= 4.5, `${hex} -> ${textoLegibleSobre(hex)}`);
      }
    }
  }
});

// ---------- Validación de lo que depende del plan ----------

test('validarAvanzados: sin funciones se ignora todo lo que llegue, aunque venga armado a mano', () => {
  const { ajustes, errores } = validarAvanzados(
    { colorFondoPropio: '1', colorFondo: '#101418', tarjetaEstilo: 'sombra', cssPropio: 'a{}', anchoPagina: 'completo', fuenteTitulos: 'Lora', portadaEnviada: '1' },
    ESENCIAL,
  );
  assert.deepEqual(ajustes, {});
  assert.deepEqual(errores, {});
});

test('validarAvanzados (funciones del Acompañado): colores con su casilla, opciones de la lista, portada ordenada; lo de las otras funciones se ignora', () => {
  const { ajustes, errores } = validarAvanzados(
    {
      colorFondoPropio: '1', colorFondo: '#FAF5EE', colorTextoPropio: '1', colorTexto: '#1f1a14',
      colorTarjetas: '#ffffff', // sin su casilla: vuelve al de siempre
      colorCabecera: '#101418', colorCabeceraPropio: '1',
      logoPosicion: 'centro', pieEstilo: 'oscuro', tarjetaEstilo: 'borde', tarjetaFoto: 'cuadrada', tarjetaTexto: 'centro', bannersAncho: 'completo',
      cabeceraFija: '0',
      portadaEnviada: '1', portadaMostrar_ofertas: '1', portadaMostrar_banners: '1', portadaOrden_ofertas: '1', portadaOrden_banners: '2', portadaOrden_destacados: '3',
      cssPropio: 'a { color: red }', fuenteTitulos: 'Lora', anchoPagina: 'completo',
    },
    ACOMPANADO,
  );
  assert.deepEqual(errores, {});
  assert.deepEqual(ajustes, {
    colorFondo: '#faf5ee', colorTexto: '#1f1a14', colorTarjetas: '', colorCabecera: '#101418',
    logoPosicion: 'centro', pieEstilo: 'oscuro', tarjetaEstilo: 'borde', tarjetaFoto: 'cuadrada', tarjetaTexto: 'centro', bannersAncho: 'completo',
    cabeceraFija: false, portadaSecciones: 'ofertas,banners',
  });
});

test('validarAvanzados: opciones que no existen, colores que no son #rrggbb, y lo que no viene queda como estaba', () => {
  const { ajustes, errores } = validarAvanzados({ logoPosicion: 'volando', tarjetaEstilo: 'neon', colorFondoPropio: '1', colorFondo: 'rojo' }, ACOMPANADO);
  assert.deepEqual(Object.keys(errores).sort(), ['colorFondo', 'logoPosicion', 'tarjetaEstilo']);
  assert.deepEqual(ajustes, {});
  assert.deepEqual(validarAvanzados({}, A_MEDIDA), { ajustes: {}, errores: {} });
  // Una portada sin ninguna sección marcada es válida: queda vacía.
  assert.equal(validarAvanzados({ portadaEnviada: '1' }, ACOMPANADO).ajustes.portadaSecciones, '');
  // Los nombres que no son secciones y los repetidos no pasan.
  assert.deepEqual(seccionesDePortada('banners,hackeo,banners, ofertas'), ['banners', 'ofertas']);
  assert.deepEqual(seccionesDePortada(''), []);
});

test('validarAvanzados: el texto tiene que leerse sobre el fondo y sobre las tarjetas', () => {
  // Gris sobre gris: no se lee.
  const mal = validarAvanzados({ colorFondoPropio: '1', colorFondo: '#888888', colorTextoPropio: '1', colorTexto: '#777777' }, ACOMPANADO);
  assert.ok(mal.errores.colorTexto.includes('no se lee bien'));
  // Texto oscuro sobre fondo claro: bien.
  assert.deepEqual(validarAvanzados({ colorFondoPropio: '1', colorFondo: '#ffffff', colorTextoPropio: '1', colorTexto: '#111111' }, ACOMPANADO).errores, {});
  // Solo se cambia el fondo (oscuro) y no el texto: el texto se ajusta solo, y no hay error.
  assert.deepEqual(validarAvanzados({ colorFondoPropio: '1', colorFondo: '#101418' }, ACOMPANADO).errores, {});
  // Se cambia solo el texto a uno claro, sobre el fondo blanco de siempre: no se lee.
  assert.ok(validarAvanzados({ colorTextoPropio: '1', colorTexto: '#f5f5f5' }, ACOMPANADO).errores.colorTexto);
  // Tarjetas oscuras con el texto oscuro de siempre: no se lee.
  const tarjetas = validarAvanzados({ colorTarjetasPropio: '1', colorTarjetas: '#222222' }, ACOMPANADO);
  assert.ok(tarjetas.errores.colorTarjetas.includes('tarjetas'));
  // Se valida contra lo ya guardado: el fondo oscuro guardado hace que un texto oscuro nuevo no se lea.
  const guardado = { ...AJUSTES_AVANZADOS_POR_DEFECTO, colorFondo: '#101418' };
  assert.ok(validarAvanzados({ colorTextoPropio: '1', colorTexto: '#222222' }, ACOMPANADO, guardado).errores.colorTexto);
});

test('validarCssPropio: acepta CSS normal (con selectores >, url https y rutas de la tienda) y rechaza lo peligroso o demasiado largo', () => {
  const bueno = '.cabecera > .marca { letter-spacing: .1em }\n@media (min-width: 700px) { .nombre { font-size: 1rem } }\n.x { background: url("https://cdn.ejemplo.com/a.png") }\n.y { background: url(/subidas/1/a.webp) }';
  assert.equal(validarCssPropio(bueno).valor, bueno);
  assert.equal(validarCssPropio('  a{}  \r\n').valor, 'a{}');
  assert.equal(validarCssPropio('').valor, '');
  for (const malo of [
    'a { } </style><script>alert(1)</script>',
    '@import url(https://x.com/a.css);',
    '@charset "utf-8";',
    'a { width: expression(alert(1)) }',
    'a { background: url(javascript:alert(1)) }',
    'a { background: url("data:image/svg+xml;base64,AAAA") }',
    'a { background: url(http://inseguro.com/a.png) }',
    'a { background: url(//otro.com/a.png) }',
    'a { behavior: url(x.htc) }',
    'a { -moz-binding: url(https://x.com/b.xml#a) }',
  ]) {
    assert.ok(validarCssPropio(malo).error, `debería rechazar: ${malo}`);
  }
  const largo = validarCssPropio('a{}'.repeat(7000));
  assert.ok(largo.error.includes('Máximo'));
});

test('validarFuenteGoogle: nombres de familia simples; nada que arme otra URL', () => {
  assert.equal(validarFuenteGoogle('  Playfair   Display ').valor, 'Playfair Display');
  assert.equal(validarFuenteGoogle('').valor, '');
  assert.equal(validarFuenteGoogle('Lora').valor, 'Lora');
  for (const malo of ['Lora&display=swap', 'a', '"><script>', 'Lora;}body{', '1Lora', 'x'.repeat(50)]) assert.ok(validarFuenteGoogle(malo).error, malo);
});

// ---------- El estilo que se genera ----------

test('estiloAvanzado: con los valores de siempre no agrega nada, y con los elegidos arma atributos, variables y reglas', () => {
  const vacio = estiloAvanzado({ colorPrincipal: '#336699', ...AJUSTES_AVANZADOS_POR_DEFECTO });
  assert.deepEqual(vacio, { variables: '', css: '', atributos: '', hojasDeFuente: [] });
  // Y estiloDeTienda mantiene su contrato: sin nada elegido, solo variables y hojaDeFuente.
  assert.deepEqual(estiloDeTienda({ colorPrincipal: '#336699', ...AJUSTES_AVANZADOS_POR_DEFECTO }), { variables: '', hojaDeFuente: null });

  const elegido = estiloAvanzado({
    colorPrincipal: '#336699', ...AJUSTES_AVANZADOS_POR_DEFECTO,
    colorFondo: '#101418', colorCabecera: '#ffe27a', colorTarjetas: '#1c222a', pieEstilo: 'marca',
    logoPosicion: 'centro', cabeceraFija: false, tarjetaEstilo: 'sombra', tarjetaFoto: 'cuadrada', tarjetaTexto: 'centro', bannersAncho: 'completo',
    anchoPagina: 'angosto', fuenteTitulos: 'Playfair Display', fuenteTexto: 'Lora', cssPropio: '.nombre { color: hotpink }',
  });
  assert.equal(elegido.atributos, ' data-cabecera="estatica" data-logo="centro" data-tarjeta="sombra" data-foto="cuadrada" data-texto-tarjeta="centro" data-banners="completo"');
  assert.equal(elegido.variables, '--ancho: 960px; --fuente-titulos: "Playfair Display", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --fuente-texto: "Lora", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
  assert.deepEqual(elegido.hojasDeFuente, [
    'https://fonts.googleapis.com/css?family=Playfair+Display:400,500,600,700&display=swap',
    'https://fonts.googleapis.com/css?family=Lora:400,500,600,700&display=swap',
  ]);
  // Fondo oscuro: el texto es claro y el esquema de colores es oscuro; el checkout y el pedido quedan como siempre.
  assert.match(elegido.css, /:root:not\(:has\(\.checkout, \.pedido\)\) \{ color-scheme: dark; --fondo: #101418; --texto: #ffffff;/);
  assert.match(elegido.css, /:root \{ --tarjeta: #1c222a \}/);
  // Cabecera amarilla: texto oscuro; pie del color de la marca (azul): texto claro, y la firma de Vezza se aclara.
  assert.match(elegido.css, /\.cabecera \{ --vidrio: color-mix\(in srgb, #ffe27a 92%, transparent\)/);
  assert.match(elegido.css, /\.cabecera :is\(\.marca, \.boton-icono\) \{ color: #111111 \}/);
  assert.match(elegido.css, /\.pie \{ background: #336699;/);
  assert.match(elegido.css, /\.pie \.vezza-firma \{ --vezza-tinta: #ffffff \}/);
  // El CSS propio va al final, para pisar lo demás.
  assert.ok(elegido.css.endsWith('.nombre { color: hotpink }'));
  assert.ok(!/undefined|NaN|\[object/.test(elegido.css + elegido.variables));
  // Una fuente con símbolos nunca llega a la hoja (aunque estuviera guardada así).
  assert.deepEqual(estiloAvanzado({ ...AJUSTES_AVANZADOS_POR_DEFECTO, fuenteTitulos: '"><script>' }).hojasDeFuente, []);
});

// ---------- Planes y funciones ----------

test('la migración copia el nivel de cada plan que ya existía a sus funciones, y los sugeridos traen las de su punto de partida', async () => {
  const db = await abrirBase(':memory:');
  const vieja = (await crearTienda(db, { nombre: 'Vieja', email: 'vieja@ejemplo.com', slug: 'vieja' })).tienda.id;
  await db.prepare("UPDATE tiendas SET plan_id = (SELECT id FROM planes WHERE nombre = 'Sin límites') WHERE id = ?").run(vieja);
  assert.deepEqual(await datosDeDiseno(db, vieja), { funciones: A_MEDIDA, planNombre: 'Sin límites' }, 'las tiendas que ya existían (plan interno) no pierden nada');
  await cargarPlanesSugeridos(db);
  const funciones = Object.fromEntries((await db.prepare('SELECT nombre, funciones AS f FROM planes').all()).map((p) => [p.nombre, funcionesDeTexto(p.f)]));
  assert.deepEqual(funciones, { 'Sin límites': A_MEDIDA, Prueba: ESENCIAL, Esencial: ESENCIAL, Acompañado: ACOMPANADO, 'A medida': A_MEDIDA });

  // Recomendado: hasta ahora era el plan pago más barato; los sugeridos dejan marcado a Esencial y a ninguno más.
  assert.deepEqual((await db.prepare('SELECT nombre FROM planes WHERE destacado = 1').all()).map((p) => p.nombre), ['Esencial']);
});

test('la migración 020 sobre una base con planes de antes: cada nivel pasa a sus funciones y se marca el recomendado de siempre', async () => {
  const db = await abrirBase(':memory:');
  const migracion = readFileSync(new URL('../src/migraciones/020_funciones_de_los_planes.sql', import.meta.url), 'utf8');
  // Se vuelve a como estaba la base antes de esa migración.
  for (const columna of ['funciones', 'descripcion', 'caracteristicas', 'destacado']) await db.exec(`ALTER TABLE planes DROP COLUMN ${columna}`);
  await db.exec('DELETE FROM planes WHERE nombre <> \'Sin límites\'');
  const insertar = (nombre, precio, nivel, dias = null, activo = 1) =>
    db.prepare('INSERT INTO planes (nombre, precio_centavos, max_productos, max_fotos, max_banners, activo, dias_prueba, nivel_diseno) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?)').run(nombre, precio, activo, dias, nivel);
  await insertar('Prueba', 0, 'esencial', 7);
  await insertar('Básico', 1_290_000, 'esencial');
  await insertar('Medio', 3_490_000, 'acompanado');
  await insertar('Grande', 8_990_000, 'a_medida');
  await insertar('Viejo y barato', 500_000, 'esencial', null, 0);
  await db.exec(migracion);
  const filas = Object.fromEntries((await db.prepare('SELECT nombre, funciones, descripcion, caracteristicas, destacado FROM planes').all()).map((p) => [p.nombre, p]));
  assert.deepEqual(funcionesDeTexto(filas.Prueba.funciones), ESENCIAL);
  assert.deepEqual(funcionesDeTexto(filas.Básico.funciones), ESENCIAL);
  assert.deepEqual(funcionesDeTexto(filas.Medio.funciones), ACOMPANADO);
  assert.deepEqual(funcionesDeTexto(filas.Grande.funciones), A_MEDIDA);
  assert.deepEqual(funcionesDeTexto(filas['Sin límites'].funciones), A_MEDIDA);
  for (const fila of Object.values(filas)) assert.deepEqual([fila.descripcion, fila.caracteristicas], ['', ''], 'los textos de la tarjeta arrancan vacíos: se arman solos, como siempre');
  assert.deepEqual(Object.entries(filas).filter(([, fila]) => Number(fila.destacado) === 1).map(([nombre]) => nombre), ['Básico'], 'el pago más barato que se ofrece, sin prueba: el que se recomendaba hasta ahora');
});

test('validarPlan: las funciones tildadas se guardan; sin tildar ninguna es "solo lo básico"; sin el campo, un plan nuevo arranca sin funciones y uno que se edita conserva las suyas', async () => {
  const db = await abrirBase(':memory:');
  const { datos, errores } = await validarPlan(db, null, { nombre: 'Plus', precio: '20000', funcionesEnviadas: '1', funciones: ['pie', 'colores', 'colores'] });
  assert.deepEqual(errores, {});
  assert.deepEqual(datos.funciones, ['colores', 'pie'], 'sin repetidas y en el orden del catálogo');
  const id = await crearPlan(db, datos);
  assert.deepEqual((await leerPlan(db, id)).funciones, ['colores', 'pie']);
  // Una sola casilla tildada llega como texto, no como lista.
  assert.deepEqual((await validarPlan(db, null, { nombre: 'Uno', funcionesEnviadas: '1', funciones: 'css' })).datos.funciones, ['css']);
  // El formulario manda `funcionesEnviadas`: sin ninguna casilla, el plan queda sin funciones.
  assert.deepEqual((await validarPlan(db, id, { nombre: 'Plus', funcionesEnviadas: '1' })).datos.funciones, []);
  // Sin el campo (por ejemplo, otro cliente de la API), se conserva lo que había.
  assert.deepEqual((await validarPlan(db, id, { nombre: 'Plus' })).datos.funciones, ['colores', 'pie']);
  assert.deepEqual((await validarPlan(db, null, { nombre: 'Otro' })).datos.funciones, []);
  // Una función que no existe es un error.
  assert.ok((await validarPlan(db, null, { nombre: 'Raro', funcionesEnviadas: '1', funciones: ['colores', 'supremo'] })).errores.funciones);
  // editarPlan sin `funciones` no las toca.
  const { funciones, ...sinFunciones } = datos;
  await editarPlan(db, id, { ...sinFunciones, nombre: 'Plus 2' });
  assert.deepEqual((await leerPlan(db, id)).funciones, ['colores', 'pie']);
  await editarPlan(db, id, { ...datos, funciones: A_MEDIDA });
  assert.deepEqual((await leerPlan(db, id)).funciones, A_MEDIDA);
  // El cambio de funciones figura entre los cambios del plan (les toca a quienes lo tienen).
  const cambios = compararPlan({ ...(await leerPlan(db, id)), funciones: ACOMPANADO }, { ...datos, funciones: A_MEDIDA });
  assert.deepEqual(cambios.filter((c) => c.campo === 'funciones').map((c) => [c.etiqueta, c.antes, c.despues, c.afecta]), [['Diseño de la tienda', 'Acompañado', 'A medida', true]]);
  const aGusto = compararPlan({ ...datos, funciones: [] }, { ...datos, funciones: ['colores', 'tarjetas'] });
  assert.deepEqual(aGusto.map((c) => [c.antes, c.despues]), [['Esencial', 'colores y tarjetas']]);
});

// ---------- Con la aplicación andando ----------

let db;
let servidor;
let puerto;
let contador = 0;

before(() => {});
after(() => {
  servidor?.closeAllConnections();
  servidor?.close();
});

beforeEach(async () => {
  servidor?.closeAllConnections();
  servidor?.close();
  db = await abrirBase(':memory:');
  const config = { produccion: false, secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres', dominio: 'localhost', dirImportaciones: '.', dirSubidas: '.' };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
});

// Una tienda en un plan con las funciones dadas: un punto de partida ('esencial', 'acompanado', 'a_medida') o una lista (sin plan: tiene todas).
async function tienda(nivel) {
  contador++;
  const slug = `tienda-plan-${contador}`;
  const { tienda: creada, clave } = await crearTienda(db, { nombre: `Casa ${contador}`, email: `${slug}@ejemplo.com`, slug });
  if (nivel) {
    const funciones = Array.isArray(nivel) ? nivel : funcionesDePreset(nivel);
    const planId = await crearPlan(db, { nombre: `Plan ${Array.isArray(nivel) ? funciones.join('+') || 'basico' : nivel} ${contador}`, precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones });
    await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(planId, creada.id);
  }
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['TAZA', 'Taza', 1500, 10], ['MATE', 'Mate', 2500, 10]]);
  await aplicarImportacion(db, creada.id, productos);
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email: `${slug}@ejemplo.com`, clave })).status, 302);
  return { nav, tiendaId: creada.id, slug };
}

const BASICOS = { colorPrincipal: '#336699', ordenCatalogo: 'nombre' };
const guardarDiseno = (t, campos) => t.nav.enviar('/admin/diseno', { ...BASICOS, ...campos }, { desde: '/admin/diseno' });
const vidriera = async (t, ruta = '/') => (await pedirConHost(puerto, `${t.slug}.localhost`, ruta)).cuerpo;

test('el panel de Diseño muestra bloqueado lo que el plan no incluye, y lo que sí incluye, abierto', async () => {
  const esencial = await tienda('esencial');
  let pagina = await (await esencial.nav.pedir('/admin/diseno')).text();
  assert.ok(pagina.includes('Tu plan: Plan esencial'));
  assert.ok(pagina.includes('Diseño incluido: Lo básico'));
  assert.ok(pagina.includes('¿Qué incluye cada plan?'));
  assert.equal([...pagina.matchAll(/class="funcion-bloque funcion-bloqueada"/g)].length, 8, 'las ocho funciones de esta pantalla salen bloqueadas');
  assert.equal([...pagina.matchAll(/class="bloqueable" disabled/g)].length, 8);
  assert.match(pagina, /Tu plan Plan esencial \d+ no incluye <strong>Colores de la tienda<\/strong>\. Por ahora no lo incluye ninguno de los planes que se ofrecen/, 'con un solo plan ofrecido (el suyo, sin funciones), ninguno lo incluye');

  const acompanado = await tienda('acompanado');
  pagina = await (await acompanado.nav.pedir('/admin/diseno')).text();
  assert.ok(pagina.includes('Diseño incluido: colores, logo y cabecera, portada, tarjetas, pie y kit de marca'));
  const bloqueadas = [...pagina.matchAll(/class="funcion-bloque funcion-bloqueada" id="funcion-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bloqueadas, ['fuentes', 'ancho', 'css'], 'solo lo de a medida queda bloqueado');
  assert.ok(pagina.includes('no incluye <strong>CSS propio</strong>'));
  assert.ok(!pagina.includes('no incluye <strong>Colores de la tienda</strong>'));

  const medida = await tienda(null); // sin plan: tiene todas
  pagina = await (await medida.nav.pedir('/admin/diseno')).text();
  assert.ok(pagina.includes('Tu plan</h2>') || pagina.includes('Tu plan'));
  assert.ok(pagina.includes('Diseño incluido: Todo'));
  assert.ok(!pagina.includes('funcion-bloqueada') && !pagina.includes('class="bloqueable" disabled'));
  assert.deepEqual(await datosDeDiseno(db, medida.tiendaId), { funciones: CLAVES_DE_FUNCIONES, planNombre: null });
  assert.deepEqual((await datosDeDiseno(db, esencial.tiendaId)).funciones, []);
});

test('cada función se activa por separado: un plan puede tener CSS propio sin colores, y el panel le dice a qué plan pasar para lo que le falta', async () => {
  // Dos planes ofrecidos que incluyen colores (uno de ellos, el del cliente, no).
  await crearPlan(db, { nombre: 'Con colores', precioCentavos: 2000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones: ['colores'] });
  await crearPlan(db, { nombre: 'Con todo', precioCentavos: 9000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones: A_MEDIDA });
  const t = await tienda(['css', 'tarjetas']);
  const pagina = await (await t.nav.pedir('/admin/diseno')).text();
  const bloqueadas = [...pagina.matchAll(/class="funcion-bloque funcion-bloqueada" id="funcion-([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(bloqueadas, ['colores', 'portada', 'logo_cabecera', 'pie', 'fuentes', 'ancho'], 'solo quedan abiertos los CSS propio y las tarjetas');
  assert.ok(pagina.includes('no incluye <strong>Colores de la tienda</strong>. Lo incluyen los planes Con colores y Con todo.'));
  assert.ok(pagina.includes('no incluye <strong>Portada personalizable</strong>. Lo incluye el plan Con todo.'));

  // Lo que manda, se guarda solo por función: los colores se ignoran, el CSS y las tarjetas no.
  const respuesta = await guardarDiseno(t, { colorFondoPropio: '1', colorFondo: '#101418', tarjetaEstilo: 'sombra', cssPropio: '.nombre { color: hotpink }', logoPosicion: 'centro' });
  assert.equal(respuesta.status, 302);
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.deepEqual([ajustes.colorFondo, ajustes.tarjetaEstilo, ajustes.cssPropio, ajustes.logoPosicion], ['', 'sombra', '.nombre { color: hotpink }', 'izquierda']);
  const html = await vidriera(t);
  assert.ok(html.includes('data-tarjeta="sombra"') && html.includes('hotpink'));
  assert.ok(!html.includes('--fondo: #101418') && !html.includes('data-logo'));
});

test('un plan Esencial no puede guardar colores, portada ni CSS aunque mande los campos a mano; lo básico sí se guarda', async () => {
  const t = await tienda('esencial');
  const respuesta = await guardarDiseno(t, {
    franjaTexto: 'Envíos a todo el país',
    colorFondoPropio: '1', colorFondo: '#101418', tarjetaEstilo: 'sombra', logoPosicion: 'centro', cssPropio: 'body { display: none }', anchoPagina: 'completo', fuenteTitulos: 'Lora',
    portadaEnviada: '1', portadaMostrar_ofertas: '1', portadaOrden_ofertas: '1',
  });
  assert.equal(respuesta.status, 302);
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.equal(ajustes.franjaTexto, 'Envíos a todo el país');
  for (const [campo, valor] of Object.entries(AJUSTES_AVANZADOS_POR_DEFECTO)) assert.equal(ajustes[campo], valor, campo);
  const html = await vidriera(t);
  assert.ok(!html.includes('data-tarjeta') && !html.includes('hotpink') && !/<body [^>]*data-/.test(html));
  assert.ok(!html.includes('display: none'));
});

test('un plan Acompañado guarda colores, tarjetas, logo, pie y portada, y la vidriera los aplica', async () => {
  const t = await tienda('acompanado');
  await db.prepare("UPDATE variantes SET precio_promocional_centavos = 100000 WHERE tienda_id = ? AND sku = 'MATE'").run(t.tiendaId);
  await db.prepare("UPDATE productos SET destacado = 1 WHERE tienda_id = ? AND nombre = 'Taza'").run(t.tiendaId);
  const respuesta = await guardarDiseno(t, {
    colorFondoPropio: '1', colorFondo: '#101418', colorCabeceraPropio: '1', colorCabecera: '#ffe27a',
    logoPosicion: 'derecha', cabeceraFija: '0', pieEstilo: 'oscuro', tarjetaEstilo: 'borde', tarjetaFoto: 'cuadrada', tarjetaTexto: 'centro', bannersAncho: 'completo',
    portadaEnviada: '1', portadaMostrar_ofertas: '1', portadaMostrar_destacados: '1', portadaOrden_ofertas: '1', portadaOrden_destacados: '2', portadaOrden_banners: '3',
    cssPropio: 'body { display: none }', anchoPagina: 'completo', fuenteTitulos: 'Lora', // de plan a medida: se ignora
  });
  assert.equal(respuesta.status, 302);
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.equal(ajustes.colorFondo, '#101418');
  assert.equal(ajustes.portadaSecciones, 'ofertas,destacados');
  assert.equal(ajustes.cabeceraFija, false);
  assert.equal(ajustes.cssPropio, '');
  assert.equal(ajustes.anchoPagina, 'normal');

  const html = await vidriera(t);
  assert.match(html, /<body data-cabecera="estatica" data-logo="derecha" data-tarjeta="borde" data-foto="cuadrada" data-texto-tarjeta="centro" data-banners="completo">/);
  assert.ok(html.includes(':root:not(:has(.checkout, .pedido)) { color-scheme: dark; --fondo: #101418;'));
  assert.ok(html.includes('.cabecera { --vidrio: color-mix(in srgb, #ffe27a 92%, transparent)'));
  assert.ok(html.includes('.pie { background: #18181b;'));
  assert.ok(!html.includes('display: none') && !html.includes('fonts.googleapis.com/css?family='), 'lo de plan a medida no se aplica');
  // La portada: primero las ofertas y después los destacados, cada una con sus productos.
  const iOfertas = html.indexOf('id="titulo-ofertas"');
  const iDestacados = html.indexOf('id="titulo-destacados"');
  assert.ok(iOfertas > 0 && iDestacados > iOfertas, 'ofertas antes que destacados');
  assert.ok(html.slice(iOfertas, iDestacados).includes('Mate') && !html.slice(iOfertas, iDestacados).includes('Taza'));
  assert.ok(html.slice(iDestacados).includes('Taza'));
  // Y el panel vuelve a mostrar lo guardado.
  const panel = await (await t.nav.pedir('/admin/diseno')).text();
  assert.ok(panel.includes('<option value="1" selected>1.º</option>') && panel.includes('name="tarjetaEstilo" value="borde" checked'));
});

test('las funciones se aplican al leer: si el cliente baja de plan lo elegido queda guardado pero no se ve, y vuelve si sube', async () => {
  const t = await tienda('acompanado');
  await guardarDiseno(t, { colorFondoPropio: '1', colorFondo: '#101418', tarjetaEstilo: 'sombra' });
  assert.ok((await vidriera(t)).includes('data-tarjeta="sombra"'));
  const esencial = await crearPlan(db, { nombre: 'Baja', precioCentavos: 1000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones: ESENCIAL });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(esencial, t.tiendaId);
  const abajo = await vidriera(t);
  assert.ok(!abajo.includes('data-tarjeta') && !abajo.includes('--fondo: #101418'));
  assert.equal((await leerAjustes(db, t.tiendaId)).tarjetaEstilo, 'sombra', 'lo guardado no se perdió');
  const panel = await (await t.nav.pedir('/admin/diseno')).text();
  assert.ok(panel.includes('name="tarjetaEstilo" value="sombra" checked'), 'el panel lo sigue mostrando (bloqueado)');
  const acompanado = await crearPlan(db, { nombre: 'Sube', precioCentavos: 3000, maxProductos: null, maxFotos: null, maxBanners: null, activo: true, funciones: ACOMPANADO });
  await db.prepare('UPDATE tiendas SET plan_id = ? WHERE id = ?').run(acompanado, t.tiendaId);
  assert.ok((await vidriera(t)).includes('data-tarjeta="sombra"'));
});

test('colores que no se leen: no se guarda nada y el panel dice por qué', async () => {
  const t = await tienda('acompanado');
  const respuesta = await guardarDiseno(t, { colorFondoPropio: '1', colorFondo: '#888888', colorTextoPropio: '1', colorTexto: '#777777', franjaTexto: 'Nada se guarda' });
  assert.equal(respuesta.status, 400);
  assert.ok((await respuesta.text()).includes('El texto no se lee bien sobre ese fondo'));
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.equal(ajustes.colorFondo, '');
  assert.equal(ajustes.franjaTexto, '', 'tampoco lo básico: se corrige todo junto');
});

test('el plan a medida guarda CSS propio, tipografías y ancho; el CSS peligroso se rechaza', async () => {
  const t = await tienda('a_medida');
  const css = '.cabecera > .marca { letter-spacing: .12em }\n.nombre { color: hotpink }';
  const respuesta = await guardarDiseno(t, { cssPropio: css, fuenteTitulos: 'Playfair Display', fuenteTexto: 'Lora', anchoPagina: 'angosto' });
  assert.equal(respuesta.status, 302);
  const ajustes = await leerAjustes(db, t.tiendaId);
  assert.equal(ajustes.cssPropio, css);
  assert.equal(ajustes.fuenteTitulos, 'Playfair Display');
  const html = await vidriera(t);
  assert.ok(html.includes('.cabecera > .marca { letter-spacing: .12em }'), 'el > de los selectores no se escapa');
  assert.ok(html.includes('--ancho: 960px'));
  assert.ok(html.includes('--fuente-titulos: "Playfair Display"'));
  assert.ok(html.includes('<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Playfair+Display:400,500,600,700&amp;display=swap">') || html.includes('https://fonts.googleapis.com/css?family=Playfair+Display:400,500,600,700&display=swap'));
  // El CSS va después de tienda.css y de las variables.
  assert.ok(html.indexOf('/tienda.css') < html.indexOf('hotpink'));

  const peligroso = await guardarDiseno(t, { cssPropio: 'a{} </style><script>alert(1)</script>', fuenteTitulos: 'Lora&x=1' });
  assert.equal(peligroso.status, 400);
  const texto = await peligroso.text();
  assert.ok(texto.includes('No puede llevar el signo &lt;'));
  assert.ok(texto.includes('Escribí el nombre tal como figura'));
  assert.equal((await leerAjustes(db, t.tiendaId)).cssPropio, css, 'no se pisó lo guardado');
});

test('el código de cabecera y de pie que carga la plataforma solo se usa si el plan incluye "Códigos de seguimiento"', async () => {
  const medida = await tienda('a_medida');
  const acompanado = await tienda('acompanado');
  const soloCodigos = await tienda(['codigos']);
  for (const t of [medida, acompanado, soloCodigos]) {
    await db.prepare('UPDATE tiendas SET codigo_cabecera = ?, codigo_pie = ? WHERE id = ?').run('<script>/* pixel-cabecera */</script>', '<script>/* pixel-pie */</script>', t.tiendaId);
  }
  const conCodigo = await vidriera(medida);
  assert.ok(conCodigo.includes('/* pixel-cabecera */') && conCodigo.includes('/* pixel-pie */'));
  assert.ok(conCodigo.indexOf('/* pixel-cabecera */') < conCodigo.indexOf('</head>') && conCodigo.indexOf('/* pixel-pie */') < conCodigo.indexOf('</body>'));
  const sinCodigo = await vidriera(acompanado);
  assert.ok(!sinCodigo.includes('pixel-cabecera') && !sinCodigo.includes('pixel-pie'));
  assert.ok((await vidriera(soloCodigos)).includes('/* pixel-cabecera */'), 'la función se activa sola, sin pedir las demás');
});

test('la portada por defecto no cambia: banners y destacados, sin la sección de ofertas', async () => {
  const t = await tienda('esencial');
  await db.prepare("UPDATE productos SET destacado = 1 WHERE tienda_id = ? AND nombre = 'Taza'").run(t.tiendaId);
  await db.prepare("UPDATE variantes SET precio_promocional_centavos = 100000 WHERE tienda_id = ? AND sku = 'MATE'").run(t.tiendaId);
  const html = await vidriera(t);
  assert.ok(html.includes('id="titulo-destacados"'));
  assert.ok(!html.includes('id="titulo-ofertas"'));
  assert.ok(!/<body [^>]*data-/.test(html) && !html.includes('<style>:root:not'));
});

test('el plan se muestra en las tarjetas de planes con lo que incluye cada nivel de diseño', async () => {
  await cargarPlanesSugeridos(db);
  const { armarPlanes } = await import('../src/landing.js');
  const { listarPlanes } = await import('../src/plataforma.js');
  const tarjetas = armarPlanes(await listarPlanes(db));
  const linea = (nombre) => tarjetas.find((t) => t.nombre === nombre).items.find((i) => i.startsWith('Diseño') || i.startsWith('Más controles'));
  assert.equal(linea('Esencial'), 'Diseño de tu tienda: Esencial');
  assert.equal(linea('Acompañado'), 'Más controles de diseño: colores, portada y tarjetas');
  assert.equal(linea('A medida'), 'Diseño 100 % a medida y dominio propio');
});
