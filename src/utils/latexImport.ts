import {
  ResumeData,
  ResumePersonalInfo,
  ResumeExperienceItem,
  ResumeEducationItem,
  ResumeProjectItem,
  ResumeSkillItem,
  ResumeListItem,
} from "../types";
import { createId, getEmptyResumeData, renderTemplate } from "./templateEngine";
import { RESERVED_KEYS, cleanHeading } from "./templateParser";
import {
  Range,
  Leaf,
  Lexicon,
  LatexEvent,
  FORMATTING_CMDS,
  buildLexicon,
  scanEvents,
  containerEnd,
  collectLeaves,
  plainText,
  readArgs,
  skipFiller,
  matchGroup,
  trimWhitespace,
} from "./latexScan";

/**
 * Turns a LaTeX resume into a Vitae template plus the data it contained.
 *
 * The file is split into its header (name and contact details) and its
 * sections. Each section's heading suggests what it is ("Work History" →
 * experience); its body is split into entries (one per `\resumeSubheading`,
 * `\cventry`, `\item` or line), and the text pieces of an entry become fields
 * ("Aug 2018 -- May 2021" → start and end dates). The first entry becomes the
 * pattern every entry is printed with, and each entry's text becomes form data.
 *
 * analyzeLatexImport() makes a plan with its guesses; buildLatexImport() turns
 * a (possibly corrected) plan into the template and data.
 */

export type SectionMapping = "experience" | "education" | "projects" | "skills" | "summary" | "list" | "text" | "keep";
export type SlotType = "date" | "dateRange" | "location" | "link" | "list" | "text";

/** One text piece that repeats in every entry of a section. */
export interface ImportSlot {
  id: string;
  type: SlotType;
  /** The piece's text in each entry ("" where an entry lacks it). */
  samples: string[];
  /** Field it fills; "" keeps the first entry's text as fixed text. */
  field: string;
  /** Same text in every entry, like a "Link" label. */
  constant: boolean;
}

export interface ImportSection {
  id: string;
  heading: string;
  shape: "entries" | "paragraph" | "empty";
  mapping: SectionMapping;
  suggested: SectionMapping;
  /** Placeholder name for list and text mappings. */
  key: string;
  entryCount: number;
  bulletCount: number;
  slots: ImportSlot[];
  /** Start of the section's text, for the review screen. */
  preview: string;
}

export interface ImportPlan {
  /** The file already uses {{placeholders}} and is imported as it is. */
  parameterized: boolean;
  personal: Partial<ResumePersonalInfo>;
  sections: ImportSection[];
}

export interface ImportedData {
  personal?: Partial<ResumePersonalInfo>;
  experience?: ResumeExperienceItem[];
  education?: ResumeEducationItem[];
  projects?: ResumeProjectItem[];
  skills?: ResumeSkillItem[];
  customLists?: Record<string, ResumeListItem[]>;
  customVariables?: Record<string, string>;
}

export interface ImportResult {
  templateContent: string;
  extractedData: ImportedData;
  /** How much of the original text the new template reproduces (0–1); null when nothing was converted. */
  match: number | null;
}

/* ---------- Classifying headings and text ---------- */

const HEADING_KINDS: [SectionMapping, RegExp][] = [
  ["summary", /^(?:(?:professional|career|executive|personal)\s+)?(?:summary|profile|objective|overview|statement)$|^about(?: me)?$/],
  ["projects", /\bprojects?\b|\bportfolio\b/],
  ["experience", /experience|employment|work history|career history|professional background|internships?\b|positions?\b/],
  ["education", /education|academic background|academics|qualifications|schooling/],
  ["skills", /skills|competenc|technolog|expertise|proficienc|toolbox|tools/],
];

export function classifyHeading(heading: string): SectionMapping | null {
  const h = heading.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  for (const [kind, re] of HEADING_KINDS) if (re.test(h)) return kind;
  return null;
}

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PART = `(?:(?:spring|summer|fall|autumn|winter)\\s+)?(?:(?:${MONTHS})\\.?,?\\s*)?(?:\\d{1,2}[/.]\\s*)?(?:19|20)\\d{2}|present|current|now|ongoing|today`;
const SINGLE_DATE = new RegExp(`^(?:(?:expected|since|graduat(?:ed|ing)|until)\\s+)?(?:${DATE_PART})$`, "i");
const DATE_RANGE = new RegExp(`^(${DATE_PART})\\s*(--+|–|—|-|to|until)\\s*(${DATE_PART})$`, "i");

const PLACES =
  "USA|US|UK|UAE|Canada|India|Germany|France|Spain|Italy|China|Japan|Australia|Brazil|Mexico|Netherlands|Singapore|Ireland|Sweden|Switzerland|Israel|Korea|South Korea|Portugal|Poland|Austria|Belgium|Denmark|Norway|Finland|New Zealand|Argentina|Chile|Colombia|Nigeria|Kenya|South Africa|Egypt|Pakistan|Bangladesh|Vietnam|Indonesia|Philippines|Malaysia|Thailand|Turkey|Greece|Romania|Czechia|Hungary|Ukraine|England|Scotland|Wales|California|Texas|New York|Washington|Massachusetts|Illinois|Florida|Ontario|Quebec|British Columbia|Remote";
const LOCATION = new RegExp(
  `^[A-Z][\\p{L}.'-]*(?:\\s+[A-Z][\\p{L}.'-]*){0,3},\\s*(?:[A-Z]{2,3}|${PLACES})$|^(?:remote|hybrid|on-?site|online|worldwide)(?:\\s*\\(.*\\))?$`,
  "iu"
);
const LINK = /^(?:https?:\/\/|www\.)\S+$|^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*$|^[a-z0-9-]+\.(?:com|io|dev|org|net|me|ai|app|co|so|xyz|tech)$/i;
const LINK_WORDS = /^(?:link|code|demo|github|website|paper|pdf|slides|video|source|repo|live|site|preview|here|project|publication|view)$/i;

function classifyValue(value: string, url: boolean): SlotType {
  if (url || LINK.test(value)) return "link";
  if (DATE_RANGE.test(value)) return "dateRange";
  if (SINGLE_DATE.test(value)) return "date";
  if (/^[A-Z]/.test(value) && value.length <= 40 && !/\d/.test(value) && LOCATION.test(value)) return "location";
  if (value.split(",").length >= 3 && value.split(",").every((p) => p.trim().split(/\s+/).length <= 4)) return "list";
  return "text";
}

