import { Document } from "../types";
import {
  IconPlus,
  IconTrash,
  IconChevronLeft,
  IconChevronRight,
  IconFile,
} from "./Icons";

interface SidebarProps {
  documents: Document[];
  currentDocument: Document | null;
  onSelectDocument: (id: string) => void;
  onCreateDocument: () => void;
  onDeleteDocument: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function Sidebar({
  documents,
  currentDocument,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar ${collapsed ? "collapsed" : ""}`}
      aria-label="Documents"
    >
      {!collapsed && (
        <>
          <div className="sidebar-header">
            <button
              className="sidebar-toggle"
              onClick={onToggleCollapse}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <IconChevronLeft size={16} />
            </button>
            <h2>Documents</h2>
            <button
              onClick={onCreateDocument}
              className="btn-new"
              title="Create new document"
              aria-label="Create new document"
            >
              <IconPlus size={14} />
              <span>New</span>
            </button>
          </div>
          <ul className="document-list">
            {documents.map((doc) => {
              const isActive = currentDocument?.id === doc.id;
              return (
                <li key={doc.id} className={`document-item ${isActive ? "active" : ""}`}>
                  <button
                    type="button"
                    className="document-item-main"
                    onClick={() => onSelectDocument(doc.id)}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <IconFile size={14} className="document-icon" />
                    <span className="document-info">
                      <span className="document-title">{doc.title}</span>
                      <span className="document-meta">
                        {new Date(doc.updated_at).toLocaleDateString()}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-delete"
                    title="Delete document"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => onDeleteDocument(doc.id)}
                  >
                    <IconTrash size={14} />
                  </button>
                </li>
              );
            })}
            {documents.length === 0 && (
              <li className="empty-state">
                No documents yet. Create your first document!
              </li>
            )}
          </ul>
        </>
      )}
      {collapsed && (
        <button
          className="sidebar-toggle-collapsed"
          onClick={onToggleCollapse}
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <IconChevronRight size={16} />
        </button>
      )}
    </aside>
  );
}

export default Sidebar;
