import {
  ResumeData,
  ResumeListItem,
  ExtractedTemplateAnalysis,
} from "../types";
import { analyzeTemplate, canonicalizeTags, containsItemsBlock, parseTemplate, TemplateNode } from "./templateParser";

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
const asStringRecord = (value: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(asObject(value)).filter(([, v]) => typeof v === "string")) as Record<
    string,
    string
  >;
/** Adds `fields` only when the entry has some, so standard entries stay unchanged. */
const withFields = <T extends object>(item: T, raw: Record<string, unknown>): T => {
  const fields = asStringRecord(raw.fields);
  return Object.keys(fields).length > 0 ? { ...item, fields } : item;
};

/**
 * Coerces stored resume_data JSON (possibly from an older version, or partially
 * written) into a complete ResumeData so the form never reads a missing array.
 */
export function normalizeResumeData(raw: unknown): ResumeData {
  const data = asObject(raw);
  const personal = asObject(data.personal);
  const customVariables = asStringRecord(data.customVariables);

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
    experience: asArray(data.experience).map((item) =>
      withFields({
        id: asString(item.id) || createId("exp"),
        role: asString(item.role),
        company: asString(item.company),
        location: asString(item.location),
        startDate: asString(item.startDate),
        endDate: asString(item.endDate),
        bullets: asStringArray(item.bullets),
      }, item)
    ),
    education: asArray(data.education).map((item) =>
      withFields({
        id: asString(item.id) || createId("edu"),
        degree: asString(item.degree),
        institution: asString(item.institution),
        location: asString(item.location),
        startDate: asString(item.startDate),
        endDate: asString(item.endDate),
        details: asString(item.details),
      }, item)
    ),
    projects: asArray(data.projects).map((item) =>
      withFields({
        id: asString(item.id) || createId("proj"),
        name: asString(item.name),
        technologies: asString(item.technologies),
        link: asString(item.link),
        bullets: asStringArray(item.bullets),
      }, item)
    ),
    skills: asArray(data.skills).map((item) =>
      withFields({
        id: asString(item.id) || createId("skill"),
        category: asString(item.category),
        skills: asString(item.skills),
      }, item)
    ),
    customSections: asArray(data.customSections).map((item) =>
      withFields({
        id: asString(item.id) || createId("sec"),
        title: asString(item.title),
        content: asString(item.content),
        bullets: asStringArray(item.bullets),
      }, item)
    ),
    customVariables,
  };

  const customLists: Record<string, ResumeListItem[]> = {};
  for (const [key, items] of Object.entries(asObject(data.customLists))) {
    if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
    customLists[key] = asArray(items).map((item) => ({
      id: asString(item.id) || createId("item"),
      fields: asStringRecord(item.fields),
      bullets: asStringArray(item.bullets),
    }));
  }
  if (Object.keys(customLists).length > 0) normalized.customLists = customLists;

  if (Array.isArray(data.sectionOrder)) {
    normalized.sectionOrder = asStringArray(data.sectionOrder);
  }
  if (data.sourceEditedManually === true) {
    normalized.sourceEditedManually = true;
  }
  return normalized;
}

/**
 * Extracts the placeholders, repeating sections (with the fields each entry
 * uses) and extra values a template needs. See analyzeTemplate.
 */
