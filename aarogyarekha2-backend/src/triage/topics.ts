export interface Topic { id: string; label: string; test: RegExp; signs: string[] }

export const TOPICS: Topic[] = [
  { id: 'breathing_chest', label: 'Breathing, chest or heart', test: /\b(breath|breathless|cough|wheez|asthma|chest|palpit|heart|sob|gasp|choking)/i,
    signs: ['breathing_difficulty_not_severe', 'chest_pain', 'serious_chest_pain', 'severe_palpitations', 'severe_flu_or_coughing_blood', 'breathing_difficulty_pregnancy'] },
  { id: 'abdomen_gi', label: 'Stomach, vomiting or loose stools', test: /\b(stomach|abdom|belly|tummy|vomit|nausea|diarrh|loose\s*(stool|motion)|dysentery|gastro|cramp|colic)/i,
    signs: ['sudden_severe_abdominal_or_back_pain', 'severe_abdominal_pain', 'severe_fluid_loss_signs', 'persistent_vomiting', 'vomiting_blood', 'adult_vomiting_diarrhoea_over_3_days', 'young_or_older_unwell_over_2_days', 'adult_severe_pain', 'severe_pain'] },
  { id: 'head_neuro', label: 'Head, nerves, fits or faints', test: /\b(head|migraine|dizz|giddy|faint|collaps|seiz|fit|fits|convuls|weak|numb|paraly|vision|blurr|speech|confus|drows|neck\b)/i,
    signs: ['unusual_severe_headache', 'stiff_neck_with_fever', 'possible_meningitis_concern', 'sudden_weakness_or_numbness', 'sudden_confusion_or_speech_difficulty', 'sudden_vision_change', 'fainting_or_sudden_collapse', 'first_or_repeated_seizures', 'recent_fit_now_over', 'head_injury_with_warning_signs', 'restless_or_irritable'] },
  { id: 'fever_infection', label: 'Fever, rash or infection', test: /\b(fever|bukhar|temperature|chill|rigor|rash|infect|flu\b|cold\b|measles|dengue|malaria|typhoid)/i,
    signs: ['very_high_fever_child', 'stiff_neck_with_fever', 'high_fever_despite_medicine', 'fever_in_pregnancy', 'fever_in_young_infant', 'tiny_infant_under_2_months', 'sudden_rash', 'severe_flu_or_coughing_blood', 'possible_meningitis_concern', 'young_or_older_unwell_over_2_days', 'carer_very_worried'] },
  { id: 'injury', label: 'Injury, bleeding or burns', test: /\b(injur|fall\b|fell|accident|crash|cut\b|wound|burn|scald|fractur|broke|bite|sting|bleed|blood|hit\b|stab|shot|bruise|sprain|swollen)/i,
    signs: ['major_trauma_or_burns', 'adult_major_trauma_or_burns', 'weapon_injury', 'serious_accident_or_big_fall', 'severe_burn', 'burn_to_face_or_genitals', 'wound_with_exposed_tissue_or_numbness', 'deep_cut_needing_stitches', 'wound_not_controlled', 'deformed_bone_or_joint', 'object_stuck_in_body', 'object_stuck_in_eye', 'eye_injury', 'suspected_spinal_injury', 'fall_in_older_person', 'head_injury_with_warning_signs', 'limb_injury_warning_signs', 'back_pain_with_nerve_signs', 'severe_bleeding', 'venomous_bite_or_sting', 'suspected_severe_allergy', 'post_operative_bleeding'] },
  { id: 'poison_mental', label: 'Poison, overdose or mental health', test: /\b(poison|overdos|pesticide|swallow|suicid|self[- ]?harm|anxi|depress|panic|stress|mental|hopeless|kill)/i,
    signs: ['poisoning_reported', 'adult_poisoning_reported', 'overdose_poisoning_or_self_harm', 'mental_health_crisis'] },
  { id: 'urinary_genital', label: 'Urine or private parts', test: /\b(urin|pee\b|passing\s*water|testic|genital|burning\s*(while|when)|kidney)/i,
    signs: ['unable_to_pass_urine', 'child_not_passing_urine', 'severe_testicular_pain'] },
  { id: 'eye_ear', label: 'Eyes or ears', test: /\b(eye|vision|sight|ear\b|hearing)/i,
    signs: ['sudden_vision_change', 'eye_injury', 'object_stuck_in_eye'] },
  { id: 'skin_allergy', label: 'Skin or allergy', test: /\b(rash|itch|hives|allerg|swelling|swollen\s*(face|lip|tongue|throat))/i,
    signs: ['sudden_rash', 'suspected_severe_allergy'] },
  { id: 'limbs', label: 'Arms, legs or joints', test: /\b(leg|arm\b|limb|joint|knee|ankle|foot|feet|hand|shoulder|hip|back\s*pain)/i,
    signs: ['limb_pain_without_injury', 'swollen_limb', 'swelling_both_feet', 'limb_injury_warning_signs', 'deformed_bone_or_joint', 'back_pain_with_nerve_signs'] },
  { id: 'medicine', label: 'Medicines and test results', test: /\b(medicine|tablet|dose|drug|pill|prescription|reaction|allergic|report|result|test\b)/i,
    signs: ['medicine_reaction', 'missed_or_run_out_medicine', 'urgent_test_result'] },
  { id: 'child_general', label: 'Child looks unwell', test: /\b(child|baby|infant|toddler|son\b|daughter|not\s*(eating|feeding|drinking)|crying|irritable)/i,
    signs: ['restless_or_irritable', 'severe_pallor', 'severe_visible_wasting', 'swelling_both_feet', 'breathing_difficulty_not_severe', 'poisoning_reported', 'severe_pain', 'urgent_referral_in', 'carer_very_worried', 'child_not_passing_urine'] },
];

export const PREGNANCY_SIGNS = ['severe_abdominal_pain', 'reduced_fetal_movement', 'leaking_fluid_or_labour_pains', 'fever_in_pregnancy', 'breathing_difficulty_pregnancy', 'any_vaginal_bleeding', 'pain_in_pregnancy'];

export function topicSigns(words: string, pregnant: boolean): string[] {
  const out = new Set<string>();
  for (const t of TOPICS) if (t.test.test(words)) for (const s of t.signs) out.add(s);
  if (pregnant) for (const s of PREGNANCY_SIGNS) out.add(s);
  return [...out];
}
