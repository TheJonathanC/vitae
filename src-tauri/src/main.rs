// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{init_database, Document};
use std::fs;
use std::process::Command;
use serde::{Deserialize, Serialize};

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
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::get_document(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_document(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::update_document(&db_path, &id, &content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("vitae.db");
    
    db::delete_document(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn compile_latex(app: tauri::AppHandle, id: String, content: String) -> Result<CompilationResult, String> {
    // Get temp directory for compilation
    let temp_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("temp");
    
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    
    let tex_file = temp_dir.join(format!("{}.tex", id));
    let pdf_file = temp_dir.join(format!("{}.pdf", id));
    
    // Delete old PDF and auxiliary files to ensure fresh compilation
    let _ = fs::remove_file(&pdf_file);
    let _ = fs::remove_file(temp_dir.join(format!("{}.aux", id)));
    let _ = fs::remove_file(temp_dir.join(format!("{}.log", id)));
    let _ = fs::remove_file(temp_dir.join(format!("{}.out", id)));
    
    // Write LaTeX content to file
    fs::write(&tex_file, content).map_err(|e| format!("Failed to write tex file: {}", e))?;
    
    // Run pdflatex
    let output = Command::new("pdflatex")
        .arg("-interaction=nonstopmode")
        .arg("-file-line-error")
        .arg("-output-directory")
        .arg(&temp_dir)
        .arg(&tex_file)
        .output()
        .map_err(|e| format!("Failed to run pdflatex: {}. Make sure pdflatex is installed and in PATH.", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let errors = parse_latex_errors(&stdout);
    
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
        // Parse errors with format: ./file.tex:123: Error message
        if line.contains(":") {
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            if parts.len() >= 3 {
                // Try to parse line number
                if let Ok(line_num) = parts[1].trim().parse::<u32>() {
                    let message = parts[2].trim().to_string();
                    
                    // Determine severity
                    let severity = if message.to_lowercase().contains("error") || line.contains("!") {
                        "error"
                    } else if message.to_lowercase().contains("warning") {
                        "warning"
                    } else {
                        continue; // Skip non-error/warning lines
                    };
                    
                    errors.push(LatexError {
                        line: Some(line_num),
                        message,
                        severity: severity.to_string(),
                    });
                    continue;
                }
            }
        }
        
        // Parse errors without line numbers
        if line.starts_with("! ") {
            errors.push(LatexError {
                line: None,
                message: line[2..].trim().to_string(),
                severity: "error".to_string(),
            });
        } else if line.to_lowercase().contains("latex warning") {
            errors.push(LatexError {
                line: None,
                message: line.trim().to_string(),
                severity: "warning".to_string(),
            });
        }
    }
    
    errors
}

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, id: String, destination: String) -> Result<(), String> {
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
fn check_latex_installed() -> Result<bool, String> {
    // Try to run pdflatex --version
    match Command::new("pdflatex")
        .arg("--version")
        .output()
    {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false), // Command not found
    }
}

fn main() {
    tauri::Builder::default()
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
            get_document,
            update_document,
            delete_document,
            compile_latex,
            export_pdf,
            check_latex_installed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
