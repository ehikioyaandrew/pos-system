# Desktop auto-updates (automated)

Installed apps use **Check for updates** → download → install → restart.

The update feed is:

`https://github.com/ehikioyaandrew/pos-system/releases/latest/download/latest.json`

You do **not** edit that JSON by hand. GitHub Actions builds it when you publish.

---

## One-time GitHub setup

1. Repo → **Settings → Actions → General → Workflow permissions** → enable **Read and write permissions**
2. Repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Value |
|--------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | Full text of `%USERPROFILE%\.tauri\pos-system.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Leave empty (or set if you added a password) |
| `VITE_SUPABASE_URL` | Same as local `.env` |
| `VITE_SUPABASE_ANON_KEY` | Same as local `.env` |

Private key stays only in GitHub Secrets + your machine — never commit it.

---

## Publish a new desktop version (usual flow)

From a clean git state on `main` (or your release branch):

```powershell
npm run release:desktop
```

That will:

1. Bump `version` in `package.json` + `src-tauri/tauri.conf.json` (patch: `1.0.0` → `1.0.1`)
2. Commit, tag `v1.0.1`, push tag
3. Trigger **Publish Desktop** Action → Windows MSI + **`latest.json`** uploaded to the GitHub Release

Exact version:

```powershell
node scripts/release-desktop.mjs 1.2.0
```

Dry run (no git):

```powershell
node scripts/release-desktop.mjs --dry-run
```

### Or manually

1. Set `"version": "1.0.1"` in `src-tauri/tauri.conf.json`
2. `git tag v1.0.1 && git push origin v1.0.1`
3. Watch **Actions → Publish Desktop**

You can also push to a branch named `release`, or run the workflow from the Actions tab (**workflow_dispatch**).

---

## After the Action finishes

- New PCs: download the MSI from the Release page  
- Existing PCs: open the app → **Check for updates** → install → restart  

---

## Local signed build (optional)

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$env:USERPROFILE\.tauri\pos-system.key"
npm run tauri:build
```

Prefer the GitHub Action so `latest.json` is always published with the build.
