// Dashboard del Inicio: períodos, cuentas de ventas, pedidos, clientes, productos y stock, y la card en el panel.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { abrirBase } from '../src/db.js';
import { crearApp } from '../src/app.js';
import { crearTienda } from '../src/tiendas.js';
import { crearPlan } from '../src/plataforma.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { crearPedido } from '../src/pedidos.js';
import { hoy, sumarDias } from '../src/util/fechas.js';
import {
  resolverPeriodo,
  limitesUtc,
  variacion,
  armarSerie,
  urlDashboard,
  totalesDelPeriodo,
  ventasPorDia,
  momentosDeCompra,
  pedidosPorEstado,
  ventasPorPago,
  ventasPorEntrega,
  ventasPorLugar,
  clientesDelPeriodo,
  productosVendidos,
  ventasPorCategoria,
  ventasPorMarca,
  productosSinVentas,
  resumenDelCatalogo,
  inventario,
  pedidosDemorados,
  datosDashboard,
  compararTotales,
} from '../src/dashboard.js';
import { prepararVista } from '../src/dashboard-vista.js';
import { techoAgradable, armarGrafico } from '../src/util/grafico.js';
import { formatearPesos, formatearCompacto, formatearNumero, formatearDuracion, formatearPorcentaje } from '../src/util/formato.js';
import { crearNavegador } from './ayudantes.js';

let servidor;
let puerto;
let db;

before(async () => {
  db = await abrirBase(':memory:');
  const config = {
    produccion: false,
    secretoSesion: 'secreto-de-prueba-de-al-menos-32-caracteres',
    dominio: 'localhost',
    dirSubidas: mkdtempSync(path.join(tmpdir(), 'subidas-')),
  };
  servidor = crearApp({ db, config }).listen(0);
  await once(servidor, 'listening');
  puerto = servidor.address().port;
  // Los datos se arman acá, en orden: Node corre varios `before` de la raíz a la vez, y estos dependen de `db`.
  await sembrarTiendaA();
  await sembrarTiendaDelPanel();
});

after(() => servidor.close());

// ---------- Datos de prueba ----------

const FILAS = [
  ['SKU', 'Nombre', 'Precio', 'Precio promocional', 'Stock', 'Categorías', 'Marca', 'Atributo 1', 'Valor 1'],
  ['REM-S', 'Remera', 10000, null, 500, 'Remeras', 'Norte', 'Talle', 'S'],
  ['REM-M', 'Remera', 10000, null, 500, 'Remeras', 'Norte', 'Talle', 'M'],
  ['BUZ-M', 'Buzo', 30000, 25000, 500, 'Abrigos > Buzos', 'Norte', 'Talle', 'M'],
  ['GOR', 'Gorra', 5000, null, 500, null, 'Sur', null, null],
  ['CIN', 'Cinto', 8000, null, 40, null, null, null, null],
];

async function tiendaConCatalogo(slug, filas = FILAS) {
  const { tienda, clave } = await crearTienda(db, { nombre: slug, email: `${slug}@ejemplo.com` });
  const { productos, errores } = interpretarHoja(filas);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tienda.id, productos);
  return { tiendaId: tienda.id, email: `${slug}@ejemplo.com`, clave };
}

const ENTREGAS = {
  retiro: { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null },
  moto: { tipo: 'domicilio', nombre: 'Envío en moto', descripcion: '', costo: 300000, gratisDesde: null },
  coordinar: { tipo: 'domicilio', nombre: 'Envío a todo el país', descripcion: '', costo: null, gratisDesde: null },
};
const PAGOS = { transferencia: { clave: 'transferencia', descuento: 10 }, efectivo: { clave: 'efectivo', descuento: 5 }, mercadopago: { clave: 'mercadopago', descuento: 0 } };

// Un pedido con fecha, estado y cliente a elección. `creado` va en UTC, como lo guarda la base ("2026-11-12 15:00:00").
async function pedido(tiendaId, { items, cliente = 'Ana', telefono = '351 111 1111', pago = 'transferencia', entrega = 'moto', provincia = 'Córdoba', ciudad = 'Córdoba', estado = 'entregado', creado, actualizado = creado }) {
  const domicilio = ENTREGAS[entrega].tipo === 'domicilio';
  const { id } = await crearPedido(db, tiendaId, items.map(([sku, cantidad]) => ({ sku, cantidad })), {
    cliente: { nombre: cliente, telefono, email: '' },
    entrega: ENTREGAS[entrega],
    direccion: domicilio ? { calle: 'Belgrano 450', piso: '', ciudad, provincia, cp: '', referencias: '' } : { calle: '', piso: '', ciudad: '', provincia: '', cp: '', referencias: '' },
    pago: PAGOS[pago],
    notas: '',
  });
  await db.prepare('UPDATE pedidos SET estado = ?, creado_en = ?, actualizado_en = ? WHERE id = ?').run(estado, creado, actualizado, id);
  return id;
}

const HOY = '2026-11-19'; // jueves
const AHORA = new Date('2026-11-19T18:00:00Z');
const TREINTA_DIAS = resolverPeriodo({ periodo: '30d' }, { hoy: HOY });

// La tienda de las cuentas: ocho pedidos en distintos días, estados, clientes y formas de pago.
let A;
async function sembrarTiendaA() {
  A = await tiendaConCatalogo('tienda-a');
  const t = A.tiendaId;
  await pedido(t, { items: [['GOR', 1]], cliente: 'Beto', telefono: '351 222 2222', pago: 'efectivo', entrega: 'retiro', creado: '2026-09-01 15:00:00' });
  await pedido(t, { items: [['REM-S', 1]], creado: '2026-10-05 15:00:00' });
  await pedido(t, { items: [['REM-S', 2]], creado: '2026-11-10 15:00:00', actualizado: '2026-11-12 15:00:00' });
  await pedido(t, { items: [['REM-M', 1]], cliente: 'Eli', telefono: '351 555 5555', pago: 'mercadopago', entrega: 'retiro', estado: 'pagado', creado: '2026-11-12 14:00:00' });
  // 17/11 a las 23:30 de Argentina (02:30 UTC del 18)
  await pedido(t, { items: [['BUZ-M', 1], ['GOR', 1]], cliente: 'Beto', telefono: '351 222 2222', pago: 'efectivo', entrega: 'retiro', estado: 'pagado', creado: '2026-11-18 02:30:00' });
  // 18/11 a las 00:30 de Argentina (03:30 UTC): la misma clienta que el primero, con el teléfono escrito de otra forma
  await pedido(t, { items: [['REM-M', 1]], telefono: '+54 9 351 111 1111', provincia: 'Santa Fe', ciudad: 'Rosario', estado: 'enviado', creado: '2026-11-18 03:30:00' });
  await pedido(t, { items: [['REM-M', 1]], cliente: 'Cami', telefono: '351 333 3333', estado: 'nuevo', creado: '2026-11-19 12:00:00' });
  await pedido(t, { items: [['REM-M', 3]], cliente: 'Dani', telefono: '351 444 4444', estado: 'cancelado', creado: '2026-11-19 13:00:00' });
}

