import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { readBinaryFile } from "@tauri-apps/api/fs";

interface PDFViewerProps {
  pdfPath: string | null;
}

function PDFViewer({ pdfPath }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadPdf = async () => {
      if (pdfPath) {
        try {
          // Read the PDF file as binary
          const pdfData = await readBinaryFile(pdfPath);
          // Convert to base64
          const base64 = btoa(
            new Uint8Array(pdfData).reduce(
              (data, byte) => data + String.fromCharCode(byte),
              ""
            )
          );
          // Create data URL
          const dataUrl = `data:application/pdf;base64,${base64}`;
          setPdfUrl(dataUrl);
          setError(null);
        } catch (err) {
          console.error("Failed to load PDF:", err);
          setError(`Failed to load PDF: ${err}`);
          setPdfUrl(null);
        }
      } else {
        setPdfUrl(null);
        setError(null);
      }
    };

    loadPdf();
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
      <iframe src={pdfUrl} title="PDF Preview" />
    </div>
  );
}

export default PDFViewer;
