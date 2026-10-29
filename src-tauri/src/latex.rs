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
    "bcf", "run.xml", "stderr",
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
pub fn sandboxed_command(bin: &LatexBinary, work_dir: &Path, tex_name: &str) -> Command {
    let mut cmd = create_silent_command(&bin.path);
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

/// Most missing packages a single compile may install, so a template that pulls in
/// a long chain of them still builds but a loop can't run away.
const MAX_AUTO_INSTALLS: usize = 8;
const TLMGR_SEARCH_TIMEOUT: Duration = Duration::from_secs(60);
pub const MIKTEX_REPOSITORY: &str = "https://mirrors.ctan.org/systems/win32/miktex/tm/packages/";
const TLMGR_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
const TEX_SUPPORT_EXTENSIONS: &[&str] = &["sty", "cls", "clo", "def", "fd", "cfg"];

/// The file named by `LaTeX Error: File `x.sty' not found.` (with or without a
/// `-file-line-error` prefix). Names that aren't plain TeX support files are
/// rejected because the result is later handed to `tlmgr`.
pub fn parse_missing_file(output: &str) -> Option<String> {
    output
        .lines()
        .filter(|line| line.contains("not found"))
        .filter_map(|line| line.split("File `").nth(1)?.split('\'').next())
        .find(|name| is_plain_tex_file(name))
        .map(str::to_string)
}

fn is_plain_tex_file(name: &str) -> bool {
    let ext_ok = name
        .rsplit_once('.')
        .map_or(false, |(stem, ext)| !stem.is_empty() && TEX_SUPPORT_EXTENSIONS.contains(&ext));
    ext_ok
        && name.len() <= 100
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
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

/// A helper tool (`tlmgr`, `mpm`) that ships next to `pdflatex`.
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

/// Runs a tool, keeping what it writes to stderr (MiKTeX reports problems there).
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
fn install_with_mpm(bin: &LatexBinary, file: &str, log_dir: &Path, id: &str) -> Result<String, String> {
    let package = file.rsplit_once('.').map_or(file, |(stem, _)| stem).to_string();
    if !is_plain_package_name(&package) {
        return Err("the package name isn't valid".into());
    }
    let mpm = tool_path(bin, "mpm");
    let log = log_dir.join(format!("{}.stderr", id));
    if !MIKTEX_DB_REFRESHED.load(Ordering::SeqCst) {
        if let Ok((out, _)) = run_tool_logged(&mpm, &mpm_update_db_args(), TLMGR_INSTALL_TIMEOUT, &log) {
            if out.success {
                MIKTEX_DB_REFRESHED.store(true, Ordering::SeqCst);
            }
        }
    }
    let (out, stderr) = run_tool_logged(&mpm, &mpm_install_args(&package), TLMGR_INSTALL_TIMEOUT, &log)?;
    if out.success {
        return Ok(package);
    }
    let detail = miktex_diagnostics(&format!("{}\n{}", stderr, out.stdout))
        .unwrap_or_else(|| format!("mpm couldn't install `{}`", package));
    Err(detail)
}

fn run_tlmgr(tlmgr: &Path, args: &[&str], timeout: Duration) -> Result<PassOutput, String> {
    let mut cmd = create_silent_command(tlmgr);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    run_with_timeout(cmd, timeout).map_err(|e| match e {
        RunError::TimedOut => "tlmgr timed out".to_string(),
        RunError::Spawn(msg) => format!("couldn't run tlmgr ({})", msg),
    })
}

/// Installs the TeX Live package that provides `file` and returns its name.
/// Falls back to a per-user tree when the system one isn't writable.
fn install_missing_file(bin: &LatexBinary, file: &str) -> Result<String, String> {
    let tlmgr = tlmgr_path(bin);
    let found = run_tlmgr(&tlmgr, &["search", "--file", "--global", &format!("/{}", file)], TLMGR_SEARCH_TIMEOUT)?;
    let package = parse_tlmgr_search(&found.stdout, file).ok_or_else(|| {
        if found.success {
            "it isn't in the TeX Live repository".to_string()
        } else {
            "tlmgr couldn't reach the TeX Live repository".to_string()
        }
    })?;
    if run_tlmgr(&tlmgr, &["install", &package], TLMGR_INSTALL_TIMEOUT)?.success {
        return Ok(package);
    }
    let _ = run_tlmgr(&tlmgr, &["init-usertree"], TLMGR_SEARCH_TIMEOUT);
    if run_tlmgr(&tlmgr, &["--usermode", "install", &package], TLMGR_INSTALL_TIMEOUT)?.success {
        return Ok(package);
    }
    Err(format!("installing `{}` failed", package))
}

/// A readable replacement for TeX's bare "File not found" when auto-install didn't help.
pub fn missing_package_message(file: &str, bin: &LatexBinary, install_error: Option<&str>) -> String {
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    if bin.is_miktex {
        let why = install_error.map(|e| format!(" MiKTeX said: {}", e)).unwrap_or_default();
        format!(
            "The LaTeX package file `{}` is missing and Vitae couldn't install it automatically.{} To fix it once, open MiKTeX Console, choose Updates and then Check for updates; or install `{}` under Packages. Then compile again.",
            file, why, stem
        )
    } else {
        let why = install_error.map(|e| format!(" ({})", e)).unwrap_or_default();
        format!(
            "The LaTeX package file `{}` is missing and Vitae couldn't install it automatically{}. Install it with `tlmgr install {}` (or your system's TeX package manager) and compile again.",
            file, why, stem
        )
    }
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

/// Explains a pdflatex run that failed (non-zero exit) without printing a LaTeX
/// error: the exit code, anything MiKTeX said, and the last lines of output.
pub fn silent_failure_message(code: Option<i32>, stdout: &str, notes: Option<&str>, pdf_produced: bool) -> String {
    let exit = code.map_or("an unknown code".to_string(), |c| format!("code {}", c));
    let tail: Vec<&str> = stdout.lines().map(str::trim).filter(|l| !l.is_empty()).rev().take(5).collect();
    let tail: String = tail.into_iter().rev().collect::<Vec<_>>().join(" | ");
    let mut message = if pdf_produced {
        format!("pdflatex exited with {} but produced a PDF and reported no errors, so the PDF is shown.", exit)
    } else {
        format!("pdflatex exited with {} without reporting a LaTeX error and produced no PDF.", exit)
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

/// Compiles `content` for document `id` inside `temp_dir`. The caller must have
/// validated `id` (it is used to build file names).
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

    fs::write(&tex_file, content).map_err(|e| format!("Failed to write tex file: {}", e))?;
    let started = SystemTime::now();

    // MiKTeX explains installer problems on stderr, which is otherwise discarded.
    let err_log = temp_dir.join(format!("{}.stderr", id));
    let run_pass = || -> Result<PassOutput, String> {
        let mut cmd = sandboxed_command(bin, temp_dir, &tex_name);
        if bin.is_miktex {
            if let Ok(file) = fs::File::create(&err_log) {
                cmd.stderr(Stdio::from(file));
            }
        }
        run_with_timeout(cmd, timeout).map_err(|e| match e {
            RunError::TimedOut => format!(
                "Compilation timed out after {} seconds. Check for an infinite loop (e.g. a macro that calls itself); if LaTeX is downloading packages, try again.",
                timeout.as_secs()
            ),
            RunError::Spawn(msg) => format!(
                "Failed to run pdflatex: {}. Make sure pdflatex is installed and in PATH.",
                msg
            ),
        })
    };

    // Pass 1 is incremental: existing .aux/.out are kept so most edits need one pass.
    let mut pass = run_pass()?;

    // Install whatever the log says is missing, then compile again. MiKTeX normally
    // does this itself (--enable-installer); when it couldn't, ask mpm directly.
    // TeX Live can't fetch packages mid-run at all, so it always takes this path.
    let mut installed: Vec<String> = Vec::new();
    let mut install_error: Option<String> = None;
    while !pass.success && installed.len() < MAX_AUTO_INSTALLS {
        let Some(file) = parse_missing_file(&pass.stdout) else { break };
        let attempt = if bin.is_miktex {
            install_with_mpm(bin, &file, temp_dir, id)
        } else {
            install_missing_file(bin, &file)
        };
        match attempt {
            Ok(package) if !installed.contains(&package) => {
                installed.push(package);
                pass = run_pass()?;
            }
            Ok(package) => {
                install_error = Some(format!("`{}` is installed but `{}` is still not found", package, file));
                break;
            }
            Err(why) => {
                install_error = Some(why);
                break;
            }
        }
    }

    // Stale auxiliary files from an interrupted run can break the next compile.
    // Only then is a clean rebuild worth a second pdflatex run.
    if !pass.success && failed_in_aux_file(&pass.stdout, id) {
        for ext in AUX_EXTENSIONS {
            let _ = fs::remove_file(temp_dir.join(format!("{}.{}", id, ext)));
        }
        pass = run_pass()?;
    }

    // With preserved aux files, at most one extra pass is needed for references/outlines.
    if pass.success && check_needs_rerun(&pass.stdout) {
        pass = run_pass()?;
    }

    let mut errors = parse_latex_errors(&pass.stdout);
    if !pass.success {
        if let Some(file) = parse_missing_file(&pass.stdout) {
            // Prefer what mpm said; otherwise whatever MiKTeX printed during the compile.
            let reason = install_error
                .clone()
                .or_else(|| fs::read_to_string(&err_log).ok().and_then(|log| miktex_diagnostics(&log)));
            errors.insert(
                0,
                LatexError {
                    line: None,
                    message: missing_package_message(&file, bin, reason.as_deref()),
                    severity: "error".to_string(),
                },
            );
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
            message: silent_failure_message(pass.code, &pass.stdout, notes.as_deref(), fresh_pdf),
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

        // Parse errors starting with '! '
        if let Some(rest) = trimmed.strip_prefix("! ") {
            let message = rest.trim().to_string();
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
        let cmd = sandboxed_command(&texlive, Path::new("/tmp/work"), "doc.tex");
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
        let cmd = sandboxed_command(&miktex, Path::new("/tmp/work"), "doc.tex");
        assert!(cmd.get_args().any(|a| a == "-disable-write18"));
        assert!(cmd.get_args().any(|a| a == "--enable-installer"), "MiKTeX should install missing packages itself");
        let texlive_cmd = sandboxed_command(&texlive, Path::new("/tmp/work"), "doc.tex");
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
        let kept = silent_failure_message(Some(1), out, None, true);
        assert!(kept.contains("code 1") && kept.contains("the PDF is shown"));
        assert!(!kept.contains("Last output"));
        let lost = silent_failure_message(None, out, Some("major issue: x"), false);
        assert!(lost.contains("unknown code") && lost.contains("produced no PDF"));
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
                "#!/bin/sh\nfor last; do :; done\n{}\necho 'Package fancyhdr Warning: \\footskip is too small (0.0pt):'\nexit 1\n",
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
        let msg = missing_package_message("sourcesanspro.sty", &miktex, Some("major issue: not checked for updates"));
        assert!(msg.contains("MiKTeX said: major issue: not checked for updates"));
        assert!(msg.contains("Check for updates"));
        assert!(!missing_package_message("x.sty", &miktex, None).contains("MiKTeX said"));
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
        let msg = missing_package_message("sourcesanspro.sty", &texlive, Some("installing `sourcesanspro` failed"));
        assert!(msg.contains("tlmgr install sourcesanspro"));
        let miktex = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: true };
        assert!(missing_package_message("sourcesanspro.sty", &miktex, None).contains("MiKTeX Console"));
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
