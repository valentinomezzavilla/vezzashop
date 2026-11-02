// Ajustes de cómo se ve la vidriera de cada tienda (sección Diseño del panel) y sus banners.
import { enTransaccion } from './db.js';
import { esOrden } from './vidriera.js';

export const MAX_BANNERS = 6;
const LARGO_FRANJA = 200;

const AJUSTES_POR_DEFECTO = {
  logo: null,
  colorPrincipal: '#1a1a1a',
  franjaTexto: '',
  descuentoTransferencia: 0,
  cuotasSinInteres: 0,
  ordenCatalogo: 'nombre',
  whatsapp: '',
  instagram: '',
  facebook: '',
  tiktok: '',
  emailContacto: '',
  direccion: '',
};

// Las claves de AJUSTES_POR_DEFECTO, como columnas de ajustes_tienda.
const COLUMNAS = {
  logo: 'logo',
  colorPrincipal: 'color_principal',
  franjaTexto: 'franja_texto',
  descuentoTransferencia: 'descuento_transferencia',
  cuotasSinInteres: 'cuotas_sin_interes',
  ordenCatalogo: 'orden_catalogo',
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  emailContacto: 'email_contacto',
  direccion: 'direccion',
};

export function leerAjustes(db, tiendaId) {
  const seleccion = Object.entries(COLUMNAS).map(([clave, columna]) => `${columna} AS ${clave}`).join(', ');
  const fila = db.prepare(`SELECT ${seleccion} FROM ajustes_tienda WHERE tienda_id = ?`).get(tiendaId);
  return { ...AJUSTES_POR_DEFECTO, ...fila };
}

export function guardarAjustes(db, tiendaId, ajustes) {
  const claves = Object.keys(COLUMNAS);
  const columnas = claves.map((clave) => COLUMNAS[clave]);
  db.prepare(
    `INSERT INTO ajustes_tienda (tienda_id, ${columnas.join(', ')}) VALUES (?, ${columnas.map(() => '?').join(', ')})
     ON CONFLICT (tienda_id) DO UPDATE SET ${columnas.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(tiendaId, ...claves.map((clave) => ajustes[clave]));
}

const texto = (valor) => String(valor ?? '').trim();

function entero(valor, minimo, maximo, mensaje) {
  const limpio = texto(valor);
  if (limpio === '') return { valor: 0 };
  const numero = Number(limpio);
  if (!Number.isInteger(numero) || numero < minimo || numero > maximo) return { error: mensaje };
  return { valor: numero };
}

const RED_SOCIAL = {
  instagram: (usuario) => `https://www.instagram.com/${usuario}`,
  facebook: (usuario) => `https://www.facebook.com/${usuario}`,
  tiktok: (usuario) => `https://www.tiktok.com/@${usuario}`,
};

// Acepta "@usuario", "usuario" o el link completo; guarda siempre el link.
function redSocial(red, valor) {
  const limpio = texto(valor);
  if (limpio === '') return { valor: '' };
  if (/^https?:\/\//i.test(limpio)) return URL.canParse(limpio) ? { valor: limpio } : { error: 'El link no es válido' };
  const usuario = limpio.replace(/^@/, '');
  if (!/^[\w.]{1,50}$/.test(usuario)) return { error: 'Escribí el usuario (por ejemplo @mitienda) o el link completo' };
  return { valor: RED_SOCIAL[red](usuario) };
}

// Valida lo que llega del formulario de Diseño. Devuelve { ajustes, errores }, errores = { campo: mensaje }.
// El logo no viene acá: se maneja aparte porque es un archivo.
export function validarAjustes(campos) {
  const errores = {};
  const ajustes = {};

  const color = texto(campos.colorPrincipal).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) ajustes.colorPrincipal = color;
  else errores.colorPrincipal = 'Elegí un color';

  ajustes.franjaTexto = texto(campos.franjaTexto).replace(/\s+/g, ' ');
  if (ajustes.franjaTexto.length > LARGO_FRANJA) errores.franjaTexto = `Máximo ${LARGO_FRANJA} caracteres`;

  const descuento = entero(campos.descuentoTransferencia, 0, 90, 'Tiene que ser un número entero entre 0 y 90');
  if (descuento.error) errores.descuentoTransferencia = descuento.error;
  else ajustes.descuentoTransferencia = descuento.valor;

  const cuotas = entero(campos.cuotasSinInteres, 0, 24, 'Tiene que ser un número entero entre 0 y 24');
  if (cuotas.error) errores.cuotasSinInteres = cuotas.error;
  else if (cuotas.valor === 1) errores.cuotasSinInteres = 'Poné 0 para no mostrar cuotas, o 2 o más';
  else ajustes.cuotasSinInteres = cuotas.valor;

  if (esOrden(texto(campos.ordenCatalogo))) ajustes.ordenCatalogo = texto(campos.ordenCatalogo);
  else errores.ordenCatalogo = 'Elegí un orden de la lista';

  const whatsapp = texto(campos.whatsapp).replace(/[\s\-+()]/g, '');
  if (whatsapp !== '' && !/^\d{8,15}$/.test(whatsapp)) {
    errores.whatsapp = 'Escribí el número con código de país y de área, solo números (por ejemplo 5493511234567)';
  } else {
    ajustes.whatsapp = whatsapp;
  }

  for (const red of Object.keys(RED_SOCIAL)) {
    const resultado = redSocial(red, campos[red]);
    if (resultado.error) errores[red] = resultado.error;
    else ajustes[red] = resultado.valor;
  }

  ajustes.emailContacto = texto(campos.emailContacto);
  if (ajustes.emailContacto !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ajustes.emailContacto)) {
    errores.emailContacto = 'El email no es válido';
  }

  ajustes.direccion = texto(campos.direccion);
  if (ajustes.direccion.length > 300) errores.direccion = 'Máximo 300 caracteres';

  return { ajustes, errores };
}

