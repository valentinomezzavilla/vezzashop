/* Alta de cuentas (/suscribirse): detalles que ayudan a completar el formulario y un poco de celebración.
   Es opcional: sin este archivo las pantallas funcionan igual. Con "reducir movimiento" no hay confeti ni inclinación ni conteos. */
(function () {
  'use strict';

  var reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- Fuerza de la clave: un medidor con colores y una frase ----------
  var clave = document.getElementById('clave');
  var medidor = document.querySelector('[data-fuerza]');
  var texto = document.querySelector('[data-fuerza-texto]');
  if (clave && medidor) {
    var minimo = parseInt(clave.getAttribute('minlength') || '10', 10);
    var FRASES = ['', 'Muy corta', 'Se puede mejorar', 'Buena', 'Muy buena'];
    var evaluar = function () {
      var v = clave.value;
      var nivel = 0;
      if (v.length > 0) {
        nivel = 1;
        if (v.length >= minimo) nivel = 2;
        var variedad = (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) + (/\d/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
        if (v.length >= minimo && variedad >= 3) nivel = 3;
        if (v.length >= minimo + 4 && variedad >= 3) nivel = 4;
      }
      medidor.setAttribute('data-nivel', String(nivel));
      medidor.style.setProperty('--f', (nivel / 4).toFixed(2));
      if (texto) texto.textContent = FRASES[nivel];
    };
    clave.addEventListener('input', evaluar);
    evaluar();
  }

  // ---------- Link de la tienda: se arma en vivo mientras escribís el nombre ----------
  var nombre = document.getElementById('nombreTienda');
  var enlace = document.getElementById('slug');
  if (nombre && enlace) {
    var slugificar = function (s) {
      return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
    };
    var original = enlace.getAttribute('placeholder') || '';
    var actualizar = function () { enlace.setAttribute('placeholder', slugificar(nombre.value) || original || 'tu-tienda'); };
    nombre.addEventListener('input', actualizar);
    actualizar();
  }

  if (reducir) return;

  // ---------- Precio del plan: cuenta hasta el valor ----------
  var precio = document.querySelector('[data-precio]');
  if (precio) {
    var m = /^(\$\s*)([\d.]+)$/.exec(precio.textContent.trim());
    if (m) {
      var meta = parseInt(m[2].replace(/\./g, ''), 10);
      var inicio = null;
      var formato = new Intl.NumberFormat('es-AR', { useGrouping: 'always' });
      precio.textContent = m[1] + '0';
      var paso = function (t) {
        if (inicio === null) inicio = t;
        var p = Math.min(1, (t - inicio) / 1100);
        var e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        precio.textContent = m[1] + formato.format(Math.round(meta * e));
        if (p < 1) requestAnimationFrame(paso);
      };
      setTimeout(function () { requestAnimationFrame(paso); }, 450);
    }
  }

  // ---------- Tarjeta con inclinación y brillo (solo con mouse) ----------
  var tarjeta = document.querySelector('.ingreso[data-tilt]');
  if (tarjeta && conMouse) {
    document.addEventListener('pointermove', function (e) {
      var r = tarjeta.getBoundingClientRect();
      var x = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
      var y = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
      tarjeta.style.setProperty('--px', Math.max(-1, Math.min(1, x)).toFixed(3));
      tarjeta.style.setProperty('--py', Math.max(-1, Math.min(1, y)).toFixed(3));
      tarjeta.style.setProperty('--gx', (e.clientX - r.left) + 'px');
      tarjeta.style.setProperty('--gy', (e.clientY - r.top) + 'px');
      tarjeta.style.setProperty('--brillo', e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? 1 : 0);
    }, { passive: true });
  }

  // ---------- Confeti: una sola vez, cuando se confirma el pago ----------
  if (document.querySelector('[data-confeti]')) {
    var lienzo = document.createElement('canvas');
    lienzo.className = 'alta-confeti';
    lienzo.setAttribute('aria-hidden', 'true');
    document.body.appendChild(lienzo);
    var ctx = lienzo.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var ancho = (lienzo.width = window.innerWidth * dpr);
    var alto = (lienzo.height = window.innerHeight * dpr);
    var COLORES = ['#3D2FE0', '#8F86FF', '#FF8A5B', '#17784A', '#F5C451', '#15131C'];
    var piezas = [];
    for (var i = 0; i < 90; i++) {
      var lado = i % 2 ? 1 : -1; // 1: sale de la esquina izquierda y va hacia la derecha; -1: al revés
      piezas.push({
        x: (lado > 0 ? 0.06 : 0.94) * ancho,
        y: alto * 0.92,
        vx: lado * (4 + Math.random() * 9) * dpr,
        vy: -(11 + Math.random() * 13) * dpr,
        g: (0.32 + Math.random() * 0.12) * dpr,
        r: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        w: (6 + Math.random() * 7) * dpr,
        h: (3 + Math.random() * 5) * dpr,
        c: COLORES[(Math.random() * COLORES.length) | 0],
        vida: 1
      });
    }
    var t0 = null;
    var dibujar = function (t) {
      if (t0 === null) t0 = t;
      var edad = (t - t0) / 1000;
      ctx.clearRect(0, 0, ancho, alto);
      var vivas = 0;
      piezas.forEach(function (p) {
        p.vy += p.g; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        p.vida = Math.max(0, 1 - Math.max(0, edad - 1.6) / 1.4);
        if (p.vida <= 0 || p.y > alto + 40) return;
        vivas++;
        ctx.save();
        ctx.globalAlpha = p.vida;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      if (vivas > 0 && edad < 3.2) requestAnimationFrame(dibujar);
      else lienzo.remove();
    };
    setTimeout(function () { requestAnimationFrame(dibujar); }, 500);
  }
})();
