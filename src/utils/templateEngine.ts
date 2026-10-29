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
      // OT1-encoded fonts (the LaTeX default) would print these as ¡, ¿ and an em dash.
      case "<":
        result += "\\textless{}";
        break;
      case ">":
        result += "\\textgreater{}";
        break;
      case "|":
        result += "\\textbar{}";
        break;
      default:
        result += char;
    }
  }
  return result;
}

/**
 * Escapes a URL for the first argument of \href / \url. hyperref takes `_`, `&`
 * and `~` literally there, but `%` and `#` must be escaped, and characters that
 * would unbalance or end the argument are percent-encoded.
 */
export function escapeLatexUrl(url: string | undefined | null): string {
  if (!url) return "";
  let result = "";
  for (const char of String(url).trim()) {
    switch (char) {
      case "%":
        result += "\\%";
        break;
      case "#":
        result += "\\#";
        break;
      case "\\":
        result += "\\%5C";
        break;
      case "{":
        result += "\\%7B";
        break;
      case "}":
        result += "\\%7D";
        break;
      default:
        result += /\s/.test(char) ? "\\%20" : char;
    }
  }
  return result;
}

/** Adds `https://` to URLs entered without a scheme (e.g. "github.com/me"). */
export function normalizeUrl(url: string | undefined | null): string {
  const clean = (url || "").trim();
  if (!clean) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(clean) ? clean : `https://${clean.replace(/^\/+/, "")}`;
}

/**
 * Normalizes and escapes a user-entered URL for use as an \href target.
 */
export function sanitizeLatexUrl(url: string | undefined | null): string {
  return escapeLatexUrl(normalizeUrl(url));
}

/** Collision-free ids for form entries (Date.now() repeats within a millisecond). */
export function createId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
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
 * A blank resume for new documents, so no sample contact details can end up
 * in a real resume by accident. Inputs show examples as placeholders instead.
 */
export function getEmptyResumeData(): ResumeData {
  return {
    personal: {
      name: "",
      title: "",
      email: "",
      phone: "",
      location: "",
      website: "",
      linkedin: "",
      github: "",
      summary: "",
    },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    customSections: [],
    customVariables: {},
  };
}

const asString = (value: unknown): string => (typeof value === "string" ? value : "");
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(asObject) : [];
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * Coerces stored resume_data JSON (possibly from an older version, or partially
 * written) into a complete ResumeData so the form never reads a missing array.
 */
