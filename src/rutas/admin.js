import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { autenticar, buscarTienda } from '../tiendas.js';
import { dominioDeTiendas, urlTienda } from '../util/dominios.js';
import { rutasAdminTienda } from './admin-tienda.js';
import { rutasAdminPedidos } from './admin-pedidos.js';
import { contarPedidosNuevos } from '../pedidos.js';
import { tokenCsrf, verificarCsrf } from '../csrf.js';
import { plural } from '../util/formato.js';
import { interpretarHoja } from '../importacion/interpretar.js';
import { previsualizar, aplicarImportacion, ErrorDeImportacion } from '../importacion/aplicar.js';
import { leerExcel, ErrorDeLectura } from '../importacion/leer-excel.js';
import { generarPlantilla } from '../importacion/plantilla.js';
import {
  leerAjustes,
  actualizarAjustes,
  validarAjustes,
  validarEnlace,
  listarBanners,
  agregarBanner,
  moverBanner,
  borrarBanner,
  MAX_BANNERS,
} from '../diseno.js';
import { guardarImagen, borrarImagen, urlImagen, ErrorDeImagen, TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';
import { ORDENES } from '../vidriera.js';

const TAMANO_MAXIMO = 5 * 1024 * 1024;
const VIDA_ARCHIVO_PENDIENTE_MS = 24 * 60 * 60 * 1000;
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ERROR_LECTURA =
  'No pudimos leer el archivo. Tiene que ser un Excel (.xlsx). Si lo tenés en otro formato, ' +
  'abrilo en Excel o Google Sheets y guardalo como .xlsx.';

function textoResumen(r) {
  return (
    `Listo: se cargaron ${plural(r.productosNuevos, 'producto nuevo', 'productos nuevos')} ` +
    `y se actualizaron ${plural(r.productosActualizados, 'producto', 'productos')} ` +
    `(${plural(r.variantesNuevas, 'variante nueva', 'variantes nuevas')}, ` +
    `${plural(r.variantesActualizadas, 'actualizada', 'actualizadas')}).`
  );
}

const MEGAS_IMAGEN = TAMANO_MAXIMO_IMAGEN / 1024 / 1024;

const regenerarSesion = (req) =>
  new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));

