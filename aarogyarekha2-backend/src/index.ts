import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeLiveDeps, makePool } from './liveDeps.js';

const config = loadConfig();
const pool = makePool(config);
const app = await buildApp(config, makeLiveDeps(config, pool));

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

// Loopback only by default (behind a reverse proxy). A host such as Render sets PORT and needs API_HOST=0.0.0.0 so its router can reach the service.
await app.listen({ port: Number(process.env.PORT) || config.API_PORT, host: process.env.API_HOST?.trim() || '127.0.0.1' });
