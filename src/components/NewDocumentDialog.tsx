import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDialog } from "../hooks/useDialog";
import { useDetails } from "../hooks/useDetails";
import { buildResumeData, defaultProfileSpec } from "../utils/library";
import { getEmptyResumeData } from "../utils/templateEngine";
import { ROLE_PRESETS, findRolePreset } from "../utils/rolePresets";
import { applyTargetPlan, buildTargetPlan, extractKeywords, KeywordStatus } from "../utils/targeting";
import { AiSettingsView, ResumeData, RewriteItem, Template } from "../types";
import { applyReview, collectBullets, makeReviewRows, ReviewRow } from "../utils/aiReview";
import AiReview from "./AiReview";
import { IconX } from "./Icons";

export interface NewResumeOptions {
  title: string;
  templateId: string;
  resumeData: ResumeData;
}

interface NewDocumentDialogProps {
  templates: Template[];
  onCreate: (options: NewResumeOptions) => void;
  onCancel: () => void;
  onOpenDetails: () => void;
}

const BLANK = "blank";
const EVERYTHING = "everything";
const MAX_JOB_TEXT = 20000;

const KEYWORD_GROUPS: { status: KeywordStatus["status"]; label: string; hint: string }[] = [
  { status: "used", label: "On your resume", hint: "Terms from the job that your resume now covers." },
  { status: "available", label: "In your details, left out", hint: "You have these saved but they didn't make the cut. Add them from the form if they matter." },
  { status: "missing", label: "Not in your details", hint: "The job asks for these and nothing you've saved mentions them. Add them only if they're true." },
];

