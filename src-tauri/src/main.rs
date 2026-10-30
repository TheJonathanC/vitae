// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod db;
mod latex;
mod tex_setup;

use base64::Engine as _;
use db::{init_database, Document, LibraryItem, Profile, Template};
use latex::CompilationResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

pub struct UpdateState(pub std::sync::Mutex<Option<tauri::updater::UpdateResponse<tauri::Wry>>>);

fn validate_id(id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid document ID format".to_string())?;
    Ok(())
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path_resolver()
        .app_data_dir()
        .ok_or_else(|| "Failed to get app data dir".to_string())
}

fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("vitae.db"))
}

fn temp_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("temp"))
}

#[tauri::command]
fn get_all_documents(app: tauri::AppHandle) -> Result<Vec<Document>, String> {
    let db_path = db_path(&app)?;
    db::get_all_documents(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_document(app: tauri::AppHandle, title: String) -> Result<Document, String> {
    let db_path = db_path(&app)?;
    db::create_document(&db_path, title).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_document(app: tauri::AppHandle, id: String) -> Result<Document, String> {
    validate_id(&id)?;
    let db_path = db_path(&app)?;
    db::get_document(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_document(app: tauri::AppHandle, id: String, content: String) -> Result<(), String> {
    validate_id(&id)?;
    let db_path = db_path(&app)?;
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
    let db_path = db_path(&app)?;
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
    let db_path = db_path(&app)?;
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
    let db_path = db_path(&app)?;
    db::get_all_templates(&db_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_template(app: tauri::AppHandle, id: String) -> Result<Template, String> {
    let db_path = db_path(&app)?;
    db::get_template(&db_path, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_template(
    app: tauri::AppHandle,
    name: String,
    description: String,
    content: String,
) -> Result<Template, String> {
    let db_path = db_path(&app)?;
    db::create_template(&db_path, name, description, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_template(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_path = db_path(&app)?;
    db::delete_template(&db_path, &id).map_err(|e| match e {
        rusqlite::Error::StatementChangedRows(_) => "Built-in templates cannot be deleted".to_string(),
        rusqlite::Error::QueryReturnedNoRows => "Template not found".to_string(),
        other => other.to_string(),
    })
}

#[tauri::command]
fn delete_document(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    db::delete_document(&db_path(&app)?, &id).map_err(|e| e.to_string())?;
    latex::forget_document(&id);
    latex::remove_temp_files(&temp_dir(&app)?, &id);
    Ok(())
}

/// Runs off the main thread so a long (or runaway) pdflatex never freezes the UI.
#[tauri::command]
async fn compile_latex(app: tauri::AppHandle, id: String, content: String) -> Result<CompilationResult, String> {
    validate_id(&id)?;
    let temp_dir = temp_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bin = latex::detect_pdflatex(false).ok_or_else(|| {
            "pdflatex was not found. Install a LaTeX distribution (MiKTeX, MacTeX or TeX Live) and make sure pdflatex is in PATH.".to_string()
        })?;
        latex::compile(&bin, &temp_dir, &id, &content, latex::COMPILE_TIMEOUT)
    })
    .await
    .map_err(|e| format!("Compilation task failed: {}", e))?
}

/// Save dialogs on some Linux desktops don't append the filter's extension.
fn with_pdf_extension(destination: &str) -> PathBuf {
    let path = PathBuf::from(destination);
    let is_pdf = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if is_pdf {
        path
    } else {
        PathBuf::from(format!("{}.pdf", destination))
    }
}

#[tauri::command]
fn export_pdf(app: tauri::AppHandle, id: String, destination: String) -> Result<(), String> {
    validate_id(&id)?;
    let source_pdf = temp_dir(&app)?.join(format!("{}.pdf", id));

    if !source_pdf.exists() {
        return Err("PDF not found. Please compile first.".to_string());
    }

    fs::copy(&source_pdf, with_pdf_extension(&destination))
        .map_err(|e| format!("Failed to export PDF: {}", e))?;

    Ok(())
}

fn read_compiled_pdf(temp_dir: &std::path::Path, id: &str) -> Result<String, String> {
    validate_id(id)?;
    let pdf = temp_dir.join(format!("{}.pdf", id));
    let bytes = fs::read(&pdf).map_err(|e| format!("Failed to read compiled PDF: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Returns the compiled PDF for a document as base64. Takes a document id
/// rather than a path so the webview can't use it to read arbitrary files.
#[tauri::command]
fn read_pdf_bytes(app: tauri::AppHandle, id: String) -> Result<String, String> {
    read_compiled_pdf(&temp_dir(&app)?, &id)
}

#[tauri::command]
async fn check_latex_installed() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| latex::detect_pdflatex(true).is_some())
        .await
        .map_err(|e| e.to_string())
}

static TEX_INSTALL_RUNNING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
struct TexStatus {
    installed: bool,
    kind: Option<String>,
    platform: String,
    linux_command: Option<tex_setup::InstallCommand>,
}

#[derive(Debug, Clone, Serialize)]
struct TexInstallProgress {
    phase: String,
    message: String,
}

/// Re-detects LaTeX (so a fresh install is picked up without restarting Vitae)
/// and reports what the setup guide should offer on this OS.
#[tauri::command]
async fn get_tex_status() -> Result<TexStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = latex::detect_pdflatex(true);
        let linux_command = if cfg!(target_os = "linux") {
            let os_release = fs::read_to_string("/etc/os-release").unwrap_or_default();
            tex_setup::linux_install_command(&os_release, &tex_setup::on_path)
        } else {
            None
        };
        TexStatus {
            installed: bin.is_some(),
            kind: bin.map(|b| if b.is_miktex { "miktex" } else { "texlive" }.to_string()),
            platform: match std::env::consts::OS {
                "windows" => "windows",
                "macos" => "macos",
                _ => "linux",
            }
            .to_string(),
            linux_command,
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// One-click MiKTeX install for the current Windows user. Progress is sent as
/// `tex-install-progress` events.
#[tauri::command]
async fn install_miktex(app: tauri::AppHandle, package_set: String) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("One-click installation is only available on Windows.".into());
    }
    if TEX_INSTALL_RUNNING.swap(true, Ordering::SeqCst) {
        return Err("An installation is already running.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "Couldn't find your user folder.".to_string())?;
        let work_dir = std::env::temp_dir().join("vitae-miktex-setup");
        let emit = |phase: &str, message: &str| {
            let _ = app.emit_all(
                "tex-install-progress",
                TexInstallProgress { phase: phase.to_string(), message: message.to_string() },
            );
        };
        tex_setup::install_miktex(&package_set, &work_dir, &tex_setup::miktex_install_dir(&local), &emit)?;
        latex::detect_pdflatex(true)
            .map(|_| ())
            .ok_or_else(|| "MiKTeX was installed but Vitae couldn't find it. Restart Vitae and try again.".to_string())
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    TEX_INSTALL_RUNNING.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
async fn get_tex_overview() -> Result<tex_setup::TexOverview, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let bin = latex::detect_pdflatex(false).ok_or_else(|| "LaTeX isn't installed yet.".to_string())?;
        tex_setup::overview(&bin)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_tex_package(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bin = latex::detect_pdflatex(false).ok_or_else(|| "LaTeX isn't installed yet.".to_string())?;
        tex_setup::remove_package(&bin, &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn db_error(e: rusqlite::Error) -> String {
    match e {
        rusqlite::Error::InvalidParameterName(message) => message,
        rusqlite::Error::QueryReturnedNoRows => "That entry no longer exists.".to_string(),
        other => other.to_string(),
    }
}

#[tauri::command]
fn get_person(app: tauri::AppHandle) -> Result<Option<String>, String> {
    db::get_person(&db_path(&app)?).map_err(db_error)
}

#[tauri::command]
fn save_person(app: tauri::AppHandle, data: String) -> Result<(), String> {
    db::save_person(&db_path(&app)?, &data).map_err(db_error)
}

#[tauri::command]
fn list_library_items(app: tauri::AppHandle) -> Result<Vec<LibraryItem>, String> {
    db::list_library_items(&db_path(&app)?).map_err(db_error)
}

#[tauri::command]
fn save_library_item(
    app: tauri::AppHandle,
    id: Option<String>,
    kind: String,
    data: String,
) -> Result<LibraryItem, String> {
    if let Some(id) = &id {
        validate_id(id)?;
    }
    db::save_library_item(&db_path(&app)?, id, &kind, &data).map_err(db_error)
}

#[tauri::command]
fn delete_library_item(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    db::delete_library_item(&db_path(&app)?, &id).map_err(db_error)
}

#[tauri::command]
fn list_profiles(app: tauri::AppHandle) -> Result<Vec<Profile>, String> {
    db::list_profiles(&db_path(&app)?).map_err(db_error)
}

#[tauri::command]
fn save_profile(app: tauri::AppHandle, id: Option<String>, name: String, data: String) -> Result<Profile, String> {
    if let Some(id) = &id {
        validate_id(id)?;
    }
    db::save_profile(&db_path(&app)?, id, &name, &data).map_err(db_error)
}

#[tauri::command]
fn delete_profile(app: tauri::AppHandle, id: String) -> Result<(), String> {
    validate_id(&id)?;
    db::delete_profile(&db_path(&app)?, &id).map_err(db_error)
}

fn ai_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("ai_settings.json"))
}

#[derive(Debug, Serialize)]
struct AiModels {
    provider: String,
    provider_name: String,
    models: Vec<ai::ModelInfo>,
}

fn models_view(provider: ai::Provider, models: Vec<ai::ModelInfo>) -> AiModels {
    AiModels {
        provider: serde_json::to_value(provider).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default(),
        provider_name: provider.label().to_string(),
        models,
    }
}

#[tauri::command]
fn ai_get_settings(app: tauri::AppHandle) -> Result<ai::AiSettingsView, String> {
    Ok(ai::load_settings(&ai_settings_path(&app)?).view())
}

/// Checks a key and lists the models it can use. Nothing is saved yet.
#[tauri::command]
async fn ai_validate_key(api_key: String) -> Result<AiModels, String> {
    let key = ai::clean_key(&api_key)?;
    let provider = ai::detect_provider(&key)
        .ok_or("Vitae supports Anthropic keys (sk-ant-…), OpenAI keys (sk-…) and Google Gemini keys (AIza…).")?;
    Ok(models_view(provider, ai::fetch_models(provider, &key).await?))
}

/// Lists models for the saved key, so the model can be changed without re-entering it.
#[tauri::command]
async fn ai_list_models(app: tauri::AppHandle) -> Result<AiModels, String> {
    let settings = ai::load_settings(&ai_settings_path(&app)?);
    let (Some(provider), Some(key)) = (settings.provider, settings.api_key) else {
        return Err("No API key is saved.".into());
    };
    Ok(models_view(provider, ai::fetch_models(provider, &key).await?))
}

/// Saves the key (when given) and the chosen model.
#[tauri::command]
fn ai_save_settings(app: tauri::AppHandle, api_key: Option<String>, model: String) -> Result<ai::AiSettingsView, String> {
    let model = model.trim().to_string();
    if model.is_empty() || model.len() > 100 || !model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':')) {
        return Err("Choose a model.".into());
    }
    let path = ai_settings_path(&app)?;
    let mut settings = ai::load_settings(&path);
    if let Some(key) = api_key {
        let key = ai::clean_key(&key)?;
        settings.provider = Some(ai::detect_provider(&key).ok_or("That key isn't from a supported provider.")?);
        settings.api_key = Some(key);
    }
    if settings.api_key.is_none() {
        return Err("Enter an API key first.".into());
    }
    settings.model = Some(model);
    ai::save_settings(&path, &settings)?;
    Ok(settings.view())
}

#[tauri::command]
fn ai_clear_settings(app: tauri::AppHandle) -> Result<(), String> {
    ai::clear_settings(&ai_settings_path(&app)?)
}

/// Rewrites the given bullets for a job. Only called when the user asks for AI help.
#[tauri::command]
async fn ai_rewrite(
    app: tauri::AppHandle,
    job_text: String,
    role: Option<String>,
    items: Vec<ai::RewriteItem>,
) -> Result<Vec<ai::RewriteItem>, String> {
    let settings = ai::load_settings(&ai_settings_path(&app)?);
    let (Some(provider), Some(key), Some(model)) = (settings.provider, settings.api_key, settings.model) else {
        return Err("Set up an AI key in Settings first.".into());
    };
    ai::rewrite(provider, &key, &model, &job_text, role.as_deref(), &items).await
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
            get_tex_status,
            install_miktex,
            get_tex_overview,
            remove_tex_package,
            check_update_custom,
            install_update_custom,
            get_all_templates,
            get_template,
            create_template,
            delete_template,
            ai_get_settings,
            ai_validate_key,
            ai_list_models,
            ai_save_settings,
            ai_clear_settings,
            ai_rewrite,
            get_person,
            save_person,
            list_library_items,
            save_library_item,
            delete_library_item,
            list_profiles,
            save_profile,
            delete_profile
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
    fn test_with_pdf_extension() {
        assert_eq!(with_pdf_extension("/home/me/resume"), PathBuf::from("/home/me/resume.pdf"));
        assert_eq!(with_pdf_extension("/home/me/resume.PDF"), PathBuf::from("/home/me/resume.PDF"));
        assert_eq!(with_pdf_extension("C:/out/cv.pdf"), PathBuf::from("C:/out/cv.pdf"));
    }

    #[test]
    fn test_read_compiled_pdf_rejects_paths() {
        let dir = std::env::temp_dir();
        assert!(read_compiled_pdf(&dir, "../../etc/passwd").is_err());
        assert!(read_compiled_pdf(&dir, "/etc/passwd").is_err());
    }

    #[test]
    fn test_read_compiled_pdf_success() {
        let dir = std::env::temp_dir();
        let id = uuid::Uuid::new_v4().to_string();
        let file = dir.join(format!("{}.pdf", id));
        std::fs::write(&file, b"%PDF-1.4 sample content").unwrap();
        let encoded = read_compiled_pdf(&dir, &id).unwrap();
        assert_eq!(
            base64::engine::general_purpose::STANDARD.decode(encoded).unwrap(),
            b"%PDF-1.4 sample content"
        );
        let _ = std::fs::remove_file(file);
    }

    #[test]
    fn test_read_compiled_pdf_missing() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(read_compiled_pdf(&std::env::temp_dir(), &id).is_err());
    }
}
