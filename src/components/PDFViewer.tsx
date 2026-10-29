import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import type { RenderedPage } from "../utils/pdfRenderer";

interface PDFViewerProps {
  /** Document whose compiled PDF to show; null shows the placeholder. */
  documentId: string | null;
  /** Changes on every successful compile so the preview reloads. */
  revision: number;
  isCompiling?: boolean;
  /** What the empty mat says (depends on why there's no PDF yet). */
  emptyMessage?: string;
}

/** US Letter is the widest common page; keep the sheet readable, not huge. */
const MAX_PAGE_WIDTH = 820;
const MAT_PADDING = 48;

/**
 * Shows the compiled PDF as sheets of paper on the mat. Pages are rendered
 * with PDF.js; if that fails (or isn't available), the webview's own PDF
 * viewer is used through an iframe instead.
 */
function PDFViewer({
  documentId,
  revision,
  isCompiling = false,
  emptyMessage = "Your resume will appear here.",
}: PDFViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [pages, setPages] = useState<RenderedPage[] | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(0);

  // Fetch the compiled PDF whenever a new build lands
  useEffect(() => {
    let isCancelled = false;

    if (!documentId) {
      setBase64(null);
      setPages(null);
      setUseFallback(false);
      setError(null);
      return;
    }

    // The backend returns base64 and takes a document id, never a path.
    invoke<string>("read_pdf_bytes", { id: documentId })
      .then((data) => {
        if (isCancelled) return;
        if (!data) throw new Error("The compiled PDF is empty");
        setBase64(data);
        setError(null);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("Failed to load PDF:", err);
        setError(`The preview couldn't be loaded: ${err}`);
        setBase64(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [documentId, revision]);

  // Fit the page to the available width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const available = el.clientWidth - MAT_PADDING * 2;
      // Round to 40px steps so dragging the splitter doesn't re-render constantly
      const width = Math.max(240, Math.min(MAX_PAGE_WIDTH, Math.floor(available / 40) * 40));
      setPageWidth(width);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Render pages; keep showing the previous ones until the new ones are ready
  useEffect(() => {
    if (!base64 || useFallback || pageWidth === 0) return;
    let isCancelled = false;

    import("../utils/pdfRenderer")
      .then(({ renderPdfPages }) => renderPdfPages(base64, pageWidth))
      .then((rendered) => {
        if (isCancelled) {
          rendered.forEach((p) => URL.revokeObjectURL(p.url));
          return;
        }
        setPages(rendered);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.warn("PDF.js rendering failed, using the built-in viewer:", err);
        setUseFallback(true);
      });

    return () => {
      isCancelled = true;
    };
  }, [base64, pageWidth, useFallback]);

  // Release page images when they're replaced or the viewer unmounts
  useEffect(() => {
    return () => pages?.forEach((p) => URL.revokeObjectURL(p.url));
  }, [pages]);

  const showPages = !!base64 && !useFallback && pages && pages.length > 0;
  const showFrame = !!base64 && useFallback;

  return (
    <div className="pdf-viewer" ref={containerRef}>
      {error ? (
        <div className="mat-message" role="alert">
          <p>{error}</p>
        </div>
      ) : showFrame ? (
        <iframe src={`data:application/pdf;base64,${base64}`} title="PDF Preview" />
      ) : showPages ? (
        <div
          className={`page-stack ${isCompiling ? "is-updating" : ""}`}
          aria-label="PDF Preview"
          role="document"
          data-testid="pdf-pages"
        >
          {pages!.map((page, idx) => (
            <img
              key={page.url}
              className="page"
              src={page.url}
              width={Math.round(page.width)}
              height={Math.round(page.height)}
              alt={`Page ${idx + 1} of ${pages!.length}`}
            />
          ))}
        </div>
      ) : (
        <div className="mat-message">
          <div className="empty-sheet" aria-hidden="true" />
          <p>{base64 ? "Preparing the preview…" : emptyMessage}</p>
        </div>
      )}
      {isCompiling && (showPages || showFrame) && (
        <span className="visually-hidden" role="status" data-testid="pdf-compiling-indicator">
          Updating preview
        </span>
      )}
    </div>
  );
}

export default PDFViewer;
