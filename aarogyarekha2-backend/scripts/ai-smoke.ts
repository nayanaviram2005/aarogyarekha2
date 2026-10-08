// Sends ONE synthetic sentence through the real translation path to check that the chosen provider, key and model work.
// Uses invented text only (no patient data). Prints the outcome, never the key.
//   AI_PROVIDER=gemini npm --prefix aarogyarekha2-backend run ai:smoke      (also: claude, openai, openrouter)
import { AiEnv, makeProvider, AiError } from '../src/ai/provider.js';
import { translateToEnglish } from '../src/ai/translate.js';

const env = AiEnv.parse(process.env);
const p = makeProvider(env);
console.log(`provider: ${p.name}   model: ${p.model || '(not set)'}`);
try {
  const o = await translateToEnglish(p.generate, [{ id: 'a', text: 'Rohan Kumar ko teen din se bukhar aur khansi hai' }], 'hi', { names: ['Rohan Kumar'], identifiers: [] });
  console.log('sent items:', o.sentItems, ' chars:', o.sentChars);
  console.log('translated:', JSON.stringify([...o.translated.entries()]), ' rejected:', o.rejected.length);
} catch (e) {
  console.log('FAILED:', e instanceof AiError ? `${e.kind}: ${e.message}` : (e as Error).name);
  process.exitCode = 1;
}