export function rutasAdmin({ db, config }) {
  const router = express.Router();
  const recibirArchivo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO, files: 1 },
  }).single('archivo');
  const recibirImagenes = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_IMAGEN, files: 2 },
  });

  // Corre multer y, si el archivo es muy grande o viene mal, vuelve a Diseño con un aviso.
  const conImagenes = (middleware) => (req, res, next) =>
    middleware(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const texto = error.code === 'LIMIT_FILE_SIZE'
          ? `La imagen pesa más de ${MEGAS_IMAGEN} MB. Achicala y probá de nuevo.`
          : 'No pudimos recibir la imagen. Probá de nuevo.';
        req.session.aviso = { tipo: 'error', texto };
        return res.redirect('/admin/diseno');
      }
      next(error);
    });

  async function mostrarDiseno(req, res, { valores = null, errores = {}, status = 200 } = {}) {
    const { tiendaId } = req.session.usuario;
    const ajustes = await leerAjustes(db, tiendaId);
    res.status(status).render('admin/diseno', {
      valores: valores ?? ajustes,
      errores,
      urlLogo: urlImagen(tiendaId, ajustes.logo),
      ordenes: ORDENES,
      banners: (await listarBanners(db, tiendaId)).map((b) => ({ ...b, urlImagen: urlImagen(tiendaId, b.imagen) })),
      maxBanners: MAX_BANNERS,
      megasImagen: MEGAS_IMAGEN,
    });
  }

  router.use(async (req, res, next) => {
    res.locals.csrf = tokenCsrf(req);
    res.locals.usuario = req.session.usuario ?? null;
    const tienda = req.session.usuario ? await buscarTienda(db, req.session.usuario.tiendaId) : null;
    res.locals.urlMiTienda = tienda ? urlTienda(req, dominioDeTiendas(config), tienda.slug) : null;
    res.locals.nombreTienda = tienda?.nombre ?? null;
    // Para el número al lado de "Pedidos" en el menú.
    res.locals.pedidosNuevos = tienda ? await contarPedidosNuevos(db, tienda.id) : 0;
    // Para marcar en el menú la sección en la que se está: "/productos" -> "productos", "/importar/x" -> "importar".
    res.locals.seccionActual = req.path.split('/')[1] || null;
    res.locals.aviso = req.session.aviso ?? null;
    delete req.session.aviso;
    next();
  });

  router.get('/ingresar', (req, res) => {
    if (req.session.usuario) return res.redirect('/admin/inicio');
    res.render('admin/ingresar', { error: null, email: '' });
  });

  router.post('/ingresar', verificarCsrf, async (req, res) => {
    const usuario = await autenticar(db, req.body.email, req.body.clave);
    if (!usuario) {
      return res.status(401).render('admin/ingresar', { error: 'Email o clave incorrectos', email: req.body.email ?? '' });
    }
    await regenerarSesion(req); // evita que alguien fije la sesión antes del login
    req.session.usuario = usuario;
    res.redirect('/admin/inicio');
  });

  router.post('/salir', verificarCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('sesion').redirect('/admin/ingresar');
    });
  });

  // De acá para abajo, todo requiere haber ingresado.
  router.use((req, res, next) => {
    if (!req.session.usuario) return res.redirect('/admin/ingresar');
    next();
  });

  router.get('/', (req, res) => res.redirect('/admin/inicio'));
  router.use(rutasAdminTienda({ db, config }));
  router.use(rutasAdminPedidos({ db, config }));

  router.get('/importar', (req, res) => res.render('admin/importar', { error: null }));

  router.get('/importar/plantilla.xlsx', async (req, res) => {
    res.type(TIPO_XLSX).attachment('plantilla-productos.xlsx').send(await generarPlantilla());
  });

  router.post(
    '/importar',
    (req, res, next) =>
      recibirArchivo(req, res, (error) => {
        if (error instanceof multer.MulterError) {
          const mensaje = error.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa más de 5 MB.' : ERROR_LECTURA;
          return res.status(400).render('admin/importar', { error: mensaje });
        }
        next(error);
      }),
    verificarCsrf,
    async (req, res) => {
      if (!req.file) return res.status(400).render('admin/importar', { error: 'Elegí un archivo .xlsx para subir.' });
      const { tiendaId } = req.session.usuario;

      let filas;
      try {
        filas = await leerExcel(req.file.buffer);
      } catch (error) {
        if (!(error instanceof ErrorDeLectura)) throw error;
        return res.status(400).render('admin/importar', { error: ERROR_LECTURA });
      }

      const { productos, errores: erroresFormato } = interpretarHoja(filas);
      const { resumen, errores: erroresBase } = await previsualizar(db, tiendaId, productos);
      const filasConError = new Set(erroresFormato.map((e) => e.fila));
      const errores = [...erroresFormato, ...erroresBase.filter((e) => !filasConError.has(e.fila))].sort(
        (a, b) => a.fila - b.fila,
      );

      await descartarPendiente(req, config);
      if (errores.length === 0 && productos.length > 0) {
        await mkdir(config.dirImportaciones, { recursive: true });
        await borrarPendientesViejos(config.dirImportaciones);
        const archivo = `${tiendaId}-${randomUUID()}.xlsx`;
        await writeFile(path.join(config.dirImportaciones, archivo), req.file.buffer);
        req.session.importacion = { archivo, nombreOriginal: req.file.originalname };
      }

      res.render('admin/vista-previa', {
        nombreArchivo: req.file.originalname,
        resumen,
        errores,
        vacio: productos.length === 0 && errores.length === 0,
      });
    },
  );

  router.post('/importar/confirmar', verificarCsrf, async (req, res) => {
    const pendiente = req.session.importacion;
    if (!pendiente) {
      req.session.aviso = { tipo: 'error', texto: 'No hay ninguna importación pendiente. Subí el archivo de nuevo.' };
      return res.redirect('/admin/importar');
    }
    delete req.session.importacion;
    const ruta = path.join(config.dirImportaciones, path.basename(pendiente.archivo));

    try {
      const { productos, errores } = interpretarHoja(await leerExcel(await readFile(ruta)));
      if (errores.length > 0) throw new ErrorDeImportacion(errores);
      const resumen = await aplicarImportacion(db, req.session.usuario.tiendaId, productos);
      req.session.aviso = { tipo: 'ok', texto: textoResumen(resumen) };
      res.redirect('/admin/productos');
    } catch (error) {
      // Puede pasar si entre la vista previa y la confirmación cambió algo en la tienda.
      if (!(error instanceof ErrorDeImportacion)) throw error;
      res.status(422).render('admin/vista-previa', {
        nombreArchivo: pendiente.nombreOriginal,
        resumen: null,
        errores: error.errores,
        vacio: false,
      });
    } finally {
      await rm(ruta, { force: true });
    }
  });

  router.get('/diseno', (req, res) => mostrarDiseno(req, res));

  router.post('/diseno', conImagenes(recibirImagenes.single('logo')), verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { ajustes, errores } = validarAjustes(req.body);
    if (Object.keys(errores).length > 0) {
      if (req.file) errores.logo = 'Revisá los otros campos y volvé a elegir el logo.';
      return mostrarDiseno(req, res, { valores: req.body, errores, status: 400 });
    }

    const logoAnterior = (await leerAjustes(db, tiendaId)).logo;
    let logo = req.body.quitarLogo ? null : logoAnterior;
    if (req.file) {
      try {
        logo = await guardarImagen(config.dirSubidas, tiendaId, req.file.buffer);
      } catch (error) {
        if (!(error instanceof ErrorDeImagen)) throw error;
        return mostrarDiseno(req, res, { valores: req.body, errores: { logo: error.message }, status: 400 });
      }
    }
    await actualizarAjustes(db, tiendaId, { ...ajustes, logo });
    if (logo !== logoAnterior) await borrarImagen(config.dirSubidas, tiendaId, logoAnterior);

    req.session.aviso = { tipo: 'ok', texto: 'Listo, guardamos los cambios. Ya se ven en tu tienda.' };
    res.redirect('/admin/diseno');
  });

  router.post(
    '/diseno/banners',
    conImagenes(recibirImagenes.fields([{ name: 'imagen', maxCount: 1 }, { name: 'imagenMovil', maxCount: 1 }])),
    verificarCsrf,
    async (req, res) => {
      const { tiendaId } = req.session.usuario;
      const volverConError = (texto) => {
        req.session.aviso = { tipo: 'error', texto, seccion: 'banners' };
        res.redirect('/admin/diseno#banners');
      };

      if ((await listarBanners(db, tiendaId)).length >= MAX_BANNERS) {
        return volverConError(`Podés tener hasta ${MAX_BANNERS} banners. Borrá alguno para agregar otro.`);
      }
      const imagen = req.files?.imagen?.[0];
      const imagenMovil = req.files?.imagenMovil?.[0];
      if (!imagen) return volverConError('Elegí la imagen del banner.');
      const enlace = validarEnlace(req.body.enlace);
      if (enlace.error) return volverConError(`Link del banner: ${enlace.error}`);
      const textoAlternativo = String(req.body.textoAlternativo ?? '').trim().slice(0, 150);

      const guardadas = [];
      try {
        for (const archivo of [imagen, imagenMovil].filter(Boolean)) {
          guardadas.push(await guardarImagen(config.dirSubidas, tiendaId, archivo.buffer));
        }
      } catch (error) {
        if (!(error instanceof ErrorDeImagen)) throw error;
        for (const archivo of guardadas) await borrarImagen(config.dirSubidas, tiendaId, archivo);
        return volverConError(error.message);
      }
      await agregarBanner(db, tiendaId, {
        imagen: guardadas[0],
        imagenMovil: guardadas[1] ?? null,
        enlace: enlace.valor,
        textoAlternativo,
      });
      req.session.aviso = { tipo: 'ok', texto: 'Agregamos el banner.', seccion: 'banners' };
      res.redirect('/admin/diseno#banners');
    },
  );

  router.post('/diseno/banners/:id/:accion', verificarCsrf, async (req, res, next) => {
    const { tiendaId } = req.session.usuario;
    const id = Number(req.params.id);
    const { accion } = req.params;
    if (accion === 'subir' || accion === 'bajar') {
      await moverBanner(db, tiendaId, id, accion === 'subir' ? -1 : 1);
    } else if (accion === 'borrar') {
      const borrado = await borrarBanner(db, tiendaId, id);
      if (borrado) {
        await borrarImagen(config.dirSubidas, tiendaId, borrado.imagen);
        await borrarImagen(config.dirSubidas, tiendaId, borrado.imagenMovil);
        req.session.aviso = { tipo: 'ok', texto: 'Borramos el banner.', seccion: 'banners' };
      }
    } else {
      return next();
    }
    res.redirect('/admin/diseno#banners');
  });

  return router;
}

async function descartarPendiente(req, config) {
  const pendiente = req.session.importacion;
  if (!pendiente) return;
  delete req.session.importacion;
  await rm(path.join(config.dirImportaciones, path.basename(pendiente.archivo)), { force: true });
}

// Limpia archivos de importaciones que nadie confirmó.
async function borrarPendientesViejos(dir) {
  const limite = Date.now() - VIDA_ARCHIVO_PENDIENTE_MS;
  for (const nombre of await readdir(dir)) {
    const ruta = path.join(dir, nombre);
    if ((await stat(ruta)).mtimeMs < limite) await rm(ruta, { force: true });
  }
}
