// Nodo "Armar la maqueta" del flujo de n8n "VEZZA Shop · Maquetas web".
// Arma la maqueta (una página de inicio de ejemplo, en un solo HTML) con el pedido ya validado, los textos que redactó Gemini y la marca de la tienda:
// sus colores, su logo, sus fotos, sus categorías y algunos de sus productos. Los textos los escribe la IA; el diseño es una plantilla propia, así
// la maqueta siempre se ve bien y nada de lo que diga la IA puede meter código. Si Gemini no contestó, o contestó cualquier cosa, usa textos de
// ejemplo: la maqueta sale igual.
// Devuelve lo que se le entrega a VEZZA Shop: { respuesta, token, estado: 'lista', html, resumen } o, si algo falla, { respuesta, token, estado: 'error', error }.
const pedido = $('Validar y armar el pedido').first().json.pedido;
const salidaIA = (($input.all()[0] || {}).json) || {};

// ---------- Utilidades ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const linea = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
// Recorta en una palabra entera y con puntos suspensivos.
const recorte = (v, max) => {
  const t = linea(v, 5000);
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '').trimEnd()}…` : t;
};

// ---------- Colores ----------

const aRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const aHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
// De `a` (t = 0) a `b` (t = 1).
const mezclar = (a, b, t) => {
  const [x, y] = [aRgb(a), aRgb(b)];
  return aHex(x.map((v, i) => v + (y[i] - v) * t));
};
const luz = (h) => {
  const [r, g, b] = aRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [claro, oscuro] = [luz(a), luz(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
};
// El casi negro o el blanco, el que mejor se lee sobre `h` (siempre 4,5 a 1 o más).
const textoSobre = (h) => {
  const oscuro = contraste(h, '#111111');
  const claro = contraste(h, '#ffffff');
  if (oscuro >= 4.5 && oscuro >= claro) return '#111111';
  return claro >= 4.5 ? '#ffffff' : '#000000';
};
// El color, oscurecido lo necesario para que se lea sobre blanco (textos y bordes de la marca).
const sobreBlanco = (h) => {
  let c = h;
  for (let i = 0; i < 10 && contraste(c, '#ffffff') < 4.5; i++) c = mezclar(c, '#000000', 0.15);
  return c;
};

// ---------- Estilos ----------

const ESTILOS = {
  moderno: { nombre: 'Moderno', titulos: 'Poppins', texto: 'Inter', familias: 'family=Poppins:wght@600;700&family=Inter:wght@400;500;600', radio: 12, peso: 700, mayus: false, espaciado: '-.01em' },
  elegante: { nombre: 'Elegante', titulos: 'Playfair Display', texto: 'Lato', familias: 'family=Playfair+Display:wght@500;700&family=Lato:wght@400;700', radio: 2, peso: 600, mayus: false, espaciado: '0' },
  calido: { nombre: 'Cálido', titulos: 'Nunito', texto: 'Nunito', familias: 'family=Nunito:wght@400;600;800', radio: 20, peso: 800, mayus: false, espaciado: '0' },
  audaz: { nombre: 'Audaz', titulos: 'Montserrat', texto: 'Inter', familias: 'family=Montserrat:wght@800;900&family=Inter:wght@400;600', radio: 6, peso: 800, mayus: true, espaciado: '-.02em' },
};
// Si el cliente no eligió un estilo, se deduce del rubro.
const inferirEstilo = (rubro) => {
  const r = String(rubro).toLowerCase();
  if (/joy|perfum|vino|bodega|deco|arte|libr|galer|antigu|cuero/.test(r)) return 'elegante';
  if (/ni[ñn]o|beb[eé]|mascota|jugue|pan\b|dulce|torta|artesan|vela|jab[oó]n|natural|planta|c[aá]lid/.test(r)) return 'calido';
  if (/deport|gym|moto|bici|gamer|tecno|skate|surf|urban|calzado|zapatill/.test(r)) return 'audaz';
  return 'moderno';
};

// ---------- Textos ----------

const textosDeEjemplo = (p) => ({
  anuncio: 'Tu anuncio de bienvenida va acá',
  eslogan: p.tienda.nombre,
  bajada: p.descripcion ? recorte(p.descripcion, 140) : p.rubro ? `${p.rubro}, con atención cercana.` : 'Todo lo que buscás, en un solo lugar.',
  boton: 'Ver productos',
  sobreTitulo: `Sobre ${p.tienda.nombre}`,
  sobreTexto: p.descripcion ? recorte(p.descripcion, 260) : 'Acá cuenta tu historia: quién sos, qué te mueve y por qué tus clientes te eligen.',
  valores: [
    { titulo: 'Hecho con cariño', texto: 'Cuidamos cada detalle de lo que ofrecemos.' },
    { titulo: 'Atención cercana', texto: 'Te acompañamos antes y después de tu compra.' },
    { titulo: 'Compra simple', texto: 'Elegís, pagás y lo recibís sin vueltas.' },
  ],
  cierre: 'Gracias por visitarnos.',
});

// Gemini puede devolver el JSON de varias formas (ya interpretado, como texto, con o sin bloque de código, adentro de otros campos): se lo busca.
function textoComoJson(texto) {
  const t = String(texto).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const desde = t.indexOf('{');
  const hasta = t.lastIndexOf('}');
  if (desde === -1 || hasta <= desde) return null;
  try {
    return JSON.parse(t.slice(desde, hasta + 1));
  } catch {
    return null;
  }
}
function buscarTextosDeLaIA(entrada) {
  const esLoBuscado = (o) => o && typeof o === 'object' && !Array.isArray(o) && ('eslogan' in o || 'bajada' in o);
  const pendientes = [entrada];
  for (let vistos = 0; pendientes.length && vistos < 200; vistos++) {
    const actual = pendientes.shift();
    if (typeof actual === 'string') {
      const interpretado = textoComoJson(actual);
      if (esLoBuscado(interpretado)) return interpretado;
    } else if (esLoBuscado(actual)) {
      return actual;
    } else if (actual && typeof actual === 'object') {
      pendientes.push(...Object.values(actual));
    }
  }
  return null;
}
// Mezcla lo que escribió la IA con los textos de ejemplo: cada campo vale si es un texto no vacío, y se recorta a su largo.
function textosFinales(ia, ejemplo) {
  if (!ia) return { textos: ejemplo, conIA: false };
  // Solo valen los textos: un número, una lista o un objeto en su lugar se ignoran.
  const texto = (v, max) => (typeof v === 'string' ? linea(v, max) : '');
  const campo = (clave, max) => texto(ia[clave], max) || ejemplo[clave];
  const valores = (Array.isArray(ia.valores) ? ia.valores : []).slice(0, 3).map((v, i) => ({
    titulo: texto(v && v.titulo, 28) || ejemplo.valores[i].titulo,
    texto: texto(v && v.texto, 90) || ejemplo.valores[i].texto,
  }));
  while (valores.length < 3) valores.push(ejemplo.valores[valores.length]);
  return {
    conIA: true,
    textos: {
      anuncio: campo('anuncio', 70),
      eslogan: campo('eslogan', 60),
      bajada: campo('bajada', 140),
      boton: campo('boton', 24),
      sobreTitulo: campo('sobreTitulo', 50),
      sobreTexto: campo('sobreTexto', 260),
      valores,
      cierre: campo('cierre', 70),
    },
  };
}

// ---------- La página ----------

const ICONOS = {
  buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/></svg>',
  corazon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/></svg>',
  escudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  estrella: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9L12 3Z"/></svg>',
};

function armarPagina(p, textos, estilo) {
  const nombre = esc(p.tienda.nombre);
  const P = p.colores.principal;
  const PT = textoSobre(P);
  const PC = sobreBlanco(P);
  const S = p.colores.secundario || mezclar(P, '#ffffff', 0.9);
  const ST = textoSobre(S);
  const A = p.colores.acento || P;
  const AT = textoSobre(A);
  // El botón de la portada va sobre el color principal: usa el de acento si se distingue de él y, si no, los colores invertidos.
  const botonPortada = p.colores.acento && contraste(A, P) >= 3 ? { fondo: A, texto: AT } : { fondo: PT, texto: P };
  const PIE = mezclar(P, '#000000', 0.78);

  const css = `
