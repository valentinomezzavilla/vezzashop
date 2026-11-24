// Envíos de los pedidos a domicilio: en qué paso está cada uno (preparación, despachado, en camino, entregado), con qué empresa y qué número
// de seguimiento; el historial de cada pedido; la línea de tiempo que ve quien compró; y los textos con los que se le avisa cada movimiento
// (por mail, que manda n8n, y por WhatsApp, con un mensaje armado).
//
// El estado general del pedido (nuevo, pagado, enviado, entregado, cancelado) sigue mandando para los filtros, el stock y cancelar; el paso del
// envío lo afina y lo mantiene sincronizado:
//   preparación -> el estado general no cambia | despachado y en camino -> "enviado" | entregado -> "entregado".
import { enTransaccion } from './db.js';
import { formatearPrecio } from './util/formato.js';
import { tituloEstado } from './estados-pedido.js';

export const ESTADOS_ENVIO = {
  preparacion: { titulo: 'En preparación', cliente: 'Estamos preparando tu pedido' },
  despachado: { titulo: 'Despachado', cliente: 'Tu pedido ya salió del local' },
  en_camino: { titulo: 'En camino', cliente: 'Tu pedido está en camino' },
  entregado: { titulo: 'Entregado', cliente: 'Tu pedido fue entregado' },
};
export const ORDEN_ENVIO = ['preparacion', 'despachado', 'en_camino', 'entregado'];
export const esEstadoEnvio = (valor) => typeof valor === 'string' && Object.hasOwn(ESTADOS_ENVIO, valor);

// Las empresas que se ofrecen en la lista. `sitio` es la página de la empresa, adonde lleva "Seguir mi envío" si no se pegó un link exacto de
// seguimiento: el comprador ahí escribe el número. No se arman links directos porque cada empresa cambia los suyos: para un link exacto
// se pega a mano en el pedido. "Otra" (cualquier nombre) no está en la lista.
export const EMPRESAS_ENVIO = {
  'correo-argentino': { nombre: 'Correo Argentino', sitio: 'https://www.correoargentino.com.ar' },
  andreani: { nombre: 'Andreani', sitio: 'https://www.andreani.com' },
  oca: { nombre: 'OCA', sitio: 'https://www.oca.com.ar' },
  moto: { nombre: 'Moto o cadete propio', sitio: null },
};

const claveDeEmpresa = (nombre) => Object.entries(EMPRESAS_ENVIO).find(([, e]) => e.nombre === nombre)?.[0] ?? null;

// A dónde lleva "Seguir mi envío": el link que pegó la tienda o, si no hay, el sitio de la empresa. null si no hay a dónde mandar.
export function enlaceDeSeguimiento(envio) {
  if (envio.enlace) return envio.enlace;
  const clave = claveDeEmpresa(envio.empresa);
  return clave ? EMPRESAS_ENVIO[clave].sitio : null;
}

const texto = (valor, largo) => String(valor ?? '').trim().replace(/\s+/g, ' ').slice(0, largo);
const marcado = (valor) => valor === '1' || valor === 'on' || valor === true;

// ---------- Validación del formulario del envío ----------

