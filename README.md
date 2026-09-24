# CareHub

All-in-one **electronic health record (EHR)** and **practice management (PM)** starter for an ambulatory clinic.

This is a local demo, not a HIPAA-covered product. Do not put real patient data in it.

## What is included

| Module | What you can do |
| --- | --- |
| Command center | Today’s board, unsigned charts, AR snapshot |
| Patients | Registry, search, registration, chart (problems, meds, allergies, coverage, vitals, labs) |
| Schedule | Day/Week/List/Capacity views, filters (provider, location, visit type), reserved time blocks, missed-visit tracking |
| Charting | SOAP note, vitals, eRx, lab orders/results, sign encounter, SuperBill-style coding |
| Revenue cycle | Diagnosis pointers + modifiers on charges, submit/deny/resubmit claims, post payments and adjustments, AR aging, patient statements |
| Staff | Create/deactivate accounts, change roles, reset passwords |
| Audit log | Every account change and clinical/financial mutation, who and when |
| Wound care | Per-patient wound tracking, BWAT + PUSH standardized scoring, photos, healing-trend graph, debridement → auto-charge |
| Directories | Shared Payer and Referring Physician lists, instead of typing payer names fresh on every patient |
| Clearinghouse | Simulated real-time eligibility (270/271) and claim submission (837) via a swappable adapter interface |

The same patient record is shared across front office, clinical, and billing.

## Clearinghouse integration (simulated)

Modeled on Office Ally's clearinghouse features (Automated Eligibility, Claims Awaiting Batch, Repairable Claims). Since this app can't hold real clearinghouse credentials, `src/lib/clearinghouse/` defines a clean adapter interface — `checkEligibility` and `submitClaim` — with a **mock adapter** that returns realistic, deterministic responses. Swapping in a real integration (Office Ally, Availity, Change Healthcare, ...) is a one-file change in `src/lib/clearinghouse/index.ts`; nothing else in the app talks to the clearinghouse directly.

- **Eligibility**: automatically checked (simulated 270/271) when an appointment is booked, and re-checkable any time from the Schedule page. Shows coverage status, plan name, copay, and payer message right on the appointment row.
- **Claims**: submitting a claim now goes through the adapter first. An **ACCEPTED** response proceeds as a normal submitted claim; a **REJECTED** response (bad NPI, invalid diagnosis pointer, missing prior auth, etc.) sets the claim to **EDI rejected** — a distinct, earlier failure point than a payer denial — with a "Resubmit to clearinghouse" action once fixed. The billing dashboard tracks EDI rejections separately from payer denials.

## Directories

Modeled on Net Health WoundExpert's Facility Admin contact lists. **Payers** and **Referring Physicians** are practice-wide directories (`/directories`, editable by admins/front desk/billing/clinicians as appropriate) instead of free-text fields:

- Patient insurance references a **Payer** by dropdown — keeps payer names consistent across patients instead of "Horizon Blue Cross" vs "Horizon BCBS" typos
- Patients can be linked to a **Referring Physician** (external, not on staff) for referral tracking
- Both directories can deactivate entries without deleting history

## Wound care

Modeled on Net Health WoundExpert's clinical documentation loop. From an encounter, add a wound (label, body location, etiology) and record assessments over time:

- **Measurements**: length/width/depth, undermining, tunneling, staging (pressure injury stages, unstageable, DTI)
- **Wound bed**: granulation/slough/eschar/epithelial tissue percentages, exudate amount/type, periwound skin, pain, odor
- **PUSH Tool 3.0**: surface area subscore computed automatically from length × width per the NPUAP scale, plus exudate and tissue subscores — summed to a real PUSH total
- **BWAT (Bates-Jensen)**: all 13 standard items (size, depth, edges, undermining, necrotic tissue, exudate, periwound skin, edema, induration, granulation, epithelialization), each 1–5, summed to a real BWAT total
- **Photo** per assessment, and a **healing-trend graph** plotting wound area over time
- **Debridement**: document method and tissue removed; entering a CPT code and fee auto-creates the billing charge on the same encounter

See a wound's full history and trend from the encounter's Wounds panel or the patient chart.

