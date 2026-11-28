// El kit de marca y las maquetas web (una función del plan): el cliente sube sus logos y fotos, elige sus colores y cuenta cómo es su marca;
// con eso se le pide a un flujo de n8n una maqueta de su tienda, que se ve acá apenas llega. Ver marca.js y maquetas.js.
import express from 'express';
import multer from 'multer';
import { verificarCsrf } from '../csrf.js';
import { buscarTienda } from '../tiendas.js';
import { leerAjustes } from '../diseno.js';
import { planDeDiseno } from '../plataforma.js';
import { TAMANO_MAXIMO_IMAGEN, urlImagen } from '../imagenes.js';
import {
  COLORES,
  ESTILOS,
  LARGOS,
  MAX_ARCHIVOS,
  MAX_POR_ENVIO,
  TIPOS_ARCHIVO,
  borrarArchivo,
  esTipoDeArchivo,
  guardarMarca,
  leerMarca,
  listarArchivos,
  subirArchivos,
  validarMarca,
} from '../marca.js';
import {
  MAX_GUARDADAS,
  MAX_POR_DIA,
  armarPedido,
  borrarMaqueta,
  catalogoDeMuestra,
  descartarPedido,
  htmlDeMaqueta,
  leerMaqueta,
  listarMaquetas,
  pedidasEnElDia,
  pedirMaqueta,
  vencerPendientes,
} from '../maquetas.js';
import { urlPanel, urlPublicaDeTienda } from '../util/dominios.js';
import { plural } from '../util/formato.js';

const MEGAS = TAMANO_MAXIMO_IMAGEN / 1024 / 1024;

// La maqueta es HTML que armó otro sistema: se muestra con la política más cerrada que existe. Sin scripts, sin formularios, sin conexiones;
// solo estilos, las tipografías de Google Fonts y las imágenes de la propia plataforma (las que n8n pone con el link completo del dominio del
// panel, que es el mismo en el que se ve; se lo nombra aparte por si el panel se abrió con otro nombre). `sandbox` la deja sin origen propio, y
// `frame-ancestors` hace que solo el panel pueda ponerla en un iframe.
const politicaDeLaMaqueta = (origenDelPanel) => [
  "default-src 'none'",
  `img-src 'self' ${origenDelPanel} data:`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  'sandbox',
].join('; ');

