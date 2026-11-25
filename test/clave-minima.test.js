// La clave mínima de una tienda es de 6 caracteres (la de quien administra la plataforma sigue en 12) y el medidor del alta la acompaña.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { abrirBase } from '../src/db.js';
import { LARGO_MINIMO_CLAVE } from '../src/tiendas.js';
import { LARGO_MINIMO_CLAVE_SUPERADMIN } from '../src/plataforma.js';
import { validarCuenta } from '../src/suscripciones.js';

const CAMPOS = { nombre: 'Ana', apellido: 'Pérez', email: 'ana@correo.com', nombreTienda: 'Casa Ana' };

test('el mínimo de una tienda es 6 y el del superadmin sigue siendo 12', () => {
  assert.equal(LARGO_MINIMO_CLAVE, 6);
  assert.equal(LARGO_MINIMO_CLAVE_SUPERADMIN, 12);
});

test('el formulario de alta acepta 6 caracteres y rechaza 5', async () => {
  const db = await abrirBase(':memory:');
  const corta = await validarCuenta(db, { ...CAMPOS, clave: 'abcde', claveRepetida: 'abcde' });
  assert.match(corta.errores.clave, /al menos 6 caracteres/);
  const justa = await validarCuenta(db, { ...CAMPOS, clave: 'abcdef', claveRepetida: 'abcdef' });
  assert.equal(justa.errores.clave, undefined);
  assert.deepEqual(justa.errores, {});
  const distinta = await validarCuenta(db, { ...CAMPOS, clave: 'abcdef', claveRepetida: 'abcdeg' });
  assert.match(distinta.errores.claveRepetida, /no coinciden/);
  await db.cerrar();
});

// Corre el script del alta con un DOM de mentira y devuelve lo que muestra el medidor para cada clave escrita.
function medirClaves(claves) {
  const codigo = readFileSync(path.join(import.meta.dirname, '..', 'src', 'publico', 'alta.js'), 'utf8');
  const entrada = { value: '', escuchas: {}, getAttribute: () => '6', addEventListener(evento, fn) { this.escuchas[evento] = fn; } };
  const medidor = { nivel: null, setAttribute(nombre, valor) { if (nombre === 'data-nivel') this.nivel = valor; }, style: { setProperty() {} } };
  const texto = { textContent: '' };
  const elementos = { clave: entrada };
  const documento = {
    getElementById: (id) => elementos[id] ?? null,
    querySelector: (selector) => (selector === '[data-fuerza]' ? medidor : selector === '[data-fuerza-texto]' ? texto : null),
    querySelectorAll: () => [],
    body: { appendChild() {} },
  };
  // "Reducir movimiento" activo: el script corta después del medidor y del link de la tienda, que es lo que se prueba.
  const ventana = { matchMedia: () => ({ matches: true }), innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1 };
  vm.runInNewContext(codigo, { window: ventana, document: documento, console });
  return claves.map((clave) => {
    entrada.value = clave;
    entrada.escuchas.input();
    return [clave, medidor.nivel, texto.textContent];
  });
}

test('el medidor de fuerza de la clave: muy corta, aceptable, buena y muy buena', () => {
  assert.deepEqual(medirClaves(['', 'abc', 'abcde', 'abcdef', 'abcdefgh', 'abcd1234', 'Abcd1234!xyz']), [
    ['', '0', ''],
    ['abc', '1', 'Muy corta'],
    ['abcde', '1', 'Muy corta'],
    ['abcdef', '2', 'Aceptable'],
    ['abcdefgh', '2', 'Aceptable'], // 8 caracteres pero de un solo tipo
    ['abcd1234', '3', 'Buena'],
    ['Abcd1234!xyz', '4', 'Muy buena'],
  ]);
});