/** In-app replacement for window.prompt(), which not every webview implements. */
function NewDocumentDialog({ templates, onCreate, onCancel, onOpenDetails }: NewDocumentDialogProps) {
  const details = useDetails();
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [source, setSource] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [jobText, setJobText] = useState("");
  const [headline, setHeadline] = useState("");
  const deferredJobText = useDeferredValue(jobText);
  const [ai, setAi] = useState<AiSettingsView | null>(null);
  const [improve, setImprove] = useState(false);
  const [step, setStep] = useState<"form" | "working" | "review">("form");
  const [pending, setPending] = useState<{ data: ResumeData; rows: ReviewRow[]; error: string | null } | null>(null);

  useEffect(() => {
    invoke<AiSettingsView>("ai_get_settings")
      .then((view) => setAi(view ?? null))
      .catch(() => setAi(null));
  }, []);
  const dialogRef = useDialog<HTMLFormElement>(onCancel);
  const trimmed = title.trim();

  const hasDetails = !!details.person.name || Object.values(details.library).some((items) => items.length > 0);
  // Until the user picks, start from their first profile, else everything they've saved.
  const selected = source ?? (details.profiles[0]?.id ?? (hasDetails ? EVERYTHING : BLANK));

  const profile = details.profiles.find((p) => p.id === selected);
  const baseSpec = useMemo(() => profile ?? defaultProfileSpec(details.library), [profile, details.library]);
  const preset = findRolePreset(role);
  const canTarget = selected !== BLANK;
  const wantsTarget = canTarget && (role !== "" || deferredJobText.trim() !== "");

  const plan = useMemo(() => {
    if (!wantsTarget) return null;
    const keywords = extractKeywords(deferredJobText, preset);
    return keywords.length === 0 ? null : buildTargetPlan(details.library, baseSpec, keywords);
  }, [wantsTarget, deferredJobText, preset, details.library, baseSpec]);

  const build = (): ResumeData => {
    if (selected === BLANK) return getEmptyResumeData();
    if (plan) return applyTargetPlan(details.person, details.library, plan, headline.trim() || profile?.headline || preset?.headline || undefined);
    return buildResumeData(details.person, details.library, { ...baseSpec, headline: headline.trim() || baseSpec.headline });
  };

  const aiReady = ai?.has_key === true && ai.model !== null;

  const create = (data: ResumeData) => onCreate({ title: trimmed, templateId, resumeData: data });

  /** Creates the resume, first asking the AI for wording suggestions when that's switched on. */
  const submit = async () => {
    if (!trimmed || !templateId) return;
    const data = build();
    const items = collectBullets(data);
    if (!(improve && plan && aiReady) || items.length === 0) {
      create(data);
      return;
    }
    setStep("working");
    try {
      const answers = await invoke<RewriteItem[]>("ai_rewrite", {
        jobText: jobText.trim(),
        role: preset?.name ?? (headline.trim() || null),
        items,
      });
      setPending({ data, rows: makeReviewRows(items, answers), error: null });
    } catch (err) {
      setPending({ data, rows: [], error: String(err) });
    }
    setStep("review");
  };

  const toggleRow = (id: string) =>
    setPending((current) => (current ? { ...current, rows: current.rows.map((r) => (r.id === id ? { ...r, use: !r.use } : r)) } : current));

  const counts = plan
    ? [
        ["experience", plan.spec.experienceIds.length, baseSpec.experienceIds.length],
        ["project", plan.spec.projectIds.length, baseSpec.projectIds.length],
      ]
    : [];

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <form
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-document-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "form") submit();
        }}
        data-testid="new-document-dialog"
      >
        <div className="dialog-head">
          <h2 id="new-document-title">New resume</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="dialog-body">
          {step === "working" && (
            <p role="status" className="muted">
              Asking {ai?.provider_name} to improve your bullets…
            </p>
          )}
          {step === "review" && pending && <AiReview rows={pending.rows} error={pending.error} onToggle={toggleRow} />}
          {step === "form" && (
            <>
              <div className="field">
                <label htmlFor="new-document-name">Name</label>
                <input
                  id="new-document-name"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Product designer, 2026"
                  aria-describedby="new-document-hint"
                  data-autofocus
                  maxLength={200}
                />
                <p className="field-hint" id="new-document-hint">
                  Only you see this. It helps you tell your resumes apart.
                </p>
              </div>

              <div className="field">
                <label htmlFor="new-document-source">Start from</label>
                <select id="new-document-source" value={selected} onChange={(e) => setSource(e.target.value)}>
                  <option value={BLANK}>A blank resume</option>
                  {hasDetails && <option value={EVERYTHING}>Everything I've saved</option>}
                  {details.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      Profile: {p.name}
                    </option>
                  ))}
                </select>
                {!hasDetails && !details.loading && (
                  <p className="field-hint">
                    Save your details once and new resumes can start filled in.{" "}
                    <button type="button" className="link-button" onClick={onOpenDetails}>
                      Set up my details
                    </button>
                  </p>
                )}
              </div>

              <details className="target-section" open={wantsTarget || undefined}>
                <summary>Tailor to a job (optional)</summary>
                {!canTarget ? (
                  <p className="field-hint">Choose a profile or "Everything I've saved" above to tailor it to a job.</p>
                ) : (
                  <>
                    <p className="field-hint">
                      Vitae picks the entries and bullets that fit the job best. It only chooses from what you've saved and never writes new claims.
                    </p>
                    <div className="field">
                      <label htmlFor="target-role">Role</label>
                      <select id="target-role" value={role} onChange={(e) => setRole(e.target.value)}>
                        <option value="">No specific role</option>
                        {ROLE_PRESETS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="target-job">Job description</label>
                      <textarea
                        id="target-job"
                        rows={6}
                        value={jobText}
                        maxLength={MAX_JOB_TEXT}
                        onChange={(e) => setJobText(e.target.value)}
                        placeholder="Paste the job posting here"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="target-headline">Headline on the resume</label>
                      <input
                        id="target-headline"
                        type="text"
                        value={headline}
                        onChange={(e) => setHeadline(e.target.value)}
                        placeholder={profile?.headline || preset?.headline || "Backend Engineer"}
                      />
                    </div>
                    {plan && (
                      <div className="target-result" role="region" aria-label="Match preview">
                        <p>
                          <strong>{plan.coverage}%</strong> of the job's key terms are on this resume.
                        </p>
                        <p className="muted">
                          Using {counts.map(([kind, used, total]) => `${used} of ${total} ${kind === "experience" ? (total === 1 ? "role" : "roles") : total === 1 ? "project" : "projects"}`).join(" and ")}.
                        </p>
                        {KEYWORD_GROUPS.map(({ status, label, hint }) => {
                          const terms = plan.keywords.filter((k) => k.status === status);
                          if (terms.length === 0) return null;
                          return (
                            <div key={status} className="keyword-group">
                              <h3 title={hint}>{label}</h3>
                              <ul className={`keyword-chips keyword-${status}`} aria-label={label}>
                                {terms.map((k) => (
                                  <li key={k.term}>{k.term}</li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  {plan && (aiReady ? (
                    <>
                      <label className="check-row">
                        <input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} />
                        Improve the wording with AI ({ai?.model})
                      </label>
                      <p className="field-hint">
                        Sends the bullets on this resume and the job description to {ai?.provider_name}. You review every change before it's used.
                      </p>
                    </>
                  ) : (
                    <p className="field-hint">Want AI to polish the wording? Add an API key in Settings.</p>
                  ))}
                  </>
                )}
              </details>

              {templates.length > 1 && (
                <div className="field">
                  <label htmlFor="new-document-template">Template</label>
                  <select id="new-document-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>
        <div className="dialog-foot">
          {step === "review" && pending ? (
            <>
              <button type="button" className="btn" onClick={() => setStep("form")}>
                Back
              </button>
              <button type="button" className="btn" onClick={() => create(pending.data)}>
                Create without AI changes
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => create(applyReview(pending.data, pending.rows))}
                disabled={pending.rows.length === 0 || !pending.rows.some((r) => r.use)}
              >
                Use selected changes
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={onCancel} disabled={step === "working"}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={!trimmed || !templateId || step === "working"}>
                {step === "working" ? "Working…" : "Create resume"}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

export default NewDocumentDialog;
