import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import Editor from "./components/Editor";
import Sidebar from "./components/Sidebar";
import PDFViewer from "./components/PDFViewer";
import SetupGuide from "./components/SetupGuide";
import "./App.css";

interface Document {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [latexInstalled, setLatexInstalled] = useState(true);

  useEffect(() => {
    checkLatexInstallation();
    loadDocuments();
  }, []);

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

    setIsCompiling(true);
    setError(null);

    try {
      const path = await invoke<string>("compile_latex", {
        id: currentDocument.id,
        content: currentDocument.content,
      });
      setPdfPath(path);
    } catch (err) {
      setError(`Compilation error: ${err}`);
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
              onClick={compileLatex}
              disabled={!currentDocument || isCompiling}
              className="btn-compile"
            >
              {isCompiling ? "Compiling..." : "Compile"}
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
            />
          </div>
          <div className="preview-pane">
            <PDFViewer pdfPath={pdfPath} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
