// Build-time switches that exist for honesty, not for features.

/** Shows the black "hackathon prototype" bar on every screen. Set to false only for a deployment that has been validated. */
export const SHOW_HACKATHON_BAR = true;

/**
 * Has a qualified clinician verified the triage rules against the primary protocols and approved them for real patients?
 * Keep this false until that has actually happened. It is shown next to the rules on every assessment.
 */
export const RULES_CLINICALLY_VALIDATED = false;

/**
 * Warns that the server may be far away, so actions such as triage can take several seconds. Set to false once the API runs close to its users.
 * It is shown above the sign-in card and as a sliding strip on every other page.
 */
export const SHOW_SLOW_SERVER_NOTICE = true;
export const SLOW_SERVER_MESSAGE = 'Notice: actions such as triage, saving and reading reports can take several seconds, because the backend is running on a server far from you. Please wait and do not tap again.';
export const SLOW_SERVER_SHORT = 'Actions such as triage, saving and reading reports can take several seconds, because the backend is running on a server far from you. Please wait and do not tap again.';

export const HACKATHON_MESSAGE =
  'HACKATHON PROTOTYPE  ·  BPUT Hackathon 2026  ·  Synthetic data only  ·  ' +
  'Triage rules are transcribed from published protocols and have NOT been clinically validated  ·  ' +
  'Does not diagnose or advise treatment  ·  Not for use with real patients';
