# Vitae

Build ATS-ready resumes in minutes, tailored to each job. Save your details once, then create a resume for any role: Vitae fills it in, picks the experience that fits the job, and checks that an applicant tracking system can read the result.

A native, offline-first desktop app built with Tauri, React and TypeScript. Your resumes are compiled with LaTeX, so they look sharp and print cleanly.

![Vitae](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## ✨ What Vitae does

- 🗂️ **Your details, saved once** - Personal info is shared by every resume. Experience, projects, education and skills live in a library you can add to and edit at any time.
- 🎭 **Profiles** - Save a version of your resume for each kind of job (say "Backend engineer" and "Data analyst") with its own headline, summary and choice of entries.
- 🎯 **Tailor to a job** - Pick a role, paste a job description, or both. Vitae chooses the entries and bullets that fit best, puts the strongest skills first, and shows which of the job's key terms your resume covers, which you have but left out, and which aren't in your details.
- 🤖 **Optional AI wording help** - Add your own Anthropic, OpenAI or Google Gemini API key, choose from the models your key can use, and Vitae suggests tighter wording. You review every change, and suggestions that add numbers or tools your original didn't mention start unticked.
- ✅ **ATS check** - Reads your compiled PDF the way a parser does and reports on readable text, garbled characters, contact details, standard headings, dates and length.
- 📄 **ATS-friendly templates** - Single-column layouts with extractable text. Import your own `.tex` template if you prefer.
- 👀 **Live preview and export** - The page updates beside the form as you type. Export the PDF anywhere.
- 🧰 **LaTeX set up for you** - One-click MiKTeX install on Windows, matching instructions on macOS and Linux, automatic installation of missing packages, and a package manager that shows what takes up space.
- 🔒 **Local by default** - Everything is stored on your computer. Nothing is uploaded unless you use AI help.
- 🔄 **Updates** - Stable and beta channels, with in-app updates on Windows.

## 🧭 How it works

1. **Add your details once.** Open **My details** (the person icon at the top right). Fill in your personal info, add your jobs, projects, education and skills, and create one or more profiles. Already have a resume in Vitae? Import its entries instead of retyping them.
2. **Start a resume.** Click **New resume**, choose a profile and a template, and optionally tailor it to a job. The resume opens filled in, ready to polish in the form.
3. **Check it.** Click **ATS check** under the preview to see how a parser would read the PDF.
4. **Export.** Click **Export PDF**.

## 🛠️ Getting Vitae

**Windows:** download the latest installer from the [releases page](https://github.com/TheJonathanC/vitae/releases). On first launch the setup guide offers to install LaTeX (MiKTeX) for you, for your account only, with no administrator rights.

**macOS and Linux:** build from source (below). The setup guide shows how to install LaTeX on your system.

## 🛠️ Prerequisites (building from source)

### 1. Node.js
- Download from [nodejs.org](https://nodejs.org/)
- Version 16 or higher recommended

### 2. Rust
- Download from [rustup.rs](https://rustup.rs/)
- Required for building Tauri applications

### 3. LaTeX distribution
Using the built app? Skip this: Vitae's setup guide handles it, and missing packages are installed automatically when a template needs them.

Installing it yourself instead? Choose one for your operating system:

**Windows - MiKTeX (Recommended)**
- Download from [miktex.org](https://miktex.org/download)
- Smaller installation, downloads packages as needed
- If packages don't install on their own, open MiKTeX Console, choose **Updates**, then **Check for updates** once

**macOS - BasicTeX or MacTeX**
- **BasicTeX (Recommended, ~100MB)**: install via Homebrew:
  ```bash
  brew install --cask basictex
  sudo tlmgr update --self
  sudo tlmgr install collection-latexextra
  ```
- **MacTeX (Complete, ~4GB-5GB)**: `brew install --cask mactex-no-gui` or download from [tug.org/mactex](https://www.tug.org/mactex/).

**Linux - TeX Live**
- **Debian / Ubuntu**: `sudo apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended`
- **Fedora**: `sudo dnf install texlive-scheme-medium`
- **Arch Linux**: `sudo pacman -S texlive-core texlive-latexextra`

Verify with:
```bash
pdflatex --version
```

## 🚀 Development

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

4. **Run the tests**
```bash
# Frontend and release-script tests (Vitest)
npm test

# Backend Rust tests
cargo test --manifest-path src-tauri/Cargo.toml
```

5. **Build for production**
```bash
npm run tauri build
```

The built application is in `src-tauri/target/release/bundle/`.

### Installer artwork and icons
The Windows installer and app icon are generated by `src-tauri/installer/render-art.py`. See [ICON-GUIDE.md](ICON-GUIDE.md).

## 🍎 Running & Building on macOS

Vitae runs natively on macOS (Apple Silicon and Intel) using the system WKWebView.

### 1. Install prerequisites via Homebrew
```bash
brew install node
brew install --cask basictex
sudo tlmgr update --self
sudo tlmgr install collection-latexextra
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Run Vitae
```bash
git clone https://github.com/TheJonathanC/vitae.git
cd vitae
npm install
npm run tauri dev
```

### 3. Build a standalone app and `.dmg`
```bash
npm run tauri build
```

The build produces:
- **Installer DMG**: `src-tauri/target/release/bundle/dmg/Vitae_*.dmg`
- **Application bundle**: `src-tauri/target/release/bundle/macos/Vitae.app`

Drag `Vitae.app` to `/Applications`. Vitae finds `pdflatex` in the standard locations (`/Library/TeX/texbin`, `/opt/homebrew/bin`, `/usr/local/bin`).

## 📖 Usage

### My details
Open **My details** to manage what Vitae knows about you:
- **Personal** - name, contact details, links, a default headline and summary. These are the same on every resume.
- **Experience, Projects, Education, Skills** - add as many entries as you like, with as many bullet points as you like (one per line). Edit or delete them any time.
- **Profiles** - a named selection from your library with its own headline and summary. Make one per kind of job.

Changing a saved entry doesn't change resumes you already created: each resume gets its own copy.

### Creating a resume
1. Click the resume name at the top left and choose **New resume**.
2. Give it a name only you will see, such as "Backend engineer, Acme".
3. Under **Start from**, choose a profile, everything you've saved, or a blank resume. Choose a template.
4. Optionally open **Tailor to a job**:
   - Choose a **Role**, paste a **Job description**, or both.
   - The preview shows how much of the job's key terms the resume covers and lists them as on your resume, in your details but left out, or not in your details. Add the missing ones from the form only if they're true.
   - Vitae only selects and reorders what you've saved. It never writes new claims.
   - If you've set up AI help, tick **Improve the wording with AI** to get suggested rewrites. You'll see each original next to its suggestion and choose what to keep.

### Editing
Fill in the form, or switch to **LaTeX source** at the top of the editor. Editing the source by hand pauses the form so later form changes can't overwrite your edits; **Replace source with form** discards the manual edits and returns to the form.

### Previewing
The preview updates a moment after you stop typing. If a build fails, the bar under the preview says so; **See errors** lists what went wrong, with line numbers that are also marked in the LaTeX source. Turn off **Auto-update** to build only when you click **Update preview**.

### ATS check
Click **ATS check** under the preview. Vitae extracts the text from your compiled PDF and checks that it can be read, has no garbled characters, includes an email and phone number, starts with your name, uses standard headings (Experience, Education, Skills), shows dates and isn't too long. It also checks the LaTeX for layouts parsers struggle with: columns, images, icon fonts and tables. Different systems behave differently, so treat the result as a strong hint rather than a guarantee.

### Changing the look
Click the template name at the top (for example **Modern Professional**) to switch templates or import your own `.tex` file. Your content stays the same.

### Exporting
Click **Export PDF** in the bar under the preview and choose where to save it.

### AI help (optional)
Open **Settings → AI assistant**, paste an Anthropic (`sk-ant-…`), OpenAI (`sk-…`) or Google Gemini (`AIza…`) API key and choose **Check key**. Vitae asks the provider which models your key can use and recommends a balanced one. Pick a model and save. You can change the model or remove the key at any time.

### LaTeX packages
Open **Settings → Manage LaTeX packages** to see how much space your LaTeX installation uses and how much each package takes. Remove packages you don't need; a template that needs one will usually install it again.

### Settings
**Settings** also switches between the Stable and Beta release channels and checks for updates.

## 🔒 Privacy and security

- **Local data.** Resumes, your details and profiles are stored in a SQLite database on your computer.
- **AI help is opt-in.** Nothing leaves your computer unless you tick the AI option for a resume. Then the bullets you chose and the job description are sent to your provider. The request is made by Vitae's backend, so the key never reaches the app's web view.
- **Your API key** is stored in `ai_settings.json` in Vitae's data folder, readable only by your account on macOS and Linux. It isn't encrypted. Remove it any time under **Settings → AI assistant**. Error messages never include the key.
- **Provider terms.** What a provider does with the text you send is up to them. For example, on Google's free Gemini tier it may be used to improve their products, so check your plan's terms before sending anything sensitive.
- **AI guardrails.** The prompt forbids adding facts, and Vitae drops answers for bullets it didn't ask about. Any suggestion that adds a number or named tool is flagged and unticked. These checks reduce the risk but can't replace reading what you submit.
- **Compilation sandbox.** `pdflatex` runs with shell escape disabled and, on TeX Live and MacTeX, with `openin_any=p` and `openout_any=p`, so a document or imported template can't read or write files outside the compile directory (for example, it can't embed `~/.ssh` keys in a PDF). Each pass is stopped after 120 seconds so an infinite loop can't hang the app. MiKTeX doesn't honour `openin_any`; shell escape is still disabled there.
- **Automatic package installs.** To build a template, Vitae may install missing packages from the official MiKTeX or TeX Live repositories.
- **MiKTeX setup.** The one-click installer downloads MiKTeX's own setup tool over HTTPS and runs it in user mode. That tool isn't code-signed, so the download's integrity rests on HTTPS and MiKTeX's own package checks.

## 🔄 Release channels and CI/CD

Vitae has a GitHub Actions pipeline (`.github/workflows/ci-cd.yml`) and in-app release channels. The rules are written down in [RELEASING.md](RELEASING.md).

- **Stable (default).** A stable tag such as `v1.1.4` publishes `latest.json`. New installs follow this channel.
- **Beta (opt-in).** Every merge to `main` is tested and published as a pre-release of the next patch version, with the rolling `latest-beta.json` manifest.
- **Safety checks.** Betas always sort above the latest stable release, stable versions only move forward, tags are never reused, and every installer's signature is verified against the app's public key before it's published.
- **Platforms.** The pipeline builds and auto-updates **Windows** installers. On macOS and Linux, build from source; the in-app update check links to the releases page.

GitHub Actions are pinned to commit SHAs, workflow permissions are read-only except for the release job, and the update-signing key is only exposed to the signing step.

### GitHub repository secrets for auto-updates
- `TAURI_PRIVATE_KEY`: your minisign private key matching the public key in `tauri.conf.json`.
- `TAURI_KEY_PASSWORD`: password for the private key (if set).
- `GITHUB_TOKEN`: provided automatically by GitHub Actions.

## 🗂️ Project structure

```
vitae/
├── src/                          # React frontend
│   ├── components/
│   │   ├── DetailsManager.tsx    # My details: personal info, library, profiles
│   │   ├── NewDocumentDialog.tsx # New resume, tailoring and AI review
│   │   ├── AtsCheck.tsx          # ATS check dialog
│   │   ├── AiSettings.tsx        # API key and model
│   │   ├── PackageManager.tsx    # LaTeX package sizes and removal
│   │   ├── SetupGuide.tsx        # LaTeX setup, one-click on Windows
│   │   ├── ResumeForm.tsx        # The resume form
│   │   └── PDFViewer.tsx         # PDF preview
│   ├── hooks/useDetails.ts       # Loads and saves details, library, profiles
│   ├── utils/
│   │   ├── library.ts            # Profiles to resumes, ordering, import
│   │   ├── targeting.ts          # Keyword extraction and job tailoring
│   │   ├── rolePresets.ts        # Role keyword sets
│   │   ├── ats.ts                # ATS checks
│   │   ├── aiReview.ts           # Reviewing AI suggestions
│   │   └── templateEngine.ts     # Rendering resume data into LaTeX
│   └── App.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri application & commands
│   │   ├── db.rs                 # SQLite: documents, templates, details, profiles
│   │   ├── latex.rs              # Sandboxed pdflatex runner, package installs, log parsing
│   │   ├── tex_setup.rs          # MiKTeX install and package management
│   │   └── ai.rs                 # AI providers, models and saved key
│   ├── templates/                # Built-in resume templates
│   ├── installer/                # Windows installer theme and artwork generator
│   └── tauri.conf.json
├── scripts/release.mjs           # Release versioning and update-manifest rules
└── .github/workflows/ci-cd.yml   # Test, build and publish
```

## 🔧 Technologies

### Frontend
- **React 18**, **TypeScript**, **Vite**
- **Monaco Editor** - the LaTeX source editor
- **pdf.js** - PDF preview and ATS text extraction

### Backend
- **Tauri** (Rust) - desktop application framework
- **SQLite** (rusqlite) - embedded database
- **reqwest** - AI provider requests
- **pdflatex** - LaTeX compilation

## 💾 Data storage

Everything is stored in Vitae's data folder:
- **Windows**: `%APPDATA%\com.vitae.app\`
- **macOS**: `~/Library/Application Support/com.vitae.app/`
- **Linux**: `~/.local/share/com.vitae.app/`

It contains:
- `vitae.db` - resumes, templates, your personal details, your library of entries and your profiles
- `ai_settings.json` - only if you set up AI help
- `temp/` - temporary LaTeX build files

## 🎯 Roadmap

Done: saved details and profiles, role and job tailoring, ATS check, ATS-friendly templates, optional AI wording help, one-click LaTeX setup, package management.

Ideas:
- [ ] Re-tailor an existing resume to a new job
- [ ] Reorder entries within a profile
- [ ] AI help for the summary line
- [ ] Auto-updating installers for macOS and Linux
- [ ] Cover letters from the same details
- [ ] Spell checker
- [ ] Multi-file project support
- [ ] Custom themes

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
- [pdf.js](https://mozilla.github.io/pdf.js/) - PDF rendering and text extraction
- [MiKTeX](https://miktex.org/) / [TeX Live](https://www.tug.org/texlive/) - LaTeX distributions

## 📧 Contact

For questions or feedback, please open an issue on GitHub.

---

**Made with ❤️ using Tauri and React**
