# AarogyaRekha — Pre-Implementation Technical Audit

**Audited path:** `C:\Users\NAYANAVIRAM\Desktop\New folder\others\aarogyarekha` (Node/Express + Mongoose backend, React/Vite frontend)
**Not audited:** `#unused-aarogyarekha-agy-generated` in this working directory — a different, Python/SQLite codebase.
**Audit mode:** analysis only. No audited file was modified, deleted, renamed or installed. The only things created were this report and one throwaway verification script in the system temp dir.

## Evidence legend and limits

| Tag | Meaning |
|---|---|
| **[V]** | Verified by executing a read-only, in-memory script against the real models (no DB connection, no writes), or by running `npm audit` / `npm ls` |
| **[T]** | Traced by reading the code path (including the require graph) |
| **[U]** | Cannot be determined from the codebase — needs a decision or access |

**Not done, and why:**
- The live MongoDB (a remote Atlas cluster per `.env`) was **not connected to**, so real collections, document counts, indexes actually built, backups and encryption settings are **[U]**.
- The server and frontend were **not run end to end**. Doing so would connect to that remote DB and, for the AI feature, send data to a third party.
- The DXGPT API was not called. Key validity, terms and data-handling are **[U]**.
- Secret values were never printed. Only their shape was checked.
- Dead controllers (about 2,000 lines) were skimmed, not exhaustively audited. Frontend pages were reviewed for API contracts, auth handling and security-relevant patterns, not line-by-line UI logic.
- FHIR output was **not** run through the HL7 validator.

---

## A. Current architecture (as the code actually behaves)

**What it is:** a patient-held medical-document vault ("Statewide Migrant Healthcare Records Management System") with three roles (patient, doctor, admin) plus a doctor-only DXGPT "AI Copilot". It is **not** a triage system. A grep for `triage`, `referral`, `ServiceRequest`, queue/priority logic and Supabase finds **nothing**.

**Stack:** Express 4 + Mongoose 7 (CommonJS) · React 18 + Vite + Zustand + Tailwind · no git repo · no tests (jest declared, zero test files) · no Docker/CI/deploy config · no `.env.example`.

**Live API surface (mounted in `server.js`)**
- `/api/auth` → `authRoutes.js`
- `/api/patient` → `patientRoutes.js`
- `/api/doctor` → `doctorRoutes.js`
- `/api/admin` → `adminRoutes.js`
- `/api/public` → `publicRoutes.js`
- `/api/ai-diagnosis` → `aiDiagnosisRoutes.js`
- `/fhir` → `fhirRoutes.js` (read-only)

**Dead code (never mounted or required by live code) [T]:**
- `routes/auth.routes.js`, `routes/admin.routes.js`, `routes/patient.routes.js`
- `controllers/{auth,admin,patient}.controller.js`
- `config/gridfs.js`, `config/passport.js` (required, but passport is never initialised)
- `utils/sms.js` (Twilio; only required by a dead controller)
- Model `HealthRecord`'s only live consumer is `fhirRoutes`
- Roughly 15 loose scripts (`fix-*.js`, `debug-*.js`, `seed-admin.js`, `create-test-data.js`, `test-*.ps1`), plus `backend/backend/fix-admin.js` and `frontend/.../Landing_backup.jsx`

**Data path**
- Users and file metadata are stored in MongoDB.
- Uploaded files are stored on the **server's local disk** at `backend/uploads/<userId>/`, with the absolute path saved in the DB.
- The GridFS bucket is initialised at boot but no live route uses it.
- Two PDFs are present in `backend/uploads/`.

**External integrations**

| Integration | Live? |
|---|---|
| DXGPT (Azure APIM) | Live, doctor-only |
| Twilio SMS | Dead path |
| Google OAuth | Dead and broken |

**Critical architectural fact:** the live app writes uploads to the **`Record`** model. The FHIR API reads the **`HealthRecord`** model. Nothing live writes `HealthRecord`, so `/fhir/DocumentReference` and `$everything` return **no documents** for anything uploaded through the app [T].

---

## B. Feature inventory and classification

