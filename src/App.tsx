import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import Editor from "./components/Editor";
import Sidebar from "./components/Sidebar";
import PDFViewer from "./components/PDFViewer";
import SetupGuide from "./components/SetupGuide";
import UpdateChecker from "./components/UpdateChecker";
import SettingsModal from "./components/SettingsModal";
import ResumeForm from "./components/ResumeForm";
import TemplateManager from "./components/TemplateManager";
import {
  Document,
  LatexError,
  CompilationResult,
  Template,
  ResumeData,
} from "./types";
import { BUILTIN_TEMPLATES } from "./utils/templatePresets";
import {
  getDefaultResumeData,
  renderTemplate,
  extractFieldsFromTemplate,
} from "./utils/templateEngine";
import "./App.css";

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [templates, setTemplates] = useState<Template[]>(BUILTIN_TEMPLATES);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editorMode, setEditorMode] = useState<"form" | "code">("form");
  const [viewMode, setViewMode] = useState<"split" | "editor" | "preview">("split");

  // Structured resume data for the active document
  const [resumeData, setResumeData] = useState<ResumeData>(() =>
    getDefaultResumeData("Alex Morgan")
  );

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
  const [showSettings, setShowSettings] = useState(false);
  const [updateChannel, setUpdateChannel] = useState<string>(() => {
    return localStorage.getItem("vitae_channel") || "beta";
  });

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<{
    id: string;
    content: string;
    template_id?: string | null;
    resume_data?: string | null;
  } | null>(null);

  const currentDocRef = useRef<Document | null>(currentDocument);
  currentDocRef.current = currentDocument;

  const autoCompileRef = useRef(autoCompile);
  autoCompileRef.current = autoCompile;

  const latexInstalledRef = useRef(latexInstalled);
  latexInstalledRef.current = latexInstalled;

  // Active template calculation
  const activeTemplate = useMemo<Template>(() => {
    if (currentDocument?.template_id) {
      const found = templates.find((t) => t.id === currentDocument.template_id);
      if (found) return found;
    }
    return templates[0] || BUILTIN_TEMPLATES[0];
  }, [currentDocument?.template_id, templates]);

  // Extracted custom fields from active template
  const extractedAnalysis = useMemo(() => {
    return extractFieldsFromTemplate(activeTemplate.content);
  }, [activeTemplate.content]);

  const flushSave = async (): Promise<{
    id: string;
    content: string;
    template_id?: string | null;
    resume_data?: string | null;
  } | null> => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (pendingSaveRef.current) {
      const { id, content, template_id, resume_data } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      try {
        await invoke("update_document_full", {
          id,
          content,
          templateId: template_id || null,
          resumeData: resume_data || null,
        });

        const now = new Date().toISOString();
        if (currentDocRef.current && currentDocRef.current.id === id) {
          currentDocRef.current = {
            ...currentDocRef.current,
            content,
            template_id,
            resume_data,
            updated_at: now,
          };
        }
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, content, template_id, resume_data, updated_at: now }
              : d
          )
        );
        setCurrentDocument((curr) =>
          curr && curr.id === id
            ? { ...curr, content, template_id, resume_data, updated_at: now }
            : curr
        );
        return { id, content, template_id, resume_data };
      } catch (err) {
        // Fallback to update_document for backward compatibility
        try {
          await invoke("update_document", { id, content });
          return { id, content, template_id, resume_data };
        } catch (innerErr) {
          setError(`Failed to save document: ${innerErr}`);
        }
      }
    }
    return null;
  };

  useEffect(() => {
    checkLatexInstallation();
    loadTemplates();
    loadDocuments();

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (pendingSaveRef.current) {
        const { id, content, template_id, resume_data } = pendingSaveRef.current;
        invoke("update_document_full", {
          id,
          content,
          templateId: template_id || null,
          resumeData: resume_data || null,
        }).catch(console.error);
      }
    };
  }, []);

  const loadTemplates = async () => {
    try {
      const backendTemplates = await invoke<Template[]>("get_all_templates");
      if (backendTemplates && backendTemplates.length > 0) {
        setTemplates(backendTemplates);
      }
    } catch (err) {
      console.warn("Could not fetch templates from backend, using built-ins:", err);
    }
  };

  const syncDocumentResumeData = useCallback(
    (doc: Document | null) => {
      if (!doc) return;

      if (doc.resume_data) {
        try {
          const parsed = JSON.parse(doc.resume_data);
          setResumeData(parsed);
          return;
        } catch (e) {
          console.error("Failed to parse resume_data JSON:", e);
        }
      }

      // Initialize default data with document title
      const initialData = getDefaultResumeData(doc.title || "Alex Morgan");
      setResumeData(initialData);

      // If document content is empty or generic, render template
      if (!doc.content || doc.content.includes("Start writing your document here")) {
        const tpl =
          templates.find((t) => t.id === doc.template_id) ||
          templates[0] ||
          BUILTIN_TEMPLATES[0];
        const rendered = renderTemplate(tpl.content, initialData);
        updateDocumentStateAndQueueSave(
          doc.id,
          rendered,
          tpl.id,
          JSON.stringify(initialData)
        );
      }
    },
    [templates]
  );

  const updateDocumentStateAndQueueSave = (
    docId: string,
    content: string,
    templateId: string | null | undefined,
    resumeDataString: string | null | undefined
  ) => {
    setCurrentDocument((prev) =>
      prev && prev.id === docId
        ? {
            ...prev,
            content,
            template_id: templateId,
            resume_data: resumeDataString,
          }
        : null
    );

    pendingSaveRef.current = {
      id: docId,
      content,
      template_id: templateId,
      resume_data: resumeDataString,
    };

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      flushSave();
    }, 500);
  };

  const handleResumeDataChange = (newData: ResumeData) => {
    if (!currentDocument) return;
    setResumeData(newData);

    // Re-render LaTeX with the active template
    const rendered = renderTemplate(activeTemplate.content, newData);
    updateDocumentStateAndQueueSave(
      currentDocument.id,
      rendered,
      activeTemplate.id,
      JSON.stringify(newData)
    );
  };

  const handleSelectTemplate = (template: Template) => {
    if (!currentDocument) return;

    const rendered = renderTemplate(template.content, resumeData);
    updateDocumentStateAndQueueSave(
      currentDocument.id,
      rendered,
      template.id,
      JSON.stringify(resumeData)
    );

    // Auto trigger compile on template change if autoCompile or compiling
    setTimeout(() => {
      compileLatex();
    }, 300);
  };

  const handleImportDataIntoResume = (extracted: Partial<ResumeData>) => {
    if (!extracted.personal) return;
    const merged: ResumeData = {
      ...resumeData,
      personal: {
        ...resumeData.personal,
        ...extracted.personal,
      },
    };
    handleResumeDataChange(merged);
  };

  const compileLatex = useCallback(async () => {
    const doc = currentDocRef.current;
    if (!doc) return;

    let contentToCompile = doc.content;
    if (pendingSaveRef.current && pendingSaveRef.current.id === doc.id) {
      contentToCompile = pendingSaveRef.current.content;
    }

    const saved = await flushSave();
    if (saved && saved.id === doc.id) {
      contentToCompile = saved.content;
    }

    if (!latexInstalledRef.current) {
      setShowSetup(true);
      return;
    }

    const charCount = contentToCompile.length;
    if (charCount > 10000 && !autoCompileRef.current) {
      const proceed = confirm(
        `This document has ${charCount.toLocaleString()} characters. Compilation may take some time. Continue?`
      );
      if (!proceed) return;
    }

    setIsCompiling(true);
    setError(null);
    setCompilationLog("Starting compilation...\n");
    setPdfPath(null);

    try {
      const result = await invoke<CompilationResult>("compile_latex", {
        id: doc.id,
        content: contentToCompile,
      });

      setLatexErrors(result.errors);

      const errors = result.errors.filter((e) => e.severity === "error");
      const warnings = result.errors.filter((e) => e.severity === "warning");

      let log = "Compilation completed\n\n";

      if (errors.length > 0) {
        log += `=== ERRORS (${errors.length}) ===\n`;
        errors.forEach((e) => {
          log += e.line ? `Line ${e.line}: ${e.message}\n` : `${e.message}\n`;
        });
        log += "\n";
      }

      if (warnings.length > 0) {
        log += `=== WARNINGS (${warnings.length}) ===\n`;
        warnings.forEach((w) => {
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
        setPdfPath(result.pdf_path);
        if (warnings.length > 0) {
          setError(`Compiled with ${warnings.length} warning(s). Click "View Log" for details.`);
        }
      } else {
        const errorMsgs = errors
          .map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message))
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
  }, []);

  // Auto-compile with debounce
  useEffect(() => {
    if (!autoCompile || !currentDocument) return;

    const timer = setTimeout(() => {
      compileLatex();
    }, 2000);

    return () => clearTimeout(timer);
  }, [currentDocument?.id, currentDocument?.content, autoCompile, compileLatex]);

  const checkLatexInstallation = async () => {
    try {
      const installed = await invoke<boolean>("check_latex_installed");
      setLatexInstalled(installed);

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
        syncDocumentResumeData(docs[0]);
      }
    } catch (err) {
      setError(`Failed to load documents: ${err}`);
    }
  };

  const createNewDocument = async () => {
    const title = prompt("Enter resume or document title:");
    if (!title) return;

    await flushSave();

    try {
      const defaultTemplate = templates[0] || BUILTIN_TEMPLATES[0];
      const initialResumeData = getDefaultResumeData(title);
      const initialContent = renderTemplate(defaultTemplate.content, initialResumeData);

      const newDoc = await invoke<Document>("create_document", { title });
      if (newDoc) {
        newDoc.template_id = defaultTemplate.id;
        newDoc.resume_data = JSON.stringify(initialResumeData);
        newDoc.content = initialContent;

        setDocuments((prev) => [newDoc, ...prev]);
        setCurrentDocument(newDoc);
        setResumeData(initialResumeData);
        setPdfPath(null);

        // Queue save with rendered template content and resume data
        updateDocumentStateAndQueueSave(
          newDoc.id,
          initialContent,
          defaultTemplate.id,
          JSON.stringify(initialResumeData)
        );
      }
    } catch (err) {
      setError(`Failed to create document: ${err}`);
    }
  };

  const selectDocument = async (id: string) => {
    if (currentDocument?.id === id) return;

    await flushSave();

    try {
      const doc = await invoke<Document>("get_document", { id });
      setCurrentDocument(doc);
      syncDocumentResumeData(doc);
      setPdfPath(null);
    } catch (err) {
      setError(`Failed to load document: ${err}`);
    }
  };

  const updateContentDirect = (content: string) => {
    if (!currentDocument) return;

    setCurrentDocument((prev) => (prev ? { ...prev, content } : null));

    pendingSaveRef.current = {
      id: currentDocument.id,
      content,
      template_id: currentDocument.template_id,
      resume_data: currentDocument.resume_data,
    };

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      flushSave();
    }, 500);
  };

  const deleteDocument = async (id: string) => {
    if (!confirm("Are you sure you want to delete this document?")) return;

    if (pendingSaveRef.current?.id === id) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      pendingSaveRef.current = null;
    }

    try {
      await invoke("delete_document", { id });
      setDocuments((prev) => {
        const remaining = prev.filter((d) => d.id !== id);
        if (currentDocRef.current?.id === id) {
          const nextDoc = remaining[0] || null;
          setCurrentDocument(nextDoc);
          syncDocumentResumeData(nextDoc);
          setPdfPath(null);
        }
        return remaining;
      });
    } catch (err) {
      setError(`Failed to delete document: ${err}`);
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
      <UpdateChecker channel={updateChannel} />
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          currentChannel={updateChannel}
          onChannelChange={(newChannel) => setUpdateChannel(newChannel)}
        />
      )}
      {showTemplateModal && (
        <TemplateManager
          templates={templates}
          currentTemplateId={activeTemplate.id}
          onSelectTemplate={handleSelectTemplate}
          onTemplatesUpdated={loadTemplates}
          onClose={() => setShowTemplateModal(false)}
          onImportDataIntoResume={handleImportDataIntoResume}
        />
      )}
      {showSetup && (
        <SetupGuide
          onClose={() => {
            setShowSetup(false);
            localStorage.setItem("vitae_setup_complete", "true");
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
          <h1>{currentDocument?.title || "Vitae Resume Builder"}</h1>
          <div className="toolbar-actions">
            <div className="layout-toggle-group" role="group" aria-label="Layout view mode">
              <button
                type="button"
                className={`btn-layout-toggle ${viewMode === "split" ? "active" : ""}`}
                onClick={() => setViewMode("split")}
                title="Split View: Form & Preview side-by-side"
                data-testid="btn-toggle-split"
              >
                ◫ Split
              </button>
              <button
                type="button"
                className={`btn-layout-toggle ${viewMode === "editor" ? "active" : ""}`}
                onClick={() => setViewMode("editor")}
                title="Form Only: Full width for comfortable editing without squishing"
                data-testid="btn-toggle-editor"
              >
                📄 Form Only
              </button>
              <button
                type="button"
                className={`btn-layout-toggle ${viewMode === "preview" ? "active" : ""}`}
                onClick={() => setViewMode("preview")}
                title="Preview Only: Full width PDF preview"
                data-testid="btn-toggle-preview"
              >
                👁️ Preview Only
              </button>
            </div>
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
              onClick={() => setShowTemplateModal(true)}
              className="btn-secondary"
              title="Browse, change, or import templates"
              data-testid="btn-open-templates"
            >
              🎨 Templates ({templates.length})
            </button>
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
            <button
              onClick={() => setShowSettings(true)}
              className="btn-settings"
              title="Settings & Update Channel"
            >
              ⚙️ Settings
            </button>
          </div>
        </div>

        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className={`editor-container view-${viewMode}`}>
          <div
            className={`editor-pane ${viewMode === "editor" ? "full-width" : ""}`}
            style={{ display: viewMode === "preview" ? "none" : "flex" }}
          >
            <div className="editor-tabs-bar">
              <div className="editor-tabs-left">
                <button
                  className={`editor-tab ${editorMode === "form" ? "active" : ""}`}
                  onClick={() => setEditorMode("form")}
                  data-testid="tab-form-view"
                  title="Fill structured resume fields with live PDF preview"
                >
                  <span className="tab-icon">📝</span>
                  <span className="tab-title">Visual Form</span>
                  <span className="tab-badge">Default</span>
                </button>
                <button
                  className={`editor-tab ${editorMode === "code" ? "active" : ""}`}
                  onClick={() => setEditorMode("code")}
                  data-testid="tab-code-view"
                  title="Direct LaTeX source editor"
                >
                  <span className="tab-icon">💻</span>
                  <span className="tab-title">LaTeX Source</span>
                </button>
              </div>

              <div className="view-mode-controls" role="group" aria-label="Layout view mode">
                <button
                  type="button"
                  className={`btn-view-mode ${viewMode === "split" ? "active" : ""}`}
                  onClick={() => setViewMode("split")}
                  title="Split View: Form & Preview"
                  data-testid="btn-view-split"
                >
                  ◫ Split
                </button>
                <button
                  type="button"
                  className={`btn-view-mode ${viewMode === "editor" ? "active" : ""}`}
                  onClick={() => setViewMode("editor")}
                  title="Expand Form to full width"
                  data-testid="btn-view-editor"
                >
                  📄 Full Form
                </button>
                <button
                  type="button"
                  className={`btn-view-mode ${viewMode === "preview" ? "active" : ""}`}
                  onClick={() => setViewMode("preview")}
                  title="Expand PDF Preview to full width"
                  data-testid="btn-view-preview"
                >
                  👁️ Full PDF
                </button>
              </div>
            </div>

            {editorMode === "form" ? (
              <ResumeForm
                data={resumeData}
                onChange={handleResumeDataChange}
                customFields={extractedAnalysis.customVariables}
                templateName={activeTemplate.name}
                onChangeTemplateClick={() => setShowTemplateModal(true)}
              />
            ) : (
              <Editor
                content={currentDocument?.content || ""}
                onChange={updateContentDirect}
                errors={latexErrors}
              />
            )}
          </div>
          <div
            className={`preview-pane ${viewMode === "preview" ? "full-width" : ""}`}
            style={{ display: viewMode === "editor" ? "none" : "flex" }}
          >
            {viewMode === "preview" && (
              <div className="preview-top-bar">
                <button
                  type="button"
                  className="btn-return-view"
                  onClick={() => setViewMode("split")}
                  title="Return to side-by-side split view"
                >
                  ◫ Return to Split View
                </button>
                <button
                  type="button"
                  className="btn-return-view"
                  onClick={() => setViewMode("editor")}
                  title="Return to Form Editor"
                >
                  📝 Return to Form
                </button>
              </div>
            )}
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
