# AarogyaRekha: walkthrough and build notes

AarogyaRekha is a triage assistant for outpatient desks, health camps and campus clinics. It does not diagnose and it does not decide treatment. It suggests who should be seen first, shows why, and a nurse or doctor always signs off.

Part 1 follows a doctor through a shift. Part 2 follows a facility administrator. Part 3 describes who built what and how each feature works.

---

# Part 1. The doctor's walkthrough

## 1. Signing in

- The doctor signs in with email and password. If two-factor sign-in is required at the facility, they verify with an authenticator app before they can sign off a priority or send a referral. Anything else works without it.
- A session with no activity for 10 minutes is signed out, and a notice says why. Clinic computers are shared, so the session lives in the browser tab and closing the tab ends it.
- The account menu (top right) shows name, role and facility. It holds the language and low-data switches, the two-factor setup and sign-out.
- The banner at the top says the system is a prototype, does not diagnose, and its rules are published protocols that a clinician has not yet validated. That wording stays on every screen.

## 2. The triage desk (home)

The home screen is built around one question: what do I do next?

- **New patient** starts an intake.
- **Next patient** shows the person to open. For a doctor, patients who still need sign-off come first.
- **Queue counts** show how many are waiting, how many are in review, and a link to "Done today".
- The **queue pane** on the left lists every waiting patient, most urgent first, then by how long they have waited. Each row has a colour-and-text priority plate (Immediate, Very urgent, Urgent, Routine), the age and sex, the complaint, and badges such as "Needs sign-off", "Waiting long" and "Could be urgent · 11 still needed". The last one means more answers could raise the priority. Search and filters narrow the list, and it refreshes by itself.

## 3. Registering a patient

Everything starts from **New patient**.

- **Search first.** Typing a name or record number finds existing patients as you type.
- **Register a new patient** takes name, sex, age or date of birth, language, phone and village. If someone with the same name and age exists, the system stops and shows them, and the doctor either uses the existing person or confirms this is someone different.
- **Start from the patient's records.** Records (PDF, JPEG or PNG, up to five) can be added at the very start. Each is read on the server, and the name, age, sex and phone found are put into the form, only into fields not already filled. **Extract details and register** then registers the person in one click. If no name can be read, the form opens so it can be typed.
- **Registering also starts the visit.** The patient is put in the queue straight away, and any attached records are stored and read. If no complaint has been entered yet, they appear as "Not assessed" until the details are added.
- **Consent pop-up.** A new patient has not agreed to triage yet, so a pop-up appears with the notice to read aloud and one button, **Patient agrees**. That records spoken consent from the patient, witnessed by the person recording. A guardian, a paper form or another witness is one click away. Closing the pop-up records nothing.

## 4. The patient's page

The page follows the work in order.

- **Header:** name, reference, age and sex, the language they speak, the complaint in their own words and, for Hindi and Odia, an English machine translation clearly marked as not verified.
- **Step bar:** Check-in, Questions, Sign-off, Visit. The steps are buttons, so anything done can be reopened and changed. The recommended step carries "Next".
- **Next-step card:** one sentence saying what to do now and who does it (consent, assess, answer questions, sign off, call in, finish, refer).
- **Records on file:** what the uploaded reports say, using the lab's own printed flags (for example "Haemoglobin 9.1 g/dL, printed LOW"). Results nobody has checked are marked. This panel only repeats what the report printed. It does not judge values and does not change the priority.
- **The draft priority**, shown above the step panel.

### Check-in

- Main complaint (typed, or spoken with the microphone), measurements (temperature, pulse, breathing rate, oxygen saturation, blood pressure), responsiveness and extra oxygen.
- More detail is folded away: visit type, symptom duration and severity, scenario fields.
- **Get the priority** saves everything and assesses.
- Documents can be added here. Each upload is checked before it is stored (see Part 3), and each is read into rows.

### The priority

- A fixed set of written rules produces one of four levels: **Immediate (red), Very urgent (orange), Urgent (yellow), Routine (green)**. The rules can only raise a priority, never lower it.
- The page shows why: which rule or score set the level, and, where answers could change it, "Could be urgent" with how many are still needed.
- The rule set is marked DRAFT. It is transcribed from published protocols and has not been clinically validated.
- **AI second opinion (optional).** If the patient agreed to outside AI help, a model reads the case with names and numbers removed and gives its own level beside the rules. It can only raise the priority. Its answer is shown beside the rules result, never instead of it.

### Questions

- The system asks danger-sign questions, ranked by how much each could change the priority. The core emergency signs are always asked. The rest are chosen to fit the symptoms, with a budget of about 12.
- Each question is a Yes/No button pair. Tapping only marks the choice (it stays highlighted with a tick and can be tapped again to take it back). Nothing is saved until **Submit answers**, and then the patient is assessed again automatically.
- Answers already given can be changed from the "answered" list, followed by another assessment.
- If the patient agreed, an AI service can choose and word the questions for this patient.

