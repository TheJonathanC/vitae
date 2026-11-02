import {
  BuiltinListKey,
  ExtractedTemplateAnalysis,
  ExtractedTemplateField,
  TemplateSectionSchema,
} from "../types";

/**
 * Parser for Vitae's mustache-style template syntax:
 *
 *   {{key}}             a value (escaped for LaTeX on output)
 *   {{#key}}…{{/key}}   a list (repeated) or a condition (shown when non-empty)
 *   {{^key}}…{{/key}}   shown when key is empty
 *
 * Rendering and template analysis both work on the tree this produces, so what
 * the form offers always matches what the template prints.
 */

export type TemplateNode =
  | { type: "text"; value: string }
  | { type: "var"; key: string; mode?: "url" | "absurl" }
  | { type: "block"; key: string; inverted: boolean; children: TemplateNode[] };

export const BUILTIN_LIST_KEYS: BuiltinListKey[] = ["experience", "education", "projects", "skills", "customSections"];

export const PERSONAL_KEYS = [
  "name",
  "title",
  "email",
  "phone",
  "location",
  "website",
  "linkedin",
  "github",
  "summary",
] as const;

/** Built-in entry fields, per section, in the order the form shows them. */
export const BUILTIN_ITEM_FIELDS: Record<BuiltinListKey, string[]> = {
  experience: ["role", "company", "location", "startDate", "endDate"],
  education: ["degree", "institution", "location", "startDate", "endDate", "details"],
  projects: ["name", "technologies", "link"],
  skills: ["category", "skills"],
  customSections: ["title", "content"],
};

/** Keys with a fixed meaning inside entries; never offered as fields. */
export const ITEM_CONTROL_KEYS = new Set(["items", "bullets", "bullet", "highlights", "first", "last"]);

/** Names a template-defined section can't use (they mean something else already). */
export const RESERVED_KEYS = new Set<string>([
  ...BUILTIN_LIST_KEYS,
  ...PERSONAL_KEYS,
  ...ITEM_CONTROL_KEYS,
  "personal",
  "custom",
  "fields",
]);