| # | Feature | Real status | Class | Justification |
|---|---|---|---|---|
| 1 | Patient registration | Broken: stored password is double-hashed [V]; duplicate check misbehaves | REBUILD | Route hashes, then the model `pre('save')` hashes again. Replaced by Supabase Auth |
| 2 | Password login (patient/doctor/admin) | Works only for accounts created via scripts that pass plaintext to the model [V] | REBUILD | Same defect; plus no lockout, no MFA |
| 3 | Phone-OTP login | **Simulated.** Accepts hardcoded `123456` for any phone; no SMS sent | REMOVE | Authentication bypass |
| 4 | Forgot / reset password | **Simulated.** Hardcoded `654321`, returned in the response (`devOTP`); resets any role by email | REMOVE | Account-takeover primitive |
| 5 | Google OAuth | Dead and broken: passport never initialised; new users fail validation (`password` required) [V] | REMOVE | Use a Supabase provider if wanted |
| 6 | QR health-card login | Works [T]; QR holds a raw patient ID; unauthenticated `/qr-info` leaks name and email | REBUILD | Needs a signed, rotating, scoped token |
| 7 | JWT middleware / RBAC | Roles checked server-side [T]; but two middlewares, two token payload shapes, no revocation, no care-relationship checks | REBUILD | Replace with Supabase JWT + Row Level Security |
| 8 | Patient upload / preview / download | Works [T]; type check is by extension + client MIME only; local disk | REBUILD | Supabase Storage, magic-byte check, AV scan, signed URLs |
| 9 | Patient → doctor sharing | Partly works; no revoke, no expiry, `accessLevel` never enforced | REBUILD | Becomes a consent model |
| 10 | Admin share-with-doctor | **Broken** [V]: writes `userId/permission` into a schema that has `doctorId/accessLevel` | REMOVE | Wrong model |
| 11 | Admin "shareable link" | **Fake** [V]: `shareToken` is not in the schema, never persisted, and no consuming route exists | REMOVE | |
| 12 | Doctor patient list | Works via sharedWith [T] | MODIFY | Reuse the idea, not the code |
| 13 | Doctor `GET /patients/:id` | **IDOR**: any doctor can fetch any user's document minus password hash | REBUILD | |
| 14 | Doctor stats / appointments | Placeholders; `reviewed` field doesn't exist [V] | REMOVE | Appointments are out of scope |
| 15 | Patient profile update | **No-op for profile fields** [V]: writes top-level `firstName` etc.; schema only has `profile.*` | REBUILD | |
| 16 | Doctor profile update | Overwrites the whole `profile` subdocument [T] (data-loss risk) | REBUILD | |
| 17 | Health-card QR generation | Works; stores a base64 PNG inside the user document | REBUILD | |
| 18 | Admin user management | Works except the hash defect; hard-deletes doctors; no audit | MODIFY | |
| 19 | Admin QR patient lookup | **Broken** for email/phone/assignedId: `_id` CastError [V] | REBUILD | |
| 20 | Admin Technical Dashboard | `db-status` and `system-stats` real; `api-health`, `error-logs`, `performance-metrics`, `user-sessions` **fabricated** (random or hardcoded) [T] | REMOVE | Mock data presented as live |
| 21 | Admin `execute-command` | Shell execution behind a `startsWith` allowlist | **REMOVE (stop-ship)** | See S-03 |
| 22 | Public stats | "Uptime" is `Math.random()`-based and hardcoded `99.9%`; `/stats/detailed` is unauthenticated | REMOVE | |
| 23 | DXGPT service + AI Copilot | Functional wrapper [T]; **diagnosis-shaped** end to end | REBUILD (isolate) | See DXGPT section below |
| 24 | PDF "diagnosis report" (frontend) | Renders approved and denied diagnoses plus "final diagnosis / treatment plan" | REMOVE | Conflicts with the non-diagnostic rule. (`pdfService.js` skimmed, not fully read) |
| 25 | FHIR read API | Resembles FHIR, partly wrong, wired to a collection nothing writes | REBUILD | See section I |
| 26 | Security middleware (helmet, rate limit, CORS) | Present but minimal and misconfigured | MODIFY | |
| 27 | Frontend shell (routing, layouts, theme, toasts, Zustand) | Reusable skeleton; two duplicated axios clients; stale endpoint config | MODIFY | |
| 28 | Frontend `config/api.js` endpoints | Mostly point at the **unmounted** backend routes | REBUILD | |
| 29 | `statsCache` | Process-local cache with model-layer side effects | REMOVE | |
| 30 | Dead routes/controllers, `HealthRecord`, GridFS, scripts, `TEST_CREDENTIALS.txt` | Dead or hazardous | REMOVE | Keep `HealthRecord`'s access-log, archive and revoke ideas as design input |
| 31 | Landing page | Claims "bank-level encryption", "99.9% uptime" — unsupported [T] | MODIFY | |

**Nothing qualifies for KEEP as-is.** The closest are the bcrypt library choice and the helmet/CORS posture, and both still need changes.

### DXGPT disposition (item 3 of the brief)

**What exists:** `services/dxgptService.js` → `POST {APIM}/diagnose` with free-text `description`, optional `diseases_list` (an exclusion list), model `gpt4o`/`o3`. The route and UI present "AI Diagnosis Results", Approve/Deny per diagnosis, and a "Final Diagnosis & Treatment Plan" field.

**Reusable (isolate behind an adapter):**
- The HTTP client and timeout
- Error-status mapping
- Config check
- Request-length validation

**Must be removed or redesigned:**
- Every diagnosis-labelled name, route, UI string and PDF section.
- The Approve/Deny-diagnosis interaction and the treatment-plan field.
- The `diseases_list` "explore alternative diagnoses" feature.
- The raw pass-through of DXGPT disease names to the end user.

**Observed problems:**
- The selected `patientId` is **never sent**, so output is not tied to a patient or case.
- Approvals live only in React state and vanish on reload (no persistence, no audit).
- The full request and response are `console.log`ged on both server and browser.
- No reliability signal is computed: no confidence handling, no schema validation of the response, no fallback.

