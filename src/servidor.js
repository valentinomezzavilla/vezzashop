import { cargarEnv, leerConfig } from './config.js';
import { abrirBase, describirBase } from './db.js';
import { crearApp } from './app.js';
import { listarTiendas } from './tiendas.js';

const archivoEnv = cargarEnv();
const config = leerConfig();
const db = await abrirBase(config.urlBase);

crearApp({ db, config }).listen(config.puerto, async () => {
  console.log(`Panel: http://${config.dominio}:${config.puerto}/admin`);
  for (const tienda of await listarTiendas(db)) {
    console.log(`Tienda "${tienda.nombre}": http://${tienda.slug}.${config.dominio}:${config.puerto}`);
  }
  console.log(`Configuración: ${archivoEnv ?? 'variables de entorno (sin archivo .env)'}`);
  console.log(`Base de datos: ${describirBase(config.urlBase)}`);
});
