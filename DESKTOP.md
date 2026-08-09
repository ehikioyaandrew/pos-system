# Desktop app (Tauri) — offline-first

The Windows desktop build uses **local SQLite** for day-to-day POS work. Internet is only needed to sync with Supabase.

## How it works

| Mode | Data |
|------|------|
| **Desktop** | Local SQLite (`%APPDATA%\pos-system\pos.db`) via Rust commands |
| **Web (Vercel)** | Supabase `*_backup` tables (unchanged) |

On first login (or when the local DB has no matching user), the app runs **`sync_from_cloud`** once to pull users, businesses, products, and sales from Supabase `*_backup`. After that, login and sales work **offline**.

After sales / stock / debt writes, the app best-effort runs **`sync_to_cloud`**. If offline, data stays local and syncs when the connection returns (run Sync again from the app or restart/login).

## Prerequisites (Windows)

1. Node.js 18+, Rust (rustup), MSVC Build Tools, WebView2  
2. Root `.env` (same as web):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

Optional `src-tauri/.env` (or same keys without `VITE_`):

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Service role helps upserts during sync; anon key is used as fallback.

## Develop / build

```bash
npm install
npm run tauri:dev      # offline desktop window
npm run tauri:build    # MSI installer
```

Installer: `src-tauri/target/release/bundle/msi/` (or `dist-desktop/` if copied).

## Client rollout

1. Build MSI and install on the shop PC  
2. Connect to internet **once**, log in (pulls catalog + users)  
3. Disconnect — sales, stock, debt, sales log continue locally  
4. When online again, sync pushes local changes to the cloud  

Sidebar shows **Desktop** when running in the shell.

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
