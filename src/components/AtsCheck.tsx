import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDialog } from "../hooks/useDialog";
import { AtsFinding, checkLatexSource, checkPdfText, summarizeAts } from "../utils/ats";
import { ResumePersonalInfo } from "../types";
import { IconX } from "./Icons";

interface AtsCheckProps {
  documentId: string;
  latexSource: string;
  personal: ResumePersonalInfo;
  onClose: () => void;
}

const MARK: Record<AtsFinding["status"], { symbol: string; label: string }> = {
  pass: { symbol: "✓", label: "Passed" },
  warn: { symbol: "!", label: "Warning" },
  fail: { symbol: "✕", label: "Problem" },
};

function AtsCheck({ documentId, latexSource, personal, onClose }: AtsCheckProps) {
  const [findings, setFindings] = useState<AtsFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base64 = await invoke<string>("read_pdf_bytes", { id: documentId });
        const { extractPdfText } = await import("../utils/pdfRenderer");
        const { text, pages } = await extractPdfText(base64);
        if (cancelled) return;
        setFindings([...checkPdfText(text, pages, { name: personal.name }), ...checkLatexSource(latexSource)]);
      } catch (err) {
        if (!cancelled) setError(`The PDF couldn't be checked: ${err}. Update the preview and try again.`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId, latexSource, personal.name]);

  const summary = findings ? summarizeAts(findings) : null;
  const order: Record<AtsFinding["status"], number> = { fail: 0, warn: 1, pass: 2 };
  const sorted = findings ? [...findings].sort((a, b) => order[a.status] - order[b.status]) : [];

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="ats-title" tabIndex={-1}>
        <div className="dialog-head">
          <h2 id="ats-title">ATS check</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="dialog-body">
          {!findings && !error && (
            <p className="muted" role="status">
              Reading your PDF the way an applicant tracking system would…
            </p>
          )}
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
          {summary && (
            <>
              <p className={`ats-verdict ats-${summary.verdict === "Ready" ? "pass" : summary.verdict === "Not ready" ? "fail" : "warn"}`}>
                <strong>{summary.verdict}</strong>: {summary.passed} of {summary.total} checks passed.
              </p>
              <p className="muted">
                This reads the PDF's text the way most parsers do. Systems differ, so treat it as a strong hint, not a guarantee.
              </p>
              <ul className="ats-list" aria-label="Checks">
                {sorted.map((f) => (
                  <li key={f.id} className={`ats-item ats-${f.status}`}>
                    <span className="ats-mark" role="img" aria-label={MARK[f.status].label}>
                      {MARK[f.status].symbol}
                    </span>
                    <span className="ats-text">
                      <span className="ats-title">{f.title}</span>
                      <span className="ats-detail">{f.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default AtsCheck;