*{box-sizing:border-box;margin:0}
:root{--p:${P};--pt:${PT};--pc:${PC};--s:${S};--st:${ST};--a:${A};--at:${AT};--r:${estilo.radio}px;--ft:'${estilo.titulos}',system-ui,sans-serif;--fx:'${estilo.texto}',system-ui,sans-serif}
body{font-family:var(--fx);color:#18181b;background:#fff;line-height:1.55}
img{display:block;max-width:100%}
h1,h2,h3{font-family:var(--ft);font-weight:${estilo.peso};line-height:1.15;letter-spacing:${estilo.espaciado}${estilo.mayus ? ';text-transform:uppercase' : ''}}
a{color:inherit}
.cinta{background:#18181b;color:#fff;font-size:12px;text-align:center;padding:6px 12px}
.anuncio{background:var(--a);color:var(--at);font-size:13px;font-weight:600;text-align:center;padding:9px 16px}
.cab{display:flex;align-items:center;gap:24px;padding:14px clamp(16px,5vw,56px);background:#fff;border-bottom:1px solid #e4e4e7}
.marca{display:flex;align-items:center;font-family:var(--ft);font-weight:${estilo.peso};font-size:22px;color:var(--pc);text-decoration:none}
.marca img{max-height:40px;width:auto}
.cab nav{display:flex;gap:22px;margin-left:auto;font-size:14px;font-weight:500}
.cab nav a{text-decoration:none}
.ico{display:flex;gap:14px}
.ico svg{width:22px;height:22px}
.hero{display:grid;grid-template-columns:1.05fr 1fr;min-height:460px;background:var(--p);color:var(--pt)}
.hero-txt{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:18px;padding:clamp(28px,6vw,72px)}
.hero h1{font-size:clamp(32px,5vw,56px)}
.hero p{font-size:clamp(16px,1.6vw,19px);max-width:46ch;opacity:.92}
.btn{display:inline-block;padding:14px 26px;border-radius:var(--r);font-weight:700;font-size:15px;text-decoration:none;background:${botonPortada.fondo};color:${botonPortada.texto}}
.hero-img{position:relative;min-height:280px;background:var(--s);overflow:hidden}
.hero-img img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.deco{position:absolute;inset:0;background:radial-gradient(circle at 28% 32%,var(--a) 0 20%,transparent 21%),radial-gradient(circle at 72% 66%,var(--p) 0 28%,transparent 29%),var(--s)}
.sec{padding:clamp(28px,5vw,56px) clamp(16px,5vw,56px)}
.sec h2{font-size:clamp(24px,3vw,34px);margin-bottom:22px}
.cats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px}
.cat{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 18px;border-radius:var(--r);background:var(--s);color:var(--st);font-family:var(--ft);font-weight:${estilo.peso};text-decoration:none}
.grilla{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:22px}
.prod{display:flex;flex-direction:column;gap:6px}
.foto{position:relative;aspect-ratio:4/5;border-radius:var(--r);overflow:hidden;background:var(--s);color:var(--st);display:grid;place-items:center}
.foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.foto span{font-family:var(--ft);font-size:44px;font-weight:${estilo.peso};opacity:.45}
.prod h3{font-family:var(--fx);font-size:15px;font-weight:600;letter-spacing:0;text-transform:none}
.precio{margin-bottom:6px;font-weight:800;color:var(--pc)}
.agregar{margin-top:auto;padding:9px 12px;border:2px solid var(--pc);border-radius:var(--r);background:transparent;color:var(--pc);font:inherit;font-size:13px;font-weight:700}
.valores{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:26px;border-top:1px solid #e4e4e7}
.circ{display:grid;place-items:center;width:52px;height:52px;margin-bottom:12px;border-radius:50%;background:var(--s);color:var(--st)}
.circ svg{width:26px;height:26px}
.valor h3{font-size:18px;margin-bottom:4px}
.valor p{color:#52525b;font-size:15px}
.sobre{display:grid;grid-template-columns:1fr 1fr;gap:clamp(20px,4vw,56px);align-items:center;background:var(--s);color:var(--st)}
.sobre.solo{grid-template-columns:1fr}
.sobre p{font-size:17px;max-width:56ch}
.sobre img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.galeria{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.galeria img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--r)}
.pie{display:grid;gap:8px;padding:40px clamp(16px,5vw,56px);background:${PIE};color:#fff}
.pie strong{font-family:var(--ft);font-size:20px}
.pie small{opacity:.7}
@media (max-width:1000px){.grilla{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.hero{grid-template-columns:1fr}.hero-img{order:-1;min-height:240px}.cab nav{display:none}.ico{margin-left:auto}.sobre{grid-template-columns:1fr}}
@media (max-width:600px){.grilla{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.galeria{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

  const logo = p.logo ? `<img src="${esc(p.logo)}" alt="Logo de ${nombre}">` : nombre;
  const navegacion = (p.categorias.length ? p.categorias : ['Productos', 'Novedades', 'Nosotros', 'Contacto']).slice(0, 4);
  const productos = p.productos.length ? p.productos : [1, 2, 3, 4].map(() => ({ nombre: 'Producto de ejemplo', precio: '$ 0.000', foto: '' }));
  const fotos = p.fotos;
  const imagenPortada = fotos[0] ? `<img src="${esc(fotos[0].url)}" alt="">` : '<div class="deco" aria-hidden="true"></div>';
  const imagenSobre = fotos[1] || null;
  const galeria = fotos.slice(2, 8);
  const [v1, v2, v3] = textos.valores;
  const tarjeta = (pr) => {
    const imagen = pr.foto ? `<img src="${esc(pr.foto)}" alt="" loading="lazy">` : `<span>${esc(Array.from(pr.nombre)[0] || '·')}</span>`;
    return `<article class="prod"><div class="foto">${imagen}</div><h3>${esc(pr.nombre)}</h3><div class="precio">${esc(pr.precio)}</div><button class="agregar">Agregar</button></article>`;
  };

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`Maqueta · ${p.tienda.nombre}`)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(`https://fonts.googleapis.com/css2?${estilo.familias}&display=swap`)}">
<style>${css}</style></head><body>
<div class="cinta">MAQUETA · Así podría verse tu tienda. Los textos y los precios son de ejemplo.</div>
<div class="anuncio">${esc(textos.anuncio)}</div>
<header class="cab"><a class="marca" href="#">${logo}</a><nav aria-label="Principal">${navegacion.map((c) => `<a href="#productos">${esc(c)}</a>`).join('')}</nav><div class="ico">${ICONOS.buscar}${ICONOS.bolsa}</div></header>
<main>
<section class="hero"><div class="hero-txt"><h1>${esc(textos.eslogan)}</h1><p>${esc(textos.bajada)}</p><a class="btn" href="#productos">${esc(textos.boton)}</a></div><div class="hero-img">${imagenPortada}</div></section>
${p.categorias.length ? `<section class="sec"><h2>Categorías</h2><div class="cats">${p.categorias.map((c) => `<a class="cat" href="#productos"><span>${esc(c)}</span><span aria-hidden="true">→</span></a>`).join('')}</div></section>` : ''}
<section class="sec" id="productos"><h2>${p.productos.length ? 'Productos destacados' : 'Tus productos van acá'}</h2><div class="grilla">${productos.map(tarjeta).join('')}</div></section>
<section class="sec valores"><div class="valor"><div class="circ">${ICONOS.corazon}</div><h3>${esc(v1.titulo)}</h3><p>${esc(v1.texto)}</p></div><div class="valor"><div class="circ">${ICONOS.escudo}</div><h3>${esc(v2.titulo)}</h3><p>${esc(v2.texto)}</p></div><div class="valor"><div class="circ">${ICONOS.estrella}</div><h3>${esc(v3.titulo)}</h3><p>${esc(v3.texto)}</p></div></section>
<section class="sec sobre${imagenSobre ? '' : ' solo'}"><div><h2>${esc(textos.sobreTitulo)}</h2><p>${esc(textos.sobreTexto)}</p></div>${imagenSobre ? `<img src="${esc(imagenSobre.miniatura || imagenSobre.url)}" alt="" loading="lazy">` : ''}</section>
${galeria.length ? `<section class="sec"><h2>En imágenes</h2><div class="galeria">${galeria.map((f) => `<img src="${esc(f.miniatura || f.url)}" alt="" loading="lazy">`).join('')}</div></section>` : ''}
</main>
<footer class="pie"><strong>${nombre}</strong><span>${esc(textos.cierre)}</span><small>Maqueta de ejemplo hecha con VEZZA Shop. No es tu tienda real.</small></footer>
</body></html>`;
}

try {
  const estilo = ESTILOS[pedido.estilo] ? pedido.estilo : inferirEstilo(pedido.rubro);
  const { textos, conIA } = textosFinales(buscarTextosDeLaIA(salidaIA), textosDeEjemplo(pedido));
  const html = armarPagina(pedido, textos, ESTILOS[estilo]);
  if (html.length > 250000) throw new Error('La maqueta quedó demasiado grande');
  const colores = [pedido.colores.principal, pedido.colores.secundario, pedido.colores.acento].filter(Boolean).join(' · ');
  const { titulos, texto } = ESTILOS[estilo];
  const resumen = `Colores ${colores}. Estilo ${ESTILOS[estilo].nombre.toLowerCase()} (${titulos === texto ? titulos : `${titulos} y ${texto}`}). ${conIA ? 'Textos redactados con IA' : 'Textos de ejemplo'}.`;
  return [{ json: { respuesta: pedido.respuesta, token: pedido.token, estado: 'lista', html, resumen } }];
} catch (error) {
  return [{ json: { respuesta: pedido.respuesta, token: pedido.token, estado: 'error', error: 'No pudimos armar la maqueta. Probá de nuevo.' } }];
}