const TAG = /\{\{\s*([#^/]?)\s*([a-zA-Z0-9_]+)(?::(url|absurl))?\s*\}\}/g;

/** Rewrites `{{ key }}` (with spaces) as `{{key}}` so every later step sees one spelling. */
export function canonicalizeTags(source: string): string {
  return source.replace(TAG, (_m, prefix: string, key: string, mode?: string) =>
    mode ? `{{${prefix}${key}:${mode}}}` : `{{${prefix}${key}}}`
  );
}

interface OpenBlock {
  key: string | null;
  inverted: boolean;
  children: TemplateNode[];
}

/**
 * Parses a template into a tree. Stray closing tags are dropped; a block that
 * is never closed is treated as plain content (its tag disappears, its body
 * stays), so a typo can't swallow the rest of the document.
 */
export function parseTemplate(source: string): TemplateNode[] {
  const root: OpenBlock = { key: null, inverted: false, children: [] };
  const stack: OpenBlock[] = [root];
  const top = () => stack[stack.length - 1];

  const pushText = (value: string) => {
    if (!value) return;
    const siblings = top().children;
    const last = siblings[siblings.length - 1];
    if (last && last.type === "text") last.value += value;
    else siblings.push({ type: "text", value });
  };

  const closeTop = () => {
    const block = stack.pop()!;
    top().children.push({ type: "block", key: block.key!, inverted: block.inverted, children: block.children });
  };

  /** Folds an unclosed block's children into its parent. */
  const dissolveTop = () => {
    const block = stack.pop()!;
    for (const child of block.children) {
      if (child.type === "text") pushText(child.value);
      else top().children.push(child);
    }
  };

  let last = 0;
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG.exec(source)) !== null) {
    pushText(source.slice(last, match.index));
    last = match.index + match[0].length;
    const [, prefix, key, mode] = match;

    if (prefix === "#" || prefix === "^") {
      stack.push({ key, inverted: prefix === "^", children: [] });
    } else if (prefix === "/") {
      const depth = stack.map((b) => b.key).lastIndexOf(key);
      if (depth <= 0) continue; // stray close
      while (stack.length - 1 > depth) dissolveTop();
      closeTop();
    } else {
      top().children.push(mode ? { type: "var", key, mode: mode as "url" | "absurl" } : { type: "var", key });
    }
  }
  pushText(source.slice(last));
  while (stack.length > 1) dissolveTop();
  return root.children;
}

/** True when the block (or a block nested inside it) repeats `{{#items}}`. */
export function containsItemsBlock(nodes: TemplateNode[]): boolean {
  return nodes.some(
    (node) => node.type === "block" && (node.key === "items" || containsItemsBlock(node.children))
  );
}

const HEADING = /\\[a-zA-Z]*section\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/;

/** Plain text of the first `\section{…}`-like heading in a block's own text. */
function findHeading(nodes: TemplateNode[]): string | undefined {
  for (const node of nodes) {
    if (node.type === "text") {
      const match = HEADING.exec(node.value);
      if (match) return cleanHeading(match[1]);
    } else if (node.type === "block" && node.key === "items") {
      return undefined; // headings come before the entries
    }
  }
  return undefined;
}

export function cleanHeading(raw: string): string {
  return raw
    .replace(/\\[a-zA-Z]+\*?\s*/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_LABELS: Record<string, string> = {
  startDate: "Start",
  endDate: "End",
  dates: "Dates",
  url: "URL",
  gpa: "GPA",
};

/** "security_clearance" → "Security clearance", "startDate" → "Start date". */
export function humanizeKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const spaced = key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.replace(/^\w/, (c) => c.toUpperCase());
}

const LONG_TEXT_HINT = /summary|desc|about|objective|profile|statement|bio|interests|overview/i;

/**
 * Works out what a template asks for: which contact fields it prints, which
 * repeating sections it has (built-in or its own) and which fields each of
 * their entries uses, and which other values it needs.
 */
export function analyzeTemplate(templateContent: string): ExtractedTemplateAnalysis {
  const tree = parseTemplate(canonicalizeTags(templateContent));
  const personalFields: string[] = [];
  const sections: TemplateSectionSchema[] = [];
  const customVariables: ExtractedTemplateField[] = [];
  const seenVars = new Set<string>();

  const addPersonal = (key: string) => {
    if (!personalFields.includes(key)) personalFields.push(key);
  };

  const addVariable = (key: string, heading?: string, long = false) => {
    const existing = customVariables.find((v) => v.key === key);
    if (existing) {
      if (long) existing.type = "textarea";
      if (heading && existing.label === humanizeKey(key)) existing.label = heading;
      return;
    }
    if (seenVars.has(key)) return;
    seenVars.add(key);
    customVariables.push({
      key,
      label: heading || humanizeKey(key),
      type: long || LONG_TEXT_HINT.test(key) ? "textarea" : "text",
    });
  };

  const isListBlock = (node: Extract<TemplateNode, { type: "block" }>) =>
    !node.inverted &&
    ((BUILTIN_LIST_KEYS as string[]).includes(node.key) ||
      (!RESERVED_KEYS.has(node.key) && containsItemsBlock(node.children)));

  /** Collects entry fields, skipping the bullet loop's own placeholder. */
  const walkItem = (nodes: TemplateNode[], section: TemplateSectionSchema) => {
    for (const node of nodes) {
      if (node.type === "var") {
        if (!ITEM_CONTROL_KEYS.has(node.key) && !section.fields.includes(node.key)) section.fields.push(node.key);
      } else if (node.type === "block") {
        if (node.key === "bullets") {
          section.hasBullets = true;
          continue;
        }
        if (node.key === "highlights") section.hasBullets = true;
        if (!ITEM_CONTROL_KEYS.has(node.key) && !section.fields.includes(node.key)) section.fields.push(node.key);
        walkItem(node.children, section);
      }
    }
  };

  /** The part of a list block outside `{{#items}}` reads top-level values. */
  const walkListFrame = (nodes: TemplateNode[], section: TemplateSectionSchema) => {
    for (const node of nodes) {
      if (node.type !== "block") {
        if (node.type === "var") walkRoot([node]);
        continue;
      }
      if (node.key === "items") walkItem(node.children, section);
      else if (containsItemsBlock(node.children)) walkListFrame(node.children, section);
      else walkRoot([node]);
    }
  };

  const walkRoot = (nodes: TemplateNode[], heading?: string) => {
    for (const node of nodes) {
      if (node.type === "var") {
        if ((PERSONAL_KEYS as readonly string[]).includes(node.key)) addPersonal(node.key);
        else if (!ITEM_CONTROL_KEYS.has(node.key) && !(BUILTIN_LIST_KEYS as string[]).includes(node.key)) {
          addVariable(node.key, heading, !!heading);
        }
        continue;
      }
      if (node.type !== "block") continue;

      if (isListBlock(node)) {
        if (sections.some((s) => s.key === node.key)) continue;
        const section: TemplateSectionSchema = {
          key: node.key,
          builtin: (BUILTIN_LIST_KEYS as string[]).includes(node.key),
          heading: findHeading(node.children),
          fields: [],
          hasBullets: false,
        };
        sections.push(section);
        if (containsItemsBlock(node.children)) walkListFrame(node.children, section);
        else walkItem(node.children, section);
        continue;
      }

      // A condition on a top-level value. A heading inside it names the value.
      const blockHeading = findHeading(node.children);
      if ((PERSONAL_KEYS as readonly string[]).includes(node.key)) addPersonal(node.key);
      else if (!ITEM_CONTROL_KEYS.has(node.key)) {
        const printsItself = node.children.some((c) => c.type === "var" && c.key === node.key);
        if (!printsItself) addVariable(node.key, blockHeading);
      }
      walkRoot(node.children, blockHeading ?? heading);
    }
  };

  walkRoot(tree);

  return {
    hasStandardStructure: sections.length > 0,
    detectedSections: sections.filter((s) => s.builtin).map((s) => s.key),
    customVariables,
    personalFields,
    sections,
  };
}
