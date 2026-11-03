import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ResumeData,
  ResumeExperienceItem,
  ResumeEducationItem,
  ResumeProjectItem,
  ResumeSkillItem,
  ResumeCustomSection,
  ResumeListItem,
  BuiltinListKey,
  ExtractedTemplateAnalysis,
  ExtractedTemplateField,
  TemplateSectionSchema,
} from "../types";
import { createId } from "../utils/templateEngine";
import { BUILTIN_ITEM_FIELDS, ITEM_CONTROL_KEYS, humanizeKey } from "../utils/templateParser";
import { IconPlus, IconTrash, IconChevronDown, IconChevronUp, IconX, IconCode } from "./Icons";

interface ResumeFormProps {
  data: ResumeData;
  onChange: (newData: ResumeData) => void;
  /**
   * What the active template uses. When given, the form shows only those
   * sections and fields (plus sections the template defines itself); data for
   * anything hidden is kept. Without it every standard section is shown.
   */
  schema?: ExtractedTemplateAnalysis;
  /** Extra template values, used when no schema is given. */
  customFields?: ExtractedTemplateField[];
  /** True when the LaTeX source was edited by hand; the form is then read-only. */
  locked?: boolean;
  onRegenerateFromForm?: () => void;
  onOpenSource?: () => void;
  /** Controls shown at the end of the section bar (e.g. the Form/LaTeX switch). */
  toolbarEnd?: React.ReactNode;
}

type BuiltinSection = "experience" | "education" | "projects" | "skills" | "custom";
/** "personal", "fields", a built-in section, or the key of a template-defined list. */
type SectionKey = string;

const BUILTIN_SECTIONS: BuiltinSection[] = ["experience", "education", "projects", "skills", "custom"];

const DATA_KEY: Record<BuiltinSection, BuiltinListKey> = {
  experience: "experience",
  education: "education",
  projects: "projects",
  skills: "skills",
  custom: "customSections",
};

const PERSONAL_LABELS: Record<string, string> = {
  name: "Full name",
  title: "Headline",
  email: "Email",
  phone: "Phone",
  location: "Location",
  website: "Website",
  linkedin: "LinkedIn",
  github: "GitHub",
  summary: "Summary",
};

const SECTIONS: Record<string, { label: string; hint: string }> = {
  personal: { label: "Details", hint: "Your name and how employers can reach you." },
  fields: { label: "Template fields", hint: "Other text this template prints." },
  experience: { label: "Experience", hint: "Most recent first. Start highlights with what you achieved." },
  education: { label: "Education", hint: "Degrees, certificates and courses." },
  projects: { label: "Projects", hint: "Work you built or led, with a link if there is one." },
  skills: { label: "Skills", hint: "Group your skills into a few categories." },
  custom: { label: "Additional", hint: "Awards, certifications, languages or anything else." },
};

/**
 * Order of the movable sections the template shows: the saved order first,
 * then the rest in template order. Details always comes first.
 */
function contentOrder(sectionOrder: string[] | undefined, available: SectionKey[]): SectionKey[] {
  const saved = (sectionOrder || [])
    .map((key) => (key === "customSections" ? "custom" : key))
    .filter((key) => available.includes(key));
  const unique = Array.from(new Set(saved));
  return [...unique, ...available.filter((key) => !unique.includes(key))];
}

/** What the form shows for a template; null parts mean "show everything". */
interface FormView {
  personal: string[] | null;
  builtin: Map<BuiltinSection, TemplateSectionSchema | null>;
  lists: TemplateSectionSchema[];
  /** Movable sections, in template order. */
  available: SectionKey[];
}

function buildView(schema: ExtractedTemplateAnalysis | undefined): FormView {
  if (!schema) {
    return {
      personal: null,
      builtin: new Map(BUILTIN_SECTIONS.map((key) => [key, null])),
      lists: [],
      available: [...BUILTIN_SECTIONS],
    };
  }
  const builtin = new Map<BuiltinSection, TemplateSectionSchema | null>();
  const lists: TemplateSectionSchema[] = [];
  const available: SectionKey[] = [];
  for (const section of schema.sections) {
    if (section.builtin) {
      const formKey = BUILTIN_SECTIONS.find((key) => DATA_KEY[key] === section.key)!;
      builtin.set(formKey, section);
      available.push(formKey);
    } else if (!SECTIONS[section.key]) {
      lists.push(section);
      available.push(section.key);
    }
  }
  return { personal: schema.personalFields, builtin, lists, available };
}

/**
 * Whether an entry field shows: a template that uses none of a section's
 * standard fields (e.g. one written by hand) gets all of them.
 */
