// Diseño por plan: qué puede personalizar cada tienda de su vidriera según el nivel de diseño de su plan.
//  - esencial:   lo de siempre (identidad, tipografía, esquinas, cabecera y menú, catálogo, banners).
//  - acompanado: suma colores, posición del logo, portada ordenable, estilo de las tarjetas y del pie, banners a ancho completo.
//  - a_medida:   suma CSS propio, tipografías de Google Fonts a elección, ancho de la página y dominio propio.
// El nivel se aplica AL LEER (aplicarNivel): si un cliente baja de plan, lo que eligió de más queda guardado pero la vidriera deja de
// aplicarlo, y vuelve si el cliente sube de nuevo. Todos los valores por defecto reproducen la vidriera de siempre.
// Este archivo no depende de diseno.js (que lo importa): son las opciones, sus validaciones y el estilo que generan.

// ---------- Niveles ----------

export const NIVELES = {
  esencial: {
    titulo: 'Esencial',
    orden: 1,
    lema: 'Tu marca en una tienda lista para vender',
    incluye: [
      'Logo, color principal y franja de anuncios',
      'Tipografía y esquinas a elección',
      'Cabecera y menú de categorías',
      'Catálogo: orden, tamaño de las tarjetas y productos sin stock',
      'Sobre la tienda, contacto y redes',
      'Banners de bienvenida',
    ],
    resumen: 'Diseño de tu tienda: Esencial',
  },
  acompanado: {
    titulo: 'Acompañado',
    orden: 2,
    lema: 'Más control sobre cómo se ve tu tienda',
    incluye: [
      'Todo lo del plan Esencial',
      'Colores de fondo, texto, tarjetas, cabecera y pie',
      'Logo a la izquierda, al centro o a la derecha',
      'Portada a tu gusto: qué secciones se ven y en qué orden (banners, ofertas, destacados)',
      'Tarjetas de producto con borde o sombra, y la proporción de la foto',
      'Pie de página claro, oscuro o de tu color',
      'Banners a ancho completo',
    ],
    resumen: 'Más controles de diseño: colores, portada y tarjetas',
  },
  a_medida: {
    titulo: 'A medida',
    orden: 3,
    lema: 'Tu tienda, 100 % personalizable',
    incluye: [
      'Todo lo del plan Acompañado',
      'CSS propio para cambiar lo que quieras',
      'Cualquier tipografía de Google Fonts',
      'Ancho de la página a elección',
      'Dominio propio (tutienda.com)',
      'Códigos de seguimiento (píxeles) cargados por nosotros',
    ],
    resumen: 'Diseño 100 % a medida y dominio propio',
  },
};
export const esNivel = (valor) => typeof valor === 'string' && Object.hasOwn(NIVELES, valor);
// ¿El nivel `nivel` incluye lo que pide `requerido`?
export const incluyeNivel = (nivel, requerido) => (NIVELES[nivel]?.orden ?? 0) >= (NIVELES[requerido]?.orden ?? Infinity);

// El nivel de diseño de una tienda (el de su plan) y el nombre del plan. Sin plan (o con un plan que no tiene nivel) vale como a_medida: nada cambia para ella.
export async function datosDeNivel(db, tiendaId) {
  const fila = await db
    .prepare('SELECT p.nivel_diseno AS nivel, p.nombre AS plan FROM tiendas t LEFT JOIN planes p ON p.id = t.plan_id WHERE t.id = ?')
    .get(tiendaId);
  return { nivel: esNivel(fila?.nivel) ? fila.nivel : 'a_medida', planNombre: fila?.plan ?? null };
}
export const nivelDeTienda = async (db, tiendaId) => (await datosDeNivel(db, tiendaId)).nivel;

// ---------- Opciones ----------

