// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{init_database, Document, Template};
use std::fs;
use std::process::Command;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;

static COMPILE_MUTEX: Mutex<()> = Mutex::new(());
static LAST_COMPILE_HASH: Mutex<Option<HashMap<String, u64>>> = Mutex::new(None);

fn calculate_hash<T: Hash>(t: &T) -> u64 {
    let mut s = DefaultHasher::new();
    t.hash(&mut s);
    s.finish()
}

#[allow(unused_mut)]
fn create_silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn find_pdflatex_binary() -> std::path::PathBuf {
    // 1. Check if "pdflatex" is directly accessible in PATH
    let mut probe = create_silent_command("pdflatex");
    probe.arg("--version");
    if let Ok(output) = probe.output() {
        if output.status.success() {
            return std::path::PathBuf::from("pdflatex");
        }
    }

    // 2. On Windows, check common MiKTeX and TeXLive installation directories
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(std::path::PathBuf::from(&program_files).join("MiKTeX").join("miktex").join("bin").join("x64").join("pdflatex.exe"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(std::path::PathBuf::from(&local_app_data).join("Programs").join("MiKTeX").join("miktex").join("bin").join("x64").join("pdflatex.exe"));
        }
        for year in (2020..=2028).rev() {
            candidates.push(std::path::PathBuf::from(format!(r"C:\texlive\{}\bin\windows\pdflatex.exe", year)));
            candidates.push(std::path::PathBuf::from(format!(r"C:\texlive\{}\bin\win32\pdflatex.exe", year)));
        }
        for candidate in candidates {
            if candidate.exists() {
                let mut cmd = create_silent_command(&candidate);
                cmd.arg("--version");
                if let Ok(output) = cmd.output() {
                    if output.status.success() {
                        return candidate;
                    }
                }
            }
        }
    }

    std::path::PathBuf::from("pdflatex")
}

const LATEX_TEMP_EXTENSIONS: &[&str] = &[
    "tex", "pdf", "aux", "log", "out", "toc", "nav", "snm",
    "fls", "synctex.gz", "bbl", "blg", "idx", "ind", "ilg", "lot", "lof",
    "bcf", "run.xml",
];

pub struct UpdateState(pub std::sync::Mutex<Option<tauri::updater::UpdateResponse<tauri::Wry>>>);

#[derive(Debug, Serialize, Deserialize)]
struct CompilationResult {
    success: bool,
    pdf_path: Option<String>,
    errors: Vec<LatexError>,
}

#[derive(Debug, Serialize, Deserialize)]
struct LatexError {
    line: Option<u32>,
    message: String,
    severity: String, // "error" or "warning"
}

fn validate_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid document ID format".to_string())?;
    Ok(())
}