function usesField(section: TemplateSectionSchema | null | undefined, dataKey: BuiltinListKey, field: string) {
  if (!section) return true;
  const standard = BUILTIN_ITEM_FIELDS[dataKey];
  if (!section.fields.some((f) => standard.includes(f))) return true;
  return section.fields.includes(field);
}

function usesBullets(section: TemplateSectionSchema | null | undefined, dataKey: BuiltinListKey) {
  if (!section) return true;
  const standard = BUILTIN_ITEM_FIELDS[dataKey];
  return section.hasBullets || !section.fields.some((f) => standard.includes(f));
}

/** Fields the template adds to a built-in section's entries (e.g. a project date). */
function extraFields(section: TemplateSectionSchema | null | undefined, dataKey: BuiltinListKey): string[] {
  if (!section) return [];
  const standard = BUILTIN_ITEM_FIELDS[dataKey];
  return section.fields.filter((f) => !standard.includes(f) && !ITEM_CONTROL_KEYS.has(f));
}

const LONG_FIELD = /desc|summary|about|content|details|notes|abstract/i;

/** Inputs for template-specific entry fields, stored in the entry's `fields`. */
function ExtraFields({
  keys,
  values,
  onChange,
}: {
  keys: string[];
  values: Record<string, string> | undefined;
  onChange: (fields: Record<string, string>) => void;
}) {
  return (
    <>
      {keys.map((key) => {
        const value = values?.[key] || "";
        const set = (next: string) => onChange({ ...(values || {}), [key]: next });
        return (
          <Field key={key} label={humanizeKey(key)} wide={LONG_FIELD.test(key)}>
            {LONG_FIELD.test(key) ? (
              <textarea rows={2} value={value} onChange={(e) => set(e.target.value)} />
            ) : (
              <input type="text" value={value} onChange={(e) => set(e.target.value)} />
            )}
          </Field>
        );
      })}
    </>
  );
}

function moveItem<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

const hasText = (...values: (string | undefined)[]) => values.some((v) => v?.trim());

/** Entries go only after confirmation when they hold any text. */
const confirmRemove = (what: string, hasContent: boolean) =>
  !hasContent || confirm(`Remove this ${what}? This can't be undone.`);

/* ---------- Building blocks ---------- */

/** A labelled control: ties the <label> to its input so clicks and screen readers work. */
function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  wide?: boolean;
  children: React.ReactElement;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${wide ? "field-wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id, "aria-describedby": hintId })}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

function ReorderButtons({
  index,
  count,
  noun,
  onMove,
  testIdPrefix,
}: {
  index: number;
  count: number;
  noun: string;
  onMove: (delta: -1 | 1) => void;
  testIdPrefix: string;
}) {
  return (
    <>
      <button
        type="button"
        className="icon-button"
        disabled={index === 0}
        onClick={() => onMove(-1)}
        aria-label={`Move ${noun} up`}
        title="Move up"
        data-testid={`${testIdPrefix}-up-${index}`}
      >
        <IconChevronUp size={15} />
      </button>
      <button
        type="button"
        className="icon-button"
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        aria-label={`Move ${noun} down`}
        title="Move down"
        data-testid={`${testIdPrefix}-down-${index}`}
      >
        <IconChevronDown size={15} />
      </button>
    </>
  );
}

/** One item of a list section (a job, a degree...). */
function Entry({
  title,
  placeholderTitle,
  noun,
  index,
  count,
  onMove,
  onRemove,
  testIdPrefix,
  testId,
  children,
}: {
  title: string;
  placeholderTitle: string;
  noun: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  testIdPrefix: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="entry" data-testid={testId}>
      <div className="entry-head">
        <h3 className={title ? "" : "is-placeholder"}>{title || placeholderTitle}</h3>
        <div className="entry-tools">
          <ReorderButtons
            index={index}
            count={count}
            noun={noun}
            onMove={onMove}
            testIdPrefix={`btn-move-${testIdPrefix}`}
          />
          <button
            type="button"
            className="icon-button danger"
            onClick={onRemove}
            aria-label={`Remove ${noun}`}
            title={`Remove ${noun}`}
            data-testid={`btn-remove-${testIdPrefix}-${index}`}
          >
            <IconTrash size={15} />
          </button>
        </div>
      </div>
      <div className="entry-fields">{children}</div>
    </div>
  );
}

const supportsFieldSizing =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/** A one-line textarea that grows with its text (bullets are often full sentences). */
const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoTextarea(props, forwardedRef) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el || supportsFieldSizing || el.scrollHeight === 0) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }, [props.value]);
    return (
      <textarea
        rows={1}
        {...props}
        ref={(el) => {
          innerRef.current = el;
          if (typeof forwardedRef === "function") forwardedRef(el);
          else if (forwardedRef) forwardedRef.current = el;
        }}
      />
    );
  }
);

