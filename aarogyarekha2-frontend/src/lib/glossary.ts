export interface GlossaryTerm { term: string; words: string[] }

export const GLOSSARY: GlossaryTerm[] = [
  { term: 'fever', words: ['bukhar', 'bukhaar', 'बुखार', 'ज्वर', 'ଜ୍ୱର', 'jwar'] },
  { term: 'cough', words: ['khansi', 'khasi', 'खांसी', 'खाँसी', 'କାଶ'] },
  { term: 'headache', words: ['sir dard', 'sardard', 'सिरदर्द', 'सिर दर्द', 'ମୁଣ୍ଡବିଷ', 'ମୁଣ୍ଡ ବିନ୍ଧା', 'munda bidha'] },
  { term: 'stomach pain', words: ['pet dard', 'pet mein dard', 'पेट दर्द', 'पेट में दर्द', 'ପେଟ ଯନ୍ତ୍ରଣା', 'ପେଟ ବିନ୍ଧା'] },
  { term: 'vomiting', words: ['ulti', 'उल्टी', 'ବାନ୍ତି', 'banti'] },
  { term: 'loose motions', words: ['dast', 'दस्त', 'ଝାଡ଼ା', 'jhada', 'patla pakhana'] },
  { term: 'weakness', words: ['kamzori', 'कमज़ोरी', 'कमजोरी', 'ଦୁର୍ବଳତା', 'durbalata'] },
  { term: 'breathlessness', words: ['saans phoolna', 'saans lene mein', 'सांस फूलना', 'साँस फूलना', 'सांस लेने में', 'ଶ୍ୱାସକଷ୍ଟ', 'ହାଁପିବା', 'sasa kasta'] },
  { term: 'dizziness', words: ['chakkar', 'चक्कर', 'ମୁଣ୍ଡ ବୁଲାଉଛି', 'munda bulauchi'] },
  { term: 'cold and runny nose', words: ['jukam', 'zukam', 'जुकाम', 'ସର୍ଦ୍ଦି', 'sardi'] },
  { term: 'sore throat', words: ['gale mein dard', 'gala dard', 'गले में दर्द', 'गला दर्द', 'ଗଳା ବିନ୍ଧା', 'ଗଳା ଯନ୍ତ୍ରଣା'] },
  { term: 'chest pain', words: ['seene mein dard', 'chhati mein dard', 'सीने में दर्द', 'छाती में दर्द', 'ଛାତି ଯନ୍ତ୍ରଣା', 'ଛାତି ବିନ୍ଧା'] },
  { term: 'body ache', words: ['badan dard', 'body dard', 'बदन दर्द', 'शरीर दर्द', 'ଦେହ ଯନ୍ତ୍ରଣା', 'ଦେହ ବିନ୍ଧା'] },
  { term: 'back pain', words: ['kamar dard', 'कमर दर्द', 'ଦେହ ପିଠି ବିନ୍ଧା', 'ପିଠି ଯନ୍ତ୍ରଣା'] },
  { term: 'sweating', words: ['pasina', 'पसीना', 'ଝାଳ'] },
  { term: 'swelling', words: ['sujan', 'सूजन', 'ଫୁଲା', 'phula'] },
  { term: 'chills', words: ['thand lagna', 'kaanpna', 'ठंड लगना', 'कंपकंपी', 'ଥରିବା', 'ଶୀତ ଲାଗିବା'] },
  { term: 'loss of appetite', words: ['bhookh nahi', 'bhukh nahi', 'भूख नहीं', 'ଭୋକ ହେଉନାହିଁ'] },
  { term: 'burning urine', words: ['peshab mein jalan', 'पेशाब में जलन', 'ପରିସ୍ରାରେ ଜ୍ୱାଳା'] },
  { term: 'bleeding', words: ['khoon', 'खून बह', 'रक्तस्राव', 'ରକ୍ତସ୍ରାବ', 'rakta'] },
  { term: 'itching', words: ['khujli', 'खुजली', 'ଖଜୁଆ', 'khajua'] },
  { term: 'rash', words: ['daane', 'chakte', 'दाने', 'चकत्ते', 'ଘା ଦାଣ୍ଟି', 'ଦାଗ'] },
];

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

export function glossaryMatches(text: string): string[] {
  const t = norm(text); if (!t.trim()) return [];
  const hay = ` ${t.replace(/[.,;:!?()\-]/g, ' ')} `;
  const out: string[] = [];
  for (const g of GLOSSARY) {
    const hit = g.words.some(w => {
      const nw = norm(w);
      return /[a-z]/.test(nw) ? hay.includes(` ${nw} `) || hay.includes(` ${nw}`) && nw.length > 5 : t.includes(nw);
    });
    if (hit) out.push(g.term);
  }
  return out;
}
