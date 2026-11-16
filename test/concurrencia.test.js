// Compras que llegan a la vez. Con PGlite (un solo hilo) este test no puede fallar por carreras; para probarlas de verdad
// corré los tests contra un PostgreSQL real: PRUEBAS_DATABASE_URL=postgres://... npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBase } from '../src/db.js';
import { crearTienda } from '../src/tiendas.js';
import { interpretarHoja } from '../src/importacion/interpretar.js';
import { aplicarImportacion } from '../src/importacion/aplicar.js';
import { crearPedido, ErrorDeStock } from '../src/pedidos.js';

const DATOS = {
  cliente: { nombre: 'Cliente de Prueba', telefono: '3511234567', email: '' },
  entrega: { tipo: 'retiro', nombre: 'Retiro en el local', descripcion: '', costo: 0, gratisDesde: null },
  direccion: { calle: '', piso: '', ciudad: '', provincia: '', cp: '', referencias: '' },
  pago: { clave: 'efectivo', descuento: 0 },
  notas: '',
};

async function tiendaConStock(stock) {
  const db = await abrirBase(':memory:');
  const { tienda } = await crearTienda(db, { nombre: 'Concurrencia', email: 'c@ejemplo.com' });
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock'],
    ['UNICO', 'Producto', 1000, stock],
  ]);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tienda.id, productos);
  return { db, tiendaId: tienda.id };
}

// Lanza `cuantos` pedidos de una unidad al mismo tiempo. Devuelve los que se hicieron y cuántos se rechazaron por falta de stock.
async function comprarATodos(db, tiendaId, cuantos) {
  const resultados = await Promise.all(
    Array.from({ length: cuantos }, () =>
      crearPedido(db, tiendaId, [{ sku: 'UNICO', cantidad: 1 }], DATOS).then(
        (pedido) => ({ pedido }),
        (error) => {
          if (!(error instanceof ErrorDeStock)) throw error;
          return { sinStock: true };
        },
      ),
    ),
  );
  return {
    pedidos: resultados.filter((r) => r.pedido).map((r) => r.pedido),
    rechazados: resultados.filter((r) => r.sinStock).length,
  };
}

test('20 compras a la vez de un producto con 5 unidades: se venden 5, no queda stock negativo ni se repiten números', async () => {
  const { db, tiendaId } = await tiendaConStock(5);
  const { pedidos, rechazados } = await comprarATodos(db, tiendaId, 20);

  assert.equal(pedidos.length, 5, 'se vende exactamente lo que había');
  assert.equal(rechazados, 15, 'el resto se rechaza por falta de stock');
  assert.deepEqual(pedidos.map((p) => p.numero).sort((a, b) => a - b), [1, 2, 3, 4, 5], 'los números de pedido son correlativos y no se repiten');
  assert.equal((await db.prepare('SELECT stock FROM variantes WHERE sku = ?').get('UNICO')).stock, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM pedido_items').get()).n, 5);
  await db.cerrar();
});

// Acá cada pedido es de un producto distinto, así que no comparten ninguna fila de stock: lo único que los ordena es el
// candado por tienda. Sin él, dos pedidos leen el mismo max(numero) y chocan en la restricción UNIQUE (tienda_id, numero).
test('20 compras a la vez de productos distintos: todas salen con número de pedido distinto', async () => {
  const db = await abrirBase(':memory:');
  const { tienda } = await crearTienda(db, { nombre: 'Concurrencia', email: 'c@ejemplo.com' });
  const { productos, errores } = interpretarHoja([
    ['SKU', 'Nombre', 'Precio', 'Stock'],
    ...Array.from({ length: 20 }, (_, i) => [`S-${i}`, `Producto ${i}`, 1000, 3]),
  ]);
  assert.deepEqual(errores, []);
  await aplicarImportacion(db, tienda.id, productos);

  const pedidos = await Promise.all(
    Array.from({ length: 20 }, (_, i) => crearPedido(db, tienda.id, [{ sku: `S-${i}`, cantidad: 1 }], DATOS)),
  );

  assert.deepEqual(pedidos.map((p) => p.numero).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(new Set(pedidos.map((p) => p.token)).size, 20);
  assert.equal((await db.prepare('SELECT sum(stock) AS n FROM variantes').get()).n, 40);
  await db.cerrar();
});