**Target role:** a *secondary, sanitised signal* inside the triage pipeline. A reliability gate is needed before it can ever act as a primary source. Whether DXGPT-derived disease names may be retained internally (for escalation logic only, never displayed or stored as a finding) is an **open policy decision** (see Section M).

---

## C. Missing functionality (must be newly implemented)

All NEW unless noted.

1. Triage domain: symptom intake (text and voice), structured note, timeline summarisation, missing-information detection, follow-up question generation.
2. Rules / validated-algorithm triage engine; urgency categories with reasons; a "never downgrade on uncertainty" invariant; clinician override with reason.
3. Combiner that treats DXGPT as a secondary signal, plus a reliability gate and fallback path.
4. Output-contract guard that blocks diagnosis terms and treatment advice at the API boundary, with tests.
5. OCR and structured extraction for lab reports and prescriptions (with confidence and "needs verification"). The only mention in the repo is a README roadmap bullet.
6. Multilingual UI and translation (English, Hindi, regional) with source-text retention; voice-to-text.
7. Queue prioritisation and a reviewer dashboard (the existing "dashboards" are record lists).
8. Referral workflow: facility directory, referral creation, status lifecycle, attachments, outbound exchange.
9. FHIR layer designed for referral (ServiceRequest, Task, etc.) with validation.
10. Scenario modules: outpatient, campus fever, occupational, maternal follow-up, chronic check-in, camps.
11. Reminders and notifications (the Twilio code is dead).
12. Consent capture and DPDP-aligned notice; purpose limitation; erasure and retention.
13. Append-only audit log for all PHI access and changes.
14. Facility/tenant model; staff accounts with MFA; care-relationship access control.
15. Env validation, secrets management, structured PHI-redacted logging, rate limiting per user and per auth endpoint.
16. Tests (unit, integration, authorisation matrix, evaluation harness with gold cases), CI, Docker/deploy config.
17. Offline or low-bandwidth mode (PWA).
18. ABDM/ABHA interoperability evaluation. **[U]**: is it in scope?

---

## D. Features requiring overhaul (cannot be retained as-is)

- **Authentication and password lifecycle**: double hash, hardcoded OTPs, no lockout, no MFA, 7-day non-revocable tokens.
- **Authorisation**: coarse roles; doctor and admin see everything via FHIR and `/doctor/patients/:id`.
- **File storage**: local disk, absolute paths in the DB, weak validation, no encryption or AV.
- **Record model**: two parallel models (`Record` and `HealthRecord`).
- **Sharing**: no revoke, no expiry, access level ignored; admin sharing broken.
- **FHIR API**: wrong data source and structure; no referral resources.
- **AI feature**: diagnosis-shaped end to end.
- **Admin tooling**: RCE endpoint and fabricated monitoring.
- **Persistence layer**: Mongo-specific design (Section H).

---

## E. Execution problems

| ID | Problem | Evidence |
|---|---|---|
| E-01 | **Double hashing.** `authRoutes`/`adminRoutes` bcrypt the password, then `User.pre('save')` hashes the hash. `compare(plain, stored)` → `false`. Any user created through these routes cannot log in with a password. The `fix-*password*.js` scripts exist because of this | [V] |
| E-02 | Google-created users fail validation (`password` required) | [V] |
| E-03 | Duplicate-user check `{$or:[{email},{phone}]}` with an undefined value casts to `{$or:[{},{...}]}`, and `{}` matches every document. Registration or creation is rejected whenever either field is omitted and any user exists. Same pattern in admin create | [V] |
| E-04 | Patient `PUT /profile` writes top-level fields not in the schema; strict mode drops them. Only `phone` persists | [V] |
| E-05 | Doctor `PUT /profile` sets `profile` to a partial object, replacing the subdocument (loses other profile fields) | [T] |
| E-06 | Admin share-with-doctor: schema mismatch (`userId`/`permission` vs `doctorId`/`accessLevel`), and `share.userId.toString()` throws on existing entries | [V] |
| E-07 | Admin share link: token never persisted; no route consumes it | [V] |
| E-08 | Admin QR lookup `$or:[{_id: 'a@b.co'},…]` raises CastError → 500; lookup by email/phone/assignedId never works | [V] |
| E-09 | FHIR reads `HealthRecord`; live code writes `Record` → empty results | [T] |
| E-10 | FHIR DocumentReference: `subject.reference` built from `mongoRecord.patient.toString()`. Search and `$everything` call `.populate()`, so the "ID" becomes a stringified object (`Patient/[object Object]` or a leaked document). `author` always `Practitioner/…` even when the uploader is a patient | [T] |
| E-11 | JWT payload shape differs between `authRoutes` (`id`) and `utils/jwt.js` (`userId`); `optionalAuth` reads `decoded.id` only | [T] |
| E-12 | `axios` is imported by `dxgptService` but **not declared**; it works only because `twilio` pulls it in transitively (axios 1.11.0) | [V] |
| E-13 | `uuid@13` is `"type":"module"`; `require('uuid')` works only because Node ≥22.12 supports require(esm). No `engines` field | [V] |
| E-14 | `toast.info` is not a react-hot-toast API → TypeError at QRRecords:108/112 and AICopilot:246 | [T] |
| E-15 | `TechnicalDashboard` uses relative `fetch('/api/…')` and Vite has no proxy → fails in dev. `Landing` hardcodes `http://localhost:5000` | [T] |
| E-16 | `publicRoutes /stats/detailed`: `now.setDate(...)` mutates `now`, so `startOfDay` is wrong; uptime is fabricated | [T] |
| E-17 | `connectDB()` isn't awaited; server accepts requests before DB is ready; `process.exit(1)` on connect error; no graceful shutdown | [T] |
| E-18 | Delete: `unlinkSync` then `deleteOne` is non-atomic → dangling DB row if the second step fails. Doctor delete leaves dangling `sharedWith` references | [T] |
| E-19 | `parseInt(limit)` / `_count` NaN is passed to queries; invalid `identifier` → CastError → 500 | [T] |
| E-20 | `generateUserUUID(userId)` comment says "consistent UUID" but returns a random one (dead logic) | [T] |
| E-21 | Frontend `config/api.js`: refresh, change-password, profile and all `ADMIN.*` / `PATIENT.*` endpoints target unmounted routes (404 against the live server) | [T] |
| E-22 | Two axios clients behave differently on 401 (one tries a refresh that never exists; one redirects) | [T] |

