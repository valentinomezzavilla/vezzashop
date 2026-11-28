// Kit de marca (plan Acompañado): lo que el cliente cuenta de su marca y los archivos que sube (logos y fotos) para que un flujo de n8n
// genere una maqueta de su tienda (ver maquetas.js). Nada de esto cambia la vidriera: es material para la maqueta.
import { enTransaccion } from './db.js';
import { guardarImagen, borrarImagen, urlImagen, urlMiniatura, ErrorDeImagen } from './imagenes.js';

// Cuántos archivos puede tener el kit en total y cuántos se reciben en una sola subida.
export const MAX_ARCHIVOS = 12;
export const MAX_POR_ENVIO = 6;

export const TIPOS_ARCHIVO = {
  logo: { titulo: 'Logo', plural: 'Logos', ayuda: 'Tu logo, mejor con fondo transparente. Podés subir más de una versión (color, blanco, negro).' },
  foto: { titulo: 'Foto', plural: 'Fotos', ayuda: 'Fotos que muestren tu marca: tu local, tus productos, tu equipo o el estilo que te gusta.' },
};
export const esTipoDeArchivo = (valor) => typeof valor === 'string' && Object.hasOwn(TIPOS_ARCHIVO, valor);

// El estilo que el cliente elige para su marca. Lo usa el flujo de n8n para elegir tipografías y formas.
export const ESTILOS = {
  moderno: { titulo: 'Moderno', ayuda: 'Limpio y directo: mucho aire y tipografía sin serifas.' },
  elegante: { titulo: 'Elegante', ayuda: 'Sobrio y refinado, con títulos con serifas.' },
  calido: { titulo: 'Cálido', ayuda: 'Cercano y amable: colores suaves y formas redondeadas.' },
  audaz: { titulo: 'Audaz', ayuda: 'Colores fuertes y títulos grandes que llaman la atención.' },
};
export const esEstilo = (valor) => typeof valor === 'string' && Object.hasOwn(ESTILOS, valor);

export const LARGOS = { rubro: 80, descripcion: 600, referencias: 300 };

export const COLORES = {
  colorPrincipal: { titulo: 'Color principal', ayuda: 'El color que más identifica a tu marca.' },
  colorSecundario: { titulo: 'Color secundario', ayuda: 'Para fondos, detalles o secciones que acompañan al principal.' },
  colorAcento: { titulo: 'Color de acento', ayuda: 'Para botones y llamados a la acción.' },
};

const MARCA_VACIA = { colorPrincipal: '', colorSecundario: '', colorAcento: '', rubro: '', estilo: '', descripcion: '', referencias: '' };

export async function leerMarca(db, tiendaId) {
  const fila = await db
    .prepare(
      `SELECT color_principal AS "colorPrincipal", color_secundario AS "colorSecundario", color_acento AS "colorAcento",
              rubro, estilo, descripcion, referencias
       FROM marca WHERE tienda_id = ?`,
    )
    .get(tiendaId);
  return { ...MARCA_VACIA, ...fila };
}

// ---------- Validación ----------

