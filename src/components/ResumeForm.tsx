import React, { useState } from "react";
import {
  ResumeData,
  ResumeExperienceItem,
  ResumeEducationItem,
  ResumeProjectItem,
  ResumeSkillItem,
  ResumeCustomSection,
  ExtractedTemplateField,
} from "../types";

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
}

export const ResumeForm: React.FC<ResumeFormProps> = ({
  data,
  onChange,
  customFields = [],
  templateName,
  onChangeTemplateClick,
}) => {
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [activeSection, setActiveSection] = useState<ResumeSectionId>("all");

  const hasCustom =
    customFields.length > 0 || (data.customSections && data.customSections.length > 0);

  const sequentialSections: Array<Exclude<ResumeSectionId, "all">> = [
    "personal",
    "experience",
    "education",
    "projects",
    "skills",
  ];
  if (hasCustom) {
    sequentialSections.push("custom");
  }

  const SECTION_METADATA: Record<string, { label: string; icon: string }> = {
    personal: { label: "Personal Info", icon: "👤" },
    experience: { label: "Experience", icon: "💼" },
    education: { label: "Education", icon: "🎓" },
    projects: { label: "Projects", icon: "🚀" },
    skills: { label: "Skills", icon: "🛠️" },
    custom: { label: "Custom Fields", icon: "✨" },
  };

  const getAdjacentSections = (current: string) => {
    const idx = sequentialSections.indexOf(current as any);
    if (idx === -1) return { prev: null, next: null };
    const prev = idx > 0 ? sequentialSections[idx - 1] : null;
    const next = idx < sequentialSections.length - 1 ? sequentialSections[idx + 1] : null;
    return { prev, next };
  };

  const renderTraversalFooter = (sectionKey: Exclude<ResumeSectionId, "all">) => {
    const { prev, next } = getAdjacentSections(sectionKey);
    return (
      <div className="section-traversal-bar" data-testid={`traversal-bar-${sectionKey}`}>
        {prev ? (
          <button
            type="button"
            className="btn-traversal btn-prev"
            onClick={() => setActiveSection(prev)}
            data-testid={`btn-nav-prev-${sectionKey}`}
            title={`Go to previous section: ${SECTION_METADATA[prev]?.label}`}
          >
            ← {SECTION_METADATA[prev]?.icon} {SECTION_METADATA[prev]?.label}
          </button>
        ) : (
          <button
            type="button"
            className="btn-traversal btn-secondary-nav"
            onClick={() => setActiveSection("all")}
            title="View all sections at once"
          >
            📑 View All Sections
          </button>
        )}

        <button
          type="button"
          className="btn-traversal btn-traversal-center"
          onClick={() => setActiveSection(activeSection === "all" ? sectionKey : "all")}
          title={activeSection === "all" ? "Focus on this section only" : "View all sections"}
        >
          {activeSection === "all" ? `🔍 Focus ${SECTION_METADATA[sectionKey]?.label}` : "📑 View All Sections"}
        </button>

        {next ? (
          <button
            type="button"
            className="btn-traversal btn-traversal-primary btn-next"
            onClick={() => setActiveSection(next)}
            data-testid={`btn-nav-next-${sectionKey}`}
            title={`Go to next section: ${SECTION_METADATA[next]?.label}`}
          >
            {SECTION_METADATA[next]?.icon} {SECTION_METADATA[next]?.label} →
          </button>
        ) : (
          <button
            type="button"
            className="btn-traversal btn-traversal-primary"
            onClick={() => setActiveSection("all")}
            title="Done traversing, view all sections"
          >
            ✓ Finish & View All
          </button>
        )}
      </div>
    );
  };

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  // Helper to update personal info
  const handlePersonalChange = (field: keyof ResumeData["personal"], value: string) => {
    onChange({
      ...data,
      personal: {
        ...data.personal,
        [field]: value,
      },
    });
  };

  // Experience handlers
  const handleAddExperience = () => {
    const newItem: ResumeExperienceItem = {
      id: "exp-" + Date.now(),
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

  const handleRemoveExperience = (id: string) => {
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

  // Education handlers
  const handleAddEducation = () => {
    const newItem: ResumeEducationItem = {
      id: "edu-" + Date.now(),
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
    onChange({
      ...data,
      education: data.education.filter((item) => item.id !== id),
    });
  };

  // Project handlers
  const handleAddProject = () => {
    const newItem: ResumeProjectItem = {
      id: "proj-" + Date.now(),
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

  // Skill handlers
  const handleAddSkill = () => {
    const newItem: ResumeSkillItem = {
      id: "skill-" + Date.now(),
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
    onChange({
      ...data,
      skills: data.skills.filter((item) => item.id !== id),
    });
  };

  // Custom sections handlers
  const handleAddCustomSection = () => {
    const newItem: ResumeCustomSection = {
      id: "sec-" + Date.now(),
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
    onChange({
      ...data,
      customSections: (data.customSections || []).filter((item) => item.id !== id),
    });
  };

  const handleCustomVariableChange = (key: string, value: string) => {
    onChange({
      ...data,
      customVariables: {
        ...(data.customVariables || {}),
        [key]: value,
      },
    });
  };

  return (
    <div className="resume-form-container" data-testid="resume-form">
      {/* Template Header Banner */}
      <div className="form-template-banner">
        <div className="form-template-info">
          <span className="template-label">Active Template:</span>
          <span className="template-badge">{templateName || "Modern Professional"}</span>
        </div>
        {onChangeTemplateClick && (
          <button
            type="button"
            className="btn-change-template"
            onClick={onChangeTemplateClick}
            title="Browse or import templates"
          >
            🎨 Change / Import Template
          </button>
        )}
      </div>

      {/* Section Navigation Bar */}
      <div className="section-nav-container">
        <div className="section-tabs-bar" role="tablist" aria-label="Resume Sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "all"}
            className={`section-tab-btn ${activeSection === "all" ? "active" : ""}`}
            onClick={() => setActiveSection("all")}
            data-testid="section-tab-all"
            title="Show all resume sections at once"
          >
            <span className="tab-icon">📑</span>
            <span className="tab-label">All Sections</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "personal"}
            className={`section-tab-btn ${activeSection === "personal" ? "active" : ""}`}
            onClick={() => setActiveSection("personal")}
            data-testid="section-tab-personal"
            title="Personal information & contact details"
          >
            <span className="tab-icon">👤</span>
            <span className="tab-label">Personal</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "experience"}
            className={`section-tab-btn ${activeSection === "experience" ? "active" : ""}`}
            onClick={() => setActiveSection("experience")}
            data-testid="section-tab-experience"
            title="Work experience and employment history"
          >
            <span className="tab-icon">💼</span>
            <span className="tab-label">Experience</span>
            <span className="section-badge">{data.experience.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "education"}
            className={`section-tab-btn ${activeSection === "education" ? "active" : ""}`}
            onClick={() => setActiveSection("education")}
            data-testid="section-tab-education"
            title="Degrees, schools, and credentials"
          >
            <span className="tab-icon">🎓</span>
            <span className="tab-label">Education</span>
            <span className="section-badge">{data.education.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "projects"}
            className={`section-tab-btn ${activeSection === "projects" ? "active" : ""}`}
            onClick={() => setActiveSection("projects")}
            data-testid="section-tab-projects"
            title="Side projects and portfolio items"
          >
            <span className="tab-icon">🚀</span>
            <span className="tab-label">Projects</span>
            <span className="section-badge">{data.projects.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "skills"}
            className={`section-tab-btn ${activeSection === "skills" ? "active" : ""}`}
            onClick={() => setActiveSection("skills")}
            data-testid="section-tab-skills"
            title="Skills and technologies"
          >
            <span className="tab-icon">🛠️</span>
            <span className="tab-label">Skills</span>
            <span className="section-badge">{data.skills.length}</span>
          </button>

          {hasCustom && (
            <button
              type="button"
              role="tab"
              aria-selected={activeSection === "custom"}
              className={`section-tab-btn ${activeSection === "custom" ? "active" : ""}`}
              onClick={() => setActiveSection("custom")}
              data-testid="section-tab-custom"
              title="Template custom variables and extra sections"
            >
              <span className="tab-icon">✨</span>
              <span className="tab-label">Custom</span>
              <span className="section-badge">
                {(data.customSections?.length || 0) + customFields.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 1. PERSONAL INFORMATION */}
      {(activeSection === "all" || activeSection === "personal") && (
        <div className="form-card" data-testid="section-card-personal">
          <div
            className="form-card-header"
            onClick={() => toggleSection("personal")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">👤</span>
              <h3>Personal Information</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("personal");
                  }}
                  title="Focus on Personal Info"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["personal"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["personal"] || activeSection === "personal") && (
            <div className="form-card-body">
            <div className="form-row-2">
              <div className="form-group">
                <label>Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Alex Morgan"
                  value={data.personal.name || ""}
                  onChange={(e) => handlePersonalChange("name", e.target.value)}
                  data-testid="input-personal-name"
                />
              </div>
              <div className="form-group">
                <label>Job Title / Headline</label>
                <input
                  type="text"
                  placeholder="e.g. Senior Software Engineer"
                  value={data.personal.title || ""}
                  onChange={(e) => handlePersonalChange("title", e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-3">
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="alex@example.com"
                  value={data.personal.email || ""}
                  onChange={(e) => handlePersonalChange("email", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Phone</label>
                <input
                  type="tel"
                  placeholder="+1 (555) 019-2834"
                  value={data.personal.phone || ""}
                  onChange={(e) => handlePersonalChange("phone", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Location</label>
                <input
                  type="text"
                  placeholder="San Francisco, CA"
                  value={data.personal.location || ""}
                  onChange={(e) => handlePersonalChange("location", e.target.value)}
                />
              </div>
            </div>

            <div className="form-row-3">
              <div className="form-group">
                <label>Website / Portfolio</label>
                <input
                  type="text"
                  placeholder="https://alexmorgan.dev"
                  value={data.personal.website || ""}
                  onChange={(e) => handlePersonalChange("website", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>LinkedIn</label>
                <input
                  type="text"
                  placeholder="linkedin.com/in/alexmorgan"
                  value={data.personal.linkedin || ""}
                  onChange={(e) => handlePersonalChange("linkedin", e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>GitHub</label>
                <input
                  type="text"
                  placeholder="github.com/alexmorgan"
                  value={data.personal.github || ""}
                  onChange={(e) => handlePersonalChange("github", e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label>Professional Summary</label>
              <textarea
                rows={3}
                placeholder="Brief summary of your professional background and core strengths..."
                value={data.personal.summary || ""}
                onChange={(e) => handlePersonalChange("summary", e.target.value)}
              />
            </div>

            {renderTraversalFooter("personal")}
          </div>
        )}
      </div>
      )}

      {/* 2. EXPERIENCE */}
      {(activeSection === "all" || activeSection === "experience") && (
        <div className="form-card" data-testid="section-card-experience">
          <div
            className="form-card-header"
            onClick={() => toggleSection("experience")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">💼</span>
              <h3>Experience ({data.experience.length})</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("experience");
                  }}
                  title="Focus on Experience"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["experience"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["experience"] || activeSection === "experience") && (
            <div className="form-card-body">
            {data.experience.map((exp, expIdx) => (
              <div key={exp.id} className="entry-card" data-testid={`experience-item-${expIdx}`}>
                <div className="entry-header">
                  <h4>{exp.role || exp.company || `Role #${expIdx + 1}`}</h4>
                  <button
                    type="button"
                    className="btn-danger-icon"
                    onClick={() => handleRemoveExperience(exp.id)}
                    title="Delete experience entry"
                  >
                    🗑️ Remove
                  </button>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Role / Position</label>
                    <input
                      type="text"
                      placeholder="e.g. Senior Software Engineer"
                      value={exp.role}
                      onChange={(e) => handleUpdateExperience(exp.id, "role", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Company / Organization</label>
                    <input
                      type="text"
                      placeholder="e.g. Acme Corp"
                      value={exp.company}
                      onChange={(e) => handleUpdateExperience(exp.id, "company", e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row-3">
                  <div className="form-group">
                    <label>Location</label>
                    <input
                      type="text"
                      placeholder="e.g. San Francisco, CA"
                      value={exp.location || ""}
                      onChange={(e) => handleUpdateExperience(exp.id, "location", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="text"
                      placeholder="e.g. Jan 2022"
                      value={exp.startDate || ""}
                      onChange={(e) => handleUpdateExperience(exp.id, "startDate", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>End Date</label>
                    <input
                      type="text"
                      placeholder="e.g. Present"
                      value={exp.endDate || ""}
                      onChange={(e) => handleUpdateExperience(exp.id, "endDate", e.target.value)}
                    />
                  </div>
                </div>

                {/* Bullets */}
                <div className="bullets-section">
                  <label className="bullets-label">Key Achievements / Bullets</label>
                  {exp.bullets.map((bullet, bIdx) => (
                    <div key={bIdx} className="bullet-row">
                      <span className="bullet-dot">•</span>
                      <input
                        type="text"
                        placeholder="Describe key responsibilities or quantifiable results..."
                        value={bullet}
                        onChange={(e) => handleUpdateExpBullet(exp.id, bIdx, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-bullet-remove"
                        onClick={() => handleRemoveExpBullet(exp.id, bIdx)}
                        title="Remove bullet"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-add-bullet"
                    onClick={() => handleAddExpBullet(exp.id)}
                  >
                    + Add Bullet
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
              + Add Experience Entry
            </button>

            {renderTraversalFooter("experience")}
          </div>
        )}
      </div>
      )}

      {/* 3. EDUCATION */}
      {(activeSection === "all" || activeSection === "education") && (
        <div className="form-card" data-testid="section-card-education">
          <div
            className="form-card-header"
            onClick={() => toggleSection("education")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">🎓</span>
              <h3>Education ({data.education.length})</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("education");
                  }}
                  title="Focus on Education"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["education"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["education"] || activeSection === "education") && (
            <div className="form-card-body">
            {data.education.map((edu, eduIdx) => (
              <div key={edu.id} className="entry-card" data-testid={`education-item-${eduIdx}`}>
                <div className="entry-header">
                  <h4>{edu.degree || edu.institution || `Education #${eduIdx + 1}`}</h4>
                  <button
                    type="button"
                    className="btn-danger-icon"
                    onClick={() => handleRemoveEducation(edu.id)}
                    title="Delete education entry"
                  >
                    🗑️ Remove
                  </button>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Degree / Certificate</label>
                    <input
                      type="text"
                      placeholder="e.g. B.S. in Computer Science"
                      value={edu.degree}
                      onChange={(e) => handleUpdateEducation(edu.id, "degree", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Institution / University</label>
                    <input
                      type="text"
                      placeholder="e.g. University of California, Berkeley"
                      value={edu.institution}
                      onChange={(e) => handleUpdateEducation(edu.id, "institution", e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-row-3">
                  <div className="form-group">
                    <label>Location</label>
                    <input
                      type="text"
                      placeholder="e.g. Berkeley, CA"
                      value={edu.location || ""}
                      onChange={(e) => handleUpdateEducation(edu.id, "location", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Start Date</label>
                    <input
                      type="text"
                      placeholder="e.g. 2017"
                      value={edu.startDate || ""}
                      onChange={(e) => handleUpdateEducation(edu.id, "startDate", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>End Date</label>
                    <input
                      type="text"
                      placeholder="e.g. 2021"
                      value={edu.endDate || ""}
                      onChange={(e) => handleUpdateEducation(edu.id, "endDate", e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Honors, GPA or Relevant Coursework</label>
                  <input
                    type="text"
                    placeholder="e.g. Magna Cum Laude, GPA: 3.9/4.0, Algorithms, Distributed Systems"
                    value={edu.details || ""}
                    onChange={(e) => handleUpdateEducation(edu.id, "details", e.target.value)}
                  />
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn-add-entry"
              onClick={handleAddEducation}
              data-testid="btn-add-education"
            >
              + Add Education Entry
            </button>

            {renderTraversalFooter("education")}
          </div>
        )}
      </div>
      )}

      {/* 4. PROJECTS */}
      {(activeSection === "all" || activeSection === "projects") && (
        <div className="form-card" data-testid="section-card-projects">
          <div
            className="form-card-header"
            onClick={() => toggleSection("projects")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">🚀</span>
              <h3>Projects ({data.projects.length})</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("projects");
                  }}
                  title="Focus on Projects"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["projects"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["projects"] || activeSection === "projects") && (
            <div className="form-card-body">
            {data.projects.map((proj, pIdx) => (
              <div key={proj.id} className="entry-card" data-testid={`project-item-${pIdx}`}>
                <div className="entry-header">
                  <h4>{proj.name || `Project #${pIdx + 1}`}</h4>
                  <button
                    type="button"
                    className="btn-danger-icon"
                    onClick={() => handleRemoveProject(proj.id)}
                    title="Delete project entry"
                  >
                    🗑️ Remove
                  </button>
                </div>

                <div className="form-row-3">
                  <div className="form-group">
                    <label>Project Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Distributed Key-Value Store"
                      value={proj.name}
                      onChange={(e) => handleUpdateProject(proj.id, "name", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Tech Stack / Technologies</label>
                    <input
                      type="text"
                      placeholder="e.g. Rust, Raft, gRPC, Tokio"
                      value={proj.technologies || ""}
                      onChange={(e) => handleUpdateProject(proj.id, "technologies", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Project Link / URL</label>
                    <input
                      type="text"
                      placeholder="https://github.com/alex/project"
                      value={proj.link || ""}
                      onChange={(e) => handleUpdateProject(proj.id, "link", e.target.value)}
                    />
                  </div>
                </div>

                {/* Bullets */}
                <div className="bullets-section">
                  <label className="bullets-label">Project Highlights</label>
                  {proj.bullets.map((bullet, bIdx) => (
                    <div key={bIdx} className="bullet-row">
                      <span className="bullet-dot">•</span>
                      <input
                        type="text"
                        placeholder="Bullet describing implementation or impact..."
                        value={bullet}
                        onChange={(e) => handleUpdateProjBullet(proj.id, bIdx, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-bullet-remove"
                        onClick={() => handleRemoveProjBullet(proj.id, bIdx)}
                        title="Remove bullet"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn-add-bullet"
                    onClick={() => handleAddProjBullet(proj.id)}
                  >
                    + Add Bullet
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
              + Add Project Entry
            </button>

            {renderTraversalFooter("projects")}
          </div>
        )}
      </div>
      )}

      {/* 5. SKILLS */}
      {(activeSection === "all" || activeSection === "skills") && (
        <div className="form-card" data-testid="section-card-skills">
          <div
            className="form-card-header"
            onClick={() => toggleSection("skills")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">🛠️</span>
              <h3>Skills & Technologies ({data.skills.length})</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("skills");
                  }}
                  title="Focus on Skills"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["skills"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["skills"] || activeSection === "skills") && (
            <div className="form-card-body">
            {data.skills.map((skill, sIdx) => (
              <div key={skill.id} className="entry-card" data-testid={`skill-item-${sIdx}`}>
                <div className="entry-header">
                  <h4>{skill.category || `Category #${sIdx + 1}`}</h4>
                  <button
                    type="button"
                    className="btn-danger-icon"
                    onClick={() => handleRemoveSkill(skill.id)}
                    title="Delete skill category"
                  >
                    🗑️ Remove
                  </button>
                </div>

                <div className="form-row-2">
                  <div className="form-group">
                    <label>Category</label>
                    <input
                      type="text"
                      placeholder="e.g. Languages, Frameworks, Cloud"
                      value={skill.category}
                      onChange={(e) => handleUpdateSkill(skill.id, "category", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Skills / Items (comma separated)</label>
                    <input
                      type="text"
                      placeholder="e.g. Rust, TypeScript, Python, Docker"
                      value={skill.skills}
                      onChange={(e) => handleUpdateSkill(skill.id, "skills", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn-add-entry"
              onClick={handleAddSkill}
              data-testid="btn-add-skill"
            >
              + Add Skill Category
            </button>

            {renderTraversalFooter("skills")}
          </div>
        )}
      </div>
      )}

      {/* 6. TEMPLATE CUSTOM FIELDS & SECTIONS */}
      {hasCustom && (activeSection === "all" || activeSection === "custom") && (
        <div className="form-card" data-testid="section-card-custom">
          <div
            className="form-card-header"
            onClick={() => toggleSection("custom")}
            role="button"
            tabIndex={0}
          >
            <div className="header-title">
              <span className="icon">✨</span>
              <h3>Template Custom Fields & Sections</h3>
            </div>
            <div className="header-actions">
              {activeSection === "all" && (
                <button
                  type="button"
                  className="btn-section-focus"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveSection("custom");
                  }}
                  title="Focus on Custom Fields"
                >
                  Focus 🔍
                </button>
              )}
              <span className="toggle-indicator">
                {activeSection === "all" && collapsedSections["custom"] ? "▼" : "▲"}
              </span>
            </div>
          </div>

          {(!collapsedSections["custom"] || activeSection === "custom") && (
            <div className="form-card-body">
              {customFields.map((field) => (
                <div key={field.key} className="form-group">
                  <label>{field.label}</label>
                  {field.type === "textarea" ? (
                    <textarea
                      rows={3}
                      value={data.customVariables?.[field.key] || ""}
                      onChange={(e) => handleCustomVariableChange(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={data.customVariables?.[field.key] || ""}
                      onChange={(e) => handleCustomVariableChange(field.key, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {(data.customSections || []).map((sec, secIdx) => (
                <div key={sec.id} className="entry-card">
                  <div className="entry-header">
                    <h4>{sec.title || `Custom Section #${secIdx + 1}`}</h4>
                    <button
                      type="button"
                      className="btn-danger-icon"
                      onClick={() => handleRemoveCustomSection(sec.id)}
                    >
                      🗑️ Remove
                    </button>
                  </div>
                  <div className="form-group">
                    <label>Section Title</label>
                    <input
                      type="text"
                      value={sec.title}
                      onChange={(e) => handleUpdateCustomSection(sec.id, "title", e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label>Content</label>
                    <textarea
                      rows={2}
                      value={sec.content || ""}
                      onChange={(e) => handleUpdateCustomSection(sec.id, "content", e.target.value)}
                    />
                  </div>
                </div>
              ))}

              <button
                type="button"
                className="btn-add-entry"
                onClick={handleAddCustomSection}
              >
                + Add Custom Section
              </button>

              {renderTraversalFooter("custom")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ResumeForm;
