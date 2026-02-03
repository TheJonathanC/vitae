interface Document {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

interface SidebarProps {
  documents: Document[];
  currentDocument: Document | null;
  onSelectDocument: (id: string) => void;
  onCreateDocument: () => void;
  onDeleteDocument: (id: string) => void;
}

function Sidebar({
  documents,
  currentDocument,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
}: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>Documents</h2>
        <button onClick={onCreateDocument} className="btn-new">
          + New
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
            <div className="document-title">{doc.title}</div>
            <div className="document-meta">
              {new Date(doc.updated_at).toLocaleDateString()}
            </div>
            <button
              className="btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteDocument(doc.id);
              }}
            >
              🗑️
            </button>
          </div>
        ))}
        {documents.length === 0 && (
          <div className="empty-state">
            No documents yet. Create your first document!
          </div>
        )}
      </div>
    </div>
  );
}

export default Sidebar;
