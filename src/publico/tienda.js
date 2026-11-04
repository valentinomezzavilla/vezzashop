// Comportamiento de la vidriera. Navegar, filtrar y buscar funciona sin JavaScript;
// esto suma el carrito, las sugerencias del buscador, la galería y los atajos.

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => [...raiz.querySelectorAll(selector)];
const PESOS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const pesos = (centavos) => PESOS.format(centavos / 100);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// Crea un elemento con atributos e hijos. Los textos van siempre como texto, nunca como HTML.
function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'texto') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else nodo.setAttribute(clave, valor === true ? '' : valor);
  }
  nodo.append(...hijos.filter(Boolean));
  return nodo;
}

// Anuncia un cambio a los lectores de pantalla sin mover el foco ("2 productos en el carrito").
function anunciar(texto) {
  const region = $('[data-anuncio]');
  if (!region) return;
  region.textContent = '';
  setTimeout(() => (region.textContent = texto), 50);
}

// Los paneles (<dialog>) se cierran con sus botones [data-cerrar], con Escape o tocando afuera.
function prepararPanel(dialogo) {
  if (!dialogo) return;
  for (const boton of $$('[data-cerrar]', dialogo)) boton.addEventListener('click', () => dialogo.close());
  dialogo.addEventListener('click', (evento) => {
    if (evento.target === dialogo) dialogo.close();
  });
}

// ---------- Carrito (vive en el navegador; termina en /checkout o, si la tienda no lo usa, en WhatsApp) ----------

const carrito = (() => {
  const CLAVE = 'carrito';
  const MAXIMO = 50;
  const leer = () => {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE) ?? '[]');
      return Array.isArray(datos) ? datos.filter((i) => typeof i?.sku === 'string' && Number.isInteger(i.cantidad) && i.cantidad > 0) : [];
    } catch {
      return [];
    }
  };
  const guardar = (items) => {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(items));
    } catch {
      // Sin almacenamiento (modo privado): el carrito dura lo que dura la página.
    }
    document.dispatchEvent(new CustomEvent('carrito-cambio'));
  };
  let enMemoria = null;
  const items = () => enMemoria ?? (enMemoria = leer());
  const fijar = (nuevos) => {
    enMemoria = nuevos;
    guardar(nuevos);
  };
  return {
    items,
    cantidadTotal: () => items().reduce((suma, i) => suma + i.cantidad, 0),
    agregar(sku, cantidad, maximo) {
      const actuales = items();
      const existente = actuales.find((i) => i.sku === sku);
      const tope = Math.min(maximo ?? MAXIMO, MAXIMO);
      if (existente) existente.cantidad = Math.min(existente.cantidad + cantidad, tope);
      else actuales.push({ sku, cantidad: Math.min(cantidad, tope) });
      fijar([...actuales]);
    },
    cambiar(sku, cantidad) {
      fijar(items().map((i) => (i.sku === sku ? { ...i, cantidad } : i)).filter((i) => i.cantidad > 0));
    },
    quitar(sku) {
      fijar(items().filter((i) => i.sku !== sku));
    },
    vaciar: () => fijar([]),
    reemplazar: (nuevos) => fijar(nuevos.map(({ sku, cantidad }) => ({ sku, cantidad }))),
  };
})();

