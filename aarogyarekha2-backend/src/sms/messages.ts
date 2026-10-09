export type Lang = 'en' | 'hi' | 'or';
export type Tier = 1 | 2 | 3 | 4;
export type Kind = 'status' | 'moved_down';

export const TIER_OF_URGENCY: Record<string, Tier> = { red: 1, orange: 2, yellow: 3, green: 4 };

export const STATUS_WORD: Record<Lang, Record<Tier, string>> = {
  en: { 1: 'IMMEDIATE', 2: 'VERY URGENT', 3: 'URGENT', 4: 'ROUTINE' },
  hi: { 1: 'तुरंत ध्यान देने योग्य (IMMEDIATE)', 2: 'बहुत ज़रूरी (VERY URGENT)', 3: 'ज़रूरी (URGENT)', 4: 'सामान्य (ROUTINE)' },
  or: { 1: 'ତୁରନ୍ତ ଧ୍ୟାନ ଆବଶ୍ୟକ (IMMEDIATE)', 2: 'ବହୁତ ଜରୁରୀ (VERY URGENT)', 3: 'ଜରୁରୀ (URGENT)', 4: 'ସାଧାରଣ (ROUTINE)' },
};

const STOP: Record<Lang, string> = {
  en: ' Reply STOP to stop these messages.',
  hi: ' ये संदेश बंद करने के लिए STOP लिखकर भेजें।',
  or: ' ଏହି ବାର୍ତ୍ତା ବନ୍ଦ କରିବାକୁ STOP ଲେଖି ପଠାନ୍ତୁ।',
};

const TEMPLATE: Record<Lang, Record<Tier, string> & { down: string }> = {
  en: {
    4: 'Hi {name}, your status is {status}, so you must wait a little while. We will call you when it is your turn.',
    3: 'Hi {name}, your status is {status}, so you have been moved up the queue. Please stay nearby; we will call you soon.',
    2: 'Hi {name}, your status is {status}, so you have been moved up the queue. Please stay close to the desk; a nurse will call you very soon.',
    1: 'Hi {name}, your status is {status}, so you need immediate attention. Please move ahead quickly to the {facility} triage desk.',
    down: 'Hi {name}, your status is now {status}, so you have been moved slightly down the queue. You will still be seen. Please stay nearby.',
  },
  hi: {
    4: 'नमस्ते {name}, आपकी स्थिति {status} है, इसलिए आपको थोड़ी देर प्रतीक्षा करनी होगी। आपकी बारी आने पर हम आपको बुलाएँगे।',
    3: 'नमस्ते {name}, आपकी स्थिति {status} है, इसलिए आपको कतार में थोड़ा आगे किया गया है। कृपया पास ही रहें; हम आपको जल्द बुलाएँगे।',
    2: 'नमस्ते {name}, आपकी स्थिति {status} है, इसलिए आपको कतार में आगे किया गया है। कृपया काउंटर के पास रहें; नर्स आपको बहुत जल्द बुलाएगी।',
    1: 'नमस्ते {name}, आपकी स्थिति {status} है। कृपया जल्दी से {facility} के ट्रायाज डेस्क पर आगे आएँ।',
    down: 'नमस्ते {name}, आपकी स्थिति अब {status} है, इसलिए आपको कतार में थोड़ा पीछे किया गया है। आपको फिर भी देखा जाएगा। कृपया पास ही रहें।',
  },
  or: {
    4: 'ନମସ୍କାର {name}, ଆପଣଙ୍କ ସ୍ଥିତି {status} ଅଟେ, ତେଣୁ ଆପଣଙ୍କୁ କିଛି ସମୟ ଅପେକ୍ଷା କରିବାକୁ ପଡ଼ିବ। ଆପଣଙ୍କ ପାଳି ଆସିଲେ ଆମେ ଆପଣଙ୍କୁ ଡାକିବୁ।',
    3: 'ନମସ୍କାର {name}, ଆପଣଙ୍କ ସ୍ଥିତି {status} ଅଟେ, ତେଣୁ ଆପଣଙ୍କୁ ଧାଡ଼ିରେ ଟିକେ ଆଗକୁ ନିଆଯାଇଛି। ଦୟାକରି ପାଖରେ ରୁହନ୍ତୁ; ଆମେ ଶୀଘ୍ର ଆପଣଙ୍କୁ ଡାକିବୁ।',
    2: 'ନମସ୍କାର {name}, ଆପଣଙ୍କ ସ୍ଥିତି {status} ଅଟେ, ତେଣୁ ଆପଣଙ୍କୁ ଧାଡ଼ିରେ ଆଗକୁ ନିଆଯାଇଛି। ଦୟାକରି କାଉଣ୍ଟର ପାଖରେ ରୁହନ୍ତୁ; ନର୍ସ ଆପଣଙ୍କୁ ଅତି ଶୀଘ୍ର ଡାକିବେ।',
    1: 'ନମସ୍କାର {name}, ଆପଣଙ୍କ ସ୍ଥିତି {status} ଅଟେ। ଦୟାକରି ଶୀଘ୍ର {facility} ର ଟ୍ରାଏଜ୍ ଡେସ୍କକୁ ଆଗକୁ ଆସନ୍ତୁ।',
    down: 'ନମସ୍କାର {name}, ଆପଣଙ୍କ ସ୍ଥିତି ଏବେ {status} ଅଟେ, ତେଣୁ ଆପଣଙ୍କୁ ଧାଡ଼ିରେ ଟିକେ ପଛକୁ ନିଆଯାଇଛି। ତଥାପି ଆପଣଙ୍କୁ ଦେଖାଯିବ। ଦୟାକରି ପାଖରେ ରୁହନ୍ତୁ।',
  },
};

export const asLang = (l: string | null | undefined): Lang => (l === 'hi' || l === 'or' ? l : 'en');

export function firstName(full: string | null | undefined): string {
  const t = (full ?? '').trim().split(/\s+/)[0] ?? '';
  return t.replace(/[\u0000-\u001f\u007f{}]/g, '').slice(0, 30) || 'there';
}

export interface MessageInput { lang: Lang; tier: Tier; kind: Kind; name: string; facility: string }
export function renderStatusMessage(i: MessageInput): string {
  const values: Record<string, string> = { name: i.name.replace(/[{}]/g, '').slice(0, 30), status: STATUS_WORD[i.lang][i.tier], facility: i.facility.replace(/[{}]/g, '').slice(0, 60) };
  const body = TEMPLATE[i.lang][i.kind === 'moved_down' ? 'down' : i.tier].replace(/\{(name|status|facility)\}/g, (_m, k: string) => values[k]!);
  return body + STOP[i.lang];
}

export function planKind(previous: Tier | null, next: Tier): Kind | 'none' {
  if (previous === null) return 'status';
  if (next === previous) return 'none';
  return next < previous ? 'status' : 'moved_down';
}

export function segmentCount(text: string): number {
  const gsm = /^[\n\r\f !"#$%&'()*+,\-./0-9:;<=>?@A-Za-z_£¥èéùìòÇØøÅåΔΦΓΛΩΠΨΣΘΞÆæßÉÄÖÑÜ§¿äöñüà€\[\]\\^{|}~]*$/.test(text);
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  const len = [...text].length;
  return len <= single ? 1 : Math.ceil(len / multi);
}
