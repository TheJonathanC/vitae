//! pdflatex discovery, sandboxed invocation and log parsing.
//!
//! Kept free of Tauri types so it can be unit-tested on any platform.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

/// Upper bound for a single pdflatex pass. Generous because MiKTeX may download
/// missing packages on first use, but finite so an infinite TeX loop cannot
/// wedge the compiler forever.
pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

pub const LATEX_TEMP_EXTENSIONS: &[&str] = &[
    "tex", "pdf", "aux", "log", "out", "toc", "nav", "snm",
    "fls", "synctex.gz", "bbl", "blg", "idx", "ind", "ilg", "lot", "lof",
    "bcf", "run.xml", "stderr", "tools.log",
];

/// Auxiliary files that are read back on the next run and can therefore carry
/// corruption from an interrupted compile into the next one.
const AUX_EXTENSIONS: &[&str] = &["aux", "out", "toc", "nav", "snm", "bbl", "lot", "lof"];

static COMPILE_MUTEX: Mutex<()> = Mutex::new(());
static LAST_COMPILE_HASH: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);
static DETECTED_BINARY: Mutex<Option<LatexBinary>> = Mutex::new(None);

#[derive(Debug, Serialize, Deserialize)]
pub struct CompilationResult {
    pub success: bool,
    pub pdf_path: Option<String>,
    pub errors: Vec<LatexError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LatexError {
    pub line: Option<u32>,
    pub message: String,
    pub severity: String, // "error" or "warning"
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LatexBinary {
    pub path: PathBuf,
    pub is_miktex: bool,
}

fn calculate_hash<T: Hash>(t: &T) -> u64 {
    let mut s = DefaultHasher::new();
    t.hash(&mut s);
    s.finish()
}

#[allow(unused_mut)]
pub fn create_silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn probe(candidate: &Path) -> Option<LatexBinary> {
    let output = create_silent_command(candidate)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout);
    Some(LatexBinary {
        path: candidate.to_path_buf(),
        is_miktex: version.contains("MiKTeX"),
    })
}

fn candidate_paths() -> Vec<PathBuf> {
    // PATH first; GUI apps on macOS don't inherit the terminal PATH, hence the fallbacks.
    let mut candidates = vec![PathBuf::from("pdflatex")];

    #[cfg(target_os = "windows")]
    {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(&program_files).join("MiKTeX").join("miktex").join("bin").join("x64").join("pdflatex.exe"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_app_data).join("Programs").join("MiKTeX").join("miktex").join("bin").join("x64").join("pdflatex.exe"));
        }
        for year in (2020..=2028).rev() {
            candidates.push(PathBuf::from(format!(r"C:\texlive\{}\bin\windows\pdflatex.exe", year)));
            candidates.push(PathBuf::from(format!(r"C:\texlive\{}\bin\win32\pdflatex.exe", year)));
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Library/TeX/texbin/pdflatex"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/pdflatex"));
        candidates.push(PathBuf::from("/usr/local/bin/pdflatex"));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/pdflatex"));
        candidates.push(PathBuf::from("/usr/local/bin/pdflatex"));
    }

    candidates
}

/// Finds a working pdflatex. A successful probe is cached so compiles don't pay
/// for process spawns; `refresh` forces a new search (e.g. after the user
/// installs a TeX distribution).
pub fn detect_pdflatex(refresh: bool) -> Option<LatexBinary> {
    let mut cached = DETECTED_BINARY.lock().unwrap_or_else(|e| e.into_inner());
    if !refresh {
        if let Some(bin) = cached.as_ref() {
            return Some(bin.clone());
        }
    }
    let found = candidate_paths().into_iter().find_map(|candidate| {
        if candidate.components().count() > 1 && !candidate.exists() {
            return None;
        }
        probe(&candidate)
    });
    *cached = found.clone();
    found
}

/// Builds a pdflatex invocation that cannot run shell commands or read/write
/// files outside the compile directory, so an imported template can't embed
/// e.g. `~/.ssh/id_rsa` into the PDF the user later shares.
///
/// The `.tex` file is passed relative to `work_dir`: `openin_any=p` rejects
/// absolute paths, including the main input file.
pub fn sandboxed_command(bin: &LatexBinary, engine: Engine, work_dir: &Path, tex_name: &str) -> Command {
    let program = if engine == Engine::PdfLatex { bin.path.clone() } else { tool_path(bin, engine.program()) };
    let mut cmd = create_silent_command(program);
    cmd.current_dir(work_dir)
        .arg("-interaction=nonstopmode")
        .arg("-halt-on-error")
        .arg("-file-line-error")
        .arg(if bin.is_miktex { "-disable-write18" } else { "-no-shell-escape" })
        .args(if bin.is_miktex { &["--enable-installer"][..] } else { &[][..] })
        .arg(tex_name)
        // Honoured by kpathsea (TeX Live / MacTeX); MiKTeX ignores them.
        .env("openin_any", "p")
        .env("openout_any", "p")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    cmd
}

#[derive(Debug)]
pub struct PassOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RunError {
    Spawn(String),
    TimedOut,
}

/// Runs `cmd`, killing it once `timeout` elapses. stdout is drained on a
/// separate thread so a chatty process can't block on a full pipe.
pub fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<PassOutput, RunError> {
    let mut child = cmd.spawn().map_err(|e| RunError::Spawn(e.to_string()))?;
    let reader = child.stdout.take().map(|mut stdout| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stdout.read_to_end(&mut buf);
            buf
        })
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                // Don't join the reader: a grandchild could still hold the pipe open.
                return Err(RunError::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => return Err(RunError::Spawn(e.to_string())),
        }
    };

    let stdout = reader
        .and_then(|handle| handle.join().ok())
        .map(|buf| String::from_utf8_lossy(&buf).into_owned())
        .unwrap_or_default();
    Ok(PassOutput {
        success: status.success(),
        code: status.code(),
        stdout,
    })
}

// ---------------------------------------------------------------------------
// Engines
// ---------------------------------------------------------------------------

/// The TeX engine a document needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    PdfLatex,
    /// For documents that use system fonts through fontspec.
    XeLatex,
    /// Not run: LuaLaTeX's built-in Lua can read any file on disk, which would get
    /// around the sandbox Vitae puts on templates.
    LuaLatex,
}

impl Engine {
    pub fn program(self) -> &'static str {
        match self {
            Engine::PdfLatex => "pdflatex",
            Engine::XeLatex => "xelatex",
            Engine::LuaLatex => "lualatex",
        }
    }
}

/// Everything before an unescaped `%`.
fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'%' && (i == 0 || bytes[i - 1] != b'\\') {
            return &line[..i];
        }
    }
    line
}

/// Whether `\usepackage{...}` or `\RequirePackage{...}` loads `package`.
fn package_loaded(code: &str, package: &str) -> bool {
    ["\\usepackage", "\\RequirePackage"].iter().any(|command| {
        code.match_indices(command).any(|(i, _)| {
            let rest = &code[i + command.len()..];
            let Some(open) = rest.find('{') else { return false };
            let Some(close) = rest[open..].find('}') else { return false };
            rest[open + 1..open + close].split(',').any(|name| name.trim() == package)
        })
    })
}

/// The engine to start with. An explicit `% !TEX program = ...` line wins; packages
/// that can only load under LuaLaTeX mean LuaLaTeX. Otherwise pdfLaTeX, and the
/// compile switches to XeLaTeX if the log says a package needs it. Guessing from
/// `fontspec` or `\directlua` in the source would misfire on templates that support
/// several engines and only use those inside an engine check.
pub fn required_engine(source: &str) -> Engine {
    let magic = source.lines().take(30).find_map(|line| {
        let lower = line.trim().to_lowercase();
        let rest = lower.strip_prefix('%')?.trim_start().strip_prefix('!')?.trim_start().strip_prefix("tex")?.trim_start();
        let rest = rest.strip_prefix("ts-").unwrap_or(rest);
        let value = rest.strip_prefix("program")?.trim_start().strip_prefix('=')?.trim();
        match value {
            "xelatex" | "xetex" => Some(Engine::XeLatex),
            "lualatex" | "luatex" => Some(Engine::LuaLatex),
            "pdflatex" | "pdftex" | "latex" => Some(Engine::PdfLatex),
            _ => None,
        }
    });
    if let Some(engine) = magic {
        return engine;
    }
    let code: String = source.lines().map(strip_comment).collect::<Vec<_>>().join("\n");
    if package_loaded(&code, "luacode") || package_loaded(&code, "luatextra") {
        return Engine::LuaLatex;
    }
    Engine::PdfLatex
}

/// pdfLaTeX stopped because something (often a template's own class file) needs
/// XeLaTeX or LuaLaTeX.
pub fn needs_unicode_engine(output: &str) -> bool {
    let text = join_continuations(&unwrap_log(output)).to_lowercase();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    [
        "requires either xetex or luatex",
        "requires xetex or luatex",
        "requires luatex or xetex",
        "xetex or luatex is required",
        "requires xelatex",
        "compiled with xelatex",
    ]
    .iter()
    .any(|phrase| text.contains(phrase))
}

pub const LUALATEX_MESSAGE: &str = "This template needs LuaLaTeX. Vitae doesn't run LuaLaTeX because its built-in Lua can read any file on your computer, which would get around the protection Vitae puts on templates. Choose a template that works with pdfLaTeX or XeLaTeX.";

pub fn engine_missing_message(engine: Engine, bin: &LatexBinary) -> String {
    let fix = if bin.is_miktex {
        "Install the `xetex` package in MiKTeX Console under Packages, then compile again.".to_string()
    } else {
        "Install it with `tlmgr install xetex`, or your system's XeTeX package (for example `texlive-xetex`), then compile again.".to_string()
    };
    format!("This template needs XeLaTeX ({} isn't installed). {}", engine.program(), fix)
}

// ---------------------------------------------------------------------------
// What's missing
// ---------------------------------------------------------------------------

/// Most missing packages a single compile may install, so a template that pulls in
/// a long chain of them still builds but a loop can't run away.
const MAX_AUTO_INSTALLS: usize = 8;
/// Upper bound on time spent installing during one compile.
const MAX_INSTALL_TIME: Duration = Duration::from_secs(10 * 60);
/// How long a failed install is remembered, so auto-compile doesn't retry it on every edit.
const FAILED_INSTALL_COOLDOWN: Duration = Duration::from_secs(10 * 60);
const TLMGR_SEARCH_TIMEOUT: Duration = Duration::from_secs(60);
pub const MIKTEX_REPOSITORY: &str = "https://mirrors.ctan.org/systems/win32/miktex/tm/packages/";
const TLMGR_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
const PACKAGE_EXTENSIONS: &[&str] = &["sty", "cls", "clo", "def", "fd", "cfg", "ldf", "tex"];
const FONT_EXTENSIONS: &[&str] = &["tfm", "pfb", "enc", "vf", "map", "otf", "ttf", "afm"];