---

## F. Codebase quality problems

**Overlap and duplication**
- Two record models for one concept.
- Three route-file pairs (`x.routes.js` vs `xRoutes.js`) with different APIs, plus controllers duplicating route logic.
- Two JWT generators, four auth/role middlewares (`auth`, `roleCheck`, `authorizeRoles`, `checkResourceAccess`).
- `calculateAge` duplicated; preview/view/download handlers copy-pasted about 4×; two frontend axios clients; two token stores (`localStorage.token` plus Zustand-persisted `auth-storage`).

**Inconsistent contracts**
- Response envelopes vary: `{success,data}`, `{success,records}`, `{success,patient}`, `{status,message}`.
- Error shapes vary; some routes return `error.message` to clients.

**Abandoned or contradictory**
- Google OAuth, refresh tokens and GridFS are scaffolded but disconnected.
- Docs (`COMPREHENSIVE_DOCUMENTATION.md`, `FHIR_IMPLEMENTATION_GUIDE.md`) claim "HIPAA Ready", "At-rest encryption", "Audit Logs", "SMART on FHIR", `smart/` and `fhirAuth.js` — **none exist** in the code.
- The README presents OCR as a roadmap item while the model carries unused OCR fields.

**Logic in wrong place**
- Business logic in UI (diagnosis approval workflow, age math).
- Model-layer hooks that invalidate an in-process cache.
- The DXGPT model and language lists are hardcoded in both the route and the UI.

**Hygiene**
- Debug and fix scripts with embedded credentials in the project root.
- Unused env keys (`DB_NAME`, `GOOGLE_*`, `TWILIO_*` and `SESSION_SECRET` are only reachable via dead code); `CLIENT_URL` is defined twice in `.env`.
- Mixed naming conventions.
- 24 declared-but-never-imported frontend packages (Section J).

---

## G. Cybersecurity audit

**Severity: Critical = exploitable now with large PHI or system impact.**

### Critical

- **S-01 — Auth bypass via hardcoded OTP.** `POST /api/auth/verify-otp` accepts `otp === '123456'` and issues a token for any patient by phone [T]. `phone` is not sanitised, so `{"$ne":null}` logs in as the first patient [V: operator objects pass through casting].
- **S-02 — Account takeover via hardcoded reset OTP.** `POST /api/auth/reset-password` with `otp:'654321'` and any `email` resets that user's password; no role filter, so **admin and doctor accounts are included** [T]. `devOTP` is also returned by `/forgot-password`. `email` is injectable with an operator object, so the *first user in the collection* can be targeted [V].
- **S-03 — Remote command execution.** `POST /api/admin/execute-command` runs `exec(command)` after a `startsWith` allowlist (`ls`, `dir`, …). `ls; <anything>` or `dir & <anything>` passes [T]. Chain: S-02 → admin → RCE.
- **S-05 — Secrets.** `backend/.env` holds remote Atlas credentials in the connection string, Twilio SID/token-shaped values, a Google client secret, a 64-char JWT secret and a DXGPT key (shape checks only; values not printed). `SESSION_SECRET` looks like a placeholder. `TEST_CREDENTIALS.txt`, several `.ps1`/`.md`/`.js` files and `debug-admin-auth.html` contain plaintext passwords. The folder is **not a git repo**, so whether secrets were ever shared or committed is **[U]**. Treat all as compromised until rotated.

### High

