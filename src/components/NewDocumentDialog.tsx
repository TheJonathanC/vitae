import { useMemo, useState } from "react";
import { useDialog } from "../hooks/useDialog";
import { useDetails } from "../hooks/useDetails";
import { buildResumeData, defaultProfileSpec } from "../utils/library";
import { getEmptyResumeData } from "../utils/templateEngine";
import { ResumeData, Template } from "../types";
import { IconX } from "./Icons";

export interface NewResumeOptions {
  title: string;
  templateId: string;
  resumeData: ResumeData;
}

interface NewDocumentDialogProps {
  templates: Template[];
  onCreate: (options: NewResumeOptions) => void;
  onCancel: () => void;
  onOpenDetails: () => void;
}

const BLANK = "blank";
const EVERYTHING = "everything";

/** In-app replacement for window.prompt(), which not every webview implements. */
function NewDocumentDialog({ templates, onCreate, onCancel, onOpenDetails }: NewDocumentDialogProps) {
  const details = useDetails();
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [source, setSource] = useState<string | null>(null);
  const dialogRef = useDialog<HTMLFormElement>(onCancel);
  const trimmed = title.trim();

  const hasDetails = !!details.person.name || Object.values(details.library).some((items) => items.length > 0);
  // Until the user picks, start from their first profile, else everything they've saved.
  const selected = source ?? (details.profiles[0]?.id ?? (hasDetails ? EVERYTHING : BLANK));

  const build = useMemo(
    () => (): ResumeData => {
      if (selected === BLANK) return getEmptyResumeData();
      const profile = details.profiles.find((p) => p.id === selected);
      return buildResumeData(details.person, details.library, profile ?? defaultProfileSpec(details.library));
    },
    [selected, details.profiles, details.person, details.library]
  );

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        ref={dialogRef}
        className="dialog dialog-narrow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-document-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && templateId) onCreate({ title: trimmed, templateId, resumeData: build() });
        }}
        data-testid="new-document-dialog"
      >
        <div className="dialog-head">
          <h2 id="new-document-title">New resume</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="new-document-name">Name</label>
            <input
              id="new-document-name"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Product designer, 2026"
              aria-describedby="new-document-hint"
              data-autofocus
              maxLength={200}
            />
            <p className="field-hint" id="new-document-hint">
              Only you see this. It helps you tell your resumes apart.
            </p>
          </div>

          <div className="field">
            <label htmlFor="new-document-source">Start from</label>
            <select id="new-document-source" value={selected} onChange={(e) => setSource(e.target.value)}>
              <option value={BLANK}>A blank resume</option>
              {hasDetails && <option value={EVERYTHING}>Everything I've saved</option>}
              {details.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  Profile: {p.name}
                </option>
              ))}
            </select>
            {!hasDetails && !details.loading && (
              <p className="field-hint">
                Save your details once and new resumes can start filled in.{" "}
                <button type="button" className="link-button" onClick={onOpenDetails}>
                  Set up my details
                </button>
              </p>
            )}
          </div>

          {templates.length > 1 && (
            <div className="field">
              <label htmlFor="new-document-template">Template</label>
              <select id="new-document-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!trimmed || !templateId}>
            Create resume
          </button>
        </div>
      </form>
    </div>
  );
}

export default NewDocumentDialog;
