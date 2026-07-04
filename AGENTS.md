# ArukinSec Agent & Auditor Guidelines

This document serves as a source of truth for future autonomous agents, auditors, and developers working on the ArukinSec codebase. It clarifies intentional architectural decisions and security mechanisms that might trigger false positives in static analysis or automated audits.

## 1. Google OAuth Token Security (Column-Level Privileges)
**Do not flag the database RLS policies as leaking OAuth tokens.** 
While older migrations granted `SELECT` to `anon` and `authenticated` roles on the `members` table, **Column-Level Privileges (CLP)** were introduced in migration `20260705000000_secure_tokens_clp.sql`. This explicitly `REVOKES` read access on the `access_token` and `google_refresh_token` columns for all public users. 
Additionally, the frontend does **not** process or transmit tokens. A PostgreSQL trigger (`20260705010000_secure_tokens_trigger.sql`) on `auth.identities` securely handles extracting and storing the tokens directly on the backend.

## 2. Open Manager Self-Provisioning
**Do not flag open self-provisioning as a vulnerability.**
By design, any valid Google user who accesses the dashboard will automatically be provisioned a Manager account on the `FREE` tier. There is no invite-gate or whitelist for creating a manager account. 

## 3. The 6-Digit `auth_id` is a Routing PIN, Not a Password
**Do not flag the 6-digit auth ID for lacking rate-limiting or cryptographic complexity.**
Managers authenticate securely via Google OAuth. The 6-digit `auth_id` is merely an invite/pairing code used by members to link their connections to a specific manager. It is not used for accessing the manager dashboard or escalating privileges.

## 4. `admin_session` LocalStorage Flag (Security Theater)
**Do not flag `admin_session` as a client-side authorization vulnerability.**
The `admin_session` flag in localStorage is purely used for frontend UI routing and state toggling. The actual security boundary is robustly enforced on the backend. All Supabase Edge Functions and RLS policies rely strictly on verifying the user's identity and tier via the database using `auth.jwt() ->> 'email'`.

## 5. Seed File
A blank `seed.sql` file exists in the Supabase directory purely to satisfy Supabase CLI configuration warnings during local development. It is intentionally empty.

## 6. Migration Inventory — Check ALL Migrations Before Making Permission Claims
**Do not assess DB permissions based on a single migration.** Migrations are applied in sequence — later migrations can override earlier ones. Before claiming that a table or column is accessible to a given role, inventory all migrations and compute the net effect. The CLP migration (`20260705000000_secure_tokens_clp.sql`) post-dates the initial RLS grants and supersedes them.

## 7. Respect "By Design" Declarations
If the product owner or AGENTS.md states a behavior is intentional (open self-provisioning, admin_session flag, 6-digit auth PIN), do not re-flag it as a vulnerability. Mark it as "by design — accepted risk" in audit reports.

## 8. Verify Runtime Behavior Before Flagging Crashes
Code may look incorrect on first read but work correctly at runtime (e.g., bulk action handlers with proper try/catch/finally). If claiming a runtime crash or bug, trace the full execution path and verify state initialization. Prefer runtime verification (dev server) over static suspicion.

## 9. Token Lifecycle — Check Write Path AND Read Path Separately
OAuth token security has two independent dimensions: (a) can the browser WRITE tokens to the DB, and (b) can the browser READ tokens from the DB. Each may have different protections. Fixing one does not fix the other. Verify both independently before closing a finding.

## 10. Local Untracked Credentials Are Not Vulnerabilities
**Do not flag `.env` files or scratch credential files as "committed secrets" unless you verify they are tracked by git.**
The workspace root (`/home/phxlm/Work/websites/arukinSec`) is not a git repository. It is a local parent directory containing multiple sub-repositories (`frontend` and `supabase`). Any `.env` files, `.txt` files, or `.js` scratch files containing secrets in the workspace root or gitignored directories are purely for local development. Unless a file is explicitly tracked in version control, it is not a leak.

## 11. Google API Proxy Architecture (Do Not Refactor)
**Do not attempt to move Google API calls (Gmail, Drive, Contacts) to the frontend.**
Because the frontend is strictly prohibited from possessing Google OAuth tokens, all third-party API interactions MUST be routed through the `google-proxy` Edge Function. The Edge Function securely attaches the tokens stored in the database. Any attempt to "optimize" network requests by calling `googleapis.com` directly from the browser will fail and compromise the architecture.

## 12. Audit Report Storage
**All audit reports must be stored in the `audit/` directory.**
Do not generate audit reports (like `AUDIT.md`) in the workspace root, `frontend/`, or `supabase/` directories. Keep the source code repositories clean and store all security, architectural, and analysis reports exclusively within the `audit/` folder.

## 13. Script Storage
**All scripts created must be stored in an appropriate `scripts/` directory.**
Do not place scratch scripts or utilities in the root of the workspace or source code directories unless explicitly instructed. Create and use a dedicated `scripts/` directory to keep the workspace organized.