- **S-06 — IDOR / excessive exposure.** `GET /api/doctor/patients/:id` returns `User.findById(id).select('-password')` for **any** user ID and role, including OTP and reset-token fields, `healthCardQR` and other doctors' and admins' data. There is no sharing check (unlike the records endpoints).
- **S-07 — FHIR over-exposure.**
  - Any authenticated user (including patients) can list and read every Practitioner (email, phone, licence, DOB).
  - Any doctor can search all patients and all documents with no care relationship.
  - `Patient` includes the `healthCardQR` extension.
  - `/fhir` is **not** covered by the rate limiter (the limiter is mounted on `/api/` only).
- **S-08 — Token handling.**
  - 7-day JWTs with no revocation; logout is a no-op.
  - Tokens in `localStorage` plus Zustand-persisted storage (XSS-stealable).
  - Admin file view puts the JWT in the **URL query string** (`?token=`), leaking to logs, history and referrers.
  - `JWT_SECRET || 'your-secret-key'` fallback in `authRoutes`.
  - No algorithm pinning; no `isActive` check on the admin view route.
- **S-09 — Brute force.** Only a global 100 requests per 15 min per IP; no per-account lockout; QR login and password login are guessable at that rate; no password policy; bcrypt cost 10.
- **S-10 — NoSQL operator injection** across login, registration lookup, OTP, reset, share-by-email and QR info/login: `req.body` fields go straight into filters with no `sanitizeFilter` or schema validation [V]. `new RegExp(userInput)` in admin and FHIR searches allows regex injection and ReDoS.
- **S-11 — PHI in logs.** `morgan('dev')`; full DXGPT request and response logged; admin login logs the query, user ID, and password and hash lengths; QR scan flow logs payloads in the browser; password-reset OTP logged server-side.
- **S-12 — No audit trail** in the live path. `HealthRecord.accessLog` exists only in the dead model. Admins and doctors read and download PHI with no record.
- **S-13 — Third-party PHI flow.** Free-text clinical descriptions go to Azure APIM (DXGPT) with no consent capture, no DPA check, no region or cross-border review, and reliance on an unverified remote anonymiser **[U]**.
- **S-14 — Upload hardening.** Validation by filename extension and client-supplied MIME only (no magic-byte check, no AV); files stored unencrypted on app-server disk; the stored `mimeType` is trusted when serving inline; `Content-Disposition` uses an unescaped original filename.
- **S-15 — Dependencies.** Backend: 1 critical (`proxy-addr`), 12 high (`express`, `mongoose`, `multer` ≤2.2, `axios`, `lodash`, `path-to-regexp`, `jws`, …). Frontend: 19 high (`react-router(-dom)`, `axios`, `postcss`, `tailwindcss`, `js-cookie`, …) [V: `npm audit`].

### Medium / Low

- **S-16** Unauthenticated `POST /auth/qr-info` returns name and email for any patient ID (enumeration). `GET /api/public/stats/detailed` is unauthenticated and exposes user counts by role and `os.uptime()`.
- **S-17** Global error handler and several routes return `error.message` to clients; stack in development mode.
- **S-18** `cookie-parser` and the `token` cookie fallback are accepted by `authenticateJWT` while CORS has `credentials:true`. The server never sets that cookie, so it's latent.
- **S-19** No CSP for the SPA, no `trust proxy` (affects `fullUrl`, rate-limit IPs), no HTTPS enforcement config, no deployment manifest.
- **S-20** Registration returns `error.message` and distinguishes existing accounts (enumeration).
- **S-21** Embedded `OTP`/reset-token fields in `User` are stored in plaintext and `Math.random()` is used for OTP generation (dead path, but the model design is unsafe).

### Controls verified as present (partial credit)
- helmet defaults and CORS pinned to a single origin.
- bcrypt used (with the double-hash defect).
- Patient-scoped queries use `patientId: req.user.id` (**no patient-route IDOR** found).
- Doctor record preview/download requires a `sharedWith` entry.
- Role checks are enforced **server-side** on the live routes (but only at role granularity).
- `isActive` is checked by `authenticateJWT`.
- Whitelisted fields on profile updates (no mass-assignment on role).
- Upload size cap and type allowlist exist (weak).

---

## H. Database audit (MongoDB as legacy)

### Inventory

| Item | Detail |
|---|---|
| Connection | `mongoose.connect(MONGODB_URI)`; `DB_NAME` env is unused. Remote `mongodb+srv` (TLS by default) with inline credentials |
| Collection `users` (`User`) | Single collection for patients, doctors and admins. Holds PHI/PII and credentials: names, DOB, gender, blood group, address, emergency contact, email, phone, password hash, QR image (base64), OTP/reset/verification tokens, `googleId`, `assignedId` |
| Collection `records` (`Record`) | **Live.** Title, description, type, `filePath` (absolute disk path), size, MIME, tags, `doctorNotes`, embedded `sharedWith[{doctorId, accessLevel}]`, `Map` metadata |
| Collection `healthrecords` (`HealthRecord`) | **No live writer.** Richer schema (OCR fields, `metadata.diagnosis/medications`, `Mixed` test results, embedded `accessLog` and `sharedWith`). Likely empty or test-only **[U]** |
| GridFS bucket `medicalRecords` | Initialised at boot; no live route writes it. Likely empty **[U]** |
| Sessions | `express-session` with the default in-memory store; effectively unused |
| Aggregations | 2, both in dead code. No transactions anywhere |

