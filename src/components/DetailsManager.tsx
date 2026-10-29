import { useMemo, useState } from "react";
import { useDialog } from "../hooks/useDialog";
import { useDetails } from "../hooks/useDetails";
import { defaultProfileSpec } from "../utils/library";
import {
  Document,
  Library,
  LibraryKind,
  Profile,
  ProfileSpec,
  ResumeData,
  ResumePersonalInfo,
} from "../types";
import { normalizeResumeData } from "../utils/templateEngine";
import { IconX } from "./Icons";

interface DetailsManagerProps {
  documents: Document[];
  onClose: () => void;
}

type Tab = "personal" | LibraryKind | "profiles";

const TABS: { id: Tab; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "experience", label: "Experience" },
  { id: "project", label: "Projects" },
  { id: "education", label: "Education" },
  { id: "skill", label: "Skills" },
  { id: "profiles", label: "Profiles" },
];

interface FieldConfig {
  key: string;
  label: string;
  type: "text" | "area" | "lines";
  placeholder?: string;
  hint?: string;
}

const PERSONAL_FIELDS: FieldConfig[] = [
  { key: "name", label: "Full name", type: "text" },
  { key: "title", label: "Default headline", type: "text", placeholder: "Software Engineer" },
  { key: "email", label: "Email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "location", label: "Location", type: "text", placeholder: "Austin, TX" },
  { key: "website", label: "Website", type: "text" },
  { key: "linkedin", label: "LinkedIn", type: "text", placeholder: "linkedin.com/in/you" },
  { key: "github", label: "GitHub", type: "text", placeholder: "github.com/you" },
  { key: "summary", label: "Default summary", type: "area", hint: "Profiles can replace this with their own." },
];

const ITEM_FIELDS: Record<LibraryKind, { singular: string; fields: FieldConfig[]; required: string[] }> = {
  experience: {
    singular: "experience",
    required: ["role", "company"],
    fields: [
      { key: "role", label: "Job title", type: "text" },
      { key: "company", label: "Company", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "startDate", label: "Start", type: "text", placeholder: "Jan 2022" },
      { key: "endDate", label: "End", type: "text", placeholder: "Present" },
      { key: "bullets", label: "What you did", type: "lines", hint: "One achievement per line. Add as many as you like; profiles and job targets pick the best ones." },
    ],
  },
  project: {
    singular: "project",
    required: ["name"],
    fields: [
      { key: "name", label: "Project name", type: "text" },
      { key: "technologies", label: "Technologies", type: "text", placeholder: "React, Rust, SQLite" },
      { key: "link", label: "Link", type: "text" },
      { key: "bullets", label: "What it does", type: "lines", hint: "One point per line." },
    ],
  },
  education: {
    singular: "education entry",
    required: ["degree", "institution"],
    fields: [
      { key: "degree", label: "Degree", type: "text" },
      { key: "institution", label: "School", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "startDate", label: "Start", type: "text" },
      { key: "endDate", label: "End", type: "text" },
      { key: "details", label: "Details", type: "area", hint: "Honors, GPA, relevant coursework." },
    ],
  },
  skill: {
    singular: "skill group",
    required: ["category"],
    fields: [
      { key: "category", label: "Group", type: "text", placeholder: "Languages" },
      { key: "skills", label: "Skills", type: "text", placeholder: "TypeScript, Go, SQL", hint: "Separate with commas." },
    ],
  },
};

type Draft = Record<string, string>;

function toDraft(fields: FieldConfig[], item: object): Draft {
  const record = item as Record<string, unknown>;
  const draft: Draft = {};
  for (const f of fields) {
    const value = record[f.key];
    draft[f.key] = f.type === "lines" ? (Array.isArray(value) ? value.join("\n") : "") : typeof value === "string" ? value : "";
  }
  return draft;
}

function fromDraft(fields: FieldConfig[], draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    out[f.key] =
      f.type === "lines"
        ? draft[f.key].split("\n").map((l) => l.trim()).filter(Boolean)
        : draft[f.key].trim();
  }
  return out;
}

