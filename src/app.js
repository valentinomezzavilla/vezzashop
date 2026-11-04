import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { AlmacenSesiones } from './almacen-sesiones.js';
import { rutasAdmin } from './rutas/admin.js';
import { rutasTienda } from './rutas/tienda.js';
import { buscarTiendaPorSlug } from './tiendas.js';
import { formatearPrecio } from './util/formato.js';
import { icono } from './util/iconos.js';
import { slugDeHost, urlPanel } from './util/dominios.js';

const OCHO_HORAS_MS = 8 * 60 * 60 * 1000;

export function crearApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.produccion) app.set('trust proxy', 1);

  app.set('views', path.join(import.meta.dirname, 'vistas'));
  app.set('view engine', 'ejs');
  Object.assign(app.locals, {
    formatearPrecio,
    icono,
    usuario: null,
    aviso: null,
    csrf: '',
    urlMiTienda: null,
    nombreTienda: null,
    seccionActual: null,
    pedidosNuevos: 0,
  });

  app.use(express.static(path.join(import.meta.dirname, 'publico')));
  // Imágenes subidas por los clientes. Cada archivo tiene un nombre nuevo, así que se pueden cachear para siempre.
  app.use('/subidas', express.static(config.dirSubidas, { immutable: true, maxAge: '365d', index: false }));

  // Si el host es el subdominio de una tienda, responde su vidriera. Va antes de las sesiones:
  // la vidriera no las usa y así las visitas no crean sesiones.
  const vidriera = rutasTienda({ db, config });
  app.use((req, res, next) => {
    const slug = slugDeHost(req.hostname, config.dominio);
    if (slug === null) return next();
    req.tienda = buscarTiendaPorSlug(db, slug);
    if (!req.tienda) return res.status(404).render('tienda/no-existe', { urlPanel: urlPanel(req, config.dominio) });
    vidriera(req, res, next);
  });

  app.use(express.urlencoded({ extended: false }));
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
