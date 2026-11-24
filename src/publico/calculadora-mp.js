// Calculadora de comisiones de Mercado Pago de "Envíos y pagos". La cuenta la hace comisiones-mp.js, el mismo código que usa el servidor
// (se carga como módulo): así lo que se ve acá y lo que calcula la plataforma no puede diferir. Sin JavaScript, la pantalla muestra el
// ejemplo de $50.000 ya calculado por el servidor.
(async () => {
  const raiz = document.querySelector('[data-calculadora-mp]');
  if (!raiz) return;
  let cuentas;
  try {
    cuentas = await import('/comisiones-mp.js');
  } catch {
    return; // sin el módulo queda el ejemplo calculado por el servidor
  }
  const { MAX_OTROS_BP, calcularComision, precioParaRecibir, tablaDeComisiones } = cuentas;

  const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
  const dinero = (centavos) => pesos.format(centavos / 100);
  const porcentaje = (bp) => `${(bp / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
  const $ = (selector) => raiz.querySelector(selector);
  const texto = (clave, valor) => {
    const elemento = $(`[data-mp="${clave}"]`);
    if (elemento) elemento.textContent = valor;
  };

  // "50000", "50.000", "50.000,50" y "50000.5" son pesos. Devuelve centavos, o null si no es un monto.
  function leerPesos(valor) {
    let limpio = String(valor).replace(/[^\d.,]/g, '');
    if (!limpio) return null;
    const coma = limpio.lastIndexOf(',');
    const punto = limpio.lastIndexOf('.');
    if (coma !== -1 && punto !== -1) limpio = coma > punto ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '');
    else if (coma !== -1) limpio = limpio.replace(/\./g, '').replace(',', '.');
    else if (punto !== -1) {
      // Un solo punto con tres dígitos después es de miles ("50.000"); si no, decimal ("50.5").
      const partes = limpio.split('.');
      if (partes.length > 2 || partes[1].length === 3) limpio = limpio.replace(/\./g, '');
    }
    const numero = Number(limpio);
    return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 100) : null;
  }

  // "1,5" -> 150 (centésimas de punto porcentual). Vacío es 0; algo que no es un porcentaje válido, null.
  function leerOtros(valor) {
    const limpio = String(valor).trim().replace(',', '.');
    if (limpio === '') return 0;
    const numero = Number(limpio);
    return Number.isFinite(numero) && numero >= 0 && numero * 100 <= MAX_OTROS_BP ? Math.round(numero * 100) : null;
  }

  function actualizar() {
    const plazo = $('[data-mp-plazo]').value;
    const otrosBp = leerOtros($('[data-mp-otros]').value);
    const precio = leerPesos($('[data-mp-precio]').value);
    const neto = leerPesos($('[data-mp-neto]').value);
    const invalido = otrosBp === null;
    $('[data-mp-otros]').setAttribute('aria-invalid', String(invalido));

    if (precio !== null && !invalido) {
      const venta = calcularComision(precio, { plazo, otrosBp });
      texto('tasa', porcentaje(venta.tasaBp));
      texto('comision', `−${dinero(venta.comision)}`);
      texto('iva', `−${dinero(venta.iva)}`);
      texto('otros', `−${dinero(venta.otros)}`);
      texto('neto', dinero(venta.neto));
      $('[data-mp-fila-otros]').hidden = venta.otros === 0;
      // La tabla usa el mismo precio y la misma cuenta, con los cuatro plazos.
      for (const fila of tablaDeComisiones(precio, { otrosBp })) {
        const celdas = $(`[data-mp-fila="${fila.plazo}"]`);
        if (!celdas) continue;
        celdas.querySelector('[data-mp-celda="descuento"]').textContent = dinero(fila.total);
        celdas.querySelector('[data-mp-celda="neto"]').innerHTML = `<strong>${dinero(fila.neto)}</strong>`;
        celdas.classList.toggle('mp-fila-elegida', fila.plazo === plazo);
      }
    }
    if (neto !== null && !invalido) {
      const necesario = precioParaRecibir(neto, { plazo, otrosBp });
      texto('precio-necesario', necesario === null ? '—' : dinero(necesario));
    }
  }

  raiz.addEventListener('input', actualizar);
  raiz.addEventListener('change', actualizar);
  actualizar();
})();
