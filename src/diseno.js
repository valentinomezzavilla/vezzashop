// Ajustes de cómo se ve la vidriera de cada tienda (sección Diseño del panel) y sus banners.
import { enTransaccion } from './db.js';
import { esOrden } from './vidriera.js';

export const MAX_BANNERS = 6;
const LARGO_FRANJA = 200;

// Cómo se muestra el menú de categorías y el tamaño del logo (alto en la cabecera, en px).
export const ESTILOS_MENU = {
  barra: { titulo: 'Barra de categorías', ayuda: 'Las categorías van en una barra arriba. Las que no entran pasan solas a un botón "Más".' },
  desplegable: { titulo: 'Menú desplegable', ayuda: 'Un botón de menú abre la lista de categorías. Queda más limpio si tenés muchas.' },
};
export const TAMANOS_LOGO = {
  chico: { titulo: 'Chico', alto: 32 },
  mediano: { titulo: 'Mediano', alto: 40 },
  grande: { titulo: 'Grande', alto: 56 },
};

// Tipografía de la vidriera. 'sistema' es la de siempre (San Francisco en Apple, Inter en el resto) y no descarga nada;
// las otras se piden a Google Fonts solo cuando la tienda las elige. `titulos` y `texto` son los valores de --fuente-titulos y
// --fuente-texto (texto: null deja la del sistema).
const SIN_SERIFA = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const FUENTES = {
  sistema: { titulo: 'Del sistema', ayuda: 'La letra de cada dispositivo. Carga al instante.', google: null },
  moderna: { titulo: 'Moderna', ayuda: 'Poppins: redonda y amable.', google: 'Poppins:wght@400;500;600;700', titulos: `"Poppins", ${SIN_SERIFA}`, texto: `"Poppins", ${SIN_SERIFA}` },
  elegante: { titulo: 'Elegante', ayuda: 'Títulos con serifa (Playfair Display) y texto limpio.', google: 'Playfair+Display:wght@600;700', titulos: '"Playfair Display", Georgia, "Times New Roman", serif', texto: null },
  geometrica: { titulo: 'Geométrica', ayuda: 'Montserrat: firme y de líneas rectas.', google: 'Montserrat:wght@400;500;600;700', titulos: `"Montserrat", ${SIN_SERIFA}`, texto: `"Montserrat", ${SIN_SERIFA}` },
  suave: { titulo: 'Suave', ayuda: 'Nunito: terminaciones redondeadas, cercana.', google: 'Nunito:wght@400;500;600;700', titulos: `"Nunito", ${SIN_SERIFA}`, texto: `"Nunito", ${SIN_SERIFA}` },
};

// Redondeo de botones, tarjetas y fotos (en px). 'redondeadas' son los valores de tienda.css.
export const ESQUINAS = {
  redondeadas: { titulo: 'Redondeadas', ayuda: 'Botones en forma de píldora y tarjetas bien redondeadas.', radios: null },
  suaves: { titulo: 'Suaves', ayuda: 'Esquinas apenas redondeadas.', radios: { chico: 6, medio: 8, grande: 12, foto: 8, boton: 10 } },
  rectas: { titulo: 'Rectas', ayuda: 'Todo con esquinas en ángulo recto.', radios: { chico: 0, medio: 0, grande: 0, foto: 0, boton: 0 } },
};

// Tamaño de las tarjetas de producto: cuántas entran por fila en la tableta y en la computadora. En el celular son siempre 2.
export const TARJETAS = {
  chicas: { titulo: 'Chicas', ayuda: 'Más productos a la vista: 5 por fila en la computadora.', columnas: { media: 4, ancha: 5 } },
  normales: { titulo: 'Normales', ayuda: '4 por fila en la computadora.', columnas: null },
  grandes: { titulo: 'Grandes', ayuda: 'Fotos más grandes: 3 por fila en la computadora.', columnas: { media: 2, ancha: 3 } },
};

