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
            _ => escaped.push(c),
        }
    }
    escaped
}

const TEMPLATE_MODERN: &str = r#"\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{hyperref}
\usepackage{enumitem}

\hypersetup{colorlinks=true,linkcolor=blue,urlcolor=blue}
\urlstyle{same}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-0.5in}
\addtolength{\textheight}{1.0in}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\begin{document}

\begin{center}
    {\Huge \scshape {{name}}} \\ \vspace{2pt}
    {{#title}}{\large \textit{{{title}}}} \\ \vspace{2pt}{{/title}}
    \small {{phone}} {{#email}}$|$ \href{mailto:{{email}}}{{{email}}}{{/email}} {{#website}}$|$ \href{{{website}}}{{{website}}}{{/website}} {{#linkedin}}$|$ \href{https://{{linkedin}}}{{{linkedin}}}{{/linkedin}} {{#github}}$|$ \href{https://{{github}}}{{{github}}}{{/github}} {{#location}}$|$ {{location}}{{/location}}
\end{center}

{{#summary}}
\section{Summary}
{{summary}}
{{/summary}}

{{#experience}}
\section{Experience}
{{#items}}
\textbf{{{role}}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
\textit{{{company}}}{{#location}} \hfill {{location}}{{/location}}
{{#highlights}}
\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{4pt}
{{/items}}
{{/experience}}

{{#education}}
\section{Education}
{{#items}}
\textbf{{{institution}}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
\textit{{{degree}}}{{#location}} \hfill {{location}}{{/location}}
{{#details}}\\\small {{details}}{{/details}}
\vspace{4pt}
{{/items}}
{{/education}}

{{#projects}}
\section{Projects}
{{#items}}
\textbf{{{name}}}{{#technologies}} $|$ \textit{{{technologies}}}{{/technologies}}{{#link}} \hfill \href{{{link}}}{Link}{{/link}}
{{#highlights}}
\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{4pt}
{{/items}}
{{/projects}}

{{#skills}}
\section{Technical Skills}
{{#items}}
\textbf{{{category}}}: {{skills}} \\
{{/items}}
{{/skills}}

{{#customSections}}
\section{{{title}}}
{{#content}}{{content}} \\{{/content}}
{{#highlights}}
\begin{itemize}[noitemsep,topsep=1pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
{{/customSections}}

\end{document}"#;

const TEMPLATE_CLASSIC: &str = r#"\documentclass[10pt,letterpaper]{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=0.75in]{geometry}
\usepackage{titlesec}
\usepackage{hyperref}
\usepackage{enumitem}

\hypersetup{colorlinks=false,pdfborder={0 0 0}}

\titleformat{\section}{\large\bfseries\scshape}{}{0em}{}[\titlerule]
\titlespacing{\section}{0pt}{10pt}{5pt}

\begin{document}
\pagestyle{empty}

\begin{center}
    {\huge \textbf{{{name}}}} \\ \vspace{4pt}
    {{#title}}{\large \textit{{{title}}}} \\ \vspace{2pt}{{/title}}
    \small {{#location}}{{location}} \ $\cdot$ \ {{/location}}{{phone}}{{#email}} \ $\cdot$ \ {{email}}{{/email}}{{#website}} \ $\cdot$ \ {{website}}{{/website}}{{#linkedin}} \ $\cdot$ \ {{linkedin}}{{/linkedin}}
\end{center}

{{#summary}}
\section{Professional Summary}
{{summary}}
{{/summary}}

{{#education}}
\section{Education}
{{#items}}
\textbf{{{institution}}}{{#location}}, {{location}}{{/location}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
\textit{{{degree}}}
{{#details}}\\\small {{details}}{{/details}}
\vspace{4pt}
{{/items}}
{{/education}}

{{#experience}}
\section{Professional Experience}
{{#items}}
\textbf{{{role}}}, {{company}}{{#location}} --- {{location}}{{/location}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
{{#highlights}}
\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{4pt}
{{/items}}
{{/experience}}

{{#projects}}
\section{Key Projects}
{{#items}}
\textbf{{{name}}}{{#technologies}} (\textit{{{technologies}}}){{/technologies}}{{#link}} \hfill {{link}}{{/link}}
{{#highlights}}
\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{4pt}
{{/items}}
{{/projects}}

{{#skills}}
\section{Skills \& Competencies}
{{#items}}
\textbf{{{category}}}: {{skills}} \\
{{/items}}
{{/skills}}

{{#customSections}}
\section{{{title}}}
{{#content}}{{content}} \\{{/content}}
{{#highlights}}
\begin{itemize}[leftmargin=1.5em,noitemsep,topsep=2pt]
{{#bullets}}
    \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
{{/customSections}}

\end{document}"#;

const TEMPLATE_MINIMAL: &str = r#"\documentclass[10pt,letterpaper]{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=0.6in]{geometry}
\usepackage{hyperref}
\usepackage{enumitem}

\hypersetup{colorlinks=true,linkcolor=black,urlcolor=blue}
\urlstyle{same}

\setlength{\parindent}{0pt}
\setlength{\parskip}{4pt}

\newcommand{\resumesection}[1]{%
  \vspace{6pt}%
  {\large\textbf{\uppercase{#1}}}%
  \vspace{2pt}\hrule\vspace{4pt}%
}

\begin{document}
\pagestyle{empty}

{\LARGE \textbf{{{name}}}} \\
{{#title}}{\textbf{{{title}}}} \\{{/title}}
\small {{#email}}{{email}} \ $\vert$ \ {{/email}}{{phone}}{{#location}} \ $\vert$ \ {{location}}{{/location}}{{#github}} \ $\vert$ \ \href{https://{{github}}}{{{github}}}{{/github}}{{#linkedin}} \ $\vert$ \ \href{https://{{linkedin}}}{{{linkedin}}}{{/linkedin}}{{#website}} \ $\vert$ \ \href{{{website}}}{{{website}}}{{/website}}

{{#summary}}
\resumesection{About}
{{summary}}
{{/summary}}

{{#experience}}
\resumesection{Experience}
{{#items}}
\textbf{{{role}}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
\textit{{{company}}}{{#location}} \hfill {{location}}{{/location}}
{{#highlights}}
\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{2pt}
{{/items}}
{{/experience}}

{{#education}}
\resumesection{Education}
{{#items}}
\textbf{{{degree}}} \hfill {{startDate}}{{#endDate}} -- {{endDate}}{{/endDate}} \\
\textit{{{institution}}}{{#location}} \hfill {{location}}{{/location}}
{{#details}}\\\small {{details}}{{/details}}
\vspace{2pt}
{{/items}}
{{/education}}

{{#projects}}
\resumesection{Projects}
{{#items}}
\textbf{{{name}}}{{#technologies}} --- \textit{{{technologies}}}{{/technologies}}{{#link}} \hfill \href{{{link}}}{{{link}}}{{/link}}
{{#highlights}}
\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
\vspace{2pt}
{{/items}}
{{/projects}}

{{#skills}}
\resumesection{Skills}
{{#items}}
\textbf{{{category}}}: {{skills}} \\
{{/items}}
{{/skills}}

{{#customSections}}
\resumesection{{{title}}}
{{#content}}{{content}} \\{{/content}}
{{#highlights}}
\begin{itemize}[leftmargin=1.2em,noitemsep,topsep=1pt]
{{#bullets}}
  \item {{bullet}}
{{/bullets}}
\end{itemize}
{{/highlights}}
{{/customSections}}

\end{document}"#;

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

    for (id, name, desc, content) in presets {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM templates WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;

        if exists == 0 {
            conn.execute(
                "INSERT INTO templates (id, name, description, content, is_builtin, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![id, name, desc, content, &now],
            )?;
        }
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