### Sign-off (the doctor's decision)

- One section holds the whole decision. **Confirm priority** asks for one more click that names the doctor, and records the sign-off. **Change priority** asks for the new level, a reason from a list and an explanation of at least 10 characters.
- Making a case **less** urgent than the rules set needs a separate explicit confirmation, and the page says when a danger-sign rule set the level.
- A sign-off is recorded under the doctor's name and cannot be removed. If the assessment changed while the doctor was looking, the page says so and offers the latest one. It never signs off something the doctor did not see.
- After a sign-off, if the patient agreed to text messages and has a valid mobile number, they get **one text in their own language** (English, Hindi or Odia) with their first name and queue status. Wording differs for Routine, Urgent, Very urgent and Immediate. A later lower status sends a gentler "moved slightly down" message. Every text ends with how to stop them. The screen says whether a text was sent, and why not if it was not. A failed text never undoes the sign-off. Texts are off until Twilio is set up.

### Visit

- **Call in** marks the patient as being seen.
- **Complete visit** ends it as treated here, sent home, or did not wait. The patient leaves the queue and appears in "Done today".
- **Referral** (below).

## 5. Referrals

- The doctor picks the receiving facility, a priority and the reason, with the fields lined up on one row. A referral needs a signed-off priority.
- Sending needs the patient's separate consent to share their record. A summary goes to the receiving facility without the phone number or street address.
- A preview shows exactly what will be sent. Sending freezes it, so what the other facility sees is what was sent. It can be downloaded as a PDF note (Hindi and Odia text included) and as a standard FHIR record.
- The **Referrals** page lists referrals sent and received. The receiving facility accepts or responds, and every send and open is logged.

## 6. Reports

- Reports are read twice. A local reader takes the text layer of a PDF, or reads a photo, on the server. If the patient agreed to outside AI, a vision model also reads the image, and the two reads are compared per row ("Two readers agree", "Readers differ").
- Every row is a transcription: the printed value, the printed range and the printed flag. A doctor confirms or corrects each row, and the system records who confirmed it. Unconfirmed rows are marked, and the AI second opinion only receives confirmed ones.

## 7. Background (folded away)

- **History:** reported conditions, medicines and allergies, with a doctor able to confirm each.
- **Trends:** measurements over time for chronic check-ins.
- **Follow-ups and reminders:** plan a next visit and schedule a reminder. Reminders need their own consent. The text says only the facility and the date. In this build reminders go through a test sender, so nothing is really sent.
- **Notes:** reviewer notes on the case.
- **Scenario checklist** for the type of visit.
- **Reports read and timeline:** the full list of rows read, the story so far, and everything recorded in order.

## 8. Other screens

- **Scenarios:** boards for campus fever, maternal follow-up, chronic check-in, occupational and others, each with its own waiting list.
- **Camp registration:** register and queue many people in one sitting, one row each, with consent per row. Each row remembers what already succeeded, so retrying never registers anyone twice.
- **Offline notes:** short notes kept on the computer when the connection drops, to be entered later.
- **Emergency access:** if the doctor needs a patient outside their facility, they give a reason, get a short time-limited access, and an administrator reviews it afterwards.
- **Settings:** account, two-factor sign-in, language, and the data-use notice.

## 9. What the doctor can rely on

- A sign-off is theirs. Nothing is sent or decided without a named person.
- Every patient record opened is logged before it is shown. If the log cannot be written, the record is not shown.
- Without consent, nothing is saved, read by AI, sent or texted. Consent is checked on the server, not just on screen.
- The system never gives a diagnosis or treatment advice. Text that would is blocked before it reaches the screen.

---

# Part 2. The facility administrator's walkthrough

A facility administrator manages people, activity and audit at their facilities. They are not a clinical role, so they cannot open patient records. The Administration page shows counts and activity with no patient names.

## 1. Administration page

- **Analytics:** counts and timings for the facility. Encounters, how many were assessed and reviewed, a breakdown by scenario and by priority, median and 90th-percentile time to assessment and to review, how often reviewers approved or changed the rules' priority (and how often they lowered it below the rules), and how many people marked the AI help helpful. The figures contain no names and no patient identifiers.
- **Unusual access:** a list of activity worth a second look over the last 24 hours, 3 days or 7 days: many different records opened, repeated refusals, failed sign-ins, night-time reading, and emergency access. The page warns that the thresholds are placeholders to be set by the facility's information-security lead.
- **Audit log check:** every audit entry carries a fingerprint that includes the one before it. **Check now** walks the chain and says "Audit log intact" with the number checked, or shows exactly which entries no longer match.
- **Emergency access:** each emergency grant is listed with who took it, why, and until when. The administrator marks each as reviewed.