const AJUSTES_POR_DEFECTO = {
  logo: null,
  menuEstilo: 'barra',
  logoTamano: 'mediano',
  colorPrincipal: '#1a1a1a',
  franjaTexto: '',
  colorFranja: '', // '' = el color principal
  franjaEnlace: '',
  fuente: 'sistema',
  esquinas: 'redondeadas',
  tarjetas: 'normales',
  tituloDestacados: 'Destacados',
  tituloCatalogo: 'Todos los productos',
  descuentoTransferencia: 0,
  cuotasSinInteres: 0,
  ordenCatalogo: 'nombre',
  descripcion: '',
  whatsapp: '',
  instagram: '',
  facebook: '',
  tiktok: '',
  emailContacto: '',
  direccion: '',
  direccionMapa: '',
  horarios: '',
  notaPie: '',
  // Formas de pago (sección Envíos y pagos del panel).
  pagoTransferencia: false,
  transferenciaAlias: '',
  transferenciaCbu: '',
  transferenciaTitular: '',
  transferenciaBanco: '',
  pagoEfectivo: false,
  descuentoEfectivo: 0,
  pagoMercadopago: false,
  mercadopagoInstrucciones: '',
};

// Ajustes que en la base son 0/1.
const BOOLEANOS = new Set(['pagoTransferencia', 'pagoEfectivo', 'pagoMercadopago']);

// Las claves de AJUSTES_POR_DEFECTO, como columnas de ajustes_tienda.
const COLUMNAS = {
  logo: 'logo',
  menuEstilo: 'menu_estilo',
  logoTamano: 'logo_tamano',
  colorPrincipal: 'color_principal',
  franjaTexto: 'franja_texto',
  colorFranja: 'color_franja',
  franjaEnlace: 'franja_enlace',
  fuente: 'fuente',
  esquinas: 'esquinas',
  tarjetas: 'tarjetas',
  tituloDestacados: 'titulo_destacados',
  tituloCatalogo: 'titulo_catalogo',
  descripcion: 'descripcion',
  direccionMapa: 'direccion_mapa',
  horarios: 'horarios',
  notaPie: 'nota_pie',
  descuentoTransferencia: 'descuento_transferencia',
  cuotasSinInteres: 'cuotas_sin_interes',
  ordenCatalogo: 'orden_catalogo',
  whatsapp: 'whatsapp',
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  emailContacto: 'email_contacto',
  direccion: 'direccion',
  pagoTransferencia: 'pago_transferencia',
  transferenciaAlias: 'transferencia_alias',
  transferenciaCbu: 'transferencia_cbu',
  transferenciaTitular: 'transferencia_titular',
  transferenciaBanco: 'transferencia_banco',
  pagoEfectivo: 'pago_efectivo',
  descuentoEfectivo: 'descuento_efectivo',
  pagoMercadopago: 'pago_mercadopago',
  mercadopagoInstrucciones: 'mercadopago_instrucciones',
};

export async function leerAjustes(db, tiendaId) {
  const seleccion = Object.entries(COLUMNAS).map(([clave, columna]) => `${columna} AS "${clave}"`).join(', ');
  const fila = await db.prepare(`SELECT ${seleccion} FROM ajustes_tienda WHERE tienda_id = ?`).get(tiendaId);
  const ajustes = { ...AJUSTES_POR_DEFECTO, ...fila };
  for (const clave of BOOLEANOS) ajustes[clave] = Boolean(ajustes[clave]);
  return ajustes;
}

// Guarda solo algunos ajustes y deja el resto como estaba: cada sección del panel guarda los suyos.
export async function actualizarAjustes(db, tiendaId, cambios) {
  await guardarAjustes(db, tiendaId, { ...(await leerAjustes(db, tiendaId)), ...cambios });
}

