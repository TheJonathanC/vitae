use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Template {
    pub id: String,
    pub name: String,
    pub description: String,
    pub content: String,
    pub is_builtin: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub content: String,
    pub template_id: Option<String>,
    pub resume_data: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub fn escape_latex(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '\\' => escaped.push_str(r"\textbackslash{}"),
            '~' => escaped.push_str(r"\textasciitilde{}"),
            '^' => escaped.push_str(r"\textasciicircum{}"),
            '&' => escaped.push_str(r"\&"),
            '%' => escaped.push_str(r"\%"),
            '$' => escaped.push_str(r"\$"),
            '#' => escaped.push_str(r"\#"),
            '_' => escaped.push_str(r"\_"),
            '{' => escaped.push_str(r"\{"),
            '}' => escaped.push_str(r"\}"),
            // OT1-encoded fonts would print these as ¡, ¿ and an em dash.
            '<' => escaped.push_str(r"\textless{}"),
            '>' => escaped.push_str(r"\textgreater{}"),
            '|' => escaped.push_str(r"\textbar{}"),
            _ => escaped.push(c),
        }
    }
    escaped
}

// Shared with the frontend (src/utils/templatePresets.ts) so the two can't drift.
const TEMPLATE_MODERN: &str = include_str!("../templates/modern.tex");
const TEMPLATE_CLASSIC: &str = include_str!("../templates/classic.tex");
const TEMPLATE_MINIMAL: &str = include_str!("../templates/minimal.tex");

fn seed_builtin_templates(conn: &Connection) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    
    let presets = [
        (
            "template-modern",
            "Modern Professional",
            "Clean sans-serif / small-caps resume with horizontal dividers and structured sections for tech and industry professionals.",
            TEMPLATE_MODERN,
        ),
        (
            "template-classic",
            "Classic Academic",
            "Traditional serif layout with formal styling, ideal for academic CVs, research positions, and executive resumes.",
            TEMPLATE_CLASSIC,
        ),
        (
            "template-minimal",
            "Minimalist Single-Column",
            "Sleek and compact single-column format optimized for readability and automated ATS parsers.",
            TEMPLATE_MINIMAL,
        ),
    ];

    // Upsert so template fixes shipped in an app update reach existing installs.
    // Built-ins are read-only in the UI, so there are no user edits to preserve.
    for (id, name, desc, content) in presets {
        conn.execute(
            "INSERT INTO templates (id, name, description, content, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, content = excluded.content, is_builtin = 1",
            params![id, name, desc, content, &now],
        )?;
    }

    Ok(())
}

pub fn init_database(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            template_id TEXT,
            resume_data TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Handle migration for documents table if columns missing
    let mut stmt = conn.prepare("PRAGMA table_info(documents)")?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<String>>>()?;
    
    if !columns.iter().any(|c| c == "template_id") {
        conn.execute("ALTER TABLE documents ADD COLUMN template_id TEXT", [])?;
    }
    if !columns.iter().any(|c| c == "resume_data") {
        conn.execute("ALTER TABLE documents ADD COLUMN resume_data TEXT", [])?;
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS templates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            content TEXT NOT NULL,
            is_builtin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        )",
        [],
    )?;

    seed_builtin_templates(&conn)?;

    // The user's reusable details. Personal info is a single shared row; experiences,
    // projects, education and skill groups live in a library; profiles pick from it.
    // Payloads are JSON so the shape can grow without migrations.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS person (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS library_items (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LibraryItem {
    pub id: String,
    pub kind: String,
    pub data: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub data: String,
    pub created_at: String,
    pub updated_at: String,
}

pub const LIBRARY_KINDS: &[&str] = &["experience", "project", "education", "skill"];
const MAX_PAYLOAD_BYTES: usize = 200_000;

fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.to_string())
}

