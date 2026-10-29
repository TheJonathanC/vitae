import { useState } from "react";
import { useDialog } from "../hooks/useDialog";
import { IconX } from "./Icons";

interface NewDocumentDialogProps {
  onCreate: (title: string) => void;
  onCancel: () => void;
}

/** In-app replacement for window.prompt(), which not every webview implements. */
function NewDocumentDialog({ onCreate, onCancel }: NewDocumentDialogProps) {
  const [title, setTitle] = useState("");
  const dialogRef = useDialog<HTMLFormElement>(onCancel);
  const trimmed = title.trim();

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
          if (trimmed) onCreate(trimmed);
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
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!trimmed}>
            Create resume
          </button>
        </div>
      </form>
    </div>
  );
}

export default NewDocumentDialog;
