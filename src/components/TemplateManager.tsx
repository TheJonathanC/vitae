import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Template, ResumePersonalInfo } from "../types";
import { useDialog } from "../hooks/useDialog";
import { convertRawLatexToTemplate, extractFieldsFromTemplate } from "../utils/templateEngine";
import { IconUpload, IconTrash, IconX, IconCheck, IconChevronLeft } from "./Icons";

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
  experience: "experience",
  education: "education",
  projects: "projects",
  skills: "skills",
  customSections: "additional sections",
};

const DETECTED_LABELS: Record<string, string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  github: "GitHub",
  linkedin: "LinkedIn",
};

function describeSections(content: string): string {
  const analysis = extractFieldsFromTemplate(content);
  const sections = analysis.detectedSections.map((sec) => SECTION_LABELS[sec] || sec);
  if (sections.length === 0) return "Fixed layout; only your details come from the form.";
  const list =
    sections.length === 1
      ? sections[0]
      : `${sections.slice(0, -1).join(", ")} and ${sections[sections.length - 1]}`;
  return `Shows ${list}.`;
}

type View = { kind: "list" } | { kind: "import" } | { kind: "source"; template: Template };

export const TemplateManager: React.FC<TemplateManagerProps> = ({
  templates,
  currentTemplateId,
  onSelectTemplate,
  onTemplatesUpdated,
  onClose,
}) => {
  const [view, setView] = useState<View>({ kind: "list" });

  // Import form state
  const [importName, setImportName] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importExtractedData, setImportExtractedData] = useState<Partial<ResumePersonalInfo> | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Escape steps back to the list first, then closes.
  const dialogRef = useDialog<HTMLDivElement>(() => {
    if (view.kind !== "list") {
      setView({ kind: "list" });
    } else {
      onClose();
    }
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportName(file.name.replace(/\.[^/.]+$/, ""));
    setImportFileName(file.name);
    setImportError(null);
    setView({ kind: "import" });

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) {
        setImportError("That file is empty. Choose a .tex file with a LaTeX document in it.");
        return;
      }

      const { templateContent, extractedData } = convertRawLatexToTemplate(text);
      setImportContent(templateContent);
      setImportExtractedData(extractedData.personal ?? null);
    };
    reader.onerror = () => {
      setImportError("The file couldn't be read. Try choosing it again.");
    };
    reader.readAsText(file);
    // Allow choosing the same file again later
    e.target.value = "";
  };

  const handleSaveImportedTemplate = async () => {
    if (!importName.trim()) {
      setImportError("Give the template a name.");
      return;
    }
    if (!importContent.trim()) {
      setImportError("The template is empty.");
      return;
    }

    setIsSaving(true);
    setImportError(null);

    try {
      const newTemplate = await invoke<Template>("create_template", {
        name: importName.trim(),
        description: importFileName ? `Imported from ${importFileName}` : "Imported template",
        content: importContent,
      });

      onTemplatesUpdated();
      onSelectTemplate(newTemplate, importExtractedData ?? undefined);
      onClose();
    } catch (err) {
      setImportError(`The template couldn't be saved: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string, templateName: string) => {
    if (!confirm(`Delete the template "${templateName}"? Resumes using it switch to the default template.`)) return;

    try {
      await invoke("delete_template", { id: templateId });
      onTemplatesUpdated();
    } catch (err) {
      alert(`The template couldn't be deleted: ${err}`);
    }
  };

  const detected = importExtractedData
    ? Object.entries(importExtractedData).filter(([, value]) => value)
    : [];

  return (
    <div className="dialog-backdrop" data-testid="template-manager-modal" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-manager-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          {view.kind !== "list" && (
            <button
              type="button"
              className="icon-button"
              onClick={() => setView({ kind: "list" })}
              aria-label="Back to templates"
            >
              <IconChevronLeft size={18} />
            </button>
          )}
          <h2 id="template-manager-title">
            {view.kind === "list"
              ? "Templates"
              : view.kind === "import"
                ? "Import a template"
                : view.template.name}
          </h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".tex,text/plain"
          hidden
          onChange={handleFileChange}
          data-testid="template-file-input"
        />

        {view.kind === "list" && (
          <>
            <div className="dialog-body">
              <p className="dialog-lead">
                The template sets the look of your PDF. Your content stays the same when you switch.
              </p>
              <ul className="template-list">
                {templates.map((tpl) => {
                  const isSelected = currentTemplateId === tpl.id;
                  return (
                    <li
                      key={tpl.id}
                      className={`template-option ${isSelected ? "selected" : ""}`}
                      data-testid={`template-card-${tpl.id}`}
                    >
                      <div className="template-option-text">
                        <h3>
                          {tpl.name}
                          {!tpl.is_builtin && <span className="tag">Imported</span>}
                        </h3>
                        <p>{tpl.description}</p>
                        <p className="template-sections">{describeSections(tpl.content)}</p>
                      </div>
                      <div className="template-option-actions">
                        {isSelected ? (
                          <span className="in-use">
                            <IconCheck size={15} />
                            In use
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-select"
                            onClick={() => {
                              onSelectTemplate(tpl);
                              onClose();
                            }}
                          >
                            Use template
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setView({ kind: "source", template: tpl })}
                        >
                          View LaTeX
                        </button>
                        {!tpl.is_builtin && (
                          <button
                            type="button"
                            className="icon-button danger"
                            onClick={() => handleDeleteTemplate(tpl.id, tpl.name)}
                            aria-label={`Delete template ${tpl.name}`}
                            title="Delete template"
                          >
                            <IconTrash size={15} />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="dialog-foot">
              <p className="dialog-foot-note">Already have a resume written in LaTeX?</p>
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={15} />
                Import .tex file
              </button>
            </div>
          </>
        )}

        {view.kind === "import" && (
          <>
            <div className="dialog-body">
              <p className="dialog-lead">
                Vitae finds your name and contact details (email, phone, GitHub, LinkedIn) and links
                them to the form. Everything else keeps the layout you wrote. Files that already use{" "}
                <code>{"{{placeholders}}"}</code> are imported as they are.
              </p>

              {!importContent && !importError && <p className="muted">Reading {importFileName}…</p>}

              {importContent && (
                <div className="import-fields">
                  <div className="field">
                    <label htmlFor="import-template-name">Template name</label>
                    <input
                      id="import-template-name"
                      type="text"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                    />
                  </div>

                  <div className="detected">
                    <h3>Linked to the form</h3>
                    {detected.length > 0 ? (
                      <>
                        <dl>
                          {detected.map(([key, value]) => (
                            <div key={key}>
                              <dt>{DETECTED_LABELS[key] || key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        <p className="muted">These fill in any of your details that are still empty.</p>
                      </>
                    ) : (
                      <p className="muted">
                        No contact details were found, so this template will use the file's text as written.
                      </p>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="import-template-source">LaTeX source</label>
                    <textarea
                      id="import-template-source"
                      className="code-textarea"
                      rows={8}
                      value={importContent}
                      onChange={(e) => setImportContent(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </div>
              )}

              {importError && (
                <p className="form-error" role="alert">
                  {importError}
                </p>
              )}
            </div>
            <div className="dialog-foot">
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
                Choose another file
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveImportedTemplate}
                disabled={isSaving || !importContent}
              >
                {isSaving ? "Saving…" : "Save and use template"}
              </button>
            </div>
          </>
        )}

        {view.kind === "source" && (
          <div className="dialog-body">
            <pre className="template-source">{view.template.content}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default TemplateManager;
