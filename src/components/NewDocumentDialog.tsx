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
    <div className="setup-overlay" onClick={onCancel}>
      <form
        ref={dialogRef}
        className="setup-modal new-document-modal"
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
        <div className="setup-header">
          <h2 id="new-document-title">New document</h2>
          <button type="button" className="settings-close-btn" onClick={onCancel} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>
        <div className="setup-content">
          <div className="form-group">
            <label htmlFor="new-document-name">Document title</label>
            <input
              id="new-document-name"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Software Engineer Resume 2026"
              data-autofocus
              maxLength={200}
            />
          </div>
        </div>
        <div className="setup-footer">
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!trimmed}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

export default NewDocumentDialog;
