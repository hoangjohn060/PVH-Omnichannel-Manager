$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dist = Join-Path $root 'dist'
$installer = Join-Path $dist 'PVH-Omnichannel-Manager-Setup-x64.exe'
$inspection = Get-Content (Join-Path $dist 'release-inspection.json') -Raw | ConvertFrom-Json
$logs = Get-ChildItem (Join-Path $root 'phase08-*.log')
$logDirectory = Join-Path $dist 'logs'
$docDirectory = Join-Path $dist 'docs'
New-Item -ItemType Directory -Force $logDirectory, $docDirectory | Out-Null
$logs | Copy-Item -Destination $logDirectory -Force
Copy-Item (Join-Path $root 'phase08-audit.json') $logDirectory -Force
foreach ($name in @('INSTALLATION_GUIDE.md','OPERATION_MANUAL.md','UPDATE_DESIGN.md','PHASE-08-TEST-REPORT.md','GOOGLE_SHEETS_SETUP.md','META_APP_SETUP.md','PHASE-06-MULTIAGENT.md','SHEETS_SCHEMA.md')) {
  Copy-Item (Join-Path $root "docs/$name") $docDirectory -Force
}
$signature = Get-AuthenticodeSignature $installer
$os = Get-CimInstance Win32_OperatingSystem
$report = [ordered]@{
  generatedAt = [DateTime]::UtcNow.ToString('o')
  product = 'PVH Omnichannel Manager'
  version = $inspection.version
  appId = 'com.pvhmedia.omnichannel'
  target = 'Windows 10/11 x64 NSIS'
  buildHost = @{ caption=$os.Caption; version=$os.Version; architecture=$os.OSArchitecture }
  versions = $inspection.versions
  installer = @{ filename=(Split-Path $installer -Leaf); bytes=(Get-Item $installer).Length; sha256=(Get-FileHash $installer -Algorithm SHA256).Hash; authenticode=$signature.Status.ToString() }
  build = 'PASSED'
  productionRelease = 'BLOCKED'
  tests = @{
    typecheck='PASSED'; eslint='PASSED'; unit=@{status='PASSED';passed=110}; localIntegration=@{status='PASSED';passed=5;initialIntermittentFailure=$true};
    sourceElectron=@{status='PASSED';passed=9;skipped=1}; packagedElectron=@{status='PASSED';passed=9;skipped=1};
    installerLifecycle='NOT_TESTED'; windows11='NOT_TESTED'; reboot='NOT_TESTED'; upgrade='NOT_TESTED'; uninstall='NOT_TESTED'; liveProviders='BLOCKED'; restore='NOT_TESTED'; codeSigning='BLOCKED'; dependencyAudit='FAILED'
  }
  inspection = $inspection
  limitations = @('Not installed on a clean machine','No authorized live-provider credentials','Unsigned; possible SmartScreen warnings; no bypass','1 moderate build-chain advisory','Auto-update design only','See docs/PHASE-08-TEST-REPORT.md for full release gates')
}
$report | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $dist 'build-report.json') -Encoding UTF8
$checksumFiles = @($installer, (Join-Path $dist 'win-unpacked/PVH Omnichannel Manager.exe'), (Join-Path $dist 'win-unpacked/resources/app.asar'))
$lines = foreach ($file in $checksumFiles) {
  $relative = $file.Substring($dist.Length + 1).Replace('\','/')
  '{0}  {1}' -f (Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
$lines | Set-Content (Join-Path $dist 'checksums.sha256') -Encoding ASCII
Write-Output ($report | ConvertTo-Json -Depth 3)