import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeLiveDeps, makePool } from './liveDeps.js';

const config = loadConfig();
const pool = makePool(config);
const app = await buildApp(config, makeLiveDeps(config, pool));

const close = async () => { await app.close(); await pool.end(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

await app.listen({ port: config.API_PORT, host: '127.0.0.1' });   // loopback only until a reverse proxy fronts it
