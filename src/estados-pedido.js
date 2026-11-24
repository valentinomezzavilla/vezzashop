// Los estados de un pedido y cómo se llaman, para el negocio y para quien compró. Va aparte de pedidos.js (que lo vuelve a exportar)
// para que envios.js pueda usarlo sin que los dos módulos se importen entre sí.

// Estados de un pedido. "enviado" se lee "Listo para retirar" cuando el cliente lo busca.
export const ESTADOS = {
  nuevo: { titulo: 'Nuevo', cliente: 'Recibido' },
  pagado: { titulo: 'Pagado', cliente: 'Pago confirmado' },
  enviado: { titulo: 'Enviado', tituloRetiro: 'Listo para retirar', cliente: 'En camino', clienteRetiro: 'Listo para retirar' },
  entregado: { titulo: 'Entregado', cliente: 'Entregado' },
  cancelado: { titulo: 'Cancelado', cliente: 'Cancelado' },
};
export const esEstado = (valor) => typeof valor === 'string' && Object.hasOwn(ESTADOS, valor);

// En qué orden avanza un pedido (para saber si un cambio es un avance o una vuelta atrás).
export const ORDEN_ESTADOS = ['nuevo', 'pagado', 'enviado', 'entregado'];

export function tituloEstado(estado, tipoEntrega, { paraCliente = false } = {}) {
  const datos = ESTADOS[estado];
  if (paraCliente) return (tipoEntrega === 'retiro' && datos.clienteRetiro) || datos.cliente;
  return (tipoEntrega === 'retiro' && datos.tituloRetiro) || datos.titulo;
}
