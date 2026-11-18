// Crea los planes sugeridos (Prueba, Esencial, Acompañado y A medida) si todavía no existen. No toca los que ya hay.
// Después los ajustás en /plataforma/planes: los precios son un punto de partida.
// Uso: npm run cargar-planes
import { cargarEnv, leerConfig } from '../src/config.js';
import { abrirBase } from '../src/db.js';
import { cargarPlanesSugeridos, PLANES_SUGERIDOS } from '../src/plataforma.js';
import { formatearPrecio } from '../src/util/formato.js';

try {
  cargarEnv();
  const db = await abrirBase(leerConfig().urlBase);
  const { creados, existentes } = await cargarPlanesSugeridos(db);
  const tope = (valor) => (valor === null ? 'sin tope' : valor);
  for (const plan of PLANES_SUGERIDOS) {
    if (!creados.includes(plan.nombre)) {
      console.log(`ya existía  ${plan.nombre} (no se toca: lo que editaste queda como está)`);
      continue;
    }
    const hecho = 'creado     ';
    const precio = plan.precioCentavos ? `${formatearPrecio(plan.precioCentavos)}/mes` : 'gratis';
    console.log(`${hecho}  ${plan.nombre.padEnd(11)} ${precio.padEnd(22)} productos: ${String(tope(plan.maxProductos)).padEnd(8)} fotos: ${String(tope(plan.maxFotos)).padEnd(8)} banners: ${String(tope(plan.maxBanners)).padEnd(8)} ${plan.diasPrueba ? `prueba: ${plan.diasPrueba} días${plan.suspenderAlVencer ? ', cierra al vencer' : ''}` : ''}`.trimEnd());
  }
  console.log(`\n${creados.length} creados, ${existentes.length} ya existían. Los ves y los editás en /plataforma/planes.`);
  await db.cerrar();
} catch (error) {
  console.error(`No se pudo: ${error.message}`);
  process.exit(1);
}
