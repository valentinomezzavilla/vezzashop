// Panel: inicio, productos de a uno (con fotos), categorías y cuenta. Se monta después del login.
import express from 'express';
import multer from 'multer';
import { verificarCsrf } from '../csrf.js';
import { resumenTienda } from '../inicio.js';
import {
  FILTROS,
  esFiltro,
  MAX_ATRIBUTOS,
  MAX_FOTOS,
  listarProductosAdmin,
  contarPorFiltro,
  leerProducto,
  formularioDesdeProducto,
  validarProducto,
  guardarProducto,
  borrarProducto,
  cambiarMarca,
  listarFotos,
  agregarFoto,
  moverFoto,
  borrarFoto,
} from '../productos.js';
import { arbolCategoriasAdmin, aplanar, validarCategoria, crearCategoria, editarCategoria, borrarCategoria } from '../categorias.js';
import { buscarTienda, renombrarTienda, cambiarClave, LARGO_MINIMO_CLAVE } from '../tiendas.js';
import { guardarImagen, borrarImagen, urlImagen, ErrorDeImagen, TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';
import { urlTienda } from '../util/dominios.js';
import { plural } from '../util/formato.js';

const MEGAS_IMAGEN = TAMANO_MAXIMO_IMAGEN / 1024 / 1024;
const id = (valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

export function rutasAdminTienda({ db, config }) {
  const router = express.Router();
  const recibirFotos = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_IMAGEN, files: MAX_FOTOS },
  }).array('fotos', MAX_FOTOS);

  const avisar = (req, tipo, texto, seccion) => (req.session.aviso = { tipo, texto, ...(seccion && { seccion }) });

  // ---------- Inicio ----------

  router.get('/inicio', (req, res) => {
    const tienda = buscarTienda(db, req.session.usuario.tiendaId);
    res.render('admin/inicio', { resumen: resumenTienda(db, tienda.id), tienda });
  });

  // ---------- Productos ----------

  router.get('/productos', (req, res) => {
    const { tiendaId } = req.session.usuario;
    const filtro = esFiltro(req.query.filtro) ? req.query.filtro : 'todos';
    const busqueda = String(req.query.q ?? '').slice(0, 100);
    res.render('admin/productos', {
      productos: listarProductosAdmin(db, tiendaId, { busqueda, filtro }).map((p) => ({ ...p, urlFoto: urlImagen(tiendaId, p.foto) })),
      cuentas: contarPorFiltro(db, tiendaId),
      filtros: FILTROS,
      filtro,
      busqueda,
    });
  });

  function mostrarEditor(req, res, { producto = null, formulario, errores = {}, status = 200 }) {
    const { tiendaId } = req.session.usuario;
    const tienda = buscarTienda(db, tiendaId);
    res.status(status).render('admin/producto', {
      producto,
      formulario,
      errores,
      categorias: aplanar(arbolCategoriasAdmin(db, tiendaId)),
      fotos: producto ? listarFotos(db, tiendaId, producto.id).map((f) => ({ ...f, url: urlImagen(tiendaId, f.archivo) })) : [],
      urlEnTienda: producto ? `${urlTienda(req, config.dominio, tienda.slug)}/producto/${producto.slug}` : null,
      maxAtributos: MAX_ATRIBUTOS,
      maxFotos: MAX_FOTOS,
      megasImagen: MEGAS_IMAGEN,
    });
  }

  const hayErrores = (errores) => Object.keys(errores).length > 0;

  router.get('/productos/nuevo', (req, res) => mostrarEditor(req, res, { formulario: formularioDesdeProducto(null) }));

  router.post('/productos/nuevo', verificarCsrf, (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, formulario, errores } = validarProducto(db, tiendaId, null, req.body);
    if (hayErrores(errores)) return mostrarEditor(req, res, { formulario, errores, status: 400 });
    const nuevoId = guardarProducto(db, tiendaId, null, datos);
    avisar(req, 'ok', 'Creamos el producto. Ahora podés sumarle fotos.');
    res.redirect(`/admin/productos/${nuevoId}`);
  });

  // Carga el producto de la tienda; si no existe (o es de otra tienda) sigue de largo hasta el 404.
  const cargarProducto = (req, res, next) => {
    const productoId = id(req.params.productoId);
    req.producto = productoId === null ? null : leerProducto(db, req.session.usuario.tiendaId, productoId);
    next(req.producto ? undefined : 'route');
  };

  router.get('/productos/:productoId', cargarProducto, (req, res) => {
    mostrarEditor(req, res, { producto: req.producto, formulario: formularioDesdeProducto(req.producto) });
  });

  router.post('/productos/:productoId', cargarProducto, verificarCsrf, (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, formulario, errores } = validarProducto(db, tiendaId, req.producto.id, req.body);
    if (hayErrores(errores)) return mostrarEditor(req, res, { producto: req.producto, formulario, errores, status: 400 });
    guardarProducto(db, tiendaId, req.producto.id, datos);
    avisar(req, 'ok', 'Guardamos los cambios del producto.');
    res.redirect(`/admin/productos/${req.producto.id}`);
  });

  router.post('/productos/:productoId/borrar', cargarProducto, verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const fotos = borrarProducto(db, tiendaId, req.producto.id) ?? [];
    for (const archivo of fotos) await borrarImagen(config.dirSubidas, tiendaId, archivo);
    avisar(req, 'ok', `Borramos "${req.producto.nombre}".`);
    res.redirect('/admin/productos');
  });

  // Mostrar/ocultar y destacar desde el listado, sin entrar al producto.
  // El chequeo del campo va primero: "/fotos" también entra acá y tiene que seguir de largo antes del CSRF,
  // porque su formulario es multipart y todavía no se leyó.
  const soloMarcas = (req, res, next) => next(['visible', 'destacado'].includes(req.params.campo) ? undefined : 'route');
  router.post('/productos/:productoId/:campo', soloMarcas, cargarProducto, verificarCsrf, (req, res) => {
    const valor = req.body.valor === '1';
    cambiarMarca(db, req.session.usuario.tiendaId, req.producto.id, req.params.campo, valor);
    const textos = {
      visible: valor ? 'ya se ve en la tienda' : 'quedó oculto',
      destacado: valor ? 'aparece en Destacados' : 'ya no está en Destacados',
    };
    avisar(req, 'ok', `"${req.producto.nombre}" ${textos[req.params.campo]}.`);
    const volver = String(req.body.volver ?? '');
    res.redirect(volver.startsWith('/admin/') && !volver.startsWith('//') ? volver : '/admin/productos');
  });

  const volverAFotos = (req, res) => res.redirect(`/admin/productos/${req.producto.id}#fotos`);

  router.post(
    '/productos/:productoId/fotos',
    cargarProducto,
    (req, res, next) =>
      recibirFotos(req, res, (error) => {
        if (error instanceof multer.MulterError) {
          const texto = error.code === 'LIMIT_FILE_SIZE'
            ? `Alguna foto pesa más de ${MEGAS_IMAGEN} MB. Achicala y probá de nuevo.`
            : `Podés subir hasta ${MAX_FOTOS} fotos por producto.`;
          avisar(req, 'error', texto, 'fotos');
          return volverAFotos(req, res);
        }
        next(error);
      }),
    verificarCsrf,
    async (req, res) => {
      const { tiendaId } = req.session.usuario;
      const archivos = req.files ?? [];
      if (archivos.length === 0) {
        avisar(req, 'error', 'Elegí al menos una foto.', 'fotos');
        return volverAFotos(req, res);
      }
      const lugar = MAX_FOTOS - listarFotos(db, tiendaId, req.producto.id).length;
      if (archivos.length > lugar) {
        avisar(req, 'error', lugar ? `Podés agregar ${plural(lugar, 'foto más', 'fotos más')}.` : `Ya tiene ${MAX_FOTOS} fotos, el máximo.`, 'fotos');
        return volverAFotos(req, res);
      }
      // Primero se revisan todas, así no queda una carga a medias si una no es imagen.
      const guardadas = [];
      try {
        for (const archivo of archivos) guardadas.push(await guardarImagen(config.dirSubidas, tiendaId, archivo.buffer));
      } catch (error) {
        if (!(error instanceof ErrorDeImagen)) throw error;
        for (const archivo of guardadas) await borrarImagen(config.dirSubidas, tiendaId, archivo);
        avisar(req, 'error', `No subimos nada: ${error.message}`, 'fotos');
        return volverAFotos(req, res);
      }
      for (const archivo of guardadas) agregarFoto(db, tiendaId, req.producto.id, archivo);
      avisar(req, 'ok', guardadas.length === 1 ? 'Agregamos la foto.' : `Agregamos ${guardadas.length} fotos.`, 'fotos');
      volverAFotos(req, res);
    },
  );

  const ACCIONES_FOTO = { subir: -1, bajar: 1, principal: 'principal' };
  router.post('/productos/:productoId/fotos/:fotoId/:accion', cargarProducto, verificarCsrf, async (req, res, next) => {
    const { tiendaId } = req.session.usuario;
    const fotoId = id(req.params.fotoId);
    const { accion } = req.params;
    if (accion !== 'borrar' && !Object.hasOwn(ACCIONES_FOTO, accion)) return next();
    if (fotoId !== null && accion === 'borrar') {
      const archivo = borrarFoto(db, tiendaId, req.producto.id, fotoId);
      if (archivo) {
        await borrarImagen(config.dirSubidas, tiendaId, archivo);
        avisar(req, 'ok', 'Borramos la foto.', 'fotos');
      }
    } else if (fotoId !== null) {
      moverFoto(db, tiendaId, req.producto.id, fotoId, ACCIONES_FOTO[accion]);
    }
    volverAFotos(req, res);
  });

  // ---------- Categorías ----------

  function mostrarCategorias(req, res, { error = null, valores = {}, editando = null, status = 200 } = {}) {
    const arbol = arbolCategoriasAdmin(db, req.session.usuario.tiendaId);
    res.status(status).render('admin/categorias', { categorias: aplanar(arbol), error, valores, editando });
  }

  router.get('/categorias', (req, res) => mostrarCategorias(req, res));

  router.post('/categorias', verificarCsrf, (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, error } = validarCategoria(db, tiendaId, null, req.body);
    if (error) return mostrarCategorias(req, res, { error, valores: req.body, status: 400 });
    crearCategoria(db, tiendaId, datos);
    avisar(req, 'ok', `Creamos la categoría "${datos.nombre}".`);
    res.redirect('/admin/categorias');
  });

  router.post('/categorias/:categoriaId', verificarCsrf, (req, res, next) => {
    const { tiendaId } = req.session.usuario;
    const categoriaId = id(req.params.categoriaId);
    if (categoriaId === null) return next();
    const { datos, error } = validarCategoria(db, tiendaId, categoriaId, req.body);
    if (error) return mostrarCategorias(req, res, { error, valores: req.body, editando: categoriaId, status: 400 });
    if (!editarCategoria(db, tiendaId, categoriaId, datos)) return next();
    avisar(req, 'ok', `Guardamos "${datos.nombre}".`);
    res.redirect('/admin/categorias');
  });

  router.post('/categorias/:categoriaId/borrar', verificarCsrf, (req, res, next) => {
    const categoriaId = id(req.params.categoriaId);
    const borradas = categoriaId === null ? 0 : borrarCategoria(db, req.session.usuario.tiendaId, categoriaId);
    if (!borradas) return next();
    avisar(req, 'ok', borradas === 1 ? 'Borramos la categoría.' : `Borramos la categoría y ${plural(borradas - 1, 'subcategoría', 'subcategorías')}.`);
    res.redirect('/admin/categorias');
  });

  // ---------- Cuenta ----------

  function mostrarCuenta(req, res, { errores = {}, status = 200 } = {}) {
    const tienda = buscarTienda(db, req.session.usuario.tiendaId);
    res.status(status).render('admin/cuenta', {
      tienda,
      email: req.session.usuario.email,
      urlTienda: urlTienda(req, config.dominio, tienda.slug),
      errores,
      largoMinimoClave: LARGO_MINIMO_CLAVE,
    });
  }

  router.get('/cuenta', (req, res) => mostrarCuenta(req, res));

  router.post('/cuenta/tienda', verificarCsrf, (req, res) => {
    const error = renombrarTienda(db, req.session.usuario.tiendaId, req.body.nombre);
    if (error) return mostrarCuenta(req, res, { errores: { nombre: error }, status: 400 });
    avisar(req, 'ok', 'Cambiamos el nombre de la tienda.');
    res.redirect('/admin/cuenta');
  });

  router.post('/cuenta/clave', verificarCsrf, async (req, res) => {
    const problema = await cambiarClave(db, req.session.usuario.id, {
      actual: req.body.claveActual,
      nueva: req.body.claveNueva,
      repetida: req.body.claveRepetida,
    });
    if (problema) return mostrarCuenta(req, res, { errores: { [problema.campo]: problema.mensaje }, status: 400 });
    avisar(req, 'ok', 'Cambiamos tu clave. La próxima vez que ingreses, usá la nueva.');
    res.redirect('/admin/cuenta');
  });

  return router;
}
