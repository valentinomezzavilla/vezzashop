// Guarda las sesiones del panel en la base de datos: sobreviven a reinicios y se comparten entre instancias.
import session from 'express-session';

const UN_DIA_MS = 24 * 60 * 60 * 1000;

export class AlmacenSesiones extends session.Store {
  constructor(db) {
    super();
    this.leer = db.prepare('SELECT datos FROM sesiones WHERE sid = ? AND expira > ?');
    this.guardar = db.prepare(
      'INSERT INTO sesiones (sid, datos, expira) VALUES (?, ?, ?) ON CONFLICT (sid) DO UPDATE SET datos = excluded.datos, expira = excluded.expira',
    );
    this.renovar = db.prepare('UPDATE sesiones SET expira = ? WHERE sid = ?');
    this.borrar = db.prepare('DELETE FROM sesiones WHERE sid = ?');
    this.borrarVencidas = db.prepare('DELETE FROM sesiones WHERE expira <= ?');
  }

  // express-session espera callbacks, pero la base es asíncrona: cada método espera la consulta y avisa por el callback.
  get(sid, listo) {
    this.leer.get(sid, Date.now()).then(
      (fila) => listo(null, fila ? JSON.parse(fila.datos) : null),
      (error) => listo(error),
    );
  }

  set(sid, sesion, listo) {
    this.borrarVencidas
      .run(Date.now())
      .then(() => this.guardar.run(sid, JSON.stringify(sesion), vencimiento(sesion)))
      .then(() => listo?.(null), (error) => listo?.(error));
  }

  touch(sid, sesion, listo) {
    this.renovar.run(vencimiento(sesion), sid).then(() => listo?.(null), (error) => listo?.(error));
  }

  destroy(sid, listo) {
    this.borrar.run(sid).then(() => listo?.(null), (error) => listo?.(error));
  }
}

function vencimiento(sesion) {
  const expira = sesion.cookie?.expires;
  return expira ? new Date(expira).getTime() : Date.now() + UN_DIA_MS;
}
