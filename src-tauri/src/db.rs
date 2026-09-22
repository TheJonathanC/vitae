use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

pub fn init_database(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    
    Ok(())
}

pub fn get_all_documents(db_path: &Path) -> Result<Vec<Document>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT id, title, content, created_at, updated_at FROM documents ORDER BY updated_at DESC")?;
    
    let documents = stmt.query_map([], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?
    .collect::<Result<Vec<_>>>()?;
    
    Ok(documents)
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
            _ => escaped.push(c),
        }
    }
    escaped
}

pub fn create_document(db_path: &Path, title: String) -> Result<Document> {
    let conn = Connection::open(db_path)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    
    let escaped_title = escape_latex(&title);
    let default_content = r#"\documentclass{article}
\usepackage[utf8]{inputenc}

\title{%TITLE%}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing your document here...

\end{document}"#.replace("%TITLE%", &escaped_title);
    
    conn.execute(
        "INSERT INTO documents (id, title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, &title, &default_content, &now, &now],
    )?;
    
    Ok(Document {
        id,
        title,
        content: default_content,
        created_at: now.clone(),
        updated_at: now,
    })
}

pub fn get_document(db_path: &Path, id: &str) -> Result<Document> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT id, title, content, created_at, updated_at FROM documents WHERE id = ?1")?;
    
    let document = stmt.query_row([id], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })?;
    
    Ok(document)
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

pub fn delete_document(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let affected = conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    if affected == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path() -> std::path::PathBuf {
        let unique = uuid::Uuid::new_v4().to_string();
        std::env::temp_dir().join(format!("vitae_test_{}.db", unique))
    }

    #[test]
    fn test_init_and_create_document() {
        let db_path = temp_db_path();
        assert!(init_database(&db_path).is_ok());

        let doc = create_document(&db_path, "Test Document".to_string()).expect("Failed to create doc");
        assert_eq!(doc.title, "Test Document");
        assert!(doc.content.contains("\\title{Test Document}"));

        let retrieved = get_document(&db_path, &doc.id).expect("Failed to get doc");
        assert_eq!(retrieved.id, doc.id);
        assert_eq!(retrieved.title, "Test Document");

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
    }

    #[test]
    fn test_create_document_escapes_title_in_latex() {
        let db_path = temp_db_path();
        init_database(&db_path).unwrap();

        let doc = create_document(&db_path, "100% Done & $50".to_string()).unwrap();
        // Title in DB remains raw
        assert_eq!(doc.title, "100% Done & $50");
        // Content contains escaped LaTeX
        assert!(doc.content.contains(r"\title{100\% Done \& \$50}"));

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

