import type { NotePdf } from '../referral/pdf.js';
import { flagText, type ContextDoc } from '../ocr/recordContext.js';

export type HandoverLang = 'en' | 'hi' | 'or';

const L: Record<HandoverLang, Record<string, string>> = {
  en: {
    title: 'Handover summary', patient: 'Patient', ref: 'Reference', ageSex: 'Age and sex', language: 'Language spoken', facility: 'Facility', made: 'Prepared',
    complaint: 'Main complaint', words: "In the patient's own words", translation: 'English translation (machine, not verified)', priority: 'Priority', level: 'Level', why: 'Reasons shown by the rules',
    signed: 'Signed off by', notSigned: 'Not signed off yet. A nurse or doctor must review this priority.', changedTo: 'changed to', reason: 'Reason', measurements: 'Measurements', none: 'None recorded',
    stillAsk: 'Danger-sign questions still open', reports: 'Report findings, as printed on the reports', unchecked: 'not yet checked by a person', noReports: 'No report results on file',
    t1: 'Immediate', t2: 'Very urgent', t3: 'Urgent', t4: 'Routine', notAssessed: 'Not assessed yet',
    note: 'Organises information for review. It does not diagnose or advise treatment. The rules behind the priority are a draft and have not been clinically validated.',
    draft: 'Hindi and Odia wording is a draft pending native-speaker review.', allInRange: 'None are marked outside the printed range.',
  },
  hi: {
    title: 'हैंडओवर सारांश', patient: 'मरीज़', ref: 'संदर्भ', ageSex: 'आयु और लिंग', language: 'बोली जाने वाली भाषा', facility: 'सुविधा', made: 'तैयार किया गया',
    complaint: 'मुख्य शिकायत', words: 'मरीज़ के अपने शब्दों में', translation: 'अंग्रेज़ी अनुवाद (मशीन, सत्यापित नहीं)', priority: 'प्राथमिकता', level: 'स्तर', why: 'नियमों द्वारा दिखाए गए कारण',
    signed: 'हस्ताक्षर करने वाले', notSigned: 'अभी हस्ताक्षर नहीं हुए। किसी नर्स या डॉक्टर को इस प्राथमिकता की समीक्षा करनी होगी।', changedTo: 'बदलकर', reason: 'कारण', measurements: 'माप', none: 'कुछ दर्ज नहीं',
    stillAsk: 'खतरे के संकेतों के अधूरे प्रश्न', reports: 'रिपोर्ट के निष्कर्ष, जैसे रिपोर्ट में छपे हैं', unchecked: 'अभी किसी व्यक्ति ने जाँचा नहीं', noReports: 'कोई रिपोर्ट परिणाम नहीं',
    t1: 'तत्काल', t2: 'अत्यंत ज़रूरी', t3: 'ज़रूरी', t4: 'सामान्य', notAssessed: 'आकलन नहीं हुआ',
    note: 'यह समीक्षा के लिए जानकारी को व्यवस्थित करता है। यह निदान या उपचार की सलाह नहीं देता। प्राथमिकता के पीछे के नियम प्रारूप हैं और चिकित्सकीय रूप से मान्य नहीं हैं।',
    draft: 'Hindi and Odia wording is a draft pending native-speaker review.', allInRange: 'कोई भी छपी सीमा से बाहर चिह्नित नहीं है।',
  },
  or: {
    title: 'ହସ୍ତାନ୍ତର ସାରାଂଶ', patient: 'ରୋଗୀ', ref: 'ସନ୍ଦର୍ଭ', ageSex: 'ବୟସ ଓ ଲିଙ୍ଗ', language: 'କହୁଥିବା ଭାଷା', facility: 'ସୁବିଧା କେନ୍ଦ୍ର', made: 'ପ୍ରସ୍ତୁତ',
    complaint: 'ମୁଖ୍ୟ ଅଭିଯୋଗ', words: 'ରୋଗୀଙ୍କ ନିଜ ଶବ୍ଦରେ', translation: 'ଇଂରାଜୀ ଅନୁବାଦ (ମେସିନ୍, ଯାଞ୍ଚ ହୋଇନାହିଁ)', priority: 'ପ୍ରାଥମିକତା', level: 'ସ୍ତର', why: 'ନିୟମ ଦେଖାଇଥିବା କାରଣ',
    signed: 'ଦସ୍ତଖତ କରିଥିବା ବ୍ୟକ୍ତି', notSigned: 'ଏପର୍ଯ୍ୟନ୍ତ ଦସ୍ତଖତ ହୋଇନାହିଁ। ଜଣେ ନର୍ସ କିମ୍ବା ଡାକ୍ତର ଏହି ପ୍ରାଥମିକତା ସମୀକ୍ଷା କରିବେ।', changedTo: 'ବଦଳାଯାଇଛି', reason: 'କାରଣ', measurements: 'ମାପ', none: 'କିଛି ଦର୍ଜ ହୋଇନାହିଁ',
    stillAsk: 'ବିପଦ ସଙ୍କେତର ବାକି ପ୍ରଶ୍ନ', reports: 'ରିପୋର୍ଟର ଫଳାଫଳ, ରିପୋର୍ଟରେ ଛପା ଥିବା ପରି', unchecked: 'ଏପର୍ଯ୍ୟନ୍ତ କେହି ଯାଞ୍ଚ କରିନାହାଁନ୍ତି', noReports: 'କୌଣସି ରିପୋର୍ଟ ଫଳାଫଳ ନାହିଁ',
    t1: 'ତୁରନ୍ତ', t2: 'ଅତି ଜରୁରୀ', t3: 'ଜରୁରୀ', t4: 'ସାଧାରଣ', notAssessed: 'ମୂଲ୍ୟାୟନ ହୋଇନାହିଁ',
    note: 'ଏହା ସମୀକ୍ଷା ପାଇଁ ସୂଚନାକୁ ସଜାଡ଼େ। ଏହା ରୋଗ ନିର୍ଣ୍ଣୟ କିମ୍ବା ଚିକିତ୍ସା ପରାମର୍ଶ ଦିଏ ନାହିଁ। ପ୍ରାଥମିକତା ପଛର ନିୟମ ଏକ ଖସଡ଼ା ଏବଂ ଚିକିତ୍ସାଗତ ଭାବେ ଯାଞ୍ଚ ହୋଇନାହିଁ।',
    draft: 'Hindi and Odia wording is a draft pending native-speaker review.', allInRange: 'କେହି ଛପା ସୀମା ବାହାରେ ଚିହ୍ନିତ ନୁହେଁ।',
  },
};

