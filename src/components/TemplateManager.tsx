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
import { IconUpload, IconTrash, IconX, IconCheck, IconChevronLeft } from "./Icons";

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
  return (
    <li className="import-section" data-testid={`import-section-${section.id}`}>
      <div className="import-section-head">
        <div>
          <h4>{section.heading}</h4>
          <p className="muted">{facts.filter(Boolean).join(" · ")}</p>
        </div>
        <div className="field import-section-mapping">
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
              <th scope="col">Text in the file</th>
              <th scope="col">Form field</th>
            </tr>
          </thead>
          <tbody>
            {section.slots.map((slot) => {
              const sample = slot.samples.find(Boolean) || "";
              const id = `${selectId}-${slot.id}`;
              return (
                <tr key={slot.id}>
                  <td>
                    <label htmlFor={id} className="import-sample" title={sample}>
                      {sample}
                    </label>
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
      {section.shape === "paragraph" && section.mapping !== "keep" && (
        <p className="import-preview">{section.preview}</p>
      )}
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
              <p className="dialog-lead">
                Vitae finds your contact details and each section of the file, and links the text in them to the
                form. Check what each section and field became. Files that already use{" "}
                <code>{"{{placeholders}}"}</code> are imported as they are.
              </p>

              {!importContent && !importError && <p className="muted">Reading {importFileName}…</p>}

              {importContent && importPlan && (
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

                  {!importPlan.parameterized && (
                    <div className="detected">
                      <h3>Contact details</h3>
                      {detected.length > 0 ? (
                        <dl>
                          {detected.map(([key, value]) => (
                            <div key={key}>
                              <dt>{DETECTED_LABELS[key] || key}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="muted">No contact details were found; the header keeps the file's text.</p>
                      )}
                    </div>
                  )}

                  {!importPlan.parameterized && (
                    <div className="detected">
                      <h3>Sections</h3>
                      {importPlan.sections.length > 0 ? (
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
                      ) : (
                        <p className="muted">
                          No sections were found (Vitae looks for <code>\section</code>-style headings), so the body
                          keeps the file's text.
                        </p>
                      )}
                      {(detected.length > 0 || importPlan.sections.some((s) => s.mapping !== "keep")) && (
                        <p className="muted">What's found fills any of your details and sections that are still empty.</p>
                      )}
                    </div>
                  )}

                  {match !== null && (
                    <p className={match < 0.9 ? "import-match warn" : "import-match"} data-testid="import-match">
                      {match >= 0.995
                        ? "With what was found, the new template prints all of the file's text."
                        : `With what was found, the new template prints ${Math.round(match * 100)}% of the file's text.`}
                      {match < 0.9 && " Some entries are laid out differently from the first one; check the preview after saving."}
                    </p>
                  )}

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
                    {!importPlan.parameterized && (
                      <p className="field-hint">Changing a section or field above rebuilds this source.</p>
                    )}
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