// Valida lo que manda la tienda. Un campo que no viene (los botones rápidos mandan solo `estado`) deja lo que había: queda undefined.
// Devuelve { datos: { estado, empresa?, seguimiento?, enlace?, detalle?, avisarEmail }, errores }.
export function validarEnvio(campos) {
  const errores = {};
  const estado = texto(campos.estado, 20);
  if (!esEstadoEnvio(estado)) errores.estado = 'Elegí en qué paso está el envío';

  const datos = { estado, avisarEmail: marcado(campos.avisarEmail) };
  if (campos.empresa !== undefined) {
    const clave = texto(campos.empresa, 40);
    if (clave === '') datos.empresa = '';
    else if (clave === 'otra') datos.empresa = texto(campos.empresaOtra, 60);
    else if (Object.hasOwn(EMPRESAS_ENVIO, clave)) datos.empresa = EMPRESAS_ENVIO[clave].nombre;
    else errores.empresa = 'Elegí una empresa de la lista';
  }
  if (campos.seguimiento !== undefined) datos.seguimiento = texto(campos.seguimiento, 60);
  if (campos.enlace !== undefined) {
    datos.enlace = texto(campos.enlace, 300);
    if (datos.enlace && !(/^https:\/\//i.test(datos.enlace) && URL.canParse(datos.enlace))) errores.enlace = 'El link tiene que empezar con https://';
  }
  if (campos.detalle !== undefined) datos.detalle = texto(campos.detalle, 150);
  return { datos, errores };
}

// ---------- Historial ----------

export async function registrarEvento(db, pedidoId, { paso, titulo, detalle = '', visible = true, avisado = false }) {
  const { rows } = await db
    .prepare('INSERT INTO pedido_eventos (pedido_id, paso, titulo, detalle, visible_cliente, avisado_email) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, creado_en AS "creadoEn"')
    .run(pedidoId, paso, titulo, detalle, Number(visible), Number(avisado));
  return rows[0];
}

export async function leerEventos(db, pedidoId, { soloCliente = false } = {}) {
  const filas = await db
    .prepare(
      `SELECT id, paso, titulo, detalle, visible_cliente AS visible, avisado_email AS "avisadoEmail", creado_en AS "creadoEn"
       FROM pedido_eventos WHERE pedido_id = ?${soloCliente ? ' AND visible_cliente = 1' : ''} ORDER BY id`,
    )
    .all(pedidoId);
  return filas.map((f) => ({ ...f, visible: Boolean(f.visible), avisadoEmail: Boolean(f.avisadoEmail) }));
}

export const marcarEventoAvisado = (db, eventoId) => db.prepare('UPDATE pedido_eventos SET avisado_email = 1 WHERE id = ?').run(eventoId);

// ---------- Cambios del envío ----------

// El estado general que le corresponde a un pedido cuando su envío pasa a `envio`.
function estadoGeneralDeEnvio(envio, pedido) {
  if (envio === 'despachado' || envio === 'en_camino') return 'enviado';
  if (envio === 'entregado') return 'entregado';
  // En preparación: el pedido no cambia de estado, salvo que venga de más adelante (una corrección): vuelve a estar pagado (o nuevo, si se paga al recibir).
  if (pedido.estado === 'enviado' || pedido.estado === 'entregado') return pedido.pago === 'efectivo' ? 'nuevo' : 'pagado';
  return pedido.estado;
}

const detalleDe = (e) => [e.empresa, e.seguimiento && `N.º ${e.seguimiento}`, e.detalle].filter(Boolean).join(' · ');

// Pasa el envío de un pedido a domicilio a otro paso y, si se mandan, actualiza la empresa, el número, el link y la aclaración. Deja el movimiento en
// el historial. Devuelve null si no se puede (no es de la tienda, no es a domicilio o está cancelado); si no, { evento, retroceso, estadoGeneral, envio }.
// `retroceso`: el paso es anterior al que tenía (una corrección): no se le muestra al comprador.
export function actualizarEnvio(db, tiendaId, pedidoId, datos) {
  return enTransaccion(db, async (tx) => {
    const p = await tx
      .prepare(
        `SELECT id, estado, pago, entrega_tipo AS "entregaTipo", envio_estado AS "envioEstado", envio_empresa AS empresa,
                envio_seguimiento AS seguimiento, envio_enlace AS enlace, envio_detalle AS detalle
         FROM pedidos WHERE tienda_id = ? AND id = ? FOR UPDATE`,
      )
      .get(tiendaId, pedidoId);
    if (!p || p.entregaTipo !== 'domicilio' || p.estado === 'cancelado') return null;
    const envio = {
      estado: datos.estado,
      empresa: datos.empresa ?? p.empresa,
      seguimiento: datos.seguimiento ?? p.seguimiento,
      enlace: datos.enlace ?? p.enlace,
      detalle: datos.detalle ?? p.detalle,
    };
    const estadoGeneral = estadoGeneralDeEnvio(datos.estado, p);
    await tx
      .prepare(
        `UPDATE pedidos SET envio_estado = ?, envio_empresa = ?, envio_seguimiento = ?, envio_enlace = ?, envio_detalle = ?,
                estado = ?, actualizado_en = ahora() WHERE id = ?`,
      )
      .run(envio.estado, envio.empresa, envio.seguimiento, envio.enlace, envio.detalle, estadoGeneral, p.id);
    const antes = p.envioEstado === null ? -1 : ORDEN_ENVIO.indexOf(p.envioEstado);
    const retroceso = ORDEN_ENVIO.indexOf(datos.estado) < antes;
    const evento = await registrarEvento(tx, p.id, {
      paso: datos.estado,
      titulo: ESTADOS_ENVIO[datos.estado].titulo,
      detalle: detalleDe(envio),
      visible: !retroceso,
    });
    return { evento, retroceso, estadoGeneral, envio };
  });
}

// Cuando el estado general de un pedido a domicilio cambia por otro camino (el botón del paso siguiente, el selector de corrección), el paso del
// envío lo acompaña. `pedido`: { id, entregaTipo, envioEstado }.
export async function sincronizarEnvioConEstado(db, pedido, estado) {
  if (pedido.entregaTipo !== 'domicilio') return;
  let envio = pedido.envioEstado;
  if (estado === 'enviado' && (envio === null || envio === 'preparacion' || envio === 'entregado')) envio = 'despachado';
  else if (estado === 'entregado') envio = 'entregado';
  else if ((estado === 'nuevo' || estado === 'pagado') && ['despachado', 'en_camino', 'entregado'].includes(envio)) envio = estado === 'pagado' ? 'preparacion' : null;
  if (envio !== pedido.envioEstado) await db.prepare('UPDATE pedidos SET envio_estado = ? WHERE id = ?').run(envio, pedido.id);
}

export async function guardarNotaInterna(db, tiendaId, pedidoId, nota) {
  return (await db.prepare('UPDATE pedidos SET nota_interna = ? WHERE tienda_id = ? AND id = ?').run(String(nota ?? '').trim().slice(0, 1000), tiendaId, pedidoId)).changes > 0;
}

// ---------- Lo que ve quien compró ----------

// Cómo se llama el estado del pedido para quien compró: en uno a domicilio, el paso del envío si ya empezó ("En camino"); si no, el estado general.
export function tituloParaCliente(pedido) {
  if (pedido.estado !== 'cancelado' && pedido.despacho.estado) return ESTADOS_ENVIO[pedido.despacho.estado].titulo;
  return tituloEstado(pedido.estado, pedido.entrega.tipo, { paraCliente: true });
}

// La línea de tiempo del pedido: los pasos que le tocan según cómo recibe y cómo paga, cuáles ya pasaron, cuál es el actual y cuándo ocurrió cada uno.
// `eventos`: los visibles para el comprador (de leerEventos). Devuelve { pasos: [{ clave, titulo, estado: 'hecho' | 'actual' | 'pendiente', fecha }], envio }.
export function armarSeguimiento(pedido, eventos) {
  const domicilio = pedido.entrega.tipo === 'domicilio';
  const pasos = [{ clave: 'recibido', titulo: 'Recibimos tu pedido' }];
  if (pedido.pago !== 'efectivo') pasos.push({ clave: 'pagado', titulo: 'Pago confirmado' });
  if (domicilio) for (const clave of ORDEN_ENVIO) pasos.push({ clave, titulo: ESTADOS_ENVIO[clave].titulo });
  else pasos.push({ clave: 'listo', titulo: 'Listo para retirar' }, { clave: 'entregado', titulo: 'Retirado' });

  // En qué paso está: el del envío (a domicilio), o el que dice el estado general.
  const claves = pasos.map((p) => p.clave);
  let actual = 'recibido';
  if (domicilio && pedido.despacho.estado) actual = pedido.despacho.estado;
  else if (pedido.estado === 'entregado') actual = 'entregado';
  else if (!domicilio && pedido.estado === 'enviado') actual = 'listo';
  else if (pedido.estado === 'pagado' && claves.includes('pagado')) actual = 'pagado';
  const indiceActual = Math.max(0, claves.indexOf(actual));
  const terminado = pedido.estado === 'entregado';

  const fechaDe = (clave) => {
    const evento = eventos.findLast((e) => e.paso === clave);
    return evento?.creadoEn ?? (clave === 'recibido' ? pedido.creadoEn : null);
  };
  return {
    pasos: pasos.map((paso, i) => ({
      ...paso,
      estado: i < indiceActual || (terminado && i === indiceActual) ? 'hecho' : i === indiceActual ? 'actual' : 'pendiente',
      fecha: i <= indiceActual ? fechaDe(paso.clave) : null,
    })),
    envio: domicilio && (pedido.despacho.empresa || pedido.despacho.seguimiento || pedido.despacho.enlace || pedido.despacho.detalle)
      ? {
          empresa: pedido.despacho.empresa,
          codigo: pedido.despacho.seguimiento,
          detalle: pedido.despacho.detalle,
          enlace: enlaceDeSeguimiento(pedido.despacho),
          conEnlaceExacto: Boolean(pedido.despacho.enlace),
        }
      : null,
  };
}

// ---------- Avisos al comprador ----------

// El título y el texto que describen el estado en el que está un pedido, para decírselo al comprador (por mail o por WhatsApp).
// `tienda`: el nombre de la tienda; `direccionTienda`: dónde retirar (opcional).
export function descripcionDeEstado(pedido, { tienda, direccionTienda = '' }) {
  const n = `#${pedido.numero}`;
  const de = `${n} de ${tienda}`;
  const e = pedido.despacho ?? {};
  const con = e.empresa ? ` con ${e.empresa}` : '';
  if (pedido.estado === 'cancelado') return { titulo: `Tu pedido ${n} fue cancelado`, texto: `Cancelamos tu pedido ${de}. Si tenés dudas, escribinos.` };
  if (pedido.estado === 'entregado') {
    return pedido.entrega.tipo === 'retiro'
      ? { titulo: `Retiraste tu pedido ${n}`, texto: `Gracias por retirar tu pedido ${de}. ¡Que lo disfrutes!` }
      : { titulo: `Tu pedido ${n} fue entregado`, texto: `Tu pedido ${de} fue entregado. ¡Gracias por tu compra!` };
  }
  if (pedido.entrega.tipo === 'retiro' && pedido.estado === 'enviado') {
    return { titulo: `Tu pedido ${n} está listo para retirar`, texto: `Tu pedido ${de} ya está listo para retirar${direccionTienda ? ` en ${direccionTienda}` : ''}. ¡Te esperamos!` };
  }
  if (e.estado === 'en_camino') return { titulo: `Tu pedido ${n} está en camino`, texto: `Tu pedido ${de} está en camino${con}.` };
  if (e.estado === 'despachado') return { titulo: `Tu pedido ${n} fue despachado`, texto: `Tu pedido ${de} fue despachado${con}.` };
  if (e.estado === 'preparacion') return { titulo: `Estamos preparando tu pedido ${n}`, texto: `Ya estamos preparando tu pedido ${de}. Cuando salga, te avisamos.` };
  if (pedido.estado === 'pagado') return { titulo: `Recibimos el pago de tu pedido ${n}`, texto: `Recibimos el pago de tu pedido ${de}. ¡Gracias!` };
  return { titulo: `Recibimos tu pedido ${n}`, texto: `Recibimos tu pedido ${de}. Total: ${formatearPrecio(pedido.total)}${pedido.envio === null ? ' + envío' : ''}.` };
}

// Lo que se agrega al aviso cuando el pedido ya salió: empresa, número de seguimiento, link y aclaración. [] si no hay nada para decir.
export function lineasDeSeguimiento(pedido) {
  const e = pedido.despacho ?? {};
  if (pedido.entrega.tipo !== 'domicilio' || !['despachado', 'en_camino'].includes(e.estado)) return [];
  return [
    e.seguimiento && `N.º de seguimiento: ${e.seguimiento}`,
    e.detalle,
    enlaceDeSeguimiento(e) && `Seguilo acá: ${enlaceDeSeguimiento(e)}`,
  ].filter(Boolean);
}

// El mensaje de WhatsApp para el comprador, según el estado actual del pedido.
export function mensajeDeEstado(pedido, { tienda, urlPedido, direccionTienda = '' }) {
  const nombre = pedido.cliente.nombre.split(' ')[0];
  const { texto } = descripcionDeEstado(pedido, { tienda, direccionTienda });
  return [`¡Hola ${nombre}! ${texto}`, ...lineasDeSeguimiento(pedido), urlPedido && `Podés ver el estado de tu pedido acá: ${urlPedido}`].filter(Boolean).join('\n');
}

// El cuerpo del aviso "pedido_actualizado" (el mail al comprador, que manda n8n): en qué estado está su pedido ahora, con los datos del seguimiento si ya salió.
// `pedido` es el de leerPedido; los datos de la tienda son para que el mail salga con su nombre y responda a su contacto.
export function avisoDePedido(pedido, { tienda, urlTienda, emailTienda = '', whatsappTienda = '', urlPedido, direccionTienda = '' }) {
  const { titulo, texto } = descripcionDeEstado(pedido, { tienda, direccionTienda });
  const e = pedido.despacho;
  const salio = pedido.entrega.tipo === 'domicilio' && ['despachado', 'en_camino'].includes(e.estado);
  return {
    email: pedido.cliente.email,
    cliente: { nombre: pedido.cliente.nombre },
    tienda: { nombre: tienda, url: urlTienda, email: emailTienda, whatsapp: whatsappTienda },
    pedido: {
      numero: pedido.numero,
      url: urlPedido,
      total: `${formatearPrecio(pedido.total)}${pedido.envio === null ? ' + envío' : ''}`,
      estado: pedido.estado !== 'cancelado' && e.estado ? ESTADOS_ENVIO[e.estado].titulo : tituloEstado(pedido.estado, pedido.entrega.tipo),
    },
    titulo,
    mensaje: texto,
    seguimiento: salio ? { empresa: e.empresa, codigo: e.seguimiento, url: enlaceDeSeguimiento(e) ?? '', detalle: e.detalle } : null,
  };
}