/** Editable list of bullet points. Enter starts the next one. */
function BulletList({
  label,
  bullets,
  placeholder,
  addLabel,
  onChange,
  testIds,
}: {
  label: string;
  bullets: string[];
  placeholder: string;
  addLabel: string;
  onChange: (bullets: string[]) => void;
  testIds: { move?: string; remove?: string; add?: string };
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    if (focusIndex === null) return;
    const fields = listRef.current?.querySelectorAll("textarea");
    fields?.[focusIndex]?.focus();
    setFocusIndex(null);
  }, [focusIndex, bullets.length]);

  const handleKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onChange([...bullets.slice(0, idx + 1), "", ...bullets.slice(idx + 1)]);
      setFocusIndex(idx + 1);
    } else if (e.key === "Backspace" && bullets[idx] === "" && bullets.length > 1) {
      e.preventDefault();
      onChange(bullets.filter((_, i) => i !== idx));
      setFocusIndex(Math.max(0, idx - 1));
    }
  };

  return (
    <div className="bullets field-wide">
      <span className="bullets-label" id={listId}>
        {label}s
      </span>
      <ul aria-labelledby={listId} ref={listRef}>
        {bullets.map((bullet, idx) => (
          <li key={idx} className="bullet">
            <span className="bullet-mark" aria-hidden="true" />
            <AutoTextarea
              value={bullet}
              placeholder={placeholder}
              aria-label={`${label} ${idx + 1}`}
              onChange={(e) =>
                // Bullets are single paragraphs; pasted line breaks become spaces.
                onChange(bullets.map((b, i) => (i === idx ? e.target.value.replace(/\s*\n\s*/g, " ") : b)))
              }
              onKeyDown={handleKeyDown(idx)}
            />
            <div className="bullet-tools">
              <button
                type="button"
                className="icon-button"
                disabled={idx === 0}
                onClick={() => onChange(moveItem(bullets, idx, -1))}
                aria-label={`Move ${label.toLowerCase()} ${idx + 1} up`}
                title="Move up"
                data-testid={testIds.move ? `${testIds.move.replace("{dir}", "up")}-${idx}` : undefined}
              >
                <IconChevronUp size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                disabled={idx === bullets.length - 1}
                onClick={() => onChange(moveItem(bullets, idx, 1))}
                aria-label={`Move ${label.toLowerCase()} ${idx + 1} down`}
                title="Move down"
                data-testid={testIds.move ? `${testIds.move.replace("{dir}", "down")}-${idx}` : undefined}
              >
                <IconChevronDown size={14} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                onClick={() => onChange(bullets.filter((_, i) => i !== idx))}
                aria-label={`Remove ${label.toLowerCase()} ${idx + 1}`}
                title="Remove"
                data-testid={testIds.remove ? `${testIds.remove}-${idx}` : undefined}
              >
                <IconX size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          onChange([...bullets, ""]);
          setFocusIndex(bullets.length);
        }}
        data-testid={testIds.add}
      >
        <IconPlus size={14} />
        {addLabel}
      </button>
    </div>
  );
}

function AddButton({ label, onClick, testId }: { label: string; onClick: () => void; testId?: string }) {
  return (
    <button type="button" className="add-button" onClick={onClick} data-testid={testId}>
      <IconPlus size={15} />
      {label}
    </button>
  );
}

/* ---------- Form ---------- */

