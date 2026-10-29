import React, { useId, useState } from "react";
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
import {
  IconUser,
  IconBriefcase,
  IconGraduationCap,
  IconFolder,
  IconWrench,
  IconSparkles,
  IconLayers,
  IconPlus,
  IconTrash,
  IconChevronDown,
  IconChevronUp,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconX,
  IconPalette,
  IconCode,
} from "./Icons";

export type ResumeSectionId =
  | "all"
  | "personal"
  | "experience"
  | "education"
  | "projects"
  | "skills"
  | "custom";

interface ResumeFormProps {
  data: ResumeData;
  onChange: (newData: ResumeData) => void;
  customFields?: ExtractedTemplateField[];
  templateName?: string;
  onChangeTemplateClick?: () => void;
  /** True when the LaTeX source was edited by hand; the form is then read-only. */
  locked?: boolean;
  onRegenerateFromForm?: () => void;
  onOpenSource?: () => void;
}

type ContactFieldKey =
  | "email"
  | "phone"
  | "location"
  | "website"
  | "linkedin"
  | "github";

const CONTACT_FIELD_ORDER: ContactFieldKey[] = [
  "email",
  "phone",
  "location",
  "website",
  "linkedin",
  "github",
];

const CONTACT_FIELD_LABELS: Record<ContactFieldKey, string> = {
  email: "Email",
  phone: "Phone",
  location: "Location",
  website: "Website / Portfolio",
  linkedin: "LinkedIn",
  github: "GitHub",
};

/** A labelled input: ties the <label> to its control so clicks and screen readers work. */
function Field({ label, children }: { label: React.ReactNode; children: React.ReactElement }) {
  const id = useId();
  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      {React.cloneElement(children, { id })}
    </div>
  );
}