function panelCarrito() {
  const dialogo = $('[data-carrito]');
  const botonAbrir = $('[data-abrir-carrito]');
  if (!dialogo || !botonAbrir) return { abrir() {} };
  prepararPanel(dialogo);
  botonAbrir.hidden = false;
  const contador = $('[data-contador-carrito]');
  const lista = $('[data-carrito-items]', dialogo);
  const pie = $('[data-carrito-pie]', dialogo);
  const conCheckout = 'checkout' in dialogo.dataset;

  function actualizarContador() {
    const n = carrito.cantidadTotal();
    contador.hidden = n === 0;
    contador.textContent = n > 99 ? '99+' : String(n);
    botonAbrir.setAttribute('aria-label', n ? `Carrito: ${plural(n, 'producto', 'productos')}` : 'Carrito vacío');
  }

  function vacio() {
    pie.hidden = true;
    lista.replaceChildren(
      el('div', { class: 'carrito-vacio' },
        el('p', { class: 'carrito-vacio-titulo', texto: 'Tu carrito está vacío' }),
        el('p', { texto: conCheckout ? 'Agregá productos para hacer tu pedido.' : 'Agregá productos y mandanos el pedido por WhatsApp.' }),
        el('button', { class: 'boton', type: 'button', texto: 'Ver productos', onclick: () => (dialogo.close(), location.assign('/')) })),
    );
  }

  async function dibujar() {
    const items = carrito.items();
    if (items.length === 0) return vacio();
    lista.setAttribute('aria-busy', 'true');
    let variantes = [];
    try {
      const respuesta = await fetch(`/api/carrito?skus=${encodeURIComponent(items.map((i) => i.sku).join(','))}`);
      ({ variantes } = await respuesta.json());
    } catch {
      lista.replaceChildren(el('p', { class: 'carrito-error', texto: 'No pudimos cargar el carrito. Revisá tu conexión y probá de nuevo.' }));
      return;
    } finally {
      lista.removeAttribute('aria-busy');
    }

    // Se ajusta lo guardado a lo que hay: productos que ya no están y cantidades mayores al stock.
    const porSku = new Map(variantes.map((v) => [v.sku, v]));
    const ajustados = items
      .filter((i) => porSku.has(i.sku))
      .map((i) => ({ ...i, cantidad: Math.min(i.cantidad, Math.max(porSku.get(i.sku).disponibles, 0)) }));
    const cambiaron = ajustados.length !== items.length || ajustados.some((i, n) => i.cantidad !== items[n]?.cantidad);
    if (cambiaron) {
      carrito.vaciar();
      for (const i of ajustados) if (i.cantidad > 0) carrito.agregar(i.sku, i.cantidad);
    }
    const lineas = carrito.items().map((i) => ({ ...porSku.get(i.sku), cantidad: i.cantidad }));
    if (lineas.length === 0) return vacio();

    lista.replaceChildren(
      ...(cambiaron ? [el('p', { class: 'carrito-aviso', texto: 'Actualizamos tu carrito con el stock disponible.' })] : []),
      el('ul', { class: 'carrito-lista' }, ...lineas.map(lineaCarrito)),
    );
    const total = lineas.reduce((suma, l) => suma + l.precioFinal * l.cantidad, 0);
    $('[data-carrito-total]', dialogo).textContent = pesos(total);
    if (conCheckout) $('[data-carrito-checkout]', dialogo).href = urlCheckout(lineas);
    else $('[data-carrito-enviar]', dialogo).href = mensajeWhatsapp(lineas, total);
    pie.hidden = false;
  }

  function lineaCarrito(l) {
    const cambiar = (delta) => {
      const nueva = Math.min(Math.max(l.cantidad + delta, 0), l.disponibles);
      if (nueva === 0) return quitar();
      carrito.cambiar(l.sku, nueva);
      anunciar(`${l.nombre}: ${plural(nueva, 'unidad', 'unidades')}`);
      dibujar();
    };
    const quitar = () => {
      carrito.quitar(l.sku);
      anunciar(`Quitaste ${l.nombre} del carrito`);
      dibujar();
    };
    return el('li', { class: 'carrito-linea' },
      el('a', { class: 'carrito-foto', href: l.url, tabindex: '-1', 'aria-hidden': 'true' },
        l.foto ? el('img', { src: l.foto, alt: '', loading: 'lazy' }) : el('span', { texto: l.nombre.charAt(0) })),
      el('div', { class: 'carrito-datos' },
        el('a', { class: 'carrito-nombre', href: l.url, texto: l.nombre }),
        l.detalle ? el('span', { class: 'carrito-detalle', texto: l.detalle }) : null,
        el('span', { class: 'carrito-precio', texto: pesos(l.precioFinal) }),
        el('div', { class: 'carrito-controles' },
          el('div', { class: 'cantidad-selector cantidad-selector-chico' },
            el('button', { class: 'cantidad-boton', type: 'button', 'aria-label': `Una unidad menos de ${l.nombre}`, texto: '−', onclick: () => cambiar(-1) }),
            el('span', { class: 'cantidad-valor', texto: String(l.cantidad), 'aria-label': `${plural(l.cantidad, 'unidad', 'unidades')}` }),
            el('button', {
              class: 'cantidad-boton', type: 'button', 'aria-label': `Una unidad más de ${l.nombre}`, texto: '+',
              disabled: l.cantidad >= l.disponibles, onclick: () => cambiar(1),
            })),
          el('button', { class: 'enlace carrito-quitar', type: 'button', texto: 'Quitar', 'aria-label': `Quitar ${l.nombre}`, onclick: quitar }))),
      el('strong', { class: 'carrito-subtotal', texto: pesos(l.precioFinal * l.cantidad) }));
  }

  function mensajeWhatsapp(lineas, total) {
    const renglones = lineas.map((l) =>
      `• ${l.cantidad} × ${l.nombre}${l.detalle ? ` (${l.detalle})` : ''} — ${pesos(l.precioFinal * l.cantidad)}\n   SKU ${l.sku}`);
    const texto = [
      `¡Hola ${dialogo.dataset.tienda}! Quiero hacer este pedido:`,
      '',
      ...renglones,
      '',
      `Total: ${pesos(total)}`,
      '',
      '¿Me confirmás el stock y cómo seguimos con el pago y el envío?',
    ].filter((r) => r !== null).join('\n');
    return `https://wa.me/${dialogo.dataset.whatsapp}?text=${encodeURIComponent(texto)}`;
  }

  botonAbrir.addEventListener('click', () => abrir());
  // Si se cambia el carrito estando en el checkout, el checkout se vuelve a armar con lo nuevo al cerrar el panel.
  let alAbrir = '';
  dialogo.addEventListener('close', () => {
    if (location.pathname !== '/checkout' || JSON.stringify(carrito.items()) === alAbrir) return;
    location.assign(carrito.items().length ? urlCheckout(carrito.items()) : '/checkout');
  });
  document.addEventListener('carrito-cambio', actualizarContador);
  window.addEventListener('storage', (evento) => evento.key === 'carrito' && actualizarContador());
  actualizarContador();

  function abrir() {
    alAbrir = JSON.stringify(carrito.items());
    dialogo.showModal();
    dibujar();
  }
  return { abrir };
}

