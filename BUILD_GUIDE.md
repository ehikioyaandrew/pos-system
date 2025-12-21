# Tauri Build Guide

## Build Process

The Tauri build process automatically handles the frontend build:

1. **`npm run tauri:build`** runs:
   - `beforeBuildCommand`: `npm run build` (builds frontend assets to `dist/`)
   - Then compiles Rust code
   - Bundles everything into installer (MSI on Windows)

## Build Order

The correct build order is:

```bash
# Option 1: Let Tauri handle it (recommended)
npm run tauri:build

# Option 2: Manual build (if you need to debug)
npm run build          # Build frontend assets first
npm run tauri:build    # Then build Tauri app
```

## Troubleshooting App Not Launching

### 1. Check if the app is actually running
- Open Task Manager (Ctrl+Shift+Esc)
- Look for "POS System" or "app.exe" process
- If it appears briefly then disappears, it's crashing

### 2. Enable console window for debugging

Temporarily modify `src-tauri/src/main.rs`:

```rust
// Comment out this line temporarily:
// #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  app_lib::run();
}
```

Then rebuild to see error messages.

### 3. Check Windows Event Viewer
- Press Win+R, type `eventvwr.msc`
- Go to Windows Logs → Application
- Look for errors from "POS System" or "app.exe"

### 4. Verify build output
After building, check:
- `pos-system/src-tauri/target/release/bundle/msi/` - MSI installer
- `pos-system/src-tauri/target/release/app.exe` - Direct executable

Try running `app.exe` directly to see if it works.

### 5. Common Issues

**Issue: Updater plugin blocking startup**
- ✅ Fixed: Updater plugin is now disabled in `tauri.conf.json`

**Issue: Database initialization failing**
- Check if you have write permissions in `%APPDATA%\pos-system\`
- The app creates database at: `C:\Users\YourName\AppData\Roaming\pos-system\pos.db`

**Issue: Frontend assets not found**
- Verify `dist/` folder exists after `npm run build`
- Check `dist/index.html` and `dist/assets/` folder

### 6. Clean Build

If issues persist, try a clean build:

```bash
# Clean everything
rm -rf dist
rm -rf src-tauri/target
rm -rf node_modules

# Reinstall and rebuild
npm install
npm run build
npm run tauri:build
```

### 7. Test with Debug Build

Build in debug mode to see errors:

```bash
npm run tauri:dev
```

This runs the app with console window visible.

## Build Configuration

Current settings in `tauri.conf.json`:
- `beforeBuildCommand`: `npm run build` - Runs automatically before Tauri build
- `frontendDist`: `../dist` - Location of built frontend assets
- `updater.active`: `false` - Disabled to prevent startup issues

