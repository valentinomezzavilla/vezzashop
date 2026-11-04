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
  const pintar = () => {
    vistaPrevia.style.setProperty('--muestra', color.value);
    vistaPrevia.style.setProperty('--muestra-texto', colorDeTextoSobre(color.value));
    hex.textContent = color.value;
    textoFranja.textContent = franja.value.trim() || 'Tu anuncio va acá';
  };
  color.addEventListener('input', pintar);
  franja.addEventListener('input', pintar);
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

// ---------- Forma de entrega: costo a coordinar ----------
// Si el costo se coordina después, los montos no se usan: se deshabilitan para que quede claro.

const aCoordinar = document.querySelector('[data-a-coordinar]');
if (aCoordinar) {
  const montos = document.querySelectorAll('[data-costo], [data-gratis-desde]');
  const tipos = document.querySelectorAll('[data-form-entrega] input[name="tipo"]');
  const actualizar = () => {
    for (const campo of montos) campo.disabled = aCoordinar.checked;
  };
  aCoordinar.addEventListener('change', actualizar);
  // Un retiro casi siempre es gratis: si se elige y el costo está vacío, se completa con 0.
  for (const tipo of tipos) {
    tipo.addEventListener('change', () => {
      const costo = document.querySelector('[data-costo]');
      if (tipo.checked && tipo.value === 'retiro' && costo.value.trim() === '' && !aCoordinar.checked) costo.value = '0';
    });
  }
  actualizar();
}

// ---------- Menú del celular: la sección activa a la vista ----------
// En pantallas chicas el menú se desliza de costado; si la sección actual quedó afuera, se la muestra.

const activa = document.querySelector('.lateral-menu a.activo');
const menu = activa?.closest('.lateral-menu');
if (menu && menu.scrollWidth > menu.clientWidth) {
  const desde = activa.getBoundingClientRect().left - menu.getBoundingClientRect().left + menu.scrollLeft;
  menu.scrollLeft = desde - (menu.clientWidth - activa.offsetWidth) / 2;
}