## SuperBill-style coding

Modeled on Net Health WoundExpert's SuperBill screen. Each encounter has:

- **Diagnosis coding**: a visit-level, prioritized ICD-10 list (reorderable A/B/C/D…), separate from the patient's chronic Problem List
- **Billing details**: patient status (new/established), medical decision making level, hospice flag
- **Charges**: each line supports up to 4 modifiers and up to 4 **diagnosis pointers** referencing letters from the visit's diagnosis list — the real CMS-1500 claim format, instead of a single free-text ICD-10 per charge

## Scheduler

Modeled on Net Health WoundExpert's scheduler. From **Schedule**:

- **Day / Week / List / Capacity** views, navigable by date, with filters for provider, location, visit type, and a "show missed" toggle (missed visits are hidden by default)
- **Reserved time**: block non-patient time (lunch, admin time, out of office) on a provider's calendar — shown inline with appointments, sorted by time
- **Capacity view**: a provider × day grid showing which days a provider works (from their weekly **availability**) and how many visits are booked each day
- **Provider availability** (`/schedule/availability`, admin-only): define each provider's weekly working hours per location — this is what drives the Capacity view

## Multi-practice

CareHub is multi-tenant: each **Practice** has its own locations, staff, patients and financials, fully isolated from every other practice on the same deployment. Anyone can spin up a new practice from `/signup` — it creates the practice, a first location, and an admin account in one step.

Every staff account has a home practice, but a practice admin can also **grant an existing user access to their practice** from **Staff & roles** (for a biller or consultant who works across multiple locations). Anyone with more than one practice membership sees a practice switcher in the top bar and can move between practices instantly — the whole app (dashboard, schedule, patients, billing, staff, audit log) re-scopes to whichever practice is active, and their role can differ per practice.

## Stack

- Next.js (App Router) + TypeScript
- Prisma + PostgreSQL
- Tailwind CSS v4

## Run locally

You need [Node.js LTS](https://nodejs.org/) 20+ and a PostgreSQL server (local install, Docker, or a hosted instance).

```bash
cd carehub
npm install
cp .env.example .env   # edit DATABASE_URL to point at your Postgres instance
npx prisma migrate deploy
npm run db:seed
npm run dev
```

Open http://localhost:3000

Login is required. Seeded accounts (password `carehub123` for all):

| Practice | Email | Role |
| --- | --- | --- |
| Riverside Family Practice | `admin@carehub.local` | Administrator |
| Riverside Family Practice | `maya.chen@carehub.local` | Clinician |
| Riverside Family Practice | `james.okonkwo@carehub.local` | Clinician |
| Riverside Family Practice | `priya.shah@carehub.local` | Front desk |
| Riverside Family Practice | `alex.rivera@carehub.local` | Billing |
| Lakeside Pediatrics | `admin@lakeside.local` | Administrator |
| Lakeside Pediatrics | `dana.whitfield@carehub.local` | Clinician |

The two seeded practices share nothing — sign in as each admin to see the isolation. Visit `/signup` to create a new practice of your own.

`alex.rivera@carehub.local` is a Biller at **both** Riverside and Lakeside — sign in as them to see the practice switcher in the top bar.

Admins can create/deactivate staff accounts and reset passwords from **Staff & roles**; every account change and clinical/financial mutation is recorded in **Audit log**, scoped to their own practice.

### Local Postgres via Docker

If you don't have Postgres installed:

```bash
docker run --name carehub-db -e POSTGRES_USER=carehub -e POSTGRES_PASSWORD=carehub -e POSTGRES_DB=carehub -p 5432:5432 -d postgres:16
```

Then use the default `DATABASE_URL` from `.env.example`.

## Suggested next slices

1. eRx e-prescribing to a real pharmacy network, lab interfaces (HL7/FHIR), document imaging
2. Eligibility / clearinghouse claim files (837)
3. Encrypted backups, connection pooling (pgbouncer), infra-as-code for hosting
4. HIPAA program: BAA, access control review, PHI handling policy, penetration test

## License

Private clinic prototype. Not for production PHI.