export const LOGO_POSICIONES = {
  izquierda: { titulo: 'A la izquierda', ayuda: 'Como siempre: el logo primero y el menú al lado.' },
  centro: { titulo: 'Al centro', ayuda: 'El logo arriba, en el medio, y el menú y los íconos en una segunda línea.' },
  derecha: { titulo: 'A la derecha', ayuda: 'El menú y los íconos a la izquierda y el logo en el extremo derecho.' },
};

export const PIE_ESTILOS = {
  claro: { titulo: 'Claro', ayuda: 'Gris muy claro, como siempre.' },
  oscuro: { titulo: 'Oscuro', ayuda: 'Fondo oscuro con letras claras.' },
  marca: { titulo: 'Del color de tu marca', ayuda: 'Usa el color principal de tu tienda.' },
  propio: { titulo: 'Otro color', ayuda: 'El color que elijas abajo.' },
};

export const TARJETA_ESTILOS = {
  plana: { titulo: 'Sin marco', ayuda: 'La foto y el texto sobre el fondo, como siempre.' },
  borde: { titulo: 'Con borde', ayuda: 'Cada producto dentro de una tarjeta con un borde fino.' },
  sombra: { titulo: 'Con sombra', ayuda: 'Cada producto en una tarjeta que se despega del fondo.' },
};
export const TARJETA_FOTOS = {
  vertical: { titulo: 'Vertical', ayuda: 'Proporción 4:5, como siempre. Ideal para ropa y calzado.', proporcion: '4 / 5' },
  cuadrada: { titulo: 'Cuadrada', ayuda: 'Proporción 1:1. Ideal para objetos y accesorios.', proporcion: '1 / 1' },
  apaisada: { titulo: 'Apaisada', ayuda: 'Proporción 4:3. Ideal para productos anchos.', proporcion: '4 / 3' },
};
export const TARJETA_TEXTOS = {
  izquierda: { titulo: 'A la izquierda', ayuda: 'Nombre y precio alineados a la izquierda, como siempre.' },
  centro: { titulo: 'Centrado', ayuda: 'Nombre y precio centrados bajo la foto.' },
};

export const BANNERS_ANCHOS = {
  contenedor: { titulo: 'Dentro de la página', ayuda: 'Con los mismos márgenes que el resto, como siempre.' },
  completo: { titulo: 'De punta a punta', ayuda: 'Ocupan todo el ancho de la pantalla.' },
};

// El ancho máximo del contenido en px (null: todo el ancho de la pantalla). 'normal' es el de siempre.
export const ANCHOS_PAGINA = {
  angosto: { titulo: 'Angosto', ayuda: '960 px: más recogido, bueno para pocos productos.', px: 960 },
  normal: { titulo: 'Normal', ayuda: '1240 px, como siempre.', px: 1240 },
  ancho: { titulo: 'Ancho', ayuda: '1440 px: más productos por fila en pantallas grandes.', px: 1440 },
  completo: { titulo: 'Todo el ancho', ayuda: 'Sin tope: el contenido llega hasta los bordes (con sus márgenes).', px: null },
};

// Las secciones de arriba de la portada que se pueden mostrar y ordenar. El catálogo va siempre al final.
export const SECCIONES_PORTADA = {
  banners: { titulo: 'Banners de bienvenida', ayuda: 'El carrusel con tus imágenes.' },
  ofertas: { titulo: 'Ofertas', ayuda: 'Los productos que tienen precio promocional.' },
  destacados: { titulo: 'Destacados', ayuda: 'Los productos que marcaste como destacados.' },
};
export const PORTADA_POR_DEFECTO = ['banners', 'destacados'];
// "banners,ofertas" -> ['banners', 'ofertas'] (sin repetidos ni nombres que no existan).
export const seccionesDePortada = (texto) => [...new Set(String(texto ?? '').split(',').map((s) => s.trim()))].filter((s) => Object.hasOwn(SECCIONES_PORTADA, s));