const URGENCY_TIER: Record<string, 1 | 2 | 3 | 4> = { red: 1, orange: 2, yellow: 3, green: 4 };
const VITAL_LABEL: Record<string, string> = {
  temperature_c: 'Temperature', pulse_bpm: 'Pulse', resp_rate_pm: 'Breathing rate', spo2_pct: 'Oxygen saturation', bp_systolic_mmhg: 'BP systolic', bp_diastolic_mmhg: 'BP diastolic',
  blood_glucose_mgdl: 'Blood glucose', weight_kg: 'Weight',
};

export interface HandoverInput {
  patient: { fullName: string; publicRef: string; sex: string | null; ageText: string };
  facilityName: string | null;
  encounter: { language: string; complaintOriginal: string | null; complaintTranslated: string | null };
  assessment: null | { urgencyCode: string; reasons: string[]; openQuestions: number };
  review: null | { reviewerName: string | null; at: string; fromCode: string | null; toCode: string | null; reason: string | null };
  vitals: { kind: string; value: number | string; unit: string; at: string }[];
  records: ContextDoc[];
  now: Date;
}

export function pickLang(requested: string | undefined, encounterLang: string, patientLang: string | null | undefined): HandoverLang {
  const ok = (l: string | null | undefined): l is HandoverLang => l === 'en' || l === 'hi' || l === 'or';
  if (ok(requested)) return requested;
  if (ok(encounterLang)) return encounterLang;
  if (ok(patientLang)) return patientLang;
  return 'en';
}

