import { cargarEnv, leerConfig } from './config.js';
import { abrirBase } from './db.js';
import { crearApp } from './app.js';

const archivoEnv = cargarEnv();
const config = leerConfig();
const db = abrirBase(config.rutaBase);

crearApp({ db, config }).listen(config.puerto, () => {
  console.log(`Panel: http://localhost:${config.puerto}/admin`);
  console.log(`Configuración: ${archivoEnv ?? 'variables de entorno (sin archivo .env)'}`);
  console.log(`Base de datos: ${config.rutaBase}`);
});