export async function guardarAjustes(db, tiendaId, ajustes) {
  const claves = Object.keys(COLUMNAS);
  const columnas = claves.map((clave) => COLUMNAS[clave]);
  await db.prepare(
    `INSERT INTO ajustes_tienda (tienda_id, ${columnas.join(', ')}) VALUES (?, ${columnas.map(() => '?').join(', ')})
     ON CONFLICT (tienda_id) DO UPDATE SET ${columnas.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(tiendaId, ...claves.map((clave) => (BOOLEANOS.has(clave) ? Number(Boolean(ajustes[clave])) : ajustes[clave])));
}

const texto = (valor) => String(valor ?? '').trim();

export function entero(valor, minimo, maximo, mensaje) {
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
// El logo no viene acá: se maneja aparte porque es un archivo. Los descuentos y las cuotas son de Envíos y pagos.
export function validarAjustes(campos) {
  const errores = {};
  const ajustes = {};

  const color = texto(campos.colorPrincipal).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) ajustes.colorPrincipal = color;
  else errores.colorPrincipal = 'Elegí un color';

  ajustes.franjaTexto = texto(campos.franjaTexto).replace(/\s+/g, ' ');
  if (ajustes.franjaTexto.length > LARGO_FRANJA) errores.franjaTexto = `Máximo ${LARGO_FRANJA} caracteres`;

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

  // Lo nuevo de Diseño: si un campo no viene, el ajuste queda como estaba (otro formulario, o uno anterior a estas opciones).
  const opcion = (campo, opciones, mensaje = 'Elegí una de las opciones') => {
    if (campos[campo] === undefined) return;
    if (Object.hasOwn(opciones, texto(campos[campo]))) ajustes[campo] = texto(campos[campo]);
    else errores[campo] = mensaje;
  };
  opcion('fuente', FUENTES);
  opcion('esquinas', ESQUINAS);
  opcion('tarjetas', TARJETAS);

  // Un texto de una línea (se juntan los espacios y los saltos). Vacío es válido; con `porDefecto`, vacío vuelve al texto de siempre.
  const linea = (campo, maximo, { porDefecto } = {}) => {
    if (campos[campo] === undefined) return;
    const valor = texto(campos[campo]).replace(/\s+/g, ' ');
    if (valor.length > maximo) errores[campo] = `Máximo ${maximo} caracteres`;
    else ajustes[campo] = valor === '' && porDefecto !== undefined ? porDefecto : valor;
  };
  linea('tituloDestacados', 60, { porDefecto: AJUSTES_POR_DEFECTO.tituloDestacados });
  linea('tituloCatalogo', 60, { porDefecto: AJUSTES_POR_DEFECTO.tituloCatalogo });
  linea('horarios', 150);
  linea('notaPie', 300);
  if (campos.descripcion !== undefined) {
    ajustes.descripcion = texto(campos.descripcion).replace(/\s+/g, ' ');
    if (ajustes.descripcion.length > 300) errores.descripcion = 'Máximo 300 caracteres';
  }

  // Los links son opcionales: una página de la tienda o una dirección completa.
  for (const [campo, etiqueta] of [['franjaEnlace', 'Link de la franja'], ['direccionMapa', 'Link del mapa']]) {
    if (campos[campo] === undefined) continue;
    const enlace = validarEnlace(campos[campo]);
    if (enlace.error) errores[campo] = `${etiqueta}: ${enlace.error}`;
    else ajustes[campo] = enlace.valor;
  }

  // Color de la franja: solo vale si se marcó "usar otro color"; si no, la franja usa el color principal.
  if (campos.colorFranja !== undefined || campos.franjaColorPropio !== undefined) {
    if (!campos.franjaColorPropio) ajustes.colorFranja = '';
    else if (/^#[0-9a-f]{6}$/.test(texto(campos.colorFranja).toLowerCase())) ajustes.colorFranja = texto(campos.colorFranja).toLowerCase();
    else errores.colorFranja = 'Elegí un color';
  }

  // Cabecera: si el campo no viene, el ajuste queda como estaba (otro formulario, o uno anterior a estas opciones).
  if (campos.menuEstilo !== undefined) {
    if (Object.hasOwn(ESTILOS_MENU, texto(campos.menuEstilo))) ajustes.menuEstilo = texto(campos.menuEstilo);
    else errores.menuEstilo = 'Elegí una de las opciones';
  }
  if (campos.logoTamano !== undefined) {
    if (Object.hasOwn(TAMANOS_LOGO, texto(campos.logoTamano))) ajustes.logoTamano = texto(campos.logoTamano);
    else errores.logoTamano = 'Elegí una de las opciones';
  }

  return { ajustes, errores };
}

// Las categorías de primer nivel que aparecen en el menú de arriba de la tienda.
// `ids` son las que se marcaron (cualquier valor que venga del formulario: se descarta lo que no sea de la tienda).
export async function guardarCategoriasEnMenu(db, tiendaId, ids) {
  const marcadas = [...new Set([ids].flat().map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  await db
    .prepare(
      `UPDATE categorias SET en_menu = CASE WHEN id = ANY(?::int[]) THEN 1 ELSE 0 END
       WHERE tienda_id = ? AND padre_id IS NULL`,
    )
    .run(marcadas, tiendaId);
}

// Un link de banner puede ser una página de la tienda ("/categoria/ofertas") o una dirección completa.
export function validarEnlace(valor) {
  const enlace = texto(valor);
  if (enlace === '') return { valor: '' };
  if (enlace.startsWith('/') && !enlace.startsWith('//')) return { valor: enlace };
  if (/^https?:\/\//i.test(enlace) && URL.canParse(enlace)) return { valor: enlace };
  return { error: 'Tiene que ser una página de tu tienda (por ejemplo /categoria/ofertas) o un link que empiece con https://' };
}

// Lo que la vidriera pone en el <head> a partir de los ajustes: las variables CSS que pisan las de tienda.css y la hoja de
// Google Fonts (solo si la tienda eligió una tipografía que no es la del sistema). Con los valores por defecto no agrega nada.
// Todo sale de las constantes de arriba o de colores ya validados (#rrggbb), así que se puede imprimir tal cual.
export function estiloDeTienda(ajustes) {
  const variables = [];
  const fuente = FUENTES[ajustes.fuente] ?? FUENTES.sistema;
  if (fuente.titulos) variables.push(`--fuente-titulos: ${fuente.titulos}`);
  if (fuente.texto) variables.push(`--fuente-texto: ${fuente.texto}`);
  const radios = (ESQUINAS[ajustes.esquinas] ?? ESQUINAS.redondeadas).radios;
  if (radios) {
    variables.push(`--radio-chico: ${radios.chico}px`, `--radio: ${radios.medio}px`, `--radio-grande: ${radios.grande}px`, `--radio-foto: ${radios.foto}px`);
  }
  // El botón va aparte: por defecto es una píldora (999px), no un valor de la escala.
  if (radios) variables.push(`--radio-boton: ${radios.boton}px`);
  const columnas = (TARJETAS[ajustes.tarjetas] ?? TARJETAS.normales).columnas;
  if (columnas) variables.push(`--columnas-media: ${columnas.media}`, `--columnas: ${columnas.ancha}`);
  if (/^#[0-9a-f]{6}$/.test(ajustes.colorFranja)) {
    variables.push(`--franja: ${ajustes.colorFranja}`, `--franja-texto: ${colorDeTextoSobre(ajustes.colorFranja)}`);
  }
  return {
    variables: variables.join('; '),
    hojaDeFuente: fuente.google ? `https://fonts.googleapis.com/css2?family=${fuente.google}&display=swap` : null,
  };
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
      `SELECT id, imagen, imagen_movil AS "imagenMovil", enlace, texto_alternativo AS "textoAlternativo"
       FROM banners WHERE tienda_id = ? ORDER BY orden, id`,
    )
    .all(tiendaId);
}

