import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  analyzeLatexImport,
  buildLatexImport,
  changeSectionMapping,
  changeSlotField,
  classifyHeading,
  convertRawLatexToTemplate,
  mappingOptions,
  mergeImportedData,
} from "../latexImport";
import { analyzeTemplate } from "../templateParser";
import { getEmptyResumeData, renderTemplate } from "../templateEngine";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", `${name}.tex`), "utf8");

/** Renders an import's template with its own data, as the app does after saving. */
const roundTrip = (raw: string) => {
  const result = buildLatexImport(raw);
  const data = mergeImportedData(getEmptyResumeData(), result.extractedData);
  return { ...result, data, rendered: renderTemplate(result.templateContent, data) };
};

const summary = (raw: string) =>
  analyzeLatexImport(raw).sections.map((s) => [s.heading, s.mapping, s.slots.map((slot) => slot.field)]);

describe("classifyHeading", () => {
  it("recognizes common headings", () => {
    expect(classifyHeading("Work History")).toBe("experience");
    expect(classifyHeading("Professional Experience")).toBe("experience");
    expect(classifyHeading("Technical Skills")).toBe("skills");
    expect(classifyHeading("Academic Background")).toBe("education");
    expect(classifyHeading("Selected Projects")).toBe("projects");
    expect(classifyHeading("Professional Summary")).toBe("summary");
    expect(classifyHeading("Publications")).toBeNull();
  });
});

describe("importing a resume built from entry macros (\\resumeSubheading)", () => {
  const raw = fixture("subheading-macros");

  it("finds every section and what each piece of an entry is", () => {
    expect(summary(raw)).toEqual([
      ["Education", "education", ["institution", "location", "degree", "dates"]],
      ["Experience", "experience", ["role", "dates", "company", "location"]],
      ["Projects", "projects", ["name", "technologies", "dates"]],
      ["Technical Skills", "skills", ["category", "skills"]],
    ]);
  });

  it("extracts entries, dates and bullets into the form data", () => {
    const { data } = roundTrip(raw);
    expect(data.personal).toMatchObject({
      name: "Priya Raman",
      email: "priya.raman@example.com",
      phone: "415-555-0182",
      linkedin: "linkedin.com/in/priyaraman",
      github: "github.com/praman",
    });
    expect(data.experience).toHaveLength(2);
    expect(data.experience[0]).toMatchObject({
      role: "Software Engineer",
      company: "Harbor Analytics Inc.",
      location: "Seattle, WA",
      startDate: "June 2021",
      endDate: "Present",
    });
    expect(data.experience[0].bullets).toEqual([
      "Built a streaming ingestion service in Go handling 40k events per second",
      "Cut dashboard load time by 35% by caching aggregate queries",
      "Mentored two interns through their first production launches",
    ]);
    expect(data.education[1]).toMatchObject({ institution: "Cascade Community College", degree: "Associate's in Liberal Arts" });
    expect(data.projects[0]).toMatchObject({
      name: "Tidepool",
      technologies: "Rust, WebAssembly, React",
      fields: { dates: "Jan. 2022 -- Present" },
    });
    expect(data.skills.map((s) => [s.category, s.skills])).toEqual([
      ["Languages", "Go, Rust, Python, TypeScript, SQL"],
      ["Frameworks", "React, gRPC, Django"],
      ["Tools", "Docker, Kubernetes, Terraform, Git"],
    ]);
  });

  it("produces a template that prints the original text from the extracted data", () => {
    const { match, rendered } = roundTrip(raw);
    expect(match).toBe(1);
    expect(rendered).toContain("\\resumeSubheading\n      {Software Engineer}{June 2021 -- Present}\n      {Harbor Analytics Inc.}{Seattle, WA}");
    expect(rendered).toContain("\\resumeItem{Cut dashboard load time by 35\\% by caching aggregate queries}");
    expect(rendered).toContain("\\textbf{Frameworks}{: React, gRPC, Django} \\\\");
    expect(rendered).not.toContain("{{");
    // The preamble's macro definitions are untouched.
    expect(rendered).toContain("\\newcommand{\\resumeSubheading}[4]{");
  });

  it("gives the form the fields the template now uses", () => {
    const analysis = analyzeTemplate(buildLatexImport(raw).templateContent);
    expect(analysis.sections.map((s) => s.key)).toEqual(["education", "experience", "projects", "skills"]);
    expect(analysis.sections.find((s) => s.key === "projects")).toMatchObject({
      fields: ["name", "technologies", "dates"],
      hasBullets: true,
    });
    expect(analysis.personalFields).toEqual(["name", "phone", "email", "linkedin", "github"]);
  });
});