// /checkout?sku=A&cantidad=2&sku=B&cantidad=1
function urlCheckout(lineas) {
  const parametros = new URLSearchParams();
  for (const { sku, cantidad } of lineas) {
    parametros.append('sku', sku);
    parametros.append('cantidad', String(cantidad));
  }
  return `/checkout?${parametros}`;
}

// ---------- Checkout: total en vivo según la entrega y el pago elegidos ----------

function checkout(panel) {
  const datosScript = document.getElementById('datos-checkout');
  if (!datosScript) return;
  const datos = JSON.parse(datosScript.textContent);
  // Se entró a /checkout sin productos en el link: se arma con el carrito guardado, si hay.
  if (datos.sinItems) {
    if (carrito.items().length) location.replace(urlCheckout(carrito.items()));
    return;
  }
  // Lo que quedó en el checkout (con el stock de ahora) pasa a ser el carrito.
  if (JSON.stringify(carrito.items()) !== JSON.stringify(datos.carrito)) carrito.reemplazar(datos.carrito);

  const formulario = $('[data-checkout-formulario]');
  if (!formulario) return;
  const direccion = $('[data-direccion]', formulario);
  const total = (clave) => $(`[data-total="${clave}"]`, formulario);
  const elegido = (nombre) => $(`input[name="${nombre}"]:checked`, formulario)?.value;

  function actualizar() {
    const entrega = datos.entregas.find((e) => e.id === elegido('entrega'));
    // El efectivo solo con las entregas que lo aceptan.
    const efectivo = $('[data-opcion-pago="efectivo"]', formulario);
    if (efectivo) {
      const noDisponible = Boolean(entrega && !entrega.aceptaEfectivo);
      const radio = $('input', efectivo);
      radio.disabled = noDisponible;
      if (noDisponible) radio.checked = false;
      efectivo.classList.toggle('no-disponible', noDisponible);
      $('[data-sin-efectivo]', efectivo).hidden = !noDisponible;
    }
    const pago = datos.pagos.find((p) => p.clave === elegido('pago'));

    // La dirección solo cuando hay que mandarlo. Deshabilitada no se valida ni se envía.
    const conDireccion = entrega ? entrega.tipo === 'domicilio' : datos.entregas.some((e) => e.tipo === 'domicilio');
    direccion.hidden = !conDireccion;
    direccion.disabled = !conDireccion;

    const porcentaje = pago?.descuento ?? 0;
    const descuento = Math.round((datos.subtotal * porcentaje) / 100);
    const envio = !entrega || entrega.costo === null ? null
      : entrega.gratisDesde !== null && datos.subtotal >= entrega.gratisDesde ? 0 : entrega.costo;
    total('porcentaje').textContent = String(porcentaje);
    total('descuento').textContent = `−${pesos(descuento)}`;
    $('[data-fila-descuento]', formulario).hidden = descuento === 0;
    total('envio').textContent = !entrega ? 'Elegí la entrega' : envio === null ? 'A coordinar' : envio === 0 ? 'Gratis' : pesos(envio);
    total('total').textContent = pesos(datos.subtotal - descuento + (envio ?? 0));
    $('[data-mas-envio]', formulario).hidden = !(entrega && envio === null);
  }
  formulario.addEventListener('change', (evento) => {
    if (evento.target.matches('[data-entrega], [data-pago]')) actualizar();
  });
  actualizar();

  // "Modificar el carrito" abre el panel del carrito en vez de irse.
  $('[data-editar-carrito]', formulario)?.addEventListener('click', (evento) => {
    evento.preventDefault();
    panel.abrir();
  });

  const boton = $('[data-confirmar]', formulario);
  formulario.addEventListener('submit', (evento) => {
    if (!formulario.checkValidity()) {
      // Marca lo que falta en el primer campo con problemas, con el mensaje del navegador.
      evento.preventDefault();
      formulario.reportValidity();
      return;
    }
    // Evita pedidos duplicados por doble clic.
    setTimeout(() => (boton.disabled = true), 0);
    boton.setAttribute('aria-busy', 'true');
  });
  // Si se vuelve a la página con "atrás", el botón tiene que andar de nuevo.
  window.addEventListener('pageshow', () => {
    boton.disabled = false;
    boton.removeAttribute('aria-busy');
  });
}

