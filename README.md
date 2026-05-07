# iiiahalab downloader

Cross-platform desktop app (Windows + macOS) that installs and updates SketchUp extensions sold on [iiiahalab.com](https://iiiahalab.com) with one click.

- Detects all SketchUp installations on the user's machine (no version hardcoded — supports any `SketchUp 20XX` folder).
- Reads each `iiiaha_*.rb` loader to extract `PLUGIN_VERSION`.
- Downloads `.rbz` from `iiiahalab.com/api/public/download/{slug}` (anonymous, no login).
- Installs/updates across all detected SketchUp versions in a single action.
- Self-updates via the Tauri Updater (minisign-signed manifest hosted on the GitHub Releases of this repo).

License verification happens inside each extension at runtime (`license.rbe`), so the downloader itself is anonymous — anyone can install, but only buyers can run.

## Tech stack

- **Tauri 2** (Rust backend + system WebView frontend)
- **Vite** + Vanilla JS/HTML/CSS (no framework)
- Design tokens follow the rules in `C:\Users\LEE\Desktop\extensions\DESIGN_RULES.md` for visual consistency with the 18 SketchUp extensions

## Repository layout

```
iiiahalabdownloader/
├── CLAUDE.md            project rules & decisions (auto-loaded by Claude Code)
├── ARCHITECTURE.md      human-readable companion to CLAUDE.md
├── README.md            this file
├── package.json
├── vite.config.js
├── index.html
├── src/                 frontend (vanilla JS)
├── src-tauri/           Rust backend
└── .github/workflows/release.yml   CI/CD: tag push → Win + Mac builds + signed release
```

## Local development

Prerequisites:
- Node.js 18+
- Rust stable (via `rustup`)
- Windows: Visual Studio 2022 with C++ Build Tools
- macOS: Xcode Command Line Tools

```bash
npm install
npm run tauri dev   # opens the app with live reload
```

## Local build (single-platform)

```bash
npm run tauri build
```

Output:
- Windows: `src-tauri/target/release/iiiahalab-downloader.exe` (portable, ~16 MB)
- Windows installer (optional): `src-tauri/target/release/bundle/msi/*.msi`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`
- macOS bundle: `src-tauri/target/release/bundle/macos/iiiahalab-downloader.app`

## Cross-platform release via GitHub Actions

The workflow at `.github/workflows/release.yml` builds Windows + macOS (universal binary) on every tag push matching `v*` and uploads signed artifacts to GitHub Releases. The Tauri Updater manifest (`latest.json`) is generated and uploaded automatically.

### One-time setup

1. Create the GitHub repository at `https://github.com/iiiaha/iiiahalabdownloader`.
2. Push this codebase: `git remote add origin git@github.com:iiiaha/iiiahalabdownloader.git && git push -u origin main`.
3. Add two repository secrets at `Settings → Secrets and variables → Actions`:
   - **`TAURI_SIGNING_PRIVATE_KEY`**: paste the contents of `C:\Users\LEE\.tauri\iiiahalab-downloader.key`.
   - **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**: empty string (no password set during dev — change later for production).

### Release a new version

```bash
# 1. Bump version in package.json AND src-tauri/Cargo.toml AND src-tauri/tauri.conf.json (all three must match)
# 2. Commit
git commit -am "release v0.1.1"
# 3. Tag and push
git tag v0.1.1
git push origin main v0.1.1
```

GitHub Actions will:
- Build Win .exe / .msi
- Build Mac universal .dmg / .app
- Sign all updater artifacts with minisign
- Generate `latest.json` with signatures + download URLs
- Create a public GitHub Release at `v0.1.1` with everything attached

Existing users of older versions will see a "Downloader v0.1.1 available" toast on next launch — clicking it auto-applies the update and restarts.

## Distribution

Users download the .exe (Windows) or .dmg (macOS) from a download page on `iiiahalab.com` (set up in a separate site session). Direct release URL pattern:

- Latest Win: `https://github.com/iiiaha/iiiahalabdownloader/releases/latest/download/iiiahalab-downloader.exe`
- Latest Mac: `https://github.com/iiiaha/iiiahalabdownloader/releases/latest/download/iiiahalab-downloader_universal.dmg`

(Asset names depend on tauri-action defaults and the `version` in package.json.)

## Security model

- The downloader does no auth — anyone can install any extension.
- License verification happens inside each extension at SketchUp runtime via `license.rbe`. Non-buyers see a "Purchase required" dialog.
- Self-update artifacts are minisign-signed; the public key is embedded in the binary at `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Tampered updates are rejected.
- v0.1 is **not OS-code-signed** (no Win EV cert / Apple Developer ID). Users will see SmartScreen / Gatekeeper warnings on first run. v0.2+ will introduce signing.

## License

Proprietary. © iiiaha.lab.
