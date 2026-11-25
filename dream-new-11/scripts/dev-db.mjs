// Runs a real local PostgreSQL for development without Docker.
// Data lives in ./.pgdata. Credentials match DATABASE_URL in .env.example.
// Stop with Ctrl+C. (docker-compose.yml is the alternative once Docker is set up.)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DB = 'dream11';
const port = Number(process.env.PGPORT ?? 5433);
const dataDir = resolve(import.meta.dirname, '..', '.pgdata');
const firstRun = !existsSync(resolve(dataDir, 'PG_VERSION'));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'dream11',
  password: 'dream11',
  port,
  persistent: true,
  // Always UTF-8: on Windows initdb otherwise inherits the ANSI code page (WIN1252),
  // which cannot store ₹, Hindi names or emoji.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: process.env.PG_DEBUG ? console.log : () => {},
  onError: console.error,
});

if (firstRun) {
  console.log('Initialising Postgres data directory…');
  await pg.initialise();
}
await pg.start();

const admin = pg.getPgClient('postgres');
await admin.connect();
const { rows } = await admin.query('SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1', [DB]);
if (rows.length === 0) {
  await admin.query(`CREATE DATABASE ${DB} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
  console.log(`Created database ${DB} (UTF8).`);
} else if (rows[0].enc !== 'UTF8') {
  console.warn(
    `\n⚠ Database "${DB}" uses ${rows[0].enc}, not UTF8 — names with ₹, Hindi text or emoji will fail.\n` +
      `  Fix (deletes local dev data): stop this script, delete .pgdata, run it again, then db:migrate and db:seed.\n`,
  );
}
await admin.end();

console.log(`Postgres ready on localhost:${port} (db ${DB}, user dream11). Ctrl+C to stop.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// Keep the process alive while Postgres runs.
setInterval(() => {}, 1 << 30);