## 2. People and roles

- Add an existing account by email, change someone's role, or remove them.
- A person has one active role per facility. Roles are health worker, nurse, doctor, medical officer and facility administrator.
- The administrator cannot change their own role. Making someone an administrator is done by a platform administrator, not by another administrator.
- Every change is recorded in the audit log.

## 3. Their own account

The same account menu and two-factor setup as everyone else.

---

# Part 3. Who built what

## A. Security

A started with a threat model that listed who might want the data, what they could reach and how each case would be stopped, and then built each control against it.

- **Sign-in.** A built the token verifier. It remembers a good check for five seconds, shares identical checks that arrive together, retries once on a hiccup, and lets a token proven in the last two minutes keep working through a short outage of the sign-in service, so the clinic does not see "sign in again" when the service is only busy. A bad session is refused, and each failed sign-in is audited.
- **Two-factor.** A added a gate on the two actions that change a patient's fate, signing off a priority and sending a referral. When the deployment requires it, those calls need a verified second factor and a refusal is logged.
- **Idle lock and sessions.** A made sessions live in the browser tab and sign out after a period of inactivity.
- **Consent as a gate.** A wrote the consent check on the server. Without active consent for triage, no encounter, symptom, measurement, answer, assessment or upload is accepted, and separate consents guard outside AI, referral sharing, reminders and text messages.
- **Audit.** A made the audit log fail closed: a record is shown only after its audit entry is written. Entries hold ids and codes only, never names, numbers or free text. Each entry is chained to the one before, so an edit is detectable. The facility administrator's chain check and the live verification script both use this.
- **Upload safety.** Every uploaded file is checked in memory before anything is stored. A sniffs the real type rather than trusting the label, strips metadata (such as GPS) from photos, limits size and pixel count, and walks every object in a PDF with a real parser to find scripts, attachments, launch actions and forms that submit. Plain web links in a lab report are removed rather than the whole report refused. PDFs are only ever served as downloads, and stored with a policy that forbids any content from running.
- **Keeping personal details away from AI.** A built the redaction step. Names, phone numbers and identifiers are removed before text goes to an outside service, and a second check blocks the call if anything personal would still go out. Every outside call is logged (size only, never the text). Report images, which cannot be redacted, need the patient's separate consent.
- **Guarding the AI's answers.** Replies are untrusted. They must be small JSON, every phrase is checked by a filter that blocks diagnosis or treatment wording, and a model can only raise a priority.
- **Access budget.** A limited how many different patients one person can open in an hour. Past the limit, access is paused and an audit entry is written once, even with a valid login.
- **Headers and page policy.** The API sends strict headers (no content, no framing, no referrer, HSTS) and the built pages carry a content policy that allows scripts only from this site and connections only to this site, the API and the database service.
- **Rate limits.** Costly and sensitive routes have their own lower limits.
- **Break-glass.** A built emergency access. It needs a reason, expires quickly, is logged and flagged, and is reviewed by an administrator.
- **Text-message webhook.** A made the STOP handler verify Twilio's signature in constant time and refuse anything unsigned without saying why.
- **Retention and erasure.** A wrote the rules for how long documents and records are kept and how a person's data is erased.

## B. Database

B designed the Postgres schema on Supabase and treated the database as the last line of defence, so a mistake in the application cannot leak data.

- **Schema.** 37 tables covering facilities, memberships, patients, identifiers, consents, encounters, symptoms, measurements, assessments and signals, queue items, reviews, reviewer notes, referrals, documents, extractions and rows, history, follow-ups and reminders, external AI runs, audit events and the text-message log.
- **Row-level security** is on every table. Access depends on who the caller is and which facility they belong to. A table with security on and no policy is limited to the system itself.
- **Functions that do the sensitive work.** Recording a review, sending a referral, calling a patient in, completing a visit, changing a member's role and ending text consents are database functions. They run with a fixed search path, take the acting person explicitly, and only the service role can run them. Each checks role, sign-off and consent itself, and each is atomic, so a sign-off and its queue update either both happen or neither does.
- **Audit chain** is enforced by triggers, not by the app.
- **Storage.** The documents bucket is private, size-limited, and only accepts an upload whose database row already exists.
- **Realtime** publishes only the queue.
- **Migrations.** B wrote 19 migrations (foundation, identity and consent, clinical intake, triage, referral and follow-up, audit, access functions, security policies, storage, erasure, guardrails, review, referral sending, notes, member roles, second-read columns, visit flow, status texts), each safe to run twice.
- **Tests.** B ran every migration against an in-process Postgres in the tests, so the real schema and policies are exercised.
- **Live checks.** B wrote the verification script that checks the real database: table count, security on every table, no access for anonymous users, every sensitive function pinned and restricted, the private bucket, and the audit triggers.
- **Text-message log** records who, when, level and result, with no phone number and no message text.