// notificarMaquetas: el aviso a n8n con el pedido (notificaciones.js); sin N8N_MAQUETAS_URL no manda nada y devuelve false.
export function rutasAdminMarca({ db, config, notificarMaquetas = async () => false }) {
  const router = express.Router();
  const recibirArchivos = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANO_MAXIMO_IMAGEN, files: MAX_POR_ENVIO } }).array('archivos', MAX_POR_ENVIO);
  const generadorActivo = Boolean(config.maquetas?.url);

  // Corre multer y, si algo viene mal (una imagen muy pesada, demasiados archivos), vuelve al kit con un aviso.
  const conArchivos = (req, res, next) =>
    recibirArchivos(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const texto =
          error.code === 'LIMIT_FILE_SIZE'
            ? `Una de las imágenes pesa más de ${MEGAS} MB. Achicala y probá de nuevo.`
            : error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE'
              ? `Podés subir hasta ${MAX_POR_ENVIO} imágenes por vez.`
              : 'No pudimos recibir las imágenes. Probá de nuevo.';
        req.session.aviso = { tipo: 'error', texto };
        return res.redirect('/admin/marca');
      }
      next(error);
    });

  // El plan de la tienda y si incluye esto (la función "Kit de marca y maqueta web"). Con un plan que no lo incluye se ve bloqueado, y nada se guarda.
  const planDe = (tiendaId) => planDeDiseno(db, tiendaId);
  const volver = (req, res, tipo, texto, ruta = '/admin/marca') => {
    req.session.aviso = { tipo, texto };
    res.redirect(ruta);
  };
  // Para las acciones: sin el plan, vuelve al kit (que se ve bloqueado) con un aviso.
  async function conPlan(req, res, siguiente) {
    const plan = await planDe(req.session.usuario.tiendaId);
    if (!plan.puede.kit_de_marca) return volver(req, res, 'error', 'Tu plan no incluye el kit de marca y la maqueta web.');
    return siguiente(plan);
  }

  // Si se puede pedir una maqueta ahora y, si no, por qué: la razón se explica en pantalla.
  async function estadoDeGeneracion(tiendaId, { archivos, logoTienda, ultima }) {
    const restantes = Math.max(0, MAX_POR_DIA - (await pedidasEnElDia(db, tiendaId)));
    let razon = null;
    if (!generadorActivo) razon = 'no-configurada';
    else if (archivos.length === 0 && !logoTienda) razon = 'sin-material';
    else if (ultima?.enCurso) razon = 'en-curso';
    else if (restantes === 0) razon = 'limite';
    return { puede: razon === null, razon, restantes, maximo: MAX_POR_DIA };
  }

  async function mostrarKit(req, res, { valores = null, errores = {}, status = 200 } = {}) {
    const { tiendaId } = req.session.usuario;
    const plan = await planDe(tiendaId);
    if (!plan.puede.kit_de_marca) return res.status(status).render('admin/marca', { seccionActual: 'diseno', plan, ultima: null });
    await vencerPendientes(db, tiendaId);
    const [marca, ajustes, archivos, maquetas] = await Promise.all([leerMarca(db, tiendaId), leerAjustes(db, tiendaId), listarArchivos(db, tiendaId), listarMaquetas(db, tiendaId)]);
    const logoTienda = urlImagen(tiendaId, ajustes.logo);
    const ultima = maquetas[0] ?? null;
    res.status(status).render('admin/marca', {
      seccionActual: 'diseno',
      plan,
      // Sin nada elegido todavía, el color principal es el de la tienda.
      valores: valores ?? { ...marca, colorPrincipal: marca.colorPrincipal || ajustes.colorPrincipal },
      errores,
      archivos,
      logoTienda,
      tipos: TIPOS_ARCHIVO,
      estilos: ESTILOS,
      colores: COLORES,
      limites: { maxArchivos: MAX_ARCHIVOS, maxPorEnvio: MAX_POR_ENVIO, megas: MEGAS, largos: LARGOS },
      generacion: await estadoDeGeneracion(tiendaId, { archivos, logoTienda, ultima }),
      ultima,
    });
  }

  router.get('/marca', (req, res) => mostrarKit(req, res));

  router.post('/marca', verificarCsrf, (req, res) =>
    conPlan(req, res, async () => {
      const { valores, errores } = validarMarca(req.body);
      if (Object.keys(errores).length > 0) return mostrarKit(req, res, { valores: req.body, errores, status: 400 });
      await guardarMarca(db, req.session.usuario.tiendaId, valores);
      volver(req, res, 'ok', 'Listo, guardamos tu kit de marca.');
    }),
  );

  router.post('/marca/archivos', conArchivos, verificarCsrf, (req, res) =>
    conPlan(req, res, async () => {
      const { tiendaId } = req.session.usuario;
      const tipo = String(req.body.tipo ?? '');
      if (!esTipoDeArchivo(tipo)) return volver(req, res, 'error', 'Elegí si lo que subís es un logo o una foto.');
      if (!req.files?.length) return volver(req, res, 'error', 'Elegí al menos una imagen.');
      const { agregados, errores, sobraron } = await subirArchivos({ db, dirSubidas: config.dirSubidas, tiendaId, tipo, archivos: req.files });
      const partes = [];
      if (agregados > 0) partes.push(`Subimos ${plural(agregados, 'imagen', 'imágenes')}.`);
      if (sobraron > 0) partes.push(`${plural(sobraron, 'imagen no entró', 'imágenes no entraron')}: el kit admite hasta ${MAX_ARCHIVOS}. Borrá alguna para sumar otras.`);
      partes.push(...errores.slice(0, 3));
      volver(req, res, agregados > 0 ? 'ok' : 'error', partes.join(' '));
    }),
  );

  router.post('/marca/archivos/:id/borrar', verificarCsrf, (req, res) =>
    conPlan(req, res, async () => {
      const id = Number(req.params.id);
      const borrado = Number.isInteger(id) && (await borrarArchivo(db, config.dirSubidas, req.session.usuario.tiendaId, id));
      volver(req, res, borrado ? 'ok' : 'error', borrado ? 'Quitamos el archivo del kit.' : 'Ese archivo ya no está en tu kit.');
    }),
  );

  // ---------- Maquetas ----------

  router.get('/marca/maqueta', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const plan = await planDe(tiendaId);
    if (!plan.puede.kit_de_marca) return res.render('admin/maqueta', { seccionActual: 'diseno', plan, ultima: null });
    await vencerPendientes(db, tiendaId);
    const [maquetas, ajustes, archivos] = await Promise.all([listarMaquetas(db, tiendaId), leerAjustes(db, tiendaId), listarArchivos(db, tiendaId)]);
    const pedida = Number.parseInt(req.query.ver, 10);
    const actual = maquetas.find((m) => m.id === pedida) ?? maquetas[0] ?? null;
    res.render('admin/maqueta', {
      seccionActual: 'diseno',
      plan,
      maquetas,
      actual,
      ultima: maquetas[0] ?? null,
      maxGuardadas: MAX_GUARDADAS,
      generacion: await estadoDeGeneracion(tiendaId, { archivos, logoTienda: urlImagen(tiendaId, ajustes.logo), ultima: maquetas[0] ?? null }),
    });
  });

  // Lo consulta la página mientras la maqueta se genera, para recargarse sola cuando llega.
  router.get('/marca/maqueta/:id/estado', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    await vencerPendientes(db, tiendaId);
    const maqueta = /^\d{1,9}$/.test(req.params.id) ? await leerMaqueta(db, tiendaId, Number(req.params.id)) : null;
    if (!maqueta) return res.status(404).json({ error: 'No existe' });
    res.set('Cache-Control', 'no-store').json({ estado: maqueta.estado, enCurso: maqueta.enCurso });
  });

  // El HTML de la maqueta, para el iframe de la página (y para abrirla en pantalla completa). Va con su propia política de seguridad.
  router.get('/marca/maqueta/:id/vista', async (req, res) => {
    const { tiendaId } = req.session.usuario;
    const html = (await planDe(tiendaId)).puede.kit_de_marca && /^\d{1,9}$/.test(req.params.id) ? await htmlDeMaqueta(db, tiendaId, Number(req.params.id)) : null;
    if (!html) return res.status(404).type('text/plain').send('Esta maqueta no existe.');
    res
      .set({
        'Content-Security-Policy': politicaDeLaMaqueta(urlPanel(req, config.dominio)),
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'private, no-store',
      })
      .type('text/html; charset=utf-8')
      .send(html);
  });

  router.post('/marca/maqueta', verificarCsrf, (req, res) =>
    conPlan(req, res, async () => {
      const { tiendaId } = req.session.usuario;
      const aMaqueta = '/admin/marca/maqueta';
      if (!generadorActivo) {
        const contacto = config.contactoPlataforma ? ` Contactanos: ${config.contactoPlataforma}.` : '';
        return volver(req, res, 'error', `Por ahora no podemos armar maquetas.${contacto}`, aMaqueta);
      }
      const [tienda, marca, ajustes, archivos] = await Promise.all([buscarTienda(db, tiendaId), leerMarca(db, tiendaId), leerAjustes(db, tiendaId), listarArchivos(db, tiendaId)]);
      const logoTienda = urlImagen(tiendaId, ajustes.logo);
      if (archivos.length === 0 && !logoTienda) return volver(req, res, 'error', 'Subí al menos un logo o una foto para poder armar la maqueta.');

      const pedido = await pedirMaqueta(db, tiendaId);
      if (pedido.error === 'en-curso') return volver(req, res, 'error', 'Ya hay una maqueta en camino. Esperá a que termine para pedir otra.', aMaqueta);
      if (pedido.error === 'limite') return volver(req, res, 'error', `Podés pedir hasta ${MAX_POR_DIA} maquetas cada 24 horas. Probá de nuevo más tarde.`, aMaqueta);

      const aviso = armarPedido({
        id: pedido.id,
        token: pedido.token,
        urlBase: urlPanel(req, config.dominio),
        tienda,
        urlTienda: urlPublicaDeTienda(req, config, tienda),
        marca,
        colorTienda: ajustes.colorPrincipal,
        archivos,
        logoTienda,
        catalogo: await catalogoDeMuestra(db, tiendaId),
      });
      const recibido = await notificarMaquetas('maqueta_solicitada', aviso);
      // Si n8n no contestó, el pedido no empezó y no cuenta; si contestó tarde pero ya lo estaba armando, el pedido sigue en camino.
      if (!recibido && (await descartarPedido(db, tiendaId, pedido.id))) {
        return volver(req, res, 'error', 'No pudimos pedir la maqueta en este momento. Probá de nuevo en unos minutos.', aMaqueta);
      }
      volver(req, res, 'ok', 'Pedimos tu maqueta. Suele tardar menos de un minuto: la ves acá apenas esté lista.', aMaqueta);
    }),
  );

  router.post('/marca/maqueta/:id/borrar', verificarCsrf, (req, res) =>
    conPlan(req, res, async () => {
      const id = Number(req.params.id);
      const borrada = Number.isInteger(id) && (await borrarMaqueta(db, req.session.usuario.tiendaId, id));
      volver(req, res, borrada ? 'ok' : 'error', borrada ? 'Borramos la maqueta.' : 'Esa maqueta no se puede borrar (todavía se está armando o ya no existe).', '/admin/marca/maqueta');
    }),
  );

  return router;
}
