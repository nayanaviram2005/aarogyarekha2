# Supabase schema design (Phase 2 deliverable)

Design of the target persistence layer that replaces the legacy MongoDB data model audited in
[`../AUDIT_AAROGYAREKHA.md`](../AUDIT_AAROGYAREKHA.md). **Schema design only** — no application logic,
no data migration, and nothing has been applied to a Supabase project yet.

```
supabase/
  migrations/   11 ordered SQL files (apply with `supabase db push`, or in filename order)
  tests/        validate.mjs — runs every migration in an in-process Postgres and asserts 99 behaviours
  README.md     this file
```

Run the checks: `cd supabase/tests && npm install && npm test`.

## What was verified, and what was not

| Verified (executed, 99 assertions pass) | Not verified |
|---|---|
| All migrations apply cleanly in order (Postgres 18 via PGlite) | Behaviour on a **real Supabase project**: PostgREST, GoTrue JWTs, Storage API, Realtime. `auth`/`storage`/roles are **stubbed** in the harness |
| RLS visibility matrix across 8 personas (worker, doctor, other-facility doctor, facility admin, platform admin, patient, anon, no-membership user) | Performance at scale (policies call helper functions; indexes exist but no load test) |
| Column-level privileges, CHECK constraints, append-only triggers, referral state machine, audit hash chain + tamper detection, erasure routine, break-glass | Whether Supabase's own default privileges for `supabase_admin` need further tightening (see 0011 note) |
| Storage policies (via the `documents` row; only `clean` files readable) | Anything involving the data to be migrated (no live DB access yet) |

One real bug was found *by* the harness and fixed: `INSERT … RETURNING` (what `supabase-js` `.insert().select()`
issues) failed the SELECT policy because the helper re-queried a row not yet visible. Policies now check
row-local conditions first.

## Assumptions I made (change any of these cheaply)

Nothing below was specified. Each is a default so the schema could be built; all are reversible.

| # | Assumption | Where it lives |
|---|---|---|
| A1 | **Multi-facility from day one** (facility = tenant + referral directory) | `facilities`, `memberships` |
| A2 | Patients are mostly **staff-registered**; self-service is optional via `patients.user_id` | `patients` |
| A3 | **`facility_admin` and platform admins have no patient-data access** (legacy admins saw everything) | `app.can_access_*` |
| A4 | Urgency scale is **data, not an enum**; 4 placeholder levels seeded (`red/orange/yellow/green`). Replace when the approved algorithm arrives — no DDL needed | `urgency_levels` |
| A5 | Triage is **algorithm-agnostic**: assessments reference a versioned, *approved* rule set | `triage_rule_sets`, `triage_assessments` |
| A6 | External AI (DXGPT) receives **de-identified** payloads only, needs a live consent, and **raw output is not stored** — only sanitised, non-diagnostic features | `external_signal_runs` |
| A7 | **No Aadhaar numbers** are stored; ABHA is an optional identifier | `patient_identifiers.system` CHECK |
| A8 | FHIR via **relational canonical store + FHIR projection**; the sent referral Bundle is frozen as JSONB | `referrals.bundle` |
| A9 | Membership read from the table per request (not JWT claims) so **revocation is immediate** | `app.has_role_at` |
| A10 | Legacy passwords are **not migrated** (many are double-hashed, see audit E-01); users are re-invited / forced to reset | `profiles.credential_reset_required` |

## Model overview

| Domain | Tables | Notes |
|---|---|---|
| Tenancy & identity | `facilities`, `facility_capabilities`, `platform_admins`, `profiles`, `memberships` | Credentials live **only** in `auth.users` |
| Patients | `patients`, `patient_identifiers`, `health_card_tokens`, `reported_history`, `pregnancy_episodes` | QR = opaque token, **hash stored** (legacy QR embedded the raw patient id) |
| Consent & access | `consents`, `access_grants`, `break_glass_grants`, `erasure_requests` | Replaces `Record.sharedWith` (no expiry/revoke/enforced level) |
| Intake | `encounters`, `symptom_entries`, `vitals`, `info_requests` | `scenario` + `group_ref` cover OPD / campus clusters / camps / occupational / maternal / chronic |
| Documents | `documents`, `extractions`, `extracted_fields` | `printed_flag` = what the *report* says; never interpreted. `extracted_value_text` (OCR) kept separate from verified `value_text` |
| Triage | `urgency_levels`, `triage_rule_sets`, `triage_assessments`, `triage_signals`, `external_signal_runs`, `queue_items`, `review_actions` | Assessments/signals/runs/actions are **append-only**. Humans act via `review_actions`; override requires a reason |
| Referral | `referrals`, `referral_events`, `referral_documents` | FHIR `ServiceRequest` (+`Task` for status); priority = FHIR request-priority |
| Follow-up | `followup_schedules`, `reminders` | Reminders require a `reminders` consent |
| Governance | `audit_events`, `legacy_id_map` | Hash-chained audit log; id map is a temporary migration aid |

**Non-diagnostic by construction.** There is no `diagnosis` column anywhere. History is *reported* (confirmable by a
reviewer), report flags are *as printed*, signals use coded `signal_code` + non-diagnostic display text, referral
reasons are *clinician-authored*. A schema cannot police free text, so the **API-tier output guard** (Phase 4)
remains mandatory; the DB provides the structure that makes that guard enforceable and testable.

## Access model (enforced by RLS, not by the UI)