function summarize(kind: LibraryKind, item: Record<string, unknown>): { title: string; meta: string } {
  const text = (k: string) => (typeof item[k] === "string" ? (item[k] as string) : "");
  const bullets = Array.isArray(item.bullets) ? item.bullets.length : 0;
  const dates = [text("startDate"), text("endDate")].filter(Boolean).join(" – ");
  switch (kind) {
    case "experience":
      return { title: [text("role"), text("company")].filter(Boolean).join(" · ") || "Untitled", meta: [dates, `${bullets} points`].filter(Boolean).join(" · ") };
    case "project":
      return { title: text("name") || "Untitled", meta: [text("technologies"), `${bullets} points`].filter(Boolean).join(" · ") };
    case "education":
      return { title: [text("degree"), text("institution")].filter(Boolean).join(" · ") || "Untitled", meta: dates };
    case "skill":
      return { title: text("category") || "Untitled", meta: text("skills") };
  }
}

function FieldInputs({ fields, draft, onChange, idPrefix }: { fields: FieldConfig[]; draft: Draft; onChange: (key: string, value: string) => void; idPrefix: string }) {
  return (
    <>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        return (
          <div className="field" key={f.key}>
            <label htmlFor={id}>{f.label}</label>
            {f.type === "text" ? (
              <input id={id} type="text" value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : (
              <textarea id={id} rows={f.type === "lines" ? 6 : 3} value={draft[f.key]} placeholder={f.placeholder} onChange={(e) => onChange(f.key, e.target.value)} />
            )}
            {f.hint && <p className="field-hint">{f.hint}</p>}
          </div>
        );
      })}
    </>
  );
}

function PersonalTab({ person, onSave }: { person: ResumePersonalInfo; onSave: (next: ResumePersonalInfo) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(PERSONAL_FIELDS, person));
  const [status, setStatus] = useState<string | null>(null);
  const save = async () => {
    setStatus(null);
    try {
      await onSave(fromDraft(PERSONAL_FIELDS, draft) as unknown as ResumePersonalInfo);
      setStatus("Saved. New resumes use these details.");
    } catch (err) {
      setStatus(String(err));
    }
  };
  return (
    <div className="details-pane">
      <p className="muted">These stay the same on every resume.</p>
      <FieldInputs fields={PERSONAL_FIELDS} draft={draft} idPrefix="person" onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
      <div className="setup-actions">
        <button type="button" className="btn btn-primary" onClick={save} disabled={!draft.name.trim()}>
          Save personal details
        </button>
      </div>
      {status && <p className="update-status" role="status">{status}</p>}
    </div>
  );
}