/// Payloads are opaque to the database but must be a JSON object of sane size.
fn check_payload(data: &str) -> Result<()> {
    if data.len() > MAX_PAYLOAD_BYTES {
        return Err(invalid("That entry is too large to save."));
    }
    match serde_json::from_str::<serde_json::Value>(data) {
        Ok(serde_json::Value::Object(_)) => Ok(()),
        _ => Err(invalid("That entry isn't valid.")),
    }
}

pub fn get_person(db_path: &Path) -> Result<Option<String>> {
    let conn = Connection::open(db_path)?;
    match conn.query_row("SELECT data FROM person WHERE id = 1", [], |row| row.get(0)) {
        Ok(data) => Ok(Some(data)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn save_person(db_path: &Path, data: &str) -> Result<()> {
    check_payload(data)?;
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO person (id, data, updated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        params![data, chrono::Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn list_library_items(db_path: &Path) -> Result<Vec<LibraryItem>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, kind, data, created_at, updated_at FROM library_items ORDER BY kind, updated_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(LibraryItem {
            id: row.get(0)?,
            kind: row.get(1)?,
            data: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

/// Creates the item when `id` is None, otherwise updates it.
pub fn save_library_item(db_path: &Path, id: Option<String>, kind: &str, data: &str) -> Result<LibraryItem> {
    if !LIBRARY_KINDS.contains(&kind) {
        return Err(invalid("Unknown kind of entry."));
    }
    check_payload(data)?;
    let conn = Connection::open(db_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO library_items (id, kind, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
         WHERE library_items.kind = excluded.kind",
        params![&id, kind, data, &now],
    )?;
    conn.query_row(
        "SELECT id, kind, data, created_at, updated_at FROM library_items WHERE id = ?1",
        [&id],
        |row| {
            Ok(LibraryItem {
                id: row.get(0)?,
                kind: row.get(1)?,
                data: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
}

pub fn delete_library_item(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let changed = conn.execute("DELETE FROM library_items WHERE id = ?1", [id])?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn list_profiles(db_path: &Path) -> Result<Vec<Profile>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT id, name, data, created_at, updated_at FROM profiles ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |row| {
        Ok(Profile {
            id: row.get(0)?,
            name: row.get(1)?,
            data: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub fn save_profile(db_path: &Path, id: Option<String>, name: &str, data: &str) -> Result<Profile> {
    let name = name.trim();
    if name.is_empty() || name.len() > 100 {
        return Err(invalid("A profile needs a name of up to 100 characters."));
    }
    check_payload(data)?;
    let conn = Connection::open(db_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    conn.execute(
        "INSERT INTO profiles (id, name, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, data = excluded.data, updated_at = excluded.updated_at",
        params![&id, name, data, &now],
    )?;
    conn.query_row(
        "SELECT id, name, data, created_at, updated_at FROM profiles WHERE id = ?1",
        [&id],
        |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                data: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
}

pub fn delete_profile(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let changed = conn.execute("DELETE FROM profiles WHERE id = ?1", [id])?;
    if changed == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn get_all_documents(db_path: &Path) -> Result<Vec<Document>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, content, template_id, resume_data, created_at, updated_at FROM documents ORDER BY updated_at DESC"
    )?;
    
    let documents = stmt.query_map([], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            template_id: row.get(3)?,
            resume_data: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?
    .collect::<Result<Vec<_>>>()?;
    
    Ok(documents)
}

pub fn get_document(db_path: &Path, id: &str) -> Result<Document> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, content, template_id, resume_data, created_at, updated_at FROM documents WHERE id = ?1"
    )?;
    
    let document = stmt.query_row([id], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            template_id: row.get(3)?,
            resume_data: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    
    Ok(document)
}

pub fn create_document(db_path: &Path, title: String) -> Result<Document> {
    create_document_with_template(db_path, title, Some("template-modern".to_string()), None, None)
}

pub fn create_document_with_template(
    db_path: &Path,
    title: String,
    template_id: Option<String>,
    resume_data: Option<String>,
    initial_content: Option<String>,
) -> Result<Document> {
    let conn = Connection::open(db_path)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    
    let content = match initial_content {
        Some(c) if !c.is_empty() => c,
        _ => {
            let escaped_title = escape_latex(&title);
            r#"\documentclass{article}
\usepackage[utf8]{inputenc}

\title{%TITLE%}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing your document here...

\end{document}"#.replace("%TITLE%", &escaped_title)
        }
    };
    
    conn.execute(
        "INSERT INTO documents (id, title, content, template_id, resume_data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![&id, &title, &content, &template_id, &resume_data, &now, &now],
    )?;
    
    Ok(Document {
        id,
        title,
        content,
        template_id,
        resume_data,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn update_document(db_path: &Path, id: &str, content: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    
    let affected = conn.execute(
        "UPDATE documents SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, &now, id],
    )?;
    
    if affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    
    Ok(())
}

pub fn update_document_full(
    db_path: &Path,
    id: &str,
    content: &str,
    template_id: Option<&str>,
    resume_data: Option<&str>,
) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let now = chrono::Utc::now().to_rfc3339();
    
    let affected = conn.execute(
        "UPDATE documents SET content = ?1, template_id = ?2, resume_data = ?3, updated_at = ?4 WHERE id = ?5",
        params![content, template_id, resume_data, &now, id],
    )?;
    
    if affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    
    Ok(())
}

pub fn delete_document(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let affected = conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

pub fn get_all_templates(db_path: &Path) -> Result<Vec<Template>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, content, is_builtin, created_at FROM templates ORDER BY is_builtin DESC, created_at ASC"
    )?;
    
    let templates = stmt.query_map([], |row| {
        let is_builtin_int: i32 = row.get(4)?;
        Ok(Template {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            content: row.get(3)?,
            is_builtin: is_builtin_int != 0,
            created_at: row.get(5)?,
        })
    })?
    .collect::<Result<Vec<_>>>()?;
    
    Ok(templates)
}

pub fn get_template(db_path: &Path, id: &str) -> Result<Template> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, content, is_builtin, created_at FROM templates WHERE id = ?1"
    )?;
    
    let template = stmt.query_row([id], |row| {
        let is_builtin_int: i32 = row.get(4)?;
        Ok(Template {
            id: row.get(0)?,
            name: row.get(1)?,
            description: row.get(2)?,
            content: row.get(3)?,
            is_builtin: is_builtin_int != 0,
            created_at: row.get(5)?,
        })
    })?;
    
    Ok(template)
}

pub fn create_template(db_path: &Path, name: String, description: String, content: String) -> Result<Template> {
    let conn = Connection::open(db_path)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    
    conn.execute(
        "INSERT INTO templates (id, name, description, content, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![&id, &name, &description, &content, &now],
    )?;
    
    Ok(Template {
        id,
        name,
        description,
        content,
        is_builtin: false,
        created_at: now,
    })
}

pub fn delete_template(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    
    let is_builtin: Option<i32> = conn
        .query_row("SELECT is_builtin FROM templates WHERE id = ?1", [id], |row| row.get(0))
        .ok();
    
    match is_builtin {
        Some(1) => Err(rusqlite::Error::StatementChangedRows(0)),
        Some(0) => {
            conn.execute("DELETE FROM templates WHERE id = ?1", [id])?;
            Ok(())
        }
        _ => Err(rusqlite::Error::QueryReturnedNoRows),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path() -> std::path::PathBuf {
        let unique = uuid::Uuid::new_v4().to_string();
        std::env::temp_dir().join(format!("vitae_test_{}.db", unique))
    }

    #[test]
    fn test_person_is_a_single_shared_row() {
        let db = temp_db_path();
        init_database(&db).unwrap();
        assert_eq!(get_person(&db).unwrap(), None);
        save_person(&db, r#"{"name":"Jane Doe"}"#).unwrap();
        save_person(&db, r#"{"name":"Jane Q. Doe"}"#).unwrap();
        assert_eq!(get_person(&db).unwrap().unwrap(), r#"{"name":"Jane Q. Doe"}"#);
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn test_payloads_are_validated() {
        let db = temp_db_path();
        init_database(&db).unwrap();
        assert!(save_person(&db, "not json").is_err());
        assert!(save_person(&db, "[1,2]").is_err());
        assert!(save_person(&db, &format!(r#"{{"x":"{}"}}"#, "a".repeat(MAX_PAYLOAD_BYTES))).is_err());
        assert!(save_library_item(&db, None, "experience", "nope").is_err());
        assert!(save_library_item(&db, None, "hobby", "{}").is_err());
        assert!(save_profile(&db, None, "   ", "{}").is_err());
        assert!(save_profile(&db, None, &"n".repeat(101), "{}").is_err());
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn test_library_item_lifecycle() {
        let db = temp_db_path();
        init_database(&db).unwrap();
        let created = save_library_item(&db, None, "experience", r#"{"role":"Engineer"}"#).unwrap();
        assert_eq!(created.kind, "experience");
        let project = save_library_item(&db, None, "project", r#"{"name":"Vitae"}"#).unwrap();

        let updated = save_library_item(&db, Some(created.id.clone()), "experience", r#"{"role":"Senior Engineer"}"#).unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert!(updated.data.contains("Senior"));

        // An id can't be reused to change what kind of entry it is.
        let hijack = save_library_item(&db, Some(project.id.clone()), "experience", r#"{"role":"x"}"#).unwrap();
        assert_eq!(hijack.kind, "project");
        assert!(hijack.data.contains("Vitae"));

        let all = list_library_items(&db).unwrap();
        assert_eq!(all.len(), 2);
        delete_library_item(&db, &created.id).unwrap();
        assert_eq!(list_library_items(&db).unwrap().len(), 1);
        assert!(delete_library_item(&db, &created.id).is_err());
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn test_profile_lifecycle() {
        let db = temp_db_path();
        init_database(&db).unwrap();
        let b = save_profile(&db, None, "Backend", r#"{"headline":"Backend Engineer"}"#).unwrap();
        save_profile(&db, None, "Analyst", "{}").unwrap();
        let names: Vec<_> = list_profiles(&db).unwrap().into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["Analyst", "Backend"]);
        let renamed = save_profile(&db, Some(b.id.clone()), "  Platform ", r#"{"headline":"x"}"#).unwrap();
        assert_eq!(renamed.name, "Platform");
        assert_eq!(renamed.id, b.id);
        delete_profile(&db, &b.id).unwrap();
        assert_eq!(list_profiles(&db).unwrap().len(), 1);
        assert!(delete_profile(&db, &b.id).is_err());
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn test_init_and_create_document() {
        let db_path = temp_db_path();
        assert!(init_database(&db_path).is_ok());

        let doc = create_document(&db_path, "Test Document".to_string()).expect("Failed to create doc");
        assert_eq!(doc.title, "Test Document");
        assert_eq!(doc.template_id, Some("template-modern".to_string()));
        assert!(doc.content.contains("\\title{Test Document}"));

        let retrieved = get_document(&db_path, &doc.id).expect("Failed to get doc");
        assert_eq!(retrieved.id, doc.id);
        assert_eq!(retrieved.title, "Test Document");
        assert_eq!(retrieved.template_id, Some("template-modern".to_string()));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_update_and_delete_document() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let doc = create_document(&db_path, "Doc to Update".to_string()).unwrap();
        update_document(&db_path, &doc.id, "Updated LaTeX content").unwrap();

        let updated = get_document(&db_path, &doc.id).unwrap();
        assert_eq!(updated.content, "Updated LaTeX content");

        delete_document(&db_path, &doc.id).unwrap();
        assert!(get_document(&db_path, &doc.id).is_err());

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_update_document_full() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let doc = create_document(&db_path, "Full Update Doc".to_string()).unwrap();
        let sample_json = r#"{"personal":{"name":"John"}}"#;
        update_document_full(
            &db_path,
            &doc.id,
            "Rendered LaTeX",
            Some("template-classic"),
            Some(sample_json),
        ).unwrap();

        let updated = get_document(&db_path, &doc.id).unwrap();
        assert_eq!(updated.content, "Rendered LaTeX");
        assert_eq!(updated.template_id, Some("template-classic".to_string()));
        assert_eq!(updated.resume_data, Some(sample_json.to_string()));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_get_all_documents() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let doc1 = create_document(&db_path, "Doc 1".to_string()).unwrap();
        let doc2 = create_document(&db_path, "Doc 2".to_string()).unwrap();

        let all = get_all_documents(&db_path).unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|d| d.id == doc1.id));
        assert!(all.iter().any(|d| d.id == doc2.id));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_escape_latex() {
        assert_eq!(escape_latex("Simple Title"), "Simple Title");
        assert_eq!(escape_latex("100% Complete"), r"100\% Complete");
        assert_eq!(escape_latex("$money$ & #hashtag"), r"\$money\$ \& \#hashtag");
        assert_eq!(escape_latex("test_under_score"), r"test\_under\_score");
        assert_eq!(escape_latex(r"back\slash"), r"back\textbackslash{}slash");
        assert_eq!(escape_latex("{braces}"), r"\{braces\}");
        assert_eq!(escape_latex("~tilde^caret"), r"\textasciitilde{}tilde\textasciicircum{}caret");
        assert_eq!(escape_latex("<1ms | >5x"), r"\textless{}1ms \textbar{} \textgreater{}5x");
    }

    #[test]
    fn test_create_document_escapes_title_in_latex() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let doc = create_document(&db_path, "100% Done & $50".to_string()).unwrap();
        assert_eq!(doc.title, "100% Done & $50");
        assert!(doc.content.contains(r"\title{100\% Done \& \$50}"));

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_templates_lifecycle() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        // Check built-in templates seeded
        let templates = get_all_templates(&db_path).unwrap();
        assert!(templates.len() >= 3);
        assert!(templates.iter().any(|t| t.id == "template-modern" && t.is_builtin));
        assert!(templates.iter().any(|t| t.id == "template-classic" && t.is_builtin));
        assert!(templates.iter().any(|t| t.id == "template-minimal" && t.is_builtin));

        // Get single template
        let modern = get_template(&db_path, "template-modern").unwrap();
        assert_eq!(modern.name, "Modern Professional");

        // Re-initializing refreshes built-in content instead of keeping a stale copy
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("UPDATE templates SET content = 'stale' WHERE id = 'template-modern'", []).unwrap();
        drop(conn);
        init_database(&db_path).unwrap();
        assert_eq!(get_template(&db_path, "template-modern").unwrap().content, TEMPLATE_MODERN);
        assert_eq!(get_all_templates(&db_path).unwrap().iter().filter(|t| t.is_builtin).count(), 3);

        // Try deleting builtin template -> should fail
        assert!(delete_template(&db_path, "template-modern").is_err());

        // Create custom template
        let custom = create_template(
            &db_path,
            "Custom Fancy".to_string(),
            "My custom template".to_string(),
            "\\documentclass{article}\\begin{document}{{name}}\\end{document}".to_string(),
        ).unwrap();
        assert_eq!(custom.name, "Custom Fancy");
        assert!(!custom.is_builtin);

        // Delete custom template -> should succeed
        assert!(delete_template(&db_path, &custom.id).is_ok());
        assert!(get_template(&db_path, &custom.id).is_err());

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_update_nonexistent_document_errors() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let fake_id = uuid::Uuid::new_v4().to_string();
        let res = update_document(&db_path, &fake_id, "Some content");
        assert!(res.is_err());

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn test_delete_nonexistent_document_errors() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let fake_id = uuid::Uuid::new_v4().to_string();
        let res = delete_document(&db_path, &fake_id);
        assert!(res.is_err());

        let _ = std::fs::remove_file(db_path);
    }
}
