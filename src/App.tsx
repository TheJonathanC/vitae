import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import DocumentMenu from "./components/DocumentMenu";
import PDFViewer from "./components/PDFViewer";
import SetupGuide from "./components/SetupGuide";
import UpdateChecker from "./components/UpdateChecker";
import SettingsModal from "./components/SettingsModal";
import ResumeForm from "./components/ResumeForm";
import TemplateManager from "./components/TemplateManager";
import NewDocumentDialog from "./components/NewDocumentDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import BuildDetails from "./components/BuildDetails";
import {
  Document,
  LatexError,
  CompilationResult,
  Template,
  ResumeData,
  ResumePersonalInfo,
} from "./types";
import { BUILTIN_TEMPLATES } from "./utils/templatePresets";
import {
  getEmptyResumeData,
  normalizeResumeData,
  renderTemplate,
  extractFieldsFromTemplate,
} from "./utils/templateEngine";
import { getStoredChannel } from "./utils/updates";
import { isModalOpen } from "./hooks/useDialog";
import {
  IconSplit,
  IconForm,
  IconEye,
  IconPalette,
  IconDownload,
  IconSettings,
  IconChevronDown,
  IconPlus,
} from "./components/Icons";
import "./App.css";

// Monaco is large and only needed for the LaTeX source view.
const Editor = lazy(() => import("./components/Editor"));

interface PendingSave {
  id: string;
  content: string;
  template_id?: string | null;
  resume_data?: string | null;
}

/** The compiled PDF currently shown, tied to the document it belongs to. */
interface PreviewState {
  docId: string;
  revision: number;
  path: string;
}

/** Outcome of the latest build for the open document. */
type BuildResult =
  | { kind: "ok"; warnings: LatexError[] }
  | { kind: "failed"; errors: LatexError[]; warnings: LatexError[] }
  | { kind: "error"; message: string };

const SAVE_DEBOUNCE_MS = 500;
const SAVE_RETRY_MS = 3000;
const AUTO_UPDATE_DELAY_MS = 1000;

/** Content the backend gives documents created without a template. */
const isPlaceholderContent = (content: string) =>
  !content || content.includes("Start writing your document here");

