# Desktop auto-updates (automated)

Installed apps use **Check for updates** → download → install → restart.

Update feed:

`https://github.com/ehikioyaandrew/pos-system/releases/latest/download/latest.json`

GitHub Actions builds the MSI and **`latest.json`** — you do not edit the JSON by hand.

---

## One-time GitHub setup

1. Repo → **Settings → Actions → General → Workflow permissions** → **Read and write permissions**
2. Repo → **Settings → Secrets and variables → Actions**

### Signing key (important)

On your PC run:

```powershell
powershell -File scripts/print-signing-secret.ps1
```

Create secret:

| Name | Value |
|------|--------|
| `TAURI_SIGNING_PRIVATE_KEY_BASE64` | The single line printed by the script |

**Delete** these if present (they cause the “Missing comment / incorrect password” error with our key):

- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- old `TAURI_SIGNING_PRIVATE_KEY` (optional; base64 secret replaces it)

### App env (baked into MSI at build time)

| Name | Value |
|------|--------|
| `VITE_SUPABASE_URL` | Same as local `.env` |
| `VITE_SUPABASE_ANON_KEY` | Same as local `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service_role** key (Dashboard → Settings → API). Needed for **Sync now** upserts. |

Without these, the installed app can use a local DB but cloud sync will fail.

---

## Publish a new desktop version

```powershell
npm run release:desktop
```

Or exact version:

```powershell
node scripts/release-desktop.mjs 1.0.3
```

Watch **Actions → Publish Desktop**. When it finishes green, the release has the **x64 setup.exe** (plus `latest.json` for auto-update). Shop PCs can install or **Check for updates**.

GitHub always lists “Source code” zip/tar.gz on every tag release — that cannot be turned off. Clients should ignore those and download only the **`-setup.exe`**.

---

## If CI fails with “public key has been found, but no private key”

The workflow must pass `TAURI_SIGNING_PRIVATE_KEY` (path or key text). Ensure secret `TAURI_SIGNING_PRIVATE_KEY_BASE64` exists, then re-run / release again.

## If CI fails with “Missing comment in secret key”

1. Re-run `powershell -File scripts/print-signing-secret.ps1`
2. Update `TAURI_SIGNING_PRIVATE_KEY_BASE64` with the new paste
3. Remove `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret entirely
4. Re-run the failed workflow (or `npm run release:desktop` again)