| Persona | Patients | Encounters | Triage / queue | Referrals | Audit |
|---|---|---|---|---|---|
| `health_worker` | own facility | own facility | read | own facility | – |
| `nurse` / `doctor` / `medical_officer` | own facility | own facility | read + review/override + refer | send & receive | – |
| `facility_admin` | **none** | **none** | **none** | **none** | own facility (ids only) |
| platform admin | **none** | **none** | **none** | **none** | all (ids only) |
| patient (self-service) | self | self | **none** | own (once sent) | own record |
| Receiving facility | after referral sent | the referred encounter | read | accept/reject/progress/complete | – |
| Other clinician | via **access grant** (needs `referral_sharing` consent, expiring) or **break-glass** (reason, 1h default, auto-audited, reviewed by admin) | | | | |

System-authored rows (assessments, signals, external runs, queue inserts, reminders, health-card tokens, scan
results) are written **only by `service_role`**. Clients cannot set `scan_status`, `patients.user_id`,
`profiles.credential_reset_required`, `referrals.requested_by` etc. (column-level grants, tested).

## Legacy MongoDB → Supabase mapping

| Mongo | Supabase | Transformation |
|---|---|---|
| `users` (role=patient) | `auth.users`* + `patients` | `profile.*` → columns; `emergencyContact` → [OPEN: table or `reported_history`]; `bloodGroup` → `reported_history` (unverified); `healthCardQR` **dropped** (re-issue as `health_card_tokens`) |
| `users` (role=doctor/admin) | `auth.users` + `profiles` + `memberships` | `assignedId` → login handle in Auth; role → `memberships.role` (+ facility); `licenseNumber` → `registration_no` |
| `users.password`, OTP/reset fields | **dropped** | Auth owns credentials; set `credential_reset_required` |
| `records` | `documents` + Storage object | local `filePath` → storage key `{facility}/{patient}/{doc}.{ext}`; `type` → `document_kind`; `scan_status='pending'` until rescanned; `doctorNotes` → [OPEN] |
| `records.sharedWith[]` | `consents` + `access_grants` | each share needs a backdated consent record [OPEN: legal basis for historic shares]; no expiry existed → assign one |
| `healthrecords`, GridFS | merge into `documents` | likely empty/test — **confirm against the live DB** |
| ObjectIds | UUIDs | `legacy_id_map(legacy_collection, legacy_id, new_table, new_id)` |

\* Supabase Auth can import bcrypt hashes, but **do not** import: legacy hashes may be double-hashed and the
accounts may be test data. Force reset instead.

## How this closes audit findings

| Audit finding | Design response |
|---|---|
| S-01/S-02 hardcoded OTPs, S-10 operator injection | No custom auth: Supabase Auth; typed columns + parameterised PostgREST; no `$ne` surface |
| S-03 command-exec endpoint | No such surface; admin role has no data/exec access |
| S-06 doctor IDOR, S-07 FHIR over-exposure | Row-level policies by facility/relationship; admins see no PHI |
| S-12 no audit trail | Hash-chained `audit_events` + DB triggers on sensitive writes + `write_audit()` for reads (API tier) |
| S-14 weak uploads | Path CHECK (no traversal), MIME + size CHECK, `pending→clean` gate, private bucket |
| S-13 PHI to third party | `external_signal_runs`: consent FK + `deidentified` CHECK + no raw output stored |
| H-1 non-unique email/phone, H-6 dangling refs | Uniqueness in Auth; FKs `ON DELETE RESTRICT` everywhere |
| H-8 no retention/erasure | `retention_until`, `erasure_requests`, `app.erase_patient()` (scrub, keep structure) |
| E-01 double hashing, E-03 `$or` with undefined, E-04 silent profile no-op | Eliminated by construction (no app-side hashing; typed columns; column grants error loudly) |
| I (FHIR) fake SMART claims, no referral | Real referral state machine + frozen Bundle; SMART not claimed |
| Two record models | Single `documents` table |

## Known limitations & design trade-offs

1. **Postgres cannot audit SELECTs.** Reads of PHI must be logged by the API tier via `app.write_audit()`.
   DB triggers cover writes and security events only.
2. **Audit chain is one global chain** serialised by an advisory lock. Fine at clinic scale; shard by day/facility if write volume grows.
3. **Erasure vs retention.** `app.erase_patient()` scrubs rather than deletes (keeps FK integrity and the audit chain), refuses unless the request is `pending`, and cannot recall copies already delivered to a receiving facility. Statutory retention periods are undefined, so **no default `retention_until`** is set.
4. **Patient deduplication across facilities is not solved.** A migrant registered at facility A who visits camp B would be re-registered unless B uses a grant/break-glass/card-token flow. Needs a product decision (below).
5. **Self-service intake** by patients is intentionally **not** exposed through RLS (a patient could target any facility). Route through the API tier.
6. Policies call `SECURITY DEFINER` helpers per row. They are `STABLE` and indexed, but should be load-tested before large camps (batch screening).
7. Storage deletion is a service action: the erasure routine returns object paths; the API tier must delete them.

## Open decisions that affect this schema

1. **Triage algorithm & urgency scale** (A4/A5) — replace `urgency_levels` seed; load an approved `triage_rule_sets` row.
2. **DXGPT policy** (A6) — may disease names be retained internally? If not, `sanitized_output` stays features-only (current).
3. **Cross-facility patient identity** — ABHA-based linking? shared patient index? (limitation 4).
4. **Retention periods & legal-hold process** (limitation 3).
5. **FHIR profile** — ABDM/NRCeS? Terminology (SNOMED licence) → `symptom_entries.code_system`, `referrals.reason_*`.
6. **`emergencyContact`, `doctorNotes`, `bloodGroup`** — where do they belong (A2 data minimisation)? Defaults above are placeholders.
7. **Supabase region and plan** (India region; PITR/backup tier) and whether pgsodium/Vault column encryption is needed for `phone`/identifiers.
8. **Facility registry codes** (`facilities.code`) — HFR or other source of truth.
