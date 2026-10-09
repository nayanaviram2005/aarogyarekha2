const STRONG_YES = new Set(['yes', 'yeah', 'yep', 'yup', 'ya', 'correct', 'true', 'sure', 'haan', 'han', 'haa', 'ha', 'haanji', 'hanji', 'हाँ', 'हां', 'हा', 'हाँजी', 'हांजी', 'सही', 'ହଁ', 'ହୁଁ', 'ହଁ', 'ଅଛି']);
const STRONG_NO = new Set(['no', 'nope', 'nah', 'not', 'never', 'nahi', 'nahin', 'nhi', 'nai', 'na', 'नहीं', 'नही', 'नहि', 'ना', 'ନା', 'ନାହିଁ', 'ନାହିଁ']);
const WEAK_YES = new Set(['ji', 'jee', 'जी']);
const UNSURE = /(not sure|don'?t know|do not know|no idea|maybe|unsure|pata nahi|पता नहीं|पता नही|ଜାଣି ନାହିଁ)/i;

export function parseYesNo(text: string): 'yes' | 'no' | null {
  const t = text.toLowerCase().normalize('NFC');
  if (!t.trim() || UNSURE.test(t)) return null;
  const tokens = t.replace(/[.,!?;:"“”'‘’()।]/g, ' ').split(/\s+/).filter(Boolean);
  const yes = tokens.some(x => STRONG_YES.has(x)), no = tokens.some(x => STRONG_NO.has(x));
  if (yes && no) return null;
  if (no) return 'no';
  if (yes) return 'yes';
  return tokens.some(x => WEAK_YES.has(x)) ? 'yes' : null;
}