fn extension(name: &str) -> Option<&str> {
    name.rsplit_once('.').map(|(_, ext)| ext)
}

fn is_plain_tex_file(name: &str) -> bool {
    let ext_ok = name.rsplit_once('.').map_or(false, |(stem, ext)| {
        !stem.is_empty() && (PACKAGE_EXTENSIONS.contains(&ext) || FONT_EXTENSIONS.contains(&ext))
    });
    ext_ok
        && name.len() <= 100
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
}

pub fn is_font_file(name: &str) -> bool {
    extension(name).is_some_and(|ext| FONT_EXTENSIONS.contains(&ext))
}

/// A file LaTeX needs that a TeX distribution may provide, named the way the
/// distribution ships it. Covers missing packages and classes (`File `x.sty' not
/// found`), babel languages (`language definition file x.ldf`), font metrics
/// (`Font ...=name at 10pt not loadable`) and font files pdfTeX can't open.
/// Only plain file names are returned because they are handed to `tlmgr` and `mpm`.
pub fn parse_missing_file(output: &str) -> Option<String> {
    let text = unwrap_log(output);
    for line in text.lines() {
        let candidate = if line.contains("not found") && line.contains("File `") {
            line.split("File `").nth(1).and_then(|r| r.split('\'').next()).map(str::to_string)
        } else if line.contains("not loadable: Metric (TFM) file not found") {
            line.split('=').nth(1).and_then(|r| r.split_whitespace().next()).map(|n| format!("{}.tfm", n))
        } else if line.contains("pdfTeX error") && line.contains("cannot open") {
            line.split("(file ").nth(1).and_then(|r| r.split(')').next()).map(|f| f.rsplit(['/', '\\']).next().unwrap_or(f).to_string())
        } else {
            None
        };
        if let Some(name) = candidate.filter(|n| is_plain_tex_file(n)) {
            return Some(name);
        }
    }
    // babel spreads this over several "(babel)" lines.
    let joined = join_continuations(&text);
    joined.split("language definition file").nth(1).and_then(|rest| {
        let name = rest.split_whitespace().next()?.trim_end_matches(['.', ',']);
        is_plain_tex_file(name).then(|| name.to_string())
    })
}

/// A file the template refers to that no TeX distribution provides: an image, an
/// `\input` of another file, and so on.
pub fn parse_missing_resource(output: &str) -> Option<String> {
    unwrap_log(output).lines().find_map(|line| {
        if !line.contains("not found") {
            return None;
        }
        let name = line.split("File `").nth(1)?.split('\'').next()?.trim();
        (!name.is_empty() && !is_plain_tex_file(name)).then(|| name.to_string())
    })
}

/// A system font fontspec couldn't find (XeLaTeX).
pub fn parse_missing_system_font(output: &str) -> Option<String> {
    let text = unwrap_log(output);
    let rest = text.split("The font \"").nth(1)?;
    let (name, after) = rest.split_once('"')?;
    (after.trim_start().starts_with("cannot be found") && !name.trim().is_empty()).then(|| name.trim().to_string())
}

pub fn is_plain_package_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
}

/// The TeX Live package that ships `file`, from `tlmgr search --file --global`
/// output (`pkg:` at column 0, then tab-indented paths).
pub fn parse_tlmgr_search(output: &str, file: &str) -> Option<String> {
    let suffix = format!("/{}", file);
    let mut package: Option<&str> = None;
    for line in output.lines() {
        if line.starts_with(char::is_whitespace) {
            if line.trim_end().ends_with(&suffix) {
                if let Some(pkg) = package.filter(|p| is_plain_package_name(p)) {
                    return Some(pkg.to_string());
                }
            }
        } else if let Some(name) = line.trim_end().strip_suffix(':') {
            package = Some(name);
        }
    }
    None
}

/// Files that live in a MiKTeX package with a different name. Everything else is
/// in the package named after the file, which is MiKTeX's convention.
const MIKTEX_PACKAGE_OF: &[(&str, &[&str])] = &[
    ("tools", &["array", "calc", "dcolumn", "delarray", "enumerate", "afterpage", "bm", "ftnright", "hhline", "indentfirst", "layout", "longtable", "multicol", "rawfonts", "showkeys", "somedefs", "tabularx", "theorem", "trace", "varioref", "verbatim", "xr", "xspace"]),
    ("graphics", &["graphicx", "graphics", "color", "keyval", "trig", "lscape", "epsfig"]),
    ("amsfonts", &["amssymb", "amsfonts"]),
    ("amscls", &["amsthm"]),
    ("preprint", &["fullpage", "authblk", "balance"]),
];

/// The MiKTeX package to install for a missing file.
pub fn miktex_package_for(file: &str) -> Option<String> {
    let (stem, ext) = file.rsplit_once('.')?;
    let package = if ext == "ldf" {
        format!("babel-{}", stem)
    } else {
        MIKTEX_PACKAGE_OF
            .iter()
            .find(|(_, files)| files.contains(&stem))
            .map_or_else(|| stem.to_string(), |(package, _)| package.to_string())
    };
    is_plain_package_name(&package).then_some(package)
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

/// Why a missing file couldn't be installed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallFailure {
    /// No distribution has it: it's a file that came with the template.
    NotPublished,
    /// The installer can't be used here at all; the reason says what to do instead.
    Blocked(String),
    /// Anything else, as something the user can act on.
    Other(String),
}

/// A helper tool (`tlmgr`, `mpm`, `initexmf`, `xelatex`) that ships next to `pdflatex`.
fn tool_path(bin: &LatexBinary, stem: &str) -> PathBuf {
    let name = match (cfg!(windows), stem) {
        (true, "tlmgr") => "tlmgr.bat".to_string(),
        (true, _) => format!("{}.exe", stem),
        (false, _) => stem.to_string(),
    };
    match bin.path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir.join(name),
        _ => PathBuf::from(name),
    }
}

fn tlmgr_path(bin: &LatexBinary) -> PathBuf {
    tool_path(bin, "tlmgr")
}

/// Set once the user's MiKTeX package database has been refreshed this session.
/// MiKTeX won't install packages on the fly until that has happened once.
static MIKTEX_DB_REFRESHED: AtomicBool = AtomicBool::new(false);

/// Installs that failed recently, per pdflatex and file.
static FAILED_INSTALLS: Mutex<Option<HashMap<(PathBuf, String), (Instant, InstallFailure)>>> = Mutex::new(None);

fn recent_install_failure(bin: &LatexBinary, file: &str) -> Option<InstallFailure> {
    let guard = FAILED_INSTALLS.lock().unwrap_or_else(|e| e.into_inner());
    let (at, failure) = guard.as_ref()?.get(&(bin.path.clone(), file.to_string()))?;
    (at.elapsed() < FAILED_INSTALL_COOLDOWN).then(|| failure.clone())
}

fn remember_install_failure(bin: &LatexBinary, file: &str, failure: &InstallFailure) {
    FAILED_INSTALLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashMap::new)
        .insert((bin.path.clone(), file.to_string()), (Instant::now(), failure.clone()));
}

/// Runs a tool, keeping what it writes to stderr (MiKTeX and tlmgr report problems there).
fn run_tool_logged(
    tool: &Path,
    args: &[String],
    timeout: Duration,
    log: &Path,
) -> Result<(PassOutput, String), String> {
    let mut cmd = create_silent_command(tool);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped());
    match fs::File::create(log) {
        Ok(file) => cmd.stderr(Stdio::from(file)),
        Err(_) => cmd.stderr(Stdio::null()),
    };
    let out = run_with_timeout(cmd, timeout).map_err(|e| match e {
        RunError::TimedOut => format!("{} timed out", tool.display()),
        RunError::Spawn(msg) => format!("couldn't run {} ({})", tool.display(), msg),
    })?;
    let stderr = fs::read_to_string(log).unwrap_or_default();
    Ok((out, stderr))
}

/// TeX breaks its output at 79 columns, which can cut a message mid-word. Joins those
/// pieces back into the original lines.
pub fn unwrap_log(output: &str) -> String {
    let mut out = String::with_capacity(output.len());
    let mut lines = output.lines().peekable();
    while let Some(line) = lines.next() {
        out.push_str(line);
        if !(line.chars().count() == 79 && lines.peek().is_some()) {
            out.push('\n');
        }
    }
    out
}

