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
    <div className={`sidebar ${collapsed ? "collapsed" : ""}`}>
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
          <div className="document-list">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className={`document-item ${
                  currentDocument?.id === doc.id ? "active" : ""
                }`}
                onClick={() => onSelectDocument(doc.id)}
              >
                <div className="document-item-main">
                  <IconFile size={14} className="document-icon" />
                  <div className="document-info">
                    <div className="document-title">{doc.title}</div>
                    <div className="document-meta">
                      {new Date(doc.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <button
                  className="btn-delete"
                  title="Delete document"
                  aria-label="Delete document"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteDocument(doc.id);
                  }}
                >
                  <IconTrash size={14} />
                </button>
              </div>
            ))}
            {documents.length === 0 && (
              <div className="empty-state">
                No documents yet. Create your first document!
              </div>
            )}
          </div>
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
    </div>
  );
}

export default Sidebar;
