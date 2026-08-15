# Desktop app (Tauri) — offline-first

The Windows desktop build uses **local SQLite** for day-to-day POS work. Internet is only needed to sync with Supabase.

## How it works

| Mode | Data |
|------|------|
| **Desktop** | Local SQLite (`%APPDATA%\pos-system\pos.db`) via Rust commands |
| **Web (Vercel)** | Supabase `*_backup` tables (unchanged) |

On first login (or when the local DB has no matching user), the app runs **`sync_from_cloud`** once to pull users, businesses, products, and sales from Supabase `*_backup`. After that, login and sales work **offline**.

After sales / stock / debt writes, the app best-effort runs **`sync_to_cloud`**. If offline, data stays local and syncs when the connection returns (run Sync again from the app or restart/login).

**Sync now** pulls catalog from the cloud first, then pushes. **Existing product stock on the till is not overwritten** by cloud fridge/show/store counts — the till is source of truth until you **Close day → Sync** (push). Extra local line items that were deleted in Supabase are dropped on pull so they are not uploaded again. New sales that exist only on the till are kept. Voided (cancelled) local sales are not un-voided by an older cloud copy.

Sidebar **Close day → Sync** shows today’s Normal / Staff totals (same as the email) then pulls and pushes.

Sales log **Void** returns stock to the sale’s fridge/show location. Run `supabase/add_sale_location.sql` once in Supabase so new sales store that location in the cloud too.

**v1.0.7 (this build):** on first open it automatically removes duplicate local sale lines (same product + same price on one sale) and then pulls/pushes once when the PC is online. It does **not** wipe the whole database, so unsynced sales from today are kept.

## Prerequisites (Windows)

1. Node.js 18+, Rust (rustup), MSVC Build Tools, WebView2  
2. Root `.env` (same as web):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Optional `src-tauri/.env` (or same keys without `VITE_`):

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Release builds bake these into the binary from GitHub Actions secrets (see [UPDATES.md](./UPDATES.md)). Service role is used for sync upserts; anon alone often cannot write `*_backup` tables.

## Develop / build

```bash
npm install
npm run tauri:dev      # offline desktop window
npm run tauri:build    # MSI installer
```

Installer: `src-tauri/target/release/bundle/msi/` (or `dist-desktop/` if copied).

## Client rollout

1. Download **`POS System_*_x64-setup.exe`** from [GitHub Releases](https://github.com/ehikioyaandrew/pos-system/releases/latest)  
   (x64 only — covers normal Windows shop laptops)  
2. Right‑click → **Run as administrator**  
3. If Windows says “Windows protected your PC” / unknown publisher: **More info → Run anyway**  
   (The updater signing key is **not** a Windows install certificate — this warning is normal until you buy Authenticode code signing.)  
4. Connect to internet **once**, log in (pulls catalog + users)  
5. Disconnect — sales, stock, debt, sales log continue locally  
6. When online again, sync pushes local changes to the cloud  

Sidebar shows **Desktop** when running in the shell.

### Install failed on a new PC?

| What you see | What to do |
|--------------|------------|
| SmartScreen / unknown publisher | More info → **Run anyway**. This is expected until you buy a Windows Authenticode certificate (Sectigo/DigiCert, typically paid yearly) and sign the installer. The Tauri updater key is **not** a Windows publisher cert. Clients: right-click the `-setup.exe` → Properties → Unblock if present, then Run as administrator. |
| Needs admin / access denied | Run as administrator |
| WebView2 / blank window later | Installer embeds WebView2 bootstrapper; PC still needs internet once for that bootstrap, or install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) manually |
| 32-bit Windows only | Not supported yet — need a 64-bit Windows PC |
| MSI from an older release | Prefer the new `-setup.exe` from the latest release |

Note the **exact error text or a screenshot** — that tells us which row applies.

GitHub always shows “Source code” zip/tar.gz on releases (platform default — cannot remove). Clients should only download the **`-setup.exe`**.

## What syncs with the cloud

Push/pull includes: users, businesses, products, sales, sale items, **activity/audit logs**, **customer debts**, and **debt entries**.

Offline login writes a `LOGIN` audit row locally; sale edits write `SALE_EDITED` (and update linked debt charges). **Sync now** uploads those so the web Audit Log / Debt screens stay aligned.

## Auto-updates

Desktop builds can self-update: sidebar **Check for updates** downloads a signed release and restarts.

Full release steps: [UPDATES.md](./UPDATES.md).

## What still needs care

- Super Admin platform tools that only exist on the web may be limited offline  
- Always sync before replacing a PC so local sales/audit are not lost  

Web clients continue to use Vercel + Supabase as before.
