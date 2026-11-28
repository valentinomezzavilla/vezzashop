// Comportamiento del panel. Lo esencial funciona sin JavaScript; esto da feedback y atajos mientras se completa.

// Mismo cálculo que colorDeTextoSobre en src/diseno.js.
function colorDeTextoSobre(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111111' : '#ffffff';
}

// "Remera Lisa" + ["S", "Negro"] -> "REMERA-LISA-S-NEGRO"
const aSku = (...partes) =>
  partes
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

// ---------- Archivos: nombre elegido y vista previa ----------

for (const input of document.querySelectorAll('input[type="file"]')) {
  input.addEventListener('change', () => {
    const archivos = [...input.files];
    const contenedor = input.closest('label');
    const texto = contenedor?.querySelector('[data-nombre-archivo]');
    if (texto) {
      texto.dataset.original ??= texto.textContent;
      texto.textContent = archivos.length === 0 ? texto.dataset.original
        : archivos.length === 1 ? archivos[0].name
        : `${archivos.length} archivos elegidos`;
    }
    contenedor?.classList.toggle('con-archivo', archivos.length > 0);

    const clave = input.dataset.previsualizar;
    const vista = clave && document.querySelector(`[data-vista="${clave}"]`);
    const archivo = archivos[0];
    if (!vista || !archivo || !archivo.type.startsWith('image/')) return;
    vista.querySelector('img[data-generada]')?.remove();
    const imagen = document.createElement('img');
    imagen.dataset.generada = '';
    imagen.alt = '';
    imagen.src = URL.createObjectURL(archivo);
    if (vista.matches('.selector-imagen-vista')) vista.replaceChildren(imagen);
    else vista.prepend(imagen);
  });
}

// ---------- Banners: recorte con vista previa ----------

// Cada marco tiene la proporción exacta del banner en la tienda. La imagen se mueve y se acerca por debajo y, al enviar el
// formulario, un campo oculto lleva qué parte quedó a la vista: "x,y,ancho,alto", todo entre 0 y 1. El servidor recorta
// con esos mismos números (leerRecorte en src/imagenes.js), así que la tienda muestra lo que se ve acá.

const limitar = (valor, minimo, maximo) => Math.min(maximo, Math.max(minimo, valor));

