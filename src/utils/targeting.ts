import {
  Library,
  ProfileSpec,
  ResumeData,
  ResumeExperienceItem,
  ResumePersonalInfo,
  ResumeProjectItem,
  ResumeSkillItem,
} from "../types";
import { buildResumeData } from "./library";
import { RolePreset } from "./rolePresets";

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export interface Keyword {
  term: string;
  weight: number;
  source: "job" | "role";
}

/** Terms worth looking for in a job description even when they appear once. */
const LEXICON = [
  "javascript", "typescript", "python", "java", "kotlin", "swift", "golang", "rust", "c++", "c#", "php", "ruby", "scala", "sql", "bash", "html", "css", "sass",
  "react", "react native", "angular", "vue", "svelte", "next.js", "node.js", "express.js", "django", "flask", "fastapi", "spring boot", "rails", "laravel", ".net", "asp.net", "graphql", "rest api", "grpc", "websocket", "tailwind", "redux", "flutter", "swiftui", "jetpack compose", "ios", "android",
  "aws", "azure", "gcp", "docker", "kubernetes", "terraform", "ansible", "jenkins", "github actions", "gitlab ci", "ci/cd", "linux", "nginx", "prometheus", "grafana", "helm", "serverless", "lambda", "microservices", "infrastructure as code", "monitoring", "observability", "incident response",
  "postgresql", "mysql", "mongodb", "redis", "elasticsearch", "kafka", "rabbitmq", "spark", "hadoop", "airflow", "dbt", "snowflake", "bigquery", "redshift", "tableau", "power bi", "looker", "excel", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "machine learning", "deep learning", "nlp", "llm", "data pipeline", "etl", "a/b testing", "statistics", "data visualization", "data analysis", "dashboards", "mlops", "feature engineering",
  "agile", "scrum", "kanban", "tdd", "unit testing", "integration testing", "test automation", "regression testing", "code review", "system design", "distributed systems", "api design", "scalability", "performance", "security", "oauth", "accessibility", "responsive design",
  "selenium", "cypress", "playwright", "jest", "postman", "jira", "confluence", "figma", "sketch", "wireframing", "prototyping", "design systems", "usability testing", "user research", "interaction design",
  "leadership", "mentoring", "stakeholder management", "cross-functional", "roadmap", "product strategy", "prioritization", "go-to-market", "okrs", "kpis", "project management", "risk management", "budgeting", "forecasting", "financial modeling", "financial reporting", "gaap", "audit", "reconciliation", "pmp", "change management", "vendor management",
  "seo", "content marketing", "email marketing", "social media", "campaigns", "google analytics", "hubspot", "crm", "salesforce", "zendesk", "copywriting", "lead generation", "pipeline", "quota", "negotiation", "prospecting", "customer success", "onboarding", "retention", "churn", "nps", "saas", "b2b",
];

/** Different ways of writing the same thing; matching any one counts for all. */
const ALIASES: string[][] = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["kubernetes", "k8s"],
  ["postgresql", "postgres"],
  ["machine learning", "ml"],
  ["natural language processing", "nlp"],
  ["continuous integration", "ci/cd", "ci cd"],
  ["amazon web services", "aws"],
  ["google cloud", "gcp", "google cloud platform"],
  ["node.js", "nodejs"],
  ["express.js", "expressjs"],
  ["react", "reactjs", "react.js"],
  ["vue", "vuejs", "vue.js"],
  // Plain "rest" is an everyday word, so only the API spellings count.
  ["rest api", "restful", "rest apis", "rest services", "rest endpoints"],
  ["user research", "customer interviews", "user interviews"],
  ["a/b testing", "ab testing", "experimentation", "split testing"],
  ["power bi", "powerbi"],
  ["c#", "csharp"],
  ["unit testing", "unit tests"],
  ["project management", "program management"],
];

