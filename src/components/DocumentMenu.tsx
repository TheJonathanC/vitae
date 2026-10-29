import { Document } from "../types";
import { useDialog } from "../hooks/useDialog";
import { IconPlus, IconTrash, IconCheck } from "./Icons";

interface DocumentMenuProps {
  documents: Document[];
  currentDocument: Document | null;
  onSelectDocument: (id: string) => void;
  onCreateDocument: () => void;
  onDeleteDocument: (id: string) => void;
  onClose: () => void;
}

const editedFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatEdited(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `Edited ${editedFormatter.format(date)}`;
}

/** Popover under the document title for switching, creating and deleting resumes. */
function DocumentMenu({
  documents,
  currentDocument,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onClose,
}: DocumentMenuProps) {
  const menuRef = useDialog<HTMLDivElement>(onClose);

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={menuRef}
        className="document-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-menu-title"
        tabIndex={-1}
      >
        <div className="document-menu-head">
          <h2 id="document-menu-title">Your resumes</h2>
          <button type="button" className="btn btn-small" onClick={onCreateDocument}>
            <IconPlus size={14} />
            New resume
          </button>
        </div>

        {documents.length === 0 ? (
          <p className="document-menu-empty">No resumes yet. Create one to get started.</p>
        ) : (
          <ul className="document-list">
            {documents.map((doc) => {
              const isActive = currentDocument?.id === doc.id;
              return (
                <li key={doc.id} className={`document-row ${isActive ? "active" : ""}`}>
                  <button
                    type="button"
                    className="document-open"
                    onClick={() => onSelectDocument(doc.id)}
                    aria-current={isActive ? "true" : undefined}
                    data-autofocus={isActive ? true : undefined}
                  >
                    <span className="document-check" aria-hidden="true">
                      {isActive && <IconCheck size={14} />}
                    </span>
                    <span className="document-text">
                      <span className="document-name">{doc.title}</span>
                      <span className="document-edited">{formatEdited(doc.updated_at)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-button document-delete"
                    title="Delete document"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => onDeleteDocument(doc.id)}
                  >
                    <IconTrash size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}

export default DocumentMenu;
