import { useEffect, useRef } from "react";
import { LatexError } from "../types";
import { IconX } from "./Icons";

type BuildResult =
  | { kind: "ok"; warnings: LatexError[] }
  | { kind: "failed"; errors: LatexError[]; warnings: LatexError[] }
  | { kind: "error"; message: string };

interface BuildDetailsProps {
  result: BuildResult;
  onClose: () => void;
  onOpenSource: () => void;
}

function IssueList({ issues, tone }: { issues: LatexError[]; tone: "error" | "warning" }) {
  return (
    <ul className={`issue-list issue-${tone}`}>
      {issues.map((issue, idx) => (
        <li key={`${issue.line}-${idx}`}>
          <span className="issue-line">{issue.line ? `Line ${issue.line}` : "General"}</span>
          <span className="issue-message">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sheet over the preview listing what went wrong in the last build. */
function BuildDetails({ result, onClose, onOpenSource }: BuildDetailsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const errors = result.kind === "failed" ? result.errors : [];
  const warnings = result.kind === "error" ? [] : result.warnings;
  const hasLines = [...errors, ...warnings].some((issue) => issue.line);

  return (
    <section className="build-details" aria-labelledby="build-details-title">
      <div className="build-details-head">
        <h2 id="build-details-title" tabIndex={-1} ref={headingRef}>
          {result.kind === "ok" ? "Built with warnings" : "Why the PDF couldn't be built"}
        </h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close details">
          <IconX size={16} />
        </button>
      </div>

      <div className="build-details-body">
        {result.kind === "error" && <p className="build-details-message">{result.message}</p>}
        {result.kind === "failed" && errors.length === 0 && (
          <p className="build-details-message">
            LaTeX stopped without reporting an error. Check the LaTeX source for problems.
          </p>
        )}
        {errors.length > 0 && (
          <>
            <h3>Errors</h3>
            <IssueList issues={errors} tone="error" />
          </>
        )}
        {warnings.length > 0 && (
          <>
            <h3>Warnings</h3>
            <IssueList issues={warnings} tone="warning" />
          </>
        )}
      </div>

      {hasLines && (
        <div className="build-details-foot">
          <p>Lines with problems are marked in the LaTeX source.</p>
          <button type="button" className="btn" onClick={onOpenSource}>
            Open LaTeX source
          </button>
        </div>
      )}
    </section>
  );
}

export default BuildDetails;
