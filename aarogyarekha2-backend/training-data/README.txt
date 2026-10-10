Anonymised triage training cases. Synthetic or consented data only.

triage-cases.jsonl  one case per line: features, the engine output, the clinician-confirmed priority, and a de-identified FHIR R4 bundle.
triage-cases.csv    the same cases as one flat row each.
.pseudonym-key      secret used to make case and clinician ids. Never commit or share it. Deleting it makes new ids unlinkable to old ones.

A case is written only after a nurse or doctor signs off, and only when the patient agreed to an anonymous copy being used to train the triage tool.
Names, phone numbers, addresses, dates, facility names and clinician names are removed or replaced.
Do not commit .pseudonym-key. The cases themselves are anonymised and can be shared.
