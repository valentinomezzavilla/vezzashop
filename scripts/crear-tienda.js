// Da de alta una tienda nueva con su usuario dueño y muestra la clave una sola vez.
// Uso: npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com
import { parseArgs } from 'node:util';
import { cargarEnv, leerConfig } from '../src/config.js';
import { abrirBase } from '../src/db.js';
import { crearTienda } from '../src/tiendas.js';

const { values } = parseArgs({ options: { nombre: { type: 'string' }, email: { type: 'string' } } });
if (!values.nombre || !values.email) {
  console.error('Uso: npm run crear-tienda -- --nombre "Mi Tienda" --email duenio@ejemplo.com');
  process.exit(1);
}

try {
  cargarEnv();
  const db = abrirBase(leerConfig().rutaBase);
  const { tienda, email, clave } = await crearTienda(db, values);
  console.log(`Tienda creada: ${tienda.nombre} (id ${tienda.id})`);
  console.log(`Usuario:       ${email}`);
  console.log(`Clave:         ${clave}`);
  console.log('Guardá la clave ahora: no se vuelve a mostrar.');
} catch (error) {
  console.error(`No se pudo crear la tienda: ${error.message}`);
  process.exit(1);
}
