# NFC Attendance & Payroll — Database-Backed Cloudflare Version

This version keeps the professional NFC Attendance UI but moves employees, attendance, payroll inputs, and passwords to **Cloudflare Workers + D1** instead of browser localStorage. Cloudflare D1 is a managed SQL database that can be bound directly to a Worker.

## Included
- Admin and employee accounts
- NFC Time In / Time Out
- Daily attendance by selected date
- Employee photo and position
- Daily and weekly salary types
- Per-employee salary rate and overtime rate
- Employee self-service dashboard
- Password change with hashed passwords
- Central/shared database across devices
- One-time import of existing browser localStorage data after the first admin login
- No Export CSV/Excel button

## Cloudflare setup
1. Install Wrangler and log in:
   `npm install -g wrangler`
   `npx wrangler login`
2. Create the D1 database:
   `npx wrangler d1 create nfc-attendance-db`
3. Copy the returned database ID into `wrangler.toml` by replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
4. Apply the migration to the production database:
   `npx wrangler d1 migrations apply nfc-attendance-db --remote`
5. Deploy the Worker + website:
   `npx wrangler deploy`

The Worker serves the website from `public/` and handles `/api/*`; D1 is exposed to the Worker as the `DB` binding.

## First login
The backend creates the admin account on first database initialization.
- Username: `admin`
- Initial password: `admin123`

The login page does **not** display this password. Change it immediately after first login using **Change Password**.

## Existing local data
If the previous browser has data stored under `nfc_attendance_payroll_v1`, the first successful admin login automatically attempts a one-time import when the new D1 database is empty. The migration imports employees and attendance records and hashes employee passwords before storing them in D1.

## Important
The ZIP contains the application and D1 schema/configuration, but it cannot create a D1 database inside your Cloudflare account by itself. The database must be created/bound in your Cloudflare account using the steps above. Cloudflare documents D1 bindings and migrations here:
https://developers.cloudflare.com/d1/get-started/
