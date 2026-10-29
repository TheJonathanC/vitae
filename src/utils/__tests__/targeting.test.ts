import { describe, it, expect } from "vitest";
import { applyTargetPlan, buildTargetPlan, extractKeywords, mentions, variantsOf } from "../targeting";
import { findRolePreset, ROLE_PRESETS } from "../rolePresets";
import { defaultProfileSpec, parseLibrary, parsePerson } from "../library";
import { LibraryRow } from "../../types";

const row = (id: string, kind: LibraryRow["kind"], data: object): LibraryRow => ({ id, kind, data: JSON.stringify(data), created_at: "", updated_at: "" });

const JOB = `Senior Backend Engineer

We're looking for an engineer to build our payments platform.

Requirements:
- 5+ years of experience with Python and PostgreSQL
- Strong knowledge of AWS and Kubernetes
- Experience designing REST APIs and microservices
- Comfortable with CI/CD and Docker
- Mentoring junior engineers

Nice to have: Kafka, Terraform. You'll own payments reliability and payments reconciliation end to end.`;

describe("mentions", () => {
  it("matches whole words, plurals and aliases", () => {
    expect(mentions("Built REST APIs in Node", "rest api")).toBe(true);
    expect(mentions("Deployed to K8s", "kubernetes")).toBe(true);
    expect(mentions("Wrote JS and Postgres code", "javascript")).toBe(true);
    expect(mentions("Wrote JS and Postgres code", "postgresql")).toBe(true);
    expect(mentions("Used microservices", "microservice")).toBe(true);
  });

  it("matches verb forms of -ing terms", () => {
    expect(mentions("Mentored two junior engineers", "mentoring")).toBe(true);
    expect(mentions("Monitored production systems", "monitoring")).toBe(true);
    expect(mentions("I mentor interns", "mentoring")).toBe(true);
    expect(mentions("Wrote documentation", "mentoring")).toBe(false);
  });

  it("doesn't match inside other words", () => {
    expect(mentions("Wrote JavaScript", "java")).toBe(false);
    expect(mentions("Used the rest of the budget", "rest api")).toBe(false);
    expect(mentions("Expressed interest", "express.js")).toBe(false);
    expect(mentions("A scalable design", "scala")).toBe(false);
  });

  it("handles terms with symbols", () => {
    expect(mentions("Wrote C++ and C# services", "c++")).toBe(true);
    expect(mentions("Wrote C++ and C# services", "c#")).toBe(true);
    expect(mentions("Upgraded to .NET 8", ".net")).toBe(true);
    expect(mentions("Built with Node.js.", "node.js")).toBe(true);
    expect(mentions("Used CI/CD pipelines", "ci/cd")).toBe(true);
  });

  it("lists spellings of a term", () => {
    expect(variantsOf("kubernetes")).toContain("k8s");
    expect(variantsOf("anything else")).toEqual(["anything else"]);
  });
});

