// Build-time switches that exist for honesty, not for features.

/** Shows the black "hackathon prototype" bar on every screen. Set to false only for a deployment that has been validated. */
export const SHOW_HACKATHON_BAR = true;

/**
 * Has a qualified clinician verified the triage rules against the primary protocols and approved them for real patients?
 * Keep this false until that has actually happened. It is shown next to the rules on every assessment.
 */
export const RULES_CLINICALLY_VALIDATED = false;

export const HACKATHON_MESSAGE =
  'HACKATHON PROTOTYPE  ·  BPUT Hackathon 2026  ·  Synthetic data only  ·  ' +
  'Triage rules are transcribed from published protocols and have NOT been clinically validated  ·  ' +
  'Does not diagnose or advise treatment  ·  Not for use with real patients';
