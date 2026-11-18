import express from 'express';
import session from 'express-session';
import compression from 'compression';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { AlmacenSesiones } from './almacen-sesiones.js';
import { rutasAdmin } from './rutas/admin.js';
import { rutasTienda } from './rutas/tienda.js';
import { rutasPlataforma } from './rutas/plataforma.js';
import { buscarTiendaPorSlug } from './tiendas.js';
import { formatearPrecio } from './util/formato.js';
import { formatearDia } from './util/fechas.js';
import { icono } from './util/iconos.js';
import { vezza } from './util/vezza.js';
import { dominioDeTiendas, slugDeHost, urlPanel } from './util/dominios.js';

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;

export function crearApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.produccion) app.set('trust proxy', 1);

  app.set('views', path.join(import.meta.dirname, 'vistas'));
  app.set('view engine', 'ejs');
  Object.assign(app.locals, {
    formatearPrecio,
    formatearDia,
    icono,
    vezza,
    usuario: null,
    aviso: null,
    csrf: '',
    urlMiTienda: null,
    nombreTienda: null,
    seccionActual: null,
    pedidosNuevos: 0,
  });

  // Para el chequeo de salud de Coolify/Docker: va primero para responder con cualquier host y sin crear sesión.
  app.get('/salud', async (req, res) => {
    await db.prepare('SELECT 1').get();
    res.type('text').send('ok');
  });

  // gzip o brotli para HTML, CSS, JS y JSON. Las imágenes ya vienen comprimidas (WebP) y no se tocan.
  app.use(compression());

  app.use(express.static(path.join(import.meta.dirname, 'publico')));
  // Imágenes subidas por los clientes. Cada archivo tiene un nombre nuevo, así que se pueden cachear para siempre.
  app.use('/subidas', express.static(config.dirSubidas, { immutable: true, maxAge: '365d', index: false }));
  // Las imágenes subidas antes de las miniaturas (<uuid>.jpg) no tienen <uuid>-m.webp ni <uuid>-s.webp: hasta que
  // scripts/migrar-imagenes.js las convierta, se manda al original. El redirect va con caché corta: con `immutable`
  // el navegador se quedaría un año con el original pesado aunque después exista la miniatura.
  app.get('/subidas/:tiendaId/:archivo', async (req, res, next) => {
    const { tiendaId, archivo } = req.params;
    const partes = /^([A-Za-z0-9-]+)-[ms]\.webp$/.exec(archivo);
    if (!partes || !/^\d+$/.test(tiendaId)) return next();
    for (const extension of ['jpg', 'png', 'webp']) {
      const original = `${partes[1]}.${extension}`;
      try {
        await access(path.join(config.dirSubidas, tiendaId, original));
      } catch {
        continue;
      }
      res.set('Cache-Control', 'public, max-age=300');
      return res.redirect(302, `/subidas/${tiendaId}/${original}`);
    }
    next();
  });

  // Si el host es el subdominio de una tienda, responde su vidriera. Va antes de las sesiones:
  // la vidriera no las usa y así las visitas no crean sesiones.
  const vidriera = rutasTienda({ db, config });
  app.use(async (req, res, next) => {
    const slug = slugDeHost(req.hostname, dominioDeTiendas(config), config.dominio);
    if (slug === null) return next();
    req.tienda = await buscarTiendaPorSlug(db, slug);
    if (!req.tienda) return res.status(404).render('tienda/no-existe', { urlPanel: urlPanel(req, config.dominio) });
    // Tienda suspendida por quien administra la plataforma: los compradores ven un aviso (y los buscadores, que es temporal).
    if (req.tienda.estado === 'suspendida') {
      res.set('Cache-Control', 'no-store').set('Retry-After', '86400');
      return res.status(503).render('tienda/suspendida', { nombre: req.tienda.nombre });
    }
    vidriera(req, res, next);
  });

  // Más campos que los 1000 de fábrica: al borrar varios productos, cada uno marcado es un campo "ids".
  app.use(express.urlencoded({ extended: false, parameterLimit: 10_000, limit: '200kb' }));
  app.use(
    session({
      name: 'sesion',
      store: new AlmacenSesiones(db),
      secret: config.secretoSesion,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: config.produccion, maxAge: OCHO_HORAS_MS },
    }),
  );

  app.use('/admin', rutasAdmin({ db, config }));
  app.use('/plataforma', rutasPlataforma({ db, config }));
  app.get('/', (req, res) => res.redirect('/admin'));

  app.use((req, res) => {
    res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esta página no existe.' });
  });
  app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).render('error', { titulo: 'Algo salió mal', mensaje: 'Probá de nuevo en un rato.' });
  });

  return app;
}
