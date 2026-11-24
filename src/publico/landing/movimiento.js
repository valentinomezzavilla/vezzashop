/* VEZZA Shop · capa de movimiento de la landing (ver movimiento.css).
   Todo es opcional: sin este archivo la página funciona igual. Con "reducir movimiento" solo se cuentan las cifras de golpe. */
(function () {
  'use strict';

  var reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var conMouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var cada = function (selector, fn, raiz) { Array.prototype.forEach.call((raiz || document).querySelectorAll(selector), fn); };

  // ---------- Titulares: parte el texto en palabras (cada una sube desde una máscara) ----------
  function dividir(el) {
    var n = 0;
    (function recorrer(nodo) {
      Array.prototype.slice.call(nodo.childNodes).forEach(function (hijo) {
        if (hijo.nodeType === 3) {
          var trozo = document.createDocumentFragment();
          hijo.textContent.split(/(\s+)/).forEach(function (parte) {
            if (!parte) return;
            if (/^\s+$/.test(parte)) { trozo.appendChild(document.createTextNode(parte)); return; }
            var caja = document.createElement('span');
            caja.className = 'w';
            var palabra = document.createElement('span');
            palabra.className = 'w__i';
            palabra.style.setProperty('--i', n++);
            palabra.textContent = parte;
            caja.appendChild(palabra);
            trozo.appendChild(caja);
          });
          nodo.replaceChild(trozo, hijo);
        } else if (hijo.nodeType === 1) {
          recorrer(hijo);
        }
      });
    })(el);
    el.classList.add('is-split');
  }
  if (!reducir) {
    cada('[data-split]', dividir);
    cada('.head .h2', dividir);
  } else {
    cada('[data-split]', function (el) { el.classList.add('is-split'); });
  }

  // ---------- Escalonado: los elementos de una misma fila entran uno detrás del otro ----------
  [['.cards3', 0], ['.steps', 0], ['.feats', 3], ['.goals', 2], ['.plans', 0], ['.road', 3], ['.hero__checks', 0]].forEach(function (par) {
    cada(par[0], function (grupo) {
      Array.prototype.forEach.call(grupo.children, function (hijo, i) { hijo.style.setProperty('--i', par[1] ? i % par[1] : i); });
    });
  });

  // ---------- Después de aparecer, el elemento vuelve a su estado normal (así el hover no hereda el retraso) ----------
  cada('.reveal', function (el) {
    el.addEventListener('transitionend', function (e) {
      if (e.target === el && e.propertyName === 'transform' && el.classList.contains('in')) el.classList.remove('reveal');
    });
  });

  // ---------- Cifras: cuentan al entrar en pantalla ----------
  var cifras = [];
  cada('[data-count]', function (el) {
    var meta = parseFloat(el.getAttribute('data-count'));
    var desde = el.hasAttribute('data-from') ? parseFloat(el.getAttribute('data-from')) : 0;
    var sufijo = el.getAttribute('data-suffix') || '';
    if (isNaN(meta)) return;
    cifras.push({ el: el, meta: meta, desde: desde, sufijo: sufijo });
  });
  function contar(c) {
    var dur = 1400;
    var t0 = null;
    function paso(t) {
      if (t0 === null) t0 = t;
      var p = Math.min(1, (t - t0) / dur);
      var e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); // easeOutExpo
      c.el.textContent = Math.round(c.desde + (c.meta - c.desde) * e) + c.sufijo;
      if (p < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  }
  if (cifras.length && !reducir && 'IntersectionObserver' in window) {
    cifras.forEach(function (c) { c.el.textContent = c.desde + c.sufijo; });
    var vigia = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        if (!en.isIntersecting) return;
        vigia.unobserve(en.target);
        contar(cifras.filter(function (c) { return c.el === en.target; })[0]);
      });
    }, { threshold: 0.6 });
    cifras.forEach(function (c) { vigia.observe(c.el); });
  }

  if (reducir) return;

  // ---------- Barra de avance: solo si el navegador no la anima solo con CSS ----------
  var barra = document.querySelector('.progreso');
  if (barra && !(window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'))) {
    var pintarBarra = function () {
      var alto = document.documentElement.scrollHeight - window.innerHeight;
      barra.style.setProperty('--p', alto > 0 ? Math.min(1, window.scrollY / alto).toFixed(4) : 0);
    };
    window.addEventListener('scroll', pintarBarra, { passive: true });
    pintarBarra();
  }

  // ---------- Hero: la escena sigue al mouse (inclinación y profundidad) ----------
  var escena = document.querySelector('[data-tilt]');
  if (escena && conMouse) {
    var zona = escena.closest('.hero') || escena;
    var meta = { x: 0, y: 0 };
    var actual = { x: 0, y: 0 };
    var cuadro = 0;
    var animarEscena = function () {
      cuadro = 0;
      actual.x += (meta.x - actual.x) * 0.08;
      actual.y += (meta.y - actual.y) * 0.08;
      escena.style.setProperty('--px', actual.x.toFixed(3));
      escena.style.setProperty('--py', actual.y.toFixed(3));
      if (Math.abs(meta.x - actual.x) > 0.002 || Math.abs(meta.y - actual.y) > 0.002) cuadro = requestAnimationFrame(animarEscena);
    };
    var pedir = function () { if (!cuadro) cuadro = requestAnimationFrame(animarEscena); };
    zona.addEventListener('pointermove', function (e) {
      var r = zona.getBoundingClientRect();
      meta.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      meta.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      pedir();
    }, { passive: true });
    zona.addEventListener('pointerleave', function () { meta.x = 0; meta.y = 0; pedir(); });
  }

  // ---------- Botones: se acercan un poco al cursor ----------
  if (conMouse) {
    cada('.hero .btn, .cta .btn, .plan .btn, .nav__actions .btn, .faq-aside .btn', function (boton) {
      boton.addEventListener('pointermove', function (e) {
        var r = boton.getBoundingClientRect();
        boton.style.setProperty('--mx', ((e.clientX - (r.left + r.width / 2)) * 0.14).toFixed(1) + 'px');
        boton.style.setProperty('--my', ((e.clientY - (r.top + r.height / 2)) * 0.22).toFixed(1) + 'px');
      });
      boton.addEventListener('pointerleave', function () {
        boton.style.removeProperty('--mx');
        boton.style.removeProperty('--my');
      });
    });

    // ---------- Tarjetas: una luz sigue al cursor ----------
    cada('.card, .plan, .feat, .goal, .road li, .faq-aside', function (el) { el.setAttribute('data-glow', ''); });
    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest && e.target.closest('[data-glow]');
      if (!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--gx', (e.clientX - r.left) + 'px');
      el.style.setProperty('--gy', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  // ---------- Slogans: la cinta se acelera y se inclina con la velocidad del scroll ----------
  var pista = document.querySelector('.marquee__track');
  var animacion = pista && pista.getAnimations ? pista.getAnimations()[0] : null;
  if (animacion) {
    var cinta = pista.parentNode;
    var ultimoY = window.scrollY;
    var velocidad = 0;
    var corriendo = false;
    var visible = false;
    var latido = function () {
      var y = window.scrollY;
      velocidad += ((y - ultimoY) - velocidad) * 0.18;
      ultimoY = y;
      var fuerza = Math.min(Math.abs(velocidad), 60);
      animacion.playbackRate = 1 + fuerza / 7;
      cinta.style.setProperty('--sesgo', (-Math.max(-12, Math.min(12, velocidad * 0.35))).toFixed(2) + 'deg');
      if (visible || fuerza > 0.2) {
        requestAnimationFrame(latido);
      } else {
        corriendo = false;
        animacion.playbackRate = 1;
        cinta.style.setProperty('--sesgo', '0deg');
      }
    };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entradas) {
        visible = entradas[0].isIntersecting;
        if (visible && !corriendo) { corriendo = true; ultimoY = window.scrollY; requestAnimationFrame(latido); }
      }).observe(cinta);
    }
  }

  // ---------- Pestañas de capturas: la píldora se desliza hasta la pestaña elegida ----------
  var lista = document.querySelector('[data-tabs]');
  if (lista) {
    var pildora = document.createElement('span');
    pildora.className = 'tabs__pill';
    pildora.setAttribute('aria-hidden', 'true');
    lista.insertBefore(pildora, lista.firstChild);
    lista.classList.add('tabs--pill');
    var mover = function () {
      var elegida = lista.querySelector('[aria-selected="true"]');
      if (!elegida) return;
      pildora.style.width = elegida.offsetWidth + 'px';
      pildora.style.height = elegida.offsetHeight + 'px';
      pildora.style.transform = 'translate(' + elegida.offsetLeft + 'px,' + elegida.offsetTop + 'px)';
    };
    mover();
    requestAnimationFrame(function () { requestAnimationFrame(function () { pildora.classList.add('is-ready'); }); });
    new MutationObserver(mover).observe(lista, { attributes: true, subtree: true, attributeFilter: ['aria-selected'] });
    window.addEventListener('resize', mover);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(mover);
  }

  // ---------- Menú: marca la sección que se está leyendo ----------
  var enlaces = {};
  cada('.nav__link', function (a) {
    var id = (a.getAttribute('href') || '').replace('#', '');
    var seccion = id && document.getElementById(id);
    if (seccion) enlaces[id] = a;
  });
  if ('IntersectionObserver' in window && Object.keys(enlaces).length) {
    var espia = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (en) {
        var a = enlaces[en.target.id];
        if (a) a.classList.toggle('is-active', en.isIntersecting);
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(enlaces).forEach(function (id) { espia.observe(document.getElementById(id)); });
  }
})();
