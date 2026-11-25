<!-- Moved word for word from CLAUDE.md on 2026-11-25 (master plan Z1). The index is CLAUDE.md. -->
# Accounts and privacy

## Accounts & activity tracking

(2026-07) The only piece of genuinely persistent, user-specific state in
this app -- everything else is either fetched live from a provider or an
in-process cache that resets on restart (well, quota tracking is the
exception there too, see `tapetide_provider.py`'s `tapetide_quota` table).

**Sign-in is additive, never a gate.** Every feature in this app works
fully signed-out, exactly as before this existed. Signing in (via the
account icon in the header, `AuthPanel.tsx`) only starts recording your own
searches to an activity log you can see in the same panel. Don't make any
endpoint require auth without discussing it with the user first -- that
would be a real product change (turning an open tool into a walled one),
not just an implementation detail.

**Storage is Postgres (Neon's free tier), not SQLite anymore.** This was
SQLite (`backend/app.db`, gitignored) originally -- a single on-disk file
needing no separate server process, consistent with the project's bias
against adding infrastructure (see the dev-only response caches in
`tapetide_provider.py`/`bharat_sm_provider.py`, both plain files on disk,
same reasoning). That stopped working once the app moved to Vercel (2026-07,
see "Deployment" below): serverless functions have no persistent local
filesystem, so anything written to disk -- the SQLite file, and
`tapetide_provider.py`'s old quota-tracking JSON file -- was silently wiped
on every cold start/redeploy. Neon specifically because its free tier is
permanent (not a trial) and needs no credit card. `db.py` creates four
tables on startup (`users`, `sessions`, `activity_log`, `tapetide_quota`)
via plain `psycopg` (v3) -- no ORM, deliberately; four small tables don't
need one. Uses `row_factory=dict_row` so call sites still do `row["col"]`,
same as `sqlite3.Row` did before.

**Auth is session tokens in a DB table, not a JWT.** `auth_service.py`
issues an opaque `secrets.token_urlsafe(32)` on signup/login, stored
server-side in `sessions` with a 30-day expiry. Every request needing auth
does a DB lookup rather than verifying a signature -- the right tradeoff at
this scale (a handful of users), since it makes revocation ("sign out
everywhere") trivial (delete the row), which a stateless JWT can't do
without extra machinery. The frontend stores the token in `localStorage`
(`lib/auth.ts`) and `lib/api.ts`'s `authHeaders()` attaches it to every
request as `Authorization: Bearer <token>` automatically -- no per-call-site
plumbing needed.

**Passwords are hashed with stdlib `hashlib.pbkdf2_hmac` (SHA-256, 200k
iterations, random 16-byte salt per user), not bcrypt/argon2.** No new
dependency needed for it -- PBKDF2 via hashlib is a legitimate, still-widely-
used choice (it was Django's default password hasher for years), and this
project's existing bias is toward the standard library over adding a
package where the stdlib genuinely covers it. Never log or include a
plaintext password in an exception message anywhere in `auth_service.py`.

**`main.py`'s `_current_user` dependency is optional-auth, never raises.**
It returns `None` for a missing/invalid/expired token rather than a 401 --
every route that uses it (currently just `/api/company/{query}`, to log a
`"searched"` activity entry when signed in) needs to keep working perfectly
for anonymous requests, since that's still the default, expected way to use
this app. `GET /api/activity` is the one exception that does require auth
(401 if signed out) since "your activity" is meaningless without a "you."

**What gets logged, and where to add more:** `signed_up`, `logged_in` (both
from `auth_service.py` itself), and `searched` (from `main.py`'s
`get_company`, detail = the resolved company name). If you wire up activity
logging for another action (e.g. a calculator stock pick), call
`auth_service.log_activity(current_user, "action_name", detail)` -- it's a
no-op when `current_user` is `None`, so every call site can call it
unconditionally rather than wrapping every log call in `if current_user:`.


## Forgot password

(2026-09) `request_password_reset`/`reset_password` in `auth_service.py`,
wired to `POST /api/auth/forgot-password` / `POST /api/auth/reset-password`
in `main.py`. A single-use, 30-minute token
(`secrets.token_urlsafe(32)`, hashed with plain SHA-256 before storage in
the new `password_reset_tokens` table — unlike `sessions.token`, which
stores the raw value, a reset token travels over email, a channel more
likely to be logged/forwarded along the way, and is a higher-stakes secret
since holding one is a full account takeover, so it gets the "don't store
the literal secret" treatment `tapetide_quota.token_hash` already uses
elsewhere) is emailed via Gmail's own SMTP (`gmail_service.py`, see
"Environment variables" below for `GMAIL_ADDRESS`/`GMAIL_APP_PASSWORD`).

**Gmail SMTP, not a third-party transactional email provider (2026-09,
replacing an initial Resend-based version) — a deliberate choice to avoid
signing up for a new external service, at the user's explicit request
("make it so the thing comes to your email directly instead of a third
party thing").** No email delivery is ever truly "direct" (some relay is
always involved), so this was interpreted as: use an email account the
user already has, rather than create a new account with any provider.
`gmail_service.py` sends via `smtplib.SMTP_SSL` to `smtp.gmail.com:465` --
stdlib only, no new pip dependency. Requires a Gmail **App Password**
(https://myaccount.google.com/apppasswords), never the account's real
password -- Google blocks plain-password SMTP auth by default, and
generating an App Password requires 2-Step Verification to already be
turned on for that account (Google's own requirement, not one this app
adds). The real tradeoff versus a dedicated provider like Resend: mail
comes from a personal-looking Gmail address (whatever `GMAIL_ADDRESS` is
set to becomes the visible "From" on every reset email), is capped around
Gmail's own ~500-recipients/day sending limit, and a compromised App
Password can send mail as that account -- accepted deliberately in
exchange for not creating a new external account at all.

**`request_password_reset` always returns the same thing to the HTTP
layer regardless of whether the email has an account, is Google-only (no
password to reset), or the reset email genuinely failed to send** — a
different response for any of those cases would make this endpoint an
email-enumeration oracle, a well-known real auth vulnerability class, not
a hypothetical one. `main.py`'s `forgot_password` handler swallows a
`gmail_service.EmailSendError` and still returns the generic "if an
account exists..." message either way; the actual failure is only ever
visible in server logs.

**The reset link's origin is allowlisted (fixed 2026-11).** It used to be
the request's raw `Origin` header, which let anyone send a victim a genuine
reset email whose link pointed at the attacker's site (token theft). Now
`_reset_link_origin` uses `Origin` only if it is in `PUBLIC_ORIGINS` (or,
off Vercel, `CORS_ORIGINS` for the Vite dev server), else the first public
origin. A reset also deletes every session and reset link for that user.

**No client-side routing exists in this app at all** (see `App.tsx`'s
plain view-state pattern for search/calculator/simulator/trading) — the
reset link is a query param (`?reset_token=...`) that `App.tsx` reads
once, synchronously, on mount (`new URLSearchParams(window.location.search)`),
rather than adding a router just to support this one deep-linkable case.
`ResetPasswordPanel.tsx` used to take priority over the (now deleted) key gate when a
visitor arrives at this link in a fresh browser with no Tapetide key
saved yet — completing a 30-minute-expiring, one-shot reset matters more
right now than the key gate, and doesn't need a Tapetide key at all;
`App.tsx` falls through to the normal gate afterward if one's still
missing. The token is stripped back out of the URL via
`history.replaceState` once handled (success or cancel), so it doesn't
linger in browser history or get resubmitted on a reload.

**`ForgotPasswordForm.tsx` is shared** by `AuthPanel.tsx` and
`TapetideKeyGate.tsx`'s `"signin"` step (a new `"forgot"` step there) --
unlike the sign-in/sign-up forms themselves, which stay deliberately
separate copies (different surrounding chrome, see `TapetideKeyGate.tsx`'s
own comment on why), "forgot password" is simple and self-contained
enough that sharing it was worth the small coupling, rather than writing
the same email-submit-and-confirm logic a third time.


## Privacy, consent and security (2026-11)

Pre-pilot work; the Privacy Policy and Terms (`LegalPage.tsx`, `#/privacy`,
`#/terms`, linked in `SiteFooter`) were approved by Hriday 2026-11-05 with
placeholders filled 2026-11-06 (Hriday Sharma, stackly.user.support@gmail.com,
Bengaluru, India; also in `docs/incident-plan.md`, whose [PHONE] is still
blank). Never claim
legal compliance anywhere. Schema version 8.
- **Terms agreement.** Sign-up needs `accept_terms` (checkbox in AuthPanel);
  a new Google account gets 409 `terms_required` and nothing is created
  unless the box was ticked. `users.terms_accepted_at`/`terms_version`;
  `UserPublic.needs_terms` is true until the current
  `auth_service.TERMS_VERSION` is accepted. Existing accounts see
  `TermsPrompt.tsx` and the backend refuses forecasts (`terms_required`).
  Bump `TERMS_VERSION` (and `LEGAL_UPDATED`) when either page changes
  materially.
- **Delete my account** (Settings, typed "DELETE",
  `POST /api/auth/delete-account`, `auth_service.delete_account`). The users
  row stays as a blank shell (`deleted_at`, email `deleted-<id>@deleted.invalid`,
  every personal field NULL) because forecasts reference it, so scores and
  crowd stats are unchanged. Forecast notes are cleared (the lock trigger
  allows exactly that one change after a lock). Sessions, activity, reset
  links, league memberships and practice attempts are deleted. Audit entry:
  entity `account`, id + forecast count only. Deleted users are hidden from
  the admin Students list and can't sign in; the email can sign up again.
- **Guardian consent** records the parent's name, method (`signed_form` |
  `parent_email`) and date (`guardian_consent_by/_method/_date`), shown in
  the Students tab. Undo clears them. The parent's name is deliberately NOT
  in the audit entry, so deletion removes it everywhere.
- **Retention** (`db.purge_expired_personal_data`, run at every new session
  and every cold start): expired sessions and reset links, and activity
  older than 12 months, are deleted.
- **Rate limiter keys are HMAC-SHA256 of the IP/email** (`IP_HASH_KEY`), and
  expired rows are deleted on every check. Auth attempt limits
  (`rate_limit.AUTH_LIMITS`): per IP for login/sign-up/Google/reset, plus
  10 logins per 15 min per email and 3 reset emails per hour per email (over
  that, forgot-password still returns the generic answer but sends nothing).
  Off in tests only (`AUTH_RATE_LIMITS_ENABLED=false` in conftest).
- **Security headers** (CSP, X-Frame-Options, HSTS, nosniff, Referrer- and
  Permissions-Policy) are set in `vercel.json` for every path. The CSP allows
  Google Identity Services only (Google Fonts removed 2026-11-06). The GSI
  script is injected on demand by `googleAuth.loadGoogleScript` when a Google
  button mounts (sign-in panel, or sign-up after the box is ticked), so other
  pages send nothing to Google; the Privacy Policy says exactly that. Adding
  any other external
  script, font, image or frame needs a CSP change.
- `docs/incident-plan.md` is the breach plan (CERT-In 6 hours, DPDP Board).
- Known, not yet fixed (from the 2026-11-05 audit): session tokens are
  stored unhashed; FastAPI 0.115.6 pins Starlette 0.41.3 (advisories in
  form/static-file code this app doesn't use) -- upgrade with testing;
  Gmail env vars aren't set in Vercel, so reset emails don't send; Neon
  Free keeps only 6 hours of restore history.


## First-party visit counter (2026-09, replaces Google Analytics)

GA4 was removed. `POST /api/visit` (`routes/visits.py`,
`services/visits.py`) adds 1 to `page_visits_daily (day, page, count)`:
aggregate page loads per IST day per page, and nothing else -- no cookies,
IPs, user ids or URLs. `page` must be a name in `visits.PAGES` (add new
routes there), so a query string such as `?reset_token=` can never be
stored. The frontend sends one count per page load (`recordVisit` in
`lib/api.ts`). It deliberately skips the per-IP rate limiter, which stores
IP-derived keys, so bots can inflate counts. Admins see the counts at
`#/admin` (`GET /api/admin/visits`, gated by `ADMIN_EMAILS` via
`routes/deps.require_admin`). Vercel Web Analytics was considered and
rejected: the account is on Pro, where it bills per event.
