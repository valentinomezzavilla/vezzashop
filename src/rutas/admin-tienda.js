// Panel: inicio, productos de a uno (con fotos), categorías y cuenta. Se monta después del login.
import express from 'express';
import multer from 'multer';
import { verificarCsrf } from '../csrf.js';
import { resumenTienda } from '../inicio.js';
import {
  FILTROS,
  esFiltro,
  ORDENES_ADMIN,
  esOrdenAdmin,
  categoriaDeFiltro,
  cambiarMarcaVarios,
  ocultarSinStock,
  contarSinStockVisibles,
  MAX_ATRIBUTOS,
  MAX_FOTOS,
  listarProductosAdmin,
  contarPorFiltro,
  leerProducto,
  formularioDesdeProducto,
  validarProducto,
  guardarProducto,
  borrarProducto,
  idsDeFormulario,
  productosParaBorrar,
  borrarProductos,
  cambiarMarca,
  listarFotos,
  agregarFoto,
  moverFoto,
  borrarFoto,
} from '../productos.js';
import { arbolCategoriasAdmin, aplanar, validarCategoria, crearCategoria, editarCategoria, borrarCategoria } from '../categorias.js';
import { buscarTienda, renombrarTienda, cambiarClave, LARGO_MINIMO_CLAVE } from '../tiendas.js';
import { guardarImagen, borrarImagen, urlMiniatura, huellaDe, ErrorDeImagen, TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';
import { dominioDeTiendas, urlPublicaDeTienda } from '../util/dominios.js';
import { datosDeNivel, incluyeNivel } from '../diseno-por-plan.js';
import { ESTADOS_DOMINIO, leerDominio, quitarDominio, registrosDns, solicitarDominio, verificarDominio } from '../dominios-propios.js';
import { limitesDeTienda, usoDeTienda, llegoAlTopeDeProductos, ampliarPlan } from '../limites.js';
import { estadoDeSuscripcion } from '../suscripciones.js';
import { plural } from '../util/formato.js';
import { volverSeguro } from '../util/volver.js';

const MEGAS_IMAGEN = TAMANO_MAXIMO_IMAGEN / 1024 / 1024;

const id =(valor) => (/^\d+$/.test(String(valor)) ? Number(valor) : null);

// servicios: las suscripciones con Mercado Pago (ver suscripciones.js); null si no están configuradas.
export function rutasAdminTienda({ db, config, servicios = null }) {
  const router = express.Router();
  const recibirFotos = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANO_MAXIMO_IMAGEN, files: MAX_FOTOS },
  }).array('fotos', MAX_FOTOS);

  const avisar = (req, tipo, texto, seccion) => (req.session.aviso = { tipo, texto, ...(seccion && { seccion }) });

  // ---------- Inicio ----------

  router.get('/inicio', async (req, res) => {
    const tienda = await buscarTienda(db, req.session.usuario.tiendaId);
    res.render('admin/inicio', {
      resumen: await resumenTienda(db, tienda.id),
      tienda,
      limites: await limitesDeTienda(db, tienda.id),
      // Para avisar, mientras dura el acceso, que la suscripción está cancelada (y no "acordate de abonarlo").
      suscripcion: servicios ? await estadoDeSuscripcion(db, tienda.id) : null,
    });
  });

  // ---------- Productos ----------

  router.get('/productos', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const filtro = esFiltro(req.query.filtro) ? req.query.filtro : 'todos';
    const busqueda = String(req.query.q ?? '').slice(0, 100);
    const orden = esOrdenAdmin(req.query.orden) ? req.query.orden : 'nombre';
    const categoria = categoriaDeFiltro(req.query.categoria);
    res.render('admin/productos', {
      productos: (await listarProductosAdmin(db, tiendaId, { busqueda, filtro, orden, categoria })).map((p) => ({ ...p, urlFoto: urlMiniatura(tiendaId, p.foto, 's') })),
      cuentas: await contarPorFiltro(db, tiendaId),
      limites: await limitesDeTienda(db, tiendaId),
      filtros: FILTROS,
      filtro,
      busqueda,
      ordenes: ORDENES_ADMIN,
      orden,
      categoria,
      categoriasLista: aplanar(await arbolCategoriasAdmin(db, tiendaId)),
      sinStockVisibles: await contarSinStockVisibles(db, tiendaId),
    });
  });

  async function mostrarEditor(req, res, { producto = null, formulario, errores = {}, status = 200 }) {
    const { tiendaId } = req.session.usuario;
    const tienda = await buscarTienda(db, tiendaId);
    res.status(status).render('admin/producto', {
      producto,
      formulario,
      errores,
      categorias: aplanar(await arbolCategoriasAdmin(db, tiendaId)),
      fotos: producto ? (await listarFotos(db, tiendaId, producto.id)).map((f) => ({ ...f, url: urlMiniatura(tiendaId, f.archivo, 'm') })) : [],
      urlEnTienda: producto ? `${urlPublicaDeTienda(req, config, tienda)}/producto/${producto.slug}` : null,
      maxAtributos: MAX_ATRIBUTOS,
      maxFotos: (await limitesDeTienda(db, tiendaId)).maxFotos,
      megasImagen: MEGAS_IMAGEN,
    });
  }

  const hayErrores = (errores) => Object.keys(errores).length > 0;

  // El plan puede limitar cuántos productos tiene la tienda: al llegar al tope no se crean más (editar sigue andando).
  async function avisarSiLlegoAlTope(req, res) {
    const { tiendaId } = req.session.usuario;
    const limites = await limitesDeTienda(db, tiendaId);
    if (!(await llegoAlTopeDeProductos(db, tiendaId, limites))) return false;
    avisar(req, 'error', `Llegaste al máximo de tu plan: hasta ${limites.maxProductos} productos.${ampliarPlan(config)}`);
    res.redirect('/admin/productos');
    return true;
  }

  router.get('/productos/nuevo', async (req, res) => {
    if (await avisarSiLlegoAlTope(req, res)) return;
    mostrarEditor(req, res, { formulario: formularioDesdeProducto(null) });
  });

  router.post('/productos/nuevo', verificarCsrf, async (req, res) => {
    if (await avisarSiLlegoAlTope(req, res)) return;
    const { tiendaId } = req.session.usuario;
    const { datos, formulario, errores } = await validarProducto(db, tiendaId, null, req.body);
    if (hayErrores(errores)) return mostrarEditor(req, res, { formulario, errores, status: 400 });
    const nuevoId = await guardarProducto(db, tiendaId, null, datos);
    avisar(req, 'ok', 'Creamos el producto. Ahora podés sumarle fotos.');
    res.redirect(`/admin/productos/${nuevoId}`);
  });

  // Carga el producto de la tienda; si no existe (o es de otra tienda) sigue de largo hasta el 404.
  const cargarProducto = async (req, res, next) => {
    const productoId = id(req.params.productoId);
    req.producto = productoId === null ? null : await leerProducto(db, req.session.usuario.tiendaId, productoId);
    next(req.producto ? undefined : 'route');
  };

  // ---------- Borrar varios desde el listado ----------
  // Van antes de las rutas con :productoId, para que "borrar-varios" no se tome como un id.

  // Muestra qué se va a borrar y pide confirmarlo (el borrado de verdad es /borrar-varios/confirmar).
  async function confirmarBorradoDeVarios(req, res) {
    const { tiendaId } = req.session.usuario;
    const volver = volverSeguro(req.body.volver);
    const productos = await productosParaBorrar(db, tiendaId, idsDeFormulario(req.body.ids));
    if (productos.length === 0) {
      avisar(req, 'error', 'Elegí al menos un producto para borrar.');
      return res.redirect(volver);
    }
    res.render('admin/borrar-productos', {
      productos: productos.map((p) => ({ ...p, urlFoto: urlMiniatura(tiendaId, p.foto, 's') })),
      volver,
    });
  }

  router.post('/productos/borrar-varios', verificarCsrf, confirmarBorradoDeVarios);

  // Lo que se puede hacer con los productos marcados en el listado. "Borrar" no borra: pasa por la pantalla de confirmación.
  const ACCIONES_VARIOS = {
    mostrar: { campo: 'visible', valor: true, texto: (n) => `Mostramos ${plural(n, 'producto', 'productos')} en la tienda.` },
    ocultar: { campo: 'visible', valor: false, texto: (n) => `Ocultamos ${plural(n, 'producto', 'productos')} de la tienda.` },
    destacar: { campo: 'destacado', valor: true, texto: (n) => `Destacamos ${plural(n, 'producto', 'productos')} en la portada.` },
    'quitar-destacado': { campo: 'destacado', valor: false, texto: (n) => `Sacamos ${plural(n, 'producto', 'productos')} de destacados.` },
  };

  router.post('/productos/acciones-varias', verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const accion = String(req.body.accion ?? '');
    if (accion === 'borrar') return confirmarBorradoDeVarios(req, res);
    const volver = volverSeguro(req.body.volver);
    const ids = idsDeFormulario(req.body.ids);
    if (!Object.hasOwn(ACCIONES_VARIOS, accion)) {
      avisar(req, 'error', 'Elegí qué querés hacer con los productos marcados.');
      return res.redirect(volver);
    }
    if (ids.length === 0) {
      avisar(req, 'error', 'Elegí al menos un producto.');
      return res.redirect(volver);
    }
    const { campo, valor, texto } = ACCIONES_VARIOS[accion];
    const cambiados = await cambiarMarcaVarios(db, tiendaId, ids, campo, valor);
    avisar(req, 'ok', cambiados > 0 ? texto(cambiados) : 'Esos productos ya estaban así: no cambió nada.');
    res.redirect(volver);
  });

  // Saca de la tienda, de un solo paso, todo lo que está visible y sin stock (cuando vuelva a haber stock, se vuelve a mostrar a mano).
  router.post('/productos/ocultar-sin-stock', verificarCsrf, async (req, res) => {
    const ocultados = await ocultarSinStock(db, req.session.usuario.tiendaId);
    avisar(req, 'ok', ocultados > 0 ? `Ocultamos ${plural(ocultados, 'producto sin stock', 'productos sin stock')} de la tienda.` : 'No hay productos visibles sin stock.');
    res.redirect(volverSeguro(req.body.volver));
  });

  router.post('/productos/borrar-varios/confirmar', verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const ids = idsDeFormulario(req.body.ids);
    const { borrados, fotos } = await borrarProductos(db, tiendaId, ids);
    for (const archivo of fotos) await borrarImagen(config.dirSubidas, tiendaId, archivo);
    if (borrados > 0) avisar(req, 'ok', `Borramos ${plural(borrados, 'producto', 'productos')}.`);
    else if (ids.length === 0) avisar(req, 'error', 'Elegí al menos un producto para borrar.');
    // Si se mandaron productos que ya no estaban (por ejemplo, por un doble clic), no hay nada nuevo que avisar.
    // Pero este pedido ya se llevó de la sesión el "Borramos…" del primer envío (los avisos se leen en cada pedido),
    // así que se devuelve para que se vea.
    else if (res.locals.aviso) req.session.aviso = res.locals.aviso;
    res.redirect(volverSeguro(req.body.volver));
  });

  router.get('/productos/:productoId', cargarProducto, (req, res) => {
    mostrarEditor(req, res, { producto: req.producto, formulario: formularioDesdeProducto(req.producto) });
  });

  router.post('/productos/:productoId', cargarProducto, verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, formulario, errores } = await validarProducto(db, tiendaId, req.producto.id, req.body);
    if (hayErrores(errores)) return mostrarEditor(req, res, { producto: req.producto, formulario, errores, status: 400 });
    await guardarProducto(db, tiendaId, req.producto.id, datos);
    avisar(req, 'ok', 'Guardamos los cambios del producto.');
    res.redirect(`/admin/productos/${req.producto.id}`);
  });

  router.post('/productos/:productoId/borrar', cargarProducto, verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const fotos = (await borrarProducto(db, tiendaId, req.producto.id)) ?? [];
    for (const archivo of fotos) await borrarImagen(config.dirSubidas, tiendaId, archivo);
    avisar(req, 'ok', `Borramos "${req.producto.nombre}".`);
    res.redirect('/admin/productos');
  });

  // Mostrar/ocultar y destacar desde el listado, sin entrar al producto.
  // El chequeo del campo va primero: "/fotos" también entra acá y tiene que seguir de largo antes del CSRF,
  // porque su formulario es multipart y todavía no se leyó.
  const soloMarcas = (req, res, next) => next(['visible', 'destacado'].includes(req.params.campo) ? undefined : 'route');
  router.post('/productos/:productoId/:campo', soloMarcas, cargarProducto, verificarCsrf, async (req, res) => {
    const valor = req.body.valor === '1';
    await cambiarMarca(db, req.session.usuario.tiendaId, req.producto.id, req.params.campo, valor);
    const textos = {
      visible: valor ? 'ya se ve en la tienda' : 'quedó oculto',
      destacado: valor ? 'aparece en Destacados' : 'ya no está en Destacados',
    };
    avisar(req, 'ok', `"${req.producto.nombre}" ${textos[req.params.campo]}.`);
    res.redirect(volverSeguro(req.body.volver));
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
      const { maxFotos } = await limitesDeTienda(db, tiendaId);
      const lugar = Math.max(0, maxFotos - (await listarFotos(db, tiendaId, req.producto.id)).length);
      if (archivos.length > lugar) {
        avisar(req, 'error', lugar ? `Podés agregar ${plural(lugar, 'foto más', 'fotos más')}.` : `Ya tiene ${maxFotos} fotos, el máximo de tu plan.${maxFotos < MAX_FOTOS ? ampliarPlan(config) : ''}`, 'fotos');
        return volverAFotos(req, res);
      }
      // Primero se revisan todas, así no queda una carga a medias si una no es imagen.
      const guardadas = [];
      try {
        for (const archivo of archivos) {
          guardadas.push({ archivo: await guardarImagen(config.dirSubidas, tiendaId, archivo.buffer), huella: huellaDe(archivo.buffer) });
        }
      } catch (error) {
        if (!(error instanceof ErrorDeImagen)) throw error;
        for (const { archivo } of guardadas) await borrarImagen(config.dirSubidas, tiendaId, archivo);
        avisar(req, 'error', `No subimos nada: ${error.message}`, 'fotos');
        return volverAFotos(req, res);
      }
      for (const { archivo, huella } of guardadas) await agregarFoto(db, tiendaId, req.producto.id, archivo, huella);
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
      const archivo = await borrarFoto(db, tiendaId, req.producto.id, fotoId);
      if (archivo) {
        await borrarImagen(config.dirSubidas, tiendaId, archivo);
        avisar(req, 'ok', 'Borramos la foto.', 'fotos');
      }
    } else if (fotoId !== null) {
      await moverFoto(db, tiendaId, req.producto.id, fotoId, ACCIONES_FOTO[accion]);
    }
    volverAFotos(req, res);
  });

  // ---------- Categorías ----------

  async function mostrarCategorias(req, res, { error = null, valores = {}, editando = null, status = 200 } = {}) {
    const arbol = await arbolCategoriasAdmin(db, req.session.usuario.tiendaId);
    res.status(status).render('admin/categorias', { categorias: aplanar(arbol), error, valores, editando });
  }

  router.get('/categorias', (req, res) => mostrarCategorias(req, res));

  router.post('/categorias', verificarCsrf, async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const { datos, error } = await validarCategoria(db, tiendaId, null, req.body);
    if (error) return mostrarCategorias(req, res, { error, valores: req.body, status: 400 });
    await crearCategoria(db, tiendaId, datos);
    avisar(req, 'ok', `Creamos la categoría "${datos.nombre}".`);
    res.redirect('/admin/categorias');
  });

  router.post('/categorias/:categoriaId', verificarCsrf, async (req, res, next) => {
    const { tiendaId } = req.session.usuario;
    const categoriaId = id(req.params.categoriaId);
    if (categoriaId === null) return next();
    const { datos, error } = await validarCategoria(db, tiendaId, categoriaId, req.body);
    if (error) return mostrarCategorias(req, res, { error, valores: req.body, editando: categoriaId, status: 400 });
    if (!(await editarCategoria(db, tiendaId, categoriaId, datos))) return next();
    avisar(req, 'ok', `Guardamos "${datos.nombre}".`);
    res.redirect('/admin/categorias');
  });

  router.post('/categorias/:categoriaId/borrar', verificarCsrf, async (req, res, next) => {
    const categoriaId = id(req.params.categoriaId);
    const borradas = categoriaId === null ? 0 : await borrarCategoria(db, req.session.usuario.tiendaId, categoriaId);
    if (!borradas) return next();
    avisar(req, 'ok', borradas === 1 ? 'Borramos la categoría.' : `Borramos la categoría y ${plural(borradas - 1, 'subcategoría', 'subcategorías')}.`);
    res.redirect('/admin/categorias');
  });

  // ---------- Cuenta ----------

  async function mostrarCuenta(req, res, { errores = {}, status = 200 } = {}) {
    const tienda = await buscarTienda(db, req.session.usuario.tiendaId);
    res.status(status).render('admin/cuenta', {
      tienda,
      email: req.session.usuario.email,
      urlTienda: urlPublicaDeTienda(req, config, tienda),
      errores,
      largoMinimoClave: LARGO_MINIMO_CLAVE,
      limites: await limitesDeTienda(db, tienda.id),
      uso: await usoDeTienda(db, tienda.id),
      contactoPlataforma: config.contactoPlataforma,
      dominio: await datosDeDominio(tienda.id),
    });
  }

  // El dominio propio (plan a medida): lo que se muestra en Cuenta. Los registros DNS que hay que cargar dependen del tipo de dominio.
  // config.resolverDns solo lo usan los tests (para no salir a internet): sin él se usa el DNS de verdad.
  const opcionesDns = { panel: config.dominio, ip: config.ipServidor ?? '', resolver: config.resolverDns };
  async function datosDeDominio(tiendaId) {
    const { nivel } = await datosDeNivel(db, tiendaId);
    const actual = await leerDominio(db, tiendaId);
    return {
      disponible: incluyeNivel(nivel, 'a_medida'),
      actual,
      estados: ESTADOS_DOMINIO,
      registros: actual ? registrosDns(actual.dominio, opcionesDns) : [],
      panel: config.dominio,
    };
  }

  router.get('/cuenta', (req, res) => mostrarCuenta(req, res));

  router.post('/cuenta/tienda', verificarCsrf, async (req, res) => {
    const error = await renombrarTienda(db, req.session.usuario.tiendaId, req.body.nombre);
    if (error) return mostrarCuenta(req, res, { errores: { nombre: error }, status: 400 });
    avisar(req, 'ok', 'Cambiamos el nombre de la tienda.');
    res.redirect('/admin/cuenta');
  });

  // Dominio propio. El cliente lo pide y verifica su DNS; activarlo (agregarlo en Coolify) lo hace quien administra la plataforma.
  // Mientras está activo no se cambia desde acá: cambiarlo dejaría la tienda sin su dominio de un momento a otro.
  const dominioPermitido = async (req, res) => {
    const { tiendaId } = req.session.usuario;
    if (!incluyeNivel((await datosDeNivel(db, tiendaId)).nivel, 'a_medida')) {
      avisar(req, 'error', 'El dominio propio es parte del plan A medida.');
      res.redirect('/admin/cuenta#dominio');
      return false;
    }
    if ((await leerDominio(db, tiendaId))?.estado === 'activo') {
      avisar(req, 'error', 'Tu dominio ya está activo. Para cambiarlo o quitarlo, contactanos.');
      res.redirect('/admin/cuenta#dominio');
      return false;
    }
    return true;
  };

  router.post('/cuenta/dominio', verificarCsrf, async (req, res) => {
    if (!(await dominioPermitido(req, res))) return;
    const resultado = await solicitarDominio(db, req.session.usuario.tiendaId, req.body.dominio, { dominioPanel: config.dominio, dominioTiendas: dominioDeTiendas(config) });
    if (resultado.error) return mostrarCuenta(req, res, { errores: { dominio: resultado.error }, status: 400 });
    avisar(req, 'ok', `Pedimos tu dominio ${resultado.dominio}. Cargá el registro DNS de abajo en el proveedor donde lo compraste y tocá "Verificar ahora".`);
    res.redirect('/admin/cuenta#dominio');
  });

  router.post('/cuenta/dominio/verificar', verificarCsrf, async (req, res) => {
    const resultado = await verificarDominio(db, req.session.usuario.tiendaId, opcionesDns);
    if (!resultado) avisar(req, 'error', 'Todavía no pediste ningún dominio.');
    else if (resultado.ok) avisar(req, 'ok', `El DNS de ${resultado.dominio} ya apunta a la plataforma. Ahora lo activamos nosotros: te avisamos cuando tu tienda se vea ahí.`);
    else avisar(req, 'error', `Todavía no vemos el registro en ${resultado.dominio}. Los cambios de DNS pueden tardar un rato (a veces hasta unas horas): probá de nuevo más tarde.`);
    res.redirect('/admin/cuenta#dominio');
  });

  router.post('/cuenta/dominio/quitar', verificarCsrf, async (req, res) => {
    if (!(await dominioPermitido(req, res))) return;
    await quitarDominio(db, req.session.usuario.tiendaId);
    avisar(req, 'ok', 'Sacamos el dominio. Tu tienda sigue en su link de siempre.');
    res.redirect('/admin/cuenta#dominio');
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
