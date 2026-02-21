param(
    [string]$Architecture = "x64"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Building MSIX Package ===" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Load .env file
$envFile = Join-Path $ProjectRoot ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $parts = $line -split "=", 2
            if ($parts.Length -eq 2) {
                $key = $parts[0].Trim()
                $value = $parts[1].Trim().Trim('"').Trim("'")
                [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
            }
        }
    }
}

# Read version from tauri.conf.json
$TauriConfig = Get-Content (Join-Path $ProjectRoot "src-tauri\tauri.conf.json") | ConvertFrom-Json
$AppVersion = $TauriConfig.version
# MSIX requires 4-part version
$MsixVersion = "$AppVersion.0"

# Identity from .env
$IdentityName = $env:WINDOWS_IDENTITY_NAME
$Publisher = $env:WINDOWS_PUBLISHER
$PublisherDisplayName = $env:WINDOWS_PUBLISHER_DISPLAY_NAME

if (-not $IdentityName -or -not $Publisher) {
    Write-Host "ERROR: WINDOWS_IDENTITY_NAME and WINDOWS_PUBLISHER must be set in .env" -ForegroundColor Red
    exit 1
}

Write-Host "  App: ReDD Do v$AppVersion" -ForegroundColor White
Write-Host "  Architecture: $Architecture" -ForegroundColor White
Write-Host "  Identity: $IdentityName" -ForegroundColor White
Write-Host ""

# Map architecture names
$archMap = @{ "x64" = "x64"; "arm64" = "arm64"; "x86" = "x86" }
$tauriTarget = @{ "x64" = "x86_64-pc-windows-msvc"; "arm64" = "aarch64-pc-windows-msvc" }
$msixArch = $archMap[$Architecture]
$target = $tauriTarget[$Architecture]

# Find the built Tauri exe
$tauriExe = Join-Path $ProjectRoot "src-tauri\target\$target\release\redd-do.exe"
if (-not (Test-Path $tauriExe)) {
    Write-Host "ERROR: Tauri exe not found at $tauriExe" -ForegroundColor Red
    Write-Host "Run 'npm run build:win' first." -ForegroundColor Yellow
    exit 1
}

# Find makeappx.exe
$makeappx = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe" -ErrorAction SilentlyContinue |
Sort-Object FullName -Descending |
Select-Object -First 1

if (-not $makeappx) {
    Write-Host "ERROR: makeappx.exe not found. Install Windows SDK." -ForegroundColor Red
    exit 1
}

Write-Host "  makeappx: $($makeappx.FullName)" -ForegroundColor Gray

# Create staging directory
$stagingDir = Join-Path $ProjectRoot "msix-build"
if (Test-Path $stagingDir) { Remove-Item $stagingDir -Recurse -Force }
New-Item -ItemType Directory -Path $stagingDir | Out-Null
$assetsStaging = Join-Path $stagingDir "Assets"
New-Item -ItemType Directory -Path $assetsStaging | Out-Null

Write-Host ""
Write-Host "  [1/4] Generating icon assets..." -ForegroundColor Gray

# Generate scaled icon assets using sharp via node
$sourceIcon = Join-Path $ProjectRoot "assets\1024x1024.png"
$iconScript = @"
const sharp = require('sharp');
const path = require('path');
const src = '$($sourceIcon -replace '\\','/')';
const out = '$($assetsStaging -replace '\\','/')';