function crearMarcoDeRecorte(figura) {
  const marco = figura.querySelector('[data-marco]');
  const imagen = marco.querySelector('img');
  const zoomEntrada = figura.querySelector('[data-zoom]');
  const aviso = figura.querySelector('[data-aviso]');
  const salida = figura.querySelector('[data-valor]');
  const origen = figura.querySelector('[data-origen]');
  const ideal = Number(figura.dataset.ideal);
  let natural = null; // medidas de la imagen tal como se ve (el navegador ya aplica la rotación de la cámara)
  let url = null;
  let zoom = 1; // 1 = la imagen justo cubre el marco; hasta 3
  let cx = 0.5; // centro de lo que se ve, como fracción de la imagen
  let cy = 0.5;
  let arrastre = null;

  const medidas = () => {
    const ancho = marco.clientWidth;
    const alto = marco.clientHeight;
    const escala = Math.max(ancho / natural.ancho, alto / natural.alto) * zoom;
    return { ancho, alto, anchoImagen: natural.ancho * escala, altoImagen: natural.alto * escala };
  };

  function dibujar() {
    if (!natural || !marco.clientWidth) return;
    const { ancho, alto, anchoImagen, altoImagen } = medidas();
    const visibleAncho = ancho / anchoImagen; // fracción de la imagen que entra en el marco
    const visibleAlto = alto / altoImagen;
    cx = limitar(cx, visibleAncho / 2, 1 - visibleAncho / 2);
    cy = limitar(cy, visibleAlto / 2, 1 - visibleAlto / 2);
    const x = cx - visibleAncho / 2;
    const y = cy - visibleAlto / 2;
    imagen.style.width = `${anchoImagen}px`;
    imagen.style.height = `${altoImagen}px`;
    imagen.style.transform = `translate(${-x * anchoImagen}px, ${-y * altoImagen}px)`;
    salida.value = [x, y, visibleAncho, visibleAlto].map((n) => n.toFixed(5)).join(',');
    zoomEntrada.value = Math.round(zoom * 100);

    // Cuántos píxeles de la imagen original ocupan el ancho del banner: si son pocos, se ve borroso.
    const pixeles = visibleAncho * natural.ancho;
    const nivel = pixeles >= ideal * 0.9 ? 'bien' : pixeles >= ideal * 0.6 ? 'justo' : 'mal';
    aviso.dataset.nivel = nivel;
    aviso.textContent = {
      bien: 'Se ve nítida.',
      justo: 'Se ve bien, aunque la imagen es algo chica para esta medida.',
      mal: 'Se va a ver borrosa: la parte elegida es muy chica. Probá con una imagen más grande o alejá el zoom.',
    }[nivel];
  }

  const cambiarZoom = (nuevo) => {
    zoom = limitar(nuevo, 1, 3);
    dibujar();
  };

  marco.addEventListener('pointerdown', (evento) => {
    if (!natural || evento.button > 0) return;
    arrastre = { x: evento.clientX, y: evento.clientY, cx, cy };
    marco.setPointerCapture(evento.pointerId);
    marco.classList.add('arrastrando');
  });
  marco.addEventListener('pointermove', (evento) => {
    if (!arrastre) return;
    const { anchoImagen, altoImagen } = medidas();
    cx = arrastre.cx - (evento.clientX - arrastre.x) / anchoImagen;
    cy = arrastre.cy - (evento.clientY - arrastre.y) / altoImagen;
    dibujar();
  });
  const soltar = () => {
    arrastre = null;
    marco.classList.remove('arrastrando');
  };
  marco.addEventListener('pointerup', soltar);
  marco.addEventListener('pointercancel', soltar);
  marco.addEventListener('keydown', (evento) => {
    if (!natural) return;
    const { ancho, anchoImagen, alto, altoImagen } = medidas();
    const paso = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[evento.key];
    if (paso) {
      cx += (paso[0] * 0.04 * ancho) / anchoImagen;
      cy += (paso[1] * 0.04 * alto) / altoImagen;
      dibujar();
    } else if (evento.key === '+' || evento.key === '=') cambiarZoom(zoom + 0.1);
    else if (evento.key === '-') cambiarZoom(zoom - 0.1);
    else return;
    evento.preventDefault();
  });
  zoomEntrada.addEventListener('input', () => cambiarZoom(Number(zoomEntrada.value) / 100));
  figura.querySelector('[data-acercar]').addEventListener('click', () => cambiarZoom(zoom + 0.1));
  figura.querySelector('[data-alejar]').addEventListener('click', () => cambiarZoom(zoom - 0.1));
  figura.querySelector('[data-centrar]').addEventListener('click', () => {
    cx = cy = 0.5;
    cambiarZoom(1);
  });
  new ResizeObserver(dibujar).observe(marco);

  return {
    // Devuelve false si el navegador no pudo mostrar la imagen.
    cargar(archivo, texto) {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(archivo);
      if (origen && texto) origen.textContent = texto;
      return new Promise((resolver) => {
        imagen.onload = () => {
          natural = { ancho: imagen.naturalWidth, alto: imagen.naturalHeight };
          zoom = 1;
          cx = cy = 0.5;
          dibujar();
          resolver(true);
        };
        imagen.onerror = () => {
          this.limpiar();
          resolver(false);
        };
        imagen.src = url;
      });
    },
    limpiar() {
      natural = null;
      salida.value = '';
      imagen.removeAttribute('src');
    },
  };
}

const recortador = document.querySelector('[data-recortador]');
if (recortador && 'ResizeObserver' in window) {
  const formulario = recortador.closest('form');
  const entradaPrincipal = formulario.querySelector('input[name="imagen"]');
  const entradaCelular = formulario.querySelector('input[name="imagenMovil"]');
  const marcos = Object.fromEntries([...recortador.querySelectorAll('[data-recorte]')].map((figura) => [figura.dataset.recorte, crearMarcoDeRecorte(figura)]));

  const ocultar = () => {
    recortador.hidden = true;
    for (const marco of Object.values(marcos)) marco.limpiar();
  };
  // El celular usa su propia imagen si se subió una; si no, la misma de la computadora con su propio recorte.
  const cargarCelular = async () => {
    const propia = entradaCelular.files[0];
    const archivo = propia ?? entradaPrincipal.files[0];
    if (archivo) await marcos.celular.cargar(archivo, propia ? propia.name : 'Con la misma imagen');
  };

  entradaPrincipal.addEventListener('change', async () => {
    const archivo = entradaPrincipal.files[0];
    if (!archivo) return ocultar();
    recortador.hidden = false; // el marco tiene que estar a la vista para medirse
    if (!(await marcos.computadora.cargar(archivo))) return ocultar(); // sin vista previa se envía entera, como siempre
    await cargarCelular();
  });
  entradaCelular.addEventListener('change', async () => {
    if (!recortador.hidden) await cargarCelular();
  });
}

