import {
  Library,
  LibraryKind,
  LibraryRow,
  Profile,
  ProfileRow,
  ProfileSpec,
  ResumeData,
  ResumeEducationItem,
  ResumeExperienceItem,
  ResumePersonalInfo,
  ResumeProjectItem,
  ResumeSkillItem,
} from "../types";
import { createId, getEmptyResumeData } from "./templateEngine";

type Item = ResumeExperienceItem | ResumeProjectItem | ResumeEducationItem | ResumeSkillItem;

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

function parseObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const emptyLibrary = (): Library => ({ experience: [], project: [], education: [], skill: [] });

export function parsePerson(json: string | null | undefined): ResumePersonalInfo {
  const raw = parseObject(json);
  return {
    name: str(raw.name),
    title: str(raw.title),
    email: str(raw.email),
    phone: str(raw.phone),
    location: str(raw.location),
    website: str(raw.website),
    linkedin: str(raw.linkedin),
    github: str(raw.github),
    summary: str(raw.summary),
  };
}

export function parseItem(kind: LibraryKind, id: string, json: string): Item {
  const raw = parseObject(json);
  switch (kind) {
    case "experience":
      return {
        id,
        role: str(raw.role),
        company: str(raw.company),
        location: str(raw.location),
        startDate: str(raw.startDate),
        endDate: str(raw.endDate),
        bullets: strings(raw.bullets),
      };
    case "project":
      return {
        id,
        name: str(raw.name),
        technologies: str(raw.technologies),
        link: str(raw.link),
        bullets: strings(raw.bullets),
      };
    case "education":
      return {
        id,
        degree: str(raw.degree),
        institution: str(raw.institution),
        location: str(raw.location),
        startDate: str(raw.startDate),
        endDate: str(raw.endDate),
        details: str(raw.details),
      };
    case "skill":
      return { id, category: str(raw.category), skills: str(raw.skills) };
  }
}

export function parseLibrary(rows: LibraryRow[]): Library {
  const library = emptyLibrary();
  for (const row of rows) {
    if (row.kind in library) {
      (library[row.kind] as Item[]).push(parseItem(row.kind, row.id, row.data));
    }
  }
  library.experience = sortByRecency(library.experience);
  library.education = sortByRecency(library.education);
  return library;
}

/** The JSON stored for an item: everything except its id. */
export function serializeItem(item: Item): string {
  const { id: _id, ...rest } = item;
  return JSON.stringify(rest);
}

export function parseProfile(row: ProfileRow): Profile {
  const raw = parseObject(row.data);
  return {
    id: row.id,
    name: row.name,
    headline: str(raw.headline),
    summary: str(raw.summary),
    experienceIds: strings(raw.experienceIds),
    projectIds: strings(raw.projectIds),
    educationIds: strings(raw.educationIds),
    skillIds: strings(raw.skillIds),
  };
}

export const serializeProfile = (spec: ProfileSpec): string => JSON.stringify(spec);

// ---------------------------------------------------------------------------
// Ordering: resumes list the most recent role first.
// ---------------------------------------------------------------------------

