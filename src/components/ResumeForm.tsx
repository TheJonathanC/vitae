import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ResumeData,
  ResumeExperienceItem,
  ResumeEducationItem,
  ResumeProjectItem,
  ResumeSkillItem,
  ResumeCustomSection,
  ExtractedTemplateField,
} from "../types";
import { createId } from "../utils/templateEngine";
import { IconPlus, IconTrash, IconChevronDown, IconChevronUp, IconX, IconCode } from "./Icons";

interface ResumeFormProps {
  data: ResumeData;
  onChange: (newData: ResumeData) => void;
  customFields?: ExtractedTemplateField[];
  /** True when the LaTeX source was edited by hand; the form is then read-only. */
  locked?: boolean;
  onRegenerateFromForm?: () => void;
  onOpenSource?: () => void;
  /** Controls shown at the end of the section bar (e.g. the Form/LaTeX switch). */
  toolbarEnd?: React.ReactNode;
}

type ContentSection = "experience" | "education" | "projects" | "skills" | "custom";
type SectionKey = "personal" | ContentSection;

const CONTENT_SECTIONS: ContentSection[] = ["experience", "education", "projects", "skills", "custom"];

const SECTIONS: Record<SectionKey, { label: string; hint: string }> = {
  personal: { label: "Details", hint: "Your name and how employers can reach you." },
  experience: { label: "Experience", hint: "Most recent first. Start highlights with what you achieved." },
  education: { label: "Education", hint: "Degrees, certificates and courses." },
  projects: { label: "Projects", hint: "Work you built or led, with a link if there is one." },
  skills: { label: "Skills", hint: "Group your skills into a few categories." },
  custom: { label: "Additional", hint: "Awards, certifications, languages or anything else." },
};

