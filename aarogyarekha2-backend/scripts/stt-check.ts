import { readFileSync } from 'node:fs';
import { AiEnv, AiError, envForTask } from '../src/ai/provider.js';
import { MAX_AUDIO_BYTES, makeTranscriber, sniffAudio, type SttLanguage } from '../src/ai/stt.js';

const [file, lang] = process.argv.slice(2);
if (!file) { console.log('Usage: stt-check.ts <audio-file> [en|hi|or]'); process.exit(1); }
if (lang && !['en', 'hi', 'or'].includes(lang)) { console.log('Language must be en, hi or or.'); process.exit(1); }
const bytes = readFileSync(file);
const mime = sniffAudio(bytes);
if (!mime) { console.log('That is not a webm, ogg, wav or mp4 recording.'); process.exit(1); }
if (bytes.length > MAX_AUDIO_BYTES) { console.log(`The recording is ${(bytes.length / 1048576).toFixed(1)} MB. The limit is 2 MB (about a minute).`); process.exit(1); }

const t = makeTranscriber(envForTask(AiEnv.parse(process.env), 'STT'));
console.log(`provider: ${t.name}   model: ${t.model || '(not set)'}   file: ${mime}, ${Math.round(bytes.length / 1024)} KB   language: ${lang ?? 'not given'}`);
try {
  const r = await t.transcribe({ bytes, mime, ...(lang ? { language: lang as SttLanguage } : {}) });
  console.log('heard language:', r.language ?? '(not said)');
  console.log('transcript:', r.text);
} catch (e) {
  console.log(e instanceof AiError ? `failed (${e.kind}): ${e.message}` : `failed: ${(e as Error).message}`);
  process.exitCode = 1;
}