const ROLE =
  /\b(engineer|developer|intern|assistant|manager|analyst|lead|director|consultant|researcher|scientist|designer|specialist|coordinator|associate|officer|teacher|tutor|architect|administrator|programmer|founder|president|head|vp|chief|cto|ceo|technician|fellow|volunteer|member|representative|editor|writer|instructor|professor|lecturer|postdoc|trainee|apprentice|contractor|freelancer?|owner|partner|executive|supervisor|staff|principal|senior|junior|sr|jr)\b/i;
const ORG =
  /\b(inc|llc|ltd|corp|corporation|company|gmbh|university|college|institute|labs?|technologies|systems|solutions|group|foundation|bank|hospital|agency|studio|school|department|center|centre)\b|\b[A-Z]{2,}\b/;
const DEGREE =
  /\b(bachelor|master|b\.?\s?sc?|b\.?\s?a|m\.?\s?sc?|m\.?\s?a|ph\.?\s?d|mba|b\.?\s?eng|m\.?\s?eng|b\.?\s?tech|m\.?\s?tech|associate|diploma|certificate|degree|minor|major|high school|a-levels|honou?rs)\b/i;
const SCHOOL = /\b(university|college|institute|school|academy|polytechnic|conservatory|universit\w*|[eé]cole)\b/i;

const share = (samples: string[], re: RegExp) => {
  const filled = samples.filter(Boolean);
  return filled.length ? filled.filter((s) => re.test(s)).length / filled.length : 0;
};

const normalizeLink = (value: string) =>
  value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");

/* ---------- Field choices per section type ---------- */

const DATED: SectionMapping[] = ["experience", "education"];

const FIELD_CHOICES: Partial<Record<SectionMapping, [string, string][]>> = {
  experience: [
    ["role", "Role"], ["company", "Company"], ["location", "Location"], ["dates", "Dates (start – end)"],
    ["startDate", "Start date"], ["endDate", "End date"], ["details", "Details"], ["link", "Link"],
  ],
  education: [
    ["institution", "School"], ["degree", "Degree"], ["location", "Location"], ["dates", "Dates (start – end)"],
    ["startDate", "Start date"], ["endDate", "End date"], ["details", "Details"], ["link", "Link"],
  ],
  projects: [["name", "Name"], ["technologies", "Technologies"], ["link", "Link"], ["dates", "Dates"], ["details", "Details"]],
  skills: [["category", "Category"], ["skills", "Skills"], ["details", "Details"]],
  list: [
    ["title", "Title"], ["subtitle", "Subtitle"], ["dates", "Dates"], ["location", "Location"],
    ["link", "Link"], ["details", "Details"], ["description", "Description"],
  ],
};

/** Field choices for a slot in a section of this type ("" keeps the text fixed). */
export function fieldOptions(mapping: SectionMapping, current?: string): { value: string; label: string }[] {
  const choices = (FIELD_CHOICES[mapping] || []).map(([value, label]) => ({ value, label }));
  if (current && !choices.some((c) => c.value === current)) {
    choices.push({ value: current, label: current.replace(/_(\d+)$/, " $1").replace(/^\w/, (c) => c.toUpperCase()) });
  }
  return [...choices, { value: "", label: "Keep as written" }];
}

export const MAPPING_LABELS: Record<SectionMapping, string> = {
  experience: "Experience",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  summary: "Summary",
  list: "Its own section",
  text: "A text field",
  keep: "Keep as written",
};

/** Section types a section of this shape can be. Taken single-use types are disabled. */
export function mappingOptions(plan: ImportPlan, section: ImportSection) {
  const kinds: SectionMapping[] =
    section.shape === "entries"
      ? ["experience", "education", "projects", "skills", "list", "keep"]
      : section.shape === "paragraph"
        ? ["summary", "text", "keep"]
        : ["keep"];
  return kinds.map((value) => ({
    value,
    label: MAPPING_LABELS[value],
    disabled:
      value !== section.mapping &&
      !["list", "text", "keep"].includes(value) &&
      plan.sections.some((s) => s.id !== section.id && s.mapping === value),
  }));
}

/** Best guess of what each slot holds, for a section of the given type. */
export function guessFields(mapping: SectionMapping, slots: ImportSlot[]): string[] {
  const out = slots.map(() => "");
  const used = new Set<string>();
  const take = (i: number, field: string) => {
    if (used.has(field)) return false;
    used.add(field);
    out[i] = field;
    return true;
  };
  const extra = (i: number) => {
    let n = 1;
    while (!take(i, n === 1 ? "details" : `details_${n}`)) n++;
  };
  if (!FIELD_CHOICES[mapping]) return out;

  const linkSlots: number[] = [];
  slots.forEach((slot, i) => {
    if (slot.constant) return;
    if (slot.type === "link" && mapping !== "skills") {
      if (take(i, "link")) linkSlots.push(i);
    } else if ((slot.type === "date" || slot.type === "dateRange") && mapping !== "skills") {
      if (DATED.includes(mapping)) {
        if (slot.type === "dateRange" || !used.has("dates")) {
          if (!used.has("dates") && !used.has("startDate")) take(i, slot.type === "dateRange" ? "dates" : "startDate");
          else take(i, "endDate");
        } else take(i, "endDate");
      } else take(i, used.has("dates") ? `dates_${slots.length}` : "dates");
    } else if (slot.type === "location" && (mapping === "experience" || mapping === "education" || mapping === "list")) {
      take(i, "location");
    }
  });

  // The visible text of a link is the link itself ("github.com/me/tool").
  slots.forEach((slot, i) => {
    if (out[i] || slot.constant) return;
    const match = linkSlots.find((l) =>
      slots[l].samples.every((s, n) => !s || normalizeLink(s) === normalizeLink(slot.samples[n] || ""))
    );
    if (match !== undefined && slot.samples.some(Boolean)) out[i] = "link";
  });

  const texts = slots.map((_s, i) => i).filter((i) => !out[i] && !slots[i].constant);
  const pair = (a: string, b: string, aRe: RegExp, bRe: RegExp) => {
    let [first, second] = texts;
    if (second !== undefined) {
      const forward = share(slots[first].samples, aRe) + share(slots[second].samples, bRe);
      const swapped = share(slots[second].samples, aRe) + share(slots[first].samples, bRe);
      if (swapped > forward) [first, second] = [second, first];
    }
    if (first !== undefined) take(first, a);
    if (second !== undefined) take(second, b);
    texts.filter((i) => i !== first && i !== second).forEach(extra);
  };

  switch (mapping) {
    case "experience":
      pair("role", "company", ROLE, ORG);
      break;
    case "education":
      pair("institution", "degree", SCHOOL, DEGREE);
      break;
    case "projects": {
      const tech = texts.find((i) => slots[i].type === "list") ?? texts[1];
      const name = texts.find((i) => i !== tech);
      if (name !== undefined) take(name, "name");
      if (tech !== undefined) take(tech, "technologies");
      texts.filter((i) => i !== tech && i !== name).forEach(extra);
      break;
    }
    case "skills":
      if (texts.length === 1) take(texts[0], "skills");
      else pair("category", "skills", /^.{1,40}$/, /,/);
      break;
    case "list":
      texts.forEach((i, n) => {
        if (n === 0) take(i, "title");
        else if (n === 1) take(i, "subtitle");
        else extra(i);
      });
      break;
  }
  return out;
}