/** Order of the movable sections; Details always comes first in every template. */
function contentOrder(sectionOrder?: string[]): ContentSection[] {
  const saved = (sectionOrder || [])
    .map((key) => (key === "customSections" ? "custom" : key))
    .filter((key): key is ContentSection => (CONTENT_SECTIONS as string[]).includes(key));
  const unique = Array.from(new Set(saved));
  return [...unique, ...CONTENT_SECTIONS.filter((key) => !unique.includes(key))];
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
  customFields = [],
  locked = false,
  onRegenerateFromForm,
  onOpenSource,
  toolbarEnd,
}) => {
  const formId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionKey>("personal");

  const order = contentOrder(data.sectionOrder);
  const allSections: SectionKey[] = ["personal", ...order];
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

  const moveSection = (key: ContentSection, delta: -1 | 1) => {
    const index = order.indexOf(key);
    onChange({ ...data, sectionOrder: ["personal", ...moveItem(order, index, delta)] });
  };

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
    custom: customSections.length + customFields.length,
  };

  const renderSectionBody = (key: SectionKey) => {
    switch (key) {
      case "personal":
        return (
          <div className="field-grid">
            <Field label="Full name">{personalInput("name", "Alex Morgan", "text", "input-personal-name")}</Field>
            <Field label="Headline">{personalInput("title", "Senior Software Engineer")}</Field>
            <Field label="Email">{personalInput("email", "alex@example.com", "email")}</Field>
            <Field label="Phone">{personalInput("phone", "+1 555 019 2834", "tel")}</Field>
            <Field label="Location">{personalInput("location", "San Francisco, CA")}</Field>
            <Field label="Website">{personalInput("website", "alexmorgan.dev")}</Field>
            <Field label="LinkedIn">{personalInput("linkedin", "linkedin.com/in/alexmorgan")}</Field>
            <Field label="GitHub">{personalInput("github", "github.com/alexmorgan")}</Field>
            <Field label="Summary" wide>
              <textarea
                rows={3}
                value={data.personal.summary || ""}
                placeholder="Two or three sentences about what you do and what you're looking for."
                onChange={(e) => setPersonal("summary", e.target.value)}
              />
            </Field>
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
                <Field label="Role">
                  <input type="text" value={exp.role} placeholder="Senior Software Engineer" onChange={(e) => updateExperience(exp.id, { role: e.target.value })} />
                </Field>
                <Field label="Company">
                  <input type="text" value={exp.company} placeholder="Acme Corp" onChange={(e) => updateExperience(exp.id, { company: e.target.value })} />
                </Field>
                <Field label="Location">
                  <input type="text" value={exp.location || ""} placeholder="Remote" onChange={(e) => updateExperience(exp.id, { location: e.target.value })} />
                </Field>
                <div className="field-pair">
                  <Field label="Start">
                    <input type="text" value={exp.startDate || ""} placeholder="Jan 2022" onChange={(e) => updateExperience(exp.id, { startDate: e.target.value })} />
                  </Field>
                  <Field label="End">
                    <input type="text" value={exp.endDate || ""} placeholder="Present" onChange={(e) => updateExperience(exp.id, { endDate: e.target.value })} />
                  </Field>
                </div>
                <BulletList
                  label="Highlight"
                  bullets={exp.bullets}
                  placeholder="Cut page load time by 40% by…"
                  addLabel="Add highlight"
                  onChange={(bullets) => updateExperience(exp.id, { bullets })}
                  testIds={{ move: `btn-move-exp-bullet-{dir}-${exp.id}` }}
                />
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
                <Field label="Degree or certificate">
                  <input type="text" value={edu.degree} placeholder="B.S. in Computer Science" onChange={(e) => updateEducation(edu.id, { degree: e.target.value })} />
                </Field>
                <Field label="School">
                  <input type="text" value={edu.institution} placeholder="University of Washington" onChange={(e) => updateEducation(edu.id, { institution: e.target.value })} />
                </Field>
                <Field label="Location">
                  <input type="text" value={edu.location || ""} placeholder="Seattle, WA" onChange={(e) => updateEducation(edu.id, { location: e.target.value })} />
                </Field>
                <div className="field-pair">
                  <Field label="Start">
                    <input type="text" value={edu.startDate || ""} placeholder="2015" onChange={(e) => updateEducation(edu.id, { startDate: e.target.value })} />
                  </Field>
                  <Field label="End">
                    <input type="text" value={edu.endDate || ""} placeholder="2019" onChange={(e) => updateEducation(edu.id, { endDate: e.target.value })} />
                  </Field>
                </div>
                <Field label="Details" wide hint="Honors, GPA or relevant coursework.">
                  <input type="text" value={edu.details || ""} placeholder="Magna cum laude, GPA 3.9" onChange={(e) => updateEducation(edu.id, { details: e.target.value })} />
                </Field>
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
                <Field label="Name">
                  <input type="text" value={proj.name} placeholder="Distributed key-value store" onChange={(e) => updateProject(proj.id, { name: e.target.value })} />
                </Field>
                <Field label="Technologies">
                  <input type="text" value={proj.technologies || ""} placeholder="Rust, Raft, gRPC" onChange={(e) => updateProject(proj.id, { technologies: e.target.value })} />
                </Field>
                <Field label="Link" wide>
                  <input type="text" value={proj.link || ""} placeholder="github.com/alex/kv-store" onChange={(e) => updateProject(proj.id, { link: e.target.value })} />
                </Field>
                <BulletList
                  label="Highlight"
                  bullets={proj.bullets}
                  placeholder="What it does and what you did"
                  addLabel="Add highlight"
                  onChange={(bullets) => updateProject(proj.id, { bullets })}
                  testIds={{ move: `btn-move-proj-bullet-{dir}-${proj.id}`, add: `btn-add-proj-bullet-${proj.id}` }}
                />
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
                <Field label="Category">
                  <input type="text" value={skill.category} placeholder="Languages" onChange={(e) => updateSkill(skill.id, { category: e.target.value })} />
                </Field>
                <Field label="Skills" hint="Separate with commas.">
                  <input type="text" value={skill.skills} placeholder="Rust, TypeScript, Python" onChange={(e) => updateSkill(skill.id, { skills: e.target.value })} />
                </Field>
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
            {customFields.length > 0 && (
              <div className="field-grid template-fields">
                <p className="template-fields-note field-wide">Extra fields used by this template</p>
                {customFields.map((field) => (
                  <Field key={field.key} label={field.label} wide={field.type === "textarea"}>
                    {field.type === "textarea" ? (
                      <textarea
                        rows={3}
                        value={data.customVariables?.[field.key] || ""}
                        onChange={(e) =>
                          onChange({ ...data, customVariables: { ...(data.customVariables || {}), [field.key]: e.target.value } })
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        value={data.customVariables?.[field.key] || ""}
                        onChange={(e) =>
                          onChange({ ...data, customVariables: { ...(data.customVariables || {}), [field.key]: e.target.value } })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
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
                <Field label="Section title" wide>
                  <input type="text" value={sec.title} placeholder="Certifications" onChange={(e) => updateCustom(sec.id, { title: e.target.value })} />
                </Field>
                <Field label="Text" wide hint="Optional. Shown above the bullet points.">
                  <textarea rows={2} value={sec.content || ""} onChange={(e) => updateCustom(sec.id, { content: e.target.value })} />
                </Field>
                <BulletList
                  label={`${sec.title || "Section"} bullet`}
                  bullets={sec.bullets || []}
                  placeholder="AWS Certified Solutions Architect, 2025"
                  addLabel="Add bullet point"
                  onChange={(bullets) => updateCustom(sec.id, { bullets })}
                  testIds={{ remove: `btn-remove-custom-bullet-${idx}`, add: `btn-add-custom-bullet-${idx}` }}
                />
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
            {SECTIONS[key].label}
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
            const contentIndex = key === "personal" ? -1 : order.indexOf(key);
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
                    <h2 id={`${sectionId(key)}-title`}>{SECTIONS[key].label}</h2>
                    <p className="section-hint">{SECTIONS[key].hint}</p>
                  </div>
                  {key !== "personal" && (
                    <div className="section-tools">
                      <button
                        type="button"
                        className="icon-button"
                        disabled={contentIndex === 0}
                        onClick={() => moveSection(key, -1)}
                        aria-label={`Move ${SECTIONS[key].label} section up`}
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
                        aria-label={`Move ${SECTIONS[key].label} section down`}
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
      </div>
      </div>
    </div>
  );
};

export default ResumeForm;