const STOPWORDS = new Set(
  (
    "a an and are as at be been being by for from has have he her his i if in into is it its of on or our she so than that the their them then there these they this those to us was we were what when where which who will with would you your " +
    "about above after again all also am any because before below between both but can could did do does doing down during each few further how just me more most my no nor not now off once only other out over own same should some such too under until up very while why " +
    "engineer engineers developer developers senior junior manager managers experience experienced ability able team teams work working works role roles company companies years year strong skills skill required requirements requirement preferred plus including include includes etc looking join seeking candidate candidates opportunity opportunities responsibilities responsibility qualifications qualification excellent good great new using use used within across related relevant knowledge understanding minimum degree bachelor bachelors master masters equivalent position job description benefits salary location remote hybrid office full time part time apply applicants applicant employer employees employee environment fast paced passionate motivated self starter ideal impact help helping build building develop developing support supporting manage managing ensure ensuring provide providing drive driving must should need needs want make making take taking get getting day days week weeks month months per well like also may one two three four five"
  ).split(/\s+/)
);

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Every spelling of `term`: itself plus any aliases. */
export function variantsOf(term: string): string[] {
  const group = ALIASES.find((g) => g.includes(term));
  return group ? [...new Set([term, ...group])] : [term];
}

/** "mentoring" should also match "mentored" and "mentor": allow the common verb endings. */
function spellingPattern(variant: string): string {
  if (/^[a-z]{4,}ing$/.test(variant)) return `${variant.slice(0, -3)}(?:s|ed|er|ers|ing)?`;
  return escapeRegex(variant) + (/[a-z]$/.test(variant) ? "(?:s|es)?" : "");
}

function patternFor(term: string): RegExp {
  const alternatives = variantsOf(term).map(spellingPattern);
  return new RegExp(`(?<![a-z0-9+#])(?:${alternatives.join("|")})(?![a-z0-9+#])`, "i");
}

/** Whether `text` mentions `term` (as a whole word, plural or alias included). */
export function mentions(text: string, term: string): boolean {
  return patternFor(term).test(text);
}

function countMentions(text: string, term: string): number {
  const pattern = new RegExp(patternFor(term).source, "gi");
  return (text.match(pattern) ?? []).length;
}

const MAX_JOB_CHARS = 20000;
const REQUIREMENTS = /requirements|qualifications|what you(?:'|’)?ll need|must have|you have|who you are|what we(?:'|’)re looking for/i;

/**
 * The terms that matter for a job: known skills found in the description, repeated
 * words and phrases it leans on, and the chosen role's usual terms. Heaviest first.
 */