### Issues

1. **No uniqueness on `email` or `phone`** [V]. Only `assignedId` is unique+sparse. Duplicate prevention is an app-level check with a race and the E-03 defect.
2. **Duplicate index definitions** (email, phone, assignedId, googleId declared both on fields and via `schema.index`) [V]. A sparse index on `healthCardQR` indexes a large base64 string.
3. **Single mixed-role collection** with credentials and OTP fields co-located with PHI; queries returning `select('-password')` expose everything else (S-06).
4. **Two record schemas** for the same concept, with divergent field names (`patientId` vs `patient`, `fileName` vs `filename`, `type` vs `recordType`, `sharedWith.doctorId` vs `.userId`).
5. **PHI duplication:** diagnosis, medications and OCR text embedded in `HealthRecord.metadata`; QR image embedded in the user; absolute file paths in records.
6. **No referential integrity:** deleting a doctor leaves dangling `sharedWith` references; file deletion and DB deletion are not atomic.
7. **Lost-update risk:** share and revoke use read-modify-write on embedded arrays.
8. **No retention or deletion policy:** hard deletes only, no soft delete, no erasure workflow, no legal-hold concept.
9. **No migrations;** schema drift is managed by ad-hoc fix scripts.
10. **Audit:** none in live path.
11. **Backups, PITR, encryption at rest, network allowlist, DB user privileges:** **[U]**. Not determinable from code.
12. **Authorisation is application-only:** the app uses one DB credential; there is no DB-level access control.

**Verdict:** redesign, don't patch. Move to a relational model with row-level security (Section K).

### MongoDB → Supabase migration inventory (brief item 13)

**All MongoDB touchpoints**
- Models: `User`, `Record`, `HealthRecord` (+ GridFS bucket).
- Readers and writers (live): `authRoutes`, `patientRoutes`, `doctorRoutes`, `adminRoutes`, `publicRoutes`, `fhirRoutes`, `middleware/auth.js`, `middleware/roleCheck.js`, `config/database.js`, `config/passport.js` (dead), `utils/fhirTransformers.js`.
- Dead consumers: the 3 controllers, `config/gridfs.js`.
- Scripts: ~10 `fix-*/debug-*/seed/check/create/test-sharing` scripts.

**Mongo-specific constructs to redesign**
- ObjectId references and `populate` (16 call sites).
- Embedded arrays (`sharedWith`, `accessLog`).
- `Mixed` and `Map` fields.
- Sparse indexes.
- Regex `$or` search.
- Schema `pre/post` hooks (hashing, cache invalidation).
- `findByIdAndUpdate` with `runValidators`.
- `.lean()`.
- GridFS.
- Auth dependent on Mongo: all JWT middleware does `User.findById`.

**Data to migrate or transform**

| Source | Target idea |
|---|---|
| `users` | `auth.users` + `profiles` + role-specific tables (`patients`, `practitioners`, `emergency_contacts`); split credentials out |
| `records` | `documents` + private Storage objects; rewrite `filePath` → storage key |
| `healthrecords` | merge into `documents` after confirming content; likely discard |
| `sharedWith` | `record_shares` / `consents` with expiry and revocation |
| `accessLog` | `audit_events` |
| GridFS | Storage, if non-empty |
| Password hashes | **Not trustworthy**: many are double-hashed (E-01). Plan forced reset or re-invite, not hash import |
| IDs | ObjectId → UUID with a temporary `legacy_mongo_id` mapping column |

**Cannot be done until [U] is resolved:** actual row counts, orphan analysis, which accounts are real vs test, and the on-disk file inventory (the two PDFs seen are PHI-bearing files inside the project tree).

---

## I. FHIR / referral audit

**Referral:** there is **no referral implementation** (no `ServiceRequest`, no `Task`, no workflow, no facility directory). Only the word "FHIR" and 4 read resources exist.

### Genuine vs resemblance
FHIR-**shaped** JSON generated by hand from Mongo documents. It is not FHIR-**conformant**, because nothing validates it and the data behind it is incomplete.