// ---------- Claves: botón para mostrarlas u ocultarlas ----------

// A cada campo de clave se le agrega un ojo al costado (la plantilla con los íconos viene del servidor). Sin JavaScript el
// campo queda como siempre, siempre oculto.
const plantillaVerClave = document.querySelector('#plantilla-ver-clave');
if (plantillaVerClave) {
  for (const entrada of document.querySelectorAll('input[type="password"]')) {
    const teniaFoco = document.activeElement === entrada;
    const envoltorio = document.createElement('span');
    envoltorio.className = 'clave-campo';
    entrada.replaceWith(envoltorio);
    const boton = plantillaVerClave.content.firstElementChild.cloneNode(true);
    envoltorio.append(entrada, boton);
    if (teniaFoco) entrada.focus();
    // Al mostrarla, que el teclado del celular no la corrija ni le ponga mayúsculas.
    entrada.setAttribute('autocapitalize', 'none');
    entrada.setAttribute('autocorrect', 'off');
    entrada.spellcheck = false;

    const mostrar = (visible) => {
      entrada.type = visible ? 'text' : 'password';
      const texto = visible ? 'Ocultar la clave' : 'Mostrar la clave';
      boton.setAttribute('aria-pressed', String(visible));
      boton.setAttribute('aria-label', texto);
      boton.title = texto;
      boton.querySelector('[data-icono-oculta]').hidden = visible;
      boton.querySelector('[data-icono-visible]').hidden = !visible;
    };
    boton.addEventListener('click', () => mostrar(entrada.type === 'password'));
    // Que no quede a la vista al enviar el formulario ni al volver a la página con el botón "atrás".
    entrada.form?.addEventListener('submit', () => mostrar(false));
    addEventListener('pagehide', () => mostrar(false));
  }
}

// ---------- Copiar al portapapeles ----------

for (const boton of document.querySelectorAll('[data-copiar]')) {
  boton.addEventListener('click', async () => {
    const texto = boton.querySelector('[data-copiar-texto]');
    try {
      await navigator.clipboard.writeText(boton.dataset.copiar);
      texto.textContent = '¡Copiado!';
    } catch {
      texto.textContent = 'No se pudo copiar';
    }
    setTimeout(() => (texto.textContent = boton.dataset.textoOriginal ?? 'Copiar'), 2000);
  });
  boton.dataset.textoOriginal = boton.querySelector('[data-copiar-texto]').textContent;
}

// ---------- Diseño: vista previa del color y la franja ----------

const vistaPrevia = document.querySelector('[data-vista-previa]');
const color = document.querySelector('[data-color]');
if (vistaPrevia && color) {
  const hex = document.querySelector('[data-color-hex]');
  const franja = document.querySelector('[data-franja]');
  const textoFranja = vistaPrevia.querySelector('[data-vista-franja]');
  // La franja puede tener un color propio: si no, usa el principal.
  const franjaPropia = document.querySelector('[data-franja-propio]');
  const colorFranja = document.querySelector('[data-color-franja]');
  const hexFranja = document.querySelector('[data-color-franja-hex]');
  const pintar = () => {
    vistaPrevia.style.setProperty('--muestra', color.value);
    vistaPrevia.style.setProperty('--muestra-texto', colorDeTextoSobre(color.value));
    hex.textContent = color.value;
    textoFranja.textContent = franja.value.trim() || 'Tu anuncio va acá';
    if (franjaPropia && colorFranja) {
      const propio = franjaPropia.checked;
      vistaPrevia.style.setProperty('--franja-muestra', propio ? colorFranja.value : color.value);
      vistaPrevia.style.setProperty('--franja-muestra-texto', colorDeTextoSobre(propio ? colorFranja.value : color.value));
      hexFranja.textContent = colorFranja.value;
    }
  };
  color.addEventListener('input', pintar);
  franja.addEventListener('input', pintar);
  franjaPropia?.addEventListener('change', pintar);
  colorFranja?.addEventListener('input', () => {
    if (franjaPropia) franjaPropia.checked = true; // elegir un color es querer usarlo
    pintar();
  });
  pintar();

  // El logo elegido se ve en la cabecera de la vista previa con el tamaño que va a tener en la tienda.
  const cabecera = vistaPrevia.querySelector('[data-vista-cabecera]');
  const logo = document.querySelector('[data-previsualizar="logo"]');
  const quitar = document.querySelector('[name="quitarLogo"]');
  const original = [...cabecera.childNodes].map((nodo) => nodo.cloneNode(true));
  const nombreTienda = () => {
    const nombre = document.createElement('span');
    nombre.className = 'vista-previa-nombre';
    nombre.textContent = document.querySelector('.lateral-tienda')?.textContent ?? '';
    return nombre;
  };
  logo?.addEventListener('change', () => {
    const archivo = logo.files[0];
    if (!archivo || !archivo.type.startsWith('image/')) return;
    const imagen = document.createElement('img');
    imagen.className = 'vista-previa-logo';
    imagen.alt = '';
    imagen.src = URL.createObjectURL(archivo);
    cabecera.replaceChildren(imagen);
    if (quitar) quitar.checked = false;
  });
  quitar?.addEventListener('change', () => {
    cabecera.replaceChildren(...(quitar.checked ? [nombreTienda()] : original.map((nodo) => nodo.cloneNode(true))));
  });
}

