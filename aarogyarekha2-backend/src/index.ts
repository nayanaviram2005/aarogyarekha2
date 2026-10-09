import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeLiveDeps, makePool } from './liveDeps.js';

const config = loadConfig();
const pool = makePool(config);
const app = await buildApp(config, makeLiveDeps(config, pool));

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

const host = process.env.API_HOST?.trim() || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
await app.listen({ port: Number(process.env.PORT) || config.API_PORT, host });