export function extractFieldsFromTemplate(templateContent: string): ExtractedTemplateAnalysis {
  return analyzeTemplate(templateContent);
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

  const blockRegex = (key: string) =>
    new RegExp(`\\{\\{#${key}\\}\\}[\\s\\S]*?\\{\\{\\/${key}\\}\\}`);
  const sectionRegexes: Record<string, RegExp> = {
    experience: blockRegex("experience"),
    education: blockRegex("education"),
    projects: blockRegex("projects"),
    skills: blockRegex("skills"),
    custom: blockRegex("customSections"),
  };
  // Template-defined sections (customLists) are movable too.
  for (const key of sectionOrder) {
    if (/^[a-zA-Z0-9_]+$/.test(key) && !(key in sectionRegexes) && key !== "personal" && key !== "customSections") {
      sectionRegexes[key] = blockRegex(key);
    }
  }

  interface BlockMatch {
    key: string;
    start: number;
    end: number;
    content: string;
  }

  const matches: BlockMatch[] = [];

  for (const [key, regex] of Object.entries(sectionRegexes)) {
    const match = regex.exec(templateContent);
    if (match) {
      matches.push({
        key,
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

type ScopeVars = Record<string, unknown>;

interface Scope {
  vars: ScopeVars;
  parent?: Scope;
  /** Entry scopes don't fall back to top-level values (an empty entry location must not print yours). */
  isolated?: boolean;
}

function lookup(scope: Scope | undefined, key: string): unknown {
  for (let s = scope; s; s = s.parent) {
    if (Object.prototype.hasOwnProperty.call(s.vars, key)) return s.vars[key];
    if (s.isolated) return undefined;
  }
  return undefined;
}

const isTruthy = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  value !== false &&
  value !== "" &&
  (!Array.isArray(value) || value.length > 0);

/** Values are stored raw; escaping depends on where the placeholder sits (text vs URL). */
function formatValue(value: unknown, mode?: "url" | "absurl"): string {
  if (value === undefined || value === null || value === false || typeof value === "object") return "";
  const raw = String(value);
  if (mode === "absurl") return sanitizeLatexUrl(raw);
  if (mode === "url") return escapeLatexUrl(raw);
  return escapeLatex(raw);
}

const entryScope = (vars: ScopeVars, index: number, count: number, parent: Scope): Scope => ({
  vars: { first: index === 0, last: index === count - 1, ...vars },
  parent,
  isolated: true,
});

function renderNodes(nodes: TemplateNode[], scope: Scope, lists: Record<string, ScopeVars[]>): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.value;
      continue;
    }
    if (node.type === "var") {
      out += formatValue(lookup(scope, node.key), node.mode);
      continue;
    }

    // A section list at the top level: {{#experience}}…{{/experience}}
    if (!scope.parent && Object.prototype.hasOwnProperty.call(lists, node.key)) {
      const items = lists[node.key];
      if (node.inverted) {
        if (items.length === 0) out += renderNodes(node.children, scope, lists);
      } else if (items.length > 0) {
        out += containsItemsBlock(node.children)
          ? renderNodes(node.children, { vars: { items }, parent: scope }, lists)
          : items
              .map((item, i) => renderNodes(node.children, entryScope(item, i, items.length, scope), lists))
              .join("\n");
      }
      continue;
    }

    const value = lookup(scope, node.key);
    if (node.inverted) {
      if (!isTruthy(value)) out += renderNodes(node.children, scope, lists);
    } else if (Array.isArray(value)) {
      // {{#items}} repeats entries (one per line); {{#bullets}} repeats strings.
      const strings = value.length > 0 && typeof value[0] === "string";
      out += value
        .map((element, i) =>
          typeof element === "string"
            ? renderNodes(node.children, { vars: { bullet: element }, parent: scope }, lists)
            : renderNodes(node.children, entryScope(element as ScopeVars, i, value.length, scope), lists)
        )
        .join(strings ? "" : "\n");
    } else if (isTruthy(value)) {
      out += renderNodes(node.children, scope, lists);
    }
  }
  return out;
}

/** An entry's values: template-specific fields, then the standard ones, then its bullets. */
function entryVars(
  fields: Record<string, string> | undefined,
  bullets: string[] | undefined,
  standard: ScopeVars = {}
): ScopeVars {
  const filtered = (bullets || []).filter((b) => b.trim().length > 0);
  return { ...(fields || {}), ...standard, bullets: filtered, highlights: filtered.length > 0 };
}

/** Every list a template can repeat, keyed by its placeholder name. */
function buildLists(resumeData: ResumeData): Record<string, ScopeVars[]> {
  const lists: Record<string, ScopeVars[]> = {};
  for (const [key, items] of Object.entries(resumeData.customLists || {})) {
    if (!/^[a-zA-Z0-9_]+$/.test(key) || !Array.isArray(items)) continue;
    lists[key] = items.map((item) => entryVars(item.fields, item.bullets));
  }
  lists.experience = (resumeData.experience || []).map((item) =>
    entryVars(item.fields, item.bullets, {
      role: item.role,
      company: item.company,
      location: item.location,
      startDate: item.startDate,
      endDate: item.endDate,
    })
  );
  lists.education = (resumeData.education || []).map((item) =>
    entryVars(item.fields, undefined, {
      institution: item.institution,
      degree: item.degree,
      location: item.location,
      startDate: item.startDate,
      endDate: item.endDate,
      details: item.details,
    })
  );
  lists.projects = (resumeData.projects || []).map((item) =>
    entryVars(item.fields, item.bullets, { name: item.name, technologies: item.technologies, link: item.link })
  );
  lists.skills = (resumeData.skills || []).map((item) =>
    entryVars(item.fields, undefined, { category: item.category, skills: item.skills })
  );
  lists.customSections = (resumeData.customSections || []).map((item) =>
    entryVars(item.fields, item.bullets, { title: item.title, content: item.content })
  );
  return lists;
}

/**
 * Renders a full template given ResumeData.
 */
export function renderTemplate(templateContent: string, resumeData: ResumeData): string {
  let output = canonicalizeTags(templateContent);

  if (resumeData.sectionOrder && resumeData.sectionOrder.length > 0) {
    output = reorderTemplateSections(output, resumeData.sectionOrder);
  }

  output = markUrlPlaceholders(output);

  const personal: Partial<ResumeData["personal"]> = resumeData.personal || {};
  const root: Scope = {
    vars: {
      ...(resumeData.customVariables || {}),
      name: personal.name,
      title: personal.title,
      email: personal.email,
      phone: personal.phone,
      location: personal.location,
      website: personal.website,
      linkedin: personal.linkedin,
      github: personal.github,
      summary: personal.summary,
    },
  };

  return renderNodes(parseTemplate(output), root, buildLists(resumeData));
}