// ---------- Períodos ----------

test('períodos: cada uno trae su rango, con qué se compara y cómo se agrupa', () => {
  const p = (periodo, extra = {}, opciones = {}) => resolverPeriodo({ periodo, ...extra }, { hoy: HOY, ...opciones });

  const hoyP = p('hoy');
  assert.deepEqual([hoyP.desde, hoyP.hasta, hoyP.dias], [HOY, HOY, 1]);
  assert.deepEqual(hoyP.anterior, { desde: '2026-11-18', hasta: '2026-11-18', titulo: 'ayer (el día completo)' });
  assert.equal(hoyP.texto, 'Hoy, 19/11/2026');

  const siete = p('7d');
  assert.deepEqual([siete.desde, siete.hasta, siete.dias, siete.agrupar], ['2026-11-13', HOY, 7, 'dia']);
  assert.deepEqual([siete.anterior.desde, siete.anterior.hasta], ['2026-11-06', '2026-11-12']);

  const treinta = p('30d');
  assert.deepEqual([treinta.desde, treinta.dias, treinta.titulo], ['2026-10-21', 30, '30 días']);
  assert.deepEqual([treinta.anterior.desde, treinta.anterior.hasta], ['2026-09-21', '2026-10-20']);
  assert.equal(treinta.texto, 'Del 21/10/2026 al 19/11/2026');

  const noventa = p('90d');
  assert.deepEqual([noventa.desde, noventa.dias, noventa.agrupar], ['2026-08-22', 90, 'semana']);

  const mes = p('mes');
  assert.deepEqual([mes.desde, mes.hasta, mes.dias], ['2026-11-01', HOY, 19]);
  assert.deepEqual([mes.anterior.desde, mes.anterior.hasta], ['2026-10-01', '2026-10-19'], 'el mismo tramo del mes anterior');

  const pasado = p('mes-anterior');
  assert.deepEqual([pasado.desde, pasado.hasta, pasado.dias], ['2026-10-01', '2026-10-31', 31]);
  assert.deepEqual([pasado.anterior.desde, pasado.anterior.hasta], ['2026-09-01', '2026-09-30']);

  const anio = p('anio');
  assert.deepEqual([anio.desde, anio.hasta, anio.agrupar], ['2026-01-01', HOY, 'mes']);
  assert.deepEqual([anio.anterior.desde, anio.anterior.hasta], ['2025-01-01', '2025-11-19']);

  const todo = p('todo', {}, { primerDia: '2026-03-05' });
  assert.deepEqual([todo.desde, todo.hasta, todo.anterior], ['2026-03-05', HOY, null]);
  assert.equal(p('todo').desde, HOY, 'sin pedidos, "Todo" es solo hoy');
});

test('períodos: los bordes del calendario (fin de mes, año bisiesto)', () => {
  // El 31 de marzo, "este mes" son 31 días y febrero tiene 28: se compara con todo febrero.
  const marzo = resolverPeriodo({ periodo: 'mes' }, { hoy: '2026-03-31' });
  assert.deepEqual([marzo.anterior.desde, marzo.anterior.hasta], ['2026-02-01', '2026-02-28']);
  // El 29 de febrero de un año bisiesto, el año anterior llega hasta el 28.
  const bisiesto = resolverPeriodo({ periodo: 'anio' }, { hoy: '2028-02-29' });
  assert.deepEqual([bisiesto.desde, bisiesto.anterior.desde, bisiesto.anterior.hasta], ['2028-01-01', '2027-01-01', '2027-02-28']);
  // En enero, "mes pasado" es diciembre del año anterior.
  const enero = resolverPeriodo({ periodo: 'mes-anterior' }, { hoy: '2027-01-15' });
  assert.deepEqual([enero.desde, enero.hasta], ['2026-12-01', '2026-12-31']);
});

test('períodos: fechas elegidas, con sus errores; todo lo raro vuelve a 30 días', () => {
  const bueno = resolverPeriodo({ periodo: 'rango', desde: '2026-11-01', hasta: '2026-11-10' }, { hoy: HOY });
  assert.deepEqual([bueno.clave, bueno.desde, bueno.hasta, bueno.dias, bueno.error, bueno.titulo], ['rango', '2026-11-01', '2026-11-10', 10, null, 'Fechas elegidas']);
  assert.deepEqual([bueno.anterior.desde, bueno.anterior.hasta], ['2026-10-22', '2026-10-31']);

  const futuro = resolverPeriodo({ periodo: 'rango', desde: '2026-11-01', hasta: '2027-01-01' }, { hoy: HOY });
  assert.equal(futuro.hasta, HOY, 'el fin no pasa de hoy');
  assert.equal(futuro.error, null);

  const una = resolverPeriodo({ periodo: 'rango', desde: '2026-11-05', hasta: '2026-11-05' }, { hoy: HOY });
  assert.equal(una.texto, 'El 5/11/2026');

  for (const mal of [
    { desde: '2026-11-10', hasta: '2026-11-01' },
    { desde: '2026-13-01', hasta: '2026-11-01' },
    { desde: 'ayer', hasta: 'hoy' },
    { desde: '', hasta: '' },
    { desde: '2026-12-01', hasta: '2026-12-10' },
    { desde: '2010-01-01', hasta: '2026-11-01' },
  ]) {
    const r = resolverPeriodo({ periodo: 'rango', ...mal }, { hoy: HOY });
    assert.equal(r.clave, '30d', `vuelve a 30 días con ${JSON.stringify(mal)}`);
    assert.match(r.error, /\S/);
  }
  for (const raro of [undefined, '', 'xyz', '__proto__', ['7d'], { toString: () => '7d' }, 7]) {
    const r = resolverPeriodo({ periodo: raro }, { hoy: HOY });
    assert.equal(r.clave, '30d');
    assert.equal(r.error, null, 'un período desconocido no es un error: simplemente se usa el de siempre');
  }
});

test('un día argentino va de las 03:00 UTC a las 03:00 UTC del siguiente', () => {
  assert.deepEqual(limitesUtc({ desde: '2026-11-19', hasta: '2026-11-19' }), { desdeUtc: '2026-11-19 03:00:00', hastaUtc: '2026-11-20 03:00:00' });
  assert.deepEqual(limitesUtc({ desde: '2026-12-31', hasta: '2027-01-02' }), { desdeUtc: '2026-12-31 03:00:00', hastaUtc: '2027-01-03 03:00:00' });
});

test('la URL de cada panel y período lleva el ancla a la card y no repite lo de siempre', () => {
  assert.equal(urlDashboard(), '/admin/inicio#dashboard');
  assert.equal(urlDashboard({ panel: 'ventas' }), '/admin/inicio?panel=ventas#dashboard');
  assert.equal(urlDashboard({ periodo: '7d', panel: 'stock' }), '/admin/inicio?panel=stock&periodo=7d#dashboard');
  assert.equal(urlDashboard({ periodo: 'rango', desde: '2026-11-01', hasta: '2026-11-10' }), '/admin/inicio?periodo=rango&desde=2026-11-01&hasta=2026-11-10#dashboard');
});