| Area | Finding |
|---|---|
| Resources | `Patient`, `Practitioner`, `DocumentReference`, `Organization` (hardcoded "aarogyarekha-main", Bangalore), `Bundle` (searchset, collection), `CapabilityStatement`, `OperationOutcome` |
| Missing | `ServiceRequest`, `Task`, `Encounter`, `Observation`, `QuestionnaireResponse`, `PractitionerRole`, `Location`, `HealthcareService`, `Consent`, `Provenance`, `AuditEvent`, `Communication`, `Binary`; no create/update/search-by-status |
| Identifiers | Mongo `_id` used as the business identifier under an invented `http://aarogyarekha.com/...` namespace **[U: owned?]**; no ABHA / national / facility IDs |
| References | Broken for populated documents (E-10); `author` always `Practitioner/`; `custodian` missing |
| Terminology | Self-chosen LOINC codes (some look semantically off, e.g. "Medical Certificate" → 11490-0, which appears to be a discharge-summary code; verify); `category` uses the **US Core** CodeSystem; `Patient.contact.relationship` uses v2-0131 code `C` but overwrites `display` with free text |
| Content | `DocumentReference.content.attachment` has **no `url` or `data`** → documents are not retrievable via FHIR |
| Meta | `versionId` hardcoded `"1"`; no history/versioning |
| Data quality | Sensitive extras (`health-card-qr`, diagnosis) pushed into custom extensions |
| Search | `identifier` maps to `_id` (CastError → 500); `name` is an unescaped regex; `_getpagesoffset` is non-standard and there are no `Bundle.link` next/self; `date` ignores prefixes; `type` expects raw record-type strings, not codes |
| Errors | Invalid IDs return 500 rather than 404/400; `OperationOutcome` issue codes are minimal |
| CapabilityStatement | **Claims OAuth/SMART-on-FHIR**; the implementation is bare JWT with no scopes or launch. Advertises search params that don't work |
| URLs | `fullUrl` built from `req.protocol` (wrong behind a proxy) |
| Security | S-07 |
| Validation | None; `validateFhirResource` checks only `resourceType` and `id` |
| Docs | `FHIR_IMPLEMENTATION_GUIDE.md` describes `fhirAuth.js`, `smart/`, Phase 2 as complete; **those files don't exist** |

### Required for a correct referral architecture
(Final profile and algorithm spec are pending from you — these are the building blocks.)
- Referral as `ServiceRequest` (with `priority`, `reasonCode` limited to non-diagnostic reasons, requester, performer/destination) plus a `Task` for lifecycle (requested → accepted → in-progress → completed/rejected/cancelled).
- Supporting resources: `Patient`, `Encounter`/intake, `Observation` (vitals/symptoms/lab values), `QuestionnaireResponse` (intake), `DocumentReference`+`Binary`, `Organization`/`Location`/`PractitionerRole` for the facility directory, `Consent`, `Provenance` and `AuditEvent`.
- Referral packet as an immutable `Bundle` snapshot; validate in CI with the HL7 validator.
- Terminology: decide SNOMED CT / LOINC / ICD usage and **Indian profiles (ABDM / NRCeS)** — **[U]**.
- Diagnosis resources (`Condition` as a diagnosis) must **not** be populated by the system; clinicians own diagnostic statements.
- Recommended pattern: **relational canonical store in Postgres + FHIR projection layer** (generate resources from rows; store the sent referral Bundle as JSONB for immutability).

---

## J. Dependency and infrastructure audit

**Backend**
- `axios` undeclared (transitive via twilio) [V].
- `uuid@13` is ESM-only [V]; no `engines`.
- `multer@^1.4.4` (vulnerable, deprecated line), `mongoose@7`, `express@4` (audit findings).
- `express-validator` used **only** in dead routes (live routes validate nothing).
- `passport*`, `express-session`, `cookie-parser`, `multer-gridfs-storage`, `twilio` are effectively dead on the live path.
- `jest`/`supertest` declared with no tests.
- `qrcode` is live (health card).
- Missing: schema validation (zod/joi), structured logger, env validation, `.env.example`, lint config, Docker/CI.

**Frontend**
- 24 declared-but-unused packages: `js-cookie`, `recharts`, `zod`, `@hookform/resolvers`, `react-hook-form`, `react-dropzone`, `date-fns`, `tailwind-merge`, `class-variance-authority`, `clsx`, `qrcode`, and 13 `@radix-ui/*` packages.
- `@splinetool/react-spline` is imported somewhere (not flagged unused), but it is a heavy 3D dependency for a clinical app; confirm it is needed.
- 19 high-severity advisories (`react-router(-dom)`, `axios`, `postcss`, `tailwindcss`, `js-cookie`, …).
- No Vite proxy or environment-specific config; hardcoded localhost URLs.

**Infrastructure absent:** reverse proxy/TLS, secrets manager, backups and restore procedure, monitoring/alerting, CI, container image, staging environment, health/readiness separation.

---

## K. Recommended target architecture

**Principles:** security and auditability first; server-side enforcement everywhere; human-in-the-loop; strictly non-diagnostic output; facility-aware multi-tenancy.

1. **Supabase (region: India, e.g. Mumbai) as the authoritative store**
   - Postgres with **Row Level Security** by facility, role and care relationship; patients see only their own rows.
   - Supabase Auth: email/phone OTP via a real SMS provider; staff accounts with MFA; custom claims for role and facility.
   - Private Storage buckets with signed URLs; no public buckets.
   - Never expose the `service_role` key to the browser.
