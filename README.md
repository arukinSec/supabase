# ArukinSec Backend (`arukin-supabase`)

This repository contains the backend infrastructure for ArukinSec, hosted on Supabase.

## Architecture

- **PostgreSQL Database:** The core database storing auditors, members, usage logs, and billing details.
- **Row-Level Security (RLS):** All tables are heavily secured using PostgreSQL RLS policies. No data is accessible without a verified JSON Web Token (JWT).
- **Security Definer RPCs:** Protected functions like `increment_slots` are locked down to `service_role` to prevent unauthorized execution.
- **Edge Functions (Deno):**
  - `audit-gateway`: Handles auditing logic and ownership verification.
  - `create-subscription`: Manages Stripe/Razorpay billing actions.
  - `google-proxy`: A secure server-side proxy that injects Google access tokens into requests, ensuring tokens never touch the client browser.
  - `intel-gateway`: Processes intensive intelligence/financial scanning.
  - `refresh-google-token`: Securely refreshes Google OAuth tokens when they expire.
  - `expire-pro`: A daily cron job (`pg_net` triggered) that downgrades expired PRO accounts.

## Deployment

Deploy using the Supabase CLI:

```bash
supabase db push
supabase functions deploy
```