test('cuánto cambió un número respecto del período anterior', () => {
  assert.equal(variacion(10, null), null);
  assert.deepEqual(variacion(0, 0), { tipo: 'igual', porcentaje: 0 });
  assert.deepEqual(variacion(5, 0), { tipo: 'nuevo', porcentaje: null });
  assert.deepEqual(variacion(150, 100), { tipo: 'sube', porcentaje: 0.5 });
  assert.deepEqual(variacion(50, 100), { tipo: 'baja', porcentaje: -0.5 });
  assert.equal(variacion(100, 100).tipo, 'igual');
  assert.equal(compararTotales({ ventas: 1 }, null), null);
});

// ---------- Series y gráficos ----------

test('la serie rellena los días sin ventas y agrupa en semanas (de lunes) o meses', () => {
  const filas = [{ dia: '2026-11-11', pedidos: 2, ventas: 500 }, { dia: '2026-11-18', pedidos: 1, ventas: 300 }];
  const dias = armarSerie(filas, { desde: '2026-11-09', hasta: '2026-11-19', agrupar: 'dia' });
  assert.equal(dias.length, 11);
  assert.deepEqual(dias.map((d) => d.ventas), [0, 0, 500, 0, 0, 0, 0, 0, 0, 300, 0]);
  assert.equal(dias[2].nombre, 'Miércoles 11/11');
  assert.equal(dias[2].etiqueta, '11/11');

  const semanas = armarSerie(filas, { desde: '2026-11-09', hasta: '2026-11-19', agrupar: 'semana' });
  assert.deepEqual(semanas.map((s) => [s.clave, s.ventas, s.pedidos]), [['2026-11-09', 500, 2], ['2026-11-16', 300, 1]]);
  assert.equal(semanas[0].nombre, 'Semana del 9/11 al 15/11');
  assert.equal(semanas[1].nombre, 'Semana del 16/11 al 19/11', 'la última semana llega hasta el último día del período');

  const parcial = armarSerie([], { desde: '2026-11-11', hasta: '2026-11-17', agrupar: 'semana' });
  assert.deepEqual(parcial.map((s) => s.clave), ['2026-11-09', '2026-11-16'], 'una semana que arranca antes del período se llama por su lunes');

  const meses = armarSerie([{ dia: '2026-10-31', pedidos: 1, ventas: 10 }, { dia: '2026-11-01', pedidos: 1, ventas: 20 }], { desde: '2026-09-15', hasta: '2026-11-19', agrupar: 'mes' });
  assert.deepEqual(meses.map((m) => [m.etiqueta, m.nombre, m.ventas]), [['sep 26', 'Septiembre 2026', 0], ['oct 26', 'Octubre 2026', 10], ['nov 26', 'Noviembre 2026', 20]]);
});

test('el tope del eje es un número redondo, y con pedidos es par y entero', () => {
  assert.equal(techoAgradable(0), 1);
  assert.equal(techoAgradable(0, { entero: true }), 2);
  assert.equal(techoAgradable(1_340_000), 1_500_000);
  assert.equal(techoAgradable(1_500_000), 1_500_000);
  assert.equal(techoAgradable(7), 8);
  assert.equal(techoAgradable(100), 100);
  for (const maximo of [1, 2, 3, 5, 7, 9, 11, 13, 29, 41, 99, 123]) {
    const techo = techoAgradable(maximo, { entero: true });
    assert.ok(techo >= maximo && techo % 2 === 0 && Number.isInteger(techo), `techo entero y par para ${maximo}: ${techo}`);
  }
  assert.equal(techoAgradable(Number.NaN), 1);
});

test('las columnas: altura proporcional, etiquetas espaciadas y a qué lado se abre el detalle', () => {
  const puntos = Array.from({ length: 30 }, (_, n) => ({ valor: n === 4 ? 400 : n === 10 ? 100 : 0, etiqueta: `${n + 1}/11`, tip: `día ${n + 1}` }));
  const g = armarGrafico(puntos, { formatoEje: (v) => `$${v}` });
  assert.equal(g.techo, 400);
  assert.deepEqual(g.ejes.map((e) => [e.texto, e.posicion]), [['$400', 100], ['$200', 50], ['$0', 0]]);
  assert.equal(g.anchoEje, 4);
  assert.equal(g.hueco, 3);
  assert.equal(g.columnas[4].alto, 100);
  assert.equal(g.columnas[10].alto, 25);
  assert.equal(g.columnas[0].alto, 0, 'sin ventas no hay columna');
  const conEtiqueta = g.columnas.map((c, n) => [n, c.etiqueta]).filter(([, e]) => e);
  assert.deepEqual(conEtiqueta.map(([n]) => n), [0, 5, 10, 15, 20, 25], 'una etiqueta cada cinco columnas');
  assert.equal(g.columnas.filter((c) => c.opcional).length, 2, 'de las etiquetas largas ("16/11", "26/11"), una de cada dos se oculta en pantallas angostas; las cortas ("6/11") se quedan');
  assert.deepEqual([g.columnas[0].lado, g.columnas[15].lado, g.columnas[29].lado], ['izq', 'centro', 'der']);
  const chico = armarGrafico([{ valor: 1, etiqueta: 'a', tip: '' }, { valor: 0.001, etiqueta: 'b', tip: '' }], { formatoEje: String });
  assert.ok(chico.columnas[1].alto >= 2.5, 'una columna con algo siempre se ve');
  assert.equal(chico.hueco, 12, 'con pocas columnas van más separadas');
});

test('los números se escriben como en Argentina', () => {
  assert.match(formatearPesos(125005000), /^\$\s1\.250\.050$/);
  assert.equal(formatearPesos(0).replace(/\s/g, ' '), '$ 0');
  assert.equal(formatearNumero(1250), '1.250');
  assert.equal(formatearNumero(2.5), '2,5');
  assert.equal(formatearCompacto(85000), '$ 850');
  assert.equal(formatearCompacto(1250000), '$ 12,5 mil');
  assert.equal(formatearCompacto(250000000), '$ 2,5 M');
  assert.equal(formatearPorcentaje(0.256), '26%');
  assert.equal(formatearDuracion(93600), '1 d 2 h');
  assert.equal(formatearDuracion(7500), '2 h 5 min');
  assert.equal(formatearDuracion(540), '9 min');
  assert.equal(formatearDuracion(20), 'menos de 1 min');
  assert.equal(formatearDuracion(86400), '1 d');
});

// ---------- Cuentas sobre la base ----------

