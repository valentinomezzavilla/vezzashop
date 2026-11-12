import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const RAIZ = path.resolve(import.meta.dirname, '..');

// El .env vive fuera del repo. Se busca en este orden:
//  1. la ruta de la variable ARCHIVO_ENV
//  2. ~/.config/plataforma-tiendas/.env
//  3. .env en la raíz del proyecto (ignorado por git)
export function cargarEnv() {
  if (process.env.ARCHIVO_ENV && !existsSync(process.env.ARCHIVO_ENV)) {
    throw new Error(`ARCHIVO_ENV apunta a ${process.env.ARCHIVO_ENV}, pero ese archivo no existe`);
  }
  const candidatos = [
    process.env.ARCHIVO_ENV,
    path.join(homedir(), '.config', 'plataforma-tiendas', '.env'),
    path.join(RAIZ, '.env'),
  ].filter(Boolean);
  const archivo = candidatos.find((ruta) => existsSync(ruta)) ?? null;
  if (archivo) process.loadEnvFile(archivo);
  return archivo;
}

// PostgreSQL: DATABASE_URL (postgres://usuario:clave@host:5432/base). En producción es obligatoria.
// Sin ella, en tu compu se usa PGlite (un Postgres que corre dentro de Node) guardado en ./data/pglite.
function leerUrlBase(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.NODE_ENV === 'production') {
    throw new Error('Falta DATABASE_URL (la conexión a PostgreSQL). Mirá .env.example y el README.');
  }
  return `pglite:${path.join(RAIZ, 'data', 'pglite')}`;
}

export function leerConfig(env = process.env) {
  if (!env.SECRETO_SESION || env.SECRETO_SESION.length < 32) {
    throw new Error('Falta SECRETO_SESION (mínimo 32 caracteres). Mirá .env.example y el README.');
  }
  return {
    puerto: Number(env.PUERTO ?? 3000),
    produccion: env.NODE_ENV === 'production',
    secretoSesion: env.SECRETO_SESION,
    // El panel se ve en `dominio`; las tiendas, en <slug>.<dominioTiendas>, que por defecto es el mismo `dominio`.
    dominio: (env.DOMINIO || 'localhost').trim().toLowerCase(),
    dominioTiendas: (env.DOMINIO_TIENDAS || env.DOMINIO || 'localhost').trim().toLowerCase(),
    urlBase: leerUrlBase(env),
    dirImportaciones: env.DIR_IMPORTACIONES ?? path.join(RAIZ, 'data', 'importaciones'),
    dirSubidas: env.DIR_SUBIDAS ?? path.join(RAIZ, 'data', 'subidas'),
  };
}