describe("importing a resume that uses a CV class (\\cventry)", () => {
  const raw = fixture("cventry-class");

  it("detects sections and keeps unrecognized ones as their own sections", () => {
    expect(summary(raw)).toEqual([
      ["Work Experience", "experience", ["role", "company", "location", "dates"]],
      ["Education", "education", ["degree", "institution", "location", "dates"]],
      ["Honors & Awards", "list", ["title", "subtitle", "location", "dates"]],
    ]);
  });

  it("extracts the class's contact commands and the entries", () => {
    const { data, match, templateContent } = roundTrip(raw);
    expect(match).toBe(1);
    expect(data.personal.name).toBe("Marta Kowalska");
    expect(templateContent).toContain("\\name{{{name}}}{}");
    expect(data.experience[1]).toMatchObject({ role: "Data Engineer", startDate: "Jul. 2016", endDate: "Feb. 2020" });
    expect(data.experience[1].bullets).toEqual(["Migrated nightly ETL jobs from cron to Airflow"]);
    expect(data.customLists?.honors_awards.map((i) => i.fields)).toEqual([
      { title: "Finalist", subtitle: "European Data Challenge", location: "Lisbon, Portugal", dates: "2019" },
      { title: "First Place", subtitle: "Warsaw Hackathon", location: "Warsaw, Poland", dates: "2017" },
    ]);
    expect(analyzeTemplate(templateContent).sections.find((s) => s.key === "honors_awards")).toMatchObject({
      builtin: false,
      heading: "Honors & Awards",
      fields: ["title", "subtitle", "location", "dates"],
    });
  });
});

describe("importing a hand-written resume", () => {
  const raw = fixture("handwritten");

  it("detects the summary, entries written with \\hfill, a list section and a text section", () => {
    expect(summary(raw)).toEqual([
      ["Summary", "summary", []],
      ["Work History", "experience", ["role", "dates", "company", "location"]],
      ["Publications", "list", ["title", "subtitle", "dates"]],
      ["Interests", "text", []],
    ]);
  });

  it("extracts header details, the summary and text sections", () => {
    const { data, match, templateContent } = roundTrip(raw);
    expect(match).toBe(1);
    expect(data.personal).toMatchObject({
      name: "Daniel Okafor",
      location: "Austin, TX",
      phone: "(512) 555-0147",
      email: "dokafor@example.org",
      website: "danielokafor.dev",
    });
    expect(data.personal.summary).toMatch(/^Product-minded backend engineer/);
    expect(data.customVariables).toEqual({ interests: "Long-distance cycling, sourdough baking and community radio." });
    expect(data.experience[0].bullets[0]).toBe("Led the rewrite of the ledger service, reducing reconciliation errors by 90%.");
    expect(templateContent).toContain("\\href{https://{{website}}}{{{website}}}");
    expect(analyzeTemplate(templateContent).customVariables).toEqual([
      { key: "interests", label: "Interests", type: "textarea" },
    ]);
  });
});

describe("correcting the importer's guesses", () => {
  const raw = fixture("cventry-class");

  it("re-guesses fields when a section's type changes, and frees a type another section had", () => {
    let plan = analyzeLatexImport(raw);
    plan = changeSectionMapping(plan, "s2", "experience");
    expect(plan.sections[2].mapping).toBe("experience");
    expect(plan.sections[2].slots.map((s) => s.field)).toEqual(["role", "company", "location", "startDate"]);
    expect(plan.sections[0].mapping).toBe("list");

    const { extractedData } = buildLatexImport(raw, plan);
    expect(extractedData.experience?.map((e) => e.role)).toEqual(["Finalist", "First Place"]);
    expect(extractedData.customLists?.work_experience).toHaveLength(2);
  });

  it("disables single-use types another section already has", () => {
    const plan = analyzeLatexImport(raw);
    const options = mappingOptions(plan, plan.sections[2]);
    expect(options.find((o) => o.value === "experience")?.disabled).toBe(true);
    expect(options.find((o) => o.value === "projects")?.disabled).toBe(false);
  });

  it("keeps a piece as fixed text, or moves it to another field", () => {
    let plan = analyzeLatexImport(raw);
    plan = changeSlotField(plan, "s0", plan.sections[0].slots[2].id, "");
    plan = changeSlotField(plan, "s0", plan.sections[0].slots[1].id, "details");
    const { templateContent, extractedData } = buildLatexImport(raw, plan);
    expect(templateContent).toContain("{Berlin, Germany}");
    expect(extractedData.experience?.[1]).toMatchObject({ company: "", location: "", fields: { details: "Vistula Logistics" } });
  });

  it("can leave a section exactly as written", () => {
    const plan = changeSectionMapping(analyzeLatexImport(raw), "s1", "keep");
    const { templateContent, extractedData } = buildLatexImport(raw, plan);
    expect(templateContent).toContain("{Warsaw University of Technology}");
    expect(extractedData.education).toBeUndefined();
  });
});

