import React, { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Template } from "../types";
import { useDialog } from "../hooks/useDialog";
import { extractFieldsFromTemplate } from "../utils/templateEngine";
import {
  ImportPlan,
  ImportResult,
  ImportSection,
  ImportedData,
  SectionMapping,
  analyzeLatexImport,
  buildLatexImport,
  changeSectionMapping,
  changeSlotField,
  fieldOptions,
  mappingOptions,
} from "../utils/latexImport";
import { IconUpload, IconTrash, IconX, IconCheck, IconChevronLeft, IconChevronRight, IconFile } from "./Icons";

interface TemplateManagerProps {
  templates: Template[];
  currentTemplateId: string | null;
  /**
   * Applies a template. For a just-imported template, `imported` holds the
   * content found in the file (applied in the same update, so the template
   * switch and the data merge can't race each other).
   */
  onSelectTemplate: (template: Template, imported?: ImportedData) => void;
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
  title: "Headline",
  email: "Email",
  phone: "Phone",
  location: "Location",
  website: "Website",
  github: "GitHub",
  linkedin: "LinkedIn",
};

const ENTRY_MAPPINGS: SectionMapping[] = ["experience", "education", "projects", "skills", "list"];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One detected section: what it becomes, and which field each repeating piece fills. */
function ImportSectionCard({
  plan,
  section,
  onMapping,
  onField,
}: {
  plan: ImportPlan;
  section: ImportSection;
  onMapping: (mapping: SectionMapping) => void;
  onField: (slotId: string, field: string) => void;
}) {
  const selectId = `import-section-${section.id}`;
  const showSlots = ENTRY_MAPPINGS.includes(section.mapping) && section.slots.length > 0;
  const facts =
    section.shape === "entries"
      ? [
          plural(section.entryCount, "entry", "entries"),
          section.bulletCount > 0 ? plural(section.bulletCount, "bullet", "bullets") : "",
        ]
      : section.shape === "paragraph"
        ? ["Text"]
        : ["Empty"];
  const kept = section.mapping === "keep";
  return (
    <li className={`import-section${kept ? " is-kept" : ""}`} data-testid={`import-section-${section.id}`}>
      <div className="import-section-head">
        <div className="import-section-title">
          <h4>{section.heading}</h4>
          <p className="muted">{facts.filter(Boolean).join(", ")}</p>
        </div>
        <div className="import-section-mapping">
          <label htmlFor={selectId}>Use as</label>
          <select id={selectId} value={section.mapping} onChange={(e) => onMapping(e.target.value as SectionMapping)}>
            {mappingOptions(plan, section).map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {showSlots && (
        <table className="import-slots">
          <thead>
            <tr>
              <th scope="col">In your file</th>
              <th scope="col" aria-hidden="true" />
              <th scope="col">Fills the form field</th>
            </tr>
          </thead>
          <tbody>
            {section.slots.map((slot) => {
              const sample = slot.samples.find(Boolean) || "";
              const id = `${selectId}-${slot.id}`;
              return (
                <tr key={slot.id} className={slot.field ? "" : "is-fixed"}>
                  <td>
                    <label htmlFor={id} className="import-sample" title={sample}>
                      {sample}
                    </label>
                  </td>
                  <td className="import-arrow" aria-hidden="true">
                    <IconChevronRight size={14} />
                  </td>
                  <td>
                    <select id={id} value={slot.field} onChange={(e) => onField(slot.id, e.target.value)}>
                      {fieldOptions(section.mapping, slot.field).map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {section.shape === "paragraph" && !kept && <p className="import-preview">{section.preview}</p>}
    </li>
  );
}

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
  const [importRaw, setImportRaw] = useState("");
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
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

      const plan = analyzeLatexImport(text);
      const result = buildLatexImport(text, plan);
      setImportRaw(text);
      setImportPlan(plan);
      setImportResult(result);
      setImportContent(result.templateContent);
    };
    reader.onerror = () => {
      setImportError("The file couldn't be read. Try choosing it again.");
    };
    reader.readAsText(file);
    // Allow choosing the same file again later
    e.target.value = "";
  };

  /** Rebuilds the template after a section or field choice changes. */
  const updatePlan = (plan: ImportPlan) => {
    const result = buildLatexImport(importRaw, plan);
    setImportPlan(plan);
    setImportResult(result);
    setImportContent(result.templateContent);
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
      onSelectTemplate(newTemplate, importResult?.extractedData);
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

  const detected = Object.entries(importPlan?.personal || {}).filter(([, value]) => value);
  const match = importResult?.match ?? null;

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
              <div className="import-file">
                <IconFile size={18} />
                <span className="import-file-name">{importFileName}</span>
                <button type="button" className="text-button" onClick={() => fileInputRef.current?.click()}>
                  Choose another file
                </button>
              </div>

              {!importContent && !importError && <p className="muted">Reading {importFileName}…</p>}

              {importContent && importPlan && (
                <div className="import-fields">
                  {match !== null && (
                    <div className={match < 0.9 ? "import-match warn" : "import-match"} data-testid="import-match">
                      {match < 0.9 ? <span className="import-match-mark">!</span> : <IconCheck size={16} />}
                      <p>
                        {match >= 0.995
                          ? "With what was found, the new template prints all of the file's text."
                          : `With what was found, the new template prints ${Math.round(match * 100)}% of the file's text.`}
                        {match < 0.9 && " Some entries are laid out differently from the first one; check the preview after saving."}
                      </p>
                    </div>
                  )}

                  <div className="field">
                    <label htmlFor="import-template-name">Template name</label>
                    <input
                      id="import-template-name"
                      type="text"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                    />
                  </div>

                  {importPlan.parameterized ? (
                    <p className="dialog-lead">
                      This file already uses <code>{"{{placeholders}}"}</code>, so it's imported as it is.
                    </p>
                  ) : (
                    <>
                      <section className="import-group" aria-labelledby="import-contact-title">
                        <div className="import-group-head">
                          <h3 id="import-contact-title">Contact details</h3>
                          <p className="muted">
                            {detected.length > 0
                              ? "These fill your details where they're still empty."
                              : "None were found, so the header keeps the file's text."}
                          </p>
                        </div>
                        {detected.length > 0 && (
                          <dl className="import-contact">
                            {detected.map(([key, value]) => (
                              <div key={key}>
                                <dt>{DETECTED_LABELS[key] || key}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </section>

                      <section className="import-group" aria-labelledby="import-sections-title">
                        <div className="import-group-head">
                          <h3 id="import-sections-title">Sections</h3>
                          {importPlan.sections.length > 0 ? (
                            <p className="muted">
                              Check what each section becomes and which form field each piece of text fills. Entries
                              found here are added to sections that are still empty.
                            </p>
                          ) : (
                            <p className="muted">
                              No sections were found (Vitae looks for <code>\section</code>-style headings), so the
                              body keeps the file's text.
                            </p>
                          )}
                        </div>
                        {importPlan.sections.length > 0 && (
                          <ul className="import-sections">
                            {importPlan.sections.map((section) => (
                              <ImportSectionCard
                                key={section.id}
                                plan={importPlan}
                                section={section}
                                onMapping={(mapping) => updatePlan(changeSectionMapping(importPlan, section.id, mapping))}
                                onField={(slotId, field) => updatePlan(changeSlotField(importPlan, section.id, slotId, field))}
                              />
                            ))}
                          </ul>
                        )}
                      </section>
                    </>
                  )}

                  <details className="import-source" open={importPlan.parameterized}>
                    <summary>LaTeX source</summary>
                    <textarea
                      aria-label="LaTeX source"
                      className="code-textarea"
                      rows={12}
                      value={importContent}
                      onChange={(e) => setImportContent(e.target.value)}
                      spellCheck={false}
                    />
                    {!importPlan.parameterized && (
                      <p className="field-hint">Changing a section or field above rebuilds this source.</p>
                    )}
                  </details>
                </div>
              )}

              {importError && (
                <p className="form-error" role="alert">
                  {importError}
                </p>
              )}
            </div>
            <div className="dialog-foot">
              <button type="button" className="btn" onClick={() => setView({ kind: "list" })}>
                Cancel
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
