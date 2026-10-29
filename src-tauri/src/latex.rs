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
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Upper bound for a single pdflatex pass. Generous because MiKTeX may download
/// missing packages on first use, but finite so an infinite TeX loop cannot
/// wedge the compiler forever.
pub const COMPILE_TIMEOUT: Duration = Duration::from_secs(120);

pub const LATEX_TEMP_EXTENSIONS: &[&str] = &[
    "tex", "pdf", "aux", "log", "out", "toc", "nav", "snm",
    "fls", "synctex.gz", "bbl", "blg", "idx", "ind", "ilg", "lot", "lof",
    "bcf", "run.xml",
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
        stdout,
    })
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

    let run_pass = || -> Result<PassOutput, String> {
        run_with_timeout(sandboxed_command(bin, temp_dir, &tex_name), timeout).map_err(|e| match e {
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

    let errors = parse_latex_errors(&pass.stdout);
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

    let success = pass.success && !has_errors;
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
