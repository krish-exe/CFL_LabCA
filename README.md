# SecureClinic

**Privacy-preserving appointment & health records portal.**
Cyber Security & Forensics, Lab CA, Component 2: *Design of a Mobile/Web based application incorporating a minimum of five security mechanisms.*

SecureClinic implements **14 security mechanisms** in a working web application, and every one of them can be checked by hand or with one command.

**Contents**

1. [What the website is](#1-what-the-website-is)
2. [Run it (clone → two commands)](#2-run-it)
3. [How to use the website](#3-how-to-use-the-website)
4. [CA objectives and how to verify them](#4-ca-objectives-and-how-to-verify-them)
5. [Command reference](#5-command-reference)
6. [Project structure, design notes and limitations](#6-project-structure-design-notes-and-limitations)

---

## 1. What the website is

SecureClinic is a clinic portal where **patients** book appointments with doctors and keep their medical records (prescriptions, lab reports, diagnoses) in one place. It works in a desktop browser and on a phone (responsive layout, installable as a PWA).

The design rule is *the patient decides who sees their health data*:

* **Patients** book and cancel appointments, upload lab reports, and **share their file with a chosen doctor for a limited time** (1 hour to 30 days, view-only or view-and-add). They can revoke access at any moment and see **a log of everyone who opened, or tried to open, their file**.
* **Doctors** see their schedule, confirm appointments, write visit notes, and open a patient's records **only while that patient's grant is active**. With *view & add* access they can add prescriptions, diagnoses and notes.
* **Administrators** create staff accounts, unlock accounts, reset two-factor, view security statistics and verify that the audit log hasn't been tampered with. **They cannot read any clinical data.**

Behind that, all sensitive data is encrypted with AES-256, passwords are hashed with Argon2id, doctors and admins must use two-factor authentication, and every access is written to a tamper-evident audit log.

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, responsive, PWA manifest + service worker |
| Backend | Node.js (22+), Express 5 |
| Database | PostgreSQL 18 (bundled: installed automatically with npm, no separate install) |
| File storage | Encrypted files on local disk |
| Security libraries | Helmet, argon2, jsonwebtoken, express-rate-limit, zod. TOTP and AES-GCM use Node's built-in `crypto`. |

---

## 2. Run it

**You need only [Node.js 22 or newer](https://nodejs.org)** (and Git to clone). PostgreSQL, the HTTPS certificate and all secrets are set up for you.

```bash
git clone https://github.com/krish-exe/CFL_LabCA.git
cd CFL_LabCA
npm run setup
npm start
```

Then open **https://localhost:8443**.

The HTTPS certificate is generated on your machine and is self-signed, so the browser warns once. In Chrome/Edge choose **Advanced → Continue to localhost (unsafe)**; in Firefox choose **Advanced → Accept the Risk and Continue**.

`npm run setup` does everything in one go and is safe to run again. The first run downloads the dependencies (about 150 MB on disk, mostly the bundled PostgreSQL) and takes a few minutes. It:

1. installs the dependencies, including a private PostgreSQL 18 server,
2. creates `.env` with freshly generated random secrets (JWT keys, AES-256 master key, audit HMAC key),
3. creates a self-signed ECDSA P-256 certificate in `certs/`,
4. creates and starts the database in `.data/postgres` (port 54329 by default, loopback only, with its own least-privilege user),
5. creates the tables and loads demo accounts and sample records,
6. builds the web app.

**Stopping:** `Ctrl+C` stops the web server. The database keeps running in the background so the next `npm start` is instant; stop it with `npm run db:stop`. `npm start` restarts it automatically.

**Starting over:** `npm run db:reset` wipes the data and reloads the demo accounts. To remove everything, stop the database and delete the `.data`, `storage`, `certs` folders and `.env`, then run `npm run setup` again.

<details>
<summary><b>Troubleshooting</b></summary>

* **"needs Node.js 22 or newer":** install the current LTS from nodejs.org, then run `npm run setup` again.
* **Port 8443 or 8080 already in use:** change `HTTPS_PORT` / `HTTP_PORT` in `.env`.
* **Seeing an old version after changes:** run `npm run build` again, or use `npm run dev` (hot reload on http://localhost:5173).
* **pnpm users:** `pnpm install` then `pnpm run setup`. (`pnpm setup` without `run` is a built-in pnpm command.)
* **Use your own PostgreSQL server instead of the bundled one** (optional): before `npm run setup`, run
  `PGPASSWORD=<postgres password> npm run db:create` (PowerShell: `$env:PGPASSWORD="<postgres password>"; npm run db:create`).
  It creates a least-privilege `secureclinic` role and database and writes `DATABASE_URL` to `.env`. The `postgres` password is used only for this one step and never saved.
</details>

> Never commit `.env`: it holds the encryption keys. Each machine gets its own keys, so data encrypted on one machine can't be read with another machine's `.env`.

---

## 3. How to use the website

### Demo accounts

| Role | Email | Password | Notes |
|---|---|---|---|
| Patient | `aarav.shah@secureclinic.test` | `Sunrise#Tulip77` | Has records and shares them with Dr. Mehta (view & add, 3 days) |
| Patient | `diya.patel@secureclinic.test` | `Monsoon#Lotus88` | Has shared nothing |
| Doctor (Cardiology) | `arjun.mehta@secureclinic.test` | `Cardio#Maple2026` | Can open Aarav's file |
| Doctor (Dermatology) | `ananya.iyer@secureclinic.test` | `Derma#Willow2026` | |
| Doctor (General Medicine) | `rohan.desai@secureclinic.test` | `General#Cedar2026` | No patient has shared with him |
| Administrator | `admin@secureclinic.test` | `Harbor#Lantern42` | |

You can also register new patient accounts from the sign-in page.

### Two-factor authentication (doctors and admin)

Doctors and the administrator **must** use an authenticator app. The first time they sign in, the site shows a QR code:

1. Install any authenticator app on your phone: Google Authenticator, Microsoft Authenticator, Authy, 2FAS, etc.
2. Tap **+ / Add account → Scan QR code** and scan the code on screen (or type the setup key shown next to it).
3. Enter the 6-digit code the app shows. You're signed in.

From then on, every sign-in asks for the current code from the app. Patients can turn the same protection on under **Security**.
If a doctor loses their phone, the admin can use **Accounts → Reset 2FA**, and the doctor sets it up again at next sign-in.

### As a patient

| Page | What you can do |
|---|---|
| **Overview** | Next appointment, which doctors currently have access to your records (with time left), recent records, and recent access by other people. |
| **Appointments** | **Book appointment** → pick a doctor → pick a day and a free 30-minute slot → describe the reason → request it. The doctor then confirms it. You can cancel upcoming appointments and read the doctor's visit notes. |
| **My records** | All your prescriptions, diagnoses and reports. **Upload a report** (PDF/PNG/JPEG/WebP, up to 5 MB). Download files or view images. You can delete records you uploaded yourself. |
| **Sharing** | Choose a doctor, a duration (1 hour, 1 day, 3 days, 1 week, 30 days) and *View only* or *View & add* → **Share my records**. **Revoke** ends access immediately. Past grants are listed under History. |
| **Access log** | Every time someone opened, added to, or *was blocked from* your file, with who, what and when. Tick *Include my own activity* to see your own actions too. |
| **Security** | Your profile (phone and date of birth are stored encrypted), optional two-factor, password change, and the list of devices you're signed in on, with **Sign out** per device and **Sign out everywhere**. |

### As a doctor

| Page | What you can do |
|---|---|
| **Schedule** | Upcoming and past appointments, grouped by day. **Confirm** requests, **Mark done**, **Cancel**, and add **Notes** (visible to the patient, stored encrypted). **Open file** appears when the patient has shared their records with you. |
| **My patients** | Patients with an active grant to you, with the access level and time left. |
| **Patient file** | The patient's records; download or view attachments. With *View & add* access, **Add record** (prescription, diagnosis, clinical note, lab report, imaging) with an optional attachment. Each time you open a file it is logged, and the patient sees it. |
| **Security** | Password, two-factor status (mandatory) and sessions. |

### As an administrator

| Page | What you can do |
|---|---|
| **Overview** | Counts of users, appointments and encrypted files. Security events in the last 24 hours: failed sign-ins, lockouts, blocked requests, rate-limit hits, stolen-token alerts. **Verify integrity** re-checks the whole audit log's hash chain. |
| **Accounts** | Search and filter all users. **Add staff** creates a doctor or admin with a one-time temporary password, which they must change at first sign-in, when they also set up 2FA. **Unlock** locked accounts, **Reset 2FA**, **Deactivate / Reactivate**. |
| **Audit log** | Every security-relevant event with actor, action, result, target and IP. Filter by type and outcome, and click a row to see its details and the hash-chain values. |

---

## 4. CA objectives and how to verify them

From the Lab CA evaluation scheme, Component 2 (25 marks):

| CA requirement | How SecureClinic meets it | How to check |
|---|---|---|
| A **mobile / web based application** | Responsive React web app (desktop and phone layouts) with a PWA manifest and service worker | Open the site, then press F12 → device toolbar (Ctrl+Shift+M) and pick a phone: the sidebar becomes a menu and the pages reflow |
| **Minimum of five security mechanisms** (15 marks) | **14 mechanisms**, listed below | Run **`npm run test:security`** (45 attack tests), or follow the manual checks in 4.2 |
| **Implementation and demonstration** (10 marks, with report & screencast) | Runs from a fresh clone with `npm run setup`; demo helper scripts; a suggested screencast flow (4.3) | Sections 2, 4.2 and 4.3 |

### 4.1 Verify everything at once

```bash
npm run test:security
```

This runs **45 automated security tests** against the real application over HTTPS and the real database. Each test is an attack that must fail:

```
✔ HTTPS and security headers            (CSP, HSTS, anti-framing, nosniff, no-store; TLS 1.0/1.1 refused)
✔ Password hashing and policy            (Argon2id hashes, weak/common passwords rejected)
✔ Input validation and injection         (SQL injection, XSS, mass assignment, disguised & oversized uploads)
✔ JWT authentication                     (forged role, alg:none, expired token, token-type confusion, cookie flags,
                                          refresh-token replay, sign-out & session revocation, CSRF, password change)
✔ TOTP two-factor authentication         (wrong & replayed codes, forced enrolment, encrypted secrets)
✔ Role-based access control              (patient/doctor → admin API, doctor → patient-only actions)
✔ IDOR protection and time-limited grants (guessing ids, no grant, read-only grant, expiry, revocation)
✔ AES-256-GCM encryption at rest         (ciphertext in DB, encrypted files on disk, AAD binding, tamper detection)
✔ Tamper-evident audit log               (hash chain verifies, any change breaks it, append-only trigger)
✔ Brute-force protection                 (lockout after 5 failures, IP rate limit after 10, no account enumeration)
ℹ tests 45  ℹ pass 45  ℹ fail 0
```

Test users are removed afterwards. Their audit entries stay, because the log is append-only, so run `npm run db:reset` before recording a clean demo.

### 4.2 Verify each mechanism by hand

Start the app with `npm start` and open https://localhost:8443. "DevTools" means pressing **F12** in Chrome or Edge.

<details open>
<summary><b>1. HTTPS / TLS</b>: encrypted transport, HTTP redirected, old TLS refused</summary>

* The address bar shows `https://`. Click the warning icon → *Certificate details*: issued to `localhost`, ECDSA P-256, SHA-256 (self-signed, generated by `npm run setup`).
* Open **http://localhost:8080**: you are redirected to `https://localhost:8443`.
* Old protocol versions are refused (also an automated test): `curl -k --tlsv1.1 --tls-max 1.1 https://localhost:8443/api/health` fails the handshake. (In Windows PowerShell type `curl.exe`, since `curl` there is a different command.)
* HSTS (forces HTTPS for a year): `curl -k -I https://127.0.0.1:8443/api/health` shows `Strict-Transport-Security: max-age=31536000; includeSubDomains`. It is deliberately skipped for the hostname `localhost`, because browsers would otherwise force HTTPS on every other local dev server.

Code: `server/index.js`, `scripts/bootstrap.mjs`
</details>

<details>
<summary><b>2. Security headers (Helmet)</b>: CSP, anti-clickjacking, no sniffing, no caching</summary>

* DevTools → **Network** → click any `/api/...` request → **Response Headers**. You'll find `Content-Security-Policy: default-src 'self'; script-src 'self'; … frame-ancestors 'none'; object-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, `Cache-Control: no-store`, and no `X-Powered-By`.
* The CSP in action: DevTools → **Console**, type `var s = document.createElement('script'); s.src = 'https://example.com/x.js'; document.body.append(s)` and the browser refuses to load it ("violates the following Content Security Policy directive").

Code: `server/app.js`
</details>

<details>
<summary><b>3. Password hashing (Argon2id) and password policy</b></summary>

* Click **Create an account** and type a weak password: the checklist shows what's missing and the button stays disabled. Common passwords (`Password@123`) are rejected by the server too.
* Run **`npm run demo:peek`**: the stored password is `$argon2id$v=19$m=19456,p=1,t=2$<salt>$<hash>`, never the password itself. Two users with the same password get different hashes, because of the random salt.

Code: `server/security/password.js`
</details>

<details>
<summary><b>4. JWT authentication</b>: short-lived access token + rotating refresh token</summary>

* Sign in, then DevTools → **Application → Cookies**: `sc_rt` (the refresh token) is **HttpOnly ✓, Secure ✓, SameSite Strict**, so page scripts can't read it.
* DevTools → **Application → Local/Session Storage**: empty. The access token lives only in memory, out of reach of XSS.
* DevTools → **Network** → any `/api/...` request → **Request Headers**: `Authorization: Bearer eyJ…`. Paste the token into [jwt.io](https://jwt.io), which decodes it in your browser: `typ: access`, your role, the session id `fam`, and `exp` 15 minutes after `iat`. Changing any character makes the server answer 401 (automated test: *forged role*).
* Reload the page: you stay signed in. The app silently exchanges the refresh cookie for a new access token, and the refresh token itself is **rotated** on every use. Replaying an old refresh token logs out the whole session and shows up as a *Stolen-token alert* on the admin overview (automated test: *refresh tokens rotate…*).
* **Security → Where you're signed in** lists your sessions. Signing out, or ending a session from another device, makes its access token stop working **immediately**, not just when it expires. Changing your password signs out every other device.

Code: `server/security/tokens.js`, `server/routes/auth.js`, `client/src/api.js`
</details>

<details>
<summary><b>5. TOTP two-factor authentication</b></summary>

* Sign in as `arjun.mehta@secureclinic.test`. Before you get any access, the site **forces** 2FA setup: scan the QR code with an authenticator app and enter the code.
* Sign out and in again: after the password, a **6-digit code is required**. A wrong code is rejected and counts towards the lockout, and **the same code can't be used twice**.
* As a patient: **Security → Two-factor authentication → Turn on**.
* `npm run demo:peek` (and the automated tests) show that TOTP secrets are stored encrypted.

Code: `server/security/totp.js` (RFC 6238, written from scratch with HMAC-SHA1)
</details>

<details>
<summary><b>6. Role-based access control (RBAC)</b></summary>

* Each role gets a different menu: patients don't see *Schedule* or *Accounts*, and doctors and admins don't see *My records*.
* Typing another role's address, for example `https://localhost:8443/admin` while signed in as a patient, sends you back to your own home page.
* **The server enforces it**, not just the menu: every API route checks the role, and a patient token calling `/api/admin/*` gets **403** and an `authz.role_denied` audit entry (automated tests: *Role-based access control*).
* **Separation of duties:** sign in as the admin. There is no page or API to read records, diagnoses or appointment reasons.

Code: `server/middleware/auth.js` (`requireRole`)
</details>

<details>
<summary><b>7. AES-256-GCM field-level encryption</b> and <b>8. encrypted file storage</b></summary>

* Run **`npm run demo:peek`**. For a patient and their records it prints what is **stored in the database** (`v1:<iv>:<tag>:<ciphertext>`) next to what the **app decrypts** (phone, date of birth, record titles, diagnoses, descriptions). Appointment reasons, visit notes and TOTP secrets are encrypted the same way.
* Uploaded files: open the `storage/uploads` folder. Files have random names, end in `.bin`, and their content is unreadable (`demo:peek` shows that their first bytes are not `%PDF-`). Download the same record in the app and the PDF opens normally. Each file has its own AES-256 key, stored wrapped by the master key (envelope encryption), and a SHA-256 checksum is verified on every download.
* Automated tests also show that a ciphertext copied into another row fails to decrypt (it is bound to its row id) and that flipping a single bit is detected.

Code: `server/security/crypto.js`, `server/routes/records.js`
</details>

<details>
<summary><b>9. IDOR protection</b> and <b>10. time-limited consent</b></summary>

1. Sign in as **Dr. Arjun Mehta** → *My patients* → **Aarav Shah**. Note the address: `/patients/<Aarav's id>`. Copy it.
2. Sign in (another browser or a private window) as **Dr. Rohan Desai**, who has no grant, and paste that address: **"This file isn't shared with you"**. The API returns 404, the same answer as for an id that doesn't exist, so ids can't even be probed.
3. Sign in as **Aarav** → **Access log**: Dr. Desai's attempt is listed as *Blocked*.
4. As Aarav → **Sharing** → **Revoke** Dr. Mehta's access. Dr. Mehta reloads the patient file: access is gone. Share again for **1 hour, View only**: Dr. Mehta sees it with a countdown, and *Add record* is not offered.
5. Grants end on their own at the expiry time (automated test: *access ends when the grant expires*).

Record ids are random UUIDs, and every request is checked against the signed-in user's own id and active grants.
Code: `server/security/access.js`, `server/routes/records.js`, `server/routes/grants.js`
</details>

<details>
<summary><b>11. Rate limiting and account lockout</b></summary>

* On the sign-in page, enter `diya.patel@secureclinic.test` with a wrong password **5 times**. The 5th attempt says **"Account locked"**, and even the correct password is refused for 15 minutes.
* Sign in as admin → **Overview** shows the failed sign-ins and the lockout → **Accounts** → Diya → **Unlock**.
* Rate limit: after **10 failed sign-ins from the same computer** within 15 minutes, across any accounts, the server answers **"Too many requests"** (HTTP 429). DevTools → Network → response headers show `RateLimit` / `RateLimit-Policy`.
* Wrong email and wrong password give the **same** message, so attackers can't find out which emails have accounts.

Code: `server/middleware/rateLimit.js`, `server/routes/auth.js`
</details>

<details>
<summary><b>12. Input validation and sanitisation</b>: SQL injection, XSS, uploads</summary>

* **SQL injection:** sign in with password `' OR '1'='1`: it's simply a wrong password. Every query uses parameters (`$1`), and malformed ids are rejected before reaching the database (400).
* **XSS:** as Dr. Mehta, add a clinical note whose description is `<img src=x onerror=alert(1)>`. It is displayed as plain text and no alert appears (React escapes output, and the CSP blocks inline scripts as a second layer). Registering with the name `<script>alert(1)</script>` is refused.
* **Uploads:** rename a `.txt` or `.html` file to `.pdf` and upload it: *"Only PDF, PNG, JPEG or WebP files are accepted."* The type is detected from the file's content, not its name. Files over 5 MB are refused.
* **Mass assignment:** unknown fields such as `"role": "admin"` in a registration request are dropped (automated test).

Code: `server/middleware/validate.js`, `server/db/pool.js`
</details>

<details>
<summary><b>13. Tamper-evident audit log</b></summary>

1. Sign in as admin → **Overview** → **Verify integrity** → *"Intact: all N entries verified"*.
2. In a terminal run **`npm run demo:tamper`**. It plays an insider with direct database access who erases *who* opened a patient record.
3. **Verify integrity** again: **"Tampering detected at entry #N: entry contents were modified after they were written."** (`npm run demo:tamper -- --delete` deletes an entry instead, and the chain reports the broken link.)
4. Put it back with `npm run demo:tamper -- --restore`.

Each entry stores `HMAC-SHA256(secret key, previous entry's hash | this entry)`. The key is not in the database, so a database insider can't recompute valid hashes. A database trigger also makes the table append-only for the application. **Audit log** (admin) and **Access log** (patient) show the entries.
Code: `server/security/audit.js`, `server/db/migrations/001_init.sql`
</details>

<details>
<summary><b>14. CSRF protection and session management</b></summary>

* The refresh cookie is `SameSite=Strict`, and the refresh and logout endpoints also require a custom `X-Requested-With` header, which another website can't send. Without it the server answers 403 (automated test: *cookie endpoints need the anti-CSRF header*).
* Sign in on two browsers. On one, **Security → Where you're signed in → Sign out** the other device (or **Sign out everywhere**). The other browser's very next action fails and returns it to the sign-in page, because every access token is tied to its session and checked on each request (automated test: *revoking one session from another device ends it immediately*).

Code: `server/middleware/auth.js`, `server/routes/auth.js`
</details>

### 4.3 Suggested screencast flow (≈ 8 minutes)

1. **Setup:** show `npm run setup` and `npm start` from a fresh clone.
2. **HTTPS & headers:** padlock and certificate, the http→https redirect, response headers in DevTools.
3. **Patient:** register (password policy), sign in, book an appointment, upload a lab report, share with a doctor for 1 hour.
4. **Encryption:** `npm run demo:peek`, showing ciphertext in the database vs what the app shows, and the unreadable file in `storage/uploads`.
5. **Doctor + 2FA:** sign in as Dr. Mehta with forced QR setup, confirm the appointment, open the shared file, add a prescription.
6. **IDOR & consent:** Dr. Desai opens Aarav's file URL and is blocked; Aarav's access log shows it; Aarav revokes Dr. Mehta and his access ends.
7. **Brute force:** 5 wrong passwords lock the account; the admin sees it on the overview and unlocks it.
8. **Audit:** Verify integrity, `npm run demo:tamper`, verify again (tampering detected), restore.
9. **Tests:** `npm run test:security`, 45 passing.

---

## 5. Command reference

| Command | What it does |
|---|---|
| `npm run setup` | One-time setup (safe to repeat): dependencies, secrets, certificate, database, demo data, build |
| `npm start` | Run the app at https://localhost:8443 (starts the database if needed) |
| `npm run dev` | Development mode with hot reload: http://localhost:5173 (API on :8443) |
| `npm run build` | Rebuild the web app after changing `client/` |
| `npm run test:security` | 45 automated security tests |
| `npm run demo:peek` | Show encrypted data as stored vs decrypted |
| `npm run demo:tamper` | Tamper with the audit log (`-- --delete`, `-- --restore`) |
| `npm run db:reset` | Wipe all data and reload the demo accounts |
| `npm run db:stop` / `npm run db:start` | Stop / start the bundled PostgreSQL |
| `npm run db:create` | Optional: use your own PostgreSQL server instead (see Troubleshooting) |

---

## 6. Project structure, design notes and limitations

```
server/
  index.js              HTTPS server (TLS 1.2+) and HTTP→HTTPS redirect
  app.js                Express app, Helmet/CSP, routes
  config.js             environment settings, refuses to start with missing or weak secrets
  security/             crypto (AES-GCM), password (Argon2id), totp, tokens (JWT), audit (hash chain), access (IDOR)
  middleware/           authentication, RBAC, CSRF, validation, rate limits, error handling
  routes/               auth, doctors, appointments, records, grants, me, admin
  db/migrations/        SQL schema: UUID keys, *_enc ciphertext columns, append-only audit trigger
client/src/             React app: pages per role, shared components
scripts/                setup, task runner, embedded database, migrations, seed, demo helpers
tests/                  automated security tests (node:test)
```

**Design notes**

* Admins can't read clinical data; doctors need the patient's time-limited consent; patients can see every access. Least privilege and transparency run through the whole design.
* The app connects to PostgreSQL as a role without superuser, create-database or create-role rights.
* Errors shown to users are generic, while details are logged on the server only. API responses are never cached.

**Limitations and possible improvements**

* The master encryption key lives in `.env`. A real deployment would keep it in a key-management service or HSM and rotate it (ciphertexts are already versioned `v1:` for this).
* The audit chain detects edits, deletions and reordering. Detecting deletion of the very newest entries would need the latest hash anchored outside the database, for example published periodically.
* There is no email verification or password-reset email, since that needs a mail server; an admin resets accounts instead.
* The certificate is self-signed for local use. A real deployment would use a CA-issued certificate (e.g. Let's Encrypt).
* Rate-limit counters are kept in memory; multiple server instances would share them through Redis.
