# ArukinSec Agent Behavior Guidelines

This document serves as a source of truth for future autonomous agents and developers working on the ArukinSec codebase to ensure they respect the established workspace architecture.

If you are conducting a security audit, please read `audit/AUDIT_GUIDELINES.md` instead to understand intentional security designs and mitigate false positives.

## 1. Google API Proxy Architecture (Do Not Refactor)
**Do not attempt to move Google API calls (Gmail, Drive, Contacts) to the frontend.**
Because the frontend is strictly prohibited from possessing Google OAuth tokens, all third-party API interactions MUST be routed through the `google-proxy` Edge Function. The Edge Function securely attaches the tokens stored in the database. Any attempt to "optimize" network requests by calling `googleapis.com` directly from the browser will fail and compromise the architecture.

## 2. Audit Report Storage
**All audit reports must be stored in the `audit/` directory.**
Do not generate audit reports (like `AUDIT.md`) in the workspace root, `frontend/`, or `supabase/` directories. Keep the source code repositories clean and store all security, architectural, and analysis reports exclusively within the `audit/` folder.

## 3. Script Storage
**All scripts created must be stored in an appropriate `scripts/` directory.**
Do not place scratch scripts or utilities in the root of the workspace or source code directories unless explicitly instructed. Create and use a dedicated `scripts/` directory to keep the workspace organized.
