// Datos de la landing (portada del dominio principal). Los planes salen de la base: lo que se edita en /plataforma/planes
// se ve en la landing en el acto, sin tocar el HTML. Acá se arma, a partir de cada plan, lo que muestra cada tarjeta.
import { listarPlanes, seOfrece, esAutoservicio } from './plataforma.js';
import { MAX_FOTOS } from './productos.js';
import { MAX_BANNERS } from './diseno.js';

const NUMERO = new Intl.NumberFormat('es-AR', { useGrouping: 'always' });
const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const PESOS_CON_CENTAVOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });

const pesos = (centavos) => (centavos % 100 === 0 ? PESOS : PESOS_CON_CENTAVOS).format(centavos / 100);
const cuantos = (n, singular, plural) => `${NUMERO.format(n)} ${n === 1 ? singular : plural}`;

// Un tope vacío (null) es "sin límite", pero fotos y banners tienen un máximo absoluto (ver limites.js).
function topes(plan) {
  const fotos = Math.min(MAX_FOTOS, plan.maxFotos ?? MAX_FOTOS);
  const banners = Math.min(MAX_BANNERS, plan.maxBanners ?? MAX_BANNERS);
  return [
    plan.maxProductos === null ? 'Productos sin tope' : `Hasta ${cuantos(plan.maxProductos, 'producto', 'productos')}`,
    plan.maxFotos === null || fotos === MAX_FOTOS ? `Hasta ${MAX_FOTOS} fotos por producto` : `${cuantos(fotos, 'foto', 'fotos')} por producto`,
    plan.maxBanners === null || banners === MAX_BANNERS ? `Hasta ${MAX_BANNERS} banners de bienvenida` : `${cuantos(banners, 'banner', 'banners')} de bienvenida`,
  ];
}

function descripcion(plan) {
  if (plan.diasPrueba) return 'Para conocer la plataforma y armar tu primera tienda.';
  if (plan.maxProductos === null) return 'Sin topes de catálogo, para negocios grandes o con necesidades propias.';
  if (plan.maxProductos <= 200) return 'Para arrancar a vender con un catálogo chico o mediano.';
  return 'Para negocios que ya venden y quieren seguir creciendo.';
}

function boton(plan) {
  if (plan.diasPrueba) return { texto: 'Empezar prueba', mensaje: `Hola, quiero empezar la prueba gratis de ${plan.diasPrueba} días de VEZZA Shop.` };
  if (plan.maxProductos === null) return { texto: 'Consultar', mensaje: `Hola, quiero consultar por el plan ${plan.nombre} de VEZZA Shop.` };
  return { texto: `Elegir ${plan.nombre}`, mensaje: `Hola, quiero contratar el plan ${plan.nombre} de VEZZA Shop.` };
}

const ordenar = (planes) => [...planes].sort((a, b) => a.precioCentavos - b.precioCentavos || a.nombre.localeCompare(b.nombre, 'es'));

// El precio como se muestra: { precio: '$ 12.900' | 'Gratis', unidad: '/ mes' | '7 días' | '' }.
export function precioDe(plan) {
  const gratis = plan.precioCentavos === 0;
  return { precio: gratis ? 'Gratis' : pesos(plan.precioCentavos), unidad: gratis ? (plan.diasPrueba ? `${plan.diasPrueba} días` : '') : '/ mes' };
}

// Las tarjetas de la sección Planes: solo los planes activos, del más barato al más caro. El destacado ("Recomendado") es el
// plan pago más barato, y solo si hay otros con quién compararlo.
// `pagos`: con los pagos en línea andando, los planes que se contratan solos llevan a /suscribirse (el resto, a WhatsApp).
export function armarPlanes(planes, { pagos = false } = {}) {
  const activos = ordenar(planes.filter(seOfrece));
  const destacado = activos.length > 1 ? activos.find((p) => p.precioCentavos > 0 && !p.diasPrueba) : undefined;
  return activos.map((plan) => {
    const gratis = plan.precioCentavos === 0;
    const items = topes(plan);
    if (plan.diasPrueba && !gratis) items.push(`${plan.diasPrueba} días de prueba`);
    if (plan.diasPrueba && plan.suspenderAlVencer) items.push('Al terminar, la tienda se pausa hasta que elijas un plan');
    if (!plan.diasPrueba) items.push('Todo lo del panel y la tienda');
    return {
      id: plan.id,
      nombre: plan.nombre,
      descripcion: descripcion(plan),
      ...precioDe(plan),
      items,
      destacado: plan === destacado,
      boton: boton(plan),
      href: pagos && esAutoservicio(plan) ? `/suscribirse?plan=${plan.id}` : null,
    };
  });
}

// Los precios para el bloque de datos estructurados (JSON-LD) de la página. El "<" va escapado para que nada cierre el <script>.
export function ofertasJsonLd(planes) {
  const ofertas = ordenar(planes.filter(seOfrece)).map((p) => ({ '@type': 'Offer', name: p.nombre, price: String(p.precioCentavos / 100), priceCurrency: 'ARS' }));
  return JSON.stringify(ofertas, null, 2).replaceAll('<', '\\u003c');
}

export async function datosLanding(db, { pagos = false } = {}) {
  let activos = [];
  try {
    activos = (await listarPlanes(db)).filter(seOfrece);
  } catch (error) {
    // Si la base falla, la portada igual se ve (sin las tarjetas de planes).
    console.error('Landing: no se pudieron leer los planes', error);
  }
  const planes = armarPlanes(activos, { pagos });
  return {
    planes,
    // A dónde llevan los botones "Probar gratis": al alta de la prueba, si se puede hacer sola.
    pruebaHref: planes.find((p) => p.href && p.precio === 'Gratis')?.href ?? null,
    hayPrueba: activos.some((p) => p.diasPrueba),
    ofertasJsonLd: ofertasJsonLd(activos),
  };
}