// ---------- Cambios sin guardar ----------
// Vale para cualquier formulario con un aviso [data-sin-guardar], incluidos los campos asociados con form="...".

for (const formulario of document.querySelectorAll('form')) {
  const aviso = formulario.querySelector('[data-sin-guardar]');
  if (!aviso) continue;
  let cambios = false;
  const marcar = (evento) => {
    if (evento.target.form !== formulario) return;
    cambios = true;
    aviso.hidden = false;
  };
  document.addEventListener('input', marcar);
  document.addEventListener('change', marcar);
  formulario.addEventListener('marcar-cambios', () => {
    cambios = true;
    aviso.hidden = false;
  });
  formulario.addEventListener('submit', () => (cambios = false));
  window.addEventListener('beforeunload', (evento) => {
    if (cambios) evento.preventDefault();
  });
}

// ---------- Producto: tabla de variantes ----------

const formProducto = document.querySelector('[data-form-producto]');
if (formProducto) {
  const filas = formProducto.querySelector('[data-filas]');
  const plantilla = formProducto.querySelector('[data-plantilla-fila]');
  const nombresAtributo = [...formProducto.querySelectorAll('[data-atributo-nombre]')];
  const avisarCambio = () => formProducto.dispatchEvent(new Event('marcar-cambios'));
  const atributosActivos = () => nombresAtributo.map((input) => input.value.trim()).filter((_, n, todos) => todos.slice(0, n + 1).every(Boolean));

  // Las columnas de valores siguen a los nombres de las variantes: "Talle" muestra la columna Talle.
  function actualizarColumnas() {
    nombresAtributo.forEach((input, n) => {
      const nombre = input.value.trim();
      for (const celda of formProducto.querySelectorAll(`[data-columna-valor="${n}"]`)) {
        celda.hidden = !nombre;
        if (celda.tagName === 'TH') celda.textContent = nombre || `Variante ${n + 1}`;
        else celda.dataset.etiqueta = nombre || `Variante ${n + 1}`; // etiqueta visible en el celular (ver admin.css)
        celda.querySelector('input')?.setAttribute('aria-label', nombre || `Variante ${n + 1}`);
      }
      const etiqueta = document.querySelector(`[data-generador-etiqueta="${n}"]`);
      if (etiqueta) etiqueta.textContent = nombre || `Variante ${n + 1}`;
      const campo = document.querySelector(`[data-generador-campo="${n}"]`);
      if (campo) campo.hidden = !nombre;
    });
  }
  for (const input of nombresAtributo) input.addEventListener('input', actualizarColumnas);
  actualizarColumnas();

  function agregarFila(datos = {}) {
    const fila = plantilla.content.querySelector('[data-fila]').cloneNode(true);
    for (const [campo, valor] of Object.entries(datos)) {
      if (campo === 'valores') valor.forEach((v, n) => (fila.querySelector(`[data-valor="${n}"]`).value = v));
      else fila.querySelector(`[data-campo="${campo}"]`).value = valor;
    }
    filas.append(fila);
    actualizarColumnas();
    return fila;
  }

  formProducto.querySelector('[data-agregar-fila]').addEventListener('click', () => {
    const anterior = [...filas.querySelectorAll('[data-fila]')].at(-1);
    // La nueva fila arranca con el precio de la anterior, que suele ser el mismo.
    const fila = agregarFila({ precio: anterior?.querySelector('[data-campo="precio"]').value ?? '' });
    fila.querySelector('input:not([type="hidden"]):not([hidden])')?.focus();
    avisarCambio();
  });

  filas.addEventListener('click', (evento) => {
    const boton = evento.target.closest('[data-quitar-fila]');
    if (!boton) return;
    const fila = boton.closest('[data-fila]');
    if (fila.nextElementSibling?.matches('.fila-errores')) fila.nextElementSibling.remove();
    fila.remove();
    if (!filas.querySelector('[data-fila]')) agregarFila();
    avisarCambio();
  });

  // Generador: una variante por cada combinación de valores.
  const resultado = document.querySelector('[data-generador-resultado]');
  document.querySelector('[data-generar]')?.addEventListener('click', () => {
    const atributos = atributosActivos();
    if (!atributos.length) {
      resultado.textContent = 'Primero escribí qué cambia entre las variantes (por ejemplo Talle).';
      return;
    }
    const listas = atributos.map((_, n) =>
      [...new Set(document.querySelector(`[data-generador-valores="${n}"]`).value.split(',').map((v) => v.trim()).filter(Boolean))],
    );
    if (listas.some((l) => l.length === 0)) {
      resultado.textContent = `Escribí al menos un valor para ${atributos[listas.findIndex((l) => !l.length)]}.`;
      return;
    }
    const combinaciones = listas.reduce((acumulado, valores) => acumulado.flatMap((c) => valores.map((v) => [...c, v])), [[]]);
    const existentes = new Set(
      [...filas.querySelectorAll('[data-fila]')].map((fila) =>
        atributos.map((_, n) => fila.querySelector(`[data-valor="${n}"]`).value.trim().toLowerCase()).join('\u0000'),
      ),
    );
    // Si solo hay una fila vacía (producto nuevo), se reemplaza.
    const unicas = filas.querySelectorAll('[data-fila]');
    if (unicas.length === 1 && [...unicas[0].querySelectorAll('input:not([type="hidden"])')].every((i) => !i.value || i.value === '0')) {
      unicas[0].remove();
      existentes.clear();
    }
    const nombre = formProducto.querySelector('[data-nombre-producto]').value.trim() || 'PROD';
    const precio = document.querySelector('[data-generador-precio]').value.trim();
    let creadas = 0;
    for (const valores of combinaciones) {
      if (existentes.has(valores.map((v) => v.toLowerCase()).join('\u0000'))) continue;
      agregarFila({ valores, sku: aSku(nombre.slice(0, 20), ...valores), precio, stock: '0' });
      creadas++;
    }
    resultado.textContent = creadas
      ? `Creamos ${creadas} variante${creadas === 1 ? '' : 's'}. Revisá el stock de cada una y guardá.`
      : 'Esas combinaciones ya estaban.';
    if (creadas) avisarCambio();
  });

  // Aplicar el mismo precio, oferta o stock a todas las variantes.
  document.querySelector('[data-aplicar]')?.addEventListener('click', () => {
    const valor = document.querySelector('[data-aplicar-valor]').value.trim();
    const campo = document.querySelector('[data-aplicar-campo]').value;
    for (const input of filas.querySelectorAll(`[data-campo="${campo}"]`)) input.value = valor;
    avisarCambio();
  });
}

