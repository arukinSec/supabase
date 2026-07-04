# Arukin Backend

Arukin is an advanced security monitoring and account management gateway designed for at-risk persons (vulnerable adults, the elderly, or targets of cyberstalking).

This repository (`arukin-supabase`) contains the backend infrastructure for Arukin, built on Supabase, PostgreSQL, and Deno Edge Functions.

---

## Technical Documentation

For a comprehensive breakdown of the database architecture, security policies, and subscription logic, please refer to the official documentation located in the root workspace `/docs` directory:

1. **[Frontend Architecture](https://github.com/arukinSec/docs/blob/master/02_frontend_architecture.md)**
2. **[Backend Architecture](https://github.com/arukinSec/docs/blob/master/03_backend_architecture.md)**
3. **[Security Model](https://github.com/arukinSec/docs/blob/master/04_security_model.md)**
4. **[Billing & Tiers](https://github.com/arukinSec/docs/blob/master/05_billing_and_tiers.md)**

---

## Key Highlights

- **PostgreSQL Database:** The core database storing managers, connected members, usage logs, and billing details.
- **Strict Row-Level Security (RLS):** All tables are heavily secured using PostgreSQL RLS policies. No data is accessible without a verified JSON Web Token (JWT) matching the correct manager.
- **Serverless API Proxying:** Deno Edge Functions securely inject Google OAuth tokens on the server, ensuring sensitive access tokens never reach the frontend browser context.
- **Automated Billing Logic:** Webhooks and Database Triggers seamlessly cascade subscription upgrades and enforced quotas.

---

## Local Development & Deployment

Use the [Supabase CLI](https://supabase.com/docs/guides/cli) to develop and deploy:

```bash
# Pull latest remote schema
supabase db pull

# Push schema changes to remote
supabase db push

# Deploy all edge functions
supabase functions deploy
```