interface DatedItem {
  startDate?: string;
  endDate?: string;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PRESENT = /^(present|current|now|ongoing|today)$/i;

/** Months since year 0 for strings like "Jan 2022", "01/2022" or "2022"; null if unreadable. */
export function dateValue(text: string | undefined): number | null {
  const value = (text ?? "").trim();
  const year = /(19|20)\d{2}/.exec(value);
  if (!year) return null;
  const lower = value.toLowerCase();
  let month = MONTHS.findIndex((m) => lower.includes(m));
  if (month < 0) {
    const numeric = /(?:^|\D)(\d{1,2})\s*[/.-]\s*(?:19|20)\d{2}/.exec(value);
    month = numeric ? Math.min(Math.max(Number(numeric[1]), 1), 12) - 1 : 0;
  }
  return Number(year[0]) * 12 + month;
}

function endValue(item: DatedItem): number {
  const end = (item.endDate ?? "").trim();
  if (end === "" || PRESENT.test(end)) return Number.MAX_SAFE_INTEGER;
  return dateValue(end) ?? 0;
}

/** Newest first: still-running roles lead, then by end date, then start date. */
export function sortByRecency<T extends DatedItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const byEnd = endValue(b) - endValue(a);
    return byEnd !== 0 ? byEnd : (dateValue(b.startDate) ?? 0) - (dateValue(a.startDate) ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Profiles -> resumes
// ---------------------------------------------------------------------------

export function defaultProfileSpec(library: Library): ProfileSpec {
  return {
    headline: "",
    summary: "",
    experienceIds: library.experience.map((i) => i.id),
    projectIds: library.project.map((i) => i.id),
    educationIds: library.education.map((i) => i.id),
    skillIds: library.skill.map((i) => i.id),
  };
}

const pick = <T extends { id: string }>(items: T[], ids: string[]): T[] =>
  ids.map((id) => items.find((item) => item.id === id)).filter((item): item is T => item !== undefined);

/**
 * A resume's worth of data: the shared personal info, the profile's headline and
 * summary, and copies of the chosen library entries. Copies get fresh ids so editing
 * one resume never touches the library or another resume.
 */
export function buildResumeData(person: ResumePersonalInfo, library: Library, spec: ProfileSpec): ResumeData {
  const data = getEmptyResumeData();
  data.personal = {
    ...person,
    title: spec.headline || person.title || "",
    summary: spec.summary || person.summary || "",
  };
  data.experience = pick(library.experience, spec.experienceIds).map((i) => ({
    ...i,
    id: createId("exp"),
    bullets: [...i.bullets],
  }));
  data.projects = pick(library.project, spec.projectIds).map((i) => ({
    ...i,
    id: createId("proj"),
    bullets: [...i.bullets],
  }));
  data.education = pick(library.education, spec.educationIds).map((i) => ({ ...i, id: createId("edu") }));
  data.skills = pick(library.skill, spec.skillIds).map((i) => ({ ...i, id: createId("skill") }));
  return data;
}

// ---------------------------------------------------------------------------
// Importing what's already in a resume
// ---------------------------------------------------------------------------

const norm = (text: string | undefined) => (text ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** What makes two entries "the same thing" when importing. */
export function itemKey(kind: LibraryKind, item: Item): string {
  switch (kind) {
    case "experience": {
      const i = item as ResumeExperienceItem;
      return [i.role, i.company, i.startDate].map(norm).join("|");
    }
    case "project":
      return norm((item as ResumeProjectItem).name);
    case "education": {
      const i = item as ResumeEducationItem;
      return [i.degree, i.institution].map(norm).join("|");
    }
    case "skill":
      return norm((item as ResumeSkillItem).category);
  }
}

export interface ImportableEntry {
  kind: LibraryKind;
  item: Item;
}

/** Entries in `data` that aren't already in the library (blank ones are skipped). */
export function newEntriesFromResume(data: ResumeData, library: Library): ImportableEntry[] {
  const candidates: ImportableEntry[] = [
    ...data.experience.map((item) => ({ kind: "experience" as const, item })),
    ...data.projects.map((item) => ({ kind: "project" as const, item })),
    ...data.education.map((item) => ({ kind: "education" as const, item })),
    ...data.skills.map((item) => ({ kind: "skill" as const, item })),
  ];
  const seen = new Set<string>();
  library.experience.forEach((i) => seen.add(`experience:${itemKey("experience", i)}`));
  library.project.forEach((i) => seen.add(`project:${itemKey("project", i)}`));
  library.education.forEach((i) => seen.add(`education:${itemKey("education", i)}`));
  library.skill.forEach((i) => seen.add(`skill:${itemKey("skill", i)}`));
  return candidates.filter(({ kind, item }) => {
    const key = itemKey(kind, item);
    if (key.replace(/\|/g, "") === "") return false;
    const full = `${kind}:${key}`;
    if (seen.has(full)) return false;
    seen.add(full);
    return true;
  });
}
