// Usar una maqueta en la tienda real, y deshacerlo. La maqueta es solo una vista previa: acá se lleva a la tienda, cuando el cliente lo pide y solo lo que él
// elige, lo que se puede llevar sin tocar el resto de su diseño: el color principal, el logo, el texto de la franja de anuncios, el "Sobre la tienda" y un
// banner con la primera foto del kit. Todo sale de lo que la plataforma ya sabe de esa maqueta (el kit de marca de cuando se pidió y los textos que
// escribió la IA, ver maquetas.js), nunca de lo que mande el navegador: el formulario solo dice cuáles de esas cosas quiere.
//
//  - Antes de cambiar algo, el cliente ve cada cambio como "ahora → nuevo" y elige cuáles (proponerUso).
//  - Se aplican juntos, en una sola transacción, y se guarda qué había antes (tabla maqueta_usada) para poder deshacerlo (usarMaqueta).
//  - Deshacer vuelve a lo de antes, pero no pisa lo que el cliente cambió después de usar la maqueta (deshacerUso).
//  - Las imágenes se copian: el logo y el banner pasan a ser archivos propios de la tienda, así que borrar la foto del kit no los rompe. El logo de antes se
//    conserva mientras se pueda deshacer y se borra cuando ya no.
//  - Solo se deshace lo último: usar otra maqueta reemplaza a lo anterior (lo que ya se puso queda puesto).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { enTransaccion } from './db.js';
import { actualizarAjustes, agregarBanner, borrarBanner, leerAjustes, listarBanners } from './diseno.js';
import { ErrorDeImagen, borrarImagen, guardarImagen, urlImagen, urlMiniatura } from './imagenes.js';
import { limitesDeTienda } from './limites.js';
import { instantaneaDelKit, datosParaUsar } from './maquetas.js';
import { leerMarca, listarArchivos } from './marca.js';

// Lo que se puede llevar a la tienda, en el orden en que se muestra.
export const ITEMS = {
  colorPrincipal: { titulo: 'Color principal', ayuda: 'El color de los botones y de los detalles de tu tienda.' },
  logo: { titulo: 'Logo', ayuda: 'El logo de tu kit de marca, en la cabecera de la tienda.' },
  franjaTexto: { titulo: 'Franja de anuncios', ayuda: 'El texto que sale arriba de todo en tu tienda.' },
  descripcion: { titulo: 'Sobre la tienda', ayuda: 'La descripción que sale en el pie y cuando compartís el link.' },
  banner: { titulo: 'Banner de bienvenida', ayuda: 'Tu primera foto del kit, como un banner nuevo. No reemplaza los que ya tenés.' },
};
export const CLAVES_DE_ITEMS = Object.keys(ITEMS);
export const esItem = (valor) => typeof valor === 'string' && Object.hasOwn(ITEMS, valor);

const SIN_TEXTOS = 'Esta maqueta no guardó sus textos (es de antes, o salió con textos de ejemplo). Pedí una nueva para poder usarlos.';

