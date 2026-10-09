export type Severity = 'block' | 'warn';
export interface Finding { rule: string; severity: Severity; match: string }
export interface GuardResult { allowed: boolean; findings: Finding[] }

const DISEASES = [
  'dengue', 'malaria', 'typhoid', 'tuberculosis', 'tb', 'covid(?:-19)?', 'pneumonia', 'asthma', 'diabetes',
  'hypertension', 'anaemia', 'anemia', 'jaundice', 'hepatitis', 'cholera', 'meningitis', 'sepsis', 'appendicitis',
  'cancer', 'stroke', 'heart attack', 'myocardial infarction', 'pre-?eclampsia', 'eclampsia', 'gastroenteritis',
  'chikungunya', 'leptospirosis', 'influenza', 'bronchitis', 'uti', 'kidney failure', 'heart failure',
].join('|');
const DRUGS = [
  'paracetamol', 'acetaminophen', 'ibuprofen', 'aspirin', 'amoxicillin', 'azithromycin', 'ciprofloxacin',
  'doxycycline', 'metformin', 'insulin', 'ors', 'artemether', 'chloroquine', 'antibiotics?', 'antimalarials?',
  'steroids?', 'prednisolone', 'diclofenac', 'pantoprazole', 'ondansetron', 'salbutamol', 'iron tablets?',
].join('|');

interface Rule { id: string; severity: Severity; re: RegExp }

const RULES: Rule[] = [
  { id: 'D1-diagnosis-word', severity: 'block',
    re: /\b(diagnos(?:is|ed|e|ing)|differential|working diagnosis|provisional diagnosis)\b/i },
  { id: 'D2-suffering-from', severity: 'block',
    re: /\b(suffers?|suffering) from\b|\b(is|was|being) found to have\b/i },
  { id: 'D3-suggests-condition', severity: 'block',
    re: new RegExp(`\\b(consistent with|indicative of|suggestive of|suggests?|points? to|rule(?:s)? out|likely|probably|possibly|suspected|suspicious for)\\b[^.]{0,40}\\b(${DISEASES})\\b`, 'i') },
  { id: 'D4-has-condition', severity: 'block',
    re: new RegExp(`\\b(?:patient|he|she|they|you)\\s+(?:has|have|had|is having)\\s+(?:a |an )?(?:${DISEASES})\\b`, 'i') },
  { id: 'D5-this-is-condition', severity: 'block',
    re: new RegExp(`\\b(?:this|it|that|these)\\s+(?:is|are|looks? like|seems?(?: to be| like)?|appears? to be|could be|might be|may be)\\s+(?:a |an |the )?(?:${DISEASES})\\b`, 'i') },
  { id: 'T1-dose', severity: 'block',
    re: /\b\d+(?:\.\d+)?\s?(?:mg|mcg|µg|ml|iu|units?|tablets?|tabs?|capsules?|caps|drops?|puffs?)\b/i },
  { id: 'T2-prescribe', severity: 'block',
    re: /\b(prescrib\w*|administer\w*|dispens\w*|put (?:him|her|them) on|start (?:on|taking|with)|should (?:take|be given|receive|start)|needs? to (?:take|start)|must take|give (?:him|her|them|the patient)\b)/i },
  { id: 'T5-treatment-order', severity: 'block',
    re: new RegExp(`\\b(?:start|begin|take|give|use|try|get|buy)\\s+(?:(?:the|some|an?|oral|iv|more)\\s+)?(?:${DRUGS})\\b`, 'i') },
  { id: 'T3-recommend-treatment', severity: 'block',
    re: /\brecommend(?:ed|s|ing)?\b[^.]{0,30}\b(treatment|therapy|medication|medicine|drugs?|antibiotics?|surgery|operation)\b/i },
  { id: 'T4-treatment-plan', severity: 'block',
    re: /\b(treatment plan|course of (?:treatment|antibiotics|medication)|regimen|home remedy|home remedies)\b/i },
  { id: 'W1-disease-mention', severity: 'warn', re: new RegExp(`\\b(${DISEASES})\\b`, 'i') },
  { id: 'W2-drug-mention', severity: 'warn', re: new RegExp(`\\b(${DRUGS})\\b`, 'i') },
];

export function checkNonDiagnostic(text: string): GuardResult {
  const findings: Finding[] = [];
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) findings.push({ rule: r.id, severity: r.severity, match: m[0] });
  }
  return { allowed: !findings.some(f => f.severity === 'block'), findings };
}

export class NonDiagnosticViolation extends Error {
  constructor(public readonly findings: Finding[]) {
    super(`AI output rejected by non-diagnostic guard: ${findings.filter(f => f.severity === 'block').map(f => f.rule).join(', ')}`);
  }
}
export function assertNonDiagnostic(text: string): string {
  const r = checkNonDiagnostic(text);
  if (!r.allowed) throw new NonDiagnosticViolation(r.findings);
  return text;
}

export function assertNoteNonDiagnostic(value: unknown, path = '$'): void {
  if (typeof value === 'string') {
    const r = checkNonDiagnostic(value);
    if (!r.allowed) throw new NonDiagnosticViolation(r.findings.map(f => ({ ...f, rule: `${f.rule}@${path}` })));
  } else if (Array.isArray(value)) value.forEach((v, i) => assertNoteNonDiagnostic(v, `${path}[${i}]`));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) assertNoteNonDiagnostic(v, `${path}.${k}`);
}
