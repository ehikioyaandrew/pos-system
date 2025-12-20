# GitHub Releases Auto-Update Setup - Step by Step Guide

This guide will walk you through setting up automatic updates using GitHub Releases for your POS application.

## Prerequisites

- A GitHub account
- Git installed on your computer
- Your POS application code ready

---

## Step 1: Create a GitHub Repository

1. **Go to GitHub** and sign in to your account
2. **Click the "+" icon** in the top right corner
3. **Select "New repository"**
4. **Fill in the repository details:**
   - Repository name: `pos-system` (or your preferred name)
   - Description: "POS System Application"
   - Choose **Public** (required for free GitHub Releases) or **Private** (if you have GitHub Pro)
   - **DO NOT** initialize with README, .gitignore, or license (if you already have code)
5. **Click "Create repository"**

---

## Step 2: Push Your Code to GitHub

1. **Open your terminal/command prompt** in your project directory:
   ```bash
   cd pos-system
   ```

2. **Initialize Git** (if not already done):
   ```bash
   git init
   ```

3. **Add all files:**
   ```bash
   git add .
   ```

4. **Create initial commit:**
   ```bash
   git commit -m "Initial commit - POS System with auto-update"
   ```

5. **Add your GitHub repository as remote:**
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
   ```
   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual GitHub username and repository name.

6. **Push to GitHub:**
   ```bash
   git branch -M main
   git push -u origin main
   ```

---

## Step 3: Update Configuration Files

### 3.1 Update tauri.conf.json

1. **Open** `pos-system/src-tauri/tauri.conf.json`

2. **Update the updater endpoint** to use GitHub Releases API:
   ```json
   "plugins": {
     "updater": {
       "active": true,
       "endpoints": [
         "https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO_NAME/releases/latest"
       ],
       "dialog": true,
       "windows": {
         "installMode": "passive"
       }
     }
   }
   ```
   Replace `YOUR_USERNAME` and `YOUR_REPO_NAME` with your actual values.

3. **Save the file**

### 3.2 Update Version Numbers (Important!)

Make sure all version numbers match across files:

**In `package.json`:**
```json
{
  "version": "0.1.0"
}
```

**In `src-tauri/Cargo.toml`:**
```toml
version = "0.1.0"
```

**In `src-tauri/tauri.conf.json`:**
```json
{
  "version": "0.1.0"
}
```

---

## Step 4: Build Your Application

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Build the application:**
   ```bash
   npm run tauri:build
   ```

   This will create installers in:
   - Windows: `src-tauri/target/release/bundle/msi/` (`.msi` file)
   - macOS: `src-tauri/target/release/bundle/dmg/` (`.dmg` file)
   - Linux: `src-tauri/target/release/bundle/appimage/` (`.AppImage` file)

3. **Note the file locations** - you'll need these for the release

---

## Step 5: Create Your First Release on GitHub

1. **Go to your GitHub repository** in a web browser

2. **Click on "Releases"** (on the right sidebar, or go to `https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/releases`)

3. **Click "Create a new release"**

4. **Fill in the release details:**
   - **Tag version**: `v0.1.0` (must start with `v` and match your app version)
   - **Release title**: `Version 0.1.0` or `Initial Release`
   - **Description**: Add release notes, for example:
     ```
     ## Initial Release
     
     - First version of POS System
     - Auto-update feature enabled
     - All core features implemented
     ```

5. **Upload your installer files:**
   - Click "Attach binaries by dropping them here or selecting them"
   - Upload the installer file(s) from Step 4:
     - For Windows: Upload the `.msi` file
     - For macOS: Upload the `.dmg` file
     - For Linux: Upload the `.AppImage` file
   - **Important**: Upload the installer files, NOT the source code

6. **Click "Publish release"**

---

## Step 6: Test the Update System

### 6.1 Install the Initial Version

1. **Download and install** the release you just created from GitHub
2. **Launch the application**

### 6.2 Create a New Version for Testing

1. **Update version numbers** to `0.1.1` in:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. **Make a small change** (optional, for testing):
   - Update the app title or add a feature
   - Commit the changes:
     ```bash
     git add .
     git commit -m "Update to version 0.1.1"
     git push
     ```

3. **Build the new version:**
   ```bash
   npm run tauri:build
   ```

4. **Create a new release on GitHub:**
   - Go to Releases → "Create a new release"
   - Tag: `v0.1.1`
   - Title: `Version 0.1.1`
   - Upload the new installer file
   - Publish release

### 6.3 Test the Update

1. **Open the installed application** (version 0.1.0)
2. **Wait a moment** - the app should automatically check for updates
3. **You should see an update notification** if everything is configured correctly
4. **Click "Install Update"** to test the update process

---

## Step 7: Optional - Add GitHub Token for Private Repos

If your repository is **private**, you need to add authentication:

1. **Create a GitHub Personal Access Token:**
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Click "Generate new token (classic)"
   - Name: `POS System Updates`
   - Select scope: `public_repo` (for public repos) or `repo` (for private repos)
   - Click "Generate token"
   - **Copy the token** (you won't see it again!)

2. **Update tauri.conf.json** to include the token:
   ```json
   "plugins": {
     "updater": {
       "active": true,
       "endpoints": [
         "https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO_NAME/releases/latest"
       ],
       "headers": {
         "Authorization": "token YOUR_GITHUB_TOKEN"
       },
       "dialog": true,
       "windows": {
         "installMode": "passive"
       }
     }
   }
   ```

   **⚠️ Security Note**: For production, consider using environment variables or a secure configuration method instead of hardcoding the token.

---

## Step 8: Future Updates Workflow

Every time you want to release an update:

1. **Update version numbers** in all three files:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. **Make your code changes** and commit:
   ```bash
   git add .
   git commit -m "Description of changes"
   git push
   ```

3. **Build the application:**
   ```bash
   npm run tauri:build
   ```

4. **Create a new GitHub release:**
   - Tag: `vX.Y.Z` (must match your version)
   - Upload the new installer
   - Add release notes
   - Publish

5. **Users will automatically receive the update** when they open the app!

---

## Troubleshooting

### Update Not Detected

1. **Check the endpoint URL** in `tauri.conf.json` - make sure it matches your repository
2. **Verify the tag name** - it must be `v` followed by the version (e.g., `v0.1.0`)
3. **Check GitHub API rate limits** - if you hit the limit, add authentication
4. **Verify the release is published** (not draft)

### Update Installation Fails

1. **Check file permissions** on the installer
2. **Verify the installer file** is not corrupted
3. **Check application logs** for error messages
4. **Ensure you have admin rights** (for Windows)

### Version Mismatch

- Make sure version numbers match in all three files
- GitHub tag must be `v` + version (e.g., version `0.1.0` = tag `v0.1.0`)

---

## Quick Reference

**Files to update for each release:**
- `package.json` → `"version": "X.Y.Z"`
- `src-tauri/Cargo.toml` → `version = "X.Y.Z"`
- `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`

**GitHub Release:**
- Tag: `vX.Y.Z`
- Upload installer file(s)
- Publish release

**Build command:**
```bash
npm run tauri:build
```

---

## Summary

✅ Your POS application now has automatic updates via GitHub Releases!

- Users will be notified when updates are available
- One-click installation
- Automatic app restart after update

Just follow the "Future Updates Workflow" (Step 8) whenever you want to release a new version.



