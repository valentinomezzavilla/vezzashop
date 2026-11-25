// Valida el aviso que manda VEZZA Shop (src/notificaciones.js) y arma el mail.
// El secreto ya lo validó el nodo Webhook (Header Auth).
// Eventos de la plataforma (salen como VEZZA Shop): cuenta_creada, pago_recibido, plan_modificado y suscripcion_cancelada.
// Evento de una tienda (sale con el nombre de la tienda y responde a su contacto): pedido_actualizado.
const b = $input.first().json.body || {};
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
// Un texto de una sola línea (nombres, títulos): sin saltos de línea ni espacios de más. Va a asuntos y remitentes, donde un salto sería un problema.
const linea = (v, max) => clean(v, max).replace(/\s+/g, ' ');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
// Solo links https: este endpoint no sirve para mandar cualquier cosa.
const esLink = (v) => /^https:\/\/[^\s"'<>]{4,300}$/.test(v);
const esEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const EVENTOS = ['cuenta_creada', 'pago_recibido', 'plan_modificado', 'suscripcion_cancelada', 'pedido_actualizado'];
const evento = clean(b.evento, 30);
const destino = clean(b.email, 200).toLowerCase();
const nombre = linea(b.nombre, 120);
const plan = obj(b.plan);
const tienda = obj(b.tienda);
const planNombre = linea(plan.nombre, 80);
const planPrecio = linea(plan.precio, 40);
const tiendaNombre = linea(tienda.nombre, 120);
const urlPanel = clean(b.urlPanel, 300);
const urlCuenta = clean(b.urlCuenta, 300);
const urlReactivar = clean(b.urlReactivar, 300);
const urlTienda = esLink(clean(tienda.url, 300)) ? clean(tienda.url, 300) : '';

const errores = [];
if (!EVENTOS.includes(evento)) errores.push('evento');
if (!esEmail(destino)) errores.push('email');

const MARCA = 'VEZZA Shop <info@vezzadev.com>';
const CORREO = 'info@vezzadev.com';

// ---------- Mails de la plataforma (VEZZA Shop) ----------

// El marco de los mails de la plataforma. `parrafos`: textos; `extraHtml`/`extraTexto`: un bloque propio (por ejemplo, la lista de cambios).
function mailVezza({ etiqueta, titulo, tituloTexto, parrafos, extraHtml = '', extraTexto = [], boton, url, notaHtml = '', notaTexto = [], cierre }) {
  const link = esc(url);
  const html = `
<div style="background:#F5F3EE;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#15131C">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
    <tr><td style="padding:0 0 32px;font-size:22px;font-weight:800;letter-spacing:-0.5px">VE<span style="color:#3D2FE0">ZZ</span>A <span style="font-size:14px;font-weight:600;color:#514F5C">Shop</span></td></tr>
    <tr><td style="padding:0 0 8px;color:#3D2FE0;font-size:12px;font-weight:bold;letter-spacing:2px;text-transform:uppercase">${esc(etiqueta)}</td></tr>
    <tr><td style="padding:0 0 20px;font-size:28px;font-weight:800;line-height:1.15;letter-spacing:-0.5px">${titulo}</td></tr>
    ${parrafos.map((p) => `<tr><td style="padding:0 0 16px;font-size:16px;line-height:1.6;color:#514F5C">${esc(p)}</td></tr>`).join('\n    ')}
    ${extraHtml}
    <tr><td style="padding:8px 0 24px"><a href="${link}" style="display:inline-block;background:#3D2FE0;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:10px">${esc(boton)}</a></td></tr>
    ${notaHtml}
    <tr><td style="padding:16px 0;border-top:1px solid #15131C;font-size:13px;line-height:1.6;color:#514F5C">Si el botón no funciona, copiá este link en el navegador:<br><a href="${link}" style="color:#3D2FE0;word-break:break-all">${link}</a></td></tr>
    <tr><td style="padding:0 0 16px;font-size:14px;line-height:1.6;color:#514F5C">${esc(cierre)}</td></tr>
    <tr><td style="padding:8px 0 0;font-size:13px;line-height:1.6;color:#514F5C">VEZZA Shop · Tu tienda online, lista para vender<br><a href="https://vezzadev.com" style="color:#3D2FE0">vezzadev.com</a> · <a href="https://www.instagram.com/vezza.dev/" style="color:#3D2FE0">@vezza.dev</a></td></tr>
  </table>
</div>`;
  const text = [
    tituloTexto, '', ...parrafos, ...(extraTexto.length ? ['', ...extraTexto] : []), '', url, ...(notaTexto.length ? ['', ...notaTexto] : []), '', cierre, '',
    'VEZZA Shop · Tu tienda online, lista para vender', 'https://vezzadev.com · Instagram @vezza.dev',
  ].join('\n');
  return { html, text };
}

// ---------- Mails de una tienda a quien le compró ----------

// Sin comillas, <>, comas ni saltos de línea: el nombre de la tienda va en el remitente.
const nombreParaRemitente = (s) => s.replace(/[\r\n"<>,;:\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

function mailTienda({ tiendaNombre, tiendaUrl, etiqueta, titulo, mensaje, resumen, seguimiento, boton, url, contactoEmail, contactoWhatsapp }) {
  const filas = [];
  if (seguimiento) {
    if (seguimiento.empresa) filas.push(['Empresa', seguimiento.empresa]);
    if (seguimiento.codigo) filas.push(['N.º de seguimiento', seguimiento.codigo]);
    if (seguimiento.detalle) filas.push(['Aclaración', seguimiento.detalle]);
  }
  const bloqueSeguimiento = filas.length
    ? `<tr><td style="padding:0 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F6F7;border-radius:10px">${filas
        .map(([k, v]) => `<tr><td style="padding:10px 14px;font-size:13px;color:#6B6B74;width:40%">${esc(k)}</td><td style="padding:10px 14px;font-size:15px;font-weight:bold;color:#18181B">${esc(v)}</td></tr>`)
        .join('')}</table></td></tr>`
    : '';
  const botonSeguir = seguimiento && esLink(seguimiento.url)
    ? `<a href="${esc(seguimiento.url)}" style="display:inline-block;margin:0 8px 8px 0;background:#FFFFFF;color:#18181B;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 20px;border-radius:10px;border:1px solid #18181B">Seguir mi envío</a>`
    : '';
  const contacto = [
    contactoEmail && `<a href="mailto:${esc(contactoEmail)}" style="color:#18181B">${esc(contactoEmail)}</a>`,
    contactoWhatsapp && `<a href="${esc(contactoWhatsapp)}" style="color:#18181B">WhatsApp</a>`,
  ].filter(Boolean);
  const html = `
<div style="background:#F6F6F7;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#18181B">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:14px">
    <tr><td style="padding:28px 28px 0;font-size:20px;font-weight:800;letter-spacing:-0.4px">${tiendaUrl ? `<a href="${esc(tiendaUrl)}" style="color:#18181B;text-decoration:none">${esc(tiendaNombre)}</a>` : esc(tiendaNombre)}</td></tr>
    <tr><td style="padding:22px 28px 6px;color:#6B6B74;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">${esc(etiqueta)}</td></tr>
    <tr><td style="padding:0 28px 14px;font-size:24px;font-weight:800;line-height:1.2">${esc(titulo)}</td></tr>
    <tr><td style="padding:0 28px 18px;font-size:16px;line-height:1.6;color:#4F4F57">${esc(mensaje)}</td></tr>
    <tr><td style="padding:0 28px">${bloqueSeguimiento ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bloqueSeguimiento}</table>` : ''}</td></tr>
    <tr><td style="padding:0 28px 22px">${botonSeguir}<a href="${esc(url)}" style="display:inline-block;margin:0 8px 8px 0;background:#18181B;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 20px;border-radius:10px">${esc(boton)}</a></td></tr>
    <tr><td style="padding:0 28px 20px;font-size:13px;line-height:1.6;color:#6B6B74">${esc(resumen)}</td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #E7E7EA;font-size:13px;line-height:1.6;color:#6B6B74">${contacto.length ? `Consultas: ${contacto.join(' · ')}<br>` : ''}Mail enviado con VEZZA Shop.</td></tr>
  </table>
</div>`;
  const text = [
    tiendaNombre, '', etiqueta.toUpperCase(), titulo, '', mensaje,
    ...(filas.length ? ['', ...filas.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(seguimiento && esLink(seguimiento.url) ? ['', `Seguir mi envío: ${seguimiento.url}`] : []),
    '', `${boton}: ${url}`, '', resumen,
    ...(contactoEmail || contactoWhatsapp ? ['', `Consultas: ${[contactoEmail, contactoWhatsapp].filter(Boolean).join(' · ')}`] : []),
    '', 'Mail enviado con VEZZA Shop.',
  ].join('\n');
  return { html, text };
}

// ---------- Cada evento ----------

let asunto = '';
let html = '';
let text = '';
let desde = MARCA;
let responderA = CORREO;

const detallePlan = planNombre ? `plan ${planNombre}${planPrecio ? ' (' + planPrecio + ')' : ''}` : 'plan elegido';
const saludo = (cuando) => (nombre ? `Hola ${esc(nombre)},<br>${cuando}` : cuando.charAt(0).toUpperCase() + cuando.slice(1));
const saludoTexto = (frase) => (nombre ? `Hola ${nombre}, ${frase}.` : `${frase.charAt(0).toUpperCase() + frase.slice(1)}.`);

if (evento === 'cuenta_creada') {
  if (!esLink(urlPanel)) errores.push('urlPanel');
  const aviso = urlTienda
    ? { notaHtml: `<tr><td style="padding:0 0 24px;font-size:15px;line-height:1.6;color:#514F5C">Tu tienda va a estar en: <a href="${esc(urlTienda)}" style="color:#3D2FE0;font-weight:bold">${esc(urlTienda)}</a></td></tr>`, notaTexto: [`Tu tienda va a estar en: ${urlTienda}`] }
    : {};
  ({ html, text } = mailVezza({
    etiqueta: 'Cuenta creada',
    titulo: nombre ? `Hola ${esc(nombre)},<br>tu cuenta está lista` : 'Tu cuenta<br>está lista',
    tituloTexto: nombre ? `Hola ${nombre}, tu cuenta está lista.` : 'Tu cuenta está lista.',
    parrafos: [
      `Creamos tu cuenta de VEZZA Shop${tiendaNombre ? ' para ' + tiendaNombre : ''} con el ${detallePlan}.`,
      'Desde tu panel cargás tus productos, armás el diseño de tu tienda y gestionás tus pedidos. Ingresá con este email y la clave que elegiste.',
    ],
    boton: 'Ingresar a mi panel',
    url: urlPanel,
    ...aviso,
    cierre: 'Si no creaste esta cuenta, respondé este mail y la revisamos.',
  }));
  asunto = 'Tu cuenta de VEZZA Shop está lista';
} else if (evento === 'pago_recibido') {
  if (!esLink(urlCuenta)) errores.push('urlCuenta');
  ({ html, text } = mailVezza({
    etiqueta: 'Pago recibido',
    titulo: 'Recibimos<br>tu pago',
    tituloTexto: 'Recibimos tu pago.',
    parrafos: [`Recibimos tu suscripción al ${detallePlan}. Gracias por elegir VEZZA Shop.`, 'Falta un paso: crear tu cuenta. Completá tus datos desde este botón. El link vale 14 días.'],
    boton: 'Crear mi cuenta',
    url: urlCuenta,
    cierre: 'Si ya creaste tu cuenta, ignorá este mail. Si necesitás ayuda, respondé este mail.',
  }));
  asunto = 'Recibimos tu pago · creá tu cuenta de VEZZA Shop';
} else if (evento === 'plan_modificado') {
  const cambios = (Array.isArray(b.cambios) ? b.cambios : [])
    .slice(0, 10)
    .map((c) => ({ etiqueta: clean(obj(c).etiqueta, 60), antes: clean(obj(c).antes, 80), despues: clean(obj(c).despues, 80), cuando: clean(obj(c).cuando, 100) }))
    .filter((c) => c.etiqueta && c.despues);
  if (!esLink(urlPanel)) errores.push('urlPanel');
  if (cambios.length === 0) errores.push('cambios');
  const lista = `<tr><td style="padding:0 0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border:1px solid #D9D6CE;border-radius:10px">${cambios
    .map(
      (c) =>
        `<tr><td style="padding:12px 16px;border-bottom:1px solid #EFECE4;font-size:15px;line-height:1.5;color:#15131C"><strong>${esc(c.etiqueta)}</strong><br>${c.antes ? `<span style="color:#8A8794;text-decoration:line-through">${esc(c.antes)}</span> → ` : ''}<strong>${esc(c.despues)}</strong>${c.cuando ? `<br><span style="font-size:13px;color:#514F5C">${esc(c.cuando)}</span>` : ''}</td></tr>`,
    )
    .join('')}</table></td></tr>`;
  const textoLista = cambios.map((c) => `• ${c.etiqueta}: ${c.antes ? c.antes + ' → ' : ''}${c.despues}${c.cuando ? ' (' + c.cuando + ')' : ''}`);
  ({ html, text } = mailVezza({
    etiqueta: 'Tu plan cambió',
    titulo: saludo('cambió tu plan'),
    tituloTexto: saludoTexto('cambió tu plan'),
    parrafos: [`Te avisamos que hay cambios en el plan ${planNombre || 'que tenés'} de ${tiendaNombre || 'tu tienda'}:`],
    extraHtml: lista,
    extraTexto: textoLista,
    boton: 'Ir a mi panel',
    url: urlPanel,
    cierre: 'Si algo no te cierra o querés hablar de tu plan, respondé este mail y lo vemos. Lo que dice "desde ya" ya está aplicado.',
  }));
  asunto = planNombre ? `Cambios en tu plan ${planNombre} de VEZZA Shop` : 'Cambios en tu plan de VEZZA Shop';
} else if (evento === 'suscripcion_cancelada') {
  const hasta = clean(b.accesoHastaTexto, 60);
  const vigente = hasta && b.vencida !== true;
  if (!esLink(urlReactivar)) errores.push('urlReactivar');
  ({ html, text } = mailVezza({
    etiqueta: 'Suscripción cancelada',
    titulo: saludo('cancelaste tu suscripción'),
    tituloTexto: saludoTexto('cancelaste tu suscripción'),
    parrafos: [
      vigente
        ? `Cancelaste tu suscripción${planNombre ? ' al plan ' + planNombre : ''}: no se te van a cobrar más meses. Tu tienda${tiendaNombre ? ' ' + tiendaNombre : ''} sigue funcionando hasta el ${hasta}.`
        : `Cancelaste tu suscripción${planNombre ? ' al plan ' + planNombre : ''}: no se te van a cobrar más meses. Tu tienda${tiendaNombre ? ' ' + tiendaNombre : ''} ya no tiene días pagos.`,
      'Tus productos, pedidos y diseño siguen guardados. Cuando quieras volver, reactivás la suscripción desde tu panel y seguís donde lo dejaste.',
    ],
    boton: 'Reactivar mi suscripción',
    url: urlReactivar,
    cierre: 'Si cancelaste por error o necesitás ayuda, respondé este mail.',
  }));
  asunto = 'Cancelaste tu suscripción de VEZZA Shop';
} else if (evento === 'pedido_actualizado') {
  const pedido = obj(b.pedido);
  const seg = b.seguimiento && typeof b.seguimiento === 'object' ? b.seguimiento : null;
  const titulo = linea(b.titulo, 150);
  const mensaje = clean(b.mensaje, 400);
  const urlPedido = clean(pedido.url, 300);
  const contactoEmail = esEmail(clean(tienda.email, 200).toLowerCase()) ? clean(tienda.email, 200).toLowerCase() : '';
  const contactoWhatsapp = esLink(clean(tienda.whatsapp, 300)) ? clean(tienda.whatsapp, 300) : '';
  if (!titulo) errores.push('titulo');
  if (!tiendaNombre) errores.push('tienda');
  if (!esLink(urlPedido)) errores.push('urlPedido');
  const numero = clean(pedido.numero, 12);
  const resumen = ['Pedido #' + numero, pedido.estado && 'Estado: ' + clean(pedido.estado, 40), pedido.total && 'Total: ' + clean(pedido.total, 40)].filter(Boolean).join(' · ');
  ({ html, text } = mailTienda({
    tiendaNombre,
    tiendaUrl: urlTienda,
    etiqueta: numero ? 'Tu pedido #' + numero : 'Tu pedido',
    titulo,
    mensaje,
    resumen,
    seguimiento: seg ? { empresa: clean(seg.empresa, 60), codigo: clean(seg.codigo, 60), detalle: clean(seg.detalle, 150), url: clean(seg.url, 300) } : null,
    boton: 'Ver mi pedido',
    url: urlPedido,
    contactoEmail,
    contactoWhatsapp,
  }));
  asunto = `${titulo} · ${tiendaNombre}`.slice(0, 200);
  const nombreRemitente = nombreParaRemitente(tiendaNombre);
  desde = nombreRemitente ? `${nombreRemitente} <${CORREO}>` : MARCA;
  responderA = contactoEmail || CORREO;
}

return [{ json: { valido: errores.length === 0, errores, destino, asunto, html, text, desde, responderA } }];
