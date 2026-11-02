import { cargarEnv, leerConfig } from './config.js';
import { abrirBase } from './db.js';
import { crearApp } from './app.js';
import { listarTiendas } from './tiendas.js';

const archivoEnv = cargarEnv();
const config = leerConfig();
const db = abrirBase(config.rutaBase);

crearApp({ db, config }).listen(config.puerto, () => {
  console.log(`Panel: http://${config.dominio}:${config.puerto}/admin`);
  for (const tienda of listarTiendas(db)) {
    console.log(`Tienda "${tienda.nombre}": http://${tienda.slug}.${config.dominio}:${config.puerto}`);
  }
  console.log(`Configuración: ${archivoEnv ?? 'variables de entorno (sin archivo .env)'}`);
  console.log(`Base de datos: ${config.rutaBase}`);
});