// ---------- Forma de entrega: costo a coordinar y precio por provincia ----------
// Si el costo se coordina después, el costo base no se usa: se deshabilita para que quede claro. "Gratis desde" sigue valiendo
// si alguna provincia tiene su propio precio. La tabla de precios por provincia solo tiene sentido en un envío a domicilio.

const aCoordinar = document.querySelector('[data-a-coordinar]');
if (aCoordinar) {
  const costoBase = document.querySelector('[data-costo]');
  const gratisDesde = document.querySelector('[data-gratis-desde]');
  const tipos = document.querySelectorAll('[data-form-entrega] input[name="tipo"]');
  const tabla = document.querySelector('[data-precios-provincia]');
  const preciosProvincia = document.querySelectorAll('[data-precio-provincia]');
  const actualizar = () => {
    const tipo = document.querySelector('[data-form-entrega] input[name="tipo"]:checked');
    const conTabla = tabla !== null && !(tipo && tipo.value === 'retiro');
    if (tabla) tabla.hidden = !conTabla;
    const hayPrecioPorProvincia = conTabla && [...preciosProvincia].some((campo) => campo.value.trim() !== '');
    costoBase.disabled = aCoordinar.checked;
    gratisDesde.disabled = aCoordinar.checked && !hayPrecioPorProvincia;
  };
  aCoordinar.addEventListener('change', actualizar);
  for (const campo of preciosProvincia) campo.addEventListener('input', actualizar);
  // Un retiro casi siempre es gratis: si se elige y el costo está vacío, se completa con 0.
  for (const tipo of tipos) {
    tipo.addEventListener('change', () => {
      if (tipo.checked && tipo.value === 'retiro' && costoBase.value.trim() === '' && !aCoordinar.checked) costoBase.value = '0';
      actualizar();
    });
  }
  actualizar();
}

