import { ReviewRow } from "../utils/aiReview";

interface AiReviewProps {
  rows: ReviewRow[];
  error: string | null;
  onToggle: (id: string) => void;
}

/** Original and suggested wording side by side; the user decides what to keep. */
function AiReview({ rows, error, onToggle }: AiReviewProps) {
  if (error) {
    return (
      <p className="setup-error" role="alert">
        {error} You can still create the resume without AI changes.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p role="status">The AI didn't suggest any changes. Your bullets are already in good shape.</p>;
  }
  return (
    <>
      <p className="muted">
        Tick the changes you want. Suggestions that add a number or tool your original didn't mention start unticked, so only keep them if they're true.
      </p>
      <ul className="review-list" aria-label="Suggested changes">
        {rows.map((row) => (
          <li key={row.id} className="review-row">
            <label className="check-row">
              <input type="checkbox" checked={row.use} onChange={() => onToggle(row.id)} aria-label={`Use suggestion: ${row.suggestion}`} />
              <span className="review-text">
                <span className="review-original">{row.original}</span>
                <span className="review-suggestion">{row.suggestion}</span>
                {row.flags.length > 0 && (
                  <span className="review-flag">Adds something not in your original: {row.flags.join(", ")}</span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

export default AiReview;