export const ResumeForm: React.FC<ResumeFormProps> = ({
  data,
  onChange,
  customFields = [],
  templateName,
  onChangeTemplateClick,
  locked = false,
  onRegenerateFromForm,
  onOpenSource,
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activeSection, setActiveSection] = useState<ResumeSectionId>("all");
  const formId = useId();

  const hasCustom =
    customFields.length > 0 || (data.customSections && data.customSections.length > 0);

  const defaultSectionOrder: Array<Exclude<ResumeSectionId, "all">> = [
    "personal",
    "experience",
    "education",
    "projects",
    "skills",
  ];
  if (hasCustom) {
    defaultSectionOrder.push("custom");
  }

  // Calculate effective section order
  const effectiveSectionOrder: Array<Exclude<ResumeSectionId, "all">> = (() => {
    if (!data.sectionOrder || !Array.isArray(data.sectionOrder)) {
      return defaultSectionOrder;
    }
    const filtered = data.sectionOrder.filter((s) =>
      defaultSectionOrder.includes(s as any)
    ) as Array<Exclude<ResumeSectionId, "all">>;
    for (const s of defaultSectionOrder) {
      if (!filtered.includes(s)) {
        filtered.push(s);
      }
    }
    return filtered;
  })();

  const SECTION_METADATA: Record<
    string,
    { label: string; icon: React.FC<{ size?: number; className?: string }> }
  > = {
    personal: { label: "Personal Info", icon: IconUser },
    experience: { label: "Experience", icon: IconBriefcase },
    education: { label: "Education", icon: IconGraduationCap },
    projects: { label: "Projects", icon: IconFolder },
    skills: { label: "Skills", icon: IconWrench },
    custom: { label: "Custom Fields", icon: IconSparkles },
  };

  const getAdjacentSections = (current: string) => {
    const idx = effectiveSectionOrder.indexOf(current as any);
    if (idx === -1) return { prev: null, next: null };
    const prev = idx > 0 ? effectiveSectionOrder[idx - 1] : null;
    const next = idx < effectiveSectionOrder.length - 1 ? effectiveSectionOrder[idx + 1] : null;
    return { prev, next };
  };

  const handleTabChange = (section: ResumeSectionId) => {
    setActiveSection(section);
    if (section !== "all") {
      setCollapsedSections((prev) => ({
        ...prev,
        [section]: false,
      }));
    }
  };

  const handleNavigate = (targetSection: Exclude<ResumeSectionId, "all">) => {
    setActiveSection(targetSection);
    setCollapsedSections((prev) => ({
      ...prev,
      [targetSection]: false,
    }));
  };

  // Section reordering
  const handleMoveSection = (secIndex: number, delta: -1 | 1) => {
    const newIdx = secIndex + delta;
    if (newIdx < 0 || newIdx >= effectiveSectionOrder.length) return;
    const newOrder = [...effectiveSectionOrder];
    const [moved] = newOrder.splice(secIndex, 1);
    newOrder.splice(newIdx, 0, moved);
    onChange({
      ...data,
      sectionOrder: newOrder,
    });
  };

  const handlePersonalChange = (field: keyof ResumeData["personal"], value: string) => {
    onChange({
      ...data,
      personal: {
        ...data.personal,
        [field]: value,
      },
    });
  };

  const handleMoveExperience = (expIdx: number, delta: -1 | 1) => {
    const newIdx = expIdx + delta;
    if (newIdx < 0 || newIdx >= data.experience.length) return;
    const newExp = [...data.experience];
    const [moved] = newExp.splice(expIdx, 1);
    newExp.splice(newIdx, 0, moved);
    onChange({
      ...data,
      experience: newExp,
    });
  };

  const handleAddExperience = () => {
    const newItem: ResumeExperienceItem = {
      id: createId("exp"),
      role: "",
      company: "",
      location: "",
      startDate: "",
      endDate: "Present",
      bullets: [""],
    };
    onChange({
      ...data,
      experience: [...data.experience, newItem],
    });
  };

  const handleUpdateExperience = (id: string, field: keyof ResumeExperienceItem, value: any) => {
    onChange({
      ...data,
      experience: data.experience.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  /** Whole entries go only after confirmation when they hold any text. */
  const confirmRemove = (what: string, hasContent: boolean) =>
    !hasContent || confirm(`Remove this ${what}? This can't be undone.`);

  const handleRemoveExperience = (id: string) => {
    const item = data.experience.find((e) => e.id === id);
    const hasContent =
      !!item && [item.role, item.company, item.location, item.startDate, ...item.bullets].some((v) => v?.trim());
    if (!confirmRemove("experience entry", hasContent)) return;
    onChange({
      ...data,
      experience: data.experience.filter((item) => item.id !== id),
    });
  };

  const handleAddExpBullet = (expId: string) => {
    onChange({
      ...data,
      experience: data.experience.map((item) =>
        item.id === expId ? { ...item, bullets: [...item.bullets, ""] } : item
      ),
    });
  };

  const handleUpdateExpBullet = (expId: string, bulletIndex: number, text: string) => {
    onChange({
      ...data,
      experience: data.experience.map((item) => {
        if (item.id !== expId) return item;
        const newBullets = [...item.bullets];
        newBullets[bulletIndex] = text;
        return { ...item, bullets: newBullets };
      }),
    });
  };

  const handleRemoveExpBullet = (expId: string, bulletIndex: number) => {
    onChange({
      ...data,
      experience: data.experience.map((item) => {
        if (item.id !== expId) return item;
        return {
          ...item,
          bullets: item.bullets.filter((_, idx) => idx !== bulletIndex),
        };
      }),
    });
  };

  const handleMoveExpBullet = (expId: string, bulletIndex: number, delta: -1 | 1) => {
    onChange({
      ...data,
      experience: data.experience.map((item) => {
        if (item.id !== expId) return item;
        const newIdx = bulletIndex + delta;
        if (newIdx < 0 || newIdx >= item.bullets.length) return item;
        const newBullets = [...item.bullets];
        const [moved] = newBullets.splice(bulletIndex, 1);
        newBullets.splice(newIdx, 0, moved);
        return { ...item, bullets: newBullets };
      }),
    });
  };

  // Education handlers
  const handleMoveEducation = (eduIdx: number, delta: -1 | 1) => {
    const newIdx = eduIdx + delta;
    if (newIdx < 0 || newIdx >= data.education.length) return;
    const newEdu = [...data.education];
    const [moved] = newEdu.splice(eduIdx, 1);
    newEdu.splice(newIdx, 0, moved);
    onChange({
      ...data,
      education: newEdu,
    });
  };

  const handleAddEducation = () => {
    const newItem: ResumeEducationItem = {
      id: createId("edu"),
      degree: "",
      institution: "",
      location: "",
      startDate: "",
      endDate: "",
      details: "",
    };
    onChange({
      ...data,
      education: [...data.education, newItem],
    });
  };

  const handleUpdateEducation = (id: string, field: keyof ResumeEducationItem, value: any) => {
    onChange({
      ...data,
      education: data.education.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const handleRemoveEducation = (id: string) => {
    const item = data.education.find((e) => e.id === id);
    const hasContent =
      !!item && [item.degree, item.institution, item.location, item.details].some((v) => v?.trim());
    if (!confirmRemove("education entry", hasContent)) return;
    onChange({
      ...data,
      education: data.education.filter((item) => item.id !== id),
    });
  };

  // Project handlers
  const handleMoveProject = (projIdx: number, delta: -1 | 1) => {
    const newIdx = projIdx + delta;
    if (newIdx < 0 || newIdx >= data.projects.length) return;
    const newProj = [...data.projects];
    const [moved] = newProj.splice(projIdx, 1);
    newProj.splice(newIdx, 0, moved);
    onChange({
      ...data,
      projects: newProj,
    });
  };

  const handleAddProject = () => {
    const newItem: ResumeProjectItem = {
      id: createId("proj"),
      name: "",
      technologies: "",
      link: "",
      bullets: [""],
    };
    onChange({
      ...data,
      projects: [...data.projects, newItem],
    });
  };

  const handleUpdateProject = (id: string, field: keyof ResumeProjectItem, value: any) => {
    onChange({
      ...data,
      projects: data.projects.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const handleRemoveProject = (id: string) => {
    const item = data.projects.find((p) => p.id === id);
    const hasContent =
      !!item && [item.name, item.technologies, item.link, ...item.bullets].some((v) => v?.trim());
    if (!confirmRemove("project", hasContent)) return;
    onChange({
      ...data,
      projects: data.projects.filter((item) => item.id !== id),
    });
  };

  const handleAddProjBullet = (projId: string) => {
    onChange({
      ...data,
      projects: data.projects.map((item) =>
        item.id === projId ? { ...item, bullets: [...item.bullets, ""] } : item
      ),
    });
  };

  const handleUpdateProjBullet = (projId: string, bulletIndex: number, text: string) => {
    onChange({
      ...data,
      projects: data.projects.map((item) => {
        if (item.id !== projId) return item;
        const newBullets = [...item.bullets];
        newBullets[bulletIndex] = text;
        return { ...item, bullets: newBullets };
      }),
    });
  };

  const handleRemoveProjBullet = (projId: string, bulletIndex: number) => {
    onChange({
      ...data,
      projects: data.projects.map((item) => {
        if (item.id !== projId) return item;
        return {
          ...item,
          bullets: item.bullets.filter((_, idx) => idx !== bulletIndex),
        };
      }),
    });
  };

  const handleMoveProjBullet = (projId: string, bulletIndex: number, delta: -1 | 1) => {
    onChange({
      ...data,
      projects: data.projects.map((item) => {
        if (item.id !== projId) return item;
        const newIdx = bulletIndex + delta;
        if (newIdx < 0 || newIdx >= item.bullets.length) return item;
        const newBullets = [...item.bullets];
        const [moved] = newBullets.splice(bulletIndex, 1);
        newBullets.splice(newIdx, 0, moved);
        return { ...item, bullets: newBullets };
      }),
    });
  };

  // Skill handlers
  const handleMoveSkill = (skillIdx: number, delta: -1 | 1) => {
    const newIdx = skillIdx + delta;
    if (newIdx < 0 || newIdx >= data.skills.length) return;
    const newSkills = [...data.skills];
    const [moved] = newSkills.splice(skillIdx, 1);
    newSkills.splice(newIdx, 0, moved);
    onChange({
      ...data,
      skills: newSkills,
    });
  };

  const handleAddSkill = () => {
    const newItem: ResumeSkillItem = {
      id: createId("skill"),
      category: "",
      skills: "",
    };
    onChange({
      ...data,
      skills: [...data.skills, newItem],
    });
  };

  const handleUpdateSkill = (id: string, field: keyof ResumeSkillItem, value: any) => {
    onChange({
      ...data,
      skills: data.skills.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const handleRemoveSkill = (id: string) => {
    const item = data.skills.find((sk) => sk.id === id);
    const hasContent = !!item && [item.category, item.skills].some((v) => v?.trim());
    if (!confirmRemove("skill category", hasContent)) return;
    onChange({
      ...data,
      skills: data.skills.filter((item) => item.id !== id),
    });
  };

  // Custom sections handlers
  const handleMoveCustomSection = (secIdx: number, delta: -1 | 1) => {
    const list = data.customSections || [];
    const newIdx = secIdx + delta;
    if (newIdx < 0 || newIdx >= list.length) return;
    const newSec = [...list];
    const [moved] = newSec.splice(secIdx, 1);
    newSec.splice(newIdx, 0, moved);
    onChange({
      ...data,
      customSections: newSec,
    });
  };

  const handleAddCustomSection = () => {
    const newItem: ResumeCustomSection = {
      id: createId("sec"),
      title: "Certifications & Awards",
      content: "",
      bullets: [""],
    };
    onChange({
      ...data,
      customSections: [...(data.customSections || []), newItem],
    });
  };

  const handleUpdateCustomSection = (id: string, field: keyof ResumeCustomSection, value: any) => {
    onChange({
      ...data,
      customSections: (data.customSections || []).map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    });
  };

  const handleRemoveCustomSection = (id: string) => {
    const item = (data.customSections || []).find((c) => c.id === id);
    const hasContent =
      !!item && [item.title, item.content, ...(item.bullets || [])].some((v) => v?.trim());
    if (!confirmRemove("custom section", hasContent)) return;
    onChange({
      ...data,
      customSections: (data.customSections || []).filter((item) => item.id !== id),
    });
  };

  const updateCustomSectionBullets = (secId: string, update: (bullets: string[]) => string[]) => {
    onChange({
      ...data,
      customSections: (data.customSections || []).map((item) =>
        item.id === secId ? { ...item, bullets: update(item.bullets || []) } : item
      ),
    });
  };

  const handleAddCustomBullet = (secId: string) =>
    updateCustomSectionBullets(secId, (bullets) => [...bullets, ""]);

  const handleUpdateCustomBullet = (secId: string, bulletIndex: number, text: string) =>
    updateCustomSectionBullets(secId, (bullets) =>
      bullets.map((b, idx) => (idx === bulletIndex ? text : b))
    );

  const handleRemoveCustomBullet = (secId: string, bulletIndex: number) =>
    updateCustomSectionBullets(secId, (bullets) => bullets.filter((_, idx) => idx !== bulletIndex));

  const handleMoveCustomBullet = (secId: string, bulletIndex: number, delta: -1 | 1) =>
    updateCustomSectionBullets(secId, (bullets) => {
      const newIdx = bulletIndex + delta;
      if (newIdx < 0 || newIdx >= bullets.length) return bullets;
      const next = [...bullets];
      const [moved] = next.splice(bulletIndex, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });

  const handleCustomVariableChange = (key: string, value: string) => {
    onChange({
      ...data,
      customVariables: {
        ...(data.customVariables || {}),
        [key]: value,
      },
    });
  };

  const toggleSection = (sectionKey: string) => {
    if (activeSection !== "all") return;
    setCollapsedSections((prev) => {
      const isCurrentlyOpen = !prev[sectionKey];
      if (isCurrentlyOpen) {
        return { ...prev, [sectionKey]: true };
      } else {
        return {
          personal: true,
          experience: true,
          education: true,
          projects: true,
          skills: true,
          custom: true,
          [sectionKey]: false,
        };
      }
    });
  };

  const renderTraversalFooter = (sectionKey: Exclude<ResumeSectionId, "all">) => {
    const { prev, next } = getAdjacentSections(sectionKey);
    return (
      <div className="section-traversal-bar" data-testid={`traversal-bar-${sectionKey}`}>
        {prev ? (
          <button
            type="button"
            className="btn-traversal btn-prev"
            onClick={() => handleNavigate(prev)}
            data-testid={`btn-nav-prev-${sectionKey}`}
            title={`Go to previous section: ${SECTION_METADATA[prev]?.label}`}
          >
            <IconChevronLeft size={14} />
            <span>{SECTION_METADATA[prev]?.label}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-traversal btn-secondary-nav"
            onClick={() => handleTabChange("all")}
            title="View all sections at once"
          >
            <IconLayers size={14} />
            <span>All Sections</span>
          </button>
        )}

        {next ? (
          <button
            type="button"
            className="btn-traversal btn-traversal-primary btn-next"
            onClick={() => handleNavigate(next)}
            data-testid={`btn-nav-next-${sectionKey}`}
            title={`Go to next section: ${SECTION_METADATA[next]?.label}`}
          >
            <span>{SECTION_METADATA[next]?.label}</span>
            <IconChevronRight size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="btn-traversal btn-traversal-primary"
            onClick={() => handleTabChange("all")}
            title="Done traversing, view all sections"
          >
            <IconCheck size={14} />
            <span>Finish & View All</span>
          </button>
        )}
      </div>
    );
  };

  // Section Cards Renderer
  const renderSectionCard = (
    sectionKey: Exclude<ResumeSectionId, "all">,
    secIdx: number
  ) => {
    const isCollapsed = collapsedSections[sectionKey] && activeSection === "all";
    const sectionHeading = (
      <>
        <span className="icon" aria-hidden="true">
          {React.createElement(SECTION_METADATA[sectionKey].icon, { size: 16 })}
        </span>
        <span>
          {SECTION_METADATA[sectionKey].label}
          {sectionKey === "experience" && ` (${data.experience.length})`}
          {sectionKey === "education" && ` (${data.education.length})`}
          {sectionKey === "projects" && ` (${data.projects.length})`}
          {sectionKey === "skills" && ` (${data.skills.length})`}
        </span>
      </>
    );

    return (
      <div
        key={sectionKey}
        className="form-card"
        data-testid={`section-card-${sectionKey}`}
      >
        <div
          className={`form-card-header ${activeSection !== "all" ? "no-collapse" : ""}`}
          onClick={() => toggleSection(sectionKey)}
        >
          <h2 className="header-title">
            {activeSection === "all" ? (
              <button
                type="button"
                className="header-toggle"
                aria-expanded={!isCollapsed}
                aria-controls={`${formId}-${sectionKey}-body`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection(sectionKey);
                }}
              >
                {sectionHeading}
              </button>
            ) : (
              <span className="header-toggle">{sectionHeading}</span>
            )}
          </h2>

          <div className="header-actions">
            {activeSection === "all" && (
              <div
                className="section-reorder-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="btn-section-reorder"
                  disabled={secIdx === 0}
                  onClick={() => handleMoveSection(secIdx, -1)}
                  data-testid={`btn-move-section-up-${sectionKey}`}
                  title={`Move ${SECTION_METADATA[sectionKey].label} section up`}
                >
                  <IconChevronUp size={14} />
                </button>
                <button
                  type="button"
                  className="btn-section-reorder"
                  disabled={secIdx === effectiveSectionOrder.length - 1}
                  onClick={() => handleMoveSection(secIdx, 1)}
                  data-testid={`btn-move-section-down-${sectionKey}`}
                  title={`Move ${SECTION_METADATA[sectionKey].label} section down`}
                >
                  <IconChevronDown size={14} />
                </button>
              </div>
            )}

            {activeSection === "all" && (
              <span className="toggle-indicator" aria-hidden="true">
                {isCollapsed ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronUp size={14} />
                )}
              </span>
            )}
          </div>
        </div>

        {(!isCollapsed || (activeSection as string) === sectionKey) && (
          <div className="form-card-body" id={`${formId}-${sectionKey}-body`}>
            {/* PERSONAL INFO CARD BODY */}
            {sectionKey === "personal" && (
              <>
                <div className="form-row-2">
                  <Field label="Full Name *">
                    <input
                      type="text"
                      placeholder="e.g. Alex Morgan"
                      value={data.personal.name || ""}
                      onChange={(e) => handlePersonalChange("name", e.target.value)}
                      data-testid="input-personal-name"
                    />
                  </Field>
                  <Field label="Job Title / Headline">
                    <input
                      type="text"
                      placeholder="e.g. Senior Software Engineer"
                      value={data.personal.title || ""}
                      onChange={(e) => handlePersonalChange("title", e.target.value)}
                    />
                  </Field>
                </div>

                <div className="form-row-3">
                  {CONTACT_FIELD_ORDER.map((fieldKey) => (
                    <div
                      key={fieldKey}
                      className="form-group"
                      data-testid={`personal-field-${fieldKey}`}
                    >
                      <label htmlFor={`${formId}-personal-${fieldKey}`}>
                        {CONTACT_FIELD_LABELS[fieldKey]}
                      </label>

                      {fieldKey === "email" && (
                        <input
                          type="email"
                          placeholder="alex@example.com"
                          id={`${formId}-personal-email`}
                          value={data.personal.email || ""}
                          onChange={(e) => handlePersonalChange("email", e.target.value)}
                        />
                      )}
                      {fieldKey === "phone" && (
                        <input
                          type="tel"
                          placeholder="+1 (555) 019-2834"
                          id={`${formId}-personal-phone`}
                          value={data.personal.phone || ""}
                          onChange={(e) => handlePersonalChange("phone", e.target.value)}
                        />
                      )}
                      {fieldKey === "location" && (
                        <input
                          type="text"
                          placeholder="San Francisco, CA"
                          id={`${formId}-personal-location`}
                          value={data.personal.location || ""}
                          onChange={(e) => handlePersonalChange("location", e.target.value)}
                        />
                      )}
                      {fieldKey === "website" && (
                        <input
                          type="text"
                          placeholder="https://alexmorgan.dev"
                          id={`${formId}-personal-website`}
                          value={data.personal.website || ""}
                          onChange={(e) => handlePersonalChange("website", e.target.value)}
                        />
                      )}
                      {fieldKey === "linkedin" && (
                        <input
                          type="text"
                          placeholder="linkedin.com/in/alexmorgan"
                          id={`${formId}-personal-linkedin`}
                          value={data.personal.linkedin || ""}
                          onChange={(e) => handlePersonalChange("linkedin", e.target.value)}
                        />
                      )}
                      {fieldKey === "github" && (
                        <input
                          type="text"
                          placeholder="github.com/alexmorgan"
                          id={`${formId}-personal-github`}
                          value={data.personal.github || ""}
                          onChange={(e) => handlePersonalChange("github", e.target.value)}
                        />
                      )}
                    </div>
                  ))}
                </div>

                <Field label="Professional Summary">
                  <textarea
                    rows={3}
                    placeholder="Brief summary of your professional background and core strengths..."
                    value={data.personal.summary || ""}
                    onChange={(e) => handlePersonalChange("summary", e.target.value)}
                  />
                </Field>
                {renderTraversalFooter("personal")}
              </>
            )}

            {/* EXPERIENCE CARD BODY */}
            {sectionKey === "experience" && (
              <>
                {data.experience.map((exp, expIdx) => (
                  <div
                    key={exp.id}
                    className="entry-card"
                    data-testid={`experience-item-${expIdx}`}
                  >
                    <div className="entry-header">
                      <div className="entry-title-group">
                        <h3>{exp.role || exp.company || `Role #${expIdx + 1}`}</h3>
                        <span className="entry-index-badge">#{expIdx + 1}</span>
                      </div>
                      <div className="entry-actions">
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={expIdx === 0}
                          onClick={() => handleMoveExperience(expIdx, -1)}
                          data-testid={`btn-move-experience-up-${expIdx}`}
                          title="Move experience entry up"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={expIdx === data.experience.length - 1}
                          onClick={() => handleMoveExperience(expIdx, 1)}
                          data-testid={`btn-move-experience-down-${expIdx}`}
                          title="Move experience entry down"
                        >
                          <IconChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger-icon"
                          onClick={() => handleRemoveExperience(exp.id)}
                          data-testid={`btn-remove-experience-${expIdx}`}
                          title="Delete experience entry"
                        >
                          <IconTrash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    <div className="form-row-2">
                      <Field label="Role / Position">
                        <input
                          type="text"
                          placeholder="e.g. Senior Software Engineer"
                          value={exp.role}
                          onChange={(e) =>
                            handleUpdateExperience(exp.id, "role", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Company / Organization">
                        <input
                          type="text"
                          placeholder="e.g. Acme Corp"
                          value={exp.company}
                          onChange={(e) =>
                            handleUpdateExperience(exp.id, "company", e.target.value)
                          }
                        />
                      </Field>
                    </div>

                    <div className="form-row-3">
                      <Field label="Location">
                        <input
                          type="text"
                          placeholder="e.g. San Francisco, CA"
                          value={exp.location || ""}
                          onChange={(e) =>
                            handleUpdateExperience(exp.id, "location", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Start Date">
                        <input
                          type="text"
                          placeholder="e.g. Jan 2022"
                          value={exp.startDate || ""}
                          onChange={(e) =>
                            handleUpdateExperience(
                              exp.id,
                              "startDate",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <Field label="End Date">
                        <input
                          type="text"
                          placeholder="e.g. Present"
                          value={exp.endDate || ""}
                          onChange={(e) =>
                            handleUpdateExperience(
                              exp.id,
                              "endDate",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                    </div>

                    <div className="bullets-section">
                      {exp.bullets.map((bullet, bIdx) => (
                        <div key={bIdx} className="bullet-row">
                          <span className="bullet-dot">•</span>
                          <input
                            type="text"
                            aria-label={`Bullet ${bIdx + 1}`}
                            placeholder="Describe key responsibilities or quantifiable results..."
                            value={bullet}
                            onChange={(e) =>
                              handleUpdateExpBullet(exp.id, bIdx, e.target.value)
                            }
                          />
                          <div className="bullet-actions">
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === 0}
                              onClick={() => handleMoveExpBullet(exp.id, bIdx, -1)}
                              data-testid={`btn-move-exp-bullet-up-${exp.id}-${bIdx}`}
                              title="Move bullet up"
                            >
                              <IconChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === exp.bullets.length - 1}
                              onClick={() => handleMoveExpBullet(exp.id, bIdx, 1)}
                              data-testid={`btn-move-exp-bullet-down-${exp.id}-${bIdx}`}
                              title="Move bullet down"
                            >
                              <IconChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-remove"
                              onClick={() => handleRemoveExpBullet(exp.id, bIdx)}
                              data-testid={`btn-remove-exp-bullet-${exp.id}-${bIdx}`}
                              title="Remove bullet"
                            >
                              <IconX size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-add-bullet"
                        onClick={() => handleAddExpBullet(exp.id)}
                      >
                        <IconPlus size={13} />
                        <span>Add Bullet</span>
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-add-entry"
                  onClick={handleAddExperience}
                  data-testid="btn-add-experience"
                >
                  <IconPlus size={14} />
                  <span>Add Experience Entry</span>
                </button>

                {renderTraversalFooter("experience")}
              </>
            )}

            {/* EDUCATION CARD BODY */}
            {sectionKey === "education" && (
              <>
                {data.education.map((edu, eduIdx) => (
                  <div
                    key={edu.id}
                    className="entry-card"
                    data-testid={`education-item-${eduIdx}`}
                  >
                    <div className="entry-header">
                      <div className="entry-title-group">
                        <h3>{edu.degree || edu.institution || `Education #${eduIdx + 1}`}</h3>
                        <span className="entry-index-badge">#{eduIdx + 1}</span>
                      </div>
                      <div className="entry-actions">
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={eduIdx === 0}
                          onClick={() => handleMoveEducation(eduIdx, -1)}
                          data-testid={`btn-move-education-up-${eduIdx}`}
                          title="Move education entry up"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={eduIdx === data.education.length - 1}
                          onClick={() => handleMoveEducation(eduIdx, 1)}
                          data-testid={`btn-move-education-down-${eduIdx}`}
                          title="Move education entry down"
                        >
                          <IconChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger-icon"
                          onClick={() => handleRemoveEducation(edu.id)}
                          data-testid={`btn-remove-education-${eduIdx}`}
                          title="Delete education entry"
                        >
                          <IconTrash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    <div className="form-row-2">
                      <Field label="Degree / Certificate">
                        <input
                          type="text"
                          placeholder="e.g. B.S. in Computer Science"
                          value={edu.degree}
                          onChange={(e) =>
                            handleUpdateEducation(edu.id, "degree", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Institution / University">
                        <input
                          type="text"
                          placeholder="e.g. University of California, Berkeley"
                          value={edu.institution}
                          onChange={(e) =>
                            handleUpdateEducation(edu.id, "institution", e.target.value)
                          }
                        />
                      </Field>
                    </div>

                    <div className="form-row-3">
                      <Field label="Location">
                        <input
                          type="text"
                          placeholder="e.g. Berkeley, CA"
                          value={edu.location || ""}
                          onChange={(e) =>
                            handleUpdateEducation(edu.id, "location", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Start Date">
                        <input
                          type="text"
                          placeholder="e.g. 2017"
                          value={edu.startDate || ""}
                          onChange={(e) =>
                            handleUpdateEducation(
                              edu.id,
                              "startDate",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <Field label="End Date">
                        <input
                          type="text"
                          placeholder="e.g. 2021"
                          value={edu.endDate || ""}
                          onChange={(e) =>
                            handleUpdateEducation(
                              edu.id,
                              "endDate",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                    </div>

                    <Field label="Honors, GPA or Coursework">
                      <input
                        type="text"
                        placeholder="e.g. Magna Cum Laude, GPA: 3.9/4.0, Algorithms"
                        value={edu.details || ""}
                        onChange={(e) =>
                          handleUpdateEducation(edu.id, "details", e.target.value)
                        }
                      />
                    </Field>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-add-entry"
                  onClick={handleAddEducation}
                  data-testid="btn-add-education"
                >
                  <IconPlus size={14} />
                  <span>Add Education Entry</span>
                </button>

                {renderTraversalFooter("education")}
              </>
            )}

            {/* PROJECTS CARD BODY */}
            {sectionKey === "projects" && (
              <>
                {data.projects.map((proj, pIdx) => (
                  <div
                    key={proj.id}
                    className="entry-card"
                    data-testid={`project-item-${pIdx}`}
                  >
                    <div className="entry-header">
                      <div className="entry-title-group">
                        <h3>{proj.name || `Project #${pIdx + 1}`}</h3>
                        <span className="entry-index-badge">#{pIdx + 1}</span>
                      </div>
                      <div className="entry-actions">
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={pIdx === 0}
                          onClick={() => handleMoveProject(pIdx, -1)}
                          data-testid={`btn-move-project-up-${pIdx}`}
                          title="Move project entry up"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={pIdx === data.projects.length - 1}
                          onClick={() => handleMoveProject(pIdx, 1)}
                          data-testid={`btn-move-project-down-${pIdx}`}
                          title="Move project entry down"
                        >
                          <IconChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger-icon"
                          onClick={() => handleRemoveProject(proj.id)}
                          data-testid={`btn-remove-project-${pIdx}`}
                          title="Delete project entry"
                        >
                          <IconTrash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    <div className="form-row-3">
                      <Field label="Project Name">
                        <input
                          type="text"
                          placeholder="e.g. Distributed Key-Value Store"
                          value={proj.name}
                          onChange={(e) =>
                            handleUpdateProject(proj.id, "name", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Technologies Used">
                        <input
                          type="text"
                          placeholder="e.g. Rust, Raft, gRPC, Tokio"
                          value={proj.technologies || ""}
                          onChange={(e) =>
                            handleUpdateProject(
                              proj.id,
                              "technologies",
                              e.target.value
                            )
                          }
                        />
                      </Field>
                      <Field label="Project Link / Demo URL">
                        <input
                          type="text"
                          placeholder="https://github.com/alex/project"
                          value={proj.link || ""}
                          onChange={(e) =>
                            handleUpdateProject(proj.id, "link", e.target.value)
                          }
                        />
                      </Field>
                    </div>

                    <div className="bullets-section">
                      <span className="bullets-label">Project Highlights</span>
                      {proj.bullets.map((bullet, bIdx) => (
                        <div key={bIdx} className="bullet-row">
                          <span className="bullet-dot">•</span>
                          <input
                            type="text"
                            aria-label={`Project highlight ${bIdx + 1}`}
                            placeholder="Bullet describing implementation or impact..."
                            value={bullet}
                            onChange={(e) =>
                              handleUpdateProjBullet(proj.id, bIdx, e.target.value)
                            }
                          />
                          <div className="bullet-actions">
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === 0}
                              onClick={() => handleMoveProjBullet(proj.id, bIdx, -1)}
                              data-testid={`btn-move-proj-bullet-up-${proj.id}-${bIdx}`}
                              title="Move bullet up"
                            >
                              <IconChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === proj.bullets.length - 1}
                              onClick={() => handleMoveProjBullet(proj.id, bIdx, 1)}
                              data-testid={`btn-move-proj-bullet-down-${proj.id}-${bIdx}`}
                              title="Move bullet down"
                            >
                              <IconChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-remove"
                              onClick={() => handleRemoveProjBullet(proj.id, bIdx)}
                              data-testid={`btn-remove-proj-bullet-${proj.id}-${bIdx}`}
                              title="Remove bullet"
                            >
                              <IconX size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-add-bullet"
                        onClick={() => handleAddProjBullet(proj.id)}
                        data-testid={`btn-add-proj-bullet-${proj.id}`}
                      >
                        <IconPlus size={13} />
                        <span>Add Bullet</span>
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-add-entry"
                  onClick={handleAddProject}
                  data-testid="btn-add-project"
                >
                  <IconPlus size={14} />
                  <span>Add Project Entry</span>
                </button>

                {renderTraversalFooter("projects")}
              </>
            )}

            {/* SKILLS CARD BODY */}
            {sectionKey === "skills" && (
              <>
                {data.skills.map((skill, sIdx) => (
                  <div
                    key={skill.id}
                    className="entry-card"
                    data-testid={`skill-item-${sIdx}`}
                  >
                    <div className="entry-header">
                      <div className="entry-title-group">
                        <h3>{skill.category || `Category #${sIdx + 1}`}</h3>
                        <span className="entry-index-badge">#{sIdx + 1}</span>
                      </div>
                      <div className="entry-actions">
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={sIdx === 0}
                          onClick={() => handleMoveSkill(sIdx, -1)}
                          data-testid={`btn-move-skill-up-${sIdx}`}
                          title="Move skill category up"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={sIdx === data.skills.length - 1}
                          onClick={() => handleMoveSkill(sIdx, 1)}
                          data-testid={`btn-move-skill-down-${sIdx}`}
                          title="Move skill category down"
                        >
                          <IconChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger-icon"
                          onClick={() => handleRemoveSkill(skill.id)}
                          data-testid={`btn-remove-skill-${sIdx}`}
                          title="Delete skill category"
                        >
                          <IconTrash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    <div className="form-row-2">
                      <Field label="Category">
                        <input
                          type="text"
                          placeholder="e.g. Languages, Frameworks, Cloud"
                          value={skill.category}
                          onChange={(e) =>
                            handleUpdateSkill(skill.id, "category", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="Skills / Items (comma separated)">
                        <input
                          type="text"
                          placeholder="e.g. Rust, TypeScript, Python, Docker"
                          value={skill.skills}
                          onChange={(e) =>
                            handleUpdateSkill(skill.id, "skills", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-add-entry"
                  onClick={handleAddSkill}
                  data-testid="btn-add-skill"
                >
                  <IconPlus size={14} />
                  <span>Add Skill Category</span>
                </button>

                {renderTraversalFooter("skills")}
              </>
            )}

            {/* CUSTOM CARD BODY */}
            {sectionKey === "custom" && (
              <>
                {customFields.map((field) => (
                  <div key={field.key} className="form-group">
                    <label htmlFor={`${formId}-custom-${field.key}`}>{field.label}</label>
                    {field.type === "textarea" ? (
                      <textarea
                        id={`${formId}-custom-${field.key}`}
                        rows={3}
                        value={data.customVariables?.[field.key] || ""}
                        onChange={(e) =>
                          handleCustomVariableChange(field.key, e.target.value)
                        }
                      />
                    ) : (
                      <input
                        id={`${formId}-custom-${field.key}`}
                        type="text"
                        value={data.customVariables?.[field.key] || ""}
                        onChange={(e) =>
                          handleCustomVariableChange(field.key, e.target.value)
                        }
                      />
                    )}
                  </div>
                ))}

                {(data.customSections || []).map((sec, secIdx) => (
                  <div key={sec.id} className="entry-card">
                    <div className="entry-header">
                      <div className="entry-title-group">
                        <h3>{sec.title || `Custom Section #${secIdx + 1}`}</h3>
                        <span className="entry-index-badge">#{secIdx + 1}</span>
                      </div>
                      <div className="entry-actions">
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={secIdx === 0}
                          onClick={() => handleMoveCustomSection(secIdx, -1)}
                          data-testid={`btn-move-custom-up-${secIdx}`}
                          title="Move custom section up"
                        >
                          <IconChevronUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-entry-reorder"
                          disabled={
                            secIdx === (data.customSections || []).length - 1
                          }
                          onClick={() => handleMoveCustomSection(secIdx, 1)}
                          data-testid={`btn-move-custom-down-${secIdx}`}
                          title="Move custom section down"
                        >
                          <IconChevronDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="btn-danger-icon"
                          onClick={() => handleRemoveCustomSection(sec.id)}
                          data-testid={`btn-remove-custom-${secIdx}`}
                          title="Delete custom section"
                        >
                          <IconTrash size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                    <Field label="Section Title">
                      <input
                        type="text"
                        value={sec.title}
                        onChange={(e) =>
                          handleUpdateCustomSection(sec.id, "title", e.target.value)
                        }
                      />
                    </Field>
                    <Field label="Content">
                      <textarea
                        rows={2}
                        value={sec.content || ""}
                        onChange={(e) =>
                          handleUpdateCustomSection(sec.id, "content", e.target.value)
                        }
                      />
                    </Field>
                    <div className="bullets-section">
                      <span className="bullets-label">Bullet points</span>
                      {(sec.bullets || []).map((bullet, bIdx) => (
                        <div key={bIdx} className="bullet-row">
                          <span className="bullet-dot" aria-hidden="true">•</span>
                          <input
                            type="text"
                            aria-label={`${sec.title || "Custom section"} bullet ${bIdx + 1}`}
                            placeholder="e.g. AWS Certified Solutions Architect (2025)"
                            value={bullet}
                            onChange={(e) => handleUpdateCustomBullet(sec.id, bIdx, e.target.value)}
                          />
                          <div className="bullet-actions">
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === 0}
                              onClick={() => handleMoveCustomBullet(sec.id, bIdx, -1)}
                              title="Move bullet up"
                              aria-label="Move bullet up"
                            >
                              <IconChevronUp size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-reorder"
                              disabled={bIdx === (sec.bullets || []).length - 1}
                              onClick={() => handleMoveCustomBullet(sec.id, bIdx, 1)}
                              title="Move bullet down"
                              aria-label="Move bullet down"
                            >
                              <IconChevronDown size={12} />
                            </button>
                            <button
                              type="button"
                              className="btn-bullet-remove"
                              onClick={() => handleRemoveCustomBullet(sec.id, bIdx)}
                              data-testid={`btn-remove-custom-bullet-${secIdx}-${bIdx}`}
                              title="Remove bullet"
                              aria-label="Remove bullet"
                            >
                              <IconX size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn-add-bullet"
                        onClick={() => handleAddCustomBullet(sec.id)}
                        data-testid={`btn-add-custom-bullet-${secIdx}`}
                      >
                        <IconPlus size={13} />
                        <span>Add Bullet</span>
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="btn-add-entry"
                  onClick={handleAddCustomSection}
                >
                  <IconPlus size={14} />
                  <span>Add Custom Section</span>
                </button>

                {renderTraversalFooter("custom")}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="resume-form-container" data-testid="resume-form">
      {/* Template Header Banner */}
      <div className="form-template-banner">
        <div className="form-template-info">
          <span className="template-label">Active Template</span>
          <span className="template-badge">{templateName || "Modern Professional"}</span>
        </div>
        {onChangeTemplateClick && (
          <button
            type="button"
            className="btn-change-template"
            onClick={onChangeTemplateClick}
            title="Browse or import templates"
          >
            <IconPalette size={14} />
            <span>Change Template</span>
          </button>
        )}
      </div>

      {/* Section Navigation Bar */}
      <div className="section-nav-container">
        <div
          className="section-tabs-bar"
          role="group"
          aria-label="Resume sections"
          onWheel={(e) => {
            if (e.deltaY !== 0) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          <button
            type="button"
            aria-pressed={activeSection === "all"}
            className={`section-tab-btn ${activeSection === "all" ? "active" : ""}`}
            onClick={() => handleTabChange("all")}
            data-testid="section-tab-all"
            title="Show all resume sections at once"
          >
            <span className="tab-icon">
              <IconLayers size={14} />
            </span>
            <span className="tab-label">All</span>
          </button>

          {effectiveSectionOrder.map((secKey) => {
            const meta = SECTION_METADATA[secKey];
            if (!meta) return null;
            const Icon = meta.icon;
            let count: number | undefined;
            if (secKey === "experience") count = data.experience.length;
            else if (secKey === "education") count = data.education.length;
            else if (secKey === "projects") count = data.projects.length;
            else if (secKey === "skills") count = data.skills.length;
            else if (secKey === "custom")
              count = (data.customSections?.length || 0) + customFields.length;

            return (
              <button
                key={secKey}
                type="button"
                aria-pressed={activeSection === secKey}
                className={`section-tab-btn ${activeSection === secKey ? "active" : ""}`}
                onClick={() => handleTabChange(secKey)}
                data-testid={`section-tab-${secKey}`}
                title={meta.label}
              >
                <span className="tab-icon" aria-hidden="true">
                  <Icon size={14} />
                </span>
                <span className="tab-label">{meta.label}</span>
                {count !== undefined && (
                  <span className="section-badge">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {locked && (
        <div className="form-locked-banner" role="status" data-testid="form-locked-banner">
          <p>
            <strong>The form is paused.</strong> This document's LaTeX source was edited by
            hand, so form changes would overwrite it. Keep editing the source, or regenerate
            the source from the form (this discards the manual edits).
          </p>
          <div className="form-locked-actions">
            {onOpenSource && (
              <button type="button" className="btn-secondary" onClick={onOpenSource}>
                <IconCode size={14} />
                <span>Edit LaTeX Source</span>
              </button>
            )}
            {onRegenerateFromForm && (
              <button
                type="button"
                className="btn-danger-outline"
                onClick={onRegenerateFromForm}
                data-testid="btn-regenerate-from-form"
              >
                Regenerate from form
              </button>
            )}
          </div>
        </div>
      )}

      {/* RENDER SECTIONS */}
      <fieldset className="form-sections" disabled={locked}>
        <legend className="visually-hidden">Resume content</legend>
        {activeSection === "all" ? (
          effectiveSectionOrder.map((secKey, idx) => renderSectionCard(secKey, idx))
        ) : (
          renderSectionCard(
            activeSection,
            effectiveSectionOrder.indexOf(activeSection)
          )
        )}
      </fieldset>
    </div>
  );
};

export default ResumeForm;
