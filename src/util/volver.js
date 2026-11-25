// A dónde volver después de una acción hecha desde un listado del panel (la lista de productos, la de pedidos...): solo páginas
// del propio panel (/admin/...), nunca otro sitio. Si lo que llegó del formulario no sirve, se vuelve a `porDefecto`.
export function volverSeguro(valor, porDefecto = '/admin/productos') {
  const volver = String(valor ?? '');
  return volver.startsWith('/admin/') && !volver.startsWith('//') && !/[\r\n\\]/.test(volver) ? volver : porDefecto;
}
