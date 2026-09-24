# Vitae - LaTeX Editor

A modern, offline-first LaTeX editor built with Tauri, React, and TypeScript. Inspired by Overleaf but designed as a native desktop application with local storage and full offline capabilities.

![Vitae LaTeX Editor](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ Features

- 📝 **LaTeX Editor** - Monaco Editor with syntax highlighting and IntelliSense
- 📊 **Live PDF Preview** - Split-pane view with real-time compilation
- 💾 **Local Storage** - SQLite database for document management
- 🚀 **100% Offline** - No internet connection required
- 📄 **PDF Export** - Save compiled PDFs anywhere on your system
- 🎨 **Clean UI** - Modern dark theme with intuitive interface
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
Choose one of the following:

**MiKTeX (Recommended for Windows)**
- Download from [miktex.org](https://miktex.org/download)
- Smaller installation, auto-downloads packages as needed
- Make sure to add to PATH during installation

**TeX Live**
- Download from [tug.org/texlive](https://tug.org/texlive/)
- Complete LaTeX distribution (~4GB)
- Cross-platform

### Verify Installation
```bash
pdflatex --version
```

## 🚀 Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/vitae.git
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

The built application will be in `src-tauri/target/release/`.

## 🔄 Release Channels & CI/CD Pipeline

Vitae includes a GitHub Actions CI/CD pipeline (`.github/workflows/ci-cd.yml`) and in-app release channel toggling:

- **Beta Channel (`v1.1-beta`)**: Every commit to `main` is automatically tested (Rust + React unit tests) and published as a beta release (`v1.1.0-beta.<build>`) with rolling updater manifest `latest-beta.json`.
- **Stable Channel (`v1.1+`)**: When tagged as a stable release (e.g. `v1.1.0`), the pipeline generates the `latest.json` manifest.
- **In-App Channel Switcher**: Users can open **⚙️ Settings** to switch between Beta and Stable channels at any time and check for updates manually or on startup.

### GitHub Repository Secrets for Auto-Updates:
To enable automatic binary signing and generation of the updater signatures:
- `TAURI_PRIVATE_KEY`: Your minisign private key matching the public key in `tauri.conf.json`.
- `TAURI_KEY_PASSWORD`: Password for the private key (if set).
- `GITHUB_TOKEN`: Provided automatically by GitHub Actions.

## 📖 Usage

### Creating a Document
1. Click the **+ New** button in the sidebar
2. Enter a document title
3. Start writing LaTeX code in the editor

### Compiling to PDF
1. Write your LaTeX content
2. Click the **Compile** button in the toolbar
3. PDF preview appears in the right pane

### Exporting PDF
1. Compile your document first
2. Click **Export PDF**
3. Choose a location and save

### Managing Documents
- **Select**: Click any document in the sidebar
- **Delete**: Click the 🗑️ icon on a document
- **Auto-save**: Changes save automatically as you type

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
│   │   └── db.rs             # SQLite database operations
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
