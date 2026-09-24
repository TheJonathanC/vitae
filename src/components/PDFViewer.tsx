import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { readBinaryFile } from "@tauri-apps/api/fs";

interface PDFViewerProps {
  pdfPath: string | null;
  isCompiling?: boolean;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function PDFViewer({ pdfPath, isCompiling = false }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    if (!pdfPath) {
      setPdfUrl(null);
      setError(null);
      return;
    }

    const loadPdf = async () => {
      try {
        const cleanPath = typeof pdfPath === "string" ? pdfPath.trim().split("?")[0] : pdfPath;

        // 1. Try reading PDF bytes directly via backend command or fs API.
        // Rendering via data: URL avoids WebView2 custom-protocol ERR_CONNECTION_REFUSED
        // ("asset.localhost refused to connect") on Windows when loading PDFs inside an iframe.
        let bytes: Uint8Array | null = null;
        try {
          const res = await invoke<number[] | Uint8Array>("read_pdf_bytes", { path: cleanPath });
          if (res) {
            bytes = new Uint8Array(res);
          }
        } catch {
          try {
            const fsRes = await readBinaryFile(cleanPath);
            if (fsRes) {
              bytes = new Uint8Array(fsRes);
            }
          } catch {
            // Neither binary reader succeeded (or running in mock/web/test environment)
          }
        }

        if (isCancelled) return;

        if (bytes && bytes.length > 0) {
          const base64 = uint8ArrayToBase64(bytes);
          setPdfUrl(`data:application/pdf;base64,${base64}`);
          setError(null);
          return;
        }

        // 2. Fallback to convertFileSrc
        const assetUrl = convertFileSrc(cleanPath);
        setPdfUrl(`${assetUrl}?t=${Date.now()}`);
        setError(null);
      } catch (err) {
        if (!isCancelled) {
          console.error("Failed to load PDF:", err);
          setError(`Failed to load PDF: ${err}`);
          setPdfUrl(null);
        }
      }
    };

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [pdfPath]);

  if (error) {
    return (
      <div className="pdf-placeholder">
        <div className="placeholder-content">
          <p style={{ color: "#f48771" }}>{error}</p>
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
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <p>Compile your LaTeX document to preview the PDF</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer">
      {isCompiling && (
        <div className="pdf-compiling-badge" data-testid="pdf-compiling-indicator">
          <span className="compiling-dot" />
          <span>Updating preview...</span>
        </div>
      )}
      <iframe src={pdfUrl} title="PDF Preview" />
    </div>
  );
}

export default PDFViewer;