// ---------- Pedido confirmado ----------

function paginaDePedido() {
  if ($('[data-pedido-nuevo]')) {
    carrito.vaciar();
    // Sin el ?nuevo=1: si después se vuelve a abrir el link, no se vacía un carrito nuevo.
    history.replaceState(null, '', location.pathname);
  }
  for (const boton of $$('[data-copiar]')) {
    const texto = $('[data-copiar-texto]', boton);
    boton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(boton.dataset.copiar);
        texto.textContent = '¡Copiado!';
        anunciar('Copiado');
      } catch {
        texto.textContent = 'Copialo a mano';
      }
      setTimeout(() => (texto.textContent = 'Copiar'), 2000);
    });
  }
}

// ---------- Ficha: variantes, cantidad, agregar al carrito ----------

function fichaDeProducto(panel) {
  const datos = document.getElementById('variantes');
  if (!datos) return;
  const variantes = JSON.parse(datos.textContent);
  const radios = $$('[data-atributo]');
  const grupos = radios.length ? Math.max(...radios.map((r) => Number(r.dataset.atributo))) + 1 : 0;
  const campo = (nombre) => $(`[data-${nombre}]`);
  const e = Object.fromEntries(
    ['precio', 'precio-lista', 'off', 'off-numero', 'cuota', 'transferencia', 'stock', 'sku', 'whatsapp',
      'comprar', 'avisame', 'cantidad', 'agregar', 'barra-precio', 'barra-agregar', 'barra-compra'].map((n) => [n, campo(n)]),
  );
  const nombre = $('[data-ficha]').dataset.nombre;

  const elegidos = () =>
    Array.from({ length: grupos }, (_, n) => radios.find((r) => r.dataset.atributo === String(n) && r.checked)?.value);
  const coincide = (variante, valores) => variante.valores.every((valor, n) => valores[n] === undefined || valor === valores[n]);
  let actual = variantes.find((v) => coincide(v, elegidos())) ?? variantes[0];

  // Marca las opciones que no existen o no tienen stock combinadas con lo demás que está elegido.
  function marcarDisponibilidad(valores) {
    for (const radio of radios) {
      const n = Number(radio.dataset.atributo);
      const prueba = valores.map((valor, i) => (i === n ? radio.value : valor));
      const variante = variantes.find((v) => coincide(v, prueba));
      radio.closest('.opcion').classList.toggle('sin-stock', !variante || !variante.hayStock);
    }
  }

  function mostrar(variante) {
    actual = variante;
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
    if (e.whatsapp && variante.whatsapp) e.whatsapp.href = variante.whatsapp;
    if (e.comprar) {
      e.comprar.hidden = !variante.hayStock;
      if (e.avisame) {
        e.avisame.hidden = variante.hayStock;
        e.avisame.href = variante.avisame;
      }
      e.cantidad.max = variante.disponibles;
      e.cantidad.value = Math.min(Math.max(Number(e.cantidad.value) || 1, 1), Math.max(variante.disponibles, 1));
      e['barra-precio'].textContent = variante.precio;
      e['barra-agregar'].disabled = !variante.hayStock;
    }
  }

  function alCambiar(evento) {
    const cambiado = Number(evento.target.dataset.atributo);
    let valores = elegidos();
    let variante = variantes.find((v) => coincide(v, valores));
    // Si la combinación no existe, se acomodan los otros atributos a una que sí exista (mejor con stock).
    if (!variante) {
      const candidatas = variantes.filter((v) => v.valores[cambiado] === valores[cambiado]);
      variante = candidatas.find((v) => v.hayStock) ?? candidatas[0];
      for (const radio of radios) radio.checked = radio.value === variante.valores[Number(radio.dataset.atributo)];
      valores = elegidos();
    }
    valores.forEach((valor, n) => ($(`[data-elegido="${n}"]`).textContent = valor));
    marcarDisponibilidad(valores);
    mostrar(variante);
  }
  for (const radio of radios) radio.addEventListener('change', alCambiar);
  marcarDisponibilidad(elegidos());

  if (!e.comprar) return;

  // Cantidad: botones − / + y el campo, siempre entre 1 y el stock.
  const acotar = () => {
    e.cantidad.value = Math.min(Math.max(Number.parseInt(e.cantidad.value, 10) || 1, 1), Math.max(actual.disponibles, 1));
  };
  for (const boton of $$('[data-cantidad-cambio]')) {
    boton.addEventListener('click', () => {
      e.cantidad.value = Number(e.cantidad.value) + Number(boton.dataset.cantidadCambio);
      acotar();
    });
  }
  e.cantidad.addEventListener('change', acotar);

  function agregar() {
    if (!actual.hayStock) return;
    acotar();
    const cantidad = Number(e.cantidad.value);
    carrito.agregar(actual.sku, cantidad, actual.disponibles);
    anunciar(`Agregaste ${plural(cantidad, 'unidad', 'unidades')} de ${nombre} al carrito`);
    e.agregar.classList.add('agregado');
    setTimeout(() => e.agregar.classList.remove('agregado'), 900);
    panel.abrir();
  }
  e.agregar.disabled = false;
  e.agregar.addEventListener('click', agregar);
  e['barra-agregar'].addEventListener('click', agregar);
  mostrar(actual);

  // Barra fija del celular: aparece cuando el botón "Agregar" queda arriba, fuera de la pantalla.
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entrada]) => {
      const visible = actual.hayStock && !entrada.isIntersecting && entrada.boundingClientRect.bottom < 0;
      e['barra-compra'].classList.toggle('visible', visible);
      e['barra-compra'].setAttribute('aria-hidden', String(!visible));
      e['barra-agregar'].tabIndex = visible ? 0 : -1;
    }).observe(e.comprar);
  }
}