test('ventas: solo cuentan los pedidos pagados, enviados y entregados; los nuevos van aparte y los cancelados no suman', async () => {
  const t = await totalesDelPeriodo(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(t.recibidos, 6);
  assert.equal(t.pedidos, 4);
  assert.equal(t.ventas, 7_150_000);
  assert.equal(t.productos, 7_000_000);
  assert.equal(t.descuentos, 450_000);
  assert.equal(t.envios, 600_000);
  assert.equal(t.productos - t.descuentos + t.envios, t.ventas, 'productos − descuentos + envíos = ventas');
  assert.equal(t.unidades, 6);
  assert.equal(t.clientes, 3, 'Ana cuenta una sola vez aunque escribió el teléfono de dos formas');
  assert.equal(t.ticket, 1_787_500);
  assert.equal(t.unidadesPorPedido, 1.5);
  assert.equal(t.cancelados, 1);
  assert.equal(t.montoCancelados, 3_000_000);
  assert.equal(t.tasaCancelacion, 1 / 6);
  assert.equal(t.porConfirmar, 1);
  assert.equal(t.montoPorConfirmar, 1_200_000);
  assert.equal(t.conDescuento, 3);
  assert.equal(t.envioGratis, 2);
  assert.equal(t.envioACoordinar, 0);
});

test('ventas: se compara con el período anterior', async () => {
  const anterior = await totalesDelPeriodo(db, A.tiendaId, TREINTA_DIAS.anterior);
  assert.deepEqual([anterior.pedidos, anterior.ventas, anterior.unidades, anterior.clientes], [1, 1_200_000, 1, 1]);
  const t = await totalesDelPeriodo(db, A.tiendaId, TREINTA_DIAS);
  const cambios = compararTotales(t, anterior);
  assert.equal(cambios.ventas.tipo, 'sube');
  assert.ok(Math.abs(cambios.ventas.porcentaje - (7_150_000 - 1_200_000) / 1_200_000) < 1e-9);
  assert.equal(cambios.clientes.tipo, 'sube');
});

test('el día es el argentino: un pedido de las 23:30 y otro de las 00:30 caen en días distintos', async () => {
  const dia = (d) => totalesDelPeriodo(db, A.tiendaId, { desde: d, hasta: d });
  const diecisiete = await dia('2026-11-17');
  const dieciocho = await dia('2026-11-18');
  assert.equal(diecisiete.pedidos, 1, 'el de las 02:30 UTC del 18 es del 17 a las 23:30');
  assert.equal(diecisiete.ventas, 2_850_000);
  assert.equal(dieciocho.pedidos, 1, 'el de las 03:30 UTC del 18 es del 18 a las 00:30');
  assert.equal(dieciocho.ventas, 1_200_000);

  const serie = await ventasPorDia(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(serie.length, 30);
  const con = serie.filter((d) => d.pedidos > 0).map((d) => [d.clave, d.ventas]);
  assert.deepEqual(con, [['2026-11-10', 2_100_000], ['2026-11-12', 1_000_000], ['2026-11-17', 2_850_000], ['2026-11-18', 1_200_000]]);
});

test('cuándo llegan los pedidos: por día de la semana y por hora argentina, sin cancelados', async () => {
  const m = await momentosDeCompra(db, A.tiendaId, TREINTA_DIAS);
  const dias = Object.fromEntries(m.porDiaDeLaSemana.map((d) => [d.nombre, d.pedidos]));
  assert.deepEqual(dias, { Lunes: 0, Martes: 2, Miércoles: 1, Jueves: 2, Viernes: 0, Sábado: 0, Domingo: 0 });
  assert.equal(m.porHora.length, 24);
  const horas = Object.fromEntries(m.porHora.filter((h) => h.pedidos).map((h) => [h.hora, h.pedidos]));
  assert.deepEqual(horas, { 0: 1, 9: 1, 11: 1, 12: 1, 23: 1 }, '00:30, 09:00 (el nuevo), 11:00, 12:00 y 23:30');
  assert.equal(m.porDiaDeLaSemana.reduce((s, d) => s + d.pedidos, 0), 5, 'el cancelado no cuenta');
  assert.equal(m.mejorDia.pedidos, 2);
  const vacio = await momentosDeCompra(db, A.tiendaId, { desde: '2026-01-01', hasta: '2026-01-02' });
  assert.deepEqual([vacio.mejorDia, vacio.mejorHora], [null, null]);
});

test('pedidos por estado, formas de pago, de entrega y lugares', async () => {
  const estados = await pedidosPorEstado(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(estados.map((e) => [e.estado, e.pedidos, e.monto]), [
    ['nuevo', 1, 1_200_000], ['pagado', 2, 3_850_000], ['enviado', 1, 1_200_000], ['entregado', 1, 2_100_000], ['cancelado', 1, 3_000_000],
  ]);
  assert.deepEqual(estados.map((e) => e.titulo), ['Nuevos', 'Pagados', 'Enviados', 'Entregados', 'Cancelados']);
  assert.ok(Math.abs(estados.reduce((s, e) => s + e.porcentaje, 0) - 1) < 1e-9);

  const pagos = await ventasPorPago(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(pagos.map((p) => [p.clave, p.pedidos, p.ventas, p.descuentos, p.ticket]), [
    ['transferencia', 2, 3_300_000, 300_000, 1_650_000], ['efectivo', 1, 2_850_000, 150_000, 2_850_000], ['mercadopago', 1, 1_000_000, 0, 1_000_000],
  ]);
  assert.equal(pagos[0].titulo, 'Transferencia bancaria');
  assert.ok(Math.abs(pagos[0].porcentaje - 3_300_000 / 7_150_000) < 1e-9);

  const entregas = await ventasPorEntrega(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(entregas.map((e) => [e.titulo, e.tipo, e.pedidos, e.ventas, e.envios]), [
    ['Retiro en el local', 'retiro', 2, 3_850_000, 0], ['Envío en moto', 'domicilio', 2, 3_300_000, 600_000],
  ]);

  const lugares = await ventasPorLugar(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(lugares.provincias.map((p) => [p.titulo, p.pedidos, p.ventas, p.clientes]), [['Córdoba', 1, 2_100_000, 1], ['Santa Fe', 1, 1_200_000, 1]], 'los retiros no tienen dirección');
  assert.deepEqual(lugares.ciudades.map((c) => [c.titulo, c.provincia]), [['Córdoba', 'Córdoba'], ['Rosario', 'Santa Fe']]);
});

test('clientes: nuevos y recurrentes, recompra y los que más compran (un cliente es un teléfono)', async () => {
  const c = await clientesDelPeriodo(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(c.activos, 3);
  assert.equal(c.nuevos, 1, 'Eli compró por primera vez en el período');
  assert.equal(c.recurrentes, 2, 'Ana y Beto ya habían comprado antes');
  assert.equal(c.total, 3);
  assert.equal(c.queVolvieron, 2);
  assert.equal(c.tasaRecompra, 2 / 3);
  assert.deepEqual(c.mejores.map((m) => [m.nombre, m.pedidos, m.total]), [['Ana', 2, 3_300_000], ['Beto', 1, 2_850_000], ['Eli', 1, 1_000_000]]);
  assert.equal(c.mejores[0].telefono, '+54 9 351 111 1111', 'el teléfono es el del último pedido');

  // Mirando solo el 12/11: Eli es nueva y nadie más compró.
  const dia = await clientesDelPeriodo(db, A.tiendaId, { desde: '2026-11-12', hasta: '2026-11-12' });
  assert.deepEqual([dia.activos, dia.nuevos, dia.recurrentes], [1, 1, 0]);
  assert.equal(dia.total, 3, 'hasta ese día ya habían comprado Beto, Ana y Eli');
  assert.equal(dia.queVolvieron, 1, 'y de ellos solo Ana había vuelto a comprar');
});

test('productos: lo más vendido por producto y variante, y las ventas por categoría de primer nivel', async () => {
  const v = await productosVendidos(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(v.distintos, 3);
  assert.deepEqual(v.porMonto.map((p) => [p.nombre, p.unidades, p.monto, p.pedidos]), [['Remera', 4, 4_000_000, 3], ['Buzo', 1, 2_500_000, 1], ['Gorra', 1, 500_000, 1]]);
  assert.deepEqual(v.porUnidades.map((p) => p.nombre), ['Remera', 'Buzo', 'Gorra'], 'a igual cantidad, primero el que más facturó');
  assert.ok(v.porMonto.every((p) => p.id > 0), 'enlaza a cada producto');
  assert.deepEqual(v.variantes.map((p) => [p.sku, p.detalle, p.unidades, p.monto]).sort(), [
    ['BUZ-M', 'Talle M', 1, 2_500_000], ['GOR', '', 1, 500_000], ['REM-M', 'Talle M', 2, 2_000_000], ['REM-S', 'Talle S', 2, 2_000_000],
  ].sort());
  assert.ok(Math.abs(v.porMonto[0].porcentaje - 4 / 7) < 1e-9);

  const sinVariantes = await productosVendidos(db, A.tiendaId, TREINTA_DIAS, { conVariantes: false });
  assert.deepEqual(sinVariantes.variantes, []);

  const categorias = await ventasPorCategoria(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(categorias.map((c) => [c.nombre, c.unidades, c.monto, c.pedidos]), [['Remeras', 4, 4_000_000, 3], ['Abrigos', 1, 2_500_000, 1], ['Sin categoría', 1, 500_000, 1]], 'Buzos suma en Abrigos');
});

test('productos: ventas por marca (solo las que se cargaron)', async () => {
  const marcas = await ventasPorMarca(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual(marcas.map((m) => [m.nombre, m.unidades, m.monto, m.pedidos]), [['Norte', 5, 6_500_000, 4], ['Sur', 1, 500_000, 1]]);
  assert.ok(Math.abs(marcas[0].porcentaje - 6.5 / 7) < 1e-9);
  assert.deepEqual(await ventasPorMarca(db, A.tiendaId, { desde: '2026-01-01', hasta: '2026-01-02' }), []);
});

test('productos: sin ventas en el período y cómo está armado el catálogo', async () => {
  const sin = await productosSinVentas(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(sin.total, 1);
  assert.deepEqual(sin.lista.map((p) => [p.nombre, p.unidades, p.valor]), [['Cinto', 40, 40 * 800_000]]);

  const c = await resumenDelCatalogo(db, A.tiendaId, TREINTA_DIAS);
  assert.deepEqual([c.total, c.visibles, c.ocultos, c.destacados, c.enOferta, c.sinFoto, c.sinCategoria, c.variantes, c.categorias], [4, 4, 0, 0, 1, 4, 2, 5, 3]);
  assert.equal(c.precioMinimo, 500_000);
  assert.equal(c.precioMaximo, 2_500_000, 'el precio de oferta es el vigente');
  assert.equal(c.precioPromedio, Math.round((1_000_000 + 1_000_000 + 2_500_000 + 500_000 + 800_000) / 5));
});

test('un producto borrado después de venderse sigue en las ventas, sin categoría', async () => {
  const D = await tiendaConCatalogo('tienda-borrado');
  await pedido(D.tiendaId, { items: [['REM-S', 2]], estado: 'pagado', creado: '2026-11-15 15:00:00' });
  await db.prepare("DELETE FROM productos WHERE tienda_id = ? AND nombre = 'Remera'").run(D.tiendaId);
  const v = await productosVendidos(db, D.tiendaId, TREINTA_DIAS);
  assert.deepEqual(v.porMonto.map((p) => [p.nombre, p.unidades, p.id]), [['Remera', 2, null]]);
  const categorias = await ventasPorCategoria(db, D.tiendaId, TREINTA_DIAS);
  assert.deepEqual(categorias.map((c) => [c.nombre, c.monto]), [['Sin categoría', 2_000_000]]);
});

test('un pedido con envío a coordinar cuenta como venta pero no suma envío', async () => {
  const G = await tiendaConCatalogo('tienda-coordinar');
  await pedido(G.tiendaId, { items: [['GOR', 2]], entrega: 'coordinar', provincia: 'Salta', ciudad: 'Salta', estado: 'pagado', creado: '2026-11-15 15:00:00' });
  const t = await totalesDelPeriodo(db, G.tiendaId, TREINTA_DIAS);
  assert.deepEqual([t.pedidos, t.envioACoordinar, t.envioGratis, t.envios], [1, 1, 0, 0]);
  assert.equal(t.ventas, 1_000_000 - 100_000, 'productos menos el descuento, sin el envío que todavía no se sabe');
  assert.equal(t.productos - t.descuentos, t.ventas);
});

test('pedidos demorados: lo que espera hace días, sin importar el período', async () => {
  const E = await tiendaConCatalogo('tienda-demora');
  const t = E.tiendaId;
  await pedido(t, { items: [['GOR', 1]], estado: 'nuevo', creado: '2026-11-15 15:00:00' }); // 4 días sin confirmar
  await pedido(t, { items: [['GOR', 1]], estado: 'nuevo', creado: '2026-11-19 10:00:00' }); // de hoy: no cuenta
  await pedido(t, { items: [['GOR', 1]], estado: 'pagado', creado: '2026-11-10 15:00:00', actualizado: '2026-11-12 15:00:00' }); // pagado hace 7 días
  await pedido(t, { items: [['GOR', 1]], estado: 'enviado', creado: '2026-11-01 15:00:00', actualizado: '2026-11-05 15:00:00' }); // enviado hace 14 días
  await pedido(t, { items: [['GOR', 1]], estado: 'enviado', creado: '2026-11-15 15:00:00', actualizado: '2026-11-16 15:00:00' }); // enviado hace 3 días: todavía no
  const d = await pedidosDemorados(db, t, AHORA);
  assert.deepEqual([d.nuevos, d.montoNuevos, d.pagados, d.enviados, d.hay], [1, 500_000 - 50_000 + 300_000, 1, 1, true]);
  // En la tienda A: el nuevo del 19/11 todavía no cumplió dos días; el pagado del 12/11 sí, y el enviado del 18/11 todavía no cumplió siete.
  const deA = await pedidosDemorados(db, A.tiendaId, AHORA);
  assert.deepEqual([deA.nuevos, deA.pagados, deA.enviados, deA.hay], [0, 1, 0, true]);
  const antes = await pedidosDemorados(db, A.tiendaId, new Date('2026-11-10T18:00:00Z'));
  assert.equal(antes.hay, false, 'diez días antes ningún pedido esperaba tanto');
});

test('stock: valor a precio de venta, lo que se acaba pronto y lo que no se mueve', async () => {
  const C = await tiendaConCatalogo('tienda-stock', [
    ['SKU', 'Nombre', 'Precio', 'Precio promocional', 'Stock', 'Atributo 1', 'Valor 1'],
    ['REM-S', 'Remera', 10000, null, 500, 'Talle', 'S'],
    ['REM-M', 'Remera', 10000, null, 500, 'Talle', 'M'],
    ['BUZ', 'Buzo', 30000, 25000, 500, null, null],
    ['GOR', 'Gorra', 5000, null, 500, null, null],
    ['CIN', 'Cinto', 8000, null, 500, null, null],
    ['MED', 'Medias', 3000, null, 500, null, null],
    ['AGO', 'Agotado', 1000, null, 0, null, null],
  ]);
  const t = C.tiendaId;
  // Gorra: 30 unidades en el último mes. Remera M: 3. Buzo: 1, pero hace más de tres meses. Cinto: solo un pedido cancelado.
  await pedido(t, { items: [['GOR', 30]], estado: 'entregado', creado: '2026-11-05 15:00:00' });
  await pedido(t, { items: [['REM-M', 3]], estado: 'pagado', creado: '2026-11-10 15:00:00' });
  await pedido(t, { items: [['BUZ', 1]], estado: 'entregado', creado: '2026-08-10 15:00:00' });
  await pedido(t, { items: [['CIN', 1]], estado: 'cancelado', creado: '2026-11-08 15:00:00' }); // cancelado: no es movimiento
  const stock = { 'REM-S': 0, 'REM-M': 600, GOR: 3, BUZ: 4, CIN: 40, MED: 10 };
  for (const [sku, s] of Object.entries(stock)) await db.prepare('UPDATE variantes SET stock = ? WHERE tienda_id = ? AND sku = ?').run(s, t, sku);
  // Los productos viejos (más de tres meses en el catálogo), menos Medias, que es nueva.
  await db.prepare("UPDATE productos SET creado_en = '2026-05-01 12:00:00' WHERE tienda_id = ?").run(t);
  await db.prepare("UPDATE productos SET creado_en = '2026-11-01 12:00:00' WHERE tienda_id = ? AND nombre = 'Medias'").run(t);

  const i = await inventario(db, t, AHORA);
  assert.equal(i.unidades, 0 + 600 + 3 + 4 + 40 + 10);
  assert.equal(i.valorAPrecioDeVenta, 600 * 1_000_000 + 3 * 500_000 + 4 * 2_500_000 + 40 * 800_000 + 10 * 300_000);
  assert.equal(i.valorAPrecioDeLista, i.valorAPrecioDeVenta + 4 * 500_000, 'el buzo está en oferta: a precio de lista vale más');
  assert.equal(i.variantes, 7);
  assert.equal(i.variantesSinStock, 2, 'la remera S y el producto agotado');
  assert.equal(i.variantesConPocas, 1, 'solo la gorra tiene 3 o menos');
  assert.equal(i.productosSinStock, 1, 'solo el agotado: la remera tiene stock en la M');
  assert.deepEqual(i.agotados.map((p) => [p.nombre, p.visible]), [['Agotado', 1]]);
  assert.deepEqual(i.pocas.map((v) => [v.nombre, v.stock, v.valores]), [['Gorra', 3, '']], 'con 3 o menos');

  assert.deepEqual(i.seAcaban.map((v) => [v.nombre, v.dias, v.stock, v.unidades]), [['Gorra', 3, 3, 30]], 'con 3 en stock y 30 vendidas en un mes, alcanza para 3 días');
  assert.ok(!i.seAcaban.some((v) => v.nombre === 'Remera'), 'la remera M tiene 600 y vendió 3: no se acaba');

  // Sin movimiento: el cinto (solo un pedido cancelado) y el buzo (su única venta fue hace más de 90 días), los de más valor primero.
  // La gorra y la remera se vendieron hace poco, y las medias son nuevas en el catálogo: todavía no se puede decir que no se mueven.
  assert.deepEqual(i.dormido.lista.map((p) => [p.nombre, p.unidades, p.valor]), [['Cinto', 40, 40 * 800_000], ['Buzo', 4, 4 * 2_500_000]]);
  assert.deepEqual([i.dormido.total, i.dormido.valor, i.dormido.dias], [2, 40 * 800_000 + 4 * 2_500_000, 90]);
  assert.deepEqual(i.masStock.map((p) => p.nombre).slice(0, 2), ['Remera', 'Cinto'], 'lo que más vale en stock');
});

test('un tienda sin pedidos ni productos no rompe ningún panel', async () => {
  const { tienda } = await crearTienda(db, { nombre: 'vacia', email: 'vacia@ejemplo.com' });
  for (const panel of ['resumen', 'ventas', 'pedidos', 'clientes', 'productos', 'stock']) {
    for (const periodo of ['hoy', '30d', 'todo', 'anio']) {
      const datos = await datosDashboard(db, tienda.id, { panel, periodo }, { hoy: HOY, ahora: AHORA });
      const vista = prepararVista(datos);
      assert.equal(vista.panel, panel);
      assert.ok(vista.enlaces.paneles.length === 6 && vista.enlaces.periodos.length === 8);
    }
  }
  const t = await totalesDelPeriodo(db, tienda.id, TREINTA_DIAS);
  assert.deepEqual([t.ventas, t.pedidos, t.ticket, t.clientes, t.unidades, t.tasaCancelacion], [0, 0, 0, 0, 0, 0]);
  assert.equal((await inventario(db, tienda.id, AHORA)).unidades, 0);
});

test('cada tienda ve solo lo suyo', async () => {
  const B = await tiendaConCatalogo('tienda-b');
  await pedido(B.tiendaId, { items: [['GOR', 2]], cliente: 'Otra Persona', telefono: '351 999 9999', estado: 'pagado', creado: '2026-11-17 15:00:00' });
  const b = await totalesDelPeriodo(db, B.tiendaId, TREINTA_DIAS);
  assert.deepEqual([b.pedidos, b.ventas, b.clientes], [1, 1_000_000 + 300_000 - 100_000, 1]);
  const a = await totalesDelPeriodo(db, A.tiendaId, TREINTA_DIAS);
  assert.equal(a.pedidos, 4, 'los pedidos de B no entran en A');
  const clientes = await clientesDelPeriodo(db, A.tiendaId, TREINTA_DIAS);
  assert.ok(!clientes.mejores.some((c) => c.nombre === 'Otra Persona'));
  const vendidos = await productosVendidos(db, B.tiendaId, TREINTA_DIAS);
  assert.deepEqual(vendidos.porMonto.map((p) => p.nombre), ['Gorra'], 'cada tienda tiene su propia Gorra');
  const categorias = await ventasPorCategoria(db, B.tiendaId, TREINTA_DIAS);
  assert.deepEqual(categorias.map((c) => c.nombre), ['Sin categoría']);
});

test('datosDashboard: cada panel calcula solo lo suyo, y un panel o período inventado cae en el de siempre', async () => {
  const resumen = await datosDashboard(db, A.tiendaId, { panel: 'resumen', periodo: '30d' }, { hoy: HOY, ahora: AHORA });
  assert.deepEqual(Object.keys(resumen).sort(), ['anteriores', 'cambios', 'demorados', 'estados', 'hoy', 'pagos', 'panel', 'periodo', 'productos', 'serie', 'totales', 'valoresRango']);
  assert.equal(resumen.productos.variantes.length, 0, 'el resumen no necesita las variantes');
  assert.equal(resumen.totales.ventas, 7_150_000);

  const stock = await datosDashboard(db, A.tiendaId, { panel: 'stock', periodo: '7d' }, { hoy: HOY, ahora: AHORA });
  assert.ok(stock.inventario && !stock.totales, 'el stock no depende de las ventas del período');

  const raro = await datosDashboard(db, A.tiendaId, { panel: 'otro', periodo: '1000d' }, { hoy: HOY, ahora: AHORA });
  assert.equal(raro.panel, 'resumen');
  assert.equal(raro.periodo.clave, '30d');

  const todo = await datosDashboard(db, A.tiendaId, { panel: 'ventas', periodo: 'todo' }, { hoy: HOY, ahora: AHORA });
  assert.equal(todo.periodo.desde, '2026-09-01', 'empieza el día del primer pedido (en hora argentina)');
  assert.equal(todo.cambios, null, 'sin período anterior no hay con qué comparar');
  assert.equal(todo.totales.pedidos, 6);
  assert.equal(todo.periodo.agrupar, 'semana');
  assert.ok(todo.serie.length > 10);

  const hoyResumen = await datosDashboard(db, A.tiendaId, { panel: 'resumen', periodo: 'hoy' }, { hoy: HOY, ahora: AHORA });
  assert.ok(hoyResumen.momentos, 'con un solo día, el resumen muestra los pedidos por hora');
  assert.equal(prepararVista(hoyResumen).graficos.horas.columnas.length, 24);
});

test('una base con pedidos en los límites de la zona horaria: el primer día de "Todo" es el argentino', async () => {
  const F = await tiendaConCatalogo('tienda-limite');
  await pedido(F.tiendaId, { items: [['GOR', 1]], estado: 'pagado', creado: '2026-11-02 01:30:00' }); // 1/11 a las 22:30
  const todo = await datosDashboard(db, F.tiendaId, { panel: 'resumen', periodo: 'todo' }, { hoy: HOY, ahora: AHORA });
  assert.equal(todo.periodo.desde, '2026-11-01');
  assert.equal(todo.totales.pedidos, 1);
});

// ---------- La card en el panel ----------

async function panelDe(tiendaId, email, clave) {
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  assert.equal((await nav.enviar('/admin/ingresar', { email, clave })).status, 302);
  return nav;
}

// Una tienda con pedidos de los últimos días (relativos a hoy, para que entren en cualquier período corto).
let H;
async function sembrarTiendaDelPanel() {
  H = await tiendaConCatalogo('tienda-panel');
  const ayer = sumarDias(hoy(), -1);
  const haceTres = sumarDias(hoy(), -3);
  await pedido(H.tiendaId, { items: [['REM-S', 2]], cliente: 'Clienta Visible', telefono: '351 700 7000', estado: 'pagado', creado: `${ayer} 15:00:00` });
  await pedido(H.tiendaId, { items: [['BUZ-M', 1]], cliente: 'Otro Cliente', telefono: '351 800 8000', pago: 'efectivo', entrega: 'retiro', estado: 'entregado', creado: `${haceTres} 15:00:00` });
  await db.prepare("UPDATE productos SET nombre = '<img src=x onerror=alert(1)>' WHERE tienda_id = ? AND nombre = 'Gorra'").run(H.tiendaId);
  await pedido(H.tiendaId, { items: [['GOR', 1]], cliente: 'Clienta Visible', telefono: '351 700 7000', estado: 'pagado', creado: `${ayer} 16:00:00` });
}

test('el Inicio trae la card Dashboard con el resumen de los últimos 30 días', async () => {
  const nav = await panelDe(H.tiendaId, H.email, H.clave);
  const respuesta = await nav.pedir('/admin/inicio');
  assert.equal(respuesta.status, 200);
  const html = await respuesta.text();
  assert.match(html, /<section class="tarjeta dashboard" id="dashboard" aria-labelledby="dashboard-titulo">/);
  assert.match(html, /<h2 id="dashboard-titulo">Dashboard<\/h2>/);
  assert.match(html, /<a href="\/admin\/inicio#dashboard" class="activa" aria-current="page">Resumen<\/a>/);
  assert.match(html, /<a href="\/admin\/inicio\?periodo=7d#dashboard">7 días<\/a>/);
  assert.match(html, /class="activa" aria-current="true">30 días<\/a>/);
  assert.match(html, /<a href="\/admin\/inicio\?panel=stock#dashboard">Stock<\/a>/);
  assert.match(html, /Ventas por día/);
  // Tres pedidos concretados: dos de ayer (21.000 y 7.500) y uno de hace tres días (23.750) = 52.250.
  assert.match(html, /<span class="dash-kpi-etiqueta">Pedidos<\/span>\s*<strong class="dash-kpi-valor">3<\/strong>/);
  assert.match(html, /<span class="dash-kpi-etiqueta">Ventas<\/span>\s*<strong class="dash-kpi-valor">\$\s52\.250<\/strong>/);
  assert.match(html, /Pedidos pagados, enviados y entregados/);
  assert.match(html, /Productos más vendidos/);
});

test('la card sigue estando después de los números y antes de los pasos', async () => {
  const nav = await panelDe(H.tiendaId, H.email, H.clave);
  const html = await (await nav.pedir('/admin/inicio')).text();
  assert.ok(html.indexOf('class="numeros"') < html.indexOf('id="dashboard"'));
  assert.ok(html.indexOf('id="dashboard"') < html.indexOf('class="inicio-columnas"'));
});

test('cada panel se pide por la URL y muestra lo suyo', async () => {
  const nav = await panelDe(H.tiendaId, H.email, H.clave);
  const pedir = async (consulta) => (await (await nav.pedir(`/admin/inicio?${consulta}`)).text());

  const ventas = await pedir('panel=ventas&periodo=7d');
  assert.match(ventas, /aria-current="page">Ventas<\/a>/);
  assert.match(ventas, /class="activa" aria-current="true">7 días<\/a>/);
  assert.match(ventas, /Envíos cobrados/);
  assert.match(ventas, /Pedidos por día de la semana/);
  assert.match(ventas, /Formas de pago/);
  assert.match(ventas, /Ver el detalle por día/);

  const pedidos = await pedir('panel=pedidos');
  assert.match(pedidos, /Pedidos según su estado/);
  assert.match(pedidos, /Tiempo hasta entregar/);

  const clientes = await pedir('panel=clientes');
  assert.match(clientes, /Tasa de recompra/);
  assert.match(clientes, /Los que más compran/);
  assert.match(clientes, /href="https:\/\/wa\.me\/5493517007000"/, 'WhatsApp a cada cliente');

  const productos = await pedir('panel=productos');
  assert.match(productos, /Más vendidos por facturación/);
  assert.match(productos, /Tu catálogo/);
  assert.match(productos, /Ventas por marca/);

  const stock = await pedir('panel=stock');
  assert.match(stock, /Valor del stock/);
  assert.match(stock, /Quedan pocas unidades/);
  assert.match(stock, /<h3>Sin stock<\/h3>/);
  assert.match(stock, /El stock de hoy/);
  assert.doesNotMatch(stock, /aria-label="Período"/, 'el stock no depende del período');
  assert.match(stock, /<a href="\/admin\/inicio\?panel=ventas#dashboard">Ventas<\/a>/);
});

test('la URL con algo raro vuelve al resumen de 30 días, y las fechas elegidas se validan', async () => {
  const nav = await panelDe(H.tiendaId, H.email, H.clave);
  const html = await (await nav.pedir('/admin/inicio?panel=hackeo&periodo=1000d')).text();
  assert.match(html, /aria-current="page">Resumen<\/a>/);
  assert.match(html, /class="activa" aria-current="true">30 días<\/a>/);

  const repetido = await nav.pedir('/admin/inicio?panel=ventas&panel=stock&periodo=7d&periodo=hoy');
  assert.equal(repetido.status, 200, 'un parámetro repetido no rompe nada');

  const bueno = await (await nav.pedir(`/admin/inicio?panel=ventas&periodo=rango&desde=${sumarDias(hoy(), -5)}&hasta=${hoy()}`)).text();
  assert.match(bueno, /<details class="dashboard-rango" open>/);
  assert.match(bueno, /Del \d+\/\d+\/\d{4} al \d+\/\d+\/\d{4}/);
  assert.doesNotMatch(bueno, /class="error-campo"/);

  const malo = await (await nav.pedir('/admin/inicio?panel=ventas&periodo=rango&desde=2026-11-10&hasta=2026-11-01')).text();
  assert.match(malo, /<p class="error-campo" role="alert">Elegí dos fechas válidas/);
  assert.match(malo, /class="activa" aria-current="true">30 días<\/a>/, 'con fechas inválidas se usa el período de siempre');

  const inyeccion = await (await nav.pedir('/admin/inicio?panel=ventas&periodo=rango&desde=%22%3E%3Cscript%3Ealert(1)%3C/script%3E&hasta=x')).text();
  assert.doesNotMatch(inyeccion, /<script>alert\(1\)<\/script>/);
});

test('lo que escribió el cliente de la tienda se muestra escapado', async () => {
  const nav = await panelDe(H.tiendaId, H.email, H.clave);
  const html = await (await nav.pedir('/admin/inicio?panel=productos')).text();
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const resumen = await (await nav.pedir('/admin/inicio')).text();
  assert.doesNotMatch(resumen, /<img src=x onerror/);
});

test('el Dashboard muestra solo los números de la tienda que ingresó', async () => {
  const nav = await panelDe(A.tiendaId, A.email, A.clave);
  const html = await (await nav.pedir('/admin/inicio?panel=clientes&periodo=todo')).text();
  assert.match(html, /\bBeto\b/);
  assert.doesNotMatch(html, /Clienta Visible|Otro Cliente|Otra Persona/);
  const productosA = await (await nav.pedir('/admin/inicio?panel=productos&periodo=todo')).text();
  assert.match(productosA, /Ventas por marca/);
  assert.match(productosA, /ranking-nombre">\s*Norte\s*</);
  const otra = await panelDe(H.tiendaId, H.email, H.clave);
  const htmlH = await (await otra.pedir('/admin/inicio?panel=clientes&periodo=todo')).text();
  assert.match(htmlH, /Clienta Visible/);
  const ajeno = htmlH.match(/\b(Beto|Ana|Eli)\b/);
  assert.equal(ajeno, null, ajeno && `se coló un cliente de otra tienda: ...${htmlH.slice(ajeno.index - 100, ajeno.index + 100)}...`);
});

test('el panel de productos muestra cuánto del plan se usó, si el plan tiene tope', async () => {
  const planId = await crearPlan(db, { nombre: 'Plan Chico', precioCentavos: 1500000, maxProductos: 10, maxFotos: null, maxBanners: null, activo: true });
  const { tienda, clave } = await crearTienda(db, { nombre: 'tienda-con-plan', email: 'conplan@ejemplo.com', planId });
  const { productos } = interpretarHoja([['SKU', 'Nombre', 'Precio', 'Stock'], ['A', 'Uno', 100, 1], ['B', 'Dos', 100, 1]]);
  await aplicarImportacion(db, tienda.id, productos);
  const nav = await panelDe(tienda.id, 'conplan@ejemplo.com', clave);
  const html = await (await nav.pedir('/admin/inicio?panel=productos')).text();
  assert.match(html, /Tu plan \(Plan Chico\)/);
  assert.match(html, /2 de 10 productos/);
  const sinPlan = await panelDe(H.tiendaId, H.email, H.clave);
  assert.doesNotMatch(await (await sinPlan.pedir('/admin/inicio?panel=productos')).text(), /Tu plan/, 'sin topes no hay nada que mostrar');
});

test('sin ingresar no se ve nada del Dashboard', async () => {
  const nav = crearNavegador(`http://127.0.0.1:${puerto}`);
  const respuesta = await nav.pedir('/admin/inicio?panel=ventas');
  assert.equal(respuesta.status, 302);
  assert.equal(respuesta.headers.get('location'), '/admin/ingresar');
});

test('una tienda nueva, sin pedidos, ve la card con avisos en vez de gráficos vacíos', async () => {
  const N = await tiendaConCatalogo('tienda-nueva', [['SKU', 'Nombre', 'Precio', 'Stock'], ['X', 'Cosa', 100, 5]]);
  const nav = await panelDe(N.tiendaId, N.email, N.clave);
  const html = await (await nav.pedir('/admin/inicio')).text();
  assert.match(html, /Todavía no hay ventas en este período/);
  assert.match(html, /No llegaron pedidos en este período/);
  assert.doesNotMatch(html, /<div class="grafico"/);
  for (const panel of ['ventas', 'pedidos', 'clientes', 'productos', 'stock']) {
    const r = await nav.pedir(`/admin/inicio?panel=${panel}&periodo=todo`);
    assert.equal(r.status, 200, `el panel ${panel} anda sin pedidos`);
  }
  const productos = await (await nav.pedir('/admin/inicio?panel=productos')).text();
  assert.doesNotMatch(productos, /Ventas por marca/, 'sin marcas cargadas no hay nada que mostrar');
});