export async function agregarBanner(db, tiendaId, { imagen, imagenMovil, enlace, textoAlternativo }) {
  await db.prepare(
    `INSERT INTO banners (tienda_id, imagen, imagen_movil, enlace, texto_alternativo, orden)
     VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(orden), 0) + 1 FROM banners WHERE tienda_id = ?))`,
  ).run(tiendaId, imagen, imagenMovil, enlace, textoAlternativo, tiendaId);
}

// Intercambia el banner con el anterior (-1) o el siguiente (+1).
export function moverBanner(db, tiendaId, id, direccion) {
  return enTransaccion(db, async (tx) => {
    const banners = await tx.prepare('SELECT id, orden FROM banners WHERE tienda_id = ? ORDER BY orden, id').all(tiendaId);
    const i = banners.findIndex((b) => b.id === id);
    const j = i + direccion;
    if (i === -1 || j < 0 || j >= banners.length) return;
    const actualizar = tx.prepare('UPDATE banners SET orden = ? WHERE id = ?');
    // Se renumeran todos, por si había órdenes repetidos.
    [banners[i], banners[j]] = [banners[j], banners[i]];
    for (const [n, banner] of banners.entries()) await actualizar.run(n + 1, banner.id);
  });
}

// Devuelve el banner borrado (para borrar sus archivos) o null si no es de esta tienda.
export async function borrarBanner(db, tiendaId, id) {
  return (
    (await db
      .prepare('DELETE FROM banners WHERE id = ? AND tienda_id = ? RETURNING imagen, imagen_movil AS "imagenMovil"')
      .get(id, tiendaId)) ?? null
  );
}