async function gen() {
    const sizes = [
        { name: 'StoreLogo.scale-100.png', w: 50, h: 50 },
        { name: 'StoreLogo.scale-200.png', w: 100, h: 100 },
        { name: 'StoreLogo.scale-400.png', w: 200, h: 200 },
        { name: 'Square44x44Logo.scale-100.png', w: 44, h: 44 },
        { name: 'Square44x44Logo.scale-200.png', w: 88, h: 88 },
        { name: 'Square44x44Logo.scale-400.png', w: 176, h: 176 },
        { name: 'Square150x150Logo.scale-100.png', w: 150, h: 150 },
        { name: 'Square150x150Logo.scale-200.png', w: 300, h: 300 },
        { name: 'Square150x150Logo.scale-400.png', w: 600, h: 600 },
        { name: 'SmallTile.scale-100.png', w: 71, h: 71 },
        { name: 'SmallTile.scale-200.png', w: 142, h: 142 },
        { name: 'SmallTile.scale-400.png', w: 284, h: 284 },
        { name: 'LargeTile.scale-100.png', w: 310, h: 310 },
        { name: 'LargeTile.scale-200.png', w: 620, h: 620 },
        { name: 'LargeTile.scale-400.png', w: 1024, h: 1024 },
    ];
    const targetSizes = [16, 24, 32, 48, 256];

    for (const s of sizes) {
        await sharp(src).resize(s.w, s.h).toFile(path.join(out, s.name));
    }

    // Wide tile
    for (const [suffix, w, h] of [['scale-100', 310, 150], ['scale-200', 620, 300], ['scale-400', 1240, 600]]) {
        const iconH = h;
        const iconBuf = await sharp(src).resize(iconH, iconH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
        await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
            .composite([{ input: iconBuf, gravity: 'center' }])
            .toFile(path.join(out, 'Wide310x150Logo.' + suffix + '.png'));
    }

    // Target sizes for taskbar
    for (const sz of targetSizes) {
        const buf = await sharp(src).resize(sz, sz).toBuffer();
        await sharp(buf).toFile(path.join(out, 'Square44x44Logo.targetsize-' + sz + '.png'));
        await sharp(buf).toFile(path.join(out, 'Square44x44Logo.targetsize-' + sz + '_altform-unplated.png'));
    }

    console.log('Icons generated.');
}
gen().catch(e => { console.error(e); process.exit(1); });
"@
$tempScript = Join-Path $stagingDir "_gen_icons.js"
$iconScript | Out-File -FilePath $tempScript -Encoding utf8
node $tempScript
if ($LASTEXITCODE -ne 0) { exit 1 }
Remove-Item $tempScript

Write-Host "  [2/4] Creating AppxManifest.xml..." -ForegroundColor Gray

# Create AppxManifest.xml
$manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package 
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  
  <Identity 
    Name="$IdentityName" 
    Publisher="$Publisher" 
    Version="$MsixVersion" 
    ProcessorArchitecture="$msixArch" />
  
  <Properties>
    <DisplayName>ReDD Do</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.scale-100.png</Logo>
  </Properties>
  
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  
  <Applications>
    <Application Id="App" Executable="redd-todo.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements 
        DisplayName="ReDD Do" 
        Description="Keep your goals in sight and get back to what you wanted to do"
        BackgroundColor="transparent" 
        Square150x150Logo="Assets\Square150x150Logo.scale-100.png"
        Square44x44Logo="Assets\Square44x44Logo.scale-100.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.scale-100.png" Square71x71Logo="Assets\SmallTile.scale-100.png" Square310x310Logo="Assets\LargeTile.scale-100.png" />
        <uap:SplashScreen Image="Assets\Square150x150Logo.scale-200.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
$manifest | Out-File -FilePath (Join-Path $stagingDir "AppxManifest.xml") -Encoding utf8

Write-Host "  [3/4] Staging files..." -ForegroundColor Gray

# Copy the Tauri exe
Copy-Item $tauriExe $stagingDir
Rename-Item (Join-Path $stagingDir "redd-do.exe") "redd-todo.exe"
Write-Host "    Copied redd-do.exe -> redd-todo.exe ($([math]::Round((Get-Item $tauriExe).Length / 1MB, 1)) MB)" -ForegroundColor Gray

# Copy WebView2Loader.dll if present
$wv2Loader = Join-Path $ProjectRoot "src-tauri\target\$target\release\WebView2Loader.dll"
if (Test-Path $wv2Loader) {
    Copy-Item $wv2Loader $stagingDir
    Write-Host "    Copied WebView2Loader.dll" -ForegroundColor Gray
}

# Copy any resource files from the bundle
$resourceDir = Join-Path $ProjectRoot "src-tauri\target\$target\release\resources"
if (Test-Path $resourceDir) {
    Copy-Item $resourceDir $stagingDir -Recurse
    Write-Host "    Copied resources/" -ForegroundColor Gray
}

Write-Host "  [4/4] Creating MSIX package..." -ForegroundColor Gray

# Output path
$distDir = Join-Path $ProjectRoot "for-distribution\$target"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }
$msixPath = Join-Path $distDir "ReDD_Do_${MsixVersion}_${msixArch}.msix"

# Run makeappx
& $makeappx.FullName pack /d $stagingDir /p $msixPath /o
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: makeappx failed" -ForegroundColor Red
    exit 1
}

$msixSize = [math]::Round((Get-Item $msixPath).Length / 1MB, 1)
Write-Host ""
Write-Host "=== MSIX package created ===" -ForegroundColor Green
Write-Host "  $msixPath" -ForegroundColor White
Write-Host "  Size: $msixSize MB" -ForegroundColor White
Write-Host ""
Write-Host "Note: This package is unsigned. For Microsoft Store submission," -ForegroundColor Yellow
Write-Host "Microsoft will sign it automatically when you upload." -ForegroundColor Yellow
