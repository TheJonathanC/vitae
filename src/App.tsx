import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import Editor from "./components/Editor";
import Sidebar from "./components/Sidebar";
import PDFViewer from "./components/PDFViewer";
import SetupGuide from "./components/SetupGuide";
import UpdateChecker from "./components/UpdateChecker";
import "./App.css";

interface Document {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface LatexError {
  line: number | null;
  message: string;
  severity: "error" | "warning";
}

interface CompilationResult {
  success: boolean;
  pdf_path?: string;
  errors: LatexError[];
}

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [latexInstalled, setLatexInstalled] = useState(true);
  const [latexErrors, setLatexErrors] = useState<LatexError[]>([]);
  const [autoCompile, setAutoCompile] = useState(false);
  const [compilationLog, setCompilationLog] = useState<string>("");
  const [showLog, setShowLog] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    checkLatexInstallation();
    loadDocuments();
  }, []);

  // Auto-compile with debounce
  useEffect(() => {
    if (!autoCompile || !currentDocument) return;

    const timer = setTimeout(() => {
      compileLatex();
    }, 2000);

    return () => clearTimeout(timer);
  }, [currentDocument?.content, autoCompile]);

  const checkLatexInstallation = async () => {
    try {
      const installed = await invoke<boolean>("check_latex_installed");
      setLatexInstalled(installed);
      
      // Show setup guide on first run if LaTeX not installed
      const hasSeenSetup = localStorage.getItem("vitae_setup_complete");
      if (!installed && !hasSeenSetup) {
        setShowSetup(true);
      }
    } catch (err) {
      console.error("Failed to check LaTeX installation:", err);
    }
  };

  const loadDocuments = async () => {
    try {
      const docs = await invoke<Document[]>("get_all_documents");
      setDocuments(docs);
      if (docs.length > 0 && !currentDocument) {
        setCurrentDocument(docs[0]);
      }
    } catch (err) {
      setError(`Failed to load documents: ${err}`);
    }
  };

  const createNewDocument = async () => {
    const title = prompt("Enter document title:");
    if (!title) return;

    try {
      const newDoc = await invoke<Document>("create_document", { title });
      setDocuments([newDoc, ...documents]);
      setCurrentDocument(newDoc);
      setPdfPath(null);
    } catch (err) {
      setError(`Failed to create document: ${err}`);
    }
  };

  const selectDocument = async (id: string) => {
    try {
      const doc = await invoke<Document>("get_document", { id });
      setCurrentDocument(doc);
      setPdfPath(null);
    } catch (err) {
      setError(`Failed to load document: ${err}`);
    }
  };

  const updateContent = async (content: string) => {
    if (!currentDocument) return;

    try {
      await invoke("update_document", {
        id: currentDocument.id,
        content,
      });
      setCurrentDocument({ ...currentDocument, content });
    } catch (err) {
      setError(`Failed to save document: ${err}`);
    }
  };

  const deleteDocument = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    try {
      await invoke("delete_document", { id });
      setDocuments(documents.filter((d) => d.id !== id));
      if (currentDocument?.id === id) {
        setCurrentDocument(documents[0] || null);
        setPdfPath(null);
      }
    } catch (err) {
      setError(`Failed to delete document: ${err}`);
    }
  };

  const compileLatex = async () => {
    if (!currentDocument) return;

    // Check if LaTeX is installed before compiling
    if (!latexInstalled) {
      setShowSetup(true);
      return;
    }

    // Warn for large documents
    const charCount = currentDocument.content.length;
    if (charCount > 10000 && !autoCompile) {
      const proceed = confirm(
        `This document has ${charCount.toLocaleString()} characters. Compilation may take some time. Continue?`
      );
      if (!proceed) return;
    }

    setIsCompiling(true);
    setError(null);
    setCompilationLog("Starting compilation...\n");
    
    // Clear PDF to force reload
    setPdfPath(null);

    try {
      const result = await invoke<CompilationResult>("compile_latex", {
        id: currentDocument.id,
        content: currentDocument.content,
      });
      
      setLatexErrors(result.errors);
      
      // Build compilation log
      const errors = result.errors.filter(e => e.severity === "error");
      const warnings = result.errors.filter(e => e.severity === "warning");
      
      let log = "Compilation completed\n\n";
      
      if (errors.length > 0) {
        log += `=== ERRORS (${errors.length}) ===\n`;
        errors.forEach(e => {
          log += e.line ? `Line ${e.line}: ${e.message}\n` : `${e.message}\n`;
        });
        log += "\n";
      }
      
      if (warnings.length > 0) {
        log += `=== WARNINGS (${warnings.length}) ===\n`;
        warnings.forEach(w => {
          log += w.line ? `Line ${w.line}: ${w.message}\n` : `${w.message}\n`;
        });
        log += "\n";
      }
      
      if (result.success) {
        log += `✓ PDF generated successfully at ${result.pdf_path}`;
      } else {
        log += "✗ Compilation failed";
      }
      
      setCompilationLog(log);
      
      if (result.success && result.pdf_path) {
        // Add timestamp to force reload
        setPdfPath(`${result.pdf_path}?t=${Date.now()}`);
        
        // Show warnings if any
        if (warnings.length > 0) {
          setError(`Compiled with ${warnings.length} warning(s). Click "View Log" for details.`);
        }
      } else {
        const errorMsgs = errors
          .map(e => e.line ? `Line ${e.line}: ${e.message}` : e.message)
          .join("\n");
        setError(`Compilation failed:\n${errorMsgs || "Unknown error"}`);
      }
    } catch (err) {
      const errorMsg = `Compilation error: ${err}`;
      setError(errorMsg);
      setCompilationLog(`ERROR\n${errorMsg}`);
      setLatexErrors([]);
    } finally {
      setIsCompiling(false);
    }
  };

  const exportPDF = async () => {
    if (!currentDocument || !pdfPath) return;

    try {
      const { save } = await import("@tauri-apps/api/dialog");
      const filePath = await save({
        defaultPath: `${currentDocument.title}.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (filePath) {
        await invoke("export_pdf", {
          id: currentDocument.id,
          destination: filePath,
        });
        alert("PDF exported successfully!");
      }
    } catch (err) {
      setError(`Failed to export PDF: ${err}`);
    }
  };

  return (
    <div className="app">
      <UpdateChecker />
      {showSetup && (
        <SetupGuide
          onClose={() => {
            setShowSetup(false);
            localStorage.setItem("vitae_setup_complete", "true");
            // Recheck LaTeX installation
            checkLatexInstallation();
          }}
        />
      )}
      <Sidebar
        documents={documents}
        currentDocument={currentDocument}
        onSelectDocument={selectDocument}
        onCreateDocument={createNewDocument}
        onDeleteDocument={deleteDocument}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <div className="main-content">
        <div className="toolbar">
          <h1>{currentDocument?.title || "Vitae LaTeX Editor"}</h1>
          <div className="toolbar-actions">
            {!latexInstalled && (
              <button
                onClick={() => setShowSetup(true)}
                className="btn-setup"
                title="LaTeX not detected"
              >
                ⚙️ Setup LaTeX
              </button>
            )}
            <button
              onClick={() => setAutoCompile(!autoCompile)}
              className={`btn-auto-compile ${autoCompile ? "active" : ""}`}
              disabled={!currentDocument}
              title="Auto-compile on change (2s delay)"
            >
              {autoCompile ? "🔄 Auto" : "⏸️ Auto"}
            </button>
            <button
              onClick={compileLatex}
              disabled={!currentDocument || isCompiling}
              className="btn-compile"
            >
              {isCompiling ? "Compiling..." : "Compile"}
            </button>
            <button
              onClick={() => setShowLog(!showLog)}
              disabled={!compilationLog}
              className="btn-log"
              title="View compilation log"
            >
              {showLog ? "Hide Log" : "View Log"}
            </button>
            <button
              onClick={exportPDF}
              disabled={!pdfPath}
              className="btn-export"
            >
              Export PDF
            </button>
          </div>
        </div>
        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}
        <div className="editor-container">
          <div className="editor-pane">
            <Editor
              content={currentDocument?.content || ""}
              onChange={updateContent}
              errors={latexErrors}
            />
          </div>
          <div className="preview-pane">
            <PDFViewer pdfPath={pdfPath} />
          </div>
        </div>
        {showLog && compilationLog && (
          <div className="compilation-log">
            <div className="log-header">
              <h3>Compilation Log</h3>
              <button onClick={() => setShowLog(false)}>×</button>
            </div>
            <pre>{compilationLog}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