const esColor = (valor) => typeof valor === 'string' && /^#[0-9a-f]{6}$/.test(valor);
// Sin saltos de línea ni caracteres de control: va a un texto de una sola línea.
const unaLinea = (valor) => String(valor ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
// Varias líneas: se conservan los saltos, pero no más de uno en blanco seguido ni caracteres de control.
const variasLineas = (valor) =>
  String(valor ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// campos: lo que manda el formulario. Devuelve { valores, errores }. Los colores opcionales llevan su casilla "usar otro" (campo + "Propio"):
// sin marcarla quedan vacíos. El principal siempre se elige.
export function validarMarca(campos) {
  const valores = {};
  const errores = {};

  const principal = String(campos.colorPrincipal ?? '').trim().toLowerCase();
  if (esColor(principal)) valores.colorPrincipal = principal;
  else errores.colorPrincipal = 'Elegí un color';
  for (const campo of ['colorSecundario', 'colorAcento']) {
    if (!campos[`${campo}Propio`]) {
      valores[campo] = '';
      continue;
    }
    const color = String(campos[campo] ?? '').trim().toLowerCase();
    if (esColor(color)) valores[campo] = color;
    else errores[campo] = 'Elegí un color';
  }

  const largo = (campo, texto, mensaje) => {
    if (texto.length > LARGOS[campo]) errores[campo] = `Máximo ${LARGOS[campo]} caracteres (tiene ${texto.length}). ${mensaje}`;
    else valores[campo] = texto;
  };
  largo('rubro', unaLinea(campos.rubro), 'Escribí solo el rubro: "Ropa de mujer", "Cosmética natural"…');
  largo('descripcion', variasLineas(campos.descripcion), 'Resumilo un poco.');
  largo('referencias', variasLineas(campos.referencias), 'Dejá solo lo más importante.');

  const estilo = String(campos.estilo ?? '').trim();
  if (estilo === '' || esEstilo(estilo)) valores.estilo = estilo;
  else errores.estilo = 'Elegí una de las opciones';
  return { valores, errores };
}

export async function guardarMarca(db, tiendaId, v) {
  await db
    .prepare(
      `INSERT INTO marca (tienda_id, color_principal, color_secundario, color_acento, rubro, estilo, descripcion, referencias)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tienda_id) DO UPDATE SET color_principal = excluded.color_principal, color_secundario = excluded.color_secundario,
         color_acento = excluded.color_acento, rubro = excluded.rubro, estilo = excluded.estilo, descripcion = excluded.descripcion,
         referencias = excluded.referencias, actualizado_en = ahora()`,
    )
    .run(tiendaId, v.colorPrincipal, v.colorSecundario, v.colorAcento, v.rubro, v.estilo, v.descripcion, v.referencias);
}

// ---------- Archivos ----------

// Los archivos del kit, del más viejo al más nuevo, con las direcciones (relativas) de la versión grande y de las miniaturas.
export async function listarArchivos(db, tiendaId) {
  const filas = await db
    .prepare('SELECT id, tipo, archivo, nombre, creado_en AS "creadoEn" FROM marca_archivos WHERE tienda_id = ? ORDER BY id')
    .all(tiendaId);
  return filas.map((fila) => ({
    ...fila,
    url: urlImagen(tiendaId, fila.archivo),
    miniatura: urlMiniatura(tiendaId, fila.archivo, 'm'),
  }));
}

// El nombre del archivo como lo ve el cliente: sin carpetas, sin caracteres de control y de largo razonable. multer lo entrega como si
// fuera latin1: si al leerlo como UTF-8 queda un texto válido ("MarÃ­a.png" -> "María.png"), era ese.
export function nombreParaMostrar(originalname) {
  let nombre = String(originalname ?? '');
  const comoUtf8 = Buffer.from(nombre, 'latin1').toString('utf8');
  if (!comoUtf8.includes('�') && /[^\x00-\x7f]/.test(nombre)) nombre = comoUtf8;
  nombre = unaLinea(nombre.split(/[\\/]/).pop());
  return nombre.length > 80 ? `${nombre.slice(0, 77)}...` : nombre || 'archivo';
}

// Guarda las imágenes que llegaron en una subida (cada una se convierte a WebP, ver imagenes.js). Respeta el tope de archivos del kit aunque
// lleguen varias subidas a la vez: la tienda se bloquea mientras se cuentan y se agregan. Devuelve { agregados, errores, sobraron }:
// errores son los textos de las imágenes que no se pudieron leer y sobraron las que no entraron por el tope.
export async function subirArchivos({ db, dirSubidas, tiendaId, tipo, archivos }) {
  const guardados = [];
  const errores = [];
  const borrar = (lista) => Promise.all(lista.map((g) => borrarImagen(dirSubidas, tiendaId, g.archivo)));
  for (const subido of archivos) {
    const nombre = nombreParaMostrar(subido.originalname);
    try {
      guardados.push({ archivo: await guardarImagen(dirSubidas, tiendaId, subido.buffer, { perfil: 'foto' }), nombre });
    } catch (error) {
      if (!(error instanceof ErrorDeImagen)) {
        await borrar(guardados);
        throw error;
      }
      errores.push(`${nombre}: ${error.message}`);
    }
  }
  let resultado;
  try {
    resultado = await enTransaccion(db, async (tx) => {
      await tx.prepare('SELECT id FROM tiendas WHERE id = ? FOR UPDATE').get(tiendaId);
      let { n } = await tx.prepare('SELECT count(*) AS n FROM marca_archivos WHERE tienda_id = ?').get(tiendaId);
      const agregados = [];
      const sobrantes = [];
      for (const guardado of guardados) {
        if (n >= MAX_ARCHIVOS) {
          sobrantes.push(guardado);
          continue;
        }
        await tx.prepare('INSERT INTO marca_archivos (tienda_id, tipo, archivo, nombre) VALUES (?, ?, ?, ?)').run(tiendaId, tipo, guardado.archivo, guardado.nombre);
        agregados.push(guardado);
        n += 1;
      }
      return { agregados, sobrantes };
    });
  } catch (error) {
    await borrar(guardados);
    throw error;
  }
  await borrar(resultado.sobrantes);
  return { agregados: resultado.agregados.length, errores, sobraron: resultado.sobrantes.length };
}

// Borra un archivo del kit (la fila y la imagen con sus miniaturas). false si no existe o es de otra tienda.
export async function borrarArchivo(db, dirSubidas, tiendaId, id) {
  const fila = await db.prepare('DELETE FROM marca_archivos WHERE id = ? AND tienda_id = ? RETURNING archivo').get(id, tiendaId);
  if (!fila) return false;
  await borrarImagen(dirSubidas, tiendaId, fila.archivo);
  return true;
}