/// Packages continue long messages on lines that start with their name in brackets,
/// such as `(babel)` or `(fontspec)`. Joins those onto the line they continue.
fn join_continuations(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for line in text.lines() {
        let trimmed = line.trim_start();
        let is_continuation = trimmed.starts_with('(')
            && trimmed.find(')').is_some_and(|close| close < 20 && trimmed[1..close].chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        if is_continuation && !out.is_empty() {
            out.pop();
            out.push(' ');
            out.push_str(trimmed[trimmed.find(')').unwrap_or(0) + 1..].trim());
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

/// The font pdfTeX couldn't find, from `!pdfTeX error: ... (file NAME): Font NAME at 600
/// not found`. That happens when a font's files are installed but its map entry isn't
/// known yet.
pub fn missing_font(output: &str) -> Option<String> {
    unwrap_log(output).lines().find_map(|line| {
        let error = &line[line.find("pdfTeX error")?..];
        if !error.contains("not found") {
            return None;
        }
        let name = error.split("(file ").nth(1)?.split(')').next()?.trim();
        (!name.is_empty()).then(|| name.to_string())
    })
}

/// When the TeX databases were last rebuilt for a given pdflatex, so a problem that
/// persists doesn't trigger a slow rebuild on every compile.
static DATABASES_REFRESHED: Mutex<Option<HashMap<PathBuf, Instant>>> = Mutex::new(None);
const DATABASE_REFRESH_COOLDOWN: Duration = Duration::from_secs(10 * 60);

/// Rebuilds the file name database and font maps, so freshly installed files and fonts
/// become visible. Returns whether anything ran.
fn refresh_tex_databases(bin: &LatexBinary, log_dir: &Path, id: &str) -> bool {
    {
        let mut guard = DATABASES_REFRESHED.lock().unwrap_or_else(|e| e.into_inner());
        let recent = guard.get_or_insert_with(HashMap::new);
        if recent.get(&bin.path).is_some_and(|at| at.elapsed() < DATABASE_REFRESH_COOLDOWN) {
            return false;
        }
        recent.insert(bin.path.clone(), Instant::now());
    }
    let log = log_dir.join(format!("{}.stderr", id));
    let run = |tool: &str, args: &[&str]| {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        run_tool_logged(&tool_path(bin, tool), &args, TLMGR_INSTALL_TIMEOUT, &log).map_or(false, |(out, _)| out.success)
    };
    if bin.is_miktex {
        let fndb = run("initexmf", &["--update-fndb"]);
        let maps = run("initexmf", &["--mkmaps"]);
        fndb || maps
    } else {
        run("updmap-user", &[])
    }
}

pub fn mpm_update_db_args() -> Vec<String> {
    vec!["--update-db".into(), format!("--repository={}", MIKTEX_REPOSITORY)]
}

pub fn mpm_install_args(package: &str) -> Vec<String> {
    vec![format!("--install={}", package), format!("--repository={}", MIKTEX_REPOSITORY)]
}

/// The lines of MiKTeX's own output that explain why it couldn't install something.
pub fn miktex_diagnostics(output: &str) -> Option<String> {
    let mut lines: Vec<String> = Vec::new();
    for line in output.lines().map(str::trim) {
        let lower = line.to_lowercase();
        let relevant = lower.contains("issue")
            || lower.contains("update")
            || lower.contains("repository")
            || lower.contains("administrator")
            || lower.contains("not installed")
            || lower.contains("unknown package")
            || lower.contains("cannot")
            || lower.contains("can't")
            || lower.contains("failed");
        if relevant && !line.is_empty() && !lines.iter().any(|l| l == line) {
            lines.push(line.chars().take(300).collect());
        }
        if lines.len() == 3 {
            break;
        }
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join(" "))
    }
}

/// MiKTeX's fallback when its on-the-fly installer gave up: refresh the package
/// database once, then install the package with `mpm`. Returns the package name.
fn install_with_mpm(bin: &LatexBinary, file: &str, log: &Path) -> Result<String, InstallFailure> {
    let package = miktex_package_for(file).ok_or_else(|| InstallFailure::Other("the package name isn't valid".into()))?;
    let mpm = tool_path(bin, "mpm");
    if !MIKTEX_DB_REFRESHED.load(Ordering::SeqCst) {
        if let Ok((out, _)) = run_tool_logged(&mpm, &mpm_update_db_args(), TLMGR_INSTALL_TIMEOUT, log) {
            if out.success {
                MIKTEX_DB_REFRESHED.store(true, Ordering::SeqCst);
            }
        }
    }
    let (out, stderr) = run_tool_logged(&mpm, &mpm_install_args(&package), TLMGR_INSTALL_TIMEOUT, log).map_err(InstallFailure::Other)?;
    if out.success {
        return Ok(package);
    }
    let detail = miktex_diagnostics(&format!("{}\n{}", stderr, out.stdout)).unwrap_or_else(|| format!("mpm couldn't install `{}`", package));
    Err(InstallFailure::Other(detail))
}

/// Situations where tlmgr can't install anything, with what to do about them.
pub fn tlmgr_problem(output: &str) -> Option<String> {
    let lower = output.to_lowercase();
    if lower.contains("running on debian") || lower.contains("tlmgr-on-debian") {
        return Some("your TeX Live comes from your Linux distribution, which doesn't let tlmgr add packages. Install them with your package manager instead, for example `sudo apt install texlive-latex-extra texlive-fonts-extra`".into());
    }
    if lower.contains("older than remote repository") || lower.contains("cross release updates") {
        return Some("your TeX Live is older than the online package repository, so tlmgr can't add packages to it. Update to the current TeX Live, or install the package with your system's package manager".into());
    }
    if lower.contains("tlmgr itself needs to be updated") {
        return Some("tlmgr needs updating first: run `sudo tlmgr update --self`, then compile again".into());
    }
    None
}

/// Installs the TeX Live package that provides `file` and returns its name.
/// Falls back to a per-user tree when the system one isn't writable.
fn install_missing_file(bin: &LatexBinary, file: &str, log: &Path) -> Result<String, InstallFailure> {
    let tlmgr = tlmgr_path(bin);
    let run = |args: &[&str], timeout: Duration| {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        run_tool_logged(&tlmgr, &args, timeout, log)
            .map(|(out, stderr)| (out.success, format!("{}\n{}", out.stdout, stderr)))
            .map_err(InstallFailure::Other)
    };
    let (searched, text) = run(&["search", "--file", "--global", &format!("/{}", file)], TLMGR_SEARCH_TIMEOUT)?;
    let Some(package) = parse_tlmgr_search(&text, file) else {
        if let Some(problem) = tlmgr_problem(&text) {
            return Err(InstallFailure::Blocked(problem));
        }
        return Err(if searched {
            InstallFailure::NotPublished
        } else {
            InstallFailure::Other("tlmgr couldn't reach the TeX Live repository; check your internet connection".into())
        });
    };
    let (installed, text) = run(&["install", &package], TLMGR_INSTALL_TIMEOUT)?;
    if installed {
        return Ok(package);
    }
    let first_problem = tlmgr_problem(&text);
    let _ = run(&["init-usertree"], TLMGR_SEARCH_TIMEOUT);
    let (installed, text) = run(&["--usermode", "install", &package], TLMGR_INSTALL_TIMEOUT)?;
    if installed {
        return Ok(package);
    }
    match first_problem.or_else(|| tlmgr_problem(&text)) {
        Some(problem) => Err(InstallFailure::Blocked(problem)),
        None => Err(InstallFailure::Other(format!("tlmgr couldn't install `{}`", package))),
    }
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/// A readable replacement for TeX's bare "File not found" when auto-install didn't help.
pub fn missing_file_message(file: &str, bin: &LatexBinary, failure: Option<&InstallFailure>) -> String {
    if failure == Some(&InstallFailure::NotPublished) {
        return format!(
            "`{}` isn't a published LaTeX package, so it most likely came with the template as a separate file. Vitae builds each resume from a single file and can't use it yet. Choose a template that doesn't need its own files.",
            file
        );
    }
    if let Some(InstallFailure::Blocked(reason)) = failure {
        return format!("The LaTeX file `{}` is missing and Vitae couldn't install it automatically: {}.", file, reason);
    }
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let reason = match failure {
        Some(InstallFailure::Other(reason)) => Some(reason.as_str()),
        _ => None,
    };
    if bin.is_miktex {
        let package = miktex_package_for(file).unwrap_or_else(|| stem.to_string());
        let why = reason.map(|e| format!(" MiKTeX said: {}", e)).unwrap_or_default();
        format!(
            "The LaTeX file `{}` is missing and Vitae couldn't install it automatically.{} To fix it once, open MiKTeX Console, choose Updates and then Check for updates; or install `{}` under Packages. Then compile again. If `{}` came with the template rather than from MiKTeX, Vitae can't use it yet.",
            file, why, package, file
        )
    } else {
        let why = reason.map(|e| format!(" ({})", e)).unwrap_or_default();
        let example = if is_font_file(file) { String::new() } else { format!(" (for example `tlmgr install {}`)", stem) };
        format!(
            "The LaTeX file `{}` is missing and Vitae couldn't install it automatically{}. Install the package that provides it{} and compile again.",
            file, why, example
        )
    }
}

pub fn missing_font_message(font: &str, bin: &LatexBinary) -> String {
    if bin.is_miktex {
        format!(
            "LaTeX can't find the font `{}`. Vitae refreshed MiKTeX's font files, but it's still missing. Open MiKTeX Console, choose Tasks, run Refresh file name database and Refresh font map files, then compile again. If it persists, install the package that provides this font under Packages.",
            font
        )
    } else {
        format!(
            "LaTeX can't find the font `{}`. Run `updmap-user` (or `sudo updmap-sys`) and compile again. If it persists, install the package that provides this font with tlmgr or your system's TeX package manager.",
            font
        )
    }
}

pub fn missing_system_font_message(font: &str) -> String {
    format!(
        "The template uses the font \"{}\", which isn't installed on this computer. Install the font, or change it in the template, and compile again.",
        font
    )
}

pub fn missing_resource_message(name: &str) -> String {
    format!(
        "The template needs `{}`, a separate file that isn't part of this resume. Vitae builds each resume from a single file, so remove the line that uses it or paste the file's contents into the template.",
        name
    )
}

/// The clearest explanation for a failed run, if Vitae recognises the cause.
fn explain_failure(output: &str, bin: &LatexBinary, failure: Option<&InstallFailure>, stderr_log: &Path) -> Option<String> {
    if let Some(font) = parse_missing_system_font(output) {
        return Some(missing_system_font_message(&font));
    }
    if let Some(file) = parse_missing_file(output) {
        if bin.is_miktex && is_font_file(&file) {
            return Some(missing_font_message(&file, bin));
        }
        // Prefer what the installer said; otherwise whatever MiKTeX printed during the run.
        let fallback = failure.cloned().or_else(|| {
            fs::read_to_string(stderr_log).ok().and_then(|log| miktex_diagnostics(&log)).map(InstallFailure::Other)
        });
        return Some(missing_file_message(&file, bin, fallback.as_ref()));
    }
    if let Some(font) = missing_font(output) {
        return Some(missing_font_message(&font, bin));
    }
    parse_missing_resource(output).map(|name| missing_resource_message(&name))
}

/// True when `pdf` was written during this compile (the clock slack covers coarse
/// filesystem timestamps).
fn pdf_is_fresh(pdf: &Path, started: SystemTime) -> bool {
    let cutoff = started.checked_sub(Duration::from_secs(2)).unwrap_or(started);
    fs::metadata(pdf)
        .and_then(|m| m.modified())
        .map(|modified| modified >= cutoff)
        .unwrap_or(false)
}

/// Explains a run that failed (non-zero exit) without printing a LaTeX error: the exit
/// code, anything MiKTeX said, and the last lines of output.
pub fn silent_failure_message(program: &str, code: Option<i32>, stdout: &str, notes: Option<&str>, pdf_produced: bool) -> String {
    let exit = code.map_or("an unknown code".to_string(), |c| format!("code {}", c));
    let tail: Vec<&str> = stdout.lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(5).collect();
    let tail: String = tail.into_iter().rev().collect::<Vec<_>>().join(" | ");
    let mut message = if pdf_produced {
        format!("{} exited with {} but produced a PDF and reported no errors, so the PDF is shown.", program, exit)
    } else {
        format!("{} exited with {} without reporting a LaTeX error and produced no PDF.", program, exit)
    };
    if let Some(notes) = notes {
        message.push_str(&format!(" MiKTeX said: {}", notes));
    }
    if !pdf_produced && !tail.is_empty() {
        let tail: String = tail.chars().rev().take(500).collect::<Vec<_>>().into_iter().rev().collect();
        message.push_str(&format!(" Last output: {}", tail));
    }
    message
}

pub fn check_needs_rerun(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("rerun to ")
        || lower.contains("rerun latex")
        || lower.contains("please rerun")
        || lower.contains("label(s) may have changed")
        || lower.contains("(re)run latex")
}

/// True when the failure points into an auxiliary file from a previous run
/// (e.g. `./<id>.aux:12: ...`), which a clean rebuild can fix.
pub fn failed_in_aux_file(output: &str, id: &str) -> bool {
    AUX_EXTENSIONS
        .iter()
        .any(|ext| output.contains(&format!("{}.{}:", id, ext)))
}

fn remove_aux_files(temp_dir: &Path, id: &str) {
    for ext in AUX_EXTENSIONS {
        let _ = fs::remove_file(temp_dir.join(format!("{}.{}", id, ext)));
    }
}

pub fn forget_document(id: &str) {
    if let Ok(mut map) = LAST_COMPILE_HASH.lock() {
        if let Some(m) = map.as_mut() {
            m.remove(id);
        }
    }
}

pub fn remove_temp_files(temp_dir: &Path, id: &str) {
    for ext in LATEX_TEMP_EXTENSIONS {
        let _ = fs::remove_file(temp_dir.join(format!("{}.{}", id, ext)));
    }
}

fn pdf_path_string(pdf_file: &Path) -> Result<String, String> {
    Ok(pdf_file
        .to_str()
        .ok_or("Invalid PDF path")?
        .replace('\\', "/"))
}

fn failed(message: String) -> CompilationResult {
    CompilationResult {
        success: false,
        pdf_path: None,
        errors: vec![LatexError { line: None, message, severity: "error".to_string() }],
    }
}

/// Compiles `content` for document `id` inside `temp_dir`. The caller must have
/// validated `id` (it is used to build file names).
///
/// Recovers on its own from what usually breaks imported templates: a template that
/// needs XeLaTeX, missing packages, fonts and babel languages (installed through
/// MiKTeX or tlmgr), stale font maps, stale auxiliary files and a slow first MiKTeX
/// run. Whatever it can't fix is explained in plain words.
pub fn compile(
    bin: &LatexBinary,
    temp_dir: &Path,
    id: &str,
    content: &str,
    timeout: Duration,
) -> Result<CompilationResult, String> {
    // Serialize compiles so passes don't collide (and lock files on Windows).
    let _lock = COMPILE_MUTEX.lock().unwrap_or_else(|e| e.into_inner());

    fs::create_dir_all(temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let tex_name = format!("{}.tex", id);
    let tex_file = temp_dir.join(&tex_name);
    let pdf_file = temp_dir.join(format!("{}.pdf", id));
    let content_hash = calculate_hash(&content);

    let is_identical = LAST_COMPILE_HASH
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .and_then(|m| m.get(id).copied())
        == Some(content_hash);
    if is_identical && pdf_file.exists() {
        return Ok(CompilationResult {
            success: true,
            pdf_path: Some(pdf_path_string(&pdf_file)?),
            errors: vec![],
        });
    }

    let mut engine = required_engine(content);
    if engine == Engine::LuaLatex {
        return Ok(failed(LUALATEX_MESSAGE.to_string()));
    }

    fs::write(&tex_file, content).map_err(|e| format!("Failed to write tex file: {}", e))?;
    let started = SystemTime::now();

    // MiKTeX explains installer problems on stderr, which is otherwise discarded.
    let err_log = temp_dir.join(format!("{}.stderr", id));
    let tool_log = temp_dir.join(format!("{}.tools.log", id));
    let retried_timeout = std::cell::Cell::new(false);
    let run_pass = |engine: Engine| -> Result<PassOutput, String> {
        loop {
            let mut cmd = sandboxed_command(bin, engine, temp_dir, &tex_name);
            if bin.is_miktex {
                if let Ok(file) = fs::File::create(&err_log) {
                    cmd.stderr(Stdio::from(file));
                }
            }
            match run_with_timeout(cmd, timeout) {
                Ok(pass) => return Ok(pass),
                // MiKTeX downloads missing packages during the run and keeps what it
                // fetched, so one more try usually finishes a slow first compile.
                Err(RunError::TimedOut) if bin.is_miktex && !retried_timeout.replace(true) => continue,
                Err(RunError::TimedOut) => {
                    return Err(format!(
                        "Compilation timed out after {} seconds. Check for an infinite loop (e.g. a macro that calls itself); if LaTeX is downloading packages, try again.",
                        timeout.as_secs()
                    ))
                }
                Err(RunError::Spawn(msg)) if engine == Engine::PdfLatex => {
                    return Err(format!("Failed to run pdflatex: {}. Make sure pdflatex is installed and in PATH.", msg))
                }
                Err(RunError::Spawn(_)) => return Err(engine_missing_message(engine, bin)),
            }
        }
    };

    // Pass 1 is incremental: existing .aux/.out are kept so most edits need one pass.
    let mut pass = run_pass(engine)?;

    // Fix what the log says and compile again, until it builds or nothing more can be
    // done:
    // - Packages (often inside a template's own class) that need XeLaTeX switch the
    //   engine. pdfLaTeX's auxiliary files don't carry over, so that starts clean.
    // - Missing files are installed. MiKTeX normally does this itself
    //   (--enable-installer); when it couldn't, mpm is asked directly. TeX Live can't
    //   fetch packages mid-run at all, so it always goes through tlmgr.
    let deadline = Instant::now() + MAX_INSTALL_TIME;
    let mut installed: Vec<String> = Vec::new();
    let mut install_error: Option<InstallFailure> = None;
    while !pass.success {
        if engine == Engine::PdfLatex && needs_unicode_engine(&pass.stdout) {
            engine = Engine::XeLatex;
            remove_aux_files(temp_dir, id);
            pass = run_pass(engine)?;
            continue;
        }
        if installed.len() >= MAX_AUTO_INSTALLS {
            break;
        }
        let Some(file) = parse_missing_file(&pass.stdout) else { break };
        // MiKTeX fetches fonts itself; a font it still can't see is handled below.
        if bin.is_miktex && is_font_file(&file) {
            break;
        }
        if let Some(failure) = recent_install_failure(bin, &file) {
            install_error = Some(failure);
            break;
        }
        if Instant::now() >= deadline {
            install_error = Some(InstallFailure::Other("installing packages is taking a long time; compile again to carry on".into()));
            break;
        }
        let attempt = if bin.is_miktex {
            install_with_mpm(bin, &file, &tool_log)
        } else {
            install_missing_file(bin, &file, &tool_log)
        };
        match attempt {
            Ok(package) if !installed.contains(&package) => {
                installed.push(package);
                pass = run_pass(engine)?;
            }
            Ok(package) => {
                let failure = InstallFailure::Other(format!("`{}` is installed but `{}` is still not found", package, file));
                remember_install_failure(bin, &file, &failure);
                install_error = Some(failure);
                break;
            }
            Err(failure) => {
                remember_install_failure(bin, &file, &failure);
                install_error = Some(failure);
                break;
            }
        }
    }

    // Files or fonts that are installed but that TeX can't see yet: rebuild the file
    // database and font maps and try again.
    let invisible = missing_font(&pass.stdout).is_some()
        || (bin.is_miktex && parse_missing_file(&pass.stdout).is_some_and(|f| is_font_file(&f)));
    if !pass.success && invisible && refresh_tex_databases(bin, temp_dir, id) {
        pass = run_pass(engine)?;
    }

    // Stale auxiliary files from an interrupted run can break the next compile.
    // Only then is a clean rebuild worth a second run.
    if !pass.success && failed_in_aux_file(&pass.stdout, id) {
        remove_aux_files(temp_dir, id);
        pass = run_pass(engine)?;
    }

    // With preserved aux files, at most one extra pass is needed for references/outlines.
    if pass.success && check_needs_rerun(&pass.stdout) {
        pass = run_pass(engine)?;
    }

    let mut errors = parse_latex_errors(&pass.stdout);
    if !pass.success {
        if let Some(message) = explain_failure(&pass.stdout, bin, install_error.as_ref(), &err_log) {
            errors.insert(0, LatexError { line: None, message, severity: "error".to_string() });
        }
    }

    // A non-zero exit with no LaTeX error is not necessarily a failed build (MiKTeX
    // does this, for instance). Keep a freshly written PDF and say what happened;
    // otherwise explain the failure instead of showing nothing.
    let silent_failure = !pass.success && !errors.iter().any(|e| e.severity == "error");
    let fresh_pdf = silent_failure && pdf_is_fresh(&pdf_file, started);
    if silent_failure {
        let notes = fs::read_to_string(&err_log).ok().and_then(|log| miktex_diagnostics(&log));
        errors.push(LatexError {
            line: None,
            message: silent_failure_message(engine.program(), pass.code, &pass.stdout, notes.as_deref(), fresh_pdf),
            severity: if fresh_pdf { "warning" } else { "error" }.to_string(),
        });
    }
    let has_errors = errors.iter().any(|e| e.severity == "error");

    if !pdf_file.exists() {
        return Ok(CompilationResult {
            success: false,
            pdf_path: None,
            errors: if errors.is_empty() {
                vec![LatexError {
                    line: None,
                    message: "PDF file was not generated".to_string(),
                    severity: "error".to_string(),
                }]
            } else {
                errors
            },
        });
    }

    let success = (pass.success || fresh_pdf) && !has_errors;
    if success {
        LAST_COMPILE_HASH
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get_or_insert_with(HashMap::new)
            .insert(id.to_string(), content_hash);
    }

    Ok(CompilationResult {
        success,
        pdf_path: Some(pdf_path_string(&pdf_file)?),
        errors,
    })
}

pub fn parse_latex_errors(output: &str) -> Vec<LatexError> {
    let mut errors = Vec::new();
    let output = unwrap_log(output);

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let lower = trimmed.to_lowercase();
        // Ignore known informational lines that contain colons and numbers but are not errors/warnings
        if lower.starts_with("timestamp:")
            || (lower.starts_with("package ") && lower.contains(" info:"))
            || lower.starts_with("latex font info:")
            || (lower.starts_with("file ") && lower.contains(" info:"))
        {
            continue;
        }

        // Parse errors with format: [drive:]/path/file.tex:123: Error message
        let mut matched_file_line_error = false;
        if trimmed.contains(':') {
            let parts: Vec<&str> = trimmed.split(':').collect();
            let (file_candidate, line_candidate, message_candidate) = if parts.len() >= 4
                && parts[0].len() == 1
                && parts[0].chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && (parts[1].starts_with('\\') || parts[1].starts_with('/'))
            {
                (
                    format!("{}:{}", parts[0], parts[1]),
                    parts[2],
                    parts[3..].join(":"),
                )
            } else if parts.len() >= 3 {
                (
                    parts[0].to_string(),
                    parts[1],
                    parts[2..].join(":"),
                )
            } else {
                (String::new(), "", String::new())
            };

            let trimmed_file = file_candidate.trim();
            let is_source_file = (trimmed_file.contains('/')
                || trimmed_file.contains('\\')
                || trimmed_file.ends_with(".tex")
                || trimmed_file.ends_with(".sty")
                || trimmed_file.ends_with(".cls"))
                && !trimmed_file.starts_with("Package")
                && !trimmed_file.starts_with("File")
                && !trimmed_file.starts_with("Timestamp")
                && !trimmed_file.starts_with("Document Class");

            if is_source_file {
                if let Ok(line_num) = line_candidate.trim().parse::<u32>() {
                    if line_num > 0 {
                        let message = message_candidate.trim().to_string();
                        if !message.is_empty() {
                            let severity = if message.to_lowercase().contains("warning") {
                                "warning"
                            } else {
                                "error"
                            };

                            let is_dup = errors.iter().any(|e: &LatexError| {
                                (e.line == Some(line_num) && e.message == message)
                                    || (e.line.is_none()
                                        && (e.message == message || message.ends_with(&e.message)))
                            });

                            if !is_dup {
                                if let Some(existing) = errors.iter_mut().find(|e| {
                                    e.line.is_none()
                                        && e.severity == severity
                                        && (e.message == message || message.ends_with(&e.message))
                                }) {
                                    existing.line = Some(line_num);
                                    existing.message = message;
                                } else {
                                    errors.push(LatexError {
                                        line: Some(line_num),
                                        message,
                                        severity: severity.to_string(),
                                    });
                                }
                            }
                            matched_file_line_error = true;
                        }
                    }
                }
            }
        }

        if matched_file_line_error {
            continue;
        }

        // Errors start with "! ", pdfTeX's own with "!pdfTeX error", and a fatal stop prints
        // "==> Fatal error occurred" with no file or line in front of it.
        let error_message = trimmed
            .strip_prefix("! ")
            .map(|rest| rest.trim().to_string())
            .or_else(|| trimmed.starts_with("!pdfTeX error").then(|| trimmed.trim_start_matches('!').to_string()))
            .or_else(|| trimmed.starts_with("==> Fatal error").then(|| trimmed.to_string()));
        if let Some(message) = error_message {
            let already_exists = errors.iter().any(|e| {
                e.severity == "error"
                    && (e.message == message
                        || e.message.ends_with(&message)
                        || message.ends_with(&e.message))
            });

            if !already_exists {
                errors.push(LatexError {
                    line: None,
                    message,
                    severity: "error".to_string(),
                });
            }
        } else if lower.contains("warning:") || lower.contains("latex warning") || lower.contains("latex font warning") {
            let mut line_num = None;
            if let Some(pos) = trimmed.rfind("on input line ") {
                let rest = &trimmed[pos + "on input line ".len()..];
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = digits.parse::<u32>() {
                    line_num = Some(n);
                }
            } else if let Some(pos) = trimmed.rfind("line ") {
                let rest = &trimmed[pos + "line ".len()..];
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                if let Ok(n) = digits.parse::<u32>() {
                    line_num = Some(n);
                }
            }

            let message = trimmed.to_string();
            let already_exists = errors.iter().any(|e| {
                e.severity == "warning"
                    && ((e.line == line_num && e.message == message)
                        || (line_num.is_some() && e.line == line_num && (message.contains(&e.message) || e.message.contains(&message))))
            });

            if !already_exists {
                errors.push(LatexError {
                    line: line_num,
                    message,
                    severity: "warning".to_string(),
                });
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_latex_errors_windows_path() {
        let sample = r#"
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (MiKTeX 22.10)
entering extended mode
C:\Users\John\AppData\Roaming\vitae\temp\test.tex:14: Undefined control sequence.
l.14 \unknowncommand

C:\Users\John\AppData\Roaming\vitae\temp\test.tex:22: LaTeX Error: Environment align undefined.
"#;
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].line, Some(14));
        assert_eq!(errors[0].message, "Undefined control sequence.");
        assert_eq!(errors[0].severity, "error");

        assert_eq!(errors[1].line, Some(22));
        assert_eq!(errors[1].message, "LaTeX Error: Environment align undefined.");
        assert_eq!(errors[1].severity, "error");
    }

    #[test]
    fn test_parse_latex_errors_unix_path() {
        let sample = "./temp/test.tex:42: Missing $ inserted.\n";
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].message, "Missing $ inserted.");
        assert_eq!(errors[0].severity, "error");
    }

    #[test]
    fn test_parse_latex_errors_warnings_and_exclamations() {
        let sample = r#"
LaTeX Warning: Reference `sec:intro' on page 1 undefined on input line 58.
! Emergency stop.
"#;
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].line, Some(58));
        assert_eq!(errors[0].severity, "warning");
        assert_eq!(errors[1].line, None);
        assert_eq!(errors[1].message, "Emergency stop.");
        assert_eq!(errors[1].severity, "error");
    }

    #[test]
    fn test_parse_latex_errors_false_positives() {
        let sample = r#"
This is pdfTeX, Version 3.141592653-2.6-1.40.24 (MiKTeX 22.10)
Timestamp: 2026:09:23:14:30
Package hyperref Info: Driver (autodetected): hpdftex.def. on input line 200.
LaTeX Font Info:    Font shape `OT1/cmr/m/n' will be used on input line 5.
File: sample.tex graphic file on input line 12
(c:/miktex/tex/latex/base/article.cls
Document Class: article 2021/10/04 v1.4n Standard LaTeX document class
"#;
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 0, "Expected 0 errors from log info/timestamp lines, got: {:?}", errors);
    }

    #[test]
    fn test_parse_latex_errors_deduplication() {
        let sample = r#"
C:\Users\John\AppData\Roaming\vitae\temp\test.tex:14: Undefined control sequence.
l.14 \unknowncommand
! Undefined control sequence.
"#;
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 1, "Expected deduplicated error, got: {:?}", errors);
        assert_eq!(errors[0].line, Some(14));
        assert_eq!(errors[0].message, "Undefined control sequence.");
    }

    #[test]
    fn test_parse_latex_errors_package_warnings() {
        let sample = r#"
Package hyperref Warning: Token not allowed in a PDF string on input line 24.
Package babel Warning: No hyphenation patterns were loaded for the language 'Latin' on input line 102.
"#;
        let errors = parse_latex_errors(sample);
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].line, Some(24));
        assert_eq!(errors[0].severity, "warning");
        assert!(errors[0].message.contains("Token not allowed"));
        assert_eq!(errors[1].line, Some(102));
        assert_eq!(errors[1].severity, "warning");
    }

    #[test]
    fn test_check_needs_rerun() {
        assert!(check_needs_rerun("LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right."));
        assert!(check_needs_rerun("Package rerunfilecheck Warning: File `test.out' has changed. Rerun to get outlines right."));
        assert!(check_needs_rerun("Package natbib Warning: Citation(s) may have changed. Rerun to get citations correct."));
        assert!(check_needs_rerun("Package biblatex Warning: Please rerun LaTeX."));
        assert!(check_needs_rerun("Table widths have changed. Rerun LaTeX."));
        assert!(check_needs_rerun("Package rerunfilecheck Warning: Check checksum! Rerun to get correct checksum!"));
        assert!(!check_needs_rerun("Output written on test.pdf (1 page, 26032 bytes)."));
    }

    #[test]
    fn test_failed_in_aux_file() {
        let id = "a1a2a3a4-b1b2-c1c2-d1d2-d3d4d5d6d7d8";
        assert!(failed_in_aux_file(&format!("./{}.aux:3: Missing \\endcsname inserted.", id), id));
        assert!(failed_in_aux_file(&format!("./{}.out:1: Undefined control sequence.", id), id));
        assert!(!failed_in_aux_file(&format!("./{}.tex:14: Undefined control sequence.", id), id));
    }

    #[test]
    fn test_sandboxed_command_flags() {
        let texlive = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        let cmd = sandboxed_command(&texlive, Engine::PdfLatex, Path::new("/tmp/work"), "doc.tex");
        let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"-no-shell-escape".to_string()));
        assert_eq!(args.last().unwrap(), "doc.tex", "main file must be passed relative to the work dir");
        assert_eq!(cmd.get_current_dir(), Some(Path::new("/tmp/work")));
        let envs: HashMap<_, _> = cmd
            .get_envs()
            .map(|(k, v)| (k.to_string_lossy().into_owned(), v.map(|v| v.to_string_lossy().into_owned())))
            .collect();
        assert_eq!(envs.get("openin_any"), Some(&Some("p".to_string())));
        assert_eq!(envs.get("openout_any"), Some(&Some("p".to_string())));

        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        let cmd = sandboxed_command(&miktex, Engine::PdfLatex, Path::new("/tmp/work"), "doc.tex");
        assert!(cmd.get_args().any(|a| a == "-disable-write18"));
        assert!(cmd.get_args().any(|a| a == "--enable-installer"), "MiKTeX should install missing packages itself");
        let texlive_cmd = sandboxed_command(&texlive, Engine::PdfLatex, Path::new("/tmp/work"), "doc.tex");
        assert!(!texlive_cmd.get_args().any(|a| a == "--enable-installer"));
    }

    #[test]
    fn test_parse_missing_file() {
        let plain = "! LaTeX Error: File `sourcesanspro.sty' not found.\n\nType X to quit";
        assert_eq!(parse_missing_file(plain).as_deref(), Some("sourcesanspro.sty"));
        let prefixed = "./abc.tex:44: LaTeX Error: File `marvosym.sty' not found.";
        assert_eq!(parse_missing_file(prefixed).as_deref(), Some("marvosym.sty"));
        assert_eq!(parse_missing_file("! LaTeX Error: File `foo.cls' not found.").as_deref(), Some("foo.cls"));
        // Only plain TeX support files are ever passed on to tlmgr.
        assert_eq!(parse_missing_file("! LaTeX Error: File `../../etc/x.sty' not found."), None);
        assert_eq!(parse_missing_file("! LaTeX Error: File `-evil.sty' not found."), None);
        assert_eq!(parse_missing_file("! LaTeX Error: File `photo.png' not found."), None);
        assert_eq!(parse_missing_file("! Undefined control sequence."), None);
    }

    #[test]
    fn test_parse_tlmgr_search() {
        let out = "tlmgr: package repository https://mirror.example/tlnet (verified)\nsourcesanspro:\n\ttexmf-dist/tex/latex/sourcesanspro/sourcesanspro.sty\nsourcesanspro.doc:\n\ttexmf-dist/doc/fonts/sourcesanspro/sourcesanspro.pdf\n";
        assert_eq!(parse_tlmgr_search(out, "sourcesanspro.sty").as_deref(), Some("sourcesanspro"));
        assert_eq!(parse_tlmgr_search(out, "other.sty"), None);
        assert_eq!(parse_tlmgr_search("", "x.sty"), None);
        let hostile = "--repository=evil:\n\ttexmf-dist/tex/x.sty\n";
        assert_eq!(parse_tlmgr_search(hostile, "x.sty"), None);
    }

    #[test]
    fn test_tlmgr_path_sits_next_to_pdflatex() {
        let name = if cfg!(windows) { "tlmgr.bat" } else { "tlmgr" };
        let bare = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        assert_eq!(tlmgr_path(&bare), PathBuf::from(name));
        let full = LatexBinary { path: PathBuf::from("/usr/local/texlive/bin/pdflatex"), is_miktex: false };
        assert_eq!(tlmgr_path(&full), PathBuf::from("/usr/local/texlive/bin").join(name));
    }

    #[test]
    fn test_silent_failure_message() {
        let out = "line one\n\n(some.sty)\nlast line\n";
        let kept = silent_failure_message("pdflatex", Some(1), out, None, true);
        assert!(kept.contains("code 1") && kept.contains("the PDF is shown"));
        assert!(!kept.contains("Last output"));
        let lost = silent_failure_message("xelatex", None, out, Some("major issue: x"), false);
        assert!(lost.starts_with("xelatex exited") && lost.contains("unknown code") && lost.contains("produced no PDF"));
        assert!(lost.contains("MiKTeX said: major issue: x"));
        assert!(lost.contains("line one | (some.sty) | last line"));
    }

    /// A stand-in pdflatex: prints a warning, optionally writes the PDF, and exits with 1.
    #[cfg(unix)]
    fn fake_pdflatex(dir: &Path, writes_pdf: bool) -> LatexBinary {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join("fake-pdflatex");
        let write = if writes_pdf { "echo pdf > \"${last%.tex}.pdf\"" } else { "true" };
        fs::write(
            &script,
            format!(
                "#!/bin/sh\nfor last; do :; done\n{}\necho 'Package fancyhdr Warning: footskip is too small (0.0pt):'\nexit 1\n",
                write
            ),
        )
        .unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        LatexBinary { path: script, is_miktex: false }
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_keeps_a_fresh_pdf_when_exit_code_is_nonzero_without_errors() {
        let dir = std::env::temp_dir().join(format!("vitae-silent-ok-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = fake_pdflatex(&dir, true);
        let result = compile(&bin, &dir, "silent-ok", "x", Duration::from_secs(10)).unwrap();
        assert!(result.success, "a fresh PDF with no LaTeX errors counts as a build");
        assert!(result.pdf_path.is_some());
        assert!(result.errors.iter().all(|e| e.severity == "warning"));
        assert!(result.errors.iter().any(|e| e.message.contains("exited with code 1") && e.message.contains("PDF is shown")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_explains_a_silent_failure_with_no_pdf() {
        let dir = std::env::temp_dir().join(format!("vitae-silent-fail-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = fake_pdflatex(&dir, false);
        let result = compile(&bin, &dir, "silent-fail", "x", Duration::from_secs(10)).unwrap();
        assert!(!result.success);
        let message = &result.errors.iter().find(|e| e.severity == "error").expect("an error entry").message;
        assert!(message.contains("exited with code 1") && message.contains("produced no PDF"));
        assert!(message.contains("footskip"), "the log tail is included: {}", message);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_pdf_is_fresh() {
        let dir = std::env::temp_dir().join(format!("vitae-fresh-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("a.pdf");
        assert!(!pdf_is_fresh(&pdf, SystemTime::now()), "a missing file is never fresh");
        fs::write(&pdf, b"x").unwrap();
        assert!(pdf_is_fresh(&pdf, SystemTime::now()));
        let later = SystemTime::now() + Duration::from_secs(3600);
        assert!(!pdf_is_fresh(&pdf, later), "a PDF from before the compile started is stale");
        let _ = fs::remove_dir_all(&dir);
    }

    const FONT_FAILURE: &str = "\
) | (see the transcript file for additional information)\r
!pdfTeX error: pdflatex (file SourceSans3-Regular-tlf-ts1--base): Font SourceSa\r
ns3-Regular-tlf-ts1--base at 600 not found\r
 ==> Fatal error occurred, no output PDF file produced!\r
";

    #[test]
    fn test_unwrap_log_joins_only_lines_broken_at_79_columns() {
        let wrapped = format!("{}\nrest of line\nnext", "a".repeat(79));
        assert_eq!(unwrap_log(&wrapped), format!("{}rest of line\nnext\n", "a".repeat(79)));
        assert_eq!(unwrap_log("short\nlines\n"), "short\nlines\n");
        assert_eq!(unwrap_log(&"a".repeat(79)), format!("{}\n", "a".repeat(79)), "nothing follows, so nothing to join");
    }

    #[test]
    fn test_missing_font_is_found_even_when_the_log_wraps() {
        assert_eq!(missing_font(FONT_FAILURE).as_deref(), Some("SourceSans3-Regular-tlf-ts1--base"));
        assert_eq!(missing_font("! Undefined control sequence."), None);
        assert_eq!(missing_font("!pdfTeX error: pdflatex (file x): something else"), None);
    }

    #[test]
    fn test_pdftex_errors_and_fatal_stops_are_reported_as_errors() {
        let errors = parse_latex_errors(FONT_FAILURE);
        let messages: Vec<_> = errors.iter().filter(|e| e.severity == "error").map(|e| e.message.as_str()).collect();
        assert!(messages.iter().any(|m| m.starts_with("pdfTeX error: pdflatex (file SourceSans3-Regular-tlf-ts1--base)")
            && m.ends_with("at 600 not found")), "{:?}", messages);
        assert!(messages.iter().any(|m| m.starts_with("==> Fatal error occurred")), "{:?}", messages);
        assert_eq!(errors.len(), 2);
    }

    #[test]
    fn test_missing_font_message_says_what_to_do() {
        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        let msg = missing_font_message("SourceSans3-Regular", &miktex);
        assert!(msg.contains("SourceSans3-Regular") && msg.contains("Refresh font map files"));
        let texlive = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        assert!(missing_font_message("x", &texlive).contains("updmap-user"));
    }

    /// A MiKTeX stand-in whose pdflatex fails with a missing-font error until
    /// `initexmf` has run, as happens after a font package is installed.
    #[cfg(unix)]
    fn fake_miktex_with_stale_font_maps(dir: &Path, initexmf_fixes_it: bool) -> LatexBinary {
        use std::os::unix::fs::PermissionsExt;
        let marker = dir.join("maps-rebuilt");
        let write = |name: &str, body: String| {
            let path = dir.join(name);
            fs::write(&path, body).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            path
        };
        let pdflatex = write(
            "pdflatex",
            format!(
                "#!/bin/sh\nfor last; do :; done\nif [ -e '{m}' ]; then echo pdf > \"${{last%.tex}}.pdf\"; exit 0; fi\necho '!pdfTeX error: pdflatex (file Demo-Font): Font Demo-Font at 600 not found'\necho ' ==> Fatal error occurred, no output PDF file produced!'\nexit 1\n",
                m = marker.display()
            ),
        );
        let touch = if initexmf_fixes_it { format!("touch '{}'", marker.display()) } else { "true".to_string() };
        write("initexmf", format!("#!/bin/sh\n{}\nexit 0\n", touch));
        LatexBinary { path: pdflatex, is_miktex: true }
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_rebuilds_font_maps_and_retries_when_a_font_is_missing() {
        let dir = std::env::temp_dir().join(format!("vitae-fonts-ok-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = fake_miktex_with_stale_font_maps(&dir, true);
        let result = compile(&bin, &dir, "fonts-ok", "x", Duration::from_secs(10)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        assert!(result.pdf_path.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_explains_a_font_that_stays_missing() {
        let dir = std::env::temp_dir().join(format!("vitae-fonts-bad-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let bin = fake_miktex_with_stale_font_maps(&dir, false);
        let result = compile(&bin, &dir, "fonts-bad", "x", Duration::from_secs(10)).unwrap();
        assert!(!result.success);
        let first = &result.errors[0];
        assert_eq!(first.severity, "error");
        assert!(first.message.contains("Demo-Font") && first.message.contains("Refresh font map files"), "{}", first.message);
        let _ = fs::remove_dir_all(&dir);
    }

    // --- Engines -----------------------------------------------------------

    #[test]
    fn test_required_engine() {
        let doc = |preamble: &str| format!("\\documentclass{{article}}\n{}\n\\begin{{document}}x\\end{{document}}", preamble);
        assert_eq!(required_engine(&doc("")), Engine::PdfLatex);
        // fontspec starts on pdfLaTeX: multi-engine templates load it only inside an
        // engine check, and the compile switches when the log says it's needed.
        assert_eq!(required_engine(&doc("\\usepackage{fontspec}")), Engine::PdfLatex);
        assert_eq!(required_engine(&doc("\\ifdefined\\directlua\\else\\fi")), Engine::PdfLatex, "an engine check isn't a requirement");
        assert_eq!(required_engine(&doc("\\usepackage{luacode}")), Engine::LuaLatex);
        assert_eq!(required_engine(&doc("\\usepackage{xcolor, luacode}")), Engine::LuaLatex);
        assert_eq!(required_engine(&doc("% \\usepackage{luacode}")), Engine::PdfLatex, "commented out");
        assert_eq!(required_engine(&doc("\\usepackage{luacodex}")), Engine::PdfLatex, "whole names only");
        assert_eq!(required_engine(&format!("% !TEX program = xelatex\n{}", doc(""))), Engine::XeLatex);
        assert_eq!(required_engine(&format!("%!TEX TS-program = LuaLaTeX\n{}", doc(""))), Engine::LuaLatex);
        assert_eq!(required_engine(&format!("% !TEX program = pdflatex\n{}", doc("\\usepackage{fontspec}"))), Engine::PdfLatex, "an explicit choice wins");
        for template in ["modern.tex", "classic.tex", "minimal.tex"] {
            let source = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("templates").join(template)).unwrap();
            assert_eq!(required_engine(&source), Engine::PdfLatex, "{}", template);
        }
    }

    #[test]
    fn test_needs_unicode_engine_reads_fontspecs_wrapped_message() {
        let log = "! Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n(fontspec)                      LuaTeX.\n(fontspec)                      \n(fontspec)                      You must change your typesetting engine to,\n";
        assert!(needs_unicode_engine(log));
        assert!(needs_unicode_engine("! Package unicode-math Error: Cannot be run with pdfLaTeX!\n(unicode-math) Use XeLaTeX or LuaLaTeX instead.\nThis package requires XeTeX or LuaTeX"));
        assert!(!needs_unicode_engine("! Undefined control sequence."));
    }

    // --- What's missing ------------------------------------------------------

    #[test]
    fn test_parse_missing_file_recognises_fonts_babel_and_inputs() {
        let tfm = "! Font \\T1/SourceSansPro-TLF/m/n/10=SourceSansPro-Regular-tlf-t1 at 10.0pt not loadable: Metric (TFM) file not found.";
        assert_eq!(parse_missing_file(tfm).as_deref(), Some("SourceSansPro-Regular-tlf-t1.tfm"));
        let pfb = "!pdfTeX error: pdflatex (file ./SourceSans3-Regular.pfb): cannot open Type 1 font file for reading";
        assert_eq!(parse_missing_file(pfb).as_deref(), Some("SourceSans3-Regular.pfb"));
        let windows_pfb = "!pdfTeX error: pdflatex.exe (file C:\\Users\\Me\\fonts\\x.pfb): cannot open Type 1 font file for reading";
        assert_eq!(parse_missing_file(windows_pfb).as_deref(), Some("x.pfb"));
        let enc = "!pdfTeX error: pdflatex (file ./ts1.enc): cannot open encoding file for reading";
        assert_eq!(parse_missing_file(enc).as_deref(), Some("ts1.enc"));
        let babel = "! Package babel Error: Unknown option `english'. Either you misspelled it\n(babel)                or the language definition file english.ldf\n(babel)                was not found.";
        assert_eq!(parse_missing_file(babel).as_deref(), Some("english.ldf"));
        assert_eq!(parse_missing_file("! LaTeX Error: File `glyphtounicode.tex' not found.").as_deref(), Some("glyphtounicode.tex"));
        assert_eq!(parse_missing_file("! LaTeX Error: File `photo.png' not found."), None);
        assert_eq!(parse_missing_file("! LaTeX Error: File `sections/work.tex' not found."), None);
    }

    #[test]
    fn test_parse_missing_resource_and_system_font() {
        assert_eq!(parse_missing_resource("! LaTeX Error: File `photo.png' not found.").as_deref(), Some("photo.png"));
        assert_eq!(parse_missing_resource("! LaTeX Error: File `sections/work.tex' not found.").as_deref(), Some("sections/work.tex"));
        assert_eq!(parse_missing_resource("! LaTeX Error: File `titlesec.sty' not found."), None, "installable, not a resource");
        let font = "! Package fontspec Error: The font \"Roboto\" cannot be found.\n(fontspec)                For immediate help type H <return>.";
        assert_eq!(parse_missing_system_font(font).as_deref(), Some("Roboto"));
        assert_eq!(parse_missing_system_font("! Undefined control sequence."), None);
        assert!(missing_system_font_message("Roboto").contains("\"Roboto\""));
        assert!(missing_resource_message("photo.png").contains("single file"));
    }

    #[test]
    fn test_miktex_package_for() {
        assert_eq!(miktex_package_for("tabularx.sty").as_deref(), Some("tools"));
        assert_eq!(miktex_package_for("graphicx.sty").as_deref(), Some("graphics"));
        assert_eq!(miktex_package_for("amssymb.sty").as_deref(), Some("amsfonts"));
        assert_eq!(miktex_package_for("fullpage.sty").as_deref(), Some("preprint"));
        assert_eq!(miktex_package_for("english.ldf").as_deref(), Some("babel-english"));
        assert_eq!(miktex_package_for("sourcesanspro.sty").as_deref(), Some("sourcesanspro"));
        assert_eq!(miktex_package_for("noextension"), None);
    }

    #[test]
    fn test_tlmgr_problem_explains_common_dead_ends() {
        let debian = "(running on Debian, switching to user mode!)\n(see /usr/share/doc/texlive-base/README.tlmgr-on-Debian.md)\ntlmgr: user mode not initialized, please read the documentation!";
        assert!(tlmgr_problem(debian).unwrap().contains("package manager"));
        let old = "tlmgr: Local TeX Live (2023) is older than remote repository (2025).\nCross release updates are only supported with\n  update-tlmgr-latest(.sh/.exe) --update";
        assert!(tlmgr_problem(old).unwrap().contains("older than the online package repository"));
        let selfupdate = "tlmgr itself needs to be updated.\nPlease do this via either\n  tlmgr update --self";
        assert!(tlmgr_problem(selfupdate).unwrap().contains("tlmgr update --self"));
        assert_eq!(tlmgr_problem("tlmgr: package repository https://mirror (verified)"), None);
    }

    // --- End to end with stand-in tools ---------------------------------------

    #[cfg(unix)]
    fn script(dir: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        fs::write(&path, format!("#!/bin/sh\n{}\n", body)).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vitae-e2e-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes the PDF named after the last argument (the .tex file) and succeeds.
    #[cfg(unix)]
    const WRITE_PDF: &str = "for last; do :; done\necho pdf > \"${last%.tex}.pdf\"\nexit 0";

    #[cfg(unix)]
    #[test]
    fn test_compile_switches_to_xelatex_when_a_class_needs_it() {
        let dir = scratch("xelatex-switch");
        let pdflatex = script(&dir, "pdflatex", &format!(
            "touch '{}'\necho '! Fatal Package fontspec Error: The fontspec package requires either XeTeX or'\necho '(fontspec)                      LuaTeX.'\nexit 1",
            dir.join("pdflatex-ran").display()
        ));
        script(&dir, "xelatex", WRITE_PDF);
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let result = compile(&bin, &dir, "switch", "\\documentclass{awesome-cv}", Duration::from_secs(10)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        assert!(dir.join("pdflatex-ran").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_uses_xelatex_directly_when_the_document_says_so() {
        let dir = scratch("xelatex-direct");
        let pdflatex = script(&dir, "pdflatex", &format!("touch '{}'\nexit 1", dir.join("pdflatex-ran").display()));
        script(&dir, "xelatex", WRITE_PDF);
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let result = compile(&bin, &dir, "direct", "% !TEX program = xelatex\n\\usepackage{fontspec}", Duration::from_secs(10)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        assert!(!dir.join("pdflatex-ran").exists(), "pdflatex is never tried");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_explains_when_xelatex_is_not_installed() {
        let dir = scratch("xelatex-missing");
        let pdflatex = script(&dir, "pdflatex", "echo '! Fatal Package fontspec Error: The fontspec package requires either XeTeX or'\necho '(fontspec)                      LuaTeX.'\nexit 1");
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let err = compile(&bin, &dir, "nox", "\\usepackage{fontspec}", Duration::from_secs(10)).unwrap_err();
        assert!(err.contains("needs XeLaTeX") && err.contains("tlmgr install xetex"), "{}", err);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_refuses_lualatex_without_running_anything() {
        let dir = scratch("lualatex");
        let bin = LatexBinary { path: dir.join("does-not-exist"), is_miktex: false };
        let result = compile(&bin, &dir, "lua", "\\usepackage{luacode}\\begin{luacode}io.open('/etc/passwd')\\end{luacode}", Duration::from_secs(10)).unwrap();
        assert!(!result.success);
        assert_eq!(result.errors[0].message, LUALATEX_MESSAGE);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_installs_a_missing_font_through_tlmgr() {
        let dir = scratch("tfm");
        let installed = dir.join("installed");
        let pdflatex = script(&dir, "pdflatex", &format!(
            "if [ -e '{i}' ]; then {ok}; fi\necho '! Font \\T1/x/m/n/10=demofont-t1 at 10.0pt not loadable: Metric (TFM) file not found.'\nexit 1",
            i = installed.display(), ok = WRITE_PDF.replace('\n', "; ")
        ));
        script(&dir, "tlmgr", &format!(
            "case \"$1\" in\n  search) printf 'demofont:\\n\\ttexmf-dist/fonts/tfm/public/demofont/demofont-t1.tfm\\n' ;;\n  install) touch '{}' ;;\nesac\nexit 0",
            installed.display()
        ));
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let result = compile(&bin, &dir, "tfm", "x", Duration::from_secs(10)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_explains_a_custom_class_and_does_not_retry_it_on_every_compile() {
        let dir = scratch("custom-class");
        let calls = dir.join("tlmgr-calls");
        let pdflatex = script(&dir, "pdflatex", "echo \"! LaTeX Error: File \\`awesome-cv.cls' not found.\"\nexit 1");
        script(&dir, "tlmgr", &format!("echo call >> '{}'\necho 'tlmgr: package repository https://mirror (verified)'\nexit 0", calls.display()));
        let bin = LatexBinary { path: pdflatex, is_miktex: false };

        let first = compile(&bin, &dir, "custom", "\\documentclass{awesome-cv}", Duration::from_secs(10)).unwrap();
        assert!(!first.success);
        assert!(first.errors[0].message.contains("isn't a published LaTeX package"), "{}", first.errors[0].message);
        let calls_after_first = fs::read_to_string(&calls).unwrap().lines().count();
        assert_eq!(calls_after_first, 1, "one search");

        let second = compile(&bin, &dir, "custom", "\\documentclass{awesome-cv} ", Duration::from_secs(10)).unwrap();
        assert!(second.errors[0].message.contains("isn't a published LaTeX package"));
        assert_eq!(fs::read_to_string(&calls).unwrap().lines().count(), calls_after_first, "the failure is remembered");
        let _ = fs::remove_dir_all(&dir);
    }

    /// A class that first needs a package installed and only then turns out to need
    /// XeLaTeX: both fixes happen in one compile, whatever order they show up in.
    #[cfg(unix)]
    #[test]
    fn test_compile_installs_then_switches_engine() {
        let dir = scratch("install-then-switch");
        let installed = dir.join("installed");
        let pdflatex = script(&dir, "pdflatex", &format!(
            "if [ -e '{i}' ]; then echo '! Fatal Package fontspec Error: The fontspec package requires either XeTeX or'; echo '(fontspec)  LuaTeX.'; exit 1; fi\necho \"! LaTeX Error: File \\`moresize.sty' not found.\"\nexit 1",
            i = installed.display()
        ));
        script(&dir, "xelatex", WRITE_PDF);
        script(&dir, "tlmgr", &format!(
            "case \"$1\" in\n  search) printf 'moresize:\\n\\ttexmf-dist/tex/latex/moresize/moresize.sty\\n' ;;\n  install) touch '{}' ;;\nesac\nexit 0",
            installed.display()
        ));
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let result = compile(&bin, &dir, "both", "\\documentclass{fancycv}", Duration::from_secs(10)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_font_file_messages_dont_invent_package_names() {
        let texlive = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        let msg = missing_file_message("demofont-t1.tfm", &texlive, None);
        assert!(!msg.contains("tlmgr install demofont"), "{}", msg);
        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        let explained = explain_failure("! Font \\T1/x/m/n/10=demofont-t1 at 10.0pt not loadable: Metric (TFM) file not found.", &miktex, None, Path::new("/nonexistent"));
        assert!(explained.unwrap().contains("can't find the font `demofont-t1.tfm`"));
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_explains_a_missing_image() {
        let dir = scratch("image");
        let pdflatex = script(&dir, "pdflatex", "echo \"! LaTeX Error: File \\`photo.png' not found.\"\nexit 1");
        let bin = LatexBinary { path: pdflatex, is_miktex: false };
        let result = compile(&bin, &dir, "image", "\\includegraphics{photo.png}", Duration::from_secs(10)).unwrap();
        assert!(result.errors[0].message.contains("`photo.png`") && result.errors[0].message.contains("single file"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_gives_a_slow_first_miktex_run_one_more_try() {
        let dir = scratch("miktex-slow");
        let marker = dir.join("downloaded");
        let pdflatex = script(&dir, "pdflatex", &format!(
            "if [ -e '{m}' ]; then {ok}; fi\ntouch '{m}'\nsleep 5\nexit 0",
            m = marker.display(), ok = WRITE_PDF.replace('\n', "; ")
        ));
        let bin = LatexBinary { path: pdflatex, is_miktex: true };
        let result = compile(&bin, &dir, "slow", "x", Duration::from_secs(1)).unwrap();
        assert!(result.success, "{:?}", result.errors);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn test_compile_still_times_out_when_a_run_keeps_hanging() {
        let dir = scratch("miktex-hang");
        let pdflatex = script(&dir, "pdflatex", "sleep 5\nexit 0");
        let bin = LatexBinary { path: pdflatex, is_miktex: true };
        let err = compile(&bin, &dir, "hang", "x", Duration::from_secs(1)).unwrap_err();
        assert!(err.contains("timed out"), "{}", err);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_mpm_args() {
        let install = mpm_install_args("sourcesanspro");
        assert_eq!(install[0], "--install=sourcesanspro");
        assert!(install[1].starts_with("--repository=https://"));
        assert_eq!(mpm_update_db_args()[0], "--update-db");
    }

    #[test]
    fn test_miktex_diagnostics_picks_out_the_reason() {
        let stderr = "\nmiktex-pdftex: major issue: So far, you have not checked for updates as a MiKTeX user.\nmiktex-pdftex: major issue: So far, you have not checked for updates as a MiKTeX user.\nsome unrelated line\nmiktex-pdftex: the installer failed: repository not reachable\n";
        let found = miktex_diagnostics(stderr).unwrap();
        assert!(found.contains("have not checked for updates"));
        assert!(found.contains("repository not reachable"));
        assert_eq!(found.matches("have not checked for updates").count(), 1, "duplicates are dropped");
        assert!(!found.contains("unrelated"));
        assert_eq!(miktex_diagnostics("nothing useful here\n"), None);
        assert_eq!(miktex_diagnostics(""), None);
    }

    #[test]
    fn test_miktex_message_includes_what_miktex_said_and_the_one_time_fix() {
        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        let said = InstallFailure::Other("major issue: not checked for updates".into());
        let msg = missing_file_message("sourcesanspro.sty", &miktex, Some(&said));
        assert!(msg.contains("MiKTeX said: major issue: not checked for updates"));
        assert!(msg.contains("Check for updates"));
        assert!(msg.contains("came with the template"), "MiKTeX can't tell a custom file from a missing package");
        assert!(!missing_file_message("x.sty", &miktex, None).contains("MiKTeX said"));
        assert!(missing_file_message("tabularx.sty", &miktex, None).contains("install `tools`"));
    }

    #[test]
    fn test_tool_path_sits_next_to_pdflatex() {
        let bin = LatexBinary { path: PathBuf::from("/opt/miktex/bin/pdflatex"), is_miktex: true };
        let mpm = tool_path(&bin, "mpm");
        assert_eq!(mpm.parent(), Some(Path::new("/opt/miktex/bin")));
        assert!(mpm.file_name().unwrap().to_string_lossy().starts_with("mpm"));
    }

    #[test]
    fn test_missing_package_message_gives_a_next_step() {
        let texlive = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        let failed = InstallFailure::Other("tlmgr couldn't install `sourcesanspro`".into());
        let msg = missing_file_message("sourcesanspro.sty", &texlive, Some(&failed));
        assert!(msg.contains("tlmgr install sourcesanspro"));
        assert!(msg.contains("(tlmgr couldn't install `sourcesanspro`)"));
        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        assert!(missing_file_message("sourcesanspro.sty", &miktex, None).contains("MiKTeX Console"));
        // A class that isn't in any repository came with the template.
        let custom = missing_file_message("awesome-cv.cls", &texlive, Some(&InstallFailure::NotPublished));
        assert!(custom.contains("isn't a published LaTeX package") && !custom.contains("tlmgr install"));
        // When tlmgr can't be used at all, the message doesn't suggest it.
        let blocked = InstallFailure::Blocked("your TeX Live comes from your Linux distribution".into());
        let msg = missing_file_message("sourcesanspro.sty", &texlive, Some(&blocked));
        assert!(msg.ends_with("automatically: your TeX Live comes from your Linux distribution."), "{}", msg);
        assert!(!msg.contains("tlmgr install"));
    }

    #[cfg(unix)]
    #[test]
    fn test_run_with_timeout_kills_runaway_process() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("sleep 30").stdout(Stdio::piped());
        let start = Instant::now();
        let result = run_with_timeout(cmd, Duration::from_millis(300));
        assert_eq!(result.unwrap_err(), RunError::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(5));
    }

    #[cfg(unix)]
    #[test]
    fn test_run_with_timeout_captures_large_output() {
        // More than a pipe buffer's worth of output must not deadlock.
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("yes x | head -c 200000").stdout(Stdio::piped());
        let out = run_with_timeout(cmd, Duration::from_secs(10)).unwrap();
        assert!(out.success);
        assert_eq!(out.stdout.len(), 200000);
    }

    /// End-to-end checks against a real pdflatex; skipped when none is installed.
    fn real_pdflatex() -> Option<LatexBinary> {
        detect_pdflatex(false)
    }

    fn temp_work_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vitae_latex_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_compile_cannot_read_files_outside_work_dir() {
        let Some(bin) = real_pdflatex() else { return };
        if bin.is_miktex {
            return; // MiKTeX doesn't honour openin_any
        }
        let dir = temp_work_dir();
        let secret = std::env::temp_dir().join(format!("vitae_secret_{}.txt", uuid::Uuid::new_v4()));
        fs::write(&secret, "TOP-SECRET-VALUE").unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let doc = format!(
            "\\documentclass{{article}}\\begin{{document}}\\newread\\f\\openin\\f={}\\read\\f to\\x Leaked: \\x\\end{{document}}",
            secret.display()
        );
        let _ = compile(&bin, &dir, &id, &doc, COMPILE_TIMEOUT).unwrap();
        let pdf = fs::read(dir.join(format!("{}.pdf", id))).unwrap_or_default();
        assert!(!String::from_utf8_lossy(&pdf).contains("TOP-SECRET-VALUE"));
        let _ = fs::remove_file(secret);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_compile_times_out_on_infinite_loop() {
        let Some(bin) = real_pdflatex() else { return };
        let dir = temp_work_dir();
        let id = uuid::Uuid::new_v4().to_string();
        let doc = "\\documentclass{article}\\begin{document}\\def\\x{\\x}\\x\\end{document}";
        let err = compile(&bin, &dir, &id, doc, Duration::from_secs(3)).unwrap_err();
        assert!(err.contains("timed out"), "{}", err);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_compile_success_and_error_reporting() {
        let Some(bin) = real_pdflatex() else { return };
        let dir = temp_work_dir();
        let id = uuid::Uuid::new_v4().to_string();
        let ok = compile(&bin, &dir, &id, "\\documentclass{article}\\begin{document}Hello\\end{document}", COMPILE_TIMEOUT).unwrap();
        assert!(ok.success, "{:?}", ok.errors);
        assert!(ok.pdf_path.is_some());

        let bad = compile(&bin, &dir, &id, "\\documentclass{article}\\begin{document}\\nosuchmacro\\end{document}", COMPILE_TIMEOUT).unwrap();
        assert!(!bad.success);
        assert!(bad.errors.iter().any(|e| e.severity == "error" && e.line == Some(1)), "{:?}", bad.errors);
        let _ = fs::remove_dir_all(dir);
    }
}
