import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { autenticar } from '../tiendas.js';
import { listarProductos } from '../catalogo.js';
import { tokenCsrf, verificarCsrf } from '../csrf.js';
import { plural } from '../util/formato.js';
import { interpretarHoja } from '../importacion/interpretar.js';
import { previsualizar, aplicarImportacion, ErrorDeImportacion } from '../importacion/aplicar.js';
import { leerExcel, ErrorDeLectura } from '../importacion/leer-excel.js';
import { generarPlantilla } from '../importacion/plantilla.js';

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

const regenerarSesion = (req) =>
  new Promise((resolver, rechazar) => req.session.regenerate((error) => (error ? rechazar(error) : resolver())));

export function rutasAdmin({ db, config }) {
  const router = express.Router();
  const recibirArchivo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO, files: 1 },
  }).single('archivo');

  router.use((req, res, next) => {
    res.locals.csrf = tokenCsrf(req);
    res.locals.usuario = req.session.usuario ?? null;
    res.locals.aviso = req.session.aviso ?? null;
    delete req.session.aviso;
    next();
  });

  router.get('/ingresar', (req, res) => {
    if (req.session.usuario) return res.redirect('/admin/productos');
    res.render('admin/ingresar', { error: null, email: '' });
  });

  router.post('/ingresar', verificarCsrf, async (req, res) => {
    const usuario = await autenticar(db, req.body.email, req.body.clave);
    if (!usuario) {
      return res.status(401).render('admin/ingresar', { error: 'Email o clave incorrectos', email: req.body.email ?? '' });
    }
    await regenerarSesion(req); // evita que alguien fije la sesión antes del login
    req.session.usuario = usuario;
    res.redirect('/admin/productos');
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

  router.get('/', (req, res) => res.redirect('/admin/productos'));

  router.get('/productos', (req, res) => {
    res.render('admin/productos', { productos: listarProductos(db, req.session.usuario.tiendaId) });
  });

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
      const { resumen, errores: erroresBase } = previsualizar(db, tiendaId, productos);
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
      const resumen = aplicarImportacion(db, req.session.usuario.tiendaId, productos);
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