// Un link de banner puede ser una página de la tienda ("/categoria/ofertas") o una dirección completa.
export function validarEnlace(valor) {
  const enlace = texto(valor);
  if (enlace === '') return { valor: '' };
  if (enlace.startsWith('/') && !enlace.startsWith('//')) return { valor: enlace };
  if (/^https?:\/\//i.test(enlace) && URL.canParse(enlace)) return { valor: enlace };
  return { error: 'Tiene que ser una página de tu tienda (por ejemplo /categoria/ofertas) o un link que empiece con https://' };
}

// Texto que se lee bien sobre el color principal.
export function colorDeTextoSobre(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

export const precioConDescuento = (centavos, porcentaje) => Math.round((centavos * (100 - porcentaje)) / 100);
export const valorCuota = (centavos, cuotas) => Math.round(centavos / cuotas);

export function listarBanners(db, tiendaId) {
  return db
    .prepare(
      `SELECT id, imagen, imagen_movil AS imagenMovil, enlace, texto_alternativo AS textoAlternativo
       FROM banners WHERE tienda_id = ? ORDER BY orden, id`,
    )
    .all(tiendaId);
}

export function agregarBanner(db, tiendaId, { imagen, imagenMovil, enlace, textoAlternativo }) {
  db.prepare(
    `INSERT INTO banners (tienda_id, imagen, imagen_movil, enlace, texto_alternativo, orden)
     VALUES (?, ?, ?, ?, ?, (SELECT ifnull(max(orden), 0) + 1 FROM banners WHERE tienda_id = ?))`,
  ).run(tiendaId, imagen, imagenMovil, enlace, textoAlternativo, tiendaId);
}

// Intercambia el banner con el anterior (-1) o el siguiente (+1).
export function moverBanner(db, tiendaId, id, direccion) {
  return enTransaccion(db, () => {
    const banners = db.prepare('SELECT id, orden FROM banners WHERE tienda_id = ? ORDER BY orden, id').all(tiendaId);
    const i = banners.findIndex((b) => b.id === id);
    const j = i + direccion;
    if (i === -1 || j < 0 || j >= banners.length) return;
    const actualizar = db.prepare('UPDATE banners SET orden = ? WHERE id = ?');
    // Se renumeran todos, por si había órdenes repetidos.
    [banners[i], banners[j]] = [banners[j], banners[i]];
    banners.forEach((banner, n) => actualizar.run(n + 1, banner.id));
  });
}

// Devuelve el banner borrado (para borrar sus archivos) o null si no es de esta tienda.
export function borrarBanner(db, tiendaId, id) {
  return (
    db
      .prepare('DELETE FROM banners WHERE id = ? AND tienda_id = ? RETURNING imagen, imagen_movil AS imagenMovil')
      .get(id, tiendaId) ?? null
  );
}
