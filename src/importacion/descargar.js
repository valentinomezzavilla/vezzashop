// Descarga de las fotos de la columna "link-img".
// El servidor pide links que escribió el cliente: hay que evitar que sirvan para llegar a la red interna
// (localhost, la red de Docker/Coolify, el metadata de la nube). Por eso:
//  - se resuelve el nombre y se rechaza si ALGUNA dirección no es pública (lookup propio);
//  - las IP escritas en el link no pasan por lookup: se revisan aparte;
//  - las redirecciones se siguen a mano, revisando cada destino.
// Se usa node:http/https y no fetch, porque fetch no deja controlar la resolución de nombres.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { tipoDeImagen, TAMANO_MAXIMO_IMAGEN } from '../imagenes.js';

export class ErrorDeDescarga extends Error {}

const MENSAJES = {
  invalido: 'el link no es válido: tiene que empezar con http:// o https://',
  bloqueado: 'el link apunta a una dirección que no está permitida',
  red: 'no pudimos descargar la foto del link',
  tiempo: 'el link tardó demasiado en responder',
  pesado: 'la foto del link pesa más de 5 MB',
  vueltas: 'el link redirige demasiadas veces',
  noEsFoto: 'el link no lleva a una foto JPG, PNG o WEBP',
};

const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

// Dos listas separadas: BlockList compara las IPv4 también contra las reglas IPv6 de direcciones mapeadas
// (::ffff:0:0/96), y esa regla las bloquearía a todas.
function lista(redes, tipo) {
  const bloqueadas = new net.BlockList();
  for (const [red, prefijo] of redes) bloqueadas.addSubnet(red, prefijo, tipo);
  return bloqueadas;
}
const NO_PUBLICAS_V4 = lista([
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
], 'ipv4');
// ::/96 incluye :: y ::1. Las mapeadas con puntos (::ffff:a.b.c.d) se revisan como IPv4; escritas en hex, se rechazan.
const NO_PUBLICAS_V6 = lista([
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
], 'ipv6');

export function esDireccionPublica(ip) {
  const version = net.isIP(ip);
  if (version === 4) return !NO_PUBLICAS_V4.check(ip, 'ipv4');
  if (version !== 6) return false;
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapeada) return esDireccionPublica(mapeada[1]);
  return !NO_PUBLICAS_V6.check(ip, 'ipv6');
}

// Los links "para compartir" de Drive y Dropbox llevan a una página; estos llevan al archivo.
export function linkDeDescarga(link) {
  let url;
  try {
    url = new URL(link);
  } catch {
    return link;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'drive.google.com') {
    const id = /^\/file\/d\/([^/]+)/.exec(url.pathname)?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null);
    if (id) return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  }
  if (host === 'dropbox.com' || host === 'www.dropbox.com') {
    url.searchParams.set('dl', '1');
    return url.toString();
  }
  return link;
}

function leerUrl(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new ErrorDeDescarga(MENSAJES.invalido);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ErrorDeDescarga(MENSAJES.invalido);
  return url;
}

export function crearDescargador({
  permitirDireccion = esDireccionPublica,
  tiempoMaximoMs = 15_000,
  tamanoMaximo = TAMANO_MAXIMO_IMAGEN,
  maxRedirecciones = 3,
} = {}) {
  // Node puede pedir todas las direcciones ({ all: true }) o una sola: se responde con la forma que pidió.
  function lookup(nombre, opciones, listo) {
    dns.lookup(nombre, { ...opciones, all: true }, (error, direcciones) => {
      if (error) return listo(error);
      if (direcciones.length === 0 || direcciones.some((d) => !permitirDireccion(d.address))) {
        return listo(new ErrorDeDescarga(MENSAJES.bloqueado));
      }
      if (opciones.all) return listo(null, direcciones);
      listo(null, direcciones[0].address, direcciones[0].family);
    });
  }

  function pedir(url, senal) {
    const ip = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(ip) && !permitirDireccion(ip)) throw new ErrorDeDescarga(MENSAJES.bloqueado);
    const cliente = url.protocol === 'https:' ? https : http;
    return new Promise((resolver, rechazar) => {
      const pedido = cliente.request(url, {
        lookup,
        signal: senal,
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; importador-de-fotos)', accept: 'image/*' },
      });
      pedido.on('response', resolver);
      pedido.on('error', rechazar);
      pedido.end();
    });
  }

  async function leerCuerpo(respuesta) {
    if (Number(respuesta.headers['content-length']) > tamanoMaximo) {
      respuesta.destroy();
      throw new ErrorDeDescarga(MENSAJES.pesado);
    }
    const partes = [];
    let total = 0;
    for await (const parte of respuesta) {
      total += parte.length;
      if (total > tamanoMaximo) {
        respuesta.destroy();
        throw new ErrorDeDescarga(MENSAJES.pesado);
      }
      partes.push(parte);
    }
    return Buffer.concat(partes);
  }

  async function descargar(link) {
    const senal = AbortSignal.timeout(tiempoMaximoMs);
    let url = leerUrl(link);
    for (let vuelta = 0; ; vuelta++) {
      const respuesta = await pedir(url, senal);
      const { statusCode: estado, headers } = respuesta;
      if (REDIRECCIONES.has(estado) && headers.location) {
        respuesta.resume();
        if (vuelta >= maxRedirecciones) throw new ErrorDeDescarga(MENSAJES.vueltas);
        url = leerUrl(new URL(headers.location, url).toString());
        continue;
      }
      if (estado < 200 || estado >= 300) {
        respuesta.resume();
        throw new ErrorDeDescarga(`el link respondió con un error (${estado})`);
      }
      const cuerpo = await leerCuerpo(respuesta);
      if (!tipoDeImagen(cuerpo)) throw new ErrorDeDescarga(MENSAJES.noEsFoto);
      return cuerpo;
    }
  }

  return async (link) => {
    try {
      return await descargar(link);
    } catch (error) {
      if (error instanceof ErrorDeDescarga) throw error;
      if (error.cause instanceof ErrorDeDescarga) throw error.cause;
      if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new ErrorDeDescarga(MENSAJES.tiempo);
      throw new ErrorDeDescarga(MENSAJES.red, { cause: error });
    }
  };
}
