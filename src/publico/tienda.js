// Comportamiento de la vidriera. Todo funciona sin JavaScript; esto solo lo hace más cómodo.

// Ficha de producto: al elegir talle, color, etc., muestra precio, stock y link de WhatsApp de esa variante.
function selectorDeVariantes() {
  const datos = document.getElementById('variantes');
  if (!datos) return;
  const variantes = JSON.parse(datos.textContent);
  const radios = [...document.querySelectorAll('[data-atributo]')];
  const grupos = Math.max(...radios.map((r) => Number(r.dataset.atributo))) + 1;
  const campo = (nombre) => document.querySelector(`[data-${nombre}]`);
  const elementos = Object.fromEntries(
    ['precio', 'precio-lista', 'off', 'off-numero', 'cuota', 'transferencia', 'stock', 'sku', 'whatsapp'].map((n) => [n, campo(n)]),
  );

  const elegidos = () =>
    Array.from({ length: grupos }, (_, n) => radios.find((r) => r.dataset.atributo === String(n) && r.checked)?.value);
  const coincide = (variante, valores) => variante.valores.every((valor, n) => valores[n] === undefined || valor === valores[n]);

  // Marca las opciones que no existen o no tienen stock combinadas con lo demás que está elegido.
  function marcarDisponibilidad(actuales) {
    for (const radio of radios) {
      const n = Number(radio.dataset.atributo);
      const prueba = actuales.map((valor, i) => (i === n ? radio.value : valor));
      const variante = variantes.find((v) => coincide(v, prueba));
      radio.closest('.opcion').classList.toggle('sin-stock', !variante || !variante.hayStock);
    }
  }

  function mostrar(variante) {
    const e = elementos;
    e.precio.textContent = variante.precio;
    e['precio-lista'].hidden = !variante.precioLista;
    e['precio-lista'].textContent = variante.precioLista ?? '';
    e.off.hidden = !variante.off;
    e['off-numero'].textContent = variante.off ?? '';
    if (e.cuota) e.cuota.textContent = variante.cuota;
    if (e.transferencia) e.transferencia.textContent = variante.transferencia;
    e.stock.textContent = variante.stock.texto;
    e.stock.className = `stock ${variante.stock.clase}`;
    e.sku.textContent = variante.sku;
    if (e.whatsapp) e.whatsapp.href = variante.whatsapp;
  }

  function alCambiar(evento) {
    const cambiado = Number(evento.target.dataset.atributo);
    let actuales = elegidos();
    let variante = variantes.find((v) => coincide(v, actuales));
    // Si la combinación no existe, se acomodan los otros atributos a una que sí exista (mejor con stock).
    if (!variante) {
      const candidatas = variantes.filter((v) => v.valores[cambiado] === actuales[cambiado]);
      variante = candidatas.find((v) => v.hayStock) ?? candidatas[0];
      for (const radio of radios) radio.checked = radio.value === variante.valores[Number(radio.dataset.atributo)];
      actuales = elegidos();
    }
    actuales.forEach((valor, n) => (document.querySelector(`[data-elegido="${n}"]`).textContent = valor));
    marcarDisponibilidad(actuales);
    mostrar(variante);
  }

  for (const radio of radios) radio.addEventListener('change', alCambiar);
  marcarDisponibilidad(elegidos());
}

// Catálogo: reordena apenas se elige una opción, sin tener que tocar "Ordenar".
function selectorDeOrden() {
  const formulario = document.querySelector('[data-ordenar]');
  if (!formulario) return;
  formulario.querySelector('[data-sin-js]').hidden = true;
  formulario.querySelector('select').addEventListener('change', () => formulario.submit());
}

// Portada: carrusel de banners con flechas, puntos y avance automático.
function carrusel() {
  const contenedor = document.querySelector('[data-carrusel]');
  const pista = contenedor?.querySelector('[data-pista]');
  if (!pista || pista.children.length < 2) return;
  const total = pista.children.length;
  const puntos = [...contenedor.querySelectorAll('[data-punto]')];
  const actual = () => Math.round(pista.scrollLeft / pista.clientWidth);

  const ir = (indice) => pista.scrollTo({ left: (((indice % total) + total) % total) * pista.clientWidth, behavior: 'smooth' });
  contenedor.querySelector('[data-anterior]').addEventListener('click', () => ir(actual() - 1));
  contenedor.querySelector('[data-siguiente]').addEventListener('click', () => ir(actual() + 1));
  for (const punto of puntos) punto.addEventListener('click', () => ir(Number(punto.dataset.punto)));

  // Los puntos siguen al banner visible, también cuando se desliza con el dedo.
  let espera;
  pista.addEventListener('scroll', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      puntos.forEach((punto, n) => (n === actual() ? punto.setAttribute('aria-current', 'true') : punto.removeAttribute('aria-current')));
    }, 60);
  });

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let pausado = false;
  for (const [evento, valor] of [['mouseenter', true], ['mouseleave', false], ['focusin', true], ['focusout', false], ['touchstart', true]]) {
    contenedor.addEventListener(evento, () => (pausado = valor), { passive: true });
  }
  setInterval(() => !pausado && !document.hidden && ir(actual() + 1), 6000);
}

// Menú del celular: se cierra con Escape o al tocar afuera.
function menuMovil() {
  const menu = document.querySelector('[data-menu-movil]');
  if (!menu) return;
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', (evento) => {
    if (menu.open && !menu.contains(evento.target)) menu.open = false;
  });
  menu.addEventListener('toggle', () => {
    menu.querySelector('summary').setAttribute('aria-label', menu.open ? 'Cerrar el menú' : 'Abrir el menú');
  });
}

// Ficha: galería de fotos. Las miniaturas llevan a cada foto y se marcan al deslizar.
function galeria() {
  const pista = document.querySelector('[data-galeria-pista]');
  const miniaturas = [...document.querySelectorAll('[data-galeria-ir]')];
  if (!pista || miniaturas.length === 0) return;
  const actual = () => Math.round(pista.scrollLeft / pista.clientWidth);
  const ir = (n) => pista.scrollTo({ left: n * pista.clientWidth, behavior: 'smooth' });
  for (const miniatura of miniaturas) miniatura.addEventListener('click', () => ir(Number(miniatura.dataset.galeriaIr)));
  pista.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowRight') ir(Math.min(actual() + 1, miniaturas.length - 1));
    if (evento.key === 'ArrowLeft') ir(Math.max(actual() - 1, 0));
  });
  let espera;
  pista.addEventListener('scroll', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      miniaturas.forEach((m, n) => (n === actual() ? m.setAttribute('aria-current', 'true') : m.removeAttribute('aria-current')));
    }, 60);
  });
}

selectorDeVariantes();
selectorDeOrden();
carrusel();
menuMovil();
galeria();