export function extractKeywords(jobText: string, preset?: RolePreset, max = 30): Keyword[] {
  const text = jobText.slice(0, MAX_JOB_CHARS).toLowerCase();
  const weights = new Map<string, Keyword>();
  const bump = (term: string, weight: number, source: Keyword["source"]) => {
    const existing = weights.get(term);
    if (existing) {
      existing.weight += weight;
      if (source === "job") existing.source = "job";
    } else {
      weights.set(term, { term, weight, source });
    }
  };

  if (text.trim()) {
    const requirementsAt = text.search(REQUIREMENTS);
    for (const term of LEXICON) {
      const count = countMentions(text, term);
      if (count === 0) continue;
      let weight = 2 + Math.min(count, 5) * 0.6;
      if (requirementsAt >= 0) {
        const first = text.search(patternFor(term));
        if (first >= requirementsAt) weight += 0.5;
      }
      bump(term, weight, "job");
    }

    // Repeated words and pairs that aren't boilerplate or already known skills.
    const words = text.match(/[a-z][a-z0-9+#.-]*[a-z0-9+#]|[a-z]/g) ?? [];
    const known = new Set(LEXICON.flatMap(variantsOf));
    const counts = new Map<string, number>();
    const add = (term: string) => counts.set(term, (counts.get(term) ?? 0) + 1);
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const meaningful = (x: string) => x.length >= 3 && !STOPWORDS.has(x) && !/^\d/.test(x);
      if (meaningful(w) && !known.has(w)) add(w);
      const next = words[i + 1];
      if (next && meaningful(w) && meaningful(next)) add(`${w} ${next}`);
    }
    for (const [term, count] of counts) {
      if (count < 2 || [...weights.keys()].some((k) => k.includes(term) || term.includes(k))) continue;
      bump(term, 1 + Math.min(count, 5) * 0.4, "job");
    }
  }

  if (preset) {
    preset.core.forEach((term) => bump(term, 1, "role"));
    preset.related.forEach((term) => bump(term, 0.6, "role"));
  }

  return [...weights.values()].sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Scoring and selection
// ---------------------------------------------------------------------------

const scoreText = (text: string, keywords: Keyword[]): number => {
  let score = keywords.reduce((sum, k) => (mentions(text, k.term) ? sum + k.weight : sum), 0);
  // Quantified results read as stronger evidence.
  if (score > 0 && /\d/.test(text)) score += 0.25;
  return score;
};

const experienceText = (item: ResumeExperienceItem) => `${item.role} ${item.company}`;
const projectText = (item: ResumeProjectItem) => `${item.name} ${item.technologies ?? ""}`;

export interface TargetOptions {
  maxExperiences?: number;
  maxProjects?: number;
}

export type KeywordStatus = Keyword & { status: "used" | "available" | "missing" };

export interface TargetPlan {
  keywords: KeywordStatus[];
  /** The entries the resume will contain (library ids), in resume order. */
  spec: ProfileSpec;
  /** Kept bullet positions per entry, in their original order. */
  bulletPicks: Record<string, number[]>;
  /** Skills per skill group, matching ones first. */
  skillOrder: Record<string, string[]>;
  /** Weighted share of the keywords the chosen content covers, 0 to 100. */
  coverage: number;
}

const bulletsFor = (rank: number) => (rank === 0 ? 5 : rank === 1 ? 4 : 3);

const MIN_BULLETS = 2;

/**
 * Up to `count` bullets of an entry, in their original order. Bullets that match the
 * job win; unrelated ones are left out unless fewer than two match, so an entry never
 * shrinks to nothing.
 */
function pickBullets(bullets: string[], keywords: Keyword[], count: number): number[] {
  const ranked = bullets
    .map((text, index) => ({ index, score: scoreText(text, keywords) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const relevant = ranked.filter((b) => b.score > 0);
  const chosen = relevant.length >= MIN_BULLETS ? relevant : ranked.slice(0, Math.min(MIN_BULLETS, ranked.length));
  return chosen.slice(0, count).map((c) => c.index).sort((a, b) => a - b);
}

/**
 * Chooses what to put on a resume for a job. Only reorders and selects what's in
 * `library`; it never writes new content. `base` limits the candidates (a profile's
 * selection, or everything).
 */
export function buildTargetPlan(library: Library, base: ProfileSpec, keywords: Keyword[], options: TargetOptions = {}): TargetPlan {
  const { maxExperiences = 4, maxProjects = 3 } = options;
  const allowed = <T extends { id: string }>(items: T[], ids: string[]) => items.filter((i) => ids.includes(i.id));
  const experiences = allowed(library.experience, base.experienceIds);
  const projects = allowed(library.project, base.projectIds);
  const education = allowed(library.education, base.educationIds);
  const skills = allowed(library.skill, base.skillIds);

  // Experiences: the most recent role always stays; the rest compete on relevance.
  const rankedExperiences = experiences.map((item, position) => {
    const best = pickBullets(item.bullets, keywords, 5).map((i) => scoreText(item.bullets[i], keywords));
    const recency = position === 0 ? 3 : position === 1 ? 1 : 0;
    return { item, position, score: scoreText(experienceText(item), keywords) + best.reduce((a, b) => a + b, 0) + recency };
  });
  const keptExperiences = [...rankedExperiences]
    .sort((a, b) => (a.position === 0 ? -1 : b.position === 0 ? 1 : b.score - a.score || a.position - b.position))
    .slice(0, maxExperiences)
    .sort((a, b) => a.position - b.position);

  const bulletPicks: Record<string, number[]> = {};
  keptExperiences.forEach(({ item }, rank) => {
    bulletPicks[item.id] = pickBullets(item.bullets, keywords, bulletsFor(rank));
  });

  // Projects: relevant ones only, unless none match, then the first couple.
  const rankedProjects = projects
    .map((item, position) => ({
      item,
      position,
      score: scoreText(projectText(item), keywords) + item.bullets.reduce((sum, b) => sum + scoreText(b, keywords), 0),
    }))
    .sort((a, b) => b.score - a.score || a.position - b.position);
  const relevantProjects = rankedProjects.filter((p) => p.score > 0);
  const keptProjects = (relevantProjects.length > 0 ? relevantProjects : rankedProjects.slice(0, 2)).slice(0, maxProjects);
  keptProjects.forEach(({ item }) => {
    bulletPicks[item.id] = pickBullets(item.bullets, keywords, 3);
  });

  // Skills: matching skills first inside each group; groups with more matches first.
  const skillOrder: Record<string, string[]> = {};
  const rankedSkills = skills
    .map((group, position) => {
      const list = group.skills.split(",").map((s) => s.trim()).filter(Boolean);
      const matching = list.filter((s) => keywords.some((k) => mentions(s, k.term) || mentions(k.term, s)));
      skillOrder[group.id] = [...matching, ...list.filter((s) => !matching.includes(s))];
      return { group, position, matches: matching.length };
    })
    .sort((a, b) => b.matches - a.matches || a.position - b.position);

  const spec: ProfileSpec = {
    headline: base.headline,
    summary: base.summary,
    experienceIds: keptExperiences.map((e) => e.item.id),
    projectIds: keptProjects.sort((a, b) => a.position - b.position).map((p) => p.item.id),
    educationIds: education.map((e) => e.id),
    skillIds: rankedSkills.map((s) => s.group.id),
  };

  // What the finished resume says, versus everything the user has saved.
  const chosenText = [
    ...keptExperiences.flatMap(({ item }) => [experienceText(item), ...bulletPicks[item.id].map((i) => item.bullets[i])]),
    ...keptProjects.flatMap(({ item }) => [projectText(item), ...bulletPicks[item.id].map((i) => item.bullets[i])]),
    ...rankedSkills.map(({ group }) => skillOrder[group.id].join(", ")),
    ...education.map((e) => `${e.degree} ${e.institution} ${e.details ?? ""}`),
  ].join("\n");
  const libraryText = [
    ...library.experience.flatMap((i) => [experienceText(i), ...i.bullets]),
    ...library.project.flatMap((i) => [projectText(i), ...i.bullets]),
    ...library.skill.map((s) => s.skills),
    ...library.education.map((e) => `${e.degree} ${e.details ?? ""}`),
  ].join("\n");

  const statuses: KeywordStatus[] = keywords.map((k) => ({
    ...k,
    status: mentions(chosenText, k.term) ? "used" : mentions(libraryText, k.term) ? "available" : "missing",
  }));
  const total = keywords.reduce((sum, k) => sum + k.weight, 0);
  const covered = statuses.filter((k) => k.status === "used").reduce((sum, k) => sum + k.weight, 0);

  return { keywords: statuses, spec, bulletPicks, skillOrder, coverage: total === 0 ? 0 : Math.round((covered / total) * 100) };
}

/** The resume data for a plan: copies of the chosen entries with only the kept bullets. */
export function applyTargetPlan(person: ResumePersonalInfo, library: Library, plan: TargetPlan, headline?: string): ResumeData {
  const trimmed: Library = {
    experience: library.experience.map((item) => ({
      ...item,
      bullets: (plan.bulletPicks[item.id] ?? item.bullets.map((_, i) => i)).map((i) => item.bullets[i]),
    })),
    project: library.project.map((item) => ({
      ...item,
      bullets: (plan.bulletPicks[item.id] ?? item.bullets.map((_, i) => i)).map((i) => item.bullets[i]),
    })),
    education: library.education,
    skill: library.skill.map((group): ResumeSkillItem => ({
      ...group,
      skills: (plan.skillOrder[group.id] ?? group.skills.split(",").map((s) => s.trim())).join(", "),
    })),
  };
  return buildResumeData(person, trimmed, { ...plan.spec, headline: headline ?? plan.spec.headline });
}
