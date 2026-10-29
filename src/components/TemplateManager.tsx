import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Template, ResumePersonalInfo } from "../types";
import { useDialog } from "../hooks/useDialog";
import { convertRawLatexToTemplate, extractFieldsFromTemplate } from "../utils/templateEngine";
import {
  IconLayers,
  IconUpload,
  IconPlus,
  IconTrash,
  IconFile,
  IconSearch,
  IconX,
  IconCheck,
} from "./Icons";

interface TemplateManagerProps {
  templates: Template[];
  currentTemplateId: string | null;
  /**
   * Applies a template. For a just-imported template, `importedPersonal` holds
   * contact details detected in the file (applied in the same update, so the
   * template switch and the data merge can't race each other).
   */
  onSelectTemplate: (template: Template, importedPersonal?: Partial<ResumePersonalInfo>) => void;
  onTemplatesUpdated: () => void;
  onClose: () => void;
}

const SECTION_LABELS: Record<string, string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  customSections: "Custom sections",
};

export const TemplateManager: React.FC<TemplateManagerProps> = ({
  templates,
  currentTemplateId,
  onSelectTemplate,
  onTemplatesUpdated,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<"gallery" | "import">("gallery");
  const [viewingTemplate, setViewingTemplate] = useState<Template | null>(null);

  // Import form state
  const [importName, setImportName] = useState("");
  const [importDesc, setImportDesc] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importExtractedData, setImportExtractedData] = useState<Partial<ResumePersonalInfo> | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Escape closes the code viewer first, then the manager.
  const dialogRef = useDialog<HTMLDivElement>(() => {
    if (viewingTemplate) {
      setViewingTemplate(null);
    } else {
      onClose();
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const baseName = file.name.replace(/\.[^/.]+$/, "");
    setImportName(baseName);
    setImportDesc(`Imported custom template from ${file.name}`);
    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) {
        setImportError("Uploaded file is empty");
        return;
      }

      // Convert or analyze raw LaTeX
      const { templateContent, extractedData } = convertRawLatexToTemplate(text);
      setImportContent(templateContent);
      setImportExtractedData(extractedData.personal ?? null);
      setActiveTab("import");
    };
    reader.onerror = () => {
      setImportError("Failed to read file");
    };
    reader.readAsText(file);
  };

  const handleSaveImportedTemplate = async () => {
    if (!importName.trim()) {
      setImportError("Please provide a template name");
      return;
    }
    if (!importContent.trim()) {
      setImportError("Template content is empty");
      return;
    }

    setIsSaving(true);
    setImportError(null);

    try {
      const newTemplate = await invoke<Template>("create_template", {
        name: importName.trim(),
        description: importDesc.trim() || "User imported template",
        content: importContent,
      });

      setImportSuccess(`Template "${newTemplate.name}" successfully imported and saved!`);
      onTemplatesUpdated();

      onSelectTemplate(newTemplate, importExtractedData ?? undefined);

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setImportError(`Failed to save template: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    if (!confirm(`Are you sure you want to delete template "${templateName}"?`)) return;

    try {
      await invoke("delete_template", { id: templateId });
      onTemplatesUpdated();
    } catch (err) {
      alert(`Failed to delete template: ${err}`);
    }
  };

  return (
    <div
      className="modal-overlay"
      data-testid="template-manager-modal"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="modal-content template-modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="template-manager-title">Resume Templates</h2>
          <button
            className="btn-close"
            onClick={onClose}
            title="Close modal"
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".tex,text/plain"
          style={{ display: "none" }}
          onChange={handleFileChange}
          data-testid="template-file-input"
        />

        {/* Modal Navigation Tabs */}
        <div className="template-modal-tabs">
          <button
            className={`tab-btn ${activeTab === "gallery" ? "active" : ""}`}
            onClick={() => setActiveTab("gallery")}
          >
            <IconLayers size={14} />
            <span>Gallery ({templates.length})</span>
          </button>
          <button
            className={`tab-btn ${activeTab === "import" ? "active" : ""}`}
            onClick={() => setActiveTab("import")}
          >
            <IconUpload size={14} />
            <span>Import Custom Template</span>
          </button>
        </div>

        {/* TAB 1: GALLERY */}
        {activeTab === "gallery" && (
          <div className="template-gallery">
            <div className="gallery-header-action">
              <p className="gallery-subtitle">
                Select a template for your resume or bring your own LaTeX template.
              </p>
              <button
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <IconPlus size={14} />
                <span>Upload .tex</span>
              </button>
            </div>

            <div className="template-grid">
              {templates.map((tpl) => {
                const isSelected = currentTemplateId === tpl.id;
                const analysis = extractFieldsFromTemplate(tpl.content);

                return (
                  <div
                    key={tpl.id}
                    className={`template-card ${isSelected ? "selected" : ""}`}
                    data-testid={`template-card-${tpl.id}`}
                  >
                    <div className="template-card-header">
                      <h3>{tpl.name}</h3>
                      <span
                        className={`badge ${tpl.is_builtin ? "badge-builtin" : "badge-custom"}`}
                      >
                        {tpl.is_builtin ? "Built-in" : "Custom"}
                      </span>
                    </div>

                    <p className="template-description">{tpl.description}</p>

                    <div className="template-features">
                      <span className="feature-tag">
                        Sections:{" "}
                        {analysis.detectedSections.map((sec) => SECTION_LABELS[sec] || sec).join(", ") ||
                          "Standard"}
                      </span>
                      {analysis.customVariables.length > 0 && (
                        <span className="feature-tag custom-var-tag">
                          +{analysis.customVariables.length} custom fields
                        </span>
                      )}
                    </div>

                    <div className="template-card-actions">
                      <button
                        className={`btn-select ${isSelected ? "active" : ""}`}
                        disabled={isSelected}
                        onClick={() => {
                          onSelectTemplate(tpl);
                          onClose();
                        }}
                      >
                        {isSelected ? (
                          <>
                            <IconCheck size={14} />
                            <span>Active Template</span>
                          </>
                        ) : (
                          <span>Use This Template</span>
                        )}
                      </button>

                      <button
                        className="btn-secondary"
                        onClick={() => setViewingTemplate(tpl)}
                        title="View template LaTeX code"
                      >
                        View Code
                      </button>

                      {!tpl.is_builtin && (
                        <button
                          className="btn-danger-icon"
                          onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                          title="Delete custom template"
                          aria-label="Delete template"
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: IMPORT TEMPLATE */}
        {activeTab === "import" && (
          <div className="template-import-view">
            <div className="import-dropzone">
              <IconFile size={36} className="dropzone-icon" />
              <h3>Upload Your LaTeX Resume Template</h3>
              <p>
                Upload any <code>.tex</code> file. Vitae detects your name and contact details
                (email, phone, GitHub, LinkedIn) and turns them into form fields; the rest of the
                layout is kept exactly as written. Templates that already use{" "}
                <code>{"{{placeholders}}"}</code> are imported as-is.
              </p>
              <button
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <IconUpload size={14} />
                <span>Choose .tex File</span>
              </button>
            </div>

            {importContent && (
              <div className="import-preview-section">
                <div className="form-group">
                  <label htmlFor="import-template-name">Template Name *</label>
                  <input
                    id="import-template-name"
                    type="text"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    placeholder="e.g. Deedy Resume or Overleaf Modern"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="import-template-desc">Description</label>
                  <input
                    id="import-template-desc"
                    type="text"
                    value={importDesc}
                    onChange={(e) => setImportDesc(e.target.value)}
                    placeholder="Short description of this template"
                  />
                </div>

                {importExtractedData && Object.keys(importExtractedData).length > 0 && (
                  <div className="extracted-notice">
                    <h4>
                      <IconSearch size={14} />
                      <span>Detected details</span>
                    </h4>
                    <ul>
                      {(["name", "email", "phone", "github", "linkedin"] as const).map(
                        (key) =>
                          importExtractedData[key] && (
                            <li key={key}>
                              <strong>{key[0].toUpperCase() + key.slice(1)}:</strong>{" "}
                              {importExtractedData[key]}
                            </li>
                          )
                      )}
                    </ul>
                    <p className="extracted-hint">
                      These fill in any of your form fields that are still empty.
                    </p>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="import-template-source">Template LaTeX Source (with placeholders)</label>
                  <textarea
                    id="import-template-source"
                    rows={8}
                    className="code-textarea"
                    value={importContent}
                    onChange={(e) => setImportContent(e.target.value)}
                  />
                </div>

                {importError && <div className="error-message">{importError}</div>}
                {importSuccess && <div className="success-message">{importSuccess}</div>}

                <div className="import-actions">
                  <button
                    className="btn-primary"
                    onClick={handleSaveImportedTemplate}
                    disabled={isSaving}
                  >
                    {isSaving ? "Saving..." : "Save Template to Library"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setImportContent("");
                      setImportExtractedData(null);
                      setActiveTab("gallery");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUBMODAL: View Template Source */}
        {viewingTemplate && (
          <div className="submodal-overlay" onClick={() => setViewingTemplate(null)}>
            <div
              className="submodal-content"
              role="dialog"
              aria-labelledby="template-source-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="submodal-header">
                <h3 id="template-source-title">{viewingTemplate.name} - Template Source</h3>
                <button
                  className="btn-close"
                  onClick={() => setViewingTemplate(null)}
                  aria-label="Close"
                >
                  <IconX size={16} />
                </button>
              </div>
              <pre className="template-source-preview">{viewingTemplate.content}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateManager;
