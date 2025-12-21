# GitHub Updates - Quick Start Checklist

Use this checklist to quickly set up GitHub Releases for auto-updates.

## ✅ Setup Checklist

- [ ] **Step 1**: Create GitHub repository
  - [ ] Repository name: `_________________`
  - [ ] Repository URL: `https://github.com/________/________`

- [ ] **Step 2**: Push code to GitHub
  ```bash
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
  git push -u origin main
  ```

- [ ] **Step 3**: Update `src-tauri/tauri.conf.json`
  - [ ] Replace `YOUR_USERNAME` with: `_________________`
  - [ ] Replace `YOUR_REPO_NAME` with: `_________________`
  - [ ] Endpoint should be: `https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO_NAME/releases/latest`

- [ ] **Step 4**: Verify version numbers match
  - [ ] `package.json`: `"version": "0.1.0"`
  - [ ] `src-tauri/Cargo.toml`: `version = "0.1.0"`
  - [ ] `src-tauri/tauri.conf.json`: `"version": "0.1.0"`

- [ ] **Step 5**: Build application
  ```bash
  npm run tauri:build
  ```

- [ ] **Step 6**: Create first release on GitHub
  - [ ] Go to: `https://github.com/YOUR_USERNAME/YOUR_REPO_NAME/releases`
  - [ ] Click "Create a new release"
  - [ ] Tag: `v0.1.0` (must start with `v`)
  - [ ] Title: `Version 0.1.0`
  - [ ] Upload installer file (`.msi`, `.dmg`, or `.AppImage`)
  - [ ] Click "Publish release"

- [ ] **Step 7**: Test update
  - [ ] Install version 0.1.0
  - [ ] Create version 0.1.1 release
  - [ ] Verify update notification appears

## 📝 Your Repository Info

**GitHub Username:** `_________________`

**Repository Name:** `_________________`

**Full Repository URL:** `https://github.com/________/________`

**Update Endpoint:** `https://api.github.com/repos/________/________/releases/latest`

## 🔄 For Each New Release

1. [ ] Update version in `package.json`
2. [ ] Update version in `src-tauri/Cargo.toml`
3. [ ] Update version in `src-tauri/tauri.conf.json`
4. [ ] Commit and push changes
5. [ ] Run `npm run tauri:build`
6. [ ] Create new GitHub release with tag `vX.Y.Z`
7. [ ] Upload new installer file
8. [ ] Publish release

## ⚠️ Important Notes

- **Tag format**: Must be `v` + version (e.g., `v0.1.0`)
- **Version sync**: All three files must have the same version
- **File upload**: Upload the installer (`.msi`, `.dmg`, `.AppImage`), not source code
- **Public repo**: Free GitHub accounts need public repos for Releases API access

## 🆘 Need Help?

See the detailed guide: `GITHUB_UPDATE_SETUP.md`






