// Convierte a WebP (grande + miniaturas) las imágenes que se subieron antes de ese formato.
// Se puede correr las veces que haga falta. No borra los originales (salvo que se pida moverlos a un respaldo).
//
// Uso:
//   npm run migrar-imagenes -- --dry-run            muestra qué haría, sin escribir nada
//   npm run migrar-imagenes                         convierte todas las tiendas
//   npm run migrar-imagenes -- --tienda 3           solo una tienda
//   npm run migrar-imagenes -- --mover-originales   además, pasa los originales ya reemplazados a la carpeta de respaldo
//   npm run migrar-imagenes -- --mover-originales --respaldo /app/data/respaldo
import { parseArgs } from 'node:util';
import { cargarEnv, leerConfig } from '../src/config.js';
import { abrirBase } from '../src/db.js';
import { migrarImagenes } from '../src/migrar-imagenes.js';

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    tienda: { type: 'string' },
    'mover-originales': { type: 'boolean', default: false },
    respaldo: { type: 'string' },
  },
});
const tiendaId = values.tienda === undefined ? null : Number(values.tienda);
if (tiendaId !== null && !Number.isInteger(tiendaId)) {
  console.error('--tienda tiene que ser el número de la tienda, por ejemplo --tienda 3');
  process.exit(1);
}

try {
  cargarEnv();
  const config = leerConfig();
  const db = await abrirBase(config.urlBase);
  if (values['dry-run']) console.log('Simulación: no se escribe ningún archivo ni se cambia la base de datos.\n');
  const resumen = await migrarImagenes({
    db,
    dirSubidas: config.dirSubidas,
    tiendaId,
    dryRun: values['dry-run'],
    moverOriginales: values['mover-originales'],
    ...(values.respaldo ? { dirRespaldo: values.respaldo } : {}),
    log: (linea) => console.log(linea),
  });
  await db.cerrar();

  const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
  console.log(`\nRevisadas: ${resumen.revisadas}`);
  console.log(`${values['dry-run'] ? 'Para convertir' : 'Convertidas'}: ${resumen.convertidas}`);
  console.log(`${values['dry-run'] ? 'Para completar con miniaturas' : 'Completadas con miniaturas'}: ${resumen.soloMiniaturas}`);
  console.log(`Ya estaban al día: ${resumen.yaMigradas}`);
  if (!values['dry-run'] && resumen.bytesAntes > 0) console.log(`Peso: ${mb(resumen.bytesAntes)} MB → ${mb(resumen.bytesDespues)} MB`);
  if (resumen.movidas) console.log(`Originales movidos al respaldo: ${resumen.movidas}`);
  if (resumen.faltan.length) console.log(`\nArchivos que la base usa pero no existen (${resumen.faltan.length}):\n  ${resumen.faltan.join('\n  ')}`);
  if (resumen.ilegibles.length) console.log(`\nArchivos que no se pudieron leer o convertir (${resumen.ilegibles.length}):\n  ${resumen.ilegibles.join('\n  ')}`);
  if (resumen.faltan.length || resumen.ilegibles.length) process.exitCode = 2;
} catch (error) {
  console.error(`No se pudo migrar: ${error.message}`);
  process.exit(1);
}