export function normalizeResumeData(raw: unknown): ResumeData {
  const data = asObject(raw);
  const personal = asObject(data.personal);
  const customVariables = Object.fromEntries(
    Object.entries(asObject(data.customVariables)).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>;

  const normalized: ResumeData = {
    personal: {
      name: asString(personal.name),
      title: asString(personal.title),
      email: asString(personal.email),
      phone: asString(personal.phone),
      location: asString(personal.location),
      website: asString(personal.website),
      linkedin: asString(personal.linkedin),
      github: asString(personal.github),
      summary: asString(personal.summary),
    },
    experience: asArray(data.experience).map((item) => ({
      id: asString(item.id) || createId("exp"),
      role: asString(item.role),
      company: asString(item.company),
      location: asString(item.location),
      startDate: asString(item.startDate),
      endDate: asString(item.endDate),
      bullets: asStringArray(item.bullets),
    })),
    education: asArray(data.education).map((item) => ({
      id: asString(item.id) || createId("edu"),
      degree: asString(item.degree),
      institution: asString(item.institution),
      location: asString(item.location),
      startDate: asString(item.startDate),
      endDate: asString(item.endDate),
      details: asString(item.details),
    })),
    projects: asArray(data.projects).map((item) => ({
      id: asString(item.id) || createId("proj"),
      name: asString(item.name),
      technologies: asString(item.technologies),
      link: asString(item.link),
      bullets: asStringArray(item.bullets),
    })),
    skills: asArray(data.skills).map((item) => ({
      id: asString(item.id) || createId("skill"),
      category: asString(item.category),
      skills: asString(item.skills),
    })),
    customSections: asArray(data.customSections).map((item) => ({
      id: asString(item.id) || createId("sec"),
      title: asString(item.title),
      content: asString(item.content),
      bullets: asStringArray(item.bullets),
    })),
    customVariables,
  };

  if (Array.isArray(data.sectionOrder)) {
    normalized.sectionOrder = asStringArray(data.sectionOrder);
  }
  if (data.sourceEditedManually === true) {
    normalized.sourceEditedManually = true;
  }
  return normalized;
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
 * Reorders section blocks in LaTeX template content according to sectionOrder.
 */
export function reorderTemplateSections(
  templateContent: string,
  sectionOrder?: string[]
): string {
  if (!sectionOrder || sectionOrder.length === 0) {
    return templateContent;
  }

  const sectionRegexes: Record<string, RegExp> = {
    experience: /\{\{#experience\}\}[\s\S]*?\{\{\/experience\}\}/,
    education: /\{\{#education\}\}[\s\S]*?\{\{\/education\}\}/,
    projects: /\{\{#projects\}\}[\s\S]*?\{\{\/projects\}\}/,
    skills: /\{\{#skills\}\}[\s\S]*?\{\{\/skills\}\}/,
    custom: /\{\{#customSections\}\}[\s\S]*?\{\{\/customSections\}\}/,
    customSections: /\{\{#customSections\}\}[\s\S]*?\{\{\/customSections\}\}/,
  };

  interface BlockMatch {
    key: string;
    start: number;
    end: number;
    content: string;
  }

  const matches: BlockMatch[] = [];

  for (const [key, regex] of Object.entries(sectionRegexes)) {
    if (key === "customSections" && matches.some((m) => m.key === "custom")) {
      continue;
    }
    const match = regex.exec(templateContent);
    if (match) {
      matches.push({
        key: key === "customSections" ? "custom" : key,
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
      });
    }
  }

  if (matches.length < 2) {
    return templateContent;
  }

  // Sort by start index
  matches.sort((a, b) => a.start - b.start);

  const normalizedOrder = sectionOrder
    .map((s) => (s === "customSections" ? "custom" : s))
    .filter((s) => s !== "personal");

  const orderedBlocks: string[] = [];
  const handledKeys = new Set<string>();

  for (const key of normalizedOrder) {
    const found = matches.find((m) => m.key === key);
    if (found) {
      orderedBlocks.push(found.content);
      handledKeys.add(key);
    }
  }

  for (const m of matches) {
    if (!handledKeys.has(m.key)) {
      orderedBlocks.push(m.content);
    }
  }

  const firstBlock = matches[0];
  const lastBlock = matches[matches.length - 1];
  const span = templateContent.substring(firstBlock.start, lastBlock.end);

  let remaining = span;
  for (const m of matches) {
    remaining = remaining.replace(m.content, "");
  }

  if (/^\s*$/.test(remaining)) {
    return (
      templateContent.substring(0, firstBlock.start) +
      orderedBlocks.join("\n\n") +
      templateContent.substring(lastBlock.end)
    );
  }

  let result = templateContent;
  let currentPos = 0;
  for (let i = 0; i < matches.length; i++) {
    const original = matches[i];
    const replacement = orderedBlocks[i];
    const idx = result.indexOf(original.content, currentPos);
    if (idx !== -1) {
      result =
        result.substring(0, idx) +
        replacement +
        result.substring(idx + original.content.length);
      currentPos = idx + replacement.length;
    }
  }
  return result;
}

/**
 * Marks placeholders inside \href{...} / \url{...} targets so they get URL
 * escaping instead of text escaping. A placeholder that starts the target
 * (optionally after a hard-coded http(s):// prefix) is treated as an absolute
 * URL: the prefix is dropped and the value gets https:// only if it has no
 * scheme, so "https://github.com/me" and "github.com/me" both work.
 */
function markUrlPlaceholders(template: string): string {
  return template.replace(
    /\\(href|url)\s*\{((?:[^{}]|\{\{[a-zA-Z0-9_]+\}\})*)\}/g,
    (_: string, command: string, target: string) => {
      const marked = target.replace(
        /(https?:\/\/)?\{\{([a-zA-Z0-9_]+)\}\}/g,
        (_m: string, _proto: string | undefined, key: string, offset: number) =>
          offset === 0 ? `{{${key}:absurl}}` : `{{${key}:url}}`
      );
      return `\\${command}{${marked}}`;
    }
  );
}

/**
 * Replaces {{key}} placeholders with escaped values from `context`. Values are
 * stored raw; escaping depends on where the placeholder sits (text vs URL).
 * Uses replacer functions so `$&`, `$'` etc. in user text stay literal.
 */
function substitute(template: string, context: Record<string, unknown>): string {
  return template.replace(
    /\{\{([a-zA-Z0-9_]+)(?::(url|absurl))?\}\}/g,
    (_: string, key: string, mode: string | undefined) => {
      const value = context[key];
      if (value === undefined || value === null || value === false) return "";
      const raw = String(value);
      if (mode === "absurl") return sanitizeLatexUrl(raw);
      if (mode === "url") return escapeLatexUrl(raw);
      return escapeLatex(raw);
    }
  );
}

/**
 * Renders a full template given ResumeData.
 */
export function renderTemplate(templateContent: string, resumeData: ResumeData): string {
  let output = templateContent;

  if (resumeData.sectionOrder && resumeData.sectionOrder.length > 0) {
    output = reorderTemplateSections(output, resumeData.sectionOrder);
  }

  output = markUrlPlaceholders(output);

  const personal: Partial<ResumeData["personal"]> = resumeData.personal || {};
  const customVars = resumeData.customVariables || {};

  // Build root context for variables (raw values; escaped on substitution)
  const rootContext: Record<string, unknown> = {
    ...customVars,
    name: personal.name,
    title: personal.title,
    email: personal.email,
    phone: personal.phone,
    location: personal.location,
    website: personal.website,
    linkedin: personal.linkedin,
    github: personal.github,
    summary: personal.summary,
  };

  const renderList = <T,>(
    sectionKey: string,
    items: T[],
    renderItem: (template: string, item: T) => string
  ) => {
    output = output.replace(
      new RegExp(`\\{\\{#${sectionKey}\\}\\}([\\s\\S]*?)\\{\\{\\/${sectionKey}\\}\\}`, "g"),
      (_: string, sectionContent: string) => {
        if (items.length === 0) return "";

        // Section body with an explicit {{#items}}...{{/items}} repeater
        if (/\{\{#items\}\}/.test(sectionContent)) {
          return sectionContent.replace(
            /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g,
            (_: string, itemTemplate: string) =>
              items.map((item) => renderItem(itemTemplate, item)).join("\n")
          );
        }

        // Direct repeat of sectionContent
        return items.map((item) => renderItem(sectionContent, item)).join("\n");
      }
    );
  };

  renderList("experience", resumeData.experience || [], renderExperienceItem);
  renderList("education", resumeData.education || [], renderEducationItem);
  renderList("projects", resumeData.projects || [], renderProjectItem);
  renderList("skills", resumeData.skills || [], renderSkillItem);

  // Custom sections repeat the whole block (no {{#items}} wrapper)
  output = output.replace(
    /\{\{#customSections\}\}([\s\S]*?)\{\{\/customSections\}\}/g,
    (_: string, sectionContent: string) => {
      const sections = resumeData.customSections || [];
      return sections.map((sec) => renderCustomSection(sectionContent, sec)).join("\n");
    }
  );

  // Top-level conditionals, then scalar variables
  output = processConditionals(output, rootContext);
  return substitute(output, rootContext);
}

function renderBullets(template: string, bullets: string[]): string {
  const filtered = bullets.filter((b) => b.trim().length > 0);
  if (filtered.length === 0) {
    return template
      .replace(/\{\{#highlights\}\}[\s\S]*?\{\{\/highlights\}\}/g, "")
      .replace(/\{\{#bullets\}\}[\s\S]*?\{\{\/bullets\}\}/g, "");
  }

  const renderBulletList = (_: string, bulletTemplate: string) =>
    filtered.map((b) => substitute(bulletTemplate, { bullet: b })).join("");

  // {{#highlights}}...{{#bullets}}...{{bullet}}...{{/bullets}}...{{/highlights}}
  const res = template.replace(
    /\{\{#highlights\}\}([\s\S]*?)\{\{\/highlights\}\}/g,
    (_: string, hlContent: string) =>
      hlContent.replace(/\{\{#bullets\}\}([\s\S]*?)\{\{\/bullets\}\}/g, renderBulletList)
  );

  // Fallback for direct {{#bullets}}...{{/bullets}}
  return res.replace(/\{\{#bullets\}\}([\s\S]*?)\{\{\/bullets\}\}/g, renderBulletList);
}

function renderItem(
  template: string,
  context: Record<string, unknown>,
  bullets?: string[]
): string {
  let rendered = processConditionals(template, context);
  rendered = renderBullets(rendered, bullets || []);
  return substitute(rendered, context);
}

const hasBullets = (bullets?: string[]) => (bullets || []).some((b) => b.trim().length > 0);

function renderExperienceItem(template: string, item: ResumeExperienceItem): string {
  return renderItem(
    template,
    {
      role: item.role,
      company: item.company,
      location: item.location,
      startDate: item.startDate,
      endDate: item.endDate,
      highlights: hasBullets(item.bullets),
    },
    item.bullets
  );
}

function renderEducationItem(template: string, item: ResumeEducationItem): string {
  return renderItem(template, {
    institution: item.institution,
    degree: item.degree,
    location: item.location,
    startDate: item.startDate,
    endDate: item.endDate,
    details: item.details,
  });
}

function renderProjectItem(template: string, item: ResumeProjectItem): string {
  return renderItem(
    template,
    {
      name: item.name,
      technologies: item.technologies,
      link: item.link,
      highlights: hasBullets(item.bullets),
    },
    item.bullets
  );
}

function renderSkillItem(template: string, item: ResumeSkillItem): string {
  return renderItem(template, {
    category: item.category,
    skills: item.skills,
  });
}

function renderCustomSection(template: string, section: ResumeCustomSection): string {
  return renderItem(
    template,
    {
      title: section.title,
      content: section.content,
      highlights: hasBullets(section.bullets),
    },
    section.bullets
  );
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Intelligently converts an arbitrary user-uploaded LaTeX file into a Vitae template,
 * simultaneously extracting pre-filled resume data from the text.
 *
 * Only contact details are detected; everything else stays as written in the
 * template. extractedData.personal contains only fields that were found.
 */
export function convertRawLatexToTemplate(rawLatex: string): {
  templateContent: string;
  extractedData: { personal?: Partial<ResumePersonalInfo> };
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

  // 1. Name: \author{Name}, \name{Name}, {\Huge \scshape Name}, {\huge \textbf{Name}}, ...
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
      const replaced = match[0].replace(rawName, "{{name}}");
      template = template.replace(match[0], () => replaced);
      break;
    }
  }

  // 2. Email (every occurrence, so both \href{mailto:x}{x} parts are parameterized)
  const emailMatch = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(template);
  if (emailMatch) {
    extractedPersonal.email = emailMatch[0];
    template = template.split(emailMatch[0]).join("{{email}}");
  }

  // 3. Phone
  const phoneMatch = /(?<![\d.])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d.])/.exec(template);
  if (phoneMatch) {
    const rawPhone = phoneMatch[0].trim();
    extractedPersonal.phone = rawPhone;
    template = template.split(rawPhone).join("{{phone}}");
  }

  // 4. GitHub / LinkedIn profile URLs. Stored as "github.com/user"; a scheme in
  // the source becomes https://{{github}}, which the URL escaping normalizes.
  const parameterizeProfile = (
    host: string,
    pathPrefix: string,
    key: "github" | "linkedin"
  ) => {
    const pattern = new RegExp(
      `(https?:\\/\\/)?(?:www\\.)?${escapeRegExp(host)}\\/${escapeRegExp(pathPrefix)}([a-zA-Z0-9_-]+)\\/?(?![a-zA-Z0-9_-])`
    );
    const match = pattern.exec(template);
    if (!match) return;
    const handle = match[2];
    extractedPersonal[key] = `${host}/${pathPrefix}${handle}`;
    const everyOccurrence = new RegExp(
      `(https?:\\/\\/)?(?:www\\.)?${escapeRegExp(host)}\\/${escapeRegExp(pathPrefix)}${escapeRegExp(handle)}\\/?(?![a-zA-Z0-9_-])`,
      "g"
    );
    template = template.replace(everyOccurrence, (_m: string, proto?: string) =>
      proto ? `https://{{${key}}}` : `{{${key}}}`
    );
  };
  parameterizeProfile("github.com", "", "github");
  parameterizeProfile("linkedin.com", "in/", "linkedin");

  return {
    templateContent: template,
    extractedData: Object.keys(extractedPersonal).length > 0 ? { personal: extractedPersonal } : {},
  };
}
