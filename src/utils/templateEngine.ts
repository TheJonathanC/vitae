import {
  ResumeData,
  ResumePersonalInfo,
  ResumeExperienceItem,
  ResumeEducationItem,
  ResumeProjectItem,
  ResumeSkillItem,
  ResumeCustomSection,
  ExtractedTemplateAnalysis,
  ExtractedTemplateField,
} from "../types";

/**
 * Escapes characters that have special meaning in LaTeX.
 */
export function escapeLatex(input: string | undefined | null): string {
  if (!input) return "";
  let result = "";
  for (const char of String(input)) {
    switch (char) {
      case "\\":
        result += "\\textbackslash{}";
        break;
      case "~":
        result += "\\textasciitilde{}";
        break;
      case "^":
        result += "\\textasciicircum{}";
        break;
      case "&":
        result += "\\&";
        break;
      case "%":
        result += "\\%";
        break;
      case "$":
        result += "\\$";
        break;
      case "#":
        result += "\\#";
        break;
      case "_":
        result += "\\_";
        break;
      case "{":
        result += "\\{";
        break;
      case "}":
        result += "\\}";
        break;
      default:
        result += char;
    }
  }
  return result;
}

/**
 * Clean URL escaping for LaTeX \href links where special characters like % and #
 * need special handling without breaking the URL structure.
 */
