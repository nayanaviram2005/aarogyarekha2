# AarogyaRekha

A non-diagnostic triage **note** assistant for Indian health facilities. It organises what a nurse or health worker has already collected (typed or spoken symptoms, vitals, report photos), shows who may need to be seen first, asks for what is missing, and prepares a referral. A named nurse or doctor signs every priority. It never diagnoses and never suggests treatment.

> **Hackathon prototype. Not for real patients.** The triage rules are a draft that no clinician has approved. The reminder sender is a test sender. Hindi and Odia text is unreviewed. See [docs/10-responsible-ai.md](docs/10-responsible-ai.md) and [docs/EVALUATION.md](docs/EVALUATION.md) for what is and is not established.

## What is here

| Folder | What it is |
|---|---|
| `aarogyarekha2-frontend/` | React 19 + Vite + TypeScript screens (queue, intake, encounter, referrals, admin, offline notes) |
| `aarogyarekha2-backend/` | Node 22 + TypeScript + Fastify API, triage engine, OCR, AI adapters, workers |
| `supabase/migrations/` | The database: 15 migrations (tables, row-level security, audit chain, referral rules) |
| `scripts/` | Database scripts: migrate, verify, seed |
| `docs/` | Decisions, threat model, design language, triage algorithm, API, architecture, data flow, demo script, pitch, responsible AI, evaluation, task list |

## Try it in two minutes (no database, no keys)

```bash
npm --prefix aarogyarekha2-frontend install
npm --prefix aarogyarekha2-frontend run dev
```

Open `http://localhost:5173/?demo=1`. Demo mode shows invented patients held in memory. It exists only in the development build and is removed from a production build. Follow [docs/08-demo-script.md](docs/08-demo-script.md).

## Run the real system

You need Node 22 or newer and a Supabase project (the India region, for example `ap-south-1`).

1. **Install.** `npm install` in the repository root, then in `aarogyarekha2-backend` and `aarogyarekha2-frontend`.
2. **Configure.** Copy `.env.example` to `.env` (the file is git-ignored) and fill in your values. Names that matter:
   - Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`; database: `DATABASE_URL_POOLER` (or `_DIRECT`). `SUPABASE_SERVICE_ROLE_KEY` is read **only** by the retention worker, never by the API.
   - AI (optional): `AI_PROVIDER` (`mock`, `gemini`, `claude`, `openai`, `openrouter`) and the matching key and model. Each task can have its own key, provider and model (`AI_TRANSLATE_*`, `AI_TRIAGE_*`, `AI_STT_*`, `AI_VISION_*`, each with `_PROVIDER`, `_API_KEY`, `_MODEL`); anything left empty uses the main settings. `mock` sends nothing anywhere.
   - `MFA_REQUIRED` (default `true`): review sign-off, referral send, referral replies and emergency access need an authenticator app. Enable TOTP in the Supabase dashboard (Auth), or set `false` for a local demo.
   - `RETENTION_DOCUMENT_DAYS`: leave empty until the retention period is decided.
3. **Create the database.** `npm run db:migrate:dry` to see what will run, then `npm run db:migrate`, then `npm run db:verify`.
4. **Seed synthetic data.** `npm run db:seed` shows the plan, `npm run db:seed:apply` creates it. Sign-in details are written to a git-ignored local file.
5. **Register and approve the rules.**
   `npm --prefix aarogyarekha2-backend run ruleset:register`
   `npm --prefix aarogyarekha2-backend run ruleset:approve-demo -- --confirm`
   The second command approves the draft rules **for the demo only**. The database refuses any assessment against a rule set that is not approved. Real approval is a clinician's act.
6. **Start.** `npm --prefix aarogyarekha2-backend run dev` (API on `127.0.0.1:8787`), and `npm --prefix aarogyarekha2-frontend run dev` (screens on `localhost:5173`).

## Checks

```bash
npm --prefix aarogyarekha2-backend test          # API, engine, database rules (in-process Postgres), PDF, OCR corpus
npm --prefix aarogyarekha2-frontend test         # screens, libraries, automated accessibility checks
npm --prefix aarogyarekha2-frontend run build    # production build
npm --prefix aarogyarekha2-backend run bundle:scan   # secrets, demo data and hosted fonts must not be in the build
npm --prefix aarogyarekha2-backend run eval:report   # rewrites docs/EVALUATION.md
```

## Workers (run by hand or a scheduler)

| Command | What it does |
|---|---|
| `npm --prefix aarogyarekha2-backend run reminders:run` | Sends due reminders through the **test** sender (nothing leaves the machine) |
| `npm --prefix aarogyarekha2-backend run retention:dry` / `retention:apply` | Lists / deletes uploaded files past their retention period and writes proof into the audit log |
| `npm --prefix aarogyarekha2-backend run ai:smoke` | Sends one invented sentence through the chosen AI provider to check the key and model |

## Where to read next

[docs/TASKS.txt](docs/TASKS.txt) (what is done and what is not) · [docs/06-architecture.md](docs/06-architecture.md) · [docs/07-data-flow.md](docs/07-data-flow.md) · [docs/03-triage-algorithm.md](docs/03-triage-algorithm.md) · [docs/04-api.md](docs/04-api.md) · [docs/11-rollout-and-cost.md](docs/11-rollout-and-cost.md)

## Troubleshooting

- **"Two-factor sign-in is required"** when reviewing: enrol an authenticator from the strip at the top of the screen, or set `MFA_REQUIRED=false` and restart the API.
- **"Triage rules are not approved yet"**: run step 5, or have a clinician approve the rule set.
- **Port 8787 already in use**: set `API_PORT` and point the frontend at it with `VITE_API_URL`.
- **The queue is empty after seeding**: seeded people appear once an encounter is submitted. Use New intake.
