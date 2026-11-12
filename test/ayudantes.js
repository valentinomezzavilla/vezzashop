// Utilidades solo para tests.
import assert from 'node:assert/strict';
import http from 'node:http';

// Navegador mínimo contra el panel: guarda cookies y no sigue redirecciones.
export function crearNavegador(base) {
  const cookies = new Map();
  async function pedir(ruta, opciones = {}) {
    const headers = new Headers(opciones.headers);
    if (cookies.size) headers.set('cookie', [...cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    const respuesta = await fetch(base + ruta, { ...opciones, headers, redirect: 'manual' });
    for (const cookie of respuesta.headers.getSetCookie()) {
      const [par] = cookie.split(';');
      const i = par.indexOf('=');
      cookies.set(par.slice(0, i), par.slice(i + 1));
    }
    return respuesta;
  }
  async function csrfDe(ruta) {
    const html = await (await pedir(ruta)).text();
    const encontrado = html.match(/name="_csrf" value="([^"]+)"/);
    assert.ok(encontrado, `no encontré el token CSRF en ${ruta}`);
    return encontrado[1];
  }
  // campos: un objeto, o una lista de pares [nombre, valor] para mandar campos repetidos (sku=A&sku=B).
  async function enviar(ruta, campos, { desde = ruta } = {}) {
    const pares = Array.isArray(campos) ? campos : Object.entries(campos);
    const cuerpo = new URLSearchParams([['_csrf', await csrfDe(desde)], ...pares]);
    return pedir(ruta, { method: 'POST', body: cuerpo });
  }
  // Formulario multipart. Los archivos van como { contenido, nombre }; una lista de archivos manda varios con el mismo nombre.
  async function enviarArchivos(ruta, campos, { desde = ruta } = {}) {
    const formulario = new FormData();
    formulario.set('_csrf', await csrfDe(desde));
    for (const [nombre, valor] of Object.entries(campos)) {
      for (const item of Array.isArray(valor) ? valor : [valor]) {
        if (item?.contenido) formulario.append(nombre, new Blob([item.contenido]), item.nombre);
        else formulario.append(nombre, item);
      }
    }
    return pedir(ruta, { method: 'POST', body: formulario });
  }
  const subirExcel = (contenido, nombre = 'productos.xlsx') =>
    enviarArchivos('/admin/importar', { archivo: { contenido, nombre } });
  return { pedir, enviar, enviarArchivos, subirExcel, csrfDe };
}

// GET con un header Host a elección (fetch no deja cambiarlo), para probar la vidriera por subdominio.
export function pedirConHost(puerto, host, ruta) {
  return new Promise((resolver, rechazar) => {
    http
      .get({ host: '127.0.0.1', port: puerto, path: ruta, headers: { host: `${host}:${puerto}` } }, (respuesta) => {
        let cuerpo = '';
        respuesta.setEncoding('utf8');
        respuesta.on('data', (parte) => (cuerpo += parte));
        respuesta.on('end', () => resolver({ status: respuesta.statusCode, location: respuesta.headers.location, headers: respuesta.headers, cuerpo }));
      })
      .on('error', rechazar);
  });
}

// POST de un formulario a la vidriera con un Host a elección. campos: objeto o lista de pares [nombre, valor].
export function enviarConHost(puerto, host, ruta, campos, headers = {}) {
  const cuerpo = new URLSearchParams(Array.isArray(campos) ? campos : Object.entries(campos)).toString();
  return new Promise((resolver, rechazar) => {
    const pedido = http.request(
      {
        host: '127.0.0.1',
        port: puerto,
        path: ruta,
        method: 'POST',
        headers: {
          host: `${host}:${puerto}`,
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(cuerpo),
          ...headers,
        },
      },
      (respuesta) => {
        let texto = '';
        respuesta.setEncoding('utf8');
        respuesta.on('data', (parte) => (texto += parte));
        respuesta.on('end', () => resolver({ status: respuesta.statusCode, location: respuesta.headers.location, headers: respuesta.headers, cuerpo: texto }));
      },
    );
    pedido.on('error', rechazar);
    pedido.end(cuerpo);
  });
}

export async function crearTiendaVacia(db, slug) {
  const { rows } = await db.prepare('INSERT INTO tiendas (nombre, slug) VALUES (?, ?) RETURNING id').run(slug, slug);
  return rows[0].id;
}

async function rutaCategoria(db, id) {
  const partes = [];
  for (let actual = id; actual !== null; ) {
    const categoria = await db.prepare('SELECT nombre, padre_id FROM categorias WHERE id = ?').get(actual);
    partes.unshift(categoria.nombre);
    actual = categoria.padre_id;
  }
  return partes.join(' > ');
}

// Foto del catálogo de una tienda, ordenada, para comparar con valores literales.
export async function leerCatalogo(db, tiendaId) {
  const productos = await db
    .prepare('SELECT * FROM productos WHERE tienda_id = ? ORDER BY nombre')
    .all(tiendaId);
  const catalogo = [];
  for (const p of productos) {
    const atributos = [p.atributo1, p.atributo2, p.atributo3].filter((a) => a !== null);
    const categorias = [];
    for (const f of await db.prepare('SELECT categoria_id FROM producto_categorias WHERE producto_id = ?').all(p.id)) {
      categorias.push(await rutaCategoria(db, f.categoria_id));
    }
    catalogo.push({
      nombre: p.nombre,
      descripcion: p.descripcion,
      visible: p.visible,
      atributos,
      categorias: categorias.sort(),
      variantes: (await db.prepare('SELECT * FROM variantes WHERE producto_id = ? ORDER BY sku').all(p.id)).map((v) => ({
        sku: v.sku,
        valores: [v.valor1, v.valor2, v.valor3].slice(0, atributos.length),
        precio: v.precio_centavos,
        stock: v.stock,
      })),
    });
  }
  return catalogo;
}