2. **Thin API/service tier** (Node/TS or Python) for what must not run in the client: triage orchestration, DXGPT adapter, OCR/extraction jobs, FHIR facade, notifications. Edge Functions are acceptable for small pieces.
3. **Triage pipeline (spec for algorithms pending from you)**
   `intake → normalise/translate → deterministic rules / validated algorithm (primary) → DXGPT adapter (secondary signal, sanitised) → combiner with "escalate-never-downgrade" invariants → output-contract guard (no diagnosis/treatment text) → queue → human reviewer`.
   DXGPT becomes primary **only** when a measured reliability gate passes for that workflow; otherwise the validated algorithm governs.
4. **Core data model** (relational, UUID keys): `facilities`, `profiles/memberships`, `patients`, `encounters/intakes`, `symptom_entries`, `vitals`, `documents` (+ `extractions` with confidence), `triage_assessments` (immutable versions), `triage_signals`, `queue_items`, `review_actions`, `referrals` + `referral_events`, `consents`, `audit_events` (append-only), `notifications`.
5. **Security baseline:** env validation and rotated secrets; per-user and per-endpoint rate limits; zod validation at every boundary; PHI-redacted structured logs; AV and magic-byte checks on uploads; column-level protection for the most sensitive fields; retention and erasure jobs; break-glass access with a mandatory reason, always audited; dependency scanning in CI.
6. **Privacy/DPDP:** explicit consent, purpose limitation, data minimisation, de-identify before any external AI call, vendor review for DXGPT, incident-response plan.
7. **Frontend:** one API client; Supabase session handling; i18n; PWA/offline queue; remove all diagnosis wording; every screen carries the non-diagnostic notice.

---

## L. Implementation roadmap (ordered by dependency)

**Phase 0 — Containment (before any build work)**
1. Rotate every credential in `.env` and the plaintext files (S-05); stop using the current Atlas credentials.
2. Take the current app offline or restrict it to localhost; never deploy it.
3. Neutralise S-01, S-02, S-03 (hardcoded OTPs and `execute-command`) if the app stays reachable at all.
4. `git init` with a correct `.gitignore`; keep PHI files and `.env` out.

**Phase 1 — Decisions and access (blocks later phases)** — see Section M.

**Phase 2 — Foundation**
5. Repo hygiene: remove dead code, scripts and unused deps; add `.env.example`, env validation, lint, CI, test harness.
6. **Design the Supabase schema** (migration step 3) with RLS policies, audit tables and storage layout *before* touching app logic.
7. Auth on Supabase (migration step 6, auth portion), role/facility claims, MFA for staff.

**Phase 3 — MongoDB → Supabase migration (your 10-step sequence)**
8. Step 1 (audit): finish inventory against the live DB (read-only access needed).
9. Steps 2–4: model mapping, schema, transform scripts (ID mapping, dedupe, drop test accounts, reset-required flag for credentials).
10. Steps 5–6: port persistence and dependent APIs; unify `Record`/`HealthRecord` into `documents`; move files to Storage.
11. Steps 7–8: validate counts, checksums and patient↔record associations; run an authorisation test matrix.
12. Steps 9–10: remove Mongoose/GridFS/Mongo config; verify no workflow depends on Mongo.

**Phase 4 — Triage core (NEW)**
13. Intake (text/voice), notes, timeline, missing-info and follow-up generation.
14. Rules engine (to your algorithm spec), combiner, contract guard, clinician override.
15. DXGPT adapter: isolate, sanitise, gate; delete the diagnosis UI and PDF.
16. Queue and reviewer dashboard; audit trail wired into every action.

**Phase 5 — Documents and referral**
17. OCR/extraction with confidence and verification flags.
18. Referral workflow and FHIR projection; HL7-validator checks in CI.

**Phase 6 — Scenarios and reach**
19. Scenario modules, i18n/translation, reminders, offline/PWA.

**Phase 7 — Hardening and release gate**
20. Dependency fixes, independent pen-test, load test, DPDP review, clinical-safety review, evaluation against gold cases.

---

## M. Open decisions and unknowns (need your input — nothing assumed)

1. **Live-DB access:** may I get read-only access (or a sanitised export) to inventory real data? Until then, section H counts are **[U]**.
2. **Have the `.env` secrets or `TEST_CREDENTIALS.txt` ever left this machine** (shared, pushed, deployed)? That decides how urgent rotation and breach handling are.
3. **DXGPT policy:** may DXGPT-derived disease names be kept internally for escalation logic (never displayed as findings)? Or must only non-diagnostic urgency features cross the adapter boundary? Also: is a DXGPT data-processing agreement in place?
4. **Triage algorithms and reliability threshold** — pending your separate specification.
5. **FHIR/India profile:** ABDM/NRCeS profiles in scope? SNOMED CT licence available? Who owns the `aarogyarekha.com` identifier namespace?
6. **Hosting region and retention periods** (DPDP and any state-level rules).
7. **Facility and role model:** single institution or multi-facility? Are patients self-service users, or is intake always staff-assisted?
8. **Production status:** is this deployed anywhere, and does real patient data exist?
