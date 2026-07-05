# Arukin Backend

Arukin is an advanced security monitoring and account management gateway designed for at-risk persons (vulnerable adults, the elderly, or targets of cyberstalking).

This repository (`supabase`) contains the backend infrastructure for Arukin, built on Supabase, PostgreSQL, and Deno Edge Functions.

---

## Technical Documentation

For a comprehensive breakdown of the database architecture, security policies, and subscription logic, please refer to the official documentation located in the root workspace `docs` repository.

The documentation has been completely restructured into an enterprise knowledge base containing Architecture Decision Records (ADRs) and rigorous security models.

👉 **[ArukinSec Documentation Hub](https://github.com/arukinSec/docs)**

---

## Key Highlights

- **PostgreSQL Database:** The core database storing managers, connected members, usage logs, and billing details.
- **Strict Row-Level Security (RLS):** All tables are heavily secured using PostgreSQL RLS policies. No data is accessible without a verified JSON Web Token (JWT) matching the correct manager.
- **Serverless API Proxying:** Deno Edge Functions securely inject Google OAuth tokens on the server, ensuring sensitive access tokens never reach the frontend browser context.
- **Automated Billing Logic:** Webhooks and Database Triggers seamlessly cascade subscription upgrades and enforced quotas.

---

## Local Development & Physical Branching

To prevent accidental deployments to the cloud and allow zero-risk experimentation, this project uses a physical directory-based branching model for the backend instead of standard Git checkout branch switching.

### Directory Structure as Branches
Directories within the backend space represent your development states:
* `/supabase` (or `/supabase/master` when organized): Represents the stable tracking master state.
* `/supabase/experimental` (or target sandbox name): A completely decoupled clone for testing high-risk migrations.

Check the `README.md` inside the specific branch directories (e.g., `experimental/README.md`) for explicit setup rules.

### Core Safeguards
* **NEVER** run `git pull` or `git push` inside an experimental folder unless you are deliberately syncing verified code.
* **NEVER** push migrations or deploy functions to the cloud instance (`supabase db push` or `supabase functions deploy`) from an experimental directory. Keep all changes restricted to the local Docker containers.
* **To reset**: Simply nuke the local database inside the directory using `supabase db reset`, or delete the experimental folder entirely and recopy from the stable master directory.

