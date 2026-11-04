// Límite simple de intentos por clave (por ejemplo, la IP) en una ventana de tiempo. Vive en memoria:
// alcanza para frenar abusos de una sola instalación; se reinicia con el servidor.
export function crearLimite({ maximo, ventanaMs }) {
  const registros = new Map();
  const vigentes = (clave, ahora) => (registros.get(clave) ?? []).filter((momento) => ahora - momento < ventanaMs);
  return {
    // true si todavía puede: no suma el intento (eso lo hace registrar).
    puede(clave, ahora = Date.now()) {
      return vigentes(clave, ahora).length < maximo;
    },
    registrar(clave, ahora = Date.now()) {
      // Limpieza de vez en cuando para que el mapa no crezca sin fin.
      if (registros.size > 10_000) {
        for (const [otra] of registros) if (vigentes(otra, ahora).length === 0) registros.delete(otra);
      }
      registros.set(clave, [...vigentes(clave, ahora), ahora]);
    },
  };
}
