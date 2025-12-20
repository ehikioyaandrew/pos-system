# Auto-Update Server Setup Guide

This guide explains how to set up an update server for your POS application to enable automatic updates across all installations.

## Overview

The auto-update feature allows your POS application to:
- Automatically check for new versions
- Download and install updates
- Restart the application after installation

## Update Server Options

You have several options for hosting your update server:

### Option 1: GitHub Releases (Recommended for Simplicity)

GitHub Releases is the easiest option if you're using GitHub for version control.

#### Setup Steps:

1. **Create a GitHub Repository** (if you don't have one)
   - Create a new repository for your POS application
   - Push your code to the repository

2. **Create a Release**
   - Go to your repository on GitHub
   - Click "Releases" → "Create a new release"
   - Tag version: `v0.1.1` (must follow semantic versioning)
   - Release title: `Version 0.1.1`
   - Description: Add release notes
   - Upload your built application files:
     - Windows: `.msi` or `.exe` installer
     - macOS: `.dmg` or `.app.tar.gz`
     - Linux: `.AppImage` or `.deb`

3. **Update tauri.conf.json**
   ```json
   "plugins": {
     "updater": {
       "active": true,
       "endpoints": [
         "https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO/releases/latest"
       ],
       "dialog": true,
       "windows": {
         "installMode": "passive"
       }
     }
   }
   ```

4. **Configure GitHub Token (Optional but Recommended)**
   - Create a GitHub Personal Access Token with `public_repo` scope
   - Add it to your environment or use it in the endpoint URL

### Option 2: Custom Update Server

For more control, you can host your own update server.

#### Server Requirements:

Your server must respond to GET requests with a JSON payload in this format:

```json
{
  "version": "0.1.1",
  "notes": "Release notes here",
  "pub_date": "2024-01-15T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "base64-encoded-signature",
      "url": "https://your-server.com/updates/pos-system-0.1.1-x64.msi"
    },
    "darwin-x86_64": {
      "signature": "base64-encoded-signature",
      "url": "https://your-server.com/updates/pos-system-0.1.1-x64.dmg"
    },
    "linux-x86_64": {
      "signature": "base64-encoded-signature",
      "url": "https://your-server.com/updates/pos-system-0.1.1-x86_64.AppImage"
    }
  }
}
```

#### Example Node.js Update Server:

```javascript
const express = require('express');
const app = express();

app.get('/api/updates/:target/:current_version', (req, res) => {
  const { target, current_version } = req.params;
  
  // Check if update is available
  const latestVersion = '0.1.1';
  const currentVersion = current_version.replace('v', '');
  
  if (compareVersions(latestVersion, currentVersion) > 0) {
    res.json({
      version: latestVersion,
      notes: 'Bug fixes and performance improvements',
      pub_date: new Date().toISOString(),
      platforms: {
        [target]: {
          signature: 'your-signature-here',
          url: `https://your-server.com/updates/pos-system-${latestVersion}-${target}.msi`
        }
      }
    });
  } else {
    res.status(204).send(); // No update available
  }
});

app.listen(3000, () => {
  console.log('Update server running on port 3000');
});
```

### Option 3: S3/Cloud Storage

You can host updates on AWS S3, Google Cloud Storage, or Azure Blob Storage.

1. Upload your release files to your cloud storage
2. Make the files publicly accessible (or use signed URLs)
3. Create a simple API endpoint that returns the update manifest
4. Update the endpoint URL in `tauri.conf.json`

## Code Signing (Important for Production)

For production applications, you should sign your updates:

### Windows:
- Use a code signing certificate
- Sign your `.msi` or `.exe` files
- Include the signature in your update manifest

### macOS:
- Sign with an Apple Developer certificate
- Notarize your application
- Include the signature in your update manifest

### Linux:
- Use GPG signing
- Include the signature in your update manifest

## Configuration

### Update tauri.conf.json

Update the endpoint URL in `pos-system/src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "endpoints": [
        "https://your-update-server.com/api/updates/{{target}}/{{current_version}}"
      ],
      "dialog": true,
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

**Variables:**
- `{{target}}`: Platform target (e.g., `windows-x86_64`, `darwin-x86_64`, `linux-x86_64`)
- `{{current_version}}`: Current application version

**Install Modes:**
- `passive`: Shows a progress dialog (recommended)
- `quiet`: Silent installation (requires admin rights)

### Update Check Frequency

The application checks for updates:
- On startup (if `autoCheck` is enabled)
- Every hour by default (configurable in `useUpdateChecker.tsx`)

You can customize this in `src/App.tsx`:

```tsx
<UpdateNotification 
  autoCheck={true} 
  showNotification={true}
/>
```

Or in `useUpdateChecker.tsx`:

```tsx
const { updateInfo } = useUpdateChecker(true, 3600000); // Check every hour
```

## Building and Releasing Updates

### 1. Build Your Application

```bash
cd pos-system
npm run tauri:build
```

This creates installers in `src-tauri/target/release/bundle/`

### 2. Version Your Release

Update the version in:
- `package.json`: `"version": "1.0.1"`
- `src-tauri/Cargo.toml`: `version = "0.1.1"`
- `src-tauri/tauri.conf.json`: `"version": "0.1.1"`

**Important:** Use semantic versioning (MAJOR.MINOR.PATCH)

### 3. Upload to Update Server

Upload the built files to your update server:
- Windows: `.msi` file
- macOS: `.dmg` or `.app.tar.gz`
- Linux: `.AppImage` or `.deb`

### 4. Create Update Manifest

Create a JSON manifest pointing to your update files (if using custom server).

## Testing Updates

1. **Build an initial version** (e.g., 0.1.0)
2. **Install and run** the application
3. **Build a new version** (e.g., 0.1.1)
4. **Upload to your update server**
5. **Restart the application** - it should detect the update
6. **Click "Install Update"** - the update should download and install

## Troubleshooting

### Updates Not Detected

1. Check that your update server is accessible
2. Verify the endpoint URL format in `tauri.conf.json`
3. Check server logs for request errors
4. Ensure version numbers follow semantic versioning

### Update Installation Fails

1. Check file permissions
2. Verify the update file is not corrupted
3. Ensure the signature matches (if using code signing)
4. Check application logs for error messages

### Update Dialog Not Showing

1. Verify `showNotification={true}` in `App.tsx`
2. Check browser console for errors
3. Ensure `autoCheck={true}` is enabled

## Security Considerations

1. **HTTPS Only**: Always use HTTPS for update endpoints
2. **Code Signing**: Sign your releases to prevent tampering
3. **Signature Verification**: Verify update signatures before installation
4. **Rate Limiting**: Implement rate limiting on your update server
5. **Authentication**: Consider adding authentication for update endpoints

## Example Update Server Implementation

See `examples/update-server.js` for a complete Node.js implementation.

## Support

For issues or questions:
1. Check Tauri updater documentation: https://tauri.app/v1/guides/distribution/updater
2. Review application logs
3. Check update server logs