#[tauri::command]
fn get_all_documents(app: tauri::AppHandle) -> Result<Vec<Document>, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::get_all_documents(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_document(app: tauri::AppHandle, title: String) -> Result<Document, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::create_document(&db_path, title).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_document(app: tauri::AppHandle, id: String) -> Result<Document, String> {
    validate_id(&id)?;
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::get_document(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_document(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    validate_id(&id)?;
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::update_document(&db_path, &id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_document_with_template(
    app: tauri::AppHandle,
    title: String,
    template_id: Option<String>,
    resume_data: Option<String>,
    initial_content: Option<String>,
) -> Result<Document, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::create_document_with_template(&db_path, title, template_id, resume_data, initial_content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_document_full(
    app: tauri::AppHandle,
    id: String,
    content: String,
    template_id: Option<String>,
    resume_data: Option<String>,
) -> Result<(), String> {
    validate_id(&id)?;
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::update_document_full(
        &db_path,
        &id,
        &content,
        template_id.as_deref(),
        resume_data.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_all_templates(app: tauri::AppHandle) -> Result<Vec<Template>, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::get_all_templates(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_template(app: tauri::AppHandle, id: String) -> Result<Template, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::get_template(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_template(
    app: tauri::AppHandle,
    name: String,
    description: String,
    content: String,
) -> Result<Template, String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::create_template(&db_path, name, description, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::delete_template(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    let app_data_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?;
    let db_path = app_data_dir.join("vitae.db");
    
    db::delete_document(&db_path, &id).map_err(|e| e.to_string())?;

    // Clear compilation cache for this document
    if let Ok(mut map) = LAST_COMPILE_HASH.lock() {
        if let Some(m) = map.as_mut() {
            m.remove(&id);
        }
    }

    // Clean up temporary compilation files
    let temp_dir = app_data_dir.join("temp");
    for ext in LATEX_TEMP_EXTENSIONS {
        let file_path = temp_dir.join(format!("{}.{}", id, ext));
        let _ = fs::remove_file(file_path);
    }

    Ok(())
}

fn check_needs_rerun(output: &str) -> bool {
    let lower = output.to_lowercase();
    lower.contains("rerun to get cross-references right")
        || lower.contains("label(s) may have changed")
        || lower.contains("rerun to get outlines right")
        || lower.contains("rerun to get citations correct")
        || lower.contains("rerun to get bibliographical references right")
        || lower.contains("rerun to get order correct")
        || lower.contains("rerun to get")
        || lower.contains("rerun to ")
        || lower.contains("rerun latex")
        || lower.contains("please rerun")
        || lower.contains("(re)run latex")
}

#[tauri::command]
fn compile_latex(app: tauri::AppHandle, id: String, content: String) -> Result<CompilationResult, String> {
    validate_id(&id)?;

    // Lock to prevent concurrent compilations from colliding and locking files on Windows
    let _lock = COMPILE_MUTEX.lock().map_err(|e| format!("Failed to acquire compile lock: {}", e))?;

    // Get temp directory for compilation
    let temp_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("temp");
    
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    
    let tex_file = temp_dir.join(format!("{}.tex", id));
    let pdf_file = temp_dir.join(format!("{}.pdf", id));

    let content_hash = calculate_hash(&content);

    // If identical content was already compiled successfully and PDF exists, return cached result immediately (<1ms)
    let is_identical = {
        let map = LAST_COMPILE_HASH.lock().unwrap();
        map.as_ref().and_then(|m| m.get(&id).copied()) == Some(content_hash)
    };
    if is_identical && pdf_file.exists() {
        let pdf_path = pdf_file
            .to_str()
            .ok_or("Invalid PDF path")?
            .to_string()
            .replace("\\", "/");
        return Ok(CompilationResult {
            success: true,
            pdf_path: Some(pdf_path),
            errors: vec![],
        });
    }

    // Write LaTeX content to file
    fs::write(&tex_file, &content).map_err(|e| format!("Failed to write tex file: {}", e))?;

    let binary = find_pdflatex_binary();

    // Helper to execute pdflatex quietly without opening console window
    let run_pdflatex = || {
        create_silent_command(&binary)
            .arg("-interaction=nonstopmode")
            .arg("-halt-on-error")
            .arg("-file-line-error")
            .arg("-output-directory")
            .arg(&temp_dir)
            .arg(&tex_file)
            .output()
    };

    // Run pass 1 (incremental: keeps existing .aux and .out for ultra-fast single-pass compilation)
    let output = run_pdflatex()
        .map_err(|e| format!("Failed to run pdflatex: {}. Make sure pdflatex is installed and in PATH.", e))?;
    
    let mut current_stdout = String::from_utf8_lossy(&output.stdout).to_string();

    // If compilation failed and PDF was not created, auxiliary files might have been corrupted from a previous interrupted run.
    // Try one clean run by removing aux files and re-running.
    if !pdf_file.exists() {
        for ext in LATEX_TEMP_EXTENSIONS {
            if *ext != "tex" {
                let _ = fs::remove_file(temp_dir.join(format!("{}.{}", id, ext)));
            }
        }
        if let Ok(clean_output) = run_pdflatex() {
            current_stdout = String::from_utf8_lossy(&clean_output.stdout).to_string();
        }
    }

    // Check if subsequent pass is required for cross-references / outlines / citations
    let mut passes = 1;
    const MAX_PASSES: usize = 2; // With preserved aux files, at most 2 passes is ever required
    while pdf_file.exists() && passes < MAX_PASSES && check_needs_rerun(&current_stdout) {
        if let Ok(rerun_output) = run_pdflatex() {
            current_stdout = String::from_utf8_lossy(&rerun_output.stdout).to_string();
            passes += 1;
        } else {
            break;
        }
    }

    let errors = parse_latex_errors(&current_stdout);
    
    // Check if PDF was created
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
    
    // PDF exists - check for errors
    let has_errors = errors.iter().any(|e| e.severity == "error");

    if !has_errors {
        let mut map = LAST_COMPILE_HASH.lock().unwrap();
        map.get_or_insert_with(HashMap::new).insert(id.clone(), content_hash);
    }
    
    let pdf_path = pdf_file
        .to_str()
        .ok_or("Invalid PDF path")?
        .to_string()
        .replace("\\", "/");
    
    // Return the path to the PDF
    Ok(CompilationResult {
        success: !has_errors,
        pdf_path: Some(pdf_path),
        errors,
    })
}

fn parse_latex_errors(output: &str) -> Vec<LatexError> {
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
                && parts[0].chars().next().map_or(false, |c| c.is_ascii_alphabetic())
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
        if trimmed.starts_with("! ") {
            let message = trimmed[2..].trim().to_string();
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

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, id: String, destination: String) -> Result<(), String> {
    validate_id(&id)?;
    let temp_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("temp");
    
    let source_pdf = temp_dir.join(format!("{}.pdf", id));
    
    if !source_pdf.exists() {
        return Err("PDF not found. Please compile first.".to_string());
    }
    
    fs::copy(&source_pdf, &destination)
        .map_err(|e| format!("Failed to export PDF: {}", e))?;
    
    Ok(())
}

#[tauri::command]
fn read_pdf_bytes(path: String) -> Result<Vec<u8>, String> {
    let clean_path = path.trim().split('?').next().unwrap_or(&path);
    let path_obj = std::path::Path::new(clean_path);
    if !path_obj.exists() {
        return Err(format!("PDF file not found at: {}", clean_path));
    }
    fs::read(path_obj).map_err(|e| format!("Failed to read PDF file: {}", e))
}

#[tauri::command]
fn check_latex_installed() -> Result<bool, String> {
    let binary = find_pdflatex_binary();
    let mut cmd = create_silent_command(&binary);
    cmd.arg("--version");
    match cmd.output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false), // Command not found
    }
}

fn get_update_endpoint(channel: &str) -> &'static str {
    if channel.eq_ignore_ascii_case("beta") {
        "https://github.com/TheJonathanC/vitae/releases/download/latest-beta/latest-beta.json"
    } else {
        "https://github.com/TheJonathanC/vitae/releases/latest/download/latest.json"
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateCheckResponse {
    should_update: bool,
    version: Option<String>,
    date: Option<String>,
    body: Option<String>,
    download_url: Option<String>,
}

#[tauri::command]
async fn check_update_custom(
    app: tauri::AppHandle,
    channel: String,
    state: tauri::State<'_, UpdateState>,
) -> Result<UpdateCheckResponse, String> {
    let endpoint = get_update_endpoint(&channel);
    let urls = [endpoint.to_string()];
    let builder = tauri::updater::builder(app).endpoints(&urls);
    let update = match builder.check().await {
        Ok(u) => u,
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("Could not fetch a valid release JSON") {
                return Err(format!(
                    "Could not fetch release manifest from {}. (Manifest may not yet be published for this channel)",
                    endpoint
                ));
            }
            return Err(err_str);
        }
    };
    
    if update.is_update_available() {
        let resp = UpdateCheckResponse {
            should_update: true,
            version: Some(update.latest_version().to_string()),
            date: update.date().map(|d| d.to_string()),
            body: update.body().map(|b| b.to_string()),
            download_url: None,
        };
        if let Ok(mut guard) = state.0.lock() {
            *guard = Some(update);
        }
        Ok(resp)
    } else {
        if let Ok(mut guard) = state.0.lock() {
            *guard = None;
        }
        Ok(UpdateCheckResponse {
            should_update: false,
            version: None,
            date: None,
            body: None,
            download_url: None,
        })
    }
}

#[tauri::command]
async fn install_update_custom(
    app: tauri::AppHandle,
    channel: String,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let cached_update = state
        .0
        .lock()
        .map_err(|e| format!("Failed to lock update state: {}", e))?
        .take();

    let update = match cached_update {
        Some(u) => u,
        None => {
            let endpoint = get_update_endpoint(&channel);
            let urls = [endpoint.to_string()];
            let builder = tauri::updater::builder(app).endpoints(&urls);
            builder.check().await.map_err(|e| e.to_string())?
        }
    };

    if update.is_update_available() {
        update.download_and_install().await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("No update available to install".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(UpdateState(std::sync::Mutex::new(None)))
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path_resolver()
                .app_data_dir()
                .expect("Failed to get app data dir");
            
            fs::create_dir_all(&app_data_dir).expect("Failed to create app data directory");
            
            let db_path = app_data_dir.join("vitae.db");
            init_database(&db_path).expect("Failed to initialize database");
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_documents,
            create_document,
            create_document_with_template,
            get_document,
            update_document,
            update_document_full,
            delete_document,
            compile_latex,
            export_pdf,
            read_pdf_bytes,
            check_latex_installed,
            check_update_custom,
            install_update_custom,
            get_all_templates,
            get_template,
            create_template,
            delete_template
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_id() {
        assert!(validate_id("a1a2a3a4-b1b2-c1c2-d1d2-d3d4d5d6d7d8").is_ok());
        assert!(validate_id("../../etc/passwd").is_err());
        assert!(validate_id("not-a-uuid").is_err());
        assert!(validate_id("").is_err());
    }

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
    fn test_get_update_endpoint() {
        assert_eq!(
            get_update_endpoint("beta"),
            "https://github.com/TheJonathanC/vitae/releases/download/latest-beta/latest-beta.json"
        );
        assert_eq!(
            get_update_endpoint("BETA"),
            "https://github.com/TheJonathanC/vitae/releases/download/latest-beta/latest-beta.json"
        );
        assert_eq!(
            get_update_endpoint("stable"),
            "https://github.com/TheJonathanC/vitae/releases/latest/download/latest.json"
        );
        assert_eq!(
            get_update_endpoint("other"),
            "https://github.com/TheJonathanC/vitae/releases/latest/download/latest.json"
        );
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
    fn test_read_pdf_bytes_nonexistent() {
        let result = read_pdf_bytes("nonexistent_path_xyz_1234.pdf".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_read_pdf_bytes_success() {
        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("vitae_test_sample.pdf");
        std::fs::write(&test_file, b"%PDF-1.4 sample content").unwrap();
        let result = read_pdf_bytes(test_file.to_str().unwrap().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), b"%PDF-1.4 sample content");
        let _ = std::fs::remove_file(test_file);
    }
}

