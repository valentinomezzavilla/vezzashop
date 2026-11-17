// Crea tu cuenta de superadministrador (o le genera una clave nueva si ya existe y se olvidó).
// Uso:
//   npm run crear-superadmin -- --email vos@ejemplo.com
//   npm run crear-superadmin -- --email vos@ejemplo.com --resetear
// Después entrás en https://<tu dominio>/plataforma
import { parseArgs } from 'node:util';
import { cargarEnv, leerConfig } from '../src/config.js';
import { abrirBase } from '../src/db.js';
import { crearSuperadmin, resetearClaveSuperadmin } from '../src/plataforma.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, resetear: { type: 'boolean', default: false } } });
if (!values.email) {
  console.error('Uso: npm run crear-superadmin -- --email vos@ejemplo.com [--resetear]');
  process.exit(1);
}

try {
  cargarEnv();
  const db = await abrirBase(leerConfig().urlBase);
  const { email, clave } = values.resetear ? await resetearClaveSuperadmin(db, values.email) : await crearSuperadmin(db, { email: values.email });
  console.log(values.resetear ? 'Clave nueva generada.' : 'Superadministrador creado.');
  console.log(`Usuario: ${email}`);
  console.log(`Clave:   ${clave}`);
  console.log('Guardá la clave ahora: no se vuelve a mostrar. Entrá en /plataforma y cambiala desde "Mi cuenta".');
  await db.cerrar();
} catch (error) {
  console.error(`No se pudo: ${error.message}`);
  process.exit(1);
}
