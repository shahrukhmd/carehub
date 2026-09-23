# CareHub

All-in-one **electronic health record (EHR)** and **practice management (PM)** starter for an ambulatory clinic.

This is a local demo, not a HIPAA-covered product. Do not put real patient data in it.

## What is included

| Module | What you can do |
| --- | --- |
| Command center | Today’s board, unsigned charts, AR snapshot |
| Patients | Registry, search, registration, chart (problems, meds, allergies, coverage) |
| Schedule | 7-day book, check-in, start encounter from the visit |
| Charting | SOAP note, sign encounter, attach CPT charges |
| Revenue cycle | Submit claim from a charge, post a payment |
| Staff | Seeded roles: admin, front desk, clinician, biller |

The same patient record is shared across front office, clinical, and billing.

## Stack

- Next.js (App Router) + TypeScript
- Prisma + SQLite (swap `provider` to `postgresql` when you are ready for a real clinic database)
- Tailwind CSS v4

## Run locally

You need [Node.js LTS](https://nodejs.org/) 20+. This machine did not have Node installed when the project was created.

```bash
cd carehub
npm install
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Open http://localhost:3000

Seeded clinicians: `maya.chen@carehub.local`, `james.okonkwo@carehub.local` (no login yet).

## Suggested next slices

1. Real authentication and role-based screens
2. Postgres + encrypted backups + audit log
3. eRx, lab orders, and document imaging
4. Eligibility / clearinghouse claim files (837)
5. HIPAA program: BAA, access control, PHI handling, hosting

## License

Private clinic prototype. Not for production PHI.