describe("extractKeywords", () => {
  const terms = (jobText: string, role?: string) => extractKeywords(jobText, role ? findRolePreset(role) : undefined).map((k) => k.term);

  it("finds the skills a job description names", () => {
    const found = terms(JOB);
    for (const expected of ["python", "postgresql", "aws", "kubernetes", "microservices", "docker", "ci/cd", "kafka", "terraform", "mentoring"]) {
      expect(found).toContain(expected);
    }
    expect(found).toContain("rest api");
  });

  it("weighs skills in the requirements above ones mentioned in passing, and repeated ones higher", () => {
    const byTerm = Object.fromEntries(extractKeywords(JOB).map((k) => [k.term, k.weight]));
    expect(byTerm["python"]).toBeGreaterThan(byTerm["kafka"] - 1);
    expect(byTerm["aws"]).toBeGreaterThan(0);
  });

  it("picks up repeated domain terms and ignores boilerplate", () => {
    const found = terms(JOB);
    expect(found).toContain("payments");
    for (const generic of ["experience", "years", "strong", "looking", "engineer"]) {
      expect(found).not.toContain(generic);
    }
  });

  it("works from a role alone and combines it with a job", () => {
    const roleOnly = extractKeywords("", findRolePreset("devops"));
    expect(roleOnly.length).toBeGreaterThan(10);
    expect(roleOnly.every((k) => k.source === "role")).toBe(true);
    const combined = extractKeywords("We need Terraform experts.", findRolePreset("devops"));
    const terraform = combined.find((k) => k.term === "terraform")!;
    expect(terraform.source).toBe("job");
    expect(terraform.weight).toBeGreaterThan(roleOnly.find((k) => k.term === "terraform")!.weight);
  });

  it("returns nothing for empty input and caps the list", () => {
    expect(extractKeywords("")).toEqual([]);
    expect(extractKeywords(JOB, undefined, 5)).toHaveLength(5);
  });

  it("copes with a very long description", () => {
    const started = Date.now();
    expect(extractKeywords(JOB.repeat(500)).length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("every preset has terms", () => {
    for (const preset of ROLE_PRESETS) {
      expect(preset.core.length).toBeGreaterThan(3);
      expect(preset.headline).not.toBe("");
    }
    expect(new Set(ROLE_PRESETS.map((p) => p.id)).size).toBe(ROLE_PRESETS.length);
  });
});

const library = parseLibrary([
  row("e1", "experience", {
    role: "Backend Engineer", company: "Acme", startDate: "2022", endDate: "Present",
    bullets: ["Cut API latency 40% by redesigning PostgreSQL queries", "Ran Kubernetes clusters on AWS", "Organised the office party", "Wrote Python services for billing", "Mentored two junior engineers", "Updated the wiki"],
  }),
  row("e2", "experience", { role: "Barista", company: "Cafe", startDate: "2019", endDate: "2020", bullets: ["Served customers", "Closed the till"] }),
  row("e3", "experience", { role: "Software Intern", company: "Beta", startDate: "2020", endDate: "2021", bullets: ["Built Docker images for CI/CD", "Fixed small bugs"] }),
  row("p1", "project", { name: "Knitting tracker", technologies: "Swift", bullets: ["Tracks yarn"] }),
  row("p2", "project", { name: "Kafka replay tool", technologies: "Go, Kafka", bullets: ["Replays Kafka topics for debugging"] }),
  row("s0", "skill", { category: "Tools", skills: "Git, Figma" }),
  row("s1", "skill", { category: "Languages", skills: "Rust, Python, SQL" }),
  row("s2", "skill", { category: "Cloud", skills: "GCP, AWS, Terraform" }),
  row("d1", "education", { degree: "BSc Computer Science", institution: "State U", startDate: "2014", endDate: "2018" }),
]);
const person = parsePerson(JSON.stringify({ name: "Jane Doe", email: "jane@example.com" }));
const keywords = extractKeywords(JOB, findRolePreset("backend"));
const base = defaultProfileSpec(library);

describe("buildTargetPlan", () => {
  const plan = buildTargetPlan(library, base, keywords);

  it("keeps relevant experiences and the most recent role, dropping the least relevant when over the limit", () => {
    const limited = buildTargetPlan(library, base, keywords, { maxExperiences: 2 });
    expect(limited.spec.experienceIds).toEqual(["e1", "e3"]);
    // Newest first: the intern role (2020-21) is more recent than the barista job (2019-20).
    expect(plan.spec.experienceIds).toEqual(["e1", "e3", "e2"]);
  });

  it("always keeps the current role even if it matches nothing", () => {
    const off = extractKeywords("Looking for a pastry chef", undefined);
    const result = buildTargetPlan(library, base, off, { maxExperiences: 1 });
    expect(result.spec.experienceIds).toEqual(["e1"]);
  });

  it("picks the bullets that match the job and keeps them in their original order", () => {
    const picks = buildTargetPlan(library, base, keywords).bulletPicks["e1"];
    const bullets = library.experience.find((e) => e.id === "e1")!.bullets;
    expect(picks).toEqual([...picks].sort((a, b) => a - b));
    expect(picks.map((i) => bullets[i])).toContain("Cut API latency 40% by redesigning PostgreSQL queries");
    expect(picks.map((i) => bullets[i])).toContain("Ran Kubernetes clusters on AWS");
    expect(picks.map((i) => bullets[i])).not.toContain("Organised the office party");
    expect(picks).toHaveLength(4);
  });

  it("gives older roles fewer bullets", () => {
    expect(plan.bulletPicks["e3"].length).toBeLessThanOrEqual(3);
  });

  it("keeps at least two bullets per role even when few match", () => {
    expect(plan.bulletPicks["e2"]).toEqual([0, 1]);
    const off = extractKeywords("Looking for a pastry chef", undefined);
    expect(buildTargetPlan(library, base, off).bulletPicks["e1"].length).toBeGreaterThanOrEqual(2);
  });

  it("fills up to the limit with matching bullets when many match", () => {
    const many = parseLibrary([row("m1", "experience", { role: "Dev", company: "X", bullets: Array.from({ length: 9 }, (_, i) => `Used Python for job ${i}`) })]);
    expect(buildTargetPlan(many, defaultProfileSpec(many), keywords).bulletPicks["m1"]).toHaveLength(5);
  });

  it("keeps relevant projects and drops irrelevant ones", () => {
    expect(plan.spec.projectIds).toEqual(["p2"]);
  });

  it("falls back to the first projects when none match", () => {
    const off = extractKeywords("Looking for a pastry chef", undefined);
    expect(buildTargetPlan(library, base, off).spec.projectIds.length).toBeGreaterThan(0);
  });

  it("puts matching skills first and orders groups by matches", () => {
    expect(plan.skillOrder["s1"].slice(0, 2).sort()).toEqual(["Python", "SQL"]);
    expect(plan.skillOrder["s2"].slice(0, 2).sort()).toEqual(["AWS", "Terraform"]);
    expect(plan.skillOrder["s2"]).toHaveLength(3);
    // Equal matches keep their order; the group with no matches goes last.
    expect(plan.spec.skillIds).toEqual(["s1", "s2", "s0"]);
  });

  it("reports which keywords are used, available but left out, or missing", () => {
    const byTerm = Object.fromEntries(plan.keywords.map((k) => [k.term, k.status]));
    expect(byTerm["kubernetes"]).toBe("used");
    expect(byTerm["python"]).toBe("used");
    expect(Object.values(byTerm)).toContain("missing");
    const narrow = buildTargetPlan(library, base, keywords, { maxExperiences: 1 });
    expect(narrow.keywords.find((k) => k.term === "docker")?.status).toBe("available");
  });

  it("scores coverage between 0 and 100 and rises with relevant content", () => {
    expect(plan.coverage).toBeGreaterThan(0);
    expect(plan.coverage).toBeLessThanOrEqual(100);
    const empty = buildTargetPlan({ experience: [], project: [], education: [], skill: [] }, defaultProfileSpec({ experience: [], project: [], education: [], skill: [] }), keywords);
    expect(empty.coverage).toBe(0);
    expect(empty.keywords.every((k) => k.status === "missing")).toBe(true);
  });

  it("only considers entries the base profile allows", () => {
    const narrowBase = { ...base, experienceIds: ["e2"] };
    expect(buildTargetPlan(library, narrowBase, keywords).spec.experienceIds).toEqual(["e2"]);
  });

  it("handles no keywords and an empty library", () => {
    expect(buildTargetPlan(library, base, []).coverage).toBe(0);
    const none = { experience: [], project: [], education: [], skill: [] };
    expect(buildTargetPlan(none, defaultProfileSpec(none), keywords).spec.experienceIds).toEqual([]);
  });
});

describe("applyTargetPlan", () => {
  const plan = buildTargetPlan(library, base, keywords);

  it("produces only the kept bullets, in order, with the headline", () => {
    const data = applyTargetPlan(person, library, plan, "Backend Engineer");
    expect(data.personal).toMatchObject({ name: "Jane Doe", title: "Backend Engineer" });
    const current = data.experience[0];
    expect(current.bullets).toHaveLength(4);
    expect(current.bullets).not.toContain("Organised the office party");
    expect(data.projects.map((p) => p.name)).toEqual(["Kafka replay tool"]);
    expect(data.skills.map((g) => g.skills)).toEqual(["Python, SQL, Rust", "AWS, Terraform, GCP", "Git, Figma"]);
  });

  it("never invents content: every bullet comes from the library", () => {
    const all = new Set(library.experience.flatMap((e) => e.bullets).concat(library.project.flatMap((p) => p.bullets)));
    const data = applyTargetPlan(person, library, plan);
    for (const bullet of [...data.experience.flatMap((e) => e.bullets), ...data.projects.flatMap((p) => p.bullets)]) {
      expect(all.has(bullet)).toBe(true);
    }
  });

  it("leaves the library untouched", () => {
    const before = JSON.stringify(library);
    applyTargetPlan(person, library, plan);
    expect(JSON.stringify(library)).toBe(before);
  });
});