const latestVitals = (v: HandoverInput['vitals']) => {
  const by = new Map<string, HandoverInput['vitals'][number]>();
  for (const x of v) { const cur = by.get(x.kind); if (!cur || Date.parse(x.at) >= Date.parse(cur.at)) by.set(x.kind, x); }
  return [...by.values()];
};

export function handoverContent(i: HandoverInput, lang: HandoverLang): NotePdf {
  const t = L[lang];
  const tierName = (code: string | null | undefined) => { const n = code ? URGENCY_TIER[code] : undefined; return n ? t[`t${n}`]! : t.notAssessed!; };
  const sections: NotePdf['sections'] = [];

  sections.push({ title: t.complaint!, lines: [
    ...(i.encounter.complaintOriginal ? [`${t.words}: ${i.encounter.complaintOriginal}`] : [t.none!]),
    ...(i.encounter.complaintTranslated && i.encounter.complaintTranslated !== i.encounter.complaintOriginal ? [`${t.translation}: ${i.encounter.complaintTranslated}`] : []),
  ] });

  const pr: string[] = [`${t.level}: ${tierName(i.assessment?.urgencyCode)}`];
  for (const r of (i.assessment?.reasons ?? []).slice(0, 8)) pr.push(`• ${r}`);
  if (i.assessment && i.assessment.openQuestions > 0) pr.push(`${t.stillAsk}: ${i.assessment.openQuestions}`);
  if (i.review) {
    const changed = i.review.toCode && i.review.fromCode && i.review.toCode !== i.review.fromCode;
    pr.push(`${t.signed}: ${i.review.reviewerName ?? '—'}, ${i.review.at.slice(0, 16).replace('T', ' ')}${changed ? ` (${tierName(i.review.fromCode)} → ${t.changedTo} ${tierName(i.review.toCode)})` : ''}`);
    if (changed && i.review.reason) pr.push(`${t.reason}: ${i.review.reason}`);
  } else pr.push(t.notSigned!);
  sections.push({ title: t.priority!, lines: pr });

  const vs = latestVitals(i.vitals);
  sections.push({ title: t.measurements!, lines: vs.length ? vs.map(v => `${VITAL_LABEL[v.kind] ?? v.kind}: ${v.value} ${v.unit}`.trim()) : [t.none!] });

  const rows = i.records.flatMap(d => d.fields);
  const flagged = rows.filter(f => flagText(f.printedFlag));
  const line = (f: (typeof rows)[number]) => `• ${f.name.replace(/_/g, ' ')} ${f.valueText ?? f.valueNum ?? '?'}${f.unit ? ' ' + f.unit : ''} (${flagText(f.printedFlag)}${f.verified ? '' : `, ${t.unchecked}`})`;
  sections.push({ title: t.reports!, lines: rows.length === 0 ? [t.noReports!] : flagged.length ? flagged.slice(0, 15).map(line) : [`${rows.length} · ${t.allInRange}`] });

  return {
    title: t.title!,
    headerLines: [
      `${t.patient}: ${i.patient.fullName}`, `${t.ref}: ${i.patient.publicRef}`, `${t.ageSex}: ${i.patient.ageText}`,
      ...(i.facilityName ? [`${t.facility}: ${i.facilityName}`] : []), `${t.made}: ${i.now.toISOString().slice(0, 16).replace('T', ' ')}`,
    ],
    sections: [...sections, { title: '', lines: [t.note!, ...(lang === 'en' ? [] : [t.draft!])] }],
  };
}
