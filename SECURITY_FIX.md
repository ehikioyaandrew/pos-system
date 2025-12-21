# 🔒 Security Fix: Supabase Keys Exposed

## ⚠️ CRITICAL: Rotate Your Supabase Keys Immediately

Your Supabase service role key was exposed in the GitHub repository. **You must rotate it immediately** to prevent unauthorized access.

## Step 1: Rotate Supabase Keys

1. **Go to your Supabase Dashboard**: https://supabase.com/dashboard
2. **Select your project**: `ttiubrnsgllckcpuzypn`
3. **Go to Settings** → **API**
4. **Click "Reset service_role key"** (or regenerate both keys)
5. **Copy the new keys** - you'll need them in Step 3

## Step 2: Update Your Local Configuration

1. **Navigate to** `pos-system/src-tauri/`
2. **Create a `.env` file** (copy from `.env.example`):
   ```bash
   cd pos-system/src-tauri
   cp .env.example .env
   ```
3. **Edit `.env`** and add your new keys:
   ```
   SUPABASE_URL=https://ttiubrnsgllcpuzypn.supabase.co
   SUPABASE_ANON_KEY=your-new-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-new-service-role-key
   ```

## Step 3: Verify .env is Ignored

The `.gitignore` file has been updated to exclude `.env` files from version control. Verify:
- ✅ `.env` is in `.gitignore`
- ✅ `.env.example` is committed (template only, no secrets)

## Step 4: Remove Secrets from Git History

Since the secrets were committed, you should:

1. **Remove the exposed keys from git history** (if you have access):
   ```bash
   git filter-branch --force --index-filter \
     "git rm --cached --ignore-unmatch src-tauri/src/lib.rs" \
     --prune-empty --tag-name-filter cat -- --all
   ```

2. **Or create a new repository** and start fresh (recommended for security)

3. **Force push** (⚠️ WARNING: This rewrites history):
   ```bash
   git push origin --force --all
   ```

## Step 5: Test the Application

1. **Rebuild the application**:
   ```bash
   npm run tauri:build
   ```

2. **Test cloud sync** to ensure the new keys work

## What Changed

- ✅ Secrets moved from hardcoded constants to environment variables
- ✅ Added `.env.example` template file
- ✅ Updated `.gitignore` to exclude `.env` files
- ✅ Code now reads from environment variables with fallback

## Prevention

- ✅ Never commit `.env` files
- ✅ Always use `.env.example` as a template
- ✅ Use environment variables for all secrets
- ✅ Enable GitHub secret scanning (already enabled)

## Need Help?

If you need assistance rotating keys or have questions, refer to:
- Supabase Docs: https://supabase.com/docs/guides/platform/api-keys
- GitHub Secret Scanning: https://docs.github.com/en/code-security/secret-scanning