## C. Full-stack developer 1: the engine and the server

C built the triage engine, the API and everything that happens to data on the way in and out.

- **Triage engine.** A deterministic function turns age, measurements, danger-sign answers and context into one of four levels. Layers are danger-sign rules, scores and pregnancy blood-pressure rules, and an optional AI hint, and the result is the highest of them. It records which rule won so the screen can explain. A larger rule set adds 50 flags from a GP triage chart, shown only where approved.
- **Rule sets** are versioned and approved before use. The live one is marked DRAFT.
- **Questions.** C wrote the relevance step: core signs are always asked, the rest are chosen from the symptoms (by AI when allowed, by keywords otherwise), measurements count first, and the total stays about 12.
- **Intake routes.** Register, consent, start an encounter, add symptoms and measurements, save inputs, submit and assess. Every write runs as the signed-in user, so row security decides. Errors are in plain words and never repeat what was submitted.
- **Duplicate check** stops a second record for the same name and age.
- **Assessment storage.** Each assessment is saved with its signals and the queue entry.
- **Reviews.** The route calls the database function, and a lower-than-rules decision needs explicit confirmation.
- **Referrals.** Drafts, sending, the PDF note with Hindi and Odia text, the FHIR bundle and the receiving facility's response.
- **Follow-ups and reminders**, with a test sender.
- **Queue flow.** Call in, complete visit, "Done today".
- **Status texts.** Fixed message templates in three languages, one message per sign-off, never the same status twice, a gentler message when moved down, consent and number checks, and a log that holds no number or text.
- **AI layer.** One provider layer for Gemini, Claude, OpenAI and OpenRouter with separate keys per task, a retry when the service is busy, and a fallback model or provider. It covers translation, speech-to-text, the priority second opinion and the report image reader.
- **Reports.** The local reader (PDF text layer, Tesseract for photos) feeds a parser that turns lines into test rows. A second reader compares row by row.
- **Records as the way in.** C built the reader that finds the name, age, sex, date of birth and phone in a record (it copes with several lab layouts) and the summary of what the records say.
- **Background jobs** read slow photos without holding the request.

## D. Full-stack developer 2: the screens

D built what the doctor and the administrator see, and kept to one rule: the screen follows the work.

- **Design language.** A hospital-utilitarian look with one sans-serif family, colour reserved for priority and state, and no gradients or shadows. The app name is always "AarogyaRekha".
- **Priority plates** pair colour with text so nobody depends on colour alone.
- **Shell and panes.** Three panes on a wide screen (queue, patient, context) and a tab bar on a narrow one, with a global **Switch patient** (Ctrl+K).
- **Triage desk and queue** with search, filters, badges and live refresh.
- **Intake.** Search as you type, register with duplicate handling, the records box with **Extract details and register**, and the visit starting as soon as a patient is registered. The consent pop-up is its own component, closed with Escape or Close.
- **The patient page.** The step bar, the next-step card, and the one section for sign-off with confirm and change together. Questions use tap-to-mark Yes/No with a tick, and answers submit together.
- **Documents and reports.** Upload with picture-quality warnings, the rows with both reads side by side, per-row confirmation, and the Records-on-file panel.
- **Referral screens** with the fields on one level, the preview, and the sent referral.
- **Administration screens.** Analytics, unusual access, the audit chain badge, emergency-access review and people and roles.
- **Language.** Interface text in English with Hindi and Odia, and a low-data mode.
- **Offline notes** kept on the computer.
- **Camp registration** with resumable rows.
- **Demo mode.** A development-only demo with invented data and no login, so the screens can be shown without a database. It never reads files and never invents a patient from one.
- **Tests.** D wrote the component tests and automated accessibility checks that run with them (508 plus), so a missing label or bad contrast fails the build.
- **Build.** The production build carries the page policy and leaves out the demo module.

## What the team verified together

- A and B ran the live checks against the real database. C and D ran all the tests (1,300+ on the server, 500+ in the browser).
- The live AI run used invented patient data only.

## What is still not done

- A clinician has not reviewed the rules, the known gaps or the rule-set versions.
- A native Hindi and Odia speaker has not reviewed the translated wording, including the text-message templates.
- Text messages are off until a Twilio account is set up and, for India, the sender and templates are registered.
- Reading photos with Tesseract has not been tried on a real photo.
- The new intake flow has not been tried end to end against the real server.
- Screen-reader and colour-contrast checks need a person in a real browser.
