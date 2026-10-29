import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";

interface PDFViewerProps {
  /** Document whose compiled PDF to show; null shows the placeholder. */
  documentId: string | null;
  /** Changes on every successful compile so the preview reloads. */
  revision: number;
  isCompiling?: boolean;
}

function PDFViewer({ documentId, revision, isCompiling = false }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!documentId) {
      setPdfUrl(null);
      setError(null);
      return;
    }

    // The backend returns base64, which goes straight into a data: URL. This
    // avoids WebView2's custom-protocol "asset.localhost refused to connect"
    // error on Windows and needs no filesystem access from the webview.
    invoke<string>("read_pdf_bytes", { id: documentId })
      .then((base64) => {
        if (isCancelled) return;
        if (!base64) throw new Error("Compiled PDF is empty");
        setPdfUrl(`data:application/pdf;base64,${base64}`);
        setError(null);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("Failed to load PDF:", err);
        setError(`Failed to load PDF: ${err}`);
        setPdfUrl(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [documentId, revision]);

  if (error) {
    return (
      <div className="pdf-placeholder">
        <div className="placeholder-content">
          <p className="pdf-error" role="alert">
            {error}
          </p>
        </div>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="pdf-placeholder">
        <div className="placeholder-content">
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p>
            {isCompiling
              ? "Compiling your document..."
              : "Click Compile (or turn on Auto) to preview the PDF"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {isCompiling && (
        <div className="pdf-compiling-badge" data-testid="pdf-compiling-indicator" role="status">
          <span className="compiling-dot" />
          <span>Updating preview...</span>
        </div>
      )}
      <iframe src={pdfUrl} title="PDF Preview" />
    </div>
  );
}

export default PDFViewer;