// Cada cambio que se puede hacer: { clave, titulo, ayuda, tipo, ahora, nuevo, archivo?, aplicable, motivo }. `motivo` dice por qué no se puede (y entonces `aplicable`
// es false). `ahora` y `nuevo` son lo que se muestra: un texto, un color (#rrggbb), la dirección de una imagen o, en el banner, cuántos hay. null si no hay nada.
// Devuelve null si la maqueta no existe, no es de esta tienda o todavía no está lista.
export async function proponerUso({ db, tiendaId, maquetaId }) {
  const datos = await datosParaUsar(db, tiendaId, maquetaId);
  if (!datos) return null;
  const [ajustes, marca, archivos, banners, limites] = await Promise.all([
    leerAjustes(db, tiendaId),
    leerMarca(db, tiendaId),
    listarArchivos(db, tiendaId),
    listarBanners(db, tiendaId),
    limitesDeTienda(db, tiendaId),
  ]);
  // Lo que valía cuando se pidió la maqueta; las de antes (que no lo guardaron) usan el kit de hoy.
  const kit = datos.kit ?? instantaneaDelKit({ marca, archivos });
  const delKit = (archivo) => (archivo ? (archivos.find((a) => a.archivo === archivo) ?? null) : null);
  const logo = delKit(kit.logo);
  const foto = delKit(kit.foto);
  const { textos } = datos;

  const item = (clave, tipo, { ahora = null, nuevo = null, archivo = null, motivo = null }) => ({ clave, ...ITEMS[clave], tipo, ahora, nuevo, archivo, aplicable: motivo === null, motivo });
  const deTexto = (clave, ahora, nuevo) =>
    item(clave, 'texto', { ahora: ahora || null, nuevo, motivo: !textos ? SIN_TEXTOS : !nuevo ? 'Esta maqueta no trae este texto.' : nuevo === ahora ? 'Tu tienda ya lo tiene así.' : null });

  const items = [
    item('colorPrincipal', 'color', {
      ahora: ajustes.colorPrincipal,
      nuevo: kit.colorPrincipal || null,
      motivo: !kit.colorPrincipal ? 'No elegiste un color principal en tu kit de marca.' : kit.colorPrincipal === ajustes.colorPrincipal ? 'Tu tienda ya tiene este color.' : null,
    }),
    item('logo', 'imagen', {
      ahora: urlImagen(tiendaId, ajustes.logo),
      nuevo: logo ? urlMiniatura(tiendaId, logo.archivo, 'm') : null,
      archivo: logo?.archivo ?? null,
      motivo: logo ? null : kit.logo ? 'Ese logo ya no está en tu kit de marca.' : 'Tu kit de marca no tiene un logo.',
    }),
    deTexto('franjaTexto', ajustes.franjaTexto, textos?.anuncio ?? null),
    deTexto('descripcion', ajustes.descripcion, textos?.sobreTexto ?? null),
    item('banner', 'banner', {
      ahora: { cantidad: banners.length, maximo: limites.maxBanners },
      nuevo: foto ? urlMiniatura(tiendaId, foto.archivo, 'm') : null,
      archivo: foto?.archivo ?? null,
      motivo: !foto
        ? kit.foto ? 'Esa foto ya no está en tu kit de marca.' : 'Tu kit de marca no tiene fotos.'
        : banners.length >= limites.maxBanners ? `Tu plan permite ${limites.maxBanners} ${limites.maxBanners === 1 ? 'banner' : 'banners'} y ya tenés ${banners.length}. Borrá uno en Diseño para sumar este.` : null,
    }),
  ];
  return { items, hayAplicables: items.some((i) => i.aplicable), eslogan: textos?.eslogan ?? '' };
}

// ---------- Lo que se guarda para deshacer ----------

// [{ clave, antes, despues }] tal como se guardó. Lo que no se entiende se descarta: nunca se tiene que poder armar un cambio raro a mano en la base.
function leerCambios(texto) {
  let lista;
  try {
    lista = JSON.parse(texto);
  } catch {
    return [];
  }
  if (!Array.isArray(lista)) return [];
  const cadena = (v) => v === null || typeof v === 'string';
  return lista.filter((c) => {
    if (!c || !esItem(c.clave)) return false;
    if (c.clave === 'banner') return Number.isInteger(c.despues?.id) && typeof c.despues?.imagen === 'string';
    return cadena(c.antes) && typeof c.despues === 'string';
  });
}

// La última vez que la tienda usó una maqueta, o null: qué maqueta y qué se cambió (para mostrarlo junto al botón de deshacer).
export async function leerUso(db, tiendaId) {
  const fila = await db.prepare('SELECT maqueta_id AS "maquetaId", cambios, usada_en AS "usadaEn" FROM maqueta_usada WHERE tienda_id = ?').get(tiendaId);
  if (!fila) return null;
  const cambios = leerCambios(fila.cambios).map((c) => ({ clave: c.clave, titulo: ITEMS[c.clave].titulo, detalle: c.clave === 'logo' || c.clave === 'banner' ? null : c.despues }));
  return cambios.length > 0 ? { maquetaId: fila.maquetaId, usadaEn: fila.usadaEn, cambios } : null;
}