// ---------- Menú del celular ----------
// En pantallas chicas el menú lateral se abre desde "Más". Sin JavaScript funciona con el ancla #menu-panel (:target);
// acá se abre con una clase, sin sumar pasos al historial: se cierra con Escape, con la X o tocando afuera, y mientras
// está abierto el resto de la página no recibe el foco (inert).

const menuPanel = document.getElementById('menu-panel');
if (menuPanel) {
  const abridores = [...document.querySelectorAll('[data-abrir-menu]')];
  const detras = [...document.querySelectorAll('.barra-superior, .barra-inferior, .contenido')];
  let ultimoAbridor = null;
  const abierto = () => menuPanel.classList.contains('abierto');
  const marcar = (valor) => {
    menuPanel.classList.toggle('abierto', valor);
    for (const abridor of abridores) abridor.setAttribute('aria-expanded', String(valor));
    for (const parte of detras) parte.inert = valor;
  };
  const cerrar = ({ devolverFoco = true } = {}) => {
    if (!abierto()) return;
    marcar(false);
    if (devolverFoco) ultimoAbridor?.focus();
  };
  // Si se llegó con el ancla en la dirección, se la saca (así deja de valer :target) y se abre con la clase.
  if (location.hash === '#menu-panel') {
    location.replace('#');
    history.replaceState(null, '', location.pathname + location.search);
    marcar(true);
  }
  for (const abridor of abridores) {
    abridor.setAttribute('aria-expanded', String(abierto()));
    abridor.addEventListener('click', (evento) => {
      evento.preventDefault();
      ultimoAbridor = abridor;
      marcar(true);
      menuPanel.querySelector('.lateral-menu a.activo, .lateral-menu a')?.focus({ preventScroll: true });
    });
  }
  menuPanel.querySelector('[data-cerrar-menu]')?.addEventListener('click', (evento) => {
    evento.preventDefault();
    cerrar();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') cerrar();
  });
  document.addEventListener('click', (evento) => {
    if (abierto() && !menuPanel.contains(evento.target) && !evento.target.closest('[data-abrir-menu]')) cerrar({ devolverFoco: false });
  });
  // Si la ventana se agranda hasta mostrar el menú fijo, deja de ser un panel.
  matchMedia('(min-width: 861px)').addEventListener('change', (evento) => {
    if (evento.matches) cerrar({ devolverFoco: false });
  });
}

// ---------- Productos: seleccionar varios para borrar ----------
// Sin JavaScript la barra se ve siempre y funciona igual; acá se oculta hasta que haya algo marcado.
const barraSeleccion = document.querySelector('[data-barra-seleccion]');
if (barraSeleccion) {
  const casillas = [...document.querySelectorAll(`input[name="ids"][form="${barraSeleccion.id}"]`)];
  const todos = document.querySelector('[data-seleccionar-todos]');
  const controlTodos = document.querySelector('[data-control-seleccion]');
  if (controlTodos) controlTodos.hidden = false;
  const cuenta = barraSeleccion.querySelector('[data-cuenta-seleccion]');
  const actualizar = () => {
    const marcadas = casillas.filter((c) => c.checked).length;
    cuenta.textContent = String(marcadas);
    barraSeleccion.hidden = marcadas === 0;
    if (todos) {
      todos.checked = marcadas > 0 && marcadas === casillas.length;
      todos.indeterminate = marcadas > 0 && marcadas < casillas.length;
    }
  };
  for (const casilla of casillas) casilla.addEventListener('change', actualizar);
  todos?.addEventListener('change', () => {
    for (const casilla of casillas) casilla.checked = todos.checked;
    actualizar();
  });
  actualizar();
}

