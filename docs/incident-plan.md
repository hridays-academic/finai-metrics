# Data breach plan (one page)

For: whoever runs Stackly. Written 2026-11-05. This is a working plan, not legal advice;
check the current rules with a lawyer if a real breach happens.

A breach here means personal data (emails, names, handles, schools, age bands,
consent records, forecasts, sessions) was, or may have been, seen, copied, changed
or deleted by someone who shouldn't have. A **suspected** breach starts the clock.

## Who

- **Incident lead:** Hriday Sharma, [PHONE], stackly.user.support@gmail.com. Makes every call below.
- **Backup:** [NAME / PHONE] if the lead can't be reached within 1 hour.
- **Outside help:** a lawyer [NAME / CONTACT]; Neon, Vercel and Google support for
  anything on their side.

## Clocks (start when we first suspect it)

| When | What |
| --- | --- |
| Within 1 hour | Contain (below) and start the incident log. |
| Within **6 hours** | Report to **CERT-In**: incident@cert-in.org.in, 1800-11-4949. Required for cyber incidents including data breaches; the clock starts on suspicion. |
| Without delay | Tell affected users, and the **Data Protection Board** under the DPDP Rules 2025 (check which parts are in force on the day). |
| Within **72 hours** | Detailed report to the Data Protection Board: what happened, when, how many people, likely impact, what we've done. |
| Same day as users | Tell the schools in the pilot, and parents of any under-18 player affected (via the school or directly). |

## First hour: contain

1. Write down the time and what was noticed in the incident log (a private doc; every
   step and decision, with times).
2. Stop the leak. Depending on the cause:
   - Database credentials: reset the `main` branch password in Neon, update
     `STACKLY_DATABASE_URL` in Vercel, redeploy (`vercel deploy --prod --yes`), check
     `/api/health` says `"database": "production"`.
   - Sign everyone out: `DELETE FROM sessions;` on production.
   - Leaked secret: rotate it (Google client, Moonshot, Gmail App Password,
     `IP_HASH_KEY`) and remove it from wherever it leaked.
   - Bad code: roll back to the last good deployment in Vercel.
3. Keep evidence: copy the Vercel runtime logs (`vercel logs <deployment-url> --json`)
   and the `audit_log` rows before anything rotates them. Don't delete data to "clean
   up" until the facts are written down.

## Next: understand it

Which tables and how many accounts? Any under-18 players? Was data read, changed or
deleted? Is it still happening? Neon's restore window on the Free plan is 6 hours, so
if data was changed or deleted, decide on a restore quickly.

## What to say (plain, no spin)

> On [date] we found that [what happened]. It affected [what data] for [who / how many].
> [Passwords are stored scrambled and were not readable / Passwords were not affected.]
> We have [what we did]. You should [specific step, e.g. sign in again / watch for
> emails pretending to be Stackly]. We're sorry. Questions: stackly.user.support@gmail.com.

Send it by email to affected users, show it on the site, and send it to the schools.
Don't guess numbers; say what is known and when the next update will come.

## Afterwards (within 2 weeks)

Write what happened, why, and what changed so it can't happen the same way again.
Add it to the session log and CLAUDE.md.
