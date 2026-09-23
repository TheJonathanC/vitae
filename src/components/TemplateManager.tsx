import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Template, ResumeData } from "../types";
import { convertRawLatexToTemplate, extractFieldsFromTemplate } from "../utils/templateEngine";

interface TemplateManagerProps {
  templates: Template[];
  currentTemplateId: string | null;
  onSelectTemplate: (template: Template) => void;
  onTemplatesUpdated: () => void;
  onClose: () => void;
  onImportDataIntoResume?: (extractedData: Partial<ResumeData>) => void;
}

export const TemplateManager: React.FC<TemplateManagerProps> = ({
  templates,
  currentTemplateId,
  onSelectTemplate,
  onTemplatesUpdated,
  onClose,
  onImportDataIntoResume,
}) => {
  const [activeTab, setActiveTab] = useState<"gallery" | "import">("gallery");
  const [viewingTemplate, setViewingTemplate] = useState<Template | null>(null);

  // Import form state
  const [importName, setImportName] = useState("");
  const [importDesc, setImportDesc] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importExtractedData, setImportExtractedData] = useState<Partial<ResumeData> | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      setImportExtractedData(extractedData);
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

      // Optionally offer to apply new template
      onSelectTemplate(newTemplate);

      if (
        onImportDataIntoResume &&
        importExtractedData &&
        importExtractedData.personal?.name
      ) {
        onImportDataIntoResume(importExtractedData);
      }

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
    <div className="modal-overlay" data-testid="template-manager-modal">
      <div className="modal-content template-modal-content">
        <div className="modal-header">
          <h2>Resume Templates</h2>
          <button className="btn-close" onClick={onClose} title="Close">
            ×
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
            📚 Template Gallery ({templates.length})
          </button>
          <button
            className={`tab-btn ${activeTab === "import" ? "active" : ""}`}
            onClick={() => setActiveTab("import")}
          >
            📥 Import Custom Template (.tex)
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
                + Upload .tex Template
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
                        Sections: {analysis.detectedSections.join(", ") || "Standard"}
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
                        {isSelected ? "✓ Active Template" : "Use This Template"}
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
                        >
                          🗑️
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
              <span className="dropzone-icon">📄</span>
              <h3>Upload Your LaTeX Resume Template</h3>
              <p>
                Upload any <code>.tex</code> template file. Vitae automatically detects its
                structure, extracts fields (Name, Contact, Experience, Education, Skills), and
                saves it in your persistent templates library.
              </p>
              <button
                className="btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose .tex File
              </button>
            </div>

            {importContent && (
              <div className="import-preview-section">
                <div className="form-group">
                  <label>Template Name *</label>
                  <input
                    type="text"
                    value={importName}
                    onChange={(e) => setImportName(e.target.value)}
                    placeholder="e.g. Deedy Resume or Overleaf Modern"
                  />
                </div>

                <div className="form-group">
                  <label>Description</label>
                  <input
                    type="text"
                    value={importDesc}
                    onChange={(e) => setImportDesc(e.target.value)}
                    placeholder="Short description of this template"
                  />
                </div>

                {importExtractedData && (
                  <div className="extracted-notice">
                    <h4>🔍 Extracted Resume Structure:</h4>
                    <ul>
                      {importExtractedData.personal?.name && (
                        <li>
                          <strong>Name:</strong> {importExtractedData.personal.name}
                        </li>
                      )}
                      {importExtractedData.personal?.email && (
                        <li>
                          <strong>Email:</strong> {importExtractedData.personal.email}
                        </li>
                      )}
                      {importExtractedData.personal?.phone && (
                        <li>
                          <strong>Phone:</strong> {importExtractedData.personal.phone}
                        </li>
                      )}
                    </ul>
                  </div>
                )}

                <div className="form-group">
                  <label>Template LaTeX Source (with placeholders)</label>
                  <textarea
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
              onClick={(e) => e.stopPropagation()}
            >
              <div className="submodal-header">
                <h3>{viewingTemplate.name} - Template Source</h3>
                <button
                  className="btn-close"
                  onClick={() => setViewingTemplate(null)}
                >
                  ×
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