// ---------- Listados: los selects de orden y categoría se aplican al elegirlos ----------
// Sin JavaScript queda el botón "Aplicar" (data-sin-js), que acá se oculta.
for (const select of document.querySelectorAll('select[data-autoenviar]')) {
  select.addEventListener('change', () => select.form.requestSubmit());
  for (const boton of select.form.querySelectorAll('[data-sin-js]')) boton.hidden = true;
}

// ---------- Menús de acciones (los de cada fila de la lista de pedidos) ----------
// El menú es un popover: se dibuja arriba de todo (la tabla tiene su propio scroll y lo recortaría) y se cierra solo con un clic afuera
// o con Esc. Acá se lo ubica al lado de su botón, sin salirse de la pantalla, y se cierra si la página se mueve.
for (const menu of document.querySelectorAll('[data-menu-acciones]')) {
  const boton = document.querySelector(`[popovertarget="${menu.id}"]`);
  if (!boton) continue;
  menu.addEventListener('toggle', (evento) => {
    if (evento.newState !== 'open') return;
    const b = boton.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const izquierda = Math.min(Math.max(8, b.right - m.width), window.innerWidth - m.width - 8);
    const abajo = b.bottom + 4;
    menu.style.left = `${izquierda}px`;
    menu.style.top = `${abajo + m.height > window.innerHeight - 8 ? Math.max(8, b.top - m.height - 4) : abajo}px`;
    const cerrar = () => {
      try {
        if (menu.matches(':popover-open')) menu.hidePopover();
      } catch {
        // Un navegador sin popover no llega hasta acá: el menú no se abre.
      }
    };
    addEventListener('scroll', cerrar, { once: true, passive: true, capture: true });
    addEventListener('resize', cerrar, { once: true });
  });
}

// Formularios que no se pueden mandar dos veces (por ejemplo, confirmar un borrado): se desactiva el botón al enviar.
for (const formulario of document.querySelectorAll('form[data-un-solo-envio]')) {
  formulario.addEventListener('submit', () => {
    for (const boton of formulario.querySelectorAll('button[type="submit"]')) boton.disabled = true;
  });
}

// ---------- Detalles visuales ----------
// Solo adornos: si el sistema pide menos movimiento, no se hace nada de esto.