export function sanitizeLatexUrl(url: string | undefined | null): string {
  if (!url) return "";
  let clean = url.trim();
  // Strip protocol for display if needed, but for href keep valid URL
  if (!clean.startsWith("http://") && !clean.startsWith("https://") && !clean.startsWith("mailto:")) {
    clean = "https://" + clean;
  }
  return clean.replace(/#/g, "\\#").replace(/%/g, "\\%");
}

/**
 * Generates default structured sample data for new resumes.
 */
export function getDefaultResumeData(name: string = "Alex Morgan"): ResumeData {
  return {
    personal: {
      name,
      title: "Senior Software Engineer",
      email: "alex.morgan@example.com",
      phone: "+1 (555) 019-2834",
      location: "San Francisco, CA",
      website: "https://alexmorgan.dev",
      linkedin: "linkedin.com/in/alexmorgan",
      github: "github.com/alexmorgan",
      summary:
        "Passionate software engineer with 6+ years of experience designing high-scale distributed systems and user-centric web applications.",
    },
    experience: [
      {
        id: "exp-1",
        role: "Senior Software Engineer",
        company: "Acme Cloud Systems",
        location: "San Francisco, CA",
        startDate: "Jan 2022",
        endDate: "Present",
        bullets: [
          "Architected real-time distributed data pipeline processing 15M+ events daily with sub-second latency.",
          "Spearheaded microservices modernization using Rust and TypeScript, decreasing p99 latency by 42%.",
          "Mentored 6 junior and mid-level engineers, establishing best practices for CI/CD and automated testing.",
        ],
      },
      {
        id: "exp-2",
        role: "Software Engineer",
        company: "VentureTech Innovations",
        location: "Seattle, WA",
        startDate: "Jul 2019",
        endDate: "Dec 2021",
        bullets: [
          "Designed and shipped core user authentication and role-based access control for enterprise clients.",
          "Collaborated cross-functionally with product and design teams to deliver responsive UI features.",
        ],
      },
    ],
    education: [
      {
        id: "edu-1",
        institution: "University of Washington",
        degree: "B.S. in Computer Science",
        location: "Seattle, WA",
        startDate: "2015",
        endDate: "2019",
        details: "Graduated Magna Cum Laude (GPA: 3.89/4.00) · Dean's List (all quarters)",
      },
    ],
    projects: [
      {
        id: "proj-1",
        name: "Vitae Resume Builder",
        technologies: "Rust, Tauri, React, TypeScript, LaTeX",
        link: "https://github.com/alexmorgan/vitae",
        bullets: [
          "Developed desktop LaTeX resume builder with offline Monaco editor and instant PDF compilation.",
          "Implemented intelligent template field extraction engine and dynamic visual form interface.",
        ],
      },
    ],
    skills: [
      {
        id: "skill-1",
        category: "Languages",
        skills: "Rust, TypeScript, JavaScript, Python, Go, C++, SQL",
      },
      {
        id: "skill-2",
        category: "Frameworks & Tools",
        skills: "React, Node.js, Tauri, Docker, Kubernetes, AWS, Git, Linux",
      },
    ],
    customSections: [],
    customVariables: {},
  };
}

/**
 * Standard known scalar keys in ResumePersonalInfo.
 */
const KNOWN_PERSONAL_KEYS = new Set([
  "name",
  "title",
  "email",
  "phone",
  "location",
  "website",
  "linkedin",
  "github",
  "summary",
]);

/**
 * Extracts all placeholders, repetitive blocks, and custom variables from a LaTeX template.
 */
export function extractFieldsFromTemplate(templateContent: string): ExtractedTemplateAnalysis {
  const customVariables: ExtractedTemplateField[] = [];
  const detectedSections: string[] = [];

  // Check standard sections
  if (/\{\{#experience\}\}/.test(templateContent)) detectedSections.push("experience");
  if (/\{\{#education\}\}/.test(templateContent)) detectedSections.push("education");
  if (/\{\{#projects\}\}/.test(templateContent)) detectedSections.push("projects");
  if (/\{\{#skills\}\}/.test(templateContent)) detectedSections.push("skills");
  if (/\{\{#customSections\}\}/.test(templateContent)) detectedSections.push("customSections");

  // Find all variable occurrences {{key}}
  const tagRegex = /\{\{([#^/]?)([a-zA-Z0-9_]+)\}\}/g;
  let match: RegExpExecArray | null;
  const seenKeys = new Set<string>();

  while ((match = tagRegex.exec(templateContent)) !== null) {
    const prefix = match[1];
    const key = match[2];

    // Ignore closing tags and structural section repeaters
    if (prefix === "/" || prefix === "#" || prefix === "^") {
      continue;
    }

    // Skip repeat item inner variables
    if (
      ["role", "company", "location", "startDate", "endDate", "institution", "degree", "details", "name", "technologies", "link", "category", "skills", "bullet", "title", "content"].includes(key)
    ) {
      continue;
    }

    if (!KNOWN_PERSONAL_KEYS.has(key) && !seenKeys.has(key)) {
      seenKeys.add(key);
      const label = key
        .replace(/_/g, " ")
        .replace(/([A-Z])/g, " $1")
        .replace(/^\w/, (c) => c.toUpperCase())
        .trim();

      customVariables.push({
        key,
        label,
        type: key.toLowerCase().includes("summary") || key.toLowerCase().includes("desc") ? "textarea" : "text",
      });
    }
  }

  const hasStandardStructure =
    detectedSections.length > 0 || /\{\{name\}\}/.test(templateContent);

  return {
    hasStandardStructure,
    detectedSections,
    customVariables,
  };
}

/**
 * Evaluates conditional blocks in the template.
 * {{#key}}...{{/key}} -> renders content if value is truthy / non-empty
 * {{^key}}...{{/key}} -> renders content if value is falsy / empty
 */
function processConditionals(
  template: string,
  data: Record<string, any>
): string {
  // Regex to match {{#key}}inner{{/key}} and {{^key}}inner{{/key}}
  // Note: we avoid matching repeating blocks like #items or #bullets here if handled separately
  const blockRegex = /\{\{([#^])([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;

  return template.replace(blockRegex, (fullMatch, type, key, inner) => {
    // If this is a recognized list section handled elsewhere, keep it
    if (["experience", "education", "projects", "skills", "customSections", "items", "bullets", "highlights"].includes(key)) {
      return fullMatch;
    }

    const value = data[key];
    const isTruthy =
      value !== undefined &&
      value !== null &&
      value !== false &&
      value !== "" &&
      (!Array.isArray(value) || value.length > 0);

    if (type === "#") {
      return isTruthy ? processConditionals(inner, data) : "";
    } else {
      // Inverted block
      return !isTruthy ? processConditionals(inner, data) : "";
    }
  });
}

/**
 * Renders a full template given ResumeData.
 */
export function renderTemplate(templateContent: string, resumeData: ResumeData): string {
  let output = templateContent;

  const personal = resumeData.personal || { name: "" };
  const customVars = resumeData.customVariables || {};

  // Build root context for variables
  const rootContext: Record<string, any> = {
    ...customVars,
    name: escapeLatex(personal.name),
    title: escapeLatex(personal.title),
    email: escapeLatex(personal.email),
    phone: escapeLatex(personal.phone),
    location: escapeLatex(personal.location),
    website: escapeLatex(personal.website),
    linkedin: escapeLatex(personal.linkedin),
    github: escapeLatex(personal.github),
    summary: escapeLatex(personal.summary),
  };

  // 1. Process Section: Experience
  output = output.replace(
    /\{\{#experience\}\}([\s\S]*?)\{\{\/experience\}\}/g,
    (_: string, sectionContent: string) => {
      const items = resumeData.experience || [];
      if (items.length === 0) return "";

      // Check if sectionContent has {{#items}}...{{/items}}
      if (/\{\{#items\}\}/.test(sectionContent)) {
        return sectionContent.replace(
          /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g,
          (_: string, itemTemplate: string) => {
            return items
              .map((item) => renderExperienceItem(itemTemplate, item))
              .join("\n");
          }
        );
      }

      // Direct repeat of sectionContent
      return items.map((item) => renderExperienceItem(sectionContent, item)).join("\n");
    }
  );

  // 2. Process Section: Education
  output = output.replace(
    /\{\{#education\}\}([\s\S]*?)\{\{\/education\}\}/g,
    (_: string, sectionContent: string) => {
      const items = resumeData.education || [];
      if (items.length === 0) return "";

      if (/\{\{#items\}\}/.test(sectionContent)) {
        return sectionContent.replace(
          /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g,
          (_: string, itemTemplate: string) => {
            return items
              .map((item) => renderEducationItem(itemTemplate, item))
              .join("\n");
          }
        );
      }

      return items.map((item) => renderEducationItem(sectionContent, item)).join("\n");
    }
  );

  // 3. Process Section: Projects
  output = output.replace(
    /\{\{#projects\}\}([\s\S]*?)\{\{\/projects\}\}/g,
    (_: string, sectionContent: string) => {
      const items = resumeData.projects || [];
      if (items.length === 0) return "";

      if (/\{\{#items\}\}/.test(sectionContent)) {
        return sectionContent.replace(
          /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g,
          (_: string, itemTemplate: string) => {
            return items
              .map((item) => renderProjectItem(itemTemplate, item))
              .join("\n");
          }
        );
      }

      return items.map((item) => renderProjectItem(sectionContent, item)).join("\n");
    }
  );

  // 4. Process Section: Skills
  output = output.replace(
    /\{\{#skills\}\}([\s\S]*?)\{\{\/skills\}\}/g,
    (_: string, sectionContent: string) => {
      const items = resumeData.skills || [];
      if (items.length === 0) return "";

      if (/\{\{#items\}\}/.test(sectionContent)) {
        return sectionContent.replace(
          /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g,
          (_: string, itemTemplate: string) => {
            return items
              .map((item) => renderSkillItem(itemTemplate, item))
              .join("\n");
          }
        );
      }

      return items.map((item) => renderSkillItem(sectionContent, item)).join("\n");
    }
  );

  // 5. Process Section: CustomSections
  output = output.replace(
    /\{\{#customSections\}\}([\s\S]*?)\{\{\/customSections\}\}/g,
    (_: string, sectionContent: string) => {
      const sections = resumeData.customSections || [];
      if (sections.length === 0) return "";

      return sections
        .map((sec) => renderCustomSection(sectionContent, sec))
        .join("\n");
    }
  );

  // 6. Process Top-level conditionals
  output = processConditionals(output, rootContext);

  // 7. Replace scalar variables {{key}}
  output = output.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_: string, key: string) => {
    if (key in rootContext) {
      return rootContext[key] !== undefined ? String(rootContext[key]) : "";
    }
    return "";
  });

  return output;
}

function renderBullets(template: string, bullets: string[]): string {
  const filtered = bullets.filter((b) => b.trim().length > 0);
  if (filtered.length === 0) return "";

  // Replace {{#highlights}}...{{#bullets}}...{{bullet}}...{{/bullets}}...{{/highlights}}
  let res = template.replace(
    /\{\{#highlights\}\}([\s\S]*?)\{\{\/highlights\}\}/g,
    (_: string, hlContent: string) => {
      return hlContent.replace(
        /\{\{#bullets\}\}([\s\S]*?)\{\{\/bullets\}\}/g,
        (_: string, bulletTemplate: string) => {
          return filtered
            .map((b) =>
              bulletTemplate.replace(/\{\{bullet\}\}/g, escapeLatex(b))
            )
            .join("");
        }
      );
    }
  );

  // Fallback for direct {{#bullets}}...{{/bullets}}
  res = res.replace(
    /\{\{#bullets\}\}([\s\S]*?)\{\{\/bullets\}\}/g,
    (_, bulletTemplate) => {
      return filtered
        .map((b) => bulletTemplate.replace(/\{\{bullet\}\}/g, escapeLatex(b)))
        .join("");
    }
  );

  return res;
}

function renderExperienceItem(template: string, item: ResumeExperienceItem): string {
  const context: Record<string, any> = {
    role: escapeLatex(item.role),
    company: escapeLatex(item.company),
    location: escapeLatex(item.location),
    startDate: escapeLatex(item.startDate),
    endDate: escapeLatex(item.endDate),
    highlights: item.bullets && item.bullets.length > 0,
  };

  let rendered = processConditionals(template, context);

  // Render bullets
  if (item.bullets && item.bullets.length > 0) {
    rendered = renderBullets(rendered, item.bullets);
  } else {
    // Remove highlights block
    rendered = rendered.replace(/\{\{#highlights\}\}[\s\S]*?\{\{\/highlights\}\}/g, "");
    rendered = rendered.replace(/\{\{#bullets\}\}[\s\S]*?\{\{\/bullets\}\}/g, "");
  }

  // Replace scalars
  return rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : "";
  });
}

function renderEducationItem(template: string, item: ResumeEducationItem): string {
  const context: Record<string, any> = {
    institution: escapeLatex(item.institution),
    degree: escapeLatex(item.degree),
    location: escapeLatex(item.location),
    startDate: escapeLatex(item.startDate),
    endDate: escapeLatex(item.endDate),
    details: escapeLatex(item.details),
  };

  let rendered = processConditionals(template, context);

  return rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : "";
  });
}

function renderProjectItem(template: string, item: ResumeProjectItem): string {
  const context: Record<string, any> = {
    name: escapeLatex(item.name),
    technologies: escapeLatex(item.technologies),
    link: item.link ? sanitizeLatexUrl(item.link) : "",
    highlights: item.bullets && item.bullets.length > 0,
  };

  let rendered = processConditionals(template, context);

  if (item.bullets && item.bullets.length > 0) {
    rendered = renderBullets(rendered, item.bullets);
  } else {
    rendered = rendered.replace(/\{\{#highlights\}\}[\s\S]*?\{\{\/highlights\}\}/g, "");
    rendered = rendered.replace(/\{\{#bullets\}\}[\s\S]*?\{\{\/bullets\}\}/g, "");
  }

  return rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : "";
  });
}

function renderSkillItem(template: string, item: ResumeSkillItem): string {
  const context: Record<string, any> = {
    category: escapeLatex(item.category),
    skills: escapeLatex(item.skills),
  };

  let rendered = processConditionals(template, context);

  return rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : "";
  });
}

function renderCustomSection(template: string, section: ResumeCustomSection): string {
  const context: Record<string, any> = {
    title: escapeLatex(section.title),
    content: escapeLatex(section.content),
    highlights: section.bullets && section.bullets.length > 0,
  };

  let rendered = processConditionals(template, context);

  if (section.bullets && section.bullets.length > 0) {
    rendered = renderBullets(rendered, section.bullets);
  } else {
    rendered = rendered.replace(/\{\{#highlights\}\}[\s\S]*?\{\{\/highlights\}\}/g, "");
    rendered = rendered.replace(/\{\{#bullets\}\}[\s\S]*?\{\{\/bullets\}\}/g, "");
  }

  return rendered.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => {
    return context[key] !== undefined ? String(context[key]) : "";
  });
}

/**
 * Intelligently converts an arbitrary user-uploaded LaTeX file into a Vitae template,
 * simultaneously extracting pre-filled resume data from the text.
 */
export function convertRawLatexToTemplate(rawLatex: string): {
  templateContent: string;
  extractedData: Partial<ResumeData>;
} {
  // If the uploaded file is already a parameterized Vitae template with {{...}}
  if (/\{\{([a-zA-Z0-9_]+)\}\}/.test(rawLatex)) {
    return {
      templateContent: rawLatex,
      extractedData: {},
    };
  }

  let template = rawLatex;
  const extractedPersonal: Partial<ResumePersonalInfo> = {};

  // 1. Extract and parameterize Name
  // Common patterns: \author{Name}, \name{Name}, {\Huge \scshape Name}, {\huge \textbf{Name}}, {\LARGE \textbf{Name}}
  const namePatterns = [
    /\\author\{([^}]+)\}/,
    /\\name\{([^}]+)\}/,
    /\{\\Huge\s*(?:\\scshape\s*)?([A-Za-z\s.'-]+)\}/,
    /\{\\huge\s*(?:\\textbf\{)?([A-Za-z\s.'-]+)\}?/,
    /\{\\LARGE\s*(?:\\textbf\{)?([A-Za-z\s.'-]+)\}?/,
    /\\textbf\{\\Huge\s*([A-Za-z\s.'-]+)\}/,
    /\\textbf\{\\huge\s*([A-Za-z\s.'-]+)\}/,
    /\\textbf\{\\LARGE\s*([A-Za-z\s.'-]+)\}/,
  ];

  for (const pat of namePatterns) {
    const match = pat.exec(template);
    if (match && match[1]?.trim()) {
      const rawName = match[1].trim();
      extractedPersonal.name = rawName;
      // Replace the matched occurrence with {{name}}
      template = template.replace(match[0], match[0].replace(rawName, "{{name}}"));
      break;
    }
  }

  // 2. Extract and parameterize Email
  const emailMatch = /(?:\\href\{mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\}\{[^}]*\}|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}))/.exec(template);
  if (emailMatch) {
    const email = emailMatch[1] || emailMatch[2];
    extractedPersonal.email = email;
    if (emailMatch[0].startsWith("\\href{mailto:")) {
      template = template.replace(emailMatch[0], "\\href{mailto:{{email}}}{{{email}}}");
    } else {
      template = template.replace(email, "{{email}}");
    }
  }

  // 3. Extract and parameterize Phone
  const phoneMatch = /(?:\+?(\d{1,3})[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/.exec(template);
  if (phoneMatch) {
    const rawPhone = phoneMatch[0].trim();
    extractedPersonal.phone = rawPhone;
    template = template.replace(rawPhone, "{{phone}}");
  }

  // 4. Extract and parameterize GitHub / LinkedIn
  const githubMatch = /(?:https?:\/\/)?github\.com\/([a-zA-Z0-9_-]+)/.exec(template);
  if (githubMatch) {
    extractedPersonal.github = `github.com/${githubMatch[1]}`;
    template = template.replace(githubMatch[0], "github.com/{{github}}");
  }

  const linkedinMatch = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/.exec(template);
  if (linkedinMatch) {
    extractedPersonal.linkedin = `linkedin.com/in/${linkedinMatch[1]}`;
    template = template.replace(linkedinMatch[0], "linkedin.com/in/{{linkedin}}");
  }

  return {
    templateContent: template,
    extractedData: {
      personal: {
        name: extractedPersonal.name || "Alex Morgan",
        email: extractedPersonal.email || "",
        phone: extractedPersonal.phone || "",
        github: extractedPersonal.github || "",
        linkedin: extractedPersonal.linkedin || "",
      },
    },
  };
}