const archivoDelKit = (dirSubidas, tiendaId, archivo) => readFile(path.join(dirSubidas, String(tiendaId), path.basename(archivo)));

// ---------- Usar ----------

// elegidos: las claves que el cliente tildó (cualquier otra cosa se ignora, y también lo que no se puede hacer). Devuelve { aplicados: [clave], omitidos:
// [{ clave, motivo }] } o { error: 'no-existe' | 'nada' | 'archivo' }: la maqueta no existe, no había nada para cambiar o no se pudo leer una imagen del kit.
export async function usarMaqueta({ db, dirSubidas, tiendaId, maquetaId, elegidos }) {
  const propuesta = await proponerUso({ db, tiendaId, maquetaId });
  if (!propuesta) return { error: 'no-existe' };
  const pedidos = new Set(elegidos);
  const items = propuesta.items.filter((i) => i.aplicable && pedidos.has(i.clave));
  if (items.length === 0) return { error: 'nada' };

  // Las imágenes se copian antes de tocar la base: si una falla, no se cambió nada.
  const creados = [];
  const borrarCreados = () => Promise.all(creados.map((archivo) => borrarImagen(dirSubidas, tiendaId, archivo)));
  const copias = {};
  try {
    for (const item of items.filter((i) => i.clave === 'logo' || i.clave === 'banner')) {
      const copia = await guardarImagen(dirSubidas, tiendaId, await archivoDelKit(dirSubidas, tiendaId, item.archivo), { perfil: item.clave === 'logo' ? 'logo' : 'banner' });
      creados.push(copia);
      copias[item.clave] = copia;
    }
  } catch (error) {
    await borrarCreados();
    if (error instanceof ErrorDeImagen || error.code === 'ENOENT') return { error: 'archivo' };
    throw error;
  }

  let resultado;
  try {
    resultado = await enTransaccion(db, async (tx) => {
      // La tienda se bloquea mientras tanto: dos pedidos a la vez (o un deshacer) no se pisan.
      await tx.prepare('SELECT id FROM tiendas WHERE id = ? FOR UPDATE').get(tiendaId);
      const ajustes = await leerAjustes(tx, tiendaId);
      const cambios = [];
      const omitidos = [];
      const nuevosAjustes = {};
      for (const item of items) {
        if (item.clave === 'logo') {
          cambios.push({ clave: 'logo', antes: ajustes.logo ?? null, despues: copias.logo });
          nuevosAjustes.logo = copias.logo;
        } else if (item.clave === 'banner') {
          // El lugar se vuelve a mirar con la tienda bloqueada: puede haberse ocupado desde que se armó la propuesta.
          const { n } = await tx.prepare('SELECT count(*) AS n FROM banners WHERE tienda_id = ?').get(tiendaId);
          if (Number(n) >= item.ahora.maximo) {
            omitidos.push({ clave: 'banner', motivo: 'Ya no queda lugar para otro banner en tu plan.' });
            continue;
          }
          const id = await agregarBanner(tx, tiendaId, { imagen: copias.banner, imagenMovil: null, enlace: '', textoAlternativo: propuesta.eslogan || 'Banner de bienvenida' });
          cambios.push({ clave: 'banner', antes: null, despues: { id, imagen: copias.banner } });
        } else {
          cambios.push({ clave: item.clave, antes: ajustes[item.clave] ?? '', despues: item.nuevo });
          nuevosAjustes[item.clave] = item.nuevo;
        }
      }
      if (cambios.length === 0) return { cambios, omitidos };

      if (Object.keys(nuevosAjustes).length > 0) await actualizarAjustes(tx, tiendaId, nuevosAjustes);
      const anterior = await tx.prepare('SELECT cambios FROM maqueta_usada WHERE tienda_id = ?').get(tiendaId);
      await tx
        .prepare(
          `INSERT INTO maqueta_usada (tienda_id, maqueta_id, cambios, usada_en) VALUES (?, ?, ?, ahora())
           ON CONFLICT (tienda_id) DO UPDATE SET maqueta_id = excluded.maqueta_id, cambios = excluded.cambios, usada_en = excluded.usada_en`,
        )
        .run(tiendaId, maquetaId, JSON.stringify(cambios));
      // Usar otra maqueta reemplaza a la anterior: el logo que esa guardaba "por si se deshacía" ya no hace falta, salvo que siga en uso.
      const enUso = new Set([nuevosAjustes.logo ?? ajustes.logo, ...cambios.filter((c) => c.clave === 'logo').flatMap((c) => [c.antes, c.despues])]);
      const sobrantes = leerCambios(anterior?.cambios ?? '')
        .filter((c) => c.clave === 'logo' && c.antes && !enUso.has(c.antes))
        .map((c) => c.antes);
      return { cambios, omitidos, sobrantes };
    });
  } catch (error) {
    await borrarCreados();
    throw error;
  }

  // Las copias que no se usaron (el banner que ya no entró) se borran; y también los logos viejos que ya no se pueden deshacer.
  const usadas = new Set(resultado.cambios.flatMap((c) => (c.clave === 'logo' ? [c.despues] : c.clave === 'banner' ? [c.despues.imagen] : [])));
  await Promise.all([...creados.filter((archivo) => !usadas.has(archivo)), ...(resultado.sobrantes ?? [])].map((archivo) => borrarImagen(dirSubidas, tiendaId, archivo)));
  if (resultado.cambios.length === 0) return { error: 'nada' };
  return { aplicados: resultado.cambios.map((c) => c.clave), omitidos: resultado.omitidos };
}

