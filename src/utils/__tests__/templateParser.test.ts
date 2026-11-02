import { describe, it, expect } from "vitest";
import { analyzeTemplate, parseTemplate, canonicalizeTags, humanizeKey } from "../templateParser";
import { getEmptyResumeData, renderTemplate, reorderTemplateSections } from "../templateEngine";
import { BUILTIN_TEMPLATES } from "../templatePresets";

describe("parseTemplate", () => {
  it("builds a tree of text, values and blocks", () => {
    expect(parseTemplate("A {{name}} {{#items}}[{{role}}]{{/items}} {{^x}}none{{/x}}")).toEqual([
      { type: "text", value: "A " },
      { type: "var", key: "name" },
      { type: "text", value: " " },
      {
        type: "block",
        key: "items",
        inverted: false,
        children: [{ type: "text", value: "[" }, { type: "var", key: "role" }, { type: "text", value: "]" }],
      },
      { type: "text", value: " " },
      { type: "block", key: "x", inverted: true, children: [{ type: "text", value: "none" }] },
    ]);
  });

  it("reads LaTeX's triple braces around a placeholder", () => {
    expect(parseTemplate("\\textbf{{{name}}}")).toEqual([
      { type: "text", value: "\\textbf{" },
      { type: "var", key: "name" },
      { type: "text", value: "}" },
    ]);
  });

  it("drops stray closing tags and keeps the body of unclosed blocks", () => {
    expect(parseTemplate("a{{/x}}b{{#y}}c")).toEqual([{ type: "text", value: "abc" }]);
  });

  it("accepts spaces inside tags", () => {
    expect(canonicalizeTags("{{ name }} {{# experience }}{{/ experience }}")).toBe(
      "{{name}} {{#experience}}{{/experience}}"
    );
  });
});

describe("analyzeTemplate", () => {
  it("lists the contact fields and sections each built-in template uses", () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const analysis = analyzeTemplate(tpl.content);
      expect(analysis.personalFields).toEqual(expect.arrayContaining(["name", "email", "phone"]));
      expect(analysis.sections.map((s) => s.key)).toEqual(
        expect.arrayContaining(["experience", "education", "projects", "skills"])
      );
      const experience = analysis.sections.find((s) => s.key === "experience")!;
      expect(experience.fields).toEqual(expect.arrayContaining(["role", "company", "startDate", "endDate"]));
      expect(experience.hasBullets).toBe(true);
      expect(analysis.customVariables).toEqual([]);
    }
  });

  it("finds the fields of each section, including ones only used as conditions", () => {
    const analysis = analyzeTemplate(`
      {{name}}
      {{#projects}}\\section{Selected Work}{{#items}}{{name}}{{#dates}} ({{dates}}){{/dates}}{{#award}}*{{/award}}{{/items}}{{/projects}}
    `);
    const projects = analysis.sections[0];
    expect(projects).toMatchObject({ key: "projects", builtin: true, heading: "Selected Work", hasBullets: false });
    expect(projects.fields).toEqual(["name", "dates", "award"]);
    // Entry fields are not mistaken for top-level ones (the old analyzer skipped any "name").
    expect(analysis.personalFields).toEqual(["name"]);
  });

  it("detects sections a template defines itself, with their heading", () => {
    const analysis = analyzeTemplate(`
      {{#publications}}
      \\section*{Publications}
      {{#items}}\\item \\textbf{{{title}}}, \\textit{{{venue}}} {{year}}{{#highlights}}{{#bullets}}{{bullet}}{{/bullets}}{{/highlights}}{{/items}}
      {{/publications}}
    `);
    expect(analysis.sections).toEqual([
      { key: "publications", builtin: false, heading: "Publications", fields: ["title", "venue", "year"], hasBullets: true },
    ]);
    expect(analysis.hasStandardStructure).toBe(true);
    expect(analysis.detectedSections).toEqual([]);
  });

  it("names a text field after the heading around it", () => {
    const analysis = analyzeTemplate("{{#interests}}\\section{Hobbies \\& Interests}\n{{interests}}{{/interests}} {{clearance}}");
    expect(analysis.customVariables).toEqual([
      { key: "interests", label: "Hobbies & Interests", type: "textarea" },
      { key: "clearance", label: "Clearance", type: "text" },
    ]);
  });

  it("treats a top-level key like company as a field of its own", () => {
    const analysis = analyzeTemplate("Applying to {{company}} as {{title}}");
    expect(analysis.customVariables.map((v) => v.key)).toEqual(["company"]);
    expect(analysis.personalFields).toEqual(["title"]);
    expect(analysis.hasStandardStructure).toBe(false);
  });

  it("labels keys readably", () => {
    expect(humanizeKey("security_clearance")).toBe("Security clearance");
    expect(humanizeKey("startDate")).toBe("Start");
    expect(humanizeKey("fieldOfStudy")).toBe("Field of study");
  });
});

describe("rendering template-defined content", () => {
  it("renders custom lists, entry fields and bullets", () => {
    const data = getEmptyResumeData();
    data.customLists = {
      publications: [
        { id: "p1", fields: { title: "Fast & Safe", year: "2024" }, bullets: ["Cited 40 times", ""] },
        { id: "p2", fields: { title: "Second" }, bullets: [] },
      ],
    };
    const template =
      "{{#publications}}\\section{Publications}{{#items}}[{{title}}{{#year}}, {{year}}{{/year}}{{#highlights}}:{{#bullets}} {{bullet}}{{/bullets}}{{/highlights}}]{{/items}}{{/publications}}";
    expect(renderTemplate(template, data)).toBe("\\section{Publications}[Fast \\& Safe, 2024: Cited 40 times]\n[Second]");
    data.customLists.publications = [];
    expect(renderTemplate(template, data)).toBe("");
  });

  it("renders extra fields on built-in entries", () => {
    const data = getEmptyResumeData();
    data.projects = [{ id: "p", name: "Tide", bullets: [], fields: { dates: "2022 -- Present" } }];
    expect(renderTemplate("{{#projects}}{{#items}}{{name}} ({{dates}}){{/items}}{{/projects}}", data)).toBe(
      "Tide (2022 -- Present)"
    );
  });

  it("separates entries with {{^last}}", () => {
    const data = getEmptyResumeData();
    data.skills = [
      { id: "a", category: "Languages", skills: "Go" },
      { id: "b", category: "Tools", skills: "Git" },
    ];
    expect(
      renderTemplate("{{#skills}}{{#items}}{{category}}: {{skills}}{{^last}} \\\\{{/last}}{{/items}}{{/skills}}", data)
    ).toBe("Languages: Go \\\\\nTools: Git");
  });

  it("never fills an empty entry field with your own details", () => {
    const data = getEmptyResumeData();
    data.personal.location = "Home Town";
    data.experience = [{ id: "e", role: "Dev", company: "Co", bullets: [] }];
    expect(renderTemplate("{{#experience}}{{#items}}{{role}}|{{location}}|{{/items}}{{/experience}}{{location}}", data)).toBe(
      "Dev||Home Town"
    );
  });

  it("moves template-defined sections with the section order", () => {
    const template = "{{#experience}}E{{/experience}}\n\n{{#awards}}A{{/awards}}";
    expect(reorderTemplateSections(template, ["personal", "awards", "experience"])).toBe(
      "{{#awards}}A{{/awards}}\n\n{{#experience}}E{{/experience}}"
    );
  });
});