function readSplitRatio(): number {
  const saved = Number.parseFloat(localStorage.getItem("vitae_split_ratio") ?? "");
  return Number.isFinite(saved) ? Math.min(Math.max(saved, 25), 75) : 50;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function App() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [templates, setTemplates] = useState<Template[]>(BUILTIN_TEMPLATES);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showNewDocument, setShowNewDocument] = useState(false);
  const [showDocumentMenu, setShowDocumentMenu] = useState(false);
  const [editorMode, setEditorMode] = useState<"form" | "code">("form");
  const [viewMode, setViewMode] = useState<"split" | "editor" | "preview">("split");

  // Structured resume data for the active document
  const [resumeData, setResumeData] = useState<ResumeData>(getEmptyResumeData);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [latexInstalled, setLatexInstalled] = useState(true);
  const [latexErrors, setLatexErrors] = useState<LatexError[]>([]);
  // Builds run off the UI thread, so keeping the preview current is the default.
  const [autoCompile, setAutoCompile] = useState<boolean>(() => {
    return localStorage.getItem("vitae_auto_compile") !== "false";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [updateChannel, setUpdateChannel] = useState<string>(getStoredChannel);

  // Draggable Split Pane State
  const [splitRatio, setSplitRatio] = useState<number>(readSplitRatio);
  const splitRatioRef = useRef(splitRatio);
  splitRatioRef.current = splitRatio;
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<PendingSave | null>(null);

  const isCompilingRef = useRef(false);
  const queuedCompileRef = useRef(false);

  const currentDocRef = useRef<Document | null>(currentDocument);
  currentDocRef.current = currentDocument;

  const autoCompileRef = useRef(autoCompile);
  autoCompileRef.current = autoCompile;

  const latexInstalledRef = useRef(latexInstalled);
  latexInstalledRef.current = latexInstalled;

  const isSourceDetached = resumeData.sourceEditedManually === true;

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

  const scheduleSave = (delay: number) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      flushSaveRef.current();
    }, delay);
  };

  const flushSave = async (): Promise<PendingSave | null> => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (!pending) return null;
    pendingSaveRef.current = null;

    const { id, content, template_id, resume_data } = pending;
    try {
      await invoke("update_document_full", {
        id,
        content,
        templateId: template_id || null,
        resumeData: resume_data || null,
      });
    } catch (err) {
      // Keep the edit queued (unless a newer one replaced it) and retry shortly.
      if (!pendingSaveRef.current) {
        pendingSaveRef.current = pending;
        scheduleSave(SAVE_RETRY_MS);
      }
      setError(`Your changes couldn't be saved (${err}). Retrying…`);
      return null;
    }

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
        d.id === id ? { ...d, content, template_id, resume_data, updated_at: now } : d
      )
    );
    setCurrentDocument((curr) =>
      curr && curr.id === id
        ? { ...curr, content, template_id, resume_data, updated_at: now }
        : curr
    );
    return pending;
  };
  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    checkLatexInstallation();
    loadTemplates();
    loadDocuments();

    // Window close doesn't unmount React, so flush the debounced save explicitly.
    let unlisten: (() => void) | undefined;
    let disposed = false;
    if ("__TAURI_METADATA__" in window) {
      import("@tauri-apps/api/window")
        .then(({ appWindow }) =>
          appWindow.onCloseRequested(async () => {
            await flushSaveRef.current();
          })
        )
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch((err) => console.warn("Could not register close handler:", err));
    }

    return () => {
      disposed = true;
      unlisten?.();
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
        : prev
    );

    pendingSaveRef.current = {
      id: docId,
      content,
      template_id: templateId,
      resume_data: resumeDataString,
    };
    scheduleSave(SAVE_DEBOUNCE_MS);
  };

  /** Clears everything that belongs to the previously open document. */
  const resetBuildState = () => {
    setPreview(null);
    setLatexErrors([]);
    setBuildResult(null);
    setShowDetails(false);
  };

  /**
   * Loads a document's form data. Documents whose LaTeX was written or edited
   * by hand keep their source untouched: the form is locked and the editor
   * opens on the LaTeX view.
   */
  const syncDocumentResumeData = (doc: Document | null) => {
    if (!doc) {
      setResumeData(getEmptyResumeData());
      return;
    }

    if (doc.resume_data) {
      try {
        const data = normalizeResumeData(JSON.parse(doc.resume_data));
        setResumeData(data);
        if (data.sourceEditedManually) setEditorMode("code");
        return;
      } catch (e) {
        console.error("Failed to parse resume_data JSON:", e);
      }
    }

    if (isPlaceholderContent(doc.content)) {
      const initialData = getEmptyResumeData();
      setResumeData(initialData);
      const tpl =
        templates.find((t) => t.id === doc.template_id) || templates[0] || BUILTIN_TEMPLATES[0];
      updateDocumentStateAndQueueSave(
        doc.id,
        renderTemplate(tpl.content, initialData),
        tpl.id,
        JSON.stringify(initialData)
      );
      return;
    }

    // Hand-written LaTeX with no (readable) form data.
    setResumeData({ ...getEmptyResumeData(), sourceEditedManually: true });
    setEditorMode("code");
  };

  const handleResumeDataChange = (newData: ResumeData) => {
    if (!currentDocument) return;
    // The form is read-only while the source has manual edits.
    if (isSourceDetached && newData.sourceEditedManually) return;
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

  const handleRegenerateFromForm = () => {
    if (
      !confirm(
        "Replace the LaTeX source with the content of the form? Your manual edits to the source will be lost."
      )
    ) {
      return;
    }
    handleResumeDataChange({ ...resumeData, sourceEditedManually: undefined });
  };

  /**
   * Applies a template (optionally one just imported, with contact details
   * detected in it). Detected details only fill fields the user left empty.
   */
  const handleSelectTemplate = (
    template: Template,
    importedPersonal?: Partial<ResumePersonalInfo>
  ) => {
    if (!currentDocument) return;
    if (
      isSourceDetached &&
      !confirm(
        "Changing the template rebuilds the LaTeX source from the form, so your manual edits to the source will be lost. Continue?"
      )
    ) {
      return;
    }

    let data: ResumeData = { ...resumeData, sourceEditedManually: undefined };
    if (importedPersonal) {
      const personal = { ...data.personal };
      for (const [key, value] of Object.entries(importedPersonal)) {
        const field = key as keyof ResumePersonalInfo;
        if (typeof value === "string" && value && !personal[field]) {
          personal[field] = value;
        }
      }
      data = { ...data, personal };
    }

    // A freshly imported template isn't in `templates` until the reload finishes.
    setTemplates((prev) => (prev.some((t) => t.id === template.id) ? prev : [...prev, template]));
    setResumeData(data);
    updateDocumentStateAndQueueSave(
      currentDocument.id,
      renderTemplate(template.content, data),
      template.id,
      JSON.stringify(data)
    );

    // Show the new template right away
    setTimeout(() => {
      compileLatex();
    }, 300);
  };

  const compileLatex = useCallback(async () => {
    const doc = currentDocRef.current;
    if (!doc) return;

    if (isCompilingRef.current) {
      queuedCompileRef.current = true;
      return;
    }

    let contentToCompile = doc.content;
    if (pendingSaveRef.current && pendingSaveRef.current.id === doc.id) {
      contentToCompile = pendingSaveRef.current.content;
    }

    const saved = await flushSaveRef.current();
    if (saved && saved.id === doc.id) {
      contentToCompile = saved.content;
    }

    if (!latexInstalledRef.current) {
      return;
    }

    const charCount = contentToCompile.length;
    if (charCount > 10000 && !autoCompileRef.current) {
      const proceed = confirm(
        `This document has ${charCount.toLocaleString()} characters, so building it may take a while. Continue?`
      );
      if (!proceed) return;
    }

    isCompilingRef.current = true;
    setIsCompiling(true);

    try {
      const result = await invoke<CompilationResult>("compile_latex", {
        id: doc.id,
        content: contentToCompile,
      });

      // The user may have switched documents while pdflatex was running.
      if (currentDocRef.current?.id !== doc.id) return;

      setLatexErrors(result.errors);
      const errors = result.errors.filter((e) => e.severity === "error");
      const warnings = result.errors.filter((e) => e.severity === "warning");

      if (result.success && result.pdf_path) {
        setPreview({ docId: doc.id, revision: Date.now(), path: result.pdf_path });
        setBuildResult({ kind: "ok", warnings });
      } else {
        setBuildResult({ kind: "failed", errors, warnings });
      }
    } catch (err) {
      if (currentDocRef.current?.id !== doc.id) return;
      setBuildResult({ kind: "error", message: String(err) });
      setLatexErrors([]);
    } finally {
      isCompilingRef.current = false;
      setIsCompiling(false);
      if (queuedCompileRef.current) {
        queuedCompileRef.current = false;
        setTimeout(() => {
          compileLatex();
        }, 50);
      }
    }
  }, []);

  // Keep the preview up to date while editing
  useEffect(() => {
    if (!autoCompile || !currentDocument || !latexInstalled) return;

    const timer = setTimeout(() => {
      compileLatex();
    }, AUTO_UPDATE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [currentDocument?.id, currentDocument?.content, autoCompile, latexInstalled, compileLatex]);

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
      if (docs.length > 0 && !currentDocRef.current) {
        setCurrentDocument(docs[0]);
        syncDocumentResumeData(docs[0]);
      }
    } catch (err) {
      setError(`Your resumes couldn't be loaded: ${err}`);
    } finally {
      setDocumentsLoaded(true);
    }
  };

  const createNewDocument = async (title: string) => {
    setShowNewDocument(false);
    await flushSave();

    try {
      const defaultTemplate = templates[0] || BUILTIN_TEMPLATES[0];
      const initialResumeData = getEmptyResumeData();
      const initialContent = renderTemplate(defaultTemplate.content, initialResumeData);

      const newDoc = await invoke<Document>("create_document_with_template", {
        title,
        templateId: defaultTemplate.id,
        resumeData: JSON.stringify(initialResumeData),
        initialContent,
      });
      if (newDoc) {
        setDocuments((prev) => [newDoc, ...prev]);
        setCurrentDocument(newDoc);
        setResumeData(initialResumeData);
        resetBuildState();
        setEditorMode("form");
      }
    } catch (err) {
      setError(`The resume couldn't be created: ${err}`);
    }
  };

  const selectDocument = async (id: string) => {
    setShowDocumentMenu(false);
    if (currentDocument?.id === id) return;

    await flushSave();

    try {
      const doc = await invoke<Document>("get_document", { id });
      setCurrentDocument(doc);
      syncDocumentResumeData(doc);
      resetBuildState();
    } catch (err) {
      setError(`That resume couldn't be opened: ${err}`);
    }
  };

  const updateContentDirect = (content: string) => {
    if (!currentDocument) return;

    // Hand edits detach the source from the form so later form changes can't
    // silently overwrite them.
    const detachedData: ResumeData = isSourceDetached
      ? resumeData
      : { ...resumeData, sourceEditedManually: true };
    if (!isSourceDetached) setResumeData(detachedData);

    const resumeDataString = JSON.stringify(detachedData);
    setCurrentDocument((prev) =>
      prev ? { ...prev, content, resume_data: resumeDataString } : null
    );

    pendingSaveRef.current = {
      id: currentDocument.id,
      content,
      template_id: currentDocument.template_id,
      resume_data: resumeDataString,
    };
    scheduleSave(SAVE_DEBOUNCE_MS);
  };

  const deleteDocument = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!confirm(`Delete "${doc?.title ?? "this resume"}"? This can't be undone.`)) return;

    if (pendingSaveRef.current?.id === id) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      pendingSaveRef.current = null;
    }

    try {
      await invoke("delete_document", { id });
      const remaining = documents.filter((d) => d.id !== id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (currentDocRef.current?.id === id) {
        const nextDoc = remaining[0] || null;
        setCurrentDocument(nextDoc);
        syncDocumentResumeData(nextDoc);
        resetBuildState();
      }
    } catch (err) {
      setError(`The resume couldn't be deleted: ${err}`);
    }
  };

  const hasPreviewForCurrent = !!preview && preview.docId === currentDocument?.id;

  const exportPDF = async () => {
    if (!currentDocument || !hasPreviewForCurrent) return;

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
        setNotice(`Exported to ${filePath}`);
      }
    } catch (err) {
      setError(`The PDF couldn't be exported: ${err}`);
    }
  };

  const toggleAutoCompile = () => {
    const next = !autoCompile;
    setAutoCompile(next);
    localStorage.setItem("vitae_auto_compile", String(next));
  };

  const handleMouseDownResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const newRatio = ((e.clientX - rect.left) / rect.width) * 100;
      setSplitRatio(Math.min(Math.max(newRatio, 25), 75));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem("vitae_split_ratio", splitRatioRef.current.toString());
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleResizerKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = splitRatio - step;
    if (e.key === "ArrowRight") next = splitRatio + step;
    if (e.key === "Home") next = 25;
    if (e.key === "End") next = 75;
    if (next === null) return;
    e.preventDefault();
    const clamped = Math.min(Math.max(next, 25), 75);
    setSplitRatio(clamped);
    localStorage.setItem("vitae_split_ratio", clamped.toString());
  };

  // Notices (e.g. "exported") clear on their own
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Escape closes the build details sheet (dialogs handle their own Escape)
  useEffect(() => {
    if (!showDetails) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isModalOpen()) setShowDetails(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showDetails]);

  /* ---- Preview status ---- */

  const buildIssues =
    buildResult?.kind === "ok"
      ? buildResult.warnings.length
      : buildResult?.kind === "failed"
        ? buildResult.errors.length + buildResult.warnings.length
        : buildResult?.kind === "error"
          ? 1
          : 0;

  let statusTone: "idle" | "busy" | "ok" | "warn" | "fail" = "idle";
  let statusText = autoCompile ? "Waiting for changes" : "Preview not updated yet";
  if (!currentDocument) {
    statusText = "No resume open";
  } else if (!latexInstalled) {
    statusTone = "fail";
    statusText = "LaTeX isn't installed";
  } else if (isCompiling) {
    statusTone = "busy";
    statusText = "Updating preview…";
  } else if (buildResult?.kind === "ok") {
    statusTone = buildResult.warnings.length > 0 ? "warn" : "ok";
    statusText =
      buildResult.warnings.length > 0
        ? `Up to date, ${plural(buildResult.warnings.length, "warning")}`
        : "Up to date";
  } else if (buildResult?.kind === "failed") {
    statusTone = "fail";
    statusText = `Couldn't build the PDF, ${plural(buildResult.errors.length || 1, "error")}`;
  } else if (buildResult?.kind === "error") {
    statusTone = "fail";
    statusText = "Couldn't build the PDF";
  }

  let emptyPreviewMessage = "Your resume will appear here.";
  if (!currentDocument) {
    emptyPreviewMessage = "Create a resume to see it here.";
  } else if (!latexInstalled) {
    emptyPreviewMessage = "Install LaTeX to see your resume as a PDF.";
  } else if (isCompiling) {
    emptyPreviewMessage = "Building your PDF…";
  } else if (buildResult && buildResult.kind !== "ok") {
    emptyPreviewMessage = "The PDF couldn't be built. See errors below to find out why.";
  } else if (!autoCompile) {
    emptyPreviewMessage = "Select Update preview to build your PDF.";
  }

  const templateLabel = activeTemplate.name;

  const modeSwitch = (
    <div className="segmented" role="group" aria-label="Edit with">
      <button
        type="button"
        className={editorMode === "form" ? "active" : ""}
        onClick={() => setEditorMode("form")}
        aria-pressed={editorMode === "form"}
        data-testid="tab-form-view"
      >
        Form
      </button>
      <button
        type="button"
        className={editorMode === "code" ? "active" : ""}
        onClick={() => setEditorMode("code")}
        aria-pressed={editorMode === "code"}
        data-testid="tab-code-view"
      >
        LaTeX source
      </button>
    </div>
  );
  const editorHidden = viewMode === "preview";
  const previewHidden = viewMode === "editor";

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
        />
      )}
      {showNewDocument && (
        <NewDocumentDialog
          onCreate={createNewDocument}
          onCancel={() => setShowNewDocument(false)}
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

      <header className="app-header">
        <div className="header-document">
          <h1 className="document-heading">
            <button
              type="button"
              className="document-switcher"
              onClick={() => setShowDocumentMenu((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={showDocumentMenu}
              data-testid="btn-toggle-sidebar"
            >
              <span className="document-switcher-title">
                {currentDocument?.title || "Vitae"}
              </span>
              <IconChevronDown size={16} />
            </button>
          </h1>
          {showDocumentMenu && (
            <DocumentMenu
              documents={documents}
              currentDocument={currentDocument}
              onSelectDocument={selectDocument}
              onCreateDocument={() => {
                setShowDocumentMenu(false);
                setShowNewDocument(true);
              }}
              onDeleteDocument={deleteDocument}
              onClose={() => setShowDocumentMenu(false)}
            />
          )}
        </div>

        {currentDocument && (
          <button
            type="button"
            className="template-picker"
            onClick={() => setShowTemplateModal(true)}
            data-testid="btn-open-templates"
            title="Change template"
          >
            <IconPalette size={15} />
            <span className="visually-hidden">Template: </span>
            <span className="template-picker-name">{templateLabel}</span>
            <IconChevronDown size={14} />
          </button>
        )}

        <div className="header-end">
          <div className="segmented" role="group" aria-label="Layout">
            <button
              type="button"
              className={viewMode === "editor" ? "active" : ""}
              onClick={() => setViewMode("editor")}
              aria-pressed={viewMode === "editor"}
              title="Editor only"
              data-testid="btn-toggle-editor"
            >
              <IconForm size={15} />
              <span className="segmented-label">Edit</span>
            </button>
            <button
              type="button"
              className={viewMode === "split" ? "active" : ""}
              onClick={() => setViewMode("split")}
              aria-pressed={viewMode === "split"}
              title="Editor and preview side by side"
              data-testid="btn-toggle-split"
            >
              <IconSplit size={15} />
              <span className="segmented-label">Split</span>
            </button>
            <button
              type="button"
              className={viewMode === "preview" ? "active" : ""}
              onClick={() => setViewMode("preview")}
              aria-pressed={viewMode === "preview"}
              title="Preview only"
              data-testid="btn-toggle-preview"
            >
              <IconEye size={15} />
              <span className="segmented-label">Preview</span>
            </button>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
            data-testid="btn-settings"
          >
            <IconSettings size={17} />
          </button>
        </div>
      </header>

      <div className="toasts" aria-live="polite">
        {error && (
          <div className="toast toast-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="toast" role="status">
            <p>{notice}</p>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
      </div>

      <main
        ref={containerRef}
        className={`workspace view-${viewMode} ${isResizing ? "is-resizing" : ""}`}
      >
        <section
          className="editor-pane"
          aria-label="Editor"
          hidden={editorHidden}
          style={viewMode === "split" ? { flexBasis: `${splitRatio}%` } : undefined}
        >
          {currentDocument ? (
            <>
              <ErrorBoundary
                resetKey={`${currentDocument.id}-${editorMode}`}
                fallbackTitle="This view hit an error"
              >
                {editorMode === "form" ? (
                  <ResumeForm
                    data={resumeData}
                    onChange={handleResumeDataChange}
                    customFields={extractedAnalysis.customVariables}
                    locked={isSourceDetached}
                    onRegenerateFromForm={handleRegenerateFromForm}
                    onOpenSource={() => setEditorMode("code")}
                    toolbarEnd={modeSwitch}
                  />
                ) : (
                  <>
                  <div className="pane-bar">
                    <p className="pane-bar-note">
                      {isSourceDetached
                        ? "The form is paused while you edit the source."
                        : "Editing the source pauses the form."}
                    </p>
                    <div className="pane-bar-end">{modeSwitch}</div>
                  </div>
                  <Suspense fallback={<div className="pane-loading">Loading the LaTeX editor…</div>}>
                    <Editor
                      content={currentDocument.content || ""}
                      onChange={updateContentDirect}
                      errors={latexErrors}
                    />
                  </Suspense>
                  </>
                )}
              </ErrorBoundary>
            </>
          ) : (
            documentsLoaded && (
              <div className="welcome">
                <h2>Start your resume</h2>
                <p>
                  Fill in a simple form and Vitae typesets it into a clean PDF with LaTeX. Your
                  resumes stay on this computer.
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowNewDocument(true)}
                >
                  <IconPlus size={15} />
                  New resume
                </button>
              </div>
            )
          )}
        </section>

        {viewMode === "split" && (
          <div
            className="split-resizer"
            onMouseDown={handleMouseDownResize}
            onKeyDown={handleResizerKeyDown}
            onDoubleClick={() => {
              setSplitRatio(50);
              localStorage.setItem("vitae_split_ratio", "50");
            }}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize editor and preview"
            aria-valuemin={25}
            aria-valuemax={75}
            aria-valuenow={Math.round(splitRatio)}
            tabIndex={0}
            title="Drag to resize, double-click to reset"
          />
        )}

        <section className="preview-pane" aria-label="Preview" hidden={previewHidden}>
          <div className="mat" tabIndex={0} role="region" aria-label="PDF preview">
            <PDFViewer
              documentId={preview && hasPreviewForCurrent ? preview.docId : null}
              revision={preview && hasPreviewForCurrent ? preview.revision : 0}
              isCompiling={isCompiling}
              emptyMessage={emptyPreviewMessage}
            />
          </div>

          {showDetails && buildResult && (
            <BuildDetails
              result={buildResult}
              onClose={() => setShowDetails(false)}
              onOpenSource={() => {
                setShowDetails(false);
                setEditorMode("code");
                if (viewMode === "preview") setViewMode("split");
              }}
            />
          )}

          <div className="preview-bar">
            <div className={`build-status tone-${statusTone}`} role="status">
              <span className="build-status-dot" aria-hidden="true" />
              <span className="build-status-text">{statusText}</span>
              {!latexInstalled ? (
                <button type="button" className="link-button" onClick={() => setShowSetup(true)}>
                  Set up LaTeX
                </button>
              ) : (
                buildResult &&
                buildIssues > 0 &&
                !isCompiling && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setShowDetails((open) => !open)}
                    aria-expanded={showDetails}
                  >
                    {buildResult.kind === "ok"
                      ? "See warnings"
                      : buildResult.kind === "failed" && buildResult.errors.length > 0
                        ? "See errors"
                        : "See why"}
                  </button>
                )
              )}
            </div>

            <div className="preview-actions">
              <label className="switch">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label="Auto-update preview"
                  checked={autoCompile}
                  onChange={toggleAutoCompile}
                  disabled={!latexInstalled}
                />
                <span className="switch-track" aria-hidden="true" />
                <span>Auto-update</span>
              </label>
              {(!autoCompile || (statusTone === "fail" && latexInstalled)) && (
                <button
                  type="button"
                  className="btn"
                  onClick={compileLatex}
                  disabled={!currentDocument || isCompiling || !latexInstalled}
                  data-testid="btn-update-preview"
                >
                  {autoCompile ? "Try again" : "Update preview"}
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={exportPDF}
                disabled={!hasPreviewForCurrent}
              >
                <IconDownload size={15} />
                Export PDF
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
