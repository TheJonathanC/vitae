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

pub fn create_document(db_path: &Path, title: String) -> Result<Document> {
    let conn = Connection::open(db_path)?;
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    
    let default_content = r#"\documentclass{article}
\usepackage[utf8]{inputenc}

\title{%TITLE%}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing your document here...

\end{document}"#.replace("%TITLE%", &title);
    
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
    
    conn.execute(
        "UPDATE documents SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, &now, id],
    )?;
    
    Ok(())
}

pub fn delete_document(db_path: &Path, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}