export const ResumeForm: React.FC<ResumeFormProps> = ({
  data,
  onChange,
  schema,
  customFields = [],
  locked = false,
  onRegenerateFromForm,
  onOpenSource,
  toolbarEnd,
}) => {
  const formId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("personal");

  const view = React.useMemo(() => buildView(schema), [schema]);
  const order = contentOrder(data.sectionOrder, view.available);
  const templateFields = schema ? schema.customVariables : customFields;
  const allSections: SectionKey[] = ["personal", ...(templateFields.length > 0 ? ["fields"] : []), ...order];
  const listSchema = (key: SectionKey) => view.lists.find((s) => s.key === key);
  const sectionLabel = (key: SectionKey) => {
    if (SECTIONS[key]) return SECTIONS[key].label;
    const list = listSchema(key);
    return list?.heading || humanizeKey(key);
  };
  const sectionHint = (key: SectionKey) =>
    SECTIONS[key]?.hint ?? "A section of this template. Each entry fills the fields below.";
  const sectionId = (key: SectionKey) => `${formId}-section-${key}`;

  // Highlight the section currently at the top of the form
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => visible.set(entry.target.id, entry.isIntersecting));
        const first = allSections.find((key) => visible.get(sectionId(key)));
        if (first) setActiveSection(first);
      },
      { root, rootMargin: "0px 0px -60% 0px" }
    );
    allSections.forEach((key) => {
      const el = document.getElementById(sectionId(key));
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
    // Re-observe when the section order changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSections.join(",")]);

  const goToSection = (key: SectionKey) => {
    setActiveSection(key);
    const el = document.getElementById(sectionId(key));
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  };

  const moveSection = (key: SectionKey, delta: -1 | 1) => {
    const index = order.indexOf(key);
    // Keep the saved position of sections this template doesn't show.
    const hidden = (data.sectionOrder || []).filter(
      (k) => k !== "personal" && !order.includes(k === "customSections" ? "custom" : k)
    );
    onChange({ ...data, sectionOrder: ["personal", ...moveItem(order, index, delta), ...hidden] });
  };

  const showPersonal = (field: string) => !view.personal || view.personal.includes(field);
  const builtin = (key: BuiltinSection) => view.builtin.get(key);
  const show = (key: BuiltinSection, field: string) => usesField(builtin(key), DATA_KEY[key], field);
  const showBullets = (key: BuiltinSection) => usesBullets(builtin(key), DATA_KEY[key]);
  const extras = (key: BuiltinSection) => extraFields(builtin(key), DATA_KEY[key]);
  const customLists = data.customLists || {};
  const listItems = (key: string): ResumeListItem[] => customLists[key] || [];
  const setList = (key: string, items: ResumeListItem[]) =>
    onChange({ ...data, customLists: { ...customLists, [key]: items } });
  const setVariable = (key: string, value: string) =>
    onChange({ ...data, customVariables: { ...(data.customVariables || {}), [key]: value } });

  const setPersonal = (field: keyof ResumeData["personal"], value: string) =>
    onChange({ ...data, personal: { ...data.personal, [field]: value } });

  const personalInput = (
    field: keyof ResumeData["personal"],
    placeholder: string,
    type: "text" | "email" | "tel" | "url" = "text",
    testId?: string
  ) => (
    <input
      type={type}
      value={data.personal[field] || ""}
      placeholder={placeholder}
      onChange={(e) => setPersonal(field, e.target.value)}
      data-testid={testId}
    />
  );

  /* List helpers */
  const updateExperience = (id: string, patch: Partial<ResumeExperienceItem>) =>
    onChange({ ...data, experience: data.experience.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const updateEducation = (id: string, patch: Partial<ResumeEducationItem>) =>
    onChange({ ...data, education: data.education.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
  const updateProject = (id: string, patch: Partial<ResumeProjectItem>) =>
    onChange({ ...data, projects: data.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const updateSkill = (id: string, patch: Partial<ResumeSkillItem>) =>
    onChange({ ...data, skills: data.skills.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const customSections = data.customSections || [];
  const updateCustom = (id: string, patch: Partial<ResumeCustomSection>) =>
    onChange({ ...data, customSections: customSections.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

  const counts: Partial<Record<SectionKey, number>> = {
    experience: data.experience.length,
    education: data.education.length,
    projects: data.projects.length,
    skills: data.skills.length,
    custom: customSections.length,
  };
  for (const list of view.lists) counts[list.key] = listItems(list.key).length;

  // Content this template doesn't print, so nobody wonders where it went.
  const hiddenContent: string[] = [];
  if (view.personal) {
    for (const [field, label] of Object.entries(PERSONAL_LABELS)) {
      const value = data.personal[field as keyof ResumeData["personal"]];
      if (!view.personal.includes(field) && value?.trim()) hiddenContent.push(label);
    }
  }
  for (const key of BUILTIN_SECTIONS) {
    if (!view.builtin.has(key) && counts[key]) hiddenContent.push(`${SECTIONS[key].label} (${counts[key]})`);
  }
  for (const [key, items] of Object.entries(customLists)) {
    if (!view.lists.some((l) => l.key === key) && items.length > 0) hiddenContent.push(`${humanizeKey(key)} (${items.length})`);
  }

  const renderSectionBody = (key: SectionKey) => {
    switch (key) {
      case "personal":
        return (
          <div className="field-grid">
            {view.personal && view.personal.length === 0 && (
              <p className="template-fields-note field-wide" data-testid="no-personal-fields">
                This template doesn't print any of your details. Its text comes from the LaTeX source.
              </p>
            )}
            {showPersonal("name") && (
              <Field label="Full name">{personalInput("name", "Alex Morgan", "text", "input-personal-name")}</Field>
            )}
            {showPersonal("title") && <Field label="Headline">{personalInput("title", "Senior Software Engineer")}</Field>}
            {showPersonal("email") && <Field label="Email">{personalInput("email", "alex@example.com", "email")}</Field>}
            {showPersonal("phone") && <Field label="Phone">{personalInput("phone", "+1 555 019 2834", "tel")}</Field>}
            {showPersonal("location") && <Field label="Location">{personalInput("location", "San Francisco, CA")}</Field>}
            {showPersonal("website") && <Field label="Website">{personalInput("website", "alexmorgan.dev")}</Field>}
            {showPersonal("linkedin") && (
              <Field label="LinkedIn">{personalInput("linkedin", "linkedin.com/in/alexmorgan")}</Field>
            )}
            {showPersonal("github") && <Field label="GitHub">{personalInput("github", "github.com/alexmorgan")}</Field>}
            {showPersonal("summary") && (
              <Field label="Summary" wide>
                <textarea
                  rows={3}
                  value={data.personal.summary || ""}
                  placeholder="Two or three sentences about what you do and what you're looking for."
                  onChange={(e) => setPersonal("summary", e.target.value)}
                />
              </Field>
            )}
          </div>
        );

      case "experience":
        return (
          <>
            {data.experience.map((exp, idx) => (
              <Entry
                key={exp.id}
                title={[exp.role, exp.company].filter((v) => v?.trim()).join(" at ")}
                placeholderTitle="New position"
                noun="position"
                index={idx}
                count={data.experience.length}
                onMove={(delta) => onChange({ ...data, experience: moveItem(data.experience, idx, delta) })}
                onRemove={() => {
                  if (!confirmRemove("position", !!hasText(exp.role, exp.company, exp.location, exp.startDate, ...exp.bullets))) return;
                  onChange({ ...data, experience: data.experience.filter((e) => e.id !== exp.id) });
                }}
                testIdPrefix="experience"
                testId={`experience-item-${idx}`}
              >
                {show("experience", "role") && (
                  <Field label="Role">
                    <input type="text" value={exp.role} placeholder="Senior Software Engineer" onChange={(e) => updateExperience(exp.id, { role: e.target.value })} />
                  </Field>
                )}
                {show("experience", "company") && (
                  <Field label="Company">
                    <input type="text" value={exp.company} placeholder="Acme Corp" onChange={(e) => updateExperience(exp.id, { company: e.target.value })} />
                  </Field>
                )}
                {show("experience", "location") && (
                  <Field label="Location">
                    <input type="text" value={exp.location || ""} placeholder="Remote" onChange={(e) => updateExperience(exp.id, { location: e.target.value })} />
                  </Field>
                )}
                {(show("experience", "startDate") || show("experience", "endDate")) && (
                  <div className="field-pair">
                    <Field label="Start">
                      <input type="text" value={exp.startDate || ""} placeholder="Jan 2022" onChange={(e) => updateExperience(exp.id, { startDate: e.target.value })} />
                    </Field>
                    <Field label="End">
                      <input type="text" value={exp.endDate || ""} placeholder="Present" onChange={(e) => updateExperience(exp.id, { endDate: e.target.value })} />
                    </Field>
                  </div>
                )}
                <ExtraFields keys={extras("experience")} values={exp.fields} onChange={(fields) => updateExperience(exp.id, { fields })} />
                {showBullets("experience") && <BulletList
                  label="Highlight"
                  bullets={exp.bullets}
                  placeholder="Cut page load time by 40% by…"
                  addLabel="Add highlight"
                  onChange={(bullets) => updateExperience(exp.id, { bullets })}
                  testIds={{ move: `btn-move-exp-bullet-{dir}-${exp.id}` }}
                />}
              </Entry>
            ))}
            <AddButton
              label="Add position"
              testId="btn-add-experience"
              onClick={() =>
                onChange({
                  ...data,
                  experience: [
                    ...data.experience,
                    { id: createId("exp"), role: "", company: "", location: "", startDate: "", endDate: "Present", bullets: [""] },
                  ],
                })
              }
            />
          </>
        );

      case "education":
        return (
          <>
            {data.education.map((edu, idx) => (
              <Entry
                key={edu.id}
                title={[edu.degree, edu.institution].filter((v) => v?.trim()).join(", ")}
                placeholderTitle="New education"
                noun="education entry"
                index={idx}
                count={data.education.length}
                onMove={(delta) => onChange({ ...data, education: moveItem(data.education, idx, delta) })}
                onRemove={() => {
                  if (!confirmRemove("education entry", !!hasText(edu.degree, edu.institution, edu.location, edu.details))) return;
                  onChange({ ...data, education: data.education.filter((e) => e.id !== edu.id) });
                }}
                testIdPrefix="education"
                testId={`education-item-${idx}`}
              >
                {show("education", "degree") && (
                  <Field label="Degree or certificate">
                    <input type="text" value={edu.degree} placeholder="B.S. in Computer Science" onChange={(e) => updateEducation(edu.id, { degree: e.target.value })} />
                  </Field>
                )}
                {show("education", "institution") && (
                  <Field label="School">
                    <input type="text" value={edu.institution} placeholder="University of Washington" onChange={(e) => updateEducation(edu.id, { institution: e.target.value })} />
                  </Field>
                )}
                {show("education", "location") && (
                  <Field label="Location">
                    <input type="text" value={edu.location || ""} placeholder="Seattle, WA" onChange={(e) => updateEducation(edu.id, { location: e.target.value })} />
                  </Field>
                )}
                {(show("education", "startDate") || show("education", "endDate")) && (
                  <div className="field-pair">
                    <Field label="Start">
                      <input type="text" value={edu.startDate || ""} placeholder="2015" onChange={(e) => updateEducation(edu.id, { startDate: e.target.value })} />
                    </Field>
                    <Field label="End">
                      <input type="text" value={edu.endDate || ""} placeholder="2019" onChange={(e) => updateEducation(edu.id, { endDate: e.target.value })} />
                    </Field>
                  </div>
                )}
                {show("education", "details") && (
                  <Field label="Details" wide hint="Honors, GPA or relevant coursework.">
                    <input type="text" value={edu.details || ""} placeholder="Magna cum laude, GPA 3.9" onChange={(e) => updateEducation(edu.id, { details: e.target.value })} />
                  </Field>
                )}
                <ExtraFields keys={extras("education")} values={edu.fields} onChange={(fields) => updateEducation(edu.id, { fields })} />
              </Entry>
            ))}
            <AddButton
              label="Add education"
              testId="btn-add-education"
              onClick={() =>
                onChange({
                  ...data,
                  education: [
                    ...data.education,
                    { id: createId("edu"), degree: "", institution: "", location: "", startDate: "", endDate: "", details: "" },
                  ],
                })
              }
            />
          </>
        );

      case "projects":
        return (
          <>
            {data.projects.map((proj, idx) => (
              <Entry
                key={proj.id}
                title={proj.name}
                placeholderTitle="New project"
                noun="project"
                index={idx}
                count={data.projects.length}
                onMove={(delta) => onChange({ ...data, projects: moveItem(data.projects, idx, delta) })}
                onRemove={() => {
                  if (!confirmRemove("project", !!hasText(proj.name, proj.technologies, proj.link, ...proj.bullets))) return;
                  onChange({ ...data, projects: data.projects.filter((p) => p.id !== proj.id) });
                }}
                testIdPrefix="project"
                testId={`project-item-${idx}`}
              >
                {show("projects", "name") && (
                  <Field label="Name">
                    <input type="text" value={proj.name} placeholder="Distributed key-value store" onChange={(e) => updateProject(proj.id, { name: e.target.value })} />
                  </Field>
                )}
                {show("projects", "technologies") && (
                  <Field label="Technologies">
                    <input type="text" value={proj.technologies || ""} placeholder="Rust, Raft, gRPC" onChange={(e) => updateProject(proj.id, { technologies: e.target.value })} />
                  </Field>
                )}
                {show("projects", "link") && (
                  <Field label="Link" wide>
                    <input type="text" value={proj.link || ""} placeholder="github.com/alex/kv-store" onChange={(e) => updateProject(proj.id, { link: e.target.value })} />
                  </Field>
                )}
                <ExtraFields keys={extras("projects")} values={proj.fields} onChange={(fields) => updateProject(proj.id, { fields })} />
                {showBullets("projects") && <BulletList
                  label="Highlight"
                  bullets={proj.bullets}
                  placeholder="What it does and what you did"
                  addLabel="Add highlight"
                  onChange={(bullets) => updateProject(proj.id, { bullets })}
                  testIds={{ move: `btn-move-proj-bullet-{dir}-${proj.id}`, add: `btn-add-proj-bullet-${proj.id}` }}
                />}
              </Entry>
            ))}
            <AddButton
              label="Add project"
              testId="btn-add-project"
              onClick={() =>
                onChange({
                  ...data,
                  projects: [...data.projects, { id: createId("proj"), name: "", technologies: "", link: "", bullets: [""] }],
                })
              }
            />
          </>
        );

      case "skills":
        return (
          <>
            {data.skills.map((skill, idx) => (
              <Entry
                key={skill.id}
                title={skill.category}
                placeholderTitle="New skill group"
                noun="skill group"
                index={idx}
                count={data.skills.length}
                onMove={(delta) => onChange({ ...data, skills: moveItem(data.skills, idx, delta) })}
                onRemove={() => {
                  if (!confirmRemove("skill group", !!hasText(skill.category, skill.skills))) return;
                  onChange({ ...data, skills: data.skills.filter((s) => s.id !== skill.id) });
                }}
                testIdPrefix="skill"
                testId={`skill-item-${idx}`}
              >
                {show("skills", "category") && (
                  <Field label="Category">
                    <input type="text" value={skill.category} placeholder="Languages" onChange={(e) => updateSkill(skill.id, { category: e.target.value })} />
                  </Field>
                )}
                {show("skills", "skills") && (
                  <Field label="Skills" hint="Separate with commas.">
                    <input type="text" value={skill.skills} placeholder="Rust, TypeScript, Python" onChange={(e) => updateSkill(skill.id, { skills: e.target.value })} />
                  </Field>
                )}
                <ExtraFields keys={extras("skills")} values={skill.fields} onChange={(fields) => updateSkill(skill.id, { fields })} />
              </Entry>
            ))}
            <AddButton
              label="Add skill group"
              testId="btn-add-skill"
              onClick={() =>
                onChange({ ...data, skills: [...data.skills, { id: createId("skill"), category: "", skills: "" }] })
              }
            />
          </>
        );

      case "custom":
        return (
          <>
            {customSections.map((sec, idx) => (
              <Entry
                key={sec.id}
                title={sec.title}
                placeholderTitle="New section"
                noun="section"
                index={idx}
                count={customSections.length}
                onMove={(delta) => onChange({ ...data, customSections: moveItem(customSections, idx, delta) })}
                onRemove={() => {
                  if (!confirmRemove("section", !!hasText(sec.title, sec.content, ...(sec.bullets || [])))) return;
                  onChange({ ...data, customSections: customSections.filter((c) => c.id !== sec.id) });
                }}
                testIdPrefix="custom"
              >
                {show("custom", "title") && (
                  <Field label="Section title" wide>
                    <input type="text" value={sec.title} placeholder="Certifications" onChange={(e) => updateCustom(sec.id, { title: e.target.value })} />
                  </Field>
                )}
                {show("custom", "content") && (
                  <Field label="Text" wide hint="Optional. Shown above the bullet points.">
                    <textarea rows={2} value={sec.content || ""} onChange={(e) => updateCustom(sec.id, { content: e.target.value })} />
                  </Field>
                )}
                <ExtraFields keys={extras("custom")} values={sec.fields} onChange={(fields) => updateCustom(sec.id, { fields })} />
                {showBullets("custom") && <BulletList
                  label={`${sec.title || "Section"} bullet`}
                  bullets={sec.bullets || []}
                  placeholder="AWS Certified Solutions Architect, 2025"
                  addLabel="Add bullet point"
                  onChange={(bullets) => updateCustom(sec.id, { bullets })}
                  testIds={{ remove: `btn-remove-custom-bullet-${idx}`, add: `btn-add-custom-bullet-${idx}` }}
                />}
              </Entry>
            ))}
            <AddButton
              label="Add section"
              testId="btn-add-custom-section"
              onClick={() =>
                onChange({
                  ...data,
                  customSections: [...customSections, { id: createId("sec"), title: "", content: "", bullets: [""] }],
                })
              }
            />
          </>
        );

      case "fields":
        return (
          <div className="field-grid template-fields">
            {templateFields.map((field) => (
              <Field key={field.key} label={field.label} wide={field.type === "textarea"}>
                {field.type === "textarea" ? (
                  <textarea
                    rows={3}
                    value={data.customVariables?.[field.key] || ""}
                    onChange={(e) => setVariable(field.key, e.target.value)}
                  />
                ) : (
                  <input
                    type="text"
                    value={data.customVariables?.[field.key] || ""}
                    onChange={(e) => setVariable(field.key, e.target.value)}
                  />
                )}
              </Field>
            ))}
          </div>
        );

      default: {
        const list = listSchema(key);
        if (!list) return null;
        const items = listItems(key);
        const label = sectionLabel(key);
        const fieldKeys = list.fields.filter((f) => !ITEM_CONTROL_KEYS.has(f));
        const updateItem = (id: string, patch: Partial<ResumeListItem>) =>
          setList(key, items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
        return (
          <>
            {items.map((item, idx) => (
              <Entry
                key={item.id}
                title={fieldKeys.map((f) => item.fields[f]).find((v) => v?.trim()) || ""}
                placeholderTitle="New entry"
                noun={`${label} entry`}
                index={idx}
                count={items.length}
                onMove={(delta) => setList(key, moveItem(items, idx, delta))}
                onRemove={() => {
                  if (!confirmRemove("entry", !!hasText(...Object.values(item.fields), ...item.bullets))) return;
                  setList(key, items.filter((i) => i.id !== item.id));
                }}
                testIdPrefix={`list-${key}`}
                testId={`list-${key}-item-${idx}`}
              >
                <ExtraFields keys={fieldKeys} values={item.fields} onChange={(fields) => updateItem(item.id, { fields })} />
                {list.hasBullets && (
                  <BulletList
                    label={`${label} bullet`}
                    bullets={item.bullets}
                    placeholder="What you did"
                    addLabel="Add bullet point"
                    onChange={(bullets) => updateItem(item.id, { bullets })}
                    testIds={{ add: `btn-add-list-${key}-bullet-${idx}` }}
                  />
                )}
              </Entry>
            ))}
            <AddButton
              label="Add entry"
              testId={`btn-add-list-${key}`}
              onClick={() =>
                setList(key, [...items, { id: createId("item"), fields: {}, bullets: list.hasBullets ? [""] : [] }])
              }
            />
          </>
        );
      }
    }
  };

  return (
    <div className="resume-form-shell">
      <div className="pane-bar">
      <nav className="section-nav" aria-label="Resume sections">
        {allSections.map((key) => (
          <button
            key={key}
            type="button"
            className={activeSection === key ? "active" : ""}
            aria-current={activeSection === key ? "true" : undefined}
            onClick={() => goToSection(key)}
            data-testid={`section-tab-${key}`}
          >
            {sectionLabel(key)}
            {counts[key] !== undefined && counts[key]! > 0 && (
              <span className="section-count">
                <span className="visually-hidden">, </span>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </nav>
        {toolbarEnd && <div className="pane-bar-end">{toolbarEnd}</div>}
      </div>

      <div className="resume-form" ref={scrollRef} data-testid="resume-form">
      <div className="form-body">
        {locked && (
          <div className="locked-note" role="status" data-testid="form-locked-banner">
            <h2>The form is paused</h2>
            <p>
              You edited the LaTeX source directly, so changes here would overwrite those edits.
              Keep working in the source, or replace it with the form's content.
            </p>
            <div className="locked-actions">
              {onOpenSource && (
                <button type="button" className="btn btn-primary" onClick={onOpenSource}>
                  <IconCode size={15} />
                  Edit LaTeX source
                </button>
              )}
              {onRegenerateFromForm && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={onRegenerateFromForm}
                  data-testid="btn-regenerate-from-form"
                >
                  Replace source with form
                </button>
              )}
            </div>
          </div>
        )}

        <fieldset className="form-sections" disabled={locked}>
          <legend className="visually-hidden">Resume content</legend>
          {allSections.map((key) => {
            const contentIndex = order.indexOf(key);
            return (
              <section
                key={key}
                id={sectionId(key)}
                className="form-section"
                aria-labelledby={`${sectionId(key)}-title`}
                data-testid={`section-card-${key}`}
              >
                <div className="section-head">
                  <div>
                    <h2 id={`${sectionId(key)}-title`}>{sectionLabel(key)}</h2>
                    <p className="section-hint">{sectionHint(key)}</p>
                  </div>
                  {contentIndex !== -1 && (
                    <div className="section-tools">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={contentIndex === 0}
                        onClick={() => moveSection(key, -1)}
                        aria-label={`Move ${sectionLabel(key)} section up`}
                        title="Move section up"
                        data-testid={`btn-move-section-up-${key}`}
                      >
                        <IconChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={contentIndex === order.length - 1}
                        onClick={() => moveSection(key, 1)}
                        aria-label={`Move ${sectionLabel(key)} section down`}
                        title="Move section down"
                        data-testid={`btn-move-section-down-${key}`}
                      >
                        <IconChevronDown size={16} />
                      </button>
                    </div>
                  )}
                </div>
                {renderSectionBody(key)}
              </section>
            );
          })}
        </fieldset>
        {hiddenContent.length > 0 && (
          <p className="hidden-note" data-testid="hidden-content-note">
            Not shown by this template: {hiddenContent.join(", ")}. It's kept, and comes back when you switch to a
            template that uses it.
          </p>
        )}
      </div>
      </div>
    </div>
  );
};

export default ResumeForm;