const menosMovimiento = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Los números del inicio cuentan desde cero hasta su valor ("1.234", "25%").
if (!menosMovimiento) {
  for (const numero of document.querySelectorAll('.numero-tarjeta strong, .progreso-numero')) {
    const partes = numero.textContent.trim().match(/^(\d{1,3}(?:\.\d{3})*|\d+)(%?)$/);
    const final = partes && Number(partes[1].replace(/\./g, ''));
    if (!final) continue;
    const inicio = performance.now();
    const duracion = 900;
    const paso = (ahora) => {
      const avance = Math.min(1, (ahora - inicio) / duracion);
      const suavizado = 1 - (1 - avance) ** 4;
      numero.textContent = Math.round(final * suavizado).toLocaleString('es-AR') + partes[2];
      if (avance < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }
}

// ---------- Apariencia: Automático / Claro / Oscuro ----------
// El atributo data-tema de <html> lo pone antes de pintar un script del <head> (ver cabecera.ejs); acá se cambia al
// elegir una opción y se guarda en este navegador. Automático = sin atributo: manda la preferencia del sistema.

{
  const raiz = document.documentElement;
  const botones = [...document.querySelectorAll('[data-tema-elegir]')];
  const colorBarra = { claro: '#f7f7f8', oscuro: '#0b0b0d' };
  const barras = [...document.querySelectorAll('meta[name="theme-color"]')];
  const originales = barras.map((meta) => meta.content);
  const marcar = () => {
    const actual = raiz.dataset.tema ?? 'auto';
    for (const boton of botones) boton.setAttribute('aria-pressed', String(boton.dataset.temaElegir === actual));
    // El color de la barra del navegador en el celular acompaña a la elección (Automático vuelve a los de siempre).
    barras.forEach((meta, n) => (meta.content = colorBarra[actual] ?? originales[n]));
  };
  for (const boton of botones) {
    boton.addEventListener('click', () => {
      const elegido = boton.dataset.temaElegir;
      // Con View Transitions el cambio se funde en vez de saltar (donde el navegador la soporta).
      const aplicar = () => {
        if (elegido === 'auto') delete raiz.dataset.tema;
        else raiz.dataset.tema = elegido;
        try {
          if (elegido === 'auto') localStorage.removeItem('tema');
          else localStorage.setItem('tema', elegido);
        } catch {
          // Sin almacenamiento (modo privado): vale mientras la página esté abierta.
        }
        marcar();
      };
      if (document.startViewTransition && !menosMovimiento) document.startViewTransition(aplicar);
      else aplicar();
    });
  }
  marcar();
}

// ---------- Diseño: vista previa de la cabecera y el menú ----------

const vistaMenu = document.querySelector('[data-vista-menu]');
if (vistaMenu) {
  const lista = vistaMenu.querySelector('[data-menu-lista]');
  const casillas = [...document.querySelectorAll('[data-categoria-menu]')];
  const pintar = () => {
    vistaMenu.dataset.menu = document.querySelector('input[name="menuEstilo"]:checked')?.value ?? 'barra';
    vistaMenu.dataset.logo = document.querySelector('input[name="logoTamano"]:checked')?.value ?? 'mediano';
    const nombres = casillas.filter((c) => c.checked).map((c) => c.dataset.nombre);
    // Entran unas pocas; el resto se junta en "Más", como en la tienda.
    const hechos = nombres.slice(0, 4).map((nombre) => Object.assign(document.createElement('span'), { textContent: nombre }));
    if (nombres.length > 4) hechos.push(Object.assign(document.createElement('span'), { textContent: 'Más ▾' }));
    lista.replaceChildren(...hechos);
  };
  document.addEventListener('change', (evento) => {
    if (evento.target.matches('input[name="menuEstilo"], input[name="logoTamano"], [data-categoria-menu]')) pintar();
  });
  pintar();
  // Si se elige un logo nuevo, la vista previa de la cabecera también lo muestra.
  document.querySelector('[data-previsualizar="logo"]')?.addEventListener('change', (evento) => {
    const archivo = evento.target.files[0];
    if (!archivo || !archivo.type.startsWith('image/')) return;
    const imagen = Object.assign(document.createElement('img'), { className: 'vista-previa-logo', alt: '', src: URL.createObjectURL(archivo) });
    vistaMenu.querySelector('.vista-previa-marca').replaceChildren(imagen);
  });
}

// Diseño por plan: al elegir un color, se tilda solo su casilla "usar otro color" (si no, el color elegido se ignoraría sin que se note).
document.addEventListener('input', (evento) => {
  if (!evento.target.matches('[data-color-opcional]')) return;
  const casilla = evento.target.closest('.color-opcional')?.querySelector('[data-color-propio]');
  if (casilla && !casilla.checked) casilla.checked = true;
});

// ---------- Planes (plataforma): los botones de punto de partida tildan las funciones de diseño de ese nivel ----------
// Sin JavaScript se tildan a mano: los botones solo ahorran el trabajo.

for (const boton of document.querySelectorAll('[data-funciones-preset]')) {
  boton.addEventListener('click', () => {
    const elegidas = new Set(boton.dataset.funcionesPreset.split(',').filter(Boolean));
    for (const casilla of document.querySelectorAll('input[name="funciones"]')) casilla.checked = elegidas.has(casilla.value);
    document.querySelector('[data-funciones-preset-aviso]')?.removeAttribute('hidden');
  });
}

// ---------- Kit de marca: el color elegido muestra su código ----------

for (const entrada of document.querySelectorAll('input[type="color"][data-marca-color]')) {
  const codigo = entrada.closest('.selector-color')?.querySelector('[data-marca-hex]');
  entrada.addEventListener('input', () => {
    if (codigo) codigo.textContent = entrada.value;
  });
}

// ---------- Maqueta web: mientras se arma, la página pregunta cómo va y se recarga sola cuando termina ----------
// Sin JavaScript queda el botón "Actualizar". La maqueta no tiene formularios con cambios sin guardar, así que recargar no pierde nada.
{
  const espera = document.querySelector('[data-maqueta-espera]');
  if (espera) {
    let intentos = 0;
    const consultar = async () => {
      intentos += 1;
      try {
        const respuesta = await fetch(`/admin/marca/maqueta/${espera.dataset.maquetaEspera}/estado`, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (respuesta.ok && !(await respuesta.json()).enCurso) return location.reload();
      } catch {
        // sin conexión por un momento: se vuelve a preguntar
      }
      if (intentos < 300) setTimeout(consultar, intentos < 10 ? 2500 : 6000);
    };
    setTimeout(consultar, 2500);
  }
}