export const COLORES = {
  colorFondo: { titulo: 'Fondo de la página', defecto: '#ffffff' },
  colorTexto: { titulo: 'Texto', defecto: '#18181b' },
  colorTarjetas: { titulo: 'Tarjetas de producto', defecto: '#ffffff' },
  colorCabecera: { titulo: 'Cabecera', defecto: '#ffffff' },
  colorPie: { titulo: 'Pie de página', defecto: '#f5f5f6' },
};
const CONTRASTE_MINIMO = 4.5;

export const MAX_CSS_PROPIO = 20_000;

// ---------- Valores por defecto y columnas ----------

export const AJUSTES_AVANZADOS_POR_DEFECTO = {
  colorFondo: '',
  colorTexto: '',
  colorTarjetas: '',
  colorCabecera: '',
  colorPie: '',
  logoPosicion: 'izquierda',
  cabeceraFija: true,
  pieEstilo: 'claro',
  portadaSecciones: PORTADA_POR_DEFECTO.join(','),
  tarjetaEstilo: 'plana',
  tarjetaFoto: 'vertical',
  tarjetaTexto: 'izquierda',
  bannersAncho: 'contenedor',
  cssPropio: '',
  fuenteTitulos: '',
  fuenteTexto: '',
  anchoPagina: 'normal',
};
export const BOOLEANOS_AVANZADOS = new Set(['cabeceraFija']);
export const COLUMNAS_AVANZADAS = {
  colorFondo: 'color_fondo',
  colorTexto: 'color_texto',
  colorTarjetas: 'color_tarjetas',
  colorCabecera: 'color_cabecera',
  colorPie: 'color_pie',
  logoPosicion: 'logo_posicion',
  cabeceraFija: 'cabecera_fija',
  pieEstilo: 'pie_estilo',
  portadaSecciones: 'portada_secciones',
  tarjetaEstilo: 'tarjeta_estilo',
  tarjetaFoto: 'tarjeta_foto',
  tarjetaTexto: 'tarjeta_texto',
  bannersAncho: 'banners_ancho',
  cssPropio: 'css_propio',
  fuenteTitulos: 'fuente_titulos',
  fuenteTexto: 'fuente_texto',
  anchoPagina: 'ancho_pagina',
};

// Desde qué nivel está disponible cada ajuste.
export const NIVEL_DE_AJUSTE = {
  colorFondo: 'acompanado',
  colorTexto: 'acompanado',
  colorTarjetas: 'acompanado',
  colorCabecera: 'acompanado',
  colorPie: 'acompanado',
  logoPosicion: 'acompanado',
  cabeceraFija: 'acompanado',
  pieEstilo: 'acompanado',
  portadaSecciones: 'acompanado',
  tarjetaEstilo: 'acompanado',
  tarjetaFoto: 'acompanado',
  tarjetaTexto: 'acompanado',
  bannersAncho: 'acompanado',
  cssPropio: 'a_medida',
  fuenteTitulos: 'a_medida',
  fuenteTexto: 'a_medida',
  anchoPagina: 'a_medida',
};

// Los ajustes tal como los ve la vidriera: lo que el nivel no incluye vuelve al valor de siempre (lo guardado no se toca).
export function aplicarNivel(ajustes, nivel) {
  const aplicados = { ...ajustes };
  for (const [clave, requerido] of Object.entries(NIVEL_DE_AJUSTE)) {
    if (!incluyeNivel(nivel, requerido)) aplicados[clave] = AJUSTES_AVANZADOS_POR_DEFECTO[clave];
  }
  return aplicados;
}

// ---------- Colores y contraste ----------

const esColor = (valor) => typeof valor === 'string' && /^#[0-9a-f]{6}$/.test(valor);
const canales = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

