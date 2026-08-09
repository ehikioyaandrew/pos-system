# Prints base64 of the Tauri signing key for GitHub Actions secret
# TAURI_SIGNING_PRIVATE_KEY_BASE64
#
# Usage:
#   powershell -File scripts/print-signing-secret.ps1
#
# Then: GitHub → Settings → Secrets → New repository secret
#   Name:  TAURI_SIGNING_PRIVATE_KEY_BASE64
#   Value: (paste the single line printed below)

$key = Join-Path $env:USERPROFILE ".tauri\pos-system.key"
if (-not (Test-Path $key)) {
  Write-Error "Key not found at $key. Generate with: npx tauri signer generate -w `"$key`""
  exit 1
}

$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($key))
Write-Host ""
Write-Host "Secret name:  TAURI_SIGNING_PRIVATE_KEY_BASE64"
Write-Host "Secret value (copy everything on the next line):"
Write-Host $b64
Write-Host ""
Write-Host "Also delete TAURI_SIGNING_PRIVATE_KEY_PASSWORD from GitHub if it exists and the key has no password."