/* ---------- Scanning the document ---------- */

interface BulletItem {
  start: number;
  contentStart: number;
  contentEnd: number;
}

interface BulletRegion extends Range {
  closeStart: number;
  items: BulletItem[];
}

interface Entry extends Range {
  leaves: Leaf[];
  /** Slot key of each leaf (stable across entries: argument and position). */
  keys: string[];
  bullets?: BulletRegion;
}

interface ScannedSection {
  /** Start of the heading command. */
  start: number;
  /** End of the section's content (whitespace trimmed). */
  end: number;
  heading: string;
  kind: SectionMapping | null;
  shape: "entries" | "paragraph" | "empty";
  region?: Range & { separator?: string };
  entries: Entry[];
  paragraph?: Range;
}

interface ScannedDoc {
  src: string;
  body: Range;
  header: Range;
  sections: ScannedSection[];
}

const isHeadingCommand = (lex: Lexicon, name: string, level: "section" | "subsection") =>
  level === "section"
    ? lex.headingCmds.has(name) || (/section$/i.test(name) && !/sub/i.test(name))
    : /^subsection$/.test(name);

/** Stops `{{Name}}` in the original from reading as a placeholder (`{{}{Name}}` typesets the same). */
function neutralizeBraces(src: string): string {
  return src.replace(/\{\{(?=\s*[#^/]?\s*[a-zA-Z0-9_]+\s*\}\})/g, "{{}{");
}

function scanDocument(raw: string): ScannedDoc {
  const src = neutralizeBraces(raw);
  const lex = buildLexicon(src);
  const begin = /\\begin\s*\{document\}/.exec(src);
  const endDoc = /\\end\s*\{document\}/.exec(src);
  const body: Range = {
    start: begin ? begin.index + begin[0].length : 0,
    end: endDoc && (!begin || endDoc.index > begin.index) ? endDoc.index : src.length,
  };

  const events = scanEvents(src, body.start, body.end, lex);
  const headings: { start: number; bodyStart: number; heading: string }[] = [];
  for (const level of ["section", "subsection"] as const) {
    for (const ev of events) {
      if (ev.type !== "cmd" || ev.depth !== 0 || !isHeadingCommand(lex, ev.name, level)) continue;
      const { args, end } = readArgs(src, ev.end, 1, body.end, true);
      if (args.length === 0) continue;
      const heading = cleanHeading(plainText(src, args[0].start, args[0].end));
      if (heading) headings.push({ start: ev.start, bodyStart: end, heading });
    }
    if (headings.length > 0) break;
  }

  const sections: ScannedSection[] = headings.map((h, i) => {
    const next = i + 1 < headings.length ? headings[i + 1].start : body.end;
    const sectionEvents = scanEvents(src, h.bodyStart, next, lex);
    const content = trimTrailingComments(
      src,
      trimWhitespace(src, { start: h.bodyStart, end: containerEnd(sectionEvents, h.bodyStart, next) })
    );
    const kind = classifyHeading(h.heading);
    return {
      start: h.start,
      end: content.end,
      heading: h.heading,
      kind,
      ...analyzeBody(src, content, lex, kind),
    };
  });

  const header: Range = { start: body.start, end: sections.length ? sections[0].start : body.end };
  return { src, body, header, sections };
}

/** Drops comment lines at the end of a range (`%---- PROJECTS ----` belongs to the next section). */
function trimTrailingComments(src: string, range: Range): Range {
  let r = range;
  for (;;) {
    const lineStart = src.lastIndexOf("\n", r.end - 1) + 1;
    if (lineStart <= r.start || !/^\s*%/.test(src.slice(lineStart, r.end))) return r;
    r = trimWhitespace(src, { start: r.start, end: lineStart });
  }
}

/** The list that opens at events[index] closes at the returned index. */
function matchList(events: LatexEvent[], index: number): number {
  let depth = 0;
  for (let i = index; i < events.length; i++) {
    if (events[i].type === "list-open") depth++;
    else if (events[i].type === "list-close" && --depth === 0) return i;
  }
  return -1;
}

function listDepths(events: LatexEvent[]): number[] {
  let depth = 0;
  return events.map((ev) => {
    if (ev.type === "list-close") depth = Math.max(0, depth - 1);
    const at = depth;
    if (ev.type === "list-open") depth++;
    return at;
  });
}

function analyzeBody(
  src: string,
  range: Range,
  lex: Lexicon,
  kind: SectionMapping | null
): Pick<ScannedSection, "shape" | "region" | "entries" | "paragraph"> {
  const splitColon = kind === "skills";
  const events = scanEvents(src, range.start, range.end, lex);
  const depths = listDepths(events);
  const leavesIn = (r: Range, exclude: Range[] = []) => collectLeaves(src, r.start, r.end, { exclude, splitColon });

  let entries: (Range & { args?: Range[] })[] = [];
  let collapse = false;

  // A. One call of an entry macro per entry (\resumeSubheading, \cventry, …).
  const calls: { name: string; start: number; end: number; args: Range[]; depth: number; brace: number }[] = [];
  events.forEach((ev, i) => {
    if (ev.type !== "cmd" || FORMATTING_CMDS.has(ev.name) || lex.headingCmds.has(ev.name) || lex.bulletMacros.has(ev.name)) return;
    const def = lex.macros.get(ev.name);
    if (def && def.args < 2) return;
    const { args, end } = readArgs(src, ev.end, def ? def.args : 9, range.end, def?.optional);
    if (args.length < 2) return;
    if (calls.some((c) => c.args.some((a) => a.start <= ev.start && ev.start < a.end))) return;
    calls.push({ name: ev.name, start: ev.start, end, args, depth: depths[i], brace: ev.depth });
  });
  if (calls.length > 0) {
    const level = (c: (typeof calls)[number]) => c.depth * 100 + c.brace;
    const top = Math.min(...calls.map(level));
    const counts = new Map<string, number>();
    for (const c of calls) if (level(c) === top) counts.set(c.name, (counts.get(c.name) || 0) + 1);
    const name = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const chosen = calls.filter((c) => c.name === name && level(c) === top);
    entries = chosen.map((c, k) => {
      const end = k + 1 < chosen.length ? chosen[k + 1].start : containerEnd(events, c.end, range.end);
      return { ...trimWhitespace(src, { start: c.start, end }), args: c.args };
    });
  }

  // B / C. Entries made of plain lists.
  if (entries.length === 0) {
    const tops = events
      .map((ev, i) => ({ ev, i }))
      .filter(({ ev, i }) => ev.type === "list-open" && depths[i] === 0)
      .map(({ ev, i }) => ({ open: ev, index: i, close: matchList(events, i) }))
      .filter((l) => l.close !== -1);
    const listRanges = tops.map((l) => ({ start: l.open.start, end: events[l.close].end }));
    const outside = leavesIn(range, listRanges);

    if (tops.length === 1 && outside.length === 0) {
      // B. Each \item (or one-argument item macro) of a single list.
      const { index, close } = tops[0];
      const starts: number[] = [];
      for (let i = index + 1; i < close; i++) {
        const ev = events[i];
        if (depths[i] !== 1) continue;
        if (ev.type === "item" || (ev.type === "cmd" && lex.bulletMacros.has(ev.name))) starts.push(ev.start);
      }
      entries = starts.map((start, k) =>
        trimWhitespace(src, { start, end: k + 1 < starts.length ? starts[k + 1] : events[close].start })
      );
      collapse = true;
    } else if (tops.length > 0) {
      // C. A heading line, then a list of bullets: one entry each.
      let from = range.start;
      const segments: Range[] = [];
      for (const l of tops) {
        const seg = trimWhitespace(src, { start: from, end: events[l.close].end });
        if (leavesIn({ start: seg.start, end: l.open.start }).length === 0) {
          segments.length = 0;
          break;
        }
        segments.push(seg);
        from = events[l.close].end;
      }
      entries = segments;
    }
  }

  // D. Paragraphs, one entry each: under an entry-type heading, or when they share one layout.
  if (entries.length === 0) {
    const paragraphs = splitParagraphs(src, range).filter((p) => leavesIn(p).length > 0);
    const structured = kind !== null && kind !== "summary";
    if (paragraphs.length > 0 && (structured || paragraphs.length >= 2)) {
      const candidates = paragraphs.map((p) => buildEntry(src, p, events, depths, lex, splitColon));
      const first = skeleton(src, candidates[0]);
      const prose = candidates.every((c) => c.leaves.length <= 1 && plainText(src, c.start, c.end).length > 100);
      if (!prose && (structured || candidates.every((c) => skeleton(src, c) === first))) entries = paragraphs;
    }
  }

  // Attach bullets and text pieces.
  let built: Entry[] = entries.map((e) => buildEntry(src, e, events, depths, lex, splitColon));
  built = built.filter((e) => e.leaves.length > 0 || e.bullets);

  // Items whose text varies in shape are sentences, not structured fields.
  if (collapse && built.length > 0 && built.every((e) => !e.bullets)) {
    const shapes = new Set(built.map((e) => skeleton(src, e)));
    const long = built.length === 1 && built[0].leaves.length > 1 && plainText(src, built[0].start, built[0].end).length > 60;
    if (shapes.size > 1 || long) built = built.map((e) => collapseEntry(src, e));
  }

  // A single entry may really be several lines (Languages: … \\ Tools: …).
  if (built.length <= 1 && !built[0]?.bullets) {
    const lines = splitLines(src, built[0] ?? range, lex, splitColon);
    if (lines) return { shape: "entries", entries: lines.entries, region: lines.region };
  }

  if (kind === "summary" || built.length === 0) {
    const leaves = leavesIn(range);
    if (leaves.length === 0) return { shape: "empty", entries: [] };
    return { shape: "paragraph", entries: [], paragraph: balancedRange(src, range, leaves[0].start, leaves[leaves.length - 1].end) };
  }

  const region: Range = { start: built[0].start, end: built[built.length - 1].end };
  if (built.length === 1 && built[0].leaves.length === 1 && !built[0].bullets && entries.length === 0) {
    return { shape: "paragraph", entries: [], paragraph: balancedRange(src, range, built[0].start, built[0].end) };
  }
  return { shape: "entries", entries: built, region };
}

function buildEntry(
  src: string,
  entry: Range & { args?: Range[] },
  events: LatexEvent[],
  depths: number[],
  lex: Lexicon,
  splitColon: boolean
): Entry {
  let bullets: BulletRegion | undefined;
  const openIndex = events.findIndex(
    (ev) => ev.type === "list-open" && ev.start >= entry.start && ev.start < entry.end && ev.start > entry.start
  );
  if (openIndex !== -1) {
    const closeIndex = matchList(events, openIndex);
    if (closeIndex !== -1 && events[closeIndex].end <= entry.end + 1) {
      const itemDepth = depths[openIndex] + 1;
      const starts: { start: number; contentStart: number; contentEnd?: number }[] = [];
      for (let i = openIndex + 1; i < closeIndex; i++) {
        const ev = events[i];
        if (depths[i] !== itemDepth) continue;
        if (ev.type === "item") {
          let j = skipFiller(src, ev.end);
          if (src[j] === "[") j = skipFiller(src, matchGroup(src, j));
          starts.push({ start: ev.start, contentStart: j });
        } else if (ev.type === "cmd" && lex.bulletMacros.has(ev.name)) {
          const { args } = readArgs(src, ev.end, 1);
          if (args[0]) starts.push({ start: ev.start, contentStart: args[0].start, contentEnd: args[0].end });
        }
      }
      const closeStart = events[closeIndex].start;
      const items = starts.map((s, k) => ({
        start: s.start,
        contentStart: s.contentStart,
        contentEnd:
          s.contentEnd ??
          trimWhitespace(src, { start: s.contentStart, end: k + 1 < starts.length ? starts[k + 1].start : closeStart }).end,
      }));
      if (items.length > 0) bullets = { start: events[openIndex].start, end: events[closeIndex].end, closeStart, items };
    }
  }

  const leaves = collectLeaves(src, entry.start, entry.end, { exclude: bullets ? [bullets] : [], splitColon });
  return { start: entry.start, end: entry.end, leaves, keys: leafKeys(leaves, entry.args), bullets };
}

/** Keys that line up the same piece across entries: its macro argument and position. */
function leafKeys(leaves: Leaf[], args?: Range[]): string[] {
  const seen = new Map<string, number>();
  return leaves.map((leaf) => {
    const arg = args ? args.findIndex((a) => a.start <= leaf.start && leaf.start <= a.end) : -1;
    const group = `${arg}${leaf.url ? "u" : "t"}`;
    const n = seen.get(group) || 0;
    seen.set(group, n + 1);
    return `${group}${n}`;
  });
}

/** An entry's layout with its text taken out, to compare entries. */
function skeleton(src: string, entry: Entry): string {
  let out = "";
  let pos = entry.start;
  for (const leaf of entry.leaves) {
    out += src.slice(pos, leaf.start) + "\u0000";
    pos = leaf.end;
  }
  return (out + src.slice(pos, entry.end)).replace(/\s+/g, "");
}

/** Ranges separated by blank lines (outside braces). */
function splitParagraphs(src: string, range: Range): Range[] {
  const parts: Range[] = [];
  let depth = 0;
  let start = range.start;
  for (let i = range.start; i < range.end; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "%") i = src.indexOf("\n", i) === -1 ? range.end : src.indexOf("\n", i) - 1;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\n" && depth === 0) {
      let j = i + 1;
      while (j < range.end && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
      if (src[j] === "\n") {
        parts.push(trimWhitespace(src, { start, end: i }));
        start = j;
        i = j;
      }
    }
  }
  parts.push(trimWhitespace(src, { start, end: range.end }));
  return parts.filter((p) => p.end > p.start);
}

/** Treats an item's whole text as one piece. */
function collapseEntry(src: string, entry: Entry): Entry {
  let start = entry.start;
  if (src.startsWith("\\item", start)) {
    start = skipFiller(src, start + 5);
    if (src[start] === "[") start = skipFiller(src, matchGroup(src, start));
  }
  const content = balancedRange(src, entry, start, entry.end);
  const value = plainText(src, content.start, content.end);
  const leaves: Leaf[] = value ? [{ ...content, value, url: false }] : [];
  return { ...entry, leaves, keys: leaves.map(() => "c0") };
}

/** Lines separated by `\\` that all share one layout become entries. */
function splitLines(
  src: string,
  range: Range,
  lex: Lexicon,
  splitColon: boolean
): { entries: Entry[]; region: Range & { separator: string } } | null {
  const events = scanEvents(src, range.start, range.end, lex);
  const depths = listDepths(events);
  const breaks = events.filter((ev, i) => ev.type === "linebreak" && depths[i] === depths[0]);
  if (breaks.length === 0) return null;
  const byDepth = new Map<number, LatexEvent[]>();
  for (const b of breaks) byDepth.set(b.depth, [...(byDepth.get(b.depth) || []), b]);
  const [depth, seps] = [...byDepth.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  // The group the line breaks sit in.
  let inner: Range = range;
  if (depth > 0) {
    const firstIdx = events.indexOf(seps[0]);
    const openIdx = events.slice(0, firstIdx).map((e) => e.type === "open" && e.depth === depth - 1).lastIndexOf(true);
    if (openIdx === -1) return null;
    const closeIdx = events.findIndex((e, i) => i > firstIdx && e.type === "close" && e.depth === depth - 1);
    if (closeIdx === -1) return null;
    inner = { start: events[openIdx].end, end: events[closeIdx].start };
  }
  const inGroup = seps.filter((s) => s.start >= inner.start && s.end <= inner.end);
  const bounds = [inner.start, ...inGroup.flatMap((s) => [s.start, s.end]), inner.end];
  const lines: Entry[] = [];
  for (let k = 0; k < bounds.length; k += 2) {
    const r = trimWhitespace(src, { start: bounds[k], end: bounds[k + 1] });
    const leaves = collectLeaves(src, r.start, r.end, { splitColon });
    if (leaves.length > 0) lines.push({ ...r, leaves, keys: leafKeys(leaves) });
  }
  if (lines.length < 2) return null;
  const first = skeleton(src, lines[0]);
  if (!lines.every((l) => skeleton(src, l) === first)) return null;
  return {
    entries: lines,
    region: { start: lines[0].start, end: lines[lines.length - 1].end, separator: src.slice(lines[0].end, lines[1].start) },
  };
}

/** Widens [start, end) so it opens and closes the same braces (and keeps any command they belong to). */
function balancedRange(src: string, within: Range, start: number, end: number): Range {
  const depthAt: number[] = [];
  let d = 0;
  for (let i = within.start; i <= within.end; i++) {
    depthAt[i - within.start] = d;
    const c = src[i];
    if (c === "\\") {
      depthAt[i + 1 - within.start] = d;
      i++;
    } else if (c === "{") d++;
    else if (c === "}") d--;
  }
  const at = (i: number) => depthAt[i - within.start] ?? 0;
  let s = start;
  let e = end;
  let min = Math.min(at(s), at(e));
  for (let i = s; i <= e; i++) min = Math.min(min, at(i));
  while (s > within.start && at(s) > min) s--;
  while (e < within.end && at(e) > min) e++;
  // Include a command whose argument starts the range (\textbf{…}).
  if (src[s] === "{") {
    let k = s;
    while (k > within.start && /[a-zA-Z*]/.test(src[k - 1])) k--;
    if (src[k - 1] === "\\") s = k - 1;
  }
  return { start: s, end: e };
}

/* ---------- Contact details in the header ---------- */

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds the name and contact details in the header and links them to the form. */
function parameterizeHeader(header: string): { text: string; personal: Partial<ResumePersonalInfo> } {
  let template = header;
  const personal: Partial<ResumePersonalInfo> = {};

  // Name: \author{Name}, \name{Name}, {\Huge \scshape Name}, {\huge \textbf{Name}}, ...
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
      personal.name = rawName;
      const replaced = match[0].replace(rawName, "{{name}}");
      template = template.replace(match[0], () => replaced);
      break;
    }
  }
  if (!personal.name) {
    // Otherwise the first short run of capitalized words, if the header starts with one.
    const first = collectLeaves(template, 0, template.length)[0];
    if (first && !first.url && /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){1,3}$/u.test(first.value) && !LOCATION.test(first.value)) {
      personal.name = first.value;
      template = template.slice(0, first.start) + "{{name}}" + template.slice(first.end);
    }
  }

  // Email (every occurrence, so both \href{mailto:x}{x} parts are parameterized)
  const emailMatch = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(template);
  if (emailMatch) {
    personal.email = emailMatch[0];
    template = template.split(emailMatch[0]).join("{{email}}");
  }

  const phoneMatch = /(?<![\d.])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d.])/.exec(template);
  if (phoneMatch) {
    const rawPhone = phoneMatch[0].trim();
    personal.phone = rawPhone;
    template = template.split(rawPhone).join("{{phone}}");
  }

  // GitHub / LinkedIn profile URLs. Stored as "github.com/user"; a scheme in
  // the source becomes https://{{github}}, which the URL escaping normalizes.
  const parameterizeProfile = (host: string, pathPrefix: string, key: "github" | "linkedin") => {
    const pattern = new RegExp(
      `(https?:\\/\\/)?(?:www\\.)?${escapeRegExp(host)}\\/${escapeRegExp(pathPrefix)}([a-zA-Z0-9_-]+)\\/?(?![a-zA-Z0-9_/-])`
    );
    const match = pattern.exec(template);
    if (!match) return;
    const handle = match[2];
    personal[key] = `${host}/${pathPrefix}${handle}`;
    const everyOccurrence = new RegExp(
      `(https?:\\/\\/)?(?:www\\.)?${escapeRegExp(host)}\\/${escapeRegExp(pathPrefix)}${escapeRegExp(handle)}\\/?(?![a-zA-Z0-9_/-])`,
      "g"
    );
    template = template.replace(everyOccurrence, (_m: string, proto?: string) => (proto ? `https://{{${key}}}` : `{{${key}}}`));
  };
  parameterizeProfile("github.com", "", "github");
  parameterizeProfile("linkedin.com", "in/", "linkedin");

  // Any other link target is the website.
  const site = /\\(?:href|url)\s*\{\s*((?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:\/[^\s{}]*)?))\s*\}/.exec(template);
  if (site && !/\{\{/.test(site[1]) && !/^mailto:|^tel:/i.test(site[1])) {
    const core = site[2].replace(/\/+$/, "");
    personal.website = core;
    template = template.replace(
      new RegExp(`(https?:\\/\\/)?(?:www\\.)?${escapeRegExp(core)}\\/?(?![a-zA-Z0-9_/.-])`, "g"),
      (_m: string, proto?: string) => (proto ? `https://{{website}}` : `{{website}}`)
    );
  }

  // A "City, ST" run.
  const place = collectLeaves(template, 0, template.length).find(
    (l) => !l.url && !/\{\{/.test(l.value) && !/\d/.test(l.value) && LOCATION.test(l.value) && /,/.test(l.value)
  );
  if (place) {
    personal.location = place.value;
    template = template.slice(0, place.start) + "{{location}}" + template.slice(place.end);
  }

  return { text: template, personal };
}

/**
 * Contact commands of CV classes (awesome-cv, moderncv), which sit in the
 * preamble: \name{First}{Last}, \email{…}, \phone[mobile]{…}, \homepage{…}, \address{…}.
 */
function parameterizePreamble(preamble: string): { text: string; personal: Partial<ResumePersonalInfo> } {
  const personal: Partial<ResumePersonalInfo> = {};
  const edits: { start: number; end: number; text: string }[] = [];
  const commands: [RegExp, keyof ResumePersonalInfo][] = [
    [/\\(?:name)\b/g, "name"],
    [/\\(?:firstname)\b/g, "name"],
    [/\\(?:email)\b/g, "email"],
    [/\\(?:phone|mobile)\b/g, "phone"],
    [/\\(?:homepage)\b/g, "website"],
    [/\\(?:address)\b/g, "location"],
    [/\\(?:position|title)\b/g, "title"],
  ];
  for (const [re, field] of commands) {
    if (personal[field]) continue;
    let m: RegExpExecArray | null;
    while ((m = re.exec(preamble)) !== null) {
      const at = m.index + m[0].length;
      if (/^\s*[a-zA-Z@]/.test(preamble.slice(at, at + 1))) continue;
      const { args } = readArgs(preamble, at, field === "name" ? 2 : 1, preamble.length, true);
      if (args.length === 0) continue;
      const values = args.map((a) => plainText(preamble, a.start, a.end)).filter(Boolean);
      if (values.length === 0 || /[#\\]/.test(preamble.slice(args[0].start, args[0].end))) continue;
      personal[field] = values.join(" ");
      edits.push({ start: args[0].start, end: args[0].end, text: `{{${field}}}` });
      for (const extra of args.slice(1)) edits.push({ start: extra.start, end: extra.end, text: "" });
      break;
    }
  }
  if (personal.name && /\\firstname\b/.test(preamble)) {
    const family = /\\familyname\s*\{([^{}]*)\}/.exec(preamble);
    if (family) {
      personal.name = `${personal.name} ${family[1].trim()}`.trim();
      const start = family.index + family[0].indexOf("{") + 1;
      edits.push({ start, end: start + family[1].length, text: "" });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let text = preamble;
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return { text, personal };
}

/* ---------- Plans ---------- */

/** True for files that already use Vitae's {{placeholders}}. */
export function isParameterized(raw: string): boolean {
  return /\{\{\s*[#^/]\s*[a-zA-Z0-9_]+\s*\}\}/.test(raw) || /\{\{\s*[a-z][a-zA-Z0-9_]*(?::[a-z]+)?\s*\}\}/.test(raw);
}

function slugKey(heading: string, taken: Set<string>): string {
  const base =
    heading
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "section";
  let key = /^[a-z]/.test(base) ? base : `section_${base}`;
  if (RESERVED_KEYS.has(key)) key = `${key}_section`;
  let n = 2;
  const original = key;
  while (taken.has(key)) key = `${original}_${n++}`;
  taken.add(key);
  return key;
}

function slotsFor(section: ScannedSection): ImportSlot[] {
  if (section.shape !== "entries") return [];
  const proto = prototype(section);
  return proto.keys.map((key) => {
    const leaves = section.entries.map((e) => e.leaves[e.keys.indexOf(key)]);
    const samples = leaves.map((l) => l?.value ?? "");
    const types = leaves.filter(Boolean).map((l) => classifyValue(l!.value, l!.url));
    const counts = new Map<SlotType, number>();
    for (const t of types) counts.set(t, (counts.get(t) || 0) + 1);
    const type = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "text";
    const filled = samples.filter(Boolean);
    const constant =
      type !== "link" && filled.length > 0 && filled.every((s) => s === filled[0]) && LINK_WORDS.test(filled[0]);
    return { id: key, type, samples, field: "", constant };
  });
}

/** The entry printed for every entry: the one with the most pieces. */
function prototype(section: ScannedSection): Entry {
  return section.entries.reduce((best, e) => (e.leaves.length > best.leaves.length ? e : best), section.entries[0]);
}

/** Files saved on Windows use CRLF; the importer writes LF, so read everything as LF. */
const normalizeLineEndings = (text: string) => text.replace(/\r\n?/g, "\n");

/** Reads the file and guesses what each section and field is. */
export function analyzeLatexImport(input: string): ImportPlan {
  const raw = normalizeLineEndings(input);
  if (isParameterized(raw)) return { parameterized: true, personal: {}, sections: [] };
  const doc = scanDocument(raw);
  const preamble = parameterizePreamble(doc.src.slice(0, doc.header.start));
  const header = parameterizeHeader(doc.src.slice(doc.header.start, doc.header.end));

  const taken = new Set<string>();
  const used = new Set<SectionMapping>();
  const sections = doc.sections.map((sec, i): ImportSection => {
    let suggested: SectionMapping;
    if (sec.shape === "empty") suggested = "keep";
    else if (sec.shape === "paragraph") suggested = sec.kind === "summary" && !used.has("summary") ? "summary" : "text";
    else suggested = sec.kind && sec.kind !== "summary" && !used.has(sec.kind) ? sec.kind : "list";
    if (!["list", "text", "keep"].includes(suggested)) used.add(suggested);

    const slots = slotsFor(sec);
    const fields = guessFields(suggested, slots);
    slots.forEach((s, n) => (s.field = fields[n]));
    const previewRange = sec.paragraph ?? sec.region ?? { start: sec.end, end: sec.end };
    return {
      id: `s${i}`,
      heading: sec.heading,
      shape: sec.shape,
      mapping: suggested,
      suggested,
      key: slugKey(sec.heading, taken),
      entryCount: sec.entries.length,
      bulletCount: sec.entries.reduce((n, e) => n + (e.bullets?.items.length || 0), 0),
      slots,
      preview: plainText(doc.src, previewRange.start, previewRange.end).slice(0, 140),
    };
  });

  return { parameterized: false, personal: { ...preamble.personal, ...header.personal }, sections };
}

/** Changes what a section is, re-guessing its fields; frees the type if another section had it. */
export function changeSectionMapping(plan: ImportPlan, sectionId: string, mapping: SectionMapping): ImportPlan {
  const single = !["list", "text", "keep"].includes(mapping);
  return {
    ...plan,
    sections: plan.sections.map((s) => {
      if (s.id === sectionId) {
        const fields = guessFields(mapping, s.slots);
        return { ...s, mapping, slots: s.slots.map((slot, n) => ({ ...slot, field: fields[n] })) };
      }
      if (single && s.mapping === mapping) {
        const fallback: SectionMapping = s.shape === "paragraph" ? "text" : "list";
        const fields = guessFields(fallback, s.slots);
        return { ...s, mapping: fallback, slots: s.slots.map((slot, n) => ({ ...slot, field: fields[n] })) };
      }
      return s;
    }),
  };
}

export function changeSlotField(plan: ImportPlan, sectionId: string, slotId: string, field: string): ImportPlan {
  return {
    ...plan,
    sections: plan.sections.map((s) =>
      s.id === sectionId ? { ...s, slots: s.slots.map((slot) => (slot.id === slotId ? { ...slot, field } : slot)) } : s
    ),
  };
}

/* ---------- Building the template ---------- */

function datePlaceholder(raw: string, values: string[]): string {
  const range = values.map((v) => DATE_RANGE.exec(v)).find(Boolean);
  if (!range) return "{{startDate}}";
  const sep = new RegExp(`\\s*${escapeRegExp(range[2])}\\s*`).exec(raw)?.[0] ?? " -- ";
  return `{{startDate}}{{#endDate}}${sep}{{endDate}}{{/endDate}}`;
}

function splitDates(value: string): { startDate: string; endDate: string } {
  const range = DATE_RANGE.exec(value);
  return range ? { startDate: range[1].trim(), endDate: range[3].trim() } : { startDate: value, endDate: "" };
}

/** The pattern every entry is printed with: the prototype with its pieces swapped for placeholders. */
function entryTemplate(src: string, proto: Entry, section: ImportSection, dated: boolean): string {
  const fieldOf = new Map(section.slots.map((s) => [s.id, s]));
  const edits: { start: number; end: number; text: string }[] = [];
  proto.leaves.forEach((leaf, n) => {
    const slot = fieldOf.get(proto.keys[n]);
    if (!slot || !slot.field || slot.constant) return;
    const text =
      dated && slot.field === "dates" ? datePlaceholder(src.slice(leaf.start, leaf.end), slot.samples) : `{{${slot.field}}}`;
    edits.push({ start: leaf.start, end: leaf.end, text });
  });
  if (proto.bullets) {
    const b = proto.bullets;
    const [first, second] = b.items;
    const prefix = src.slice(first.start, first.contentStart);
    const suffix = src.slice(first.contentEnd, second ? second.start : b.closeStart);
    edits.push({
      start: b.start,
      end: b.end,
      text:
        "{{#highlights}}" +
        src.slice(b.start, first.start) +
        `{{#bullets}}${prefix}{{bullet}}${suffix}{{/bullets}}` +
        src.slice(b.closeStart, b.end) +
        "{{/highlights}}",
    });
  }
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let pos = proto.start;
  for (const edit of edits) {
    if (edit.start < pos) continue;
    out += src.slice(pos, edit.start) + edit.text;
    pos = edit.end;
  }
  return out + src.slice(pos, proto.end);
}

/** The data of one entry, as field → value. */
function entryValues(src: string, entry: Entry, section: ImportSection, dated: boolean) {
  const values: Record<string, string> = {};
  for (const slot of section.slots) {
    if (!slot.field || slot.constant) continue;
    const leaf = entry.leaves[entry.keys.indexOf(slot.id)];
    const value = leaf?.value ?? "";
    if (dated && slot.field === "dates") Object.assign(values, splitDates(value));
    else if (!(slot.field in values) || !values[slot.field]) values[slot.field] = value;
  }
  const bullets = (entry.bullets?.items || []).map((item) => plainText(src, item.contentStart, item.contentEnd)).filter(Boolean);
  return { values, bullets };
}

const take = (values: Record<string, string>, keys: string[]) => {
  const rest = { ...values };
  const picked: Record<string, string> = {};
  for (const key of keys) {
    picked[key] = rest[key] || "";
    delete rest[key];
  }
  const extra = Object.fromEntries(Object.entries(rest).filter(([, v]) => v));
  return { picked, extra: Object.keys(extra).length > 0 ? extra : undefined };
};

const DATA_KEYS: Partial<Record<SectionMapping, string>> = {
  experience: "experience",
  education: "education",
  projects: "projects",
  skills: "skills",
};

function sectionOutput(src: string, scanned: ScannedSection, section: ImportSection, data: ImportedData): string {
  const raw = src.slice(scanned.start, scanned.end);
  const { mapping } = section;
  if (mapping === "keep" || scanned.shape === "empty") return raw;

  if (mapping === "summary" || mapping === "text") {
    const p = scanned.paragraph;
    if (!p) return raw;
    const key = mapping === "summary" ? "summary" : section.key;
    const value = plainText(src, p.start, p.end);
    if (mapping === "summary") data.personal = { ...(data.personal || {}), summary: value };
    else data.customVariables = { ...(data.customVariables || {}), [key]: value };
    return `{{#${key}}}${src.slice(scanned.start, p.start)}{{${key}}}${src.slice(p.end, scanned.end)}{{/${key}}}`;
  }

  if (scanned.shape !== "entries" || !scanned.region) return raw;
  const dated = DATED.includes(mapping);
  const proto = prototype(scanned);
  const region = scanned.region;
  const repeat = region.separator ? `{{^last}}${region.separator}{{/last}}` : "";
  const key = DATA_KEYS[mapping] ?? section.key;
  const template =
    `{{#${key}}}` +
    src.slice(scanned.start, region.start) +
    `{{#items}}${entryTemplate(src, proto, section, dated)}${repeat}{{/items}}` +
    src.slice(region.end, scanned.end) +
    `{{/${key}}}`;

  const rows = scanned.entries.map((e) => entryValues(src, e, section, dated));
  switch (mapping) {
    case "experience":
      data.experience = rows.map(({ values, bullets }) => {
        const { picked: p, extra } = take(values, ["role", "company", "location", "startDate", "endDate"]);
        return {
          id: createId("exp"),
          role: p.role,
          company: p.company,
          location: p.location,
          startDate: p.startDate,
          endDate: p.endDate,
          bullets,
          ...(extra && { fields: extra }),
        };
      });
      break;
    case "education":
      data.education = rows.map(({ values }) => {
        const { picked: p, extra } = take(values, ["degree", "institution", "location", "startDate", "endDate", "details"]);
        return {
          id: createId("edu"),
          degree: p.degree,
          institution: p.institution,
          location: p.location,
          startDate: p.startDate,
          endDate: p.endDate,
          details: p.details,
          ...(extra && { fields: extra }),
        };
      });
      break;
    case "projects":
      data.projects = rows.map(({ values, bullets }) => {
        const { picked: p, extra } = take(values, ["name", "technologies", "link"]);
        return { id: createId("proj"), name: p.name, technologies: p.technologies, link: p.link, bullets, ...(extra && { fields: extra }) };
      });
      break;
    case "skills":
      data.skills = rows.map(({ values }) => {
        const { picked: p, extra } = take(values, ["category", "skills"]);
        return { id: createId("skill"), category: p.category, skills: p.skills, ...(extra && { fields: extra }) };
      });
      break;
    default:
      data.customLists = {
        ...(data.customLists || {}),
        [key]: rows.map(({ values, bullets }) => ({ id: createId("item"), fields: values, bullets })),
      };
  }
  return template;
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Share of the original's words the converted template prints, in any order. */
function matchScore(original: string, rendered: string): number {
  const bodyOf = (s: string) => {
    const begin = /\\begin\s*\{document\}/.exec(s);
    const end = /\\end\s*\{document\}/.exec(s);
    return plainText(s, begin ? begin.index + begin[0].length : 0, end ? end.index : s.length);
  };
  const a = words(bodyOf(original));
  const b = words(bodyOf(rendered));
  if (a.length === 0 && b.length === 0) return 1;
  const pool = new Map<string, number>();
  for (const w of b) pool.set(w, (pool.get(w) || 0) + 1);
  let common = 0;
  for (const w of a) {
    const n = pool.get(w) || 0;
    if (n > 0) {
      common++;
      pool.set(w, n - 1);
    }
  }
  return common / Math.max(a.length, b.length);
}

/** Builds the template and data from a plan (the analyzer's guesses when none is given). */
export function buildLatexImport(input: string, plan: ImportPlan = analyzeLatexImport(input)): ImportResult {
  const raw = normalizeLineEndings(input);
  if (plan.parameterized) return { templateContent: raw, extractedData: {}, match: null };
  const doc = scanDocument(raw);
  const { src } = doc;
  const preamble = parameterizePreamble(src.slice(0, doc.header.start));
  const header = parameterizeHeader(src.slice(doc.header.start, doc.header.end));
  const data: ImportedData = {};
  const personal = { ...preamble.personal, ...header.personal };
  if (Object.keys(personal).length > 0) data.personal = personal;

  let out = preamble.text + header.text;
  let pos = doc.header.end;
  doc.sections.forEach((scanned, i) => {
    const section = plan.sections.find((s) => s.id === `s${i}`);
    out += src.slice(pos, scanned.start);
    out += section ? sectionOutput(src, scanned, section, data) : src.slice(scanned.start, scanned.end);
    pos = scanned.end;
  });
  out += src.slice(pos);

  const converted = out !== src;
  const match = converted ? matchScore(src, renderTemplate(out, mergeImportedData(getEmptyResumeData(), data))) : null;
  return { templateContent: converted ? out : raw, extractedData: data, match };
}

/**
 * Converts an uploaded LaTeX file into a Vitae template and the resume data
 * found in it. Files that already use {{placeholders}} are kept as they are.
 */
export function convertRawLatexToTemplate(rawLatex: string): {
  templateContent: string;
  extractedData: ImportedData;
} {
  const { templateContent, extractedData } = buildLatexImport(rawLatex);
  return { templateContent, extractedData };
}

/** Adds imported data to a resume, filling only what is still empty. */
export function mergeImportedData(data: ResumeData, imported: ImportedData): ResumeData {
  const next: ResumeData = { ...data, personal: { ...data.personal } };
  for (const [key, value] of Object.entries(imported.personal || {})) {
    const field = key as keyof ResumePersonalInfo;
    if (typeof value === "string" && value && !next.personal[field]) next.personal[field] = value;
  }
  if (imported.experience?.length && next.experience.length === 0) next.experience = imported.experience;
  if (imported.education?.length && next.education.length === 0) next.education = imported.education;
  if (imported.projects?.length && next.projects.length === 0) next.projects = imported.projects;
  if (imported.skills?.length && next.skills.length === 0) next.skills = imported.skills;
  if (imported.customLists) {
    const lists = { ...(next.customLists || {}) };
    for (const [key, items] of Object.entries(imported.customLists)) if (!lists[key]?.length) lists[key] = items;
    next.customLists = lists;
  }
  if (imported.customVariables) {
    const vars = { ...(next.customVariables || {}) };
    for (const [key, value] of Object.entries(imported.customVariables)) if (!vars[key]) vars[key] = value;
    next.customVariables = vars;
  }
  return next;
}
