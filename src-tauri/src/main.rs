// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{init_database, Document};
use std::fs;
use std::process::Command;

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
fn compile_latex(app: tauri::AppHandle, id: String, content: String) -> Result<String, String> {
    // Get temp directory for compilation
    let temp_dir = app
        .path_resolver()
        .app_data_dir()
        .ok_or("Failed to get app data dir")?
        .join("temp");
    
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    
    let tex_file = temp_dir.join(format!("{}.tex", id));
    let pdf_file = temp_dir.join(format!("{}.pdf", id));
    
    // Write LaTeX content to file
    fs::write(&tex_file, content).map_err(|e| format!("Failed to write tex file: {}", e))?;
    
    // Run pdflatex
    let output = Command::new("pdflatex")
        .arg("-interaction=nonstopmode")
        .arg("-output-directory")
        .arg(&temp_dir)
        .arg(&tex_file)
        .output()
        .map_err(|e| format!("Failed to run pdflatex: {}. Make sure pdflatex is installed and in PATH.", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("LaTeX compilation failed:\n{}\n{}", stdout, stderr));
    }
    
    // Check if PDF was created
    if !pdf_file.exists() {
        return Err("PDF file was not generated".to_string());
    }
    
    // Return the path to the PDF
    Ok(pdf_file
        .to_str()
        .ok_or("Invalid PDF path")?
        .to_string()
        .replace("\\", "/"))
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
            export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