// Luminancia relativa (WCAG), de 0 (negro) a 1 (blanco).
export function luminancia(hex) {
  const [r, g, b] = canales(hex).map((valor) => {
    const c = valor / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Relación de contraste entre dos colores, de 1 a 21. Para leer texto, 4,5 es el mínimo recomendado.
export function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

// El casi negro o el blanco, el que mejor se lee sobre `hex`; en los tonos del medio, negro puro. Siempre cumple 4,5:1 o más.
export function textoLegibleSobre(hex) {
  const oscuro = contraste(hex, '#111111');
  const claro = contraste(hex, '#ffffff');
  if (oscuro >= CONTRASTE_MINIMO && oscuro >= claro) return '#111111';
  if (claro >= CONTRASTE_MINIMO) return '#ffffff';
  return '#000000'; // en los tonos del medio, donde ni el casi negro ni el blanco llegan a 4,5: el negro puro sí
}
export const esOscuro = (hex) => textoLegibleSobre(hex) === '#ffffff';

// ---------- Validación ----------

const texto = (valor) => String(valor ?? '').trim();

// CSS propio: tope de largo y nada que pueda cargar código o salirse de la hoja de estilo. Se imprime dentro de un <style>, así que no puede
// llevar < (cerraría la etiqueta y dejaría meter HTML; el > de los selectores no molesta), @import (las tipografías están en su propio campo),
// expression() ni javascript:. Los url() solo apuntan a https:// o a rutas de la propia tienda. Devuelve { valor } o { error }.
export function validarCssPropio(entrada) {
  const css = texto(entrada).replace(/\r\n?/g, '\n');
  if (css.length > MAX_CSS_PROPIO) return { error: `Máximo ${MAX_CSS_PROPIO.toLocaleString('es-AR')} caracteres (tiene ${css.length.toLocaleString('es-AR')})` };
  if (css.includes('<')) return { error: 'No puede llevar el signo < (si lo necesitás en un content, escribilo como \\3c)' };
  if (/@import|@charset/i.test(css)) return { error: 'No se puede usar @import ni @charset: las tipografías se eligen en su propio campo' };
  if (/expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding/i.test(css)) return { error: 'Hay algo que no está permitido en CSS (expression, javascript:, behavior...)' };
  for (const coincidencia of css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!/^(https:\/\/|\/(?!\/))/i.test(coincidencia[2].trim())) return { error: 'Los url(...) tienen que ser links que empiecen con https:// o rutas de tu tienda que empiecen con /' };
  }
  return { valor: css };
}

// El nombre de una familia de Google Fonts ("Lora", "Playfair Display"). Vacío es válido: usa la tipografía elegida en Estilo.
export function validarFuenteGoogle(entrada) {
  const nombre = texto(entrada).replace(/\s+/g, ' ');
  if (nombre === '') return { valor: '' };
  if (!/^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(nombre)) return { error: 'Escribí el nombre tal como figura en fonts.google.com (solo letras, números y espacios), por ejemplo Lora' };
  return { valor: nombre };
}

// Valida los ajustes que dependen del plan (los campos del formulario de Diseño que no son de Esencial). Devuelve { ajustes, errores }.
// Lo que el nivel no incluye se ignora; lo que no viene en el formulario queda como estaba. `actuales`: los ajustes guardados (los colores se
// validan de a pares: el texto tiene que leerse sobre el fondo y sobre las tarjetas).
export function validarAvanzados(campos, nivel, actuales = AJUSTES_AVANZADOS_POR_DEFECTO) {
  const ajustes = {};
  const errores = {};
  const incluye = (clave) => incluyeNivel(nivel, NIVEL_DE_AJUSTE[clave]);

  // Cada color tiene su casilla "usar otro": sin ella vuelve al de siempre.
  for (const campo of Object.keys(COLORES)) {
    if (!incluye(campo) || (campos[campo] === undefined && campos[`${campo}Propio`] === undefined)) continue;
    if (!campos[`${campo}Propio`]) ajustes[campo] = '';
    else if (esColor(texto(campos[campo]).toLowerCase())) ajustes[campo] = texto(campos[campo]).toLowerCase();
    else errores[campo] = 'Elegí un color';
  }

  const opcion = (campo, opciones) => {
    if (!incluye(campo) || campos[campo] === undefined) return;
    if (Object.hasOwn(opciones, texto(campos[campo]))) ajustes[campo] = texto(campos[campo]);
    else errores[campo] = 'Elegí una de las opciones';
  };
  opcion('logoPosicion', LOGO_POSICIONES);
  opcion('pieEstilo', PIE_ESTILOS);
  opcion('tarjetaEstilo', TARJETA_ESTILOS);
  opcion('tarjetaFoto', TARJETA_FOTOS);
  opcion('tarjetaTexto', TARJETA_TEXTOS);
  opcion('bannersAncho', BANNERS_ANCHOS);
  opcion('anchoPagina', ANCHOS_PAGINA);

  if (incluye('cabeceraFija') && campos.cabeceraFija !== undefined) ajustes.cabeceraFija = texto(campos.cabeceraFija) === '1';

  // Portada: cada sección tiene "mostrar" y un número de orden; sin marcar ninguna queda la portada sin esas secciones.
  if (incluye('portadaSecciones') && campos.portadaEnviada !== undefined) {
    const posicion = (clave) => {
      const n = Number.parseInt(campos[`portadaOrden_${clave}`], 10);
      return Number.isInteger(n) ? n : 99;
    };
    ajustes.portadaSecciones = Object.keys(SECCIONES_PORTADA)
      .filter((clave) => campos[`portadaMostrar_${clave}`] === '1')
      .sort((a, b) => posicion(a) - posicion(b))
      .join(',');
  }

  if (incluye('cssPropio') && campos.cssPropio !== undefined) {
    const css = validarCssPropio(campos.cssPropio);
    if (css.error) errores.cssPropio = css.error;
    else ajustes.cssPropio = css.valor;
  }
  for (const campo of ['fuenteTitulos', 'fuenteTexto']) {
    if (!incluye(campo) || campos[campo] === undefined) continue;
    const fuente = validarFuenteGoogle(campos[campo]);
    if (fuente.error) errores[campo] = fuente.error;
    else ajustes[campo] = fuente.valor;
  }

  // El texto se tiene que leer sobre el fondo y sobre las tarjetas. Sin texto elegido, la vidriera usa el negro o el blanco que mejor se lea
  // sobre el fondo, así que solo se revisa lo que se eligió.
  const elegido = (campo) => ajustes[campo] ?? actuales[campo] ?? '';
  const fondo = elegido('colorFondo') || COLORES.colorFondo.defecto;
  const tarjetas = elegido('colorTarjetas');
  const colorTexto = elegido('colorTexto');
  const textoEfectivo = colorTexto || (elegido('colorFondo') ? textoLegibleSobre(fondo) : COLORES.colorTexto.defecto);
  if (!errores.colorTexto && !errores.colorFondo && colorTexto && contraste(colorTexto, fondo) < CONTRASTE_MINIMO) {
    errores.colorTexto = 'El texto no se lee bien sobre ese fondo. Elegí colores más distintos entre sí (contraste mínimo 4,5 a 1).';
  }
  if (!errores.colorTarjetas && !errores.colorTexto && tarjetas && contraste(textoEfectivo, tarjetas) < CONTRASTE_MINIMO) {
    errores.colorTarjetas = 'El texto no se lee bien sobre el color de las tarjetas. Elegí uno más claro u oscuro, según tu texto (contraste mínimo 4,5 a 1).';
  }
  return { ajustes, errores };
}

// ---------- El estilo que generan ----------

const mezcla = (color, porcentaje, otro) => `color-mix(in srgb, ${color} ${porcentaje}%, ${otro})`;

// Las variables derivadas de un fondo y un texto: superficies, bordes y grises de texto, todos mezclados de esos dos colores, así
// cualquier combinación elegida se ve coherente (un fondo oscuro con texto claro, por ejemplo).
function variablesDerivadas(fondo, textoColor) {
  return [
    `--fondo: ${fondo}`,
    `--texto: ${textoColor}`,
    `--texto-suave: ${mezcla(textoColor, 80, fondo)}`,
    `--texto-tenue: ${mezcla(textoColor, 62, fondo)}`,
    `--superficie: ${mezcla(textoColor, 5, fondo)}`,
    `--superficie-hover: ${mezcla(textoColor, 9, fondo)}`,
    `--borde: ${mezcla(textoColor, 12, fondo)}`,
    `--borde-fuerte: ${mezcla(textoColor, 22, fondo)}`,
    `--borde-campo: ${mezcla(textoColor, 55, fondo)}`,
    `--vidrio: ${mezcla(fondo, 88, 'transparent')}`,
  ].join('; ');
}

// La URL de una tipografía de Google Fonts a elección. Se pide con la API clásica porque no falla si la familia no tiene alguno de los pesos.
export const urlDeFuenteGoogle = (nombre) => `https://fonts.googleapis.com/css?family=${nombre.replaceAll(' ', '+')}:400,500,600,700&display=swap`;

const SIN_SERIFA = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// Lo que la vidriera agrega a partir de los ajustes avanzados (ya con el nivel aplicado). Con los valores por defecto no agrega nada.
//  variables: declaraciones para :root (el ancho y las tipografías a elección).
//  css: reglas de colores y, al final, el CSS propio.
//  atributos: los data-* del <body> que activan las reglas de tienda.css (solo los que no son el valor de siempre).
//  hojasDeFuente: las hojas de Google Fonts a pedir.
// Todo sale de las constantes de arriba o de valores ya validados (#rrggbb, nombres de fuente, CSS propio sin < ni >).
export function estiloAvanzado(ajustes) {
  const variables = [];
  const reglas = [];
  const atributos = {};
  const hojasDeFuente = [];
  const defecto = AJUSTES_AVANZADOS_POR_DEFECTO;
  const color = (campo) => (esColor(ajustes[campo]) ? ajustes[campo] : '');

  // Colores de la página. En el checkout y la página del pedido se dejan los de siempre: tienen sus propias tarjetas y fondos fijos.
  const fondo = color('colorFondo');
  const colorDeTexto = color('colorTexto');
  if (fondo || colorDeTexto) {
    const base = fondo || COLORES.colorFondo.defecto;
    const letra = colorDeTexto || (fondo ? textoLegibleSobre(base) : COLORES.colorTexto.defecto);
    reglas.push(`:root:not(:has(.checkout, .pedido)) { color-scheme: ${esOscuro(base) ? 'dark' : 'light'}; ${variablesDerivadas(base, letra)}; --acento-suave: ${mezcla('var(--acento)', 6, 'var(--superficie)')} }`);
  }
  const tarjetas = color('colorTarjetas');
  if (tarjetas) reglas.push(`:root { --tarjeta: ${tarjetas} }`);

  // Cabecera de otro color: el texto, los íconos y el borde se ajustan para que se lean; los menús desplegables siguen con los colores de la página.
  const cabecera = color('colorCabecera');
  if (cabecera) {
    const letra = textoLegibleSobre(cabecera);
    reglas.push(
      `.cabecera { --vidrio: ${mezcla(cabecera, 92, 'transparent')}; border-bottom-color: ${mezcla(letra, 16, cabecera)} }`,
      `.cabecera :is(.marca, .boton-icono) { color: ${letra} }`,
      `.cabecera .navegacion-item > :is(a, button) { color: ${mezcla(letra, 82, cabecera)} }`,
      `.cabecera .navegacion-item > :is(a, button):hover, .cabecera .navegacion-item:focus-within > :is(a, button) { color: ${letra}; background: ${mezcla(letra, 12, 'transparent')} }`,
      `.cabecera .boton-icono:hover, .cabecera .menu-movil[open] summary { background: ${mezcla(letra, 14, 'transparent')} }`,
      `.cabecera .contador-carrito { box-shadow: 0 0 0 2px ${cabecera} }`,
    );
  }

  // Pie: claro (el de siempre), oscuro, del color de la marca o de otro color. Adentro del pie se redefinen las variables, así todo se lee.
  const pieColor = { oscuro: '#18181b', marca: esColor(ajustes.colorPrincipal) ? ajustes.colorPrincipal : '', propio: color('colorPie') }[ajustes.pieEstilo] ?? '';
  if (pieColor) {
    const letra = textoLegibleSobre(pieColor);
    reglas.push(
      `.pie { background: ${pieColor}; border-top-color: transparent; --superficie: ${pieColor}; --fondo: ${mezcla(letra, 10, pieColor)}; --texto: ${letra}; --texto-suave: ${mezcla(letra, 82, pieColor)}; --texto-tenue: ${mezcla(letra, 66, pieColor)}; --borde: ${mezcla(letra, 18, pieColor)}; --borde-fuerte: ${mezcla(letra, 30, pieColor)}; --superficie-hover: ${mezcla(letra, 16, pieColor)} }`,
    );
    // La firma de Vezza lleva su tinta oscura: sobre un pie oscuro pasa a ser clara.
    if (letra === '#ffffff') reglas.push('.pie .vezza-firma { --vezza-tinta: #ffffff }');
  }

  // Cabecera fija o que se va con el scroll, y la posición del logo.
  if (ajustes.cabeceraFija === false) atributos['data-cabecera'] = 'estatica';
  if (ajustes.logoPosicion !== defecto.logoPosicion && Object.hasOwn(LOGO_POSICIONES, ajustes.logoPosicion)) atributos['data-logo'] = ajustes.logoPosicion;

  // Tarjetas de producto y banners.
  if (ajustes.tarjetaEstilo !== defecto.tarjetaEstilo && Object.hasOwn(TARJETA_ESTILOS, ajustes.tarjetaEstilo)) atributos['data-tarjeta'] = ajustes.tarjetaEstilo;
  if (ajustes.tarjetaFoto !== defecto.tarjetaFoto && Object.hasOwn(TARJETA_FOTOS, ajustes.tarjetaFoto)) atributos['data-foto'] = ajustes.tarjetaFoto;
  if (ajustes.tarjetaTexto !== defecto.tarjetaTexto && Object.hasOwn(TARJETA_TEXTOS, ajustes.tarjetaTexto)) atributos['data-texto-tarjeta'] = ajustes.tarjetaTexto;
  if (ajustes.bannersAncho !== defecto.bannersAncho && Object.hasOwn(BANNERS_ANCHOS, ajustes.bannersAncho)) atributos['data-banners'] = ajustes.bannersAncho;

  // Solo el plan a medida: ancho, tipografías y CSS propio (va al final: pisa lo demás).
  if (ajustes.anchoPagina !== defecto.anchoPagina && Object.hasOwn(ANCHOS_PAGINA, ajustes.anchoPagina)) {
    const { px } = ANCHOS_PAGINA[ajustes.anchoPagina];
    variables.push(`--ancho: ${px === null ? '100%' : `${px}px`}`);
  }
  for (const [campo, variable] of [['fuenteTitulos', '--fuente-titulos'], ['fuenteTexto', '--fuente-texto']]) {
    const nombre = ajustes[campo];
    if (!nombre || !/^[A-Za-z][A-Za-z0-9 ]{1,39}$/.test(nombre)) continue;
    variables.push(`${variable}: "${nombre}", ${SIN_SERIFA}`);
    const hoja = urlDeFuenteGoogle(nombre);
    if (!hojasDeFuente.includes(hoja)) hojasDeFuente.push(hoja);
  }
  if (ajustes.cssPropio) reglas.push(ajustes.cssPropio);

  return {
    variables: variables.join('; '),
    css: reglas.join('\n'),
    atributos: Object.entries(atributos).map(([nombre, valor]) => ` ${nombre}="${valor}"`).join(''),
    hojasDeFuente,
  };
}