function ItemsTab({ kind, library, onSave, onDelete }: {
  kind: LibraryKind;
  library: Library;
  onSave: (kind: LibraryKind, id: string | null, fields: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const config = ITEM_FIELDS[kind];
  const items = library[kind] as unknown as ({ id: string } & Record<string, unknown>)[];
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requiredMissing = editing ? config.required.some((k) => !editing.draft[k]?.trim()) : true;

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      await onSave(kind, editing.id, fromDraft(config.fields, editing.draft));
      setEditing(null);
    } catch (err) {
      setError(String(err));
    }
  };
  const remove = async (id: string) => {
    setConfirming(null);
    try {
      await onDelete(id);
    } catch (err) {
      setError(String(err));
    }
  };

  if (editing) {
    return (
      <div className="details-pane">
        <h3>{editing.id ? `Edit ${config.singular}` : `Add ${config.singular}`}</h3>
        <FieldInputs fields={config.fields} draft={editing.draft} idPrefix={`item-${kind}`} onChange={(k, v) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [k]: v } } : e))} />
        {error && <p className="setup-error" role="alert">{error}</p>}
        <div className="setup-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={requiredMissing}>
            Save
          </button>
          <button type="button" className="btn" onClick={() => { setEditing(null); setError(null); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="details-pane">
      <div className="details-pane-head">
        <p className="muted">
          {items.length === 0
            ? `No ${config.singular}s yet. Add them here once and reuse them on any resume.`
            : `${items.length} saved. Choose which ones go on each resume in Profiles.`}
        </p>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setEditing({ id: null, draft: toDraft(config.fields, {}) })}>
          Add {config.singular}
        </button>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <ul className="item-list" aria-label={`Saved ${config.singular}s`}>
        {items.map((item) => {
          const { title, meta } = summarize(kind, item);
          return (
            <li key={item.id} className="item-row">
              <div className="item-text">
                <span className="item-title">{title}</span>
                {meta && <span className="item-meta">{meta}</span>}
              </div>
              <div className="item-actions">
                <button type="button" className="btn btn-small" onClick={() => setEditing({ id: item.id, draft: toDraft(config.fields, item) })} aria-label={`Edit ${title}`}>
                  Edit
                </button>
                {confirming === item.id ? (
                  <>
                    <button type="button" className="btn btn-small btn-danger" onClick={() => remove(item.id)}>Confirm delete</button>
                    <button type="button" className="btn btn-small" onClick={() => setConfirming(null)}>Cancel</button>
                  </>
                ) : (
                  <button type="button" className="btn btn-small" onClick={() => setConfirming(item.id)} aria-label={`Delete ${title}`}>
                    Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const SECTIONS: { kind: LibraryKind; key: keyof ProfileSpec; label: string }[] = [
  { kind: "experience", key: "experienceIds", label: "Experience" },
  { kind: "project", key: "projectIds", label: "Projects" },
  { kind: "education", key: "educationIds", label: "Education" },
  { kind: "skill", key: "skillIds", label: "Skills" },
];

function ProfilesTab({ profiles, library, onSave, onDelete }: {
  profiles: Profile[];
  library: Library;
  onSave: (id: string | null, name: string, spec: ProfileSpec) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ id: string | null; name: string; spec: ProfileSpec } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startNew = () => setEditing({ id: null, name: "", spec: defaultProfileSpec(library) });
  const toggle = (key: keyof ProfileSpec, id: string) =>
    setEditing((e) => {
      if (!e) return e;
      const ids = e.spec[key] as string[];
      return { ...e, spec: { ...e.spec, [key]: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] } };
    });

  const save = async () => {
    if (!editing) return;
    setError(null);
    try {
      await onSave(editing.id, editing.name.trim(), editing.spec);
      setEditing(null);
    } catch (err) {
      setError(String(err));
    }
  };

  if (editing) {
    return (
      <div className="details-pane">
        <h3>{editing.id ? "Edit profile" : "New profile"}</h3>
        <div className="field">
          <label htmlFor="profile-name">Profile name</label>
          <input id="profile-name" type="text" value={editing.name} placeholder="Backend engineer" maxLength={100} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="profile-headline">Headline</label>
          <input id="profile-headline" type="text" value={editing.spec.headline} placeholder="Backend Engineer" onChange={(e) => setEditing({ ...editing, spec: { ...editing.spec, headline: e.target.value } })} />
        </div>
        <div className="field">
          <label htmlFor="profile-summary">Summary</label>
          <textarea id="profile-summary" rows={3} value={editing.spec.summary} onChange={(e) => setEditing({ ...editing, spec: { ...editing.spec, summary: e.target.value } })} />
        </div>
        {SECTIONS.map(({ kind, key, label }) => {
          const items = library[kind] as unknown as ({ id: string } & Record<string, unknown>)[];
          return (
            <fieldset className="choice-group" key={kind}>
              <legend>{label}</legend>
              {items.length === 0 && <p className="muted">Nothing saved yet. Add some in the {label} tab.</p>}
              {items.map((item) => {
                const { title } = summarize(kind, item);
                return (
                  <label className="check-row" key={item.id}>
                    <input type="checkbox" checked={(editing.spec[key] as string[]).includes(item.id)} onChange={() => toggle(key, item.id)} />
                    {title}
                  </label>
                );
              })}
            </fieldset>
          );
        })}
        {error && <p className="setup-error" role="alert">{error}</p>}
        <div className="setup-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={!editing.name.trim()}>
            Save profile
          </button>
          <button type="button" className="btn" onClick={() => { setEditing(null); setError(null); }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="details-pane">
      <div className="details-pane-head">
        <p className="muted">
          A profile is a version of your resume for a kind of job, with its own headline, summary and choice of entries. Your personal details are shared by all of them.
        </p>
        <button type="button" className="btn btn-primary btn-small" onClick={startNew}>
          New profile
        </button>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <ul className="item-list" aria-label="Profiles">
        {profiles.map((p) => (
          <li key={p.id} className="item-row">
            <div className="item-text">
              <span className="item-title">{p.name}</span>
              <span className="item-meta">{p.headline || "No headline"}</span>
            </div>
            <div className="item-actions">
              <button type="button" className="btn btn-small" onClick={() => setEditing({ id: p.id, name: p.name, spec: { headline: p.headline, summary: p.summary, experienceIds: p.experienceIds, projectIds: p.projectIds, educationIds: p.educationIds, skillIds: p.skillIds } })} aria-label={`Edit ${p.name}`}>
                Edit
              </button>
              {confirming === p.id ? (
                <>
                  <button type="button" className="btn btn-small btn-danger" onClick={async () => { setConfirming(null); try { await onDelete(p.id); } catch (err) { setError(String(err)); } }}>Confirm delete</button>
                  <button type="button" className="btn btn-small" onClick={() => setConfirming(null)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="btn btn-small" onClick={() => setConfirming(p.id)} aria-label={`Delete ${p.name}`}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailsManager({ documents, onClose }: DetailsManagerProps) {
  const details = useDetails();
  const [tab, setTab] = useState<Tab>("personal");
  const [importId, setImportId] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  const importable = useMemo(() => documents.filter((d) => d.resume_data), [documents]);
  const isEmpty = !details.person.name && Object.values(details.library).every((items) => items.length === 0);

  const runImport = async () => {
    const doc = documents.find((d) => d.id === importId);
    if (!doc?.resume_data) return;
    try {
      const data: ResumeData = normalizeResumeData(JSON.parse(doc.resume_data));
      const added = await details.importFromResume(data);
      setImportMessage(added === 0 ? "Everything in that resume was already saved." : `Saved ${added} ${added === 1 ? "entry" : "entries"} from that resume.`);
    } catch (err) {
      setImportMessage(`That resume couldn't be imported: ${err}`);
    }
  };

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="details-title" tabIndex={-1}>
        <div className="dialog-head">
          <h2 id="details-title">My details</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <IconX size={18} />
          </button>
        </div>

        <div className="dialog-body details-body">
          {details.error && <p className="setup-error" role="alert">{details.error}</p>}
          {isEmpty && !details.loading && (
            <p className="muted">
              Enter your details once and every new resume can start filled in. Already have a resume here? Import it below.
            </p>
          )}
          {importable.length > 0 && (
            <div className="import-row">
              <label htmlFor="import-resume">Import from a resume</label>
              <select id="import-resume" value={importId} onChange={(e) => setImportId(e.target.value)}>
                <option value="">Choose a resume…</option>
                {importable.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
              <button type="button" className="btn btn-small" onClick={runImport} disabled={!importId}>
                Import
              </button>
            </div>
          )}
          {importMessage && <p className="update-status" role="status">{importMessage}</p>}

          <div className="tab-bar" role="tablist" aria-label="My details sections">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "selected" : ""}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {details.loading ? (
            <p className="muted" role="status">Loading…</p>
          ) : tab === "personal" ? (
            <PersonalTab person={details.person} onSave={details.savePerson} />
          ) : tab === "profiles" ? (
            <ProfilesTab profiles={details.profiles} library={details.library} onSave={details.saveProfile} onDelete={details.deleteProfile} />
          ) : (
            <ItemsTab key={tab} kind={tab} library={details.library} onSave={details.saveItem} onDelete={details.deleteItem} />
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

export default DetailsManager;
