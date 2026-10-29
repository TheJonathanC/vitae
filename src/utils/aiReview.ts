import { ResumeData, RewriteItem } from "../types";
import { newFactsIn } from "./targeting";

/** The bullets of a resume that AI may reword, each with a position-based id. */
export function collectBullets(data: ResumeData): RewriteItem[] {
  const items: RewriteItem[] = [];
  data.experience.forEach((job, i) => job.bullets.forEach((text, j) => text.trim() && items.push({ id: `exp-${i}-${j}`, text })));
  data.projects.forEach((project, i) => project.bullets.forEach((text, j) => text.trim() && items.push({ id: `proj-${i}-${j}`, text })));
  return items;
}

export interface ReviewRow {
  id: string;
  original: string;
  suggestion: string;
  /** New numbers or tools the suggestion mentions that the original didn't. */
  flags: string[];
  use: boolean;
}

/**
 * Suggestions that actually change a bullet. Ones that add something new start
 * unticked so nothing unsupported goes on a resume by default.
 */
export function makeReviewRows(asked: RewriteItem[], answers: RewriteItem[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const item of asked) {
    const answer = answers.find((a) => a.id === item.id);
    if (!answer || answer.text.trim() === item.text.trim()) continue;
    const flags = newFactsIn(item.text, answer.text);
    rows.push({ id: item.id, original: item.text, suggestion: answer.text.trim(), flags, use: flags.length === 0 });
  }
  return rows;
}

const ID = /^(exp|proj)-(\d+)-(\d+)$/;

/** A copy of `data` with the ticked suggestions in place of the original bullets. */
export function applyReview(data: ResumeData, rows: ReviewRow[]): ResumeData {
  const next: ResumeData = {
    ...data,
    experience: data.experience.map((job) => ({ ...job, bullets: [...job.bullets] })),
    projects: data.projects.map((project) => ({ ...project, bullets: [...project.bullets] })),
  };
  for (const row of rows) {
    const match = ID.exec(row.id);
    if (!row.use || !match) continue;
    const list = match[1] === "exp" ? next.experience[Number(match[2])] : next.projects[Number(match[2])];
    if (list && list.bullets[Number(match[3])] === row.original) list.bullets[Number(match[3])] = row.suggestion;
  }
  return next;
}
