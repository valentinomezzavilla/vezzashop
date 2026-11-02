// Cada tienda se ve en un subdominio del dominio principal: demo.vezzashop.com -> tienda "demo".
// El dominio principal (y www) es el del panel.

// Subdominios que no pueden ser tiendas: se usan para el panel u otros servicios.
export const SUBDOMINIOS_RESERVADOS = new Set(['www', 'admin', 'panel', 'api', 'app', 'mail']);

// Devuelve el slug de la tienda según el host, o null si es el dominio del panel.
// "demo.localhost" -> "demo"; "localhost", "www.localhost", "127.0.0.1" -> null
export function slugDeHost(hostname, dominio) {
  const host = String(hostname ?? '').toLowerCase();
  if (!dominio || !host.endsWith(`.${dominio}`)) return null;
  const slug = host.slice(0, -dominio.length - 1);
  return SUBDOMINIOS_RESERVADOS.has(slug) ? null : slug;
}

// El puerto con el que entró la visita (":3000" en local, "" detrás del proxy en producción).
const puertoDe = (req) => req.host.match(/:\d+$/)?.[0] ?? '';

export const urlPanel = (req, dominio) => `${req.protocol}://${dominio}${puertoDe(req)}`;
export const urlTienda = (req, dominio, slug) => `${req.protocol}://${slug}.${dominio}${puertoDe(req)}`;