describe("importer edge cases", () => {
  const doc = (body: string, preamble = "") =>
    `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

  it("keeps placeholder-like braces in the original from turning into fields", () => {
    const raw = doc("\\section{Skills}\n\\textbf{{Languages}}: Go, Rust");
    const { templateContent } = buildLatexImport(raw);
    expect(analyzeTemplate(templateContent).customVariables.map((v) => v.key)).not.toContain("Languages");
  });

  it("treats sentence-like list items as one field each", () => {
    const raw = doc(
      "\\section{Awards}\n\\begin{itemize}\n  \\item Won the \\textbf{regional} robotics final\n  \\item Dean's List, all semesters\n\\end{itemize}"
    );
    const { data, match } = roundTrip(raw);
    expect(data.customLists?.awards.map((i) => i.fields.title)).toEqual([
      "Won the regional robotics final",
      "Dean's List, all semesters",
    ]);
    expect(match).toBe(1);
  });

  it("splits 'Category: skills' items in a skills section", () => {
    const raw = doc("\\section{Skills}\n\\begin{itemize}\n\\item Languages: Go, Rust\n\\item Cloud: AWS, GCP\n\\end{itemize}");
    const { data } = roundTrip(raw);
    expect(data.skills.map((s) => [s.category, s.skills])).toEqual([
      ["Languages", "Go, Rust"],
      ["Cloud", "AWS, GCP"],
    ]);
  });

  it("keeps formatting around a text section balanced", () => {
    const raw = doc("\\section{Interests}\n{\\small \\textit{Chess}, climbing and film}");
    const { templateContent, rendered } = roundTrip(raw);
    const opens = (templateContent.match(/(?<!\\)\{/g) || []).length - (templateContent.match(/\{\{/g) || []).length * 2;
    const closes = (templateContent.match(/(?<!\\)\}/g) || []).length - (templateContent.match(/\}\}/g) || []).length * 2;
    expect(opens).toBe(closes);
    expect(rendered).toContain("Chess, climbing and film");
  });

  it("ignores a profile link inside a project URL", () => {
    const raw = doc(
      "\\begin{center}Jo Park $|$ \\href{https://github.com/jopark}{github.com/jopark}\\end{center}\n\\section{Projects}\n\\textbf{Kite} \\hfill \\href{https://github.com/jopark/kite}{github.com/jopark/kite}"
    );
    const { data } = roundTrip(raw);
    expect(data.personal.github).toBe("github.com/jopark");
    expect(data.projects[0]).toMatchObject({ name: "Kite", link: "https://github.com/jopark/kite" });
  });

  it("leaves files without sections to the header logic", () => {
    const result = convertRawLatexToTemplate(doc("{\\Huge Sam Lee}\\\\ sam@example.com"));
    expect(result.extractedData.personal).toEqual({ name: "Sam Lee", email: "sam@example.com" });
  });
});

describe("mergeImportedData", () => {
  it("only fills fields and sections that are empty", () => {
    const data = getEmptyResumeData();
    data.personal.name = "Kept";
    data.experience = [{ id: "e", role: "Mine", company: "", bullets: [] }];
    data.customVariables = { interests: "Mine" };
    const merged = mergeImportedData(data, {
      personal: { name: "Imported", email: "a@b.co" },
      experience: [{ id: "x", role: "Theirs", company: "", bullets: [] }],
      skills: [{ id: "s", category: "Go", skills: "" }],
      customLists: { awards: [{ id: "a", fields: { title: "Prize" }, bullets: [] }] },
      customVariables: { interests: "Theirs", clearance: "Yes" },
    });
    expect(merged.personal).toMatchObject({ name: "Kept", email: "a@b.co" });
    expect(merged.experience[0].role).toBe("Mine");
    expect(merged.skills).toHaveLength(1);
    expect(merged.customLists?.awards).toHaveLength(1);
    expect(merged.customVariables).toEqual({ interests: "Mine", clearance: "Yes" });
  });
});

describe("Windows line endings", () => {
  it("imports a CRLF file the same as an LF one", () => {
    const lf = fixture("subheading-macros");
    const crlf = lf.replace(/\r?\n/g, "\r\n");
    const fromCrlf = buildLatexImport(crlf);
    expect(fromCrlf.templateContent).toBe(buildLatexImport(lf.replace(/\r\n/g, "\n")).templateContent);
    expect(fromCrlf.templateContent).not.toContain("\r");
    expect(fromCrlf.match).toBe(1);
  });
});