// ---------- Deshacer ----------

// Vuelve a lo de antes de la última vez que se usó una maqueta. Lo que el cliente cambió después se deja como está (queda en `omitidos`), y el banner que
// se sumó se saca si todavía está. Devuelve { deshechos: [clave], omitidos: [{ clave, motivo }] } o { error: 'nada' } si no había nada para deshacer.
export async function deshacerUso({ db, dirSubidas, tiendaId }) {
  const resultado = await enTransaccion(db, async (tx) => {
    await tx.prepare('SELECT id FROM tiendas WHERE id = ? FOR UPDATE').get(tiendaId);
    const fila = await tx.prepare('SELECT cambios FROM maqueta_usada WHERE tienda_id = ?').get(tiendaId);
    if (!fila) return null;
    const ajustes = await leerAjustes(tx, tiendaId);
    const volver = {};
    const deshechos = [];
    const omitidos = [];
    const archivos = [];
    for (const cambio of leerCambios(fila.cambios)) {
      if (cambio.clave === 'banner') {
        const borrado = await borrarBanner(tx, tiendaId, cambio.despues.id);
        if (borrado) {
          deshechos.push('banner');
          archivos.push(borrado.imagen, borrado.imagenMovil);
        } else {
          omitidos.push({ clave: 'banner', motivo: 'ya no estaba' });
        }
        continue;
      }
      const actual = ajustes[cambio.clave] ?? (cambio.clave === 'logo' ? null : '');
      if (actual === cambio.despues) {
        volver[cambio.clave] = cambio.antes;
        deshechos.push(cambio.clave);
        if (cambio.clave === 'logo') archivos.push(cambio.despues); // el logo de la maqueta ya no se usa
      } else {
        omitidos.push({ clave: cambio.clave, motivo: 'lo cambiaste después' });
        if (cambio.clave === 'logo') archivos.push(cambio.antes); // el de antes ya no va a volver
      }
    }
    if (Object.keys(volver).length > 0) await actualizarAjustes(tx, tiendaId, volver);
    await tx.prepare('DELETE FROM maqueta_usada WHERE tienda_id = ?').run(tiendaId);
    return { deshechos, omitidos, archivos };
  });
  if (!resultado) return { error: 'nada' };
  await Promise.all(resultado.archivos.filter(Boolean).map((archivo) => borrarImagen(dirSubidas, tiendaId, archivo)));
  return { deshechos: resultado.deshechos, omitidos: resultado.omitidos };
}
