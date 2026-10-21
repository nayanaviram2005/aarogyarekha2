export interface SpokenLanguage { code: string; label: string }

export const SPOKEN_LANGUAGES: SpokenLanguage[] = [
  { code: 'auto', label: 'Detect automatically' },
  { code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'or', label: 'Odia' },
  { code: 'as', label: 'Assamese' }, { code: 'bn', label: 'Bengali' }, { code: 'brx', label: 'Bodo' }, { code: 'doi', label: 'Dogri' },
  { code: 'gu', label: 'Gujarati' }, { code: 'kn', label: 'Kannada' }, { code: 'ks', label: 'Kashmiri' }, { code: 'kok', label: 'Konkani' },
  { code: 'mai', label: 'Maithili' }, { code: 'ml', label: 'Malayalam' }, { code: 'mni', label: 'Manipuri' }, { code: 'mr', label: 'Marathi' },
  { code: 'ne', label: 'Nepali' }, { code: 'pa', label: 'Punjabi' }, { code: 'sa', label: 'Sanskrit' }, { code: 'sat', label: 'Santali' },
  { code: 'sd', label: 'Sindhi' }, { code: 'ta', label: 'Tamil' }, { code: 'te', label: 'Telugu' }, { code: 'ur', label: 'Urdu' },
];

export const spokenLabel = (code: string): string => SPOKEN_LANGUAGES.find(l => l.code === code)?.label ?? code;
