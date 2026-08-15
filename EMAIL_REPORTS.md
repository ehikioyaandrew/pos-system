# Scheduled sales emails (free)

Supabase **Auth email** only handles login / password reset. It cannot send daily reports.

We use **[Resend](https://resend.com)** (free: 100 emails/day, 3,000/month) from GitHub Actions.

## What gets sent

| When | What |
|------|------|
| Every day **9:00am Africa/Lagos** | **Two emails:** (1) yesterday’s sales with before / sold / left (2) out of stock + low stock |
| Every **Monday 9:00am** | Weekly sales email as well |

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

## Mail staff for real (do this once)

1. In Resend: **Domains** → **Add domain** (the shop’s real domain, e.g. `yourbar.com`).
2. Add the DNS records Resend shows (SPF / DKIM). Wait until status is **Verified**.
3. GitHub → repo **Settings → Secrets → Actions**:
   - Keep `RESEND_API_KEY`
   - Set `RESEND_FROM` to `POS Reports <reports@yourbar.com>` (must match the verified domain)
   - Remove or leave empty `RESEND_TEST_TO` so mail goes to staff, not only the test inbox
4. Actions → **Scheduled sales emails** → **Run workflow** → `daily`
5. Confirm owner + staff inboxes received it (check spam once)

Until step 2–3 are done, only the Resend account email will receive mail. Code already supports production sending; this is DNS + the `RESEND_FROM` secret.

## Preview

In the web app: **Email Preview** in the sidebar (same layout as the 9am emails).
