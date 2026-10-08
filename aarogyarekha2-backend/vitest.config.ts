import { defineConfig } from 'vitest/config';
// Slow tests (PDF parsing, PGlite, property checks) can pass 5 s when many files run at once on a busy machine.
export default defineConfig({ test: { env: { LOG_LEVEL: 'silent' }, testTimeout: 30_000, hookTimeout: 60_000 } });
