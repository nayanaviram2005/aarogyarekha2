import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeLiveDeps, makePool } from './liveDeps.js';

const config = loadConfig();
const pool = makePool(config);
const app = await buildApp(config, makeLiveDeps(config, pool));

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

// Loopback only by default (behind a reverse proxy). A host that hands us a PORT (Render and similar) routes to the service from outside, so it must listen on all addresses; API_HOST overrides either way.
const host = process.env.API_HOST?.trim() || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
await app.listen({ port: Number(process.env.PORT) || config.API_PORT, host });
