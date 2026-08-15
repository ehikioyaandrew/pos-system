# Scheduled sales emails (free)

Supabase **Auth email** only handles login / password reset. It cannot send daily reports.

We use **[Resend](https://resend.com)** (free: 100 emails/day, 3,000/month) from GitHub Actions.

## What gets sent

| When | What |
|------|------|
| Every day **8:00am Africa/Lagos** | **Two emails:** (1) yesterday’s sales with before / sold / left (2) out of stock + low stock |
| Every **Monday 8:00am** | Weekly sales email as well |

Each business gets its **own** email (name, address, brand colour).

Inside the email, **normal price** and **staff price** are separate tables and totals.

Recipients: the business email plus every active user on that business who has an email (owner and staff).

## One-time setup

1. Create a free account at https://resend.com  
Do **not** put the key in code. Dashboard → API Keys → copy `re_...` into GitHub secret `RESEND_API_KEY`.

| Secret | Value |
|--------|--------|
| `RESEND_API_KEY` | `re_...` |
| `RESEND_FROM` | `POS Reports <onboarding@resend.dev>` for testing, or `POS Reports <reports@yourdomain.com>` after you verify a domain |
| `VITE_SUPABASE_URL` | already set |
| `SUPABASE_SERVICE_ROLE_KEY` | already set |

4. Actions → **Scheduled sales emails** → **Run workflow** → `daily` to test

Until a domain is verified, Resend only delivers to **your Resend login email**. The sender detects that and sends all reports there so the test still works.

To mail staff for real: [verify a domain](https://resend.com/domains), then set `RESEND_FROM` to `POS Reports <reports@yourdomain.com>`.

## Preview

In the web app: **Reports** → **Email preview** (same layout as the email).
