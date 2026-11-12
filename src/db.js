// Base de datos PostgreSQL.
//  - Producción: el servidor de Postgres de DATABASE_URL (postgres://usuario:clave@host:5432/base), con el driver `pg`.
//  - Desarrollo y tests: PGlite, un Postgres real que corre dentro de Node sin instalar nada
//    (':memory:' para tests, 'pglite:<carpeta>' para guardar en disco).
// Las dos opciones exponen la misma interfaz asíncrona, parecida a la que tenía SQLite:
//    await db.prepare('SELECT ... WHERE id = ?').get(id)     -> una fila o undefined
//    await db.prepare('SELECT ...').all(a, b)                -> arreglo de filas
//    await db.prepare('UPDATE ...').run(a, b)                -> { changes, rows }
//    await db.exec('CREATE TABLE ...; CREATE ...')           -> varias sentencias, sin parámetros
//    await enTransaccion(db, async (tx) => { ... })         -> tx se usa igual que db, dentro de la misma transacción
// Los parámetros se escriben con ? y acá se convierten en $1, $2... (la forma de Postgres).
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR_MIGRACIONES = path.join(import.meta.dirname, 'migraciones');
// Candado para que dos instancias de la app arrancando a la vez no apliquen las migraciones dos veces.
const CANDADO_MIGRACIONES = 727_001;

// "WHERE a = ? AND b = '¿?'" -> "WHERE a = $1 AND b = '¿?'" (los ? dentro de textos entre comillas no cuentan).
export function convertirMarcadores(sql) {
  let n = 0;
  let enTexto = false;
  let salida = '';
  for (const c of sql) {
    if (c === "'") enTexto = !enTexto;
    salida += c === '?' && !enTexto ? `$${++n}` : c;
  }
  return salida;
}

// Arma la interfaz db/tx a partir de una función que ejecuta una consulta: (sql, parametros) -> { rows, filasAfectadas }.
function armarInterfaz(consultar, ejecutarVarias) {
  return {
    prepare(sql) {
      const texto = convertirMarcadores(sql);
      return {
        async get(...parametros) {
          return (await consultar(texto, parametros)).rows[0];
        },
        async all(...parametros) {
          return (await consultar(texto, parametros)).rows;
        },
        async run(...parametros) {
          const { rows, filasAfectadas } = await consultar(texto, parametros);
          return { changes: filasAfectadas, rows };
        },
      };
    },
    exec: ejecutarVarias,
  };
}

async function abrirPglite(destino) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  const opciones = { parsers: { [types.NUMERIC]: Number, [types.INT8]: Number } };
  let instancia;
  if (destino === ':memory:') {
    instancia = new PGlite(opciones);
  } else {
    const carpeta = path.resolve(destino.replace(/^pglite:/, ''));
    mkdirSync(carpeta, { recursive: true });
    instancia = new PGlite(carpeta, opciones);
  }
  await instancia.waitReady;
  const aInterfaz = (cliente) =>
    armarInterfaz(
      async (sql, parametros) => {
        const r = await cliente.query(sql, parametros);
        return { rows: r.rows, filasAfectadas: r.affectedRows ?? r.rows.length };
      },
      async (sql) => {
        await cliente.exec(sql);
      },
    );
  return {
    ...aInterfaz(instancia),
    transaccion: (fn) => instancia.transaction((tx) => fn(aInterfaz(tx))),
    cerrar: () => instancia.close(),
  };
}

// esquema: solo para los tests (ver abrirBase). Cada prueba trabaja en su propio esquema, aislado de las demás.
async function abrirPostgres(url, esquema = null) {
  const { default: pg } = await import('pg');
  // Por defecto pg devuelve BIGINT y SUM() como texto. Acá los precios están en centavos y caben de sobra en un número.
  pg.types.setTypeParser(20, Number);
  pg.types.setTypeParser(1700, Number);
  if (esquema) {
    const admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA "${esquema}"`);
    await admin.end();
  }
  const pool = new pg.Pool({
    connectionString: url,
    max: Number(process.env.DB_CONEXIONES_MAX ?? 10),
    ...(esquema && { options: `-c search_path=${esquema}` }),
  });
  const aInterfaz = (cliente) =>
    armarInterfaz(
      async (sql, parametros) => {
        const r = await cliente.query(sql, parametros);
        return { rows: r.rows, filasAfectadas: r.rowCount };
      },
      async (sql) => {
        await cliente.query(sql);
      },
    );
  return {
    ...aInterfaz(pool),
    async transaccion(fn) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await fn(aInterfaz(cliente));
        await cliente.query('COMMIT');
        return resultado;
      } catch (error) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        cliente.release();
      }
    },
    async cerrar() {
      await pool.end();
      if (!esquema) return;
      const admin = new pg.Pool({ connectionString: url, max: 1 });
      await admin.query(`DROP SCHEMA "${esquema}" CASCADE`);
      await admin.end();
    },
  };
}

// Para mostrar en el log a qué base se conectó, sin la contraseña.
export function describirBase(destino) {
  if (!/^postgres(ql)?:\/\//.test(destino)) return destino === ':memory:' ? 'PGlite en memoria' : `PGlite (${destino.replace(/^pglite:/, '')})`;
  const { host, pathname, username } = new URL(destino);
  return `PostgreSQL ${username}@${host}${pathname}`;
}

// destino: 'postgres://...' | 'postgresql://...' | ':memory:' | 'pglite:<carpeta>'
//
// Para correr los tests contra un PostgreSQL de verdad (en vez de PGlite): PRUEBAS_DATABASE_URL=postgres://... npm test
// Cada ':memory:' crea entonces un esquema nuevo y aislado en esa base, que se borra al cerrarla.
export async function abrirBase(destino) {
  const urlPruebas = process.env.PRUEBAS_DATABASE_URL;
  let db;
  if (destino === ':memory:' && urlPruebas) {
    db = await abrirPostgres(urlPruebas, `prueba_${process.pid}_${(contadorEsquemas += 1)}`);
  } else {
    db = /^postgres(ql)?:\/\//.test(destino) ? await abrirPostgres(destino) : await abrirPglite(destino);
  }
  await migrar(db);
  return db;
}

let contadorEsquemas = 0;

// Ejecuta fn(tx) dentro de una transacción: si fn falla, no se guarda nada. Dentro hay que usar tx, no db.
export function enTransaccion(db, fn) {
  return db.transaccion(fn);
}

// Aplica en orden los .sql de src/migraciones que todavía no se aplicaron.
async function migrar(db) {
  await enTransaccion(db, async (tx) => {
    await tx.prepare('SELECT pg_advisory_xact_lock(?)').get(CANDADO_MIGRACIONES);
    await tx.exec(`CREATE TABLE IF NOT EXISTS migraciones (
      nombre TEXT PRIMARY KEY,
      aplicada_en TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
    )`);
    const aplicadas = new Set((await tx.prepare('SELECT nombre FROM migraciones').all()).map((f) => f.nombre));
    const pendientes = readdirSync(DIR_MIGRACIONES)
      .filter((archivo) => archivo.endsWith('.sql') && !aplicadas.has(archivo))
      .sort();
    for (const archivo of pendientes) {
      await tx.exec(readFileSync(path.join(DIR_MIGRACIONES, archivo), 'utf8'));
      await tx.prepare('INSERT INTO migraciones (nombre) VALUES (?)').run(archivo);
    }
  });
}
