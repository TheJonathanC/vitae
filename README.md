# Vitae - LaTeX Editor

A modern, offline-first LaTeX editor built with Tauri, React, and TypeScript. Inspired by Overleaf but designed as a native desktop application with local storage and full offline capabilities.

![Vitae LaTeX Editor](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- 📝 **LaTeX Editor** - Monaco Editor with syntax highlighting and IntelliSense
- 📊 **Live PDF Preview** - Your resume updates beside the form as you type
- 💾 **Local Storage** - SQLite database for document management
- 🚀 **100% Offline** - No internet connection required
- 📄 **PDF Export** - Save compiled PDFs anywhere on your system
- 🎨 **Clean UI** - A simple form on one side, your page on the other; follows your system's light or dark theme
- ⚡ **Fast & Lightweight** - Native desktop performance with Tauri
- 🔄 **Auto-save** - Your changes are saved automatically

## 🖼️ Screenshots

### Editor View
Split-pane interface with LaTeX editor on the left and PDF preview on the right.

### Document Management
Sidebar for creating, viewing, and managing all your LaTeX documents.

## 🛠️ Prerequisites

Before running Vitae, you need to install:

### 1. Node.js
- Download from [nodejs.org](https://nodejs.org/)
- Version 16 or higher recommended

### 2. Rust
- Download from [rustup.rs](https://rustup.rs/)
- Required for building Tauri applications

### 3. LaTeX Distribution
Using the installed app? You can skip this: on first launch Vitae's setup guide installs MiKTeX for you on Windows with one click (for your account only, no administrator rights), and gives matching instructions on macOS and Linux. Afterwards, **Settings → Manage LaTeX packages** shows how much space each package uses and lets you remove the ones you don't need. Missing packages are installed automatically when a template needs them.

Installing it yourself instead? Choose one of the following for your operating system:

**Windows - MiKTeX (Recommended)**
- Download from [miktex.org](https://miktex.org/download)
- Smaller installation, auto-downloads packages as needed
- Make sure to add to PATH during installation

**macOS - BasicTeX or MacTeX**
- **BasicTeX (Recommended, ~100MB)**: Install via Homebrew:
  ```bash
  brew install --cask basictex
  sudo tlmgr update --self
  sudo tlmgr install collection-latexextra
  ```
- **MacTeX (Complete, ~4GB–5GB)**: Install via Homebrew `brew install --cask mactex-no-gui` or download from [tug.org/mactex](https://www.tug.org/mactex/).

**Linux - TeX Live**
- **Debian / Ubuntu**: `sudo apt-get install texlive-latex-base texlive-latex-extra`
- **Fedora**: `sudo dnf install texlive-scheme-medium`
- **Arch Linux**: `sudo pacman -S texlive-core texlive-latexextra`

### Verify Installation
```bash
pdflatex --version
```

## 🚀 Installation

1. **Clone the repository**
```bash
git clone https://github.com/TheJonathanC/vitae.git
cd vitae
```

2. **Install dependencies**
```bash
npm install
```

3. **Run in development mode**
```bash
npm run tauri dev
```

4. **Run automated tests**
```bash
# Frontend component tests (Vitest)
npm test

# Backend Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml
```

5. **Build for production**
```bash
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## 🍎 Running & Building on macOS

Vitae runs natively on macOS (Apple Silicon M-series and Intel Macs) using the native **WKWebView** engine and Cocoa windowing.

### 1. Install Prerequisites via Homebrew
```bash
# Install Node.js, BasicTeX, and Rust
brew install node
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install collection-latexextra
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Run Vitae Directly
```bash
git clone https://github.com/TheJonathanC/vitae.git
cd vitae
npm install
npm run tauri dev
```

### 3. Build Standalone macOS App & `.dmg`
```bash
npm run tauri build
```

The build produces:
- **Installer DMG**: `src-tauri/target/release/bundle/dmg/Vitae_1.1.2_*.dmg`
- **Application Bundle**: `src-tauri/target/release/bundle/macos/Vitae.app`

Drag `Vitae.app` to your `/Applications` folder to use Vitae like any native Mac app. Vitae automatically detects `pdflatex` in standard locations (`/Library/TeX/texbin`, `/opt/homebrew/bin`, `/usr/local/bin`).

## 🔄 Release Channels & CI/CD Pipeline

Vitae includes a GitHub Actions CI/CD pipeline (`.github/workflows/ci-cd.yml`) and in-app release channel toggling:

- **Stable Channel (default)**: When tagged as a stable release (e.g. `v1.1.2`), the pipeline generates the `latest.json` manifest. New installs follow this channel.
- **Beta Channel (opt-in)**: Every commit to `main` is automatically tested (Rust + React unit tests) and published as a pre-release of the *next* patch version (after `1.1.2`, betas are `1.1.3-beta.<build>`), with the rolling updater manifest `latest-beta.json`.
- **In-App Channel Switcher**: Users can open **⚙️ Settings** to switch between Stable and Beta channels at any time and check for updates manually or on startup.
- **Platforms**: The pipeline currently builds and auto-updates **Windows** installers only. On macOS and Linux, build from source (see above); the in-app update check links to the releases page there instead of offering a Windows installer.

GitHub Actions are pinned to commit SHAs, workflow permissions are read-only except for the release job, and the update-signing key is only exposed to the Tauri bundling step, not to the frontend build.

### GitHub Repository Secrets for Auto-Updates:
To enable automatic binary signing and generation of the updater signatures:
- `TAURI_PRIVATE_KEY`: Your minisign private key matching the public key in `tauri.conf.json`.
- `TAURI_KEY_PASSWORD`: Password for the private key (if set).
- `GITHUB_TOKEN`: Provided automatically by GitHub Actions.

## 📖 Usage

### Creating a resume
1. Click the resume name at the top left and choose **New resume** (or **New resume** on the welcome screen)
2. Give it a name only you will see, such as "Product designer, 2026"
3. Fill in the form. The section bar jumps between Details, Experience, Education, Projects, Skills and Additional sections; in a highlight, Enter starts the next one

Prefer LaTeX? Switch to **LaTeX source** at the top of the editor. Editing the source by hand pauses the form so later form changes can't overwrite your edits; **Replace source with form** discards the manual edits and goes back to the form.

### Previewing
The preview on the right updates a moment after you stop typing. If a build fails, the bar under the preview says so; **See errors** lists what went wrong, with line numbers that are also marked in the LaTeX source. Turn off **Auto-update** to build only when you click **Update preview**.

### Changing the look
Click the template name at the top (for example **Modern Professional**) to switch templates or import your own `.tex` file. Your content stays the same.

### Exporting
Click **Export PDF** in the bar under the preview and choose where to save it.

### Managing resumes
Open the menu under the resume name to switch between resumes, create a new one, or delete one. Changes save automatically as you type.

## 🗂️ Project Structure

```
vitae/
├── src/                      # React frontend
│   ├── components/           # React components
│   │   ├── Editor.tsx        # Monaco LaTeX editor
│   │   ├── PDFViewer.tsx     # PDF preview component
│   │   └── Sidebar.tsx       # Document list sidebar
│   ├── App.tsx               # Main application component
│   ├── App.css               # Application styles
│   ├── main.tsx              # React entry point
│   └── styles.css            # Global styles
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs           # Tauri application & commands
│   │   ├── latex.rs          # Sandboxed pdflatex runner & log parsing
│   │   └── db.rs             # SQLite database operations
│   ├── templates/            # Built-in resume templates (shared with the frontend)
│   ├── Cargo.toml            # Rust dependencies
│   └── tauri.conf.json       # Tauri configuration
├── index.html                # HTML entry point
├── package.json              # Node dependencies
└── vite.config.ts            # Vite configuration
```

## 🔧 Technologies

### Frontend
- **React 18** - UI framework
- **TypeScript** - Type-safe JavaScript
- **Monaco Editor** - VS Code's editor component
- **Vite** - Build tool and dev server

### Backend
- **Tauri** - Desktop application framework
- **Rust** - Systems programming language
- **SQLite** - Embedded database (via rusqlite)
- **pdflatex** - LaTeX compilation

## 💾 Data Storage

Documents are stored in a local SQLite database at:
- **Windows**: `%APPDATA%\Local\com.vitae.app\vitae.db`
- **macOS**: `~/Library/Application Support/com.vitae.app/vitae.db`
- **Linux**: `~/.local/share/com.vitae.app/vitae.db`

Temporary LaTeX compilation files are stored in:
- `{AppData}/temp/`

### Compilation sandbox
`pdflatex` runs with shell escape disabled and, on TeX Live / MacTeX, with `openin_any=p` / `openout_any=p`, so a document or imported template can't read or write files outside the compile directory (for example, it can't embed `~/.ssh` keys into a PDF). Each pass is stopped after 120 seconds, so an infinite TeX loop can't hang the app. MiKTeX doesn't honour the `openin_any` setting; shell escape is still disabled there.

## 🎯 Roadmap

- [ ] Syntax error highlighting
- [ ] LaTeX package management
- [ ] Document templates
- [ ] Multi-file project support
- [ ] Git integration
- [ ] Custom themes
- [ ] Spell checker
- [ ] BibTeX support
- [ ] Collaborative editing (optional)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [Overleaf](https://www.overleaf.com/) - Inspiration for the project
- [Tauri](https://tauri.app/) - Desktop application framework
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) - Code editor
- [MiKTeX](https://miktex.org/) / [TeX Live](https://www.tug.org/texlive/) - LaTeX distributions

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

**Made with ❤️ using Tauri and React**