// ---------- Compartir ----------

function botonCompartir() {
  const boton = $('[data-compartir]');
  if (!boton) return;
  boton.addEventListener('click', async () => {
    const datos = { title: document.title, url: location.href };
    if (navigator.share) {
      try {
        await navigator.share(datos);
      } catch {
        // El visitante cerró el menú de compartir.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      anunciar('Copiamos el link del producto');
      boton.classList.add('copiado');
      setTimeout(() => boton.classList.remove('copiado'), 1500);
    } catch {
      anunciar('No pudimos copiar el link. Copialo desde la barra de direcciones.');
    }
  });
}

// ---------- Buscador con sugerencias ----------

function buscador() {
  const dialogo = $('[data-buscador]');
  const abrir = $('[data-abrir-buscador]');
  if (!dialogo || !abrir) return;
  prepararPanel(dialogo);
  const entrada = $('[data-buscador-entrada]', dialogo);
  const sugerencias = $('[data-sugerencias]', dialogo);
  abrir.addEventListener('click', (evento) => {
    evento.preventDefault();
    dialogo.showModal();
    entrada.select();
  });
  document.addEventListener('keydown', (evento) => {
    // "/" abre el buscador, como en muchos sitios, salvo que se esté escribiendo en un campo.
    if (evento.key === '/' && !evento.target.closest('input, textarea, select, [contenteditable]') && !dialogo.open) {
      evento.preventDefault();
      dialogo.showModal();
      entrada.select();
    }
  });

  let espera;
  let pedido;
  entrada.addEventListener('input', () => {
    clearTimeout(espera);
    const texto = entrada.value.trim();
    if (texto.length < 2) return sugerencias.replaceChildren();
    espera = setTimeout(async () => {
      pedido?.abort();
      pedido = new AbortController();
      try {
        const respuesta = await fetch(`/api/buscar?q=${encodeURIComponent(texto)}`, { signal: pedido.signal });
        mostrarSugerencias(texto, await respuesta.json());
      } catch (error) {
        if (error.name !== 'AbortError') sugerencias.replaceChildren();
      }
    }, 180);
  });

  function mostrarSugerencias(texto, { total, productos }) {
    if (total === 0) {
      sugerencias.replaceChildren(el('p', { class: 'sugerencias-vacio', texto: `No encontramos "${texto}". Probá con otra palabra.` }));
      return;
    }
    // replaceChildren convierte null en el texto "null": por eso el filter.
    sugerencias.replaceChildren(...[
      el('ul', { class: 'sugerencias-lista', role: 'list' },
        ...productos.map((p) =>
          el('li', {},
            el('a', { class: 'sugerencia', href: p.url },
              el('span', { class: 'sugerencia-foto', 'aria-hidden': 'true' },
                p.foto ? el('img', { src: p.foto, alt: '', loading: 'lazy' }) : el('span', { texto: p.nombre.charAt(0) })),
              el('span', { class: 'sugerencia-nombre', texto: p.nombre }),
              el('span', { class: 'sugerencia-precio', texto: p.precio }))))),
      total > productos.length
        ? el('a', { class: 'sugerencias-todas', href: `/buscar?q=${encodeURIComponent(texto)}`, texto: `Ver los ${total} resultados` })
        : null,
    ].filter(Boolean));
  }
}

// ---------- Catálogo: orden y "Ver más" ----------

function selectorDeOrden() {
  const formulario = $('[data-ordenar]');
  if (!formulario) return;
  $('[data-sin-js]', formulario).hidden = true;
  $('select', formulario).addEventListener('change', () => formulario.submit());
}

// Trae la página siguiente y suma sus productos a la grilla, sin recargar. Sin JavaScript es un link común.
function verMas() {
  const boton = $('[data-ver-mas]');
  const grilla = $('[data-grilla]');
  if (!boton || !grilla) return;
  boton.addEventListener('click', async (evento) => {
    evento.preventDefault();
    boton.setAttribute('aria-busy', 'true');
    boton.textContent = 'Cargando…';
    try {
      const html = await (await fetch(boton.href)).text();
      const pagina = new DOMParser().parseFromString(html, 'text/html');
      const nuevos = $$('[data-grilla] > li', pagina);
      // Sin view-transition-name en lo agregado, para que no se repitan nombres en la página.
      for (const foto of $$('.foto', pagina)) foto.style.removeProperty('view-transition-name');
      grilla.append(...nuevos);
      nuevos[0]?.querySelector('a')?.focus({ preventScroll: true });
      anunciar(`Se cargaron ${plural(nuevos.length, 'producto más', 'productos más')}`);
      const siguiente = $('[data-ver-mas]', pagina);
      $('[data-mostrando]').textContent = $('[data-mostrando]', pagina)?.textContent ?? '';
      history.replaceState(null, '', boton.href);
      if (siguiente) {
        boton.href = siguiente.href;
        boton.textContent = 'Ver más productos';
      } else {
        boton.closest('.paginacion').remove();
      }
    } catch {
      boton.textContent = 'No se pudo cargar. Tocá para reintentar';
    } finally {
      boton.removeAttribute('aria-busy');
    }
  });
}

// ---------- Portada: carrusel de banners ----------

function carrusel() {
  const contenedor = $('[data-carrusel]');
  const pista = contenedor && $('[data-pista]', contenedor);
  if (!pista || pista.children.length < 2) return;
  const total = pista.children.length;
  const puntos = $$('[data-punto]', contenedor);
  const actual = () => Math.round(pista.scrollLeft / pista.clientWidth);

  const ir = (indice) => pista.scrollTo({ left: (((indice % total) + total) % total) * pista.clientWidth, behavior: 'smooth' });
  $('[data-anterior]', contenedor).addEventListener('click', () => ir(actual() - 1));
  $('[data-siguiente]', contenedor).addEventListener('click', () => ir(actual() + 1));
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

// ---------- Ficha: galería y visor de fotos ----------

function galeria() {
  const pista = $('[data-galeria-pista]');
  if (!pista) return;
  const miniaturas = $$('[data-galeria-ir]');
  const actual = () => Math.round(pista.scrollLeft / pista.clientWidth);
  const ir = (n) => pista.scrollTo({ left: n * pista.clientWidth, behavior: 'smooth' });
  for (const miniatura of miniaturas) miniatura.addEventListener('click', () => ir(Number(miniatura.dataset.galeriaIr)));
  pista.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowRight') ir(Math.min(actual() + 1, pista.children.length - 1));
    if (evento.key === 'ArrowLeft') ir(Math.max(actual() - 1, 0));
  });
  let espera;
  pista.addEventListener('scroll', () => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      miniaturas.forEach((m, n) => (n === actual() ? m.setAttribute('aria-current', 'true') : m.removeAttribute('aria-current')));
    }, 60);
  });

  // Visor a pantalla completa al tocar una foto.
  const visor = $('[data-visor]');
  if (!visor) return;
  prepararPanel(visor);
  const fotos = JSON.parse($('[data-visor-fotos]', visor).textContent);
  const imagen = $('[data-visor-foto]', visor);
  const contador = $('[data-visor-contador]', visor);
  let indice = 0;
  const mostrar = (n) => {
    indice = (n + fotos.length) % fotos.length;
    imagen.src = fotos[indice];
    imagen.alt = `Foto ${indice + 1} de ${fotos.length}`;
    contador.textContent = fotos.length > 1 ? `${indice + 1} / ${fotos.length}` : '';
  };
  for (const boton of $$('[data-ampliar]')) {
    boton.addEventListener('click', () => {
      mostrar(Number(boton.dataset.ampliar));
      visor.showModal();
    });
  }
  for (const boton of $$('[data-visor-paso]', visor)) boton.addEventListener('click', () => mostrar(indice + Number(boton.dataset.visorPaso)));
  visor.addEventListener('keydown', (evento) => {
    if (evento.key === 'ArrowRight') mostrar(indice + 1);
    if (evento.key === 'ArrowLeft') mostrar(indice - 1);
  });
  // Deslizar con el dedo para pasar de foto.
  let inicioX = null;
  visor.addEventListener('touchstart', (evento) => (inicioX = evento.touches[0].clientX), { passive: true });
  visor.addEventListener('touchend', (evento) => {
    if (inicioX === null) return;
    const delta = evento.changedTouches[0].clientX - inicioX;
    if (Math.abs(delta) > 50) mostrar(indice + (delta < 0 ? 1 : -1));
    inicioX = null;
  });
}

// ---------- Desplegables (menú del celular y filtros) ----------
// Se cierran con Escape o al tocar afuera.

function desplegable(menu, alCambiar) {
  if (!menu) return;
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && menu.open) {
      menu.open = false;
      $('summary', menu).focus();
    }
  });
  document.addEventListener('click', (evento) => {
    if (menu.open && !menu.contains(evento.target)) menu.open = false;
  });
  if (alCambiar) menu.addEventListener('toggle', () => alCambiar(menu.open));
}

function menuMovil() {
  const menu = $('[data-menu-movil]');
  desplegable(menu, (abierto) => $('summary', menu).setAttribute('aria-label', abierto ? 'Cerrar el menú' : 'Abrir el menú'));
  desplegable($('[data-filtros]'));
}

const panel = panelCarrito();
fichaDeProducto(panel);
checkout(panel);
paginaDePedido();
botonCompartir();
buscador();
selectorDeOrden();
verMas();
carrusel();
galeria();
menuMovil();
