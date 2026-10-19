# PVH Omnichannel Manager 0.8.0 — Installation

Release status: BUILD AVAILABLE; NOT APPROVED FOR GENERAL PRODUCTION.

## End user (no Terminal, Docker or Node.js installation)
1. Ask your deployment administrator for the installer, independently authenticated SHA256, and the organization HTTPS Gateway origin. Do not use an unknown public Gateway.
2. On Windows 10/11 x64, run `PVH-Omnichannel-Manager-Setup-x64.exe`. Choose the installation directory in the NSIS wizard. Desktop and Start Menu shortcuts and an uninstaller are configured.
3. This artifact is **unsigned**. SmartScreen/Defender may warn. Do not disable protections or bypass organizational policy; request an approved, signed distribution from your administrator.
4. Finish the wizard and launch using the Desktop/Start Menu icon. First-run Gateway setup appears above the management workspace. Enter an HTTPS origin without a trailing slash, path, username, password or query. Save Gateway.
5. Enter the employee email/password issued by your administrator. A desktop installation does not create a server or employee automatically.
6. Follow `OPERATION_MANUAL.md` to connect channels. Missing deployment credentials and provider approval are not installer problems.

## Update and uninstall
Close the app completely using the tray Quit action before an update. Back up first. Run a trusted newer installer with the same application ID. Settings and the database are stored separately in Electron userData, not in app.asar or the install directory. Cross-version update preservation remains NOT_TESTED on a clean machine.

Uninstall through Windows Settings / Installed apps. This build sets `deleteAppDataOnUninstall=false`: the installer must retain user data. The actual uninstall lifecycle is NOT_TESTED. Do not manually delete userData unless an authorized operator explicitly requests erasure after backup.

## Administrator prerequisites
Deploy and operate the remote HTTPS Gateway/D1 infrastructure separately; users do not run local Docker. Provision employees and roles, encryption secrets, Facebook application/OAuth/webhook configuration, Google service-account credentials and the destination spreadsheet. See existing `META_APP_SETUP.md`, `GOOGLE_SHEETS_SETUP.md`, and `PHASE-06-MULTIAGENT.md`.

Release evidence uses UTC timestamps; the build machine local session started October 18, 2026 and evidence timestamps extend into October 19, 2026 UTC. Windows 10 Home 19045 x64 was used; Windows 11 was not available.