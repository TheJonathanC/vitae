import { describe, it, expect } from "vitest";
import {
  escapeLatex,
  getDefaultResumeData,
  renderTemplate,
  extractFieldsFromTemplate,
  convertRawLatexToTemplate,
  sanitizeLatexUrl,
  escapeLatexUrl,
  reorderTemplateSections,
  getEmptyResumeData,
  normalizeResumeData,
} from "../templateEngine";
import { BUILTIN_TEMPLATES } from "../templatePresets";
import { ResumeData } from "../../types";

describe("templateEngine", () => {
  describe("escapeLatex", () => {
    it("escapes special LaTeX characters properly", () => {
      expect(escapeLatex("100% Guaranteed")).toBe("100\\% Guaranteed");
      expect(escapeLatex("Research & Development")).toBe("Research \\& Development");
      expect(escapeLatex("$100,000 budget")).toBe("\\$100,000 budget");
      expect(escapeLatex("#1 Ranking")).toBe("\\#1 Ranking");
      expect(escapeLatex("user_id_field")).toBe("user\\_id\\_field");
      expect(escapeLatex("{braces}")).toBe("\\{braces\\}");
      expect(escapeLatex("C++ & C# ~ 99%")).toBe("C++ \\& C\\# \\textasciitilde{} 99\\%");
      expect(escapeLatex("backslash \\ test")).toBe("backslash \\textbackslash{} test");
      expect(escapeLatex("<100ms | >5x")).toBe("\\textless{}100ms \\textbar{} \\textgreater{}5x");
    });

    it("handles null and undefined gracefully", () => {
      expect(escapeLatex(null)).toBe("");
      expect(escapeLatex(undefined)).toBe("");
      expect(escapeLatex("")).toBe("");
    });
  });

  describe("sanitizeLatexUrl", () => {
    it("ensures protocol and escapes special chars in URLs", () => {
      expect(sanitizeLatexUrl("example.com")).toBe("https://example.com");
      expect(sanitizeLatexUrl("https://example.com#section")).toBe("https://example.com\\#section");
      expect(sanitizeLatexUrl("mailto:test@example.com")).toBe("mailto:test@example.com");
      expect(sanitizeLatexUrl(undefined)).toBe("");
    });
  });

  describe("getDefaultResumeData", () => {
    it("returns valid structured default data", () => {
      const data = getDefaultResumeData("Jane Doe");
      expect(data.personal.name).toBe("Jane Doe");
      expect(data.experience.length).toBeGreaterThan(0);
      expect(data.education.length).toBeGreaterThan(0);
      expect(data.skills.length).toBeGreaterThan(0);
      expect(data.projects.length).toBeGreaterThan(0);
    });
  });

  describe("extractFieldsFromTemplate", () => {
    it("identifies detected sections and custom variables", () => {
      const template = `
        \\documentclass{article}
        \\begin{document}
        {{name}}
        {{phone}}
        {{email}}
        {{#summary}}{{summary}}{{/summary}}
        {{#experience}}
        {{#items}}
        {{role}} at {{company}}
        {{/items}}
        {{/experience}}
        {{#education}}
        {{#items}}
        {{degree}}
        {{/items}}
        {{/education}}
        {{security_clearance}}
        {{favorite_quote}}
        \\end{document}
      `;

      const analysis = extractFieldsFromTemplate(template);
      expect(analysis.hasStandardStructure).toBe(true);
      expect(analysis.detectedSections).toContain("experience");
      expect(analysis.detectedSections).toContain("education");
      expect(analysis.customVariables.map((v) => v.key)).toEqual(
        expect.arrayContaining(["security_clearance", "favorite_quote"])
      );
      // Known personal keys should not be in customVariables
      expect(analysis.customVariables.map((v) => v.key)).not.toContain("name");
      expect(analysis.customVariables.map((v) => v.key)).not.toContain("email");
    });
  });

  describe("renderTemplate", () => {
    const sampleData: ResumeData = {
      personal: {
        name: "Arthur Dent & Co.",
        title: "Senior Hitchhiker",
        email: "arthur@galaxy.org",
        phone: "+44 20 7946 0919",
        location: "London, UK",
        website: "https://dontpanic.org",
        linkedin: "linkedin.com/in/arthurdent",
        github: "github.com/arthurdent",
        summary: "Always knows where his towel is. 100% reliable.",
      },
      experience: [
        {
          id: "exp-1",
          role: "Lead Explorer",
          company: "Megadodo Publications",
          location: "Ursa Minor Beta",
          startDate: "1978",
          endDate: "Present",
          bullets: [
            "Contributed to 42 editions of the Guide.",
            "Tested tea substitutes across 5 star systems.",
          ],
        },
      ],
      education: [
        {
          id: "edu-1",
          degree: "B.A. in Earth Sciences",
          institution: "University of Cottington",
          location: "UK",
          startDate: "1970",
          endDate: "1974",
          details: "Specialized in sandwiches and tea.",
        },
      ],
      projects: [
        {
          id: "proj-1",
          name: "Heart of Gold",
          technologies: "Infinite Improbability Drive",
          link: "https://gold.ship",
          bullets: ["Crossed the galaxy in 0.00001 seconds."],
        },
      ],
      skills: [
        {
          id: "skill-1",
          category: "Languages",
          skills: "English, Vogon Poetry (Elementary)",
        },
      ],
      customSections: [
        {
          id: "cs-1",
          title: "Awards",
          content: "Order of the Babel Fish",
          bullets: ["First class honorary distinction"],
        },
      ],
      customVariables: {
        clearance_level: "Top Secret 42",
      },
    };

    it("renders scalar values with proper escaping", () => {
      const template = `\\textbf{{{name}}} - {{summary}} - Level: {{clearance_level}}`;
      const rendered = renderTemplate(template, sampleData);
      expect(rendered).toContain("\\textbf{Arthur Dent \\& Co.}");
      expect(rendered).toContain("Always knows where his towel is. 100\\% reliable.");
      expect(rendered).toContain("Level: Top Secret 42");
    });

    it("renders experience repeating items and bullets", () => {
      const template = `
{{#experience}}
\\section{Experience}
{{#items}}
\\textbf{{{role}}} at \\textit{{{company}}} ({{startDate}} -- {{endDate}})
{{#highlights}}
\\begin{itemize}
{{#bullets}}
  \\item {{bullet}}
{{/bullets}}
\\end{itemize}
{{/highlights}}
{{/items}}
{{/experience}}
      `;
      const rendered = renderTemplate(template, sampleData);
      expect(rendered).toContain("\\textbf{Lead Explorer} at \\textit{Megadodo Publications}");
      expect(rendered).toContain("\\item Contributed to 42 editions of the Guide.");
      expect(rendered).toContain("\\item Tested tea substitutes across 5 star systems.");
    });

    it("renders education, projects, skills, and custom sections", () => {
      const template = `
{{#education}}
{{#items}}
{{degree}} from {{institution}}
{{/items}}
{{/education}}

{{#projects}}
{{#items}}
Project: {{name}} [{{technologies}}]
{{#highlights}}
{{#bullets}}
* {{bullet}}
{{/bullets}}
{{/highlights}}
{{/items}}
{{/projects}}

{{#skills}}
{{#items}}
{{category}}: {{skills}}
{{/items}}
{{/skills}}

{{#customSections}}
\\section{{{title}}}
{{content}}
{{#highlights}}
{{#bullets}}
- {{bullet}}
{{/bullets}}
{{/highlights}}
{{/customSections}}
      `;

      const rendered = renderTemplate(template, sampleData);
      expect(rendered).toContain("B.A. in Earth Sciences from University of Cottington");
      expect(rendered).toContain("Project: Heart of Gold [Infinite Improbability Drive]");
      expect(rendered).toContain("* Crossed the galaxy in 0.00001 seconds.");
      expect(rendered).toContain("Languages: English, Vogon Poetry (Elementary)");
      expect(rendered).toContain("\\section{Awards}");
      expect(rendered).toContain("Order of the Babel Fish");
      expect(rendered).toContain("- First class honorary distinction");
    });

    it("renders each of the built-in templates without remaining raw curly tags", () => {
      const defaultData = getDefaultResumeData("Jane Doe");
      expect(BUILTIN_TEMPLATES.length).toBe(3);

      for (const tpl of BUILTIN_TEMPLATES) {
        const rendered = renderTemplate(tpl.content, defaultData);
        expect(rendered).toContain("\\begin{document}");
        expect(rendered).toContain("\\end{document}");
        expect(rendered).toContain("Jane Doe");
        expect(rendered).toContain("Acme Cloud Systems");
        expect(rendered).toContain("University of Washington");
        // No unparsed {{...}} tags left
        expect(rendered).not.toMatch(/\{\{[a-zA-Z0-9_#^/]+\}\}/);
      }
    });

    it("successfully compiles each rendered builtin template to PDF via pdflatex", async () => {
      const { execSync } = await import("child_process");
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      let pdflatexAvailable = false;
      try {
        execSync("pdflatex --version", { stdio: "ignore" });
        pdflatexAvailable = true;
      } catch {
        pdflatexAvailable = false;
      }

      if (!pdflatexAvailable) {
        // Skip pdflatex compilation execution when not installed (e.g. CI environments)
        return;
      }

      const defaultData = getDefaultResumeData("Alex Morgan");

      for (const tpl of BUILTIN_TEMPLATES) {
        const rendered = renderTemplate(tpl.content, defaultData);
        const tempTexPath = path.join(os.tmpdir(), `test_compile_${tpl.id}.tex`);
        fs.writeFileSync(tempTexPath, rendered);

        expect(() => {
          execSync(
            `pdflatex -interaction=nonstopmode -halt-on-error -output-directory=${os.tmpdir()} ${tempTexPath}`,
            { stdio: "pipe" }
          );
        }).not.toThrow();

        const pdfPath = path.join(os.tmpdir(), `test_compile_${tpl.id}.pdf`);
        expect(fs.existsSync(pdfPath)).toBe(true);
      }
    });

    it("evaluates conditional blocks properly when empty", () => {
      const dataWithoutSummary: ResumeData = {
        ...sampleData,
        personal: {
          ...sampleData.personal,
          summary: "",
        },
      };

      const template = `
{{#summary}}
\\section{Summary}
{{summary}}
{{/summary}}
Name: {{name}}
      `;

      const rendered = renderTemplate(template, dataWithoutSummary);
      expect(rendered).not.toContain("\\section{Summary}");
      expect(rendered).toContain("Name: Arthur Dent \\& Co.");
    });

    it("reorders template sections according to sectionOrder", () => {
      const template = `
\\begin{document}
{{#experience}}
\\section{Experience}
Work details
{{/experience}}

{{#education}}
\\section{Education}
School details
{{/education}}

{{#skills}}
\\section{Skills}
Skill details
{{/skills}}
\\end{document}
      `;

      // Reorder Education before Experience, and Skills before Experience
      const reordered = reorderTemplateSections(template, [
        "education",
        "skills",
        "experience",
      ]);

      const eduIdx = reordered.indexOf("{{#education}}");
      const skillsIdx = reordered.indexOf("{{#skills}}");
      const expIdx = reordered.indexOf("{{#experience}}");

      expect(eduIdx).toBeLessThan(skillsIdx);
      expect(skillsIdx).toBeLessThan(expIdx);
    });

    it("renders resume template with customized section order", () => {
      const template = `
{{#experience}}
\\section{Experience}
{{#items}}
{{role}} at {{company}}
{{/items}}
{{/experience}}

{{#education}}
\\section{Education}
{{#items}}
{{degree}}
{{/items}}
{{/education}}
      `;

      const dataWithOrder: ResumeData = {
        ...sampleData,
        sectionOrder: ["personal", "education", "experience", "projects", "skills"],
      };

      const rendered = renderTemplate(template, dataWithOrder);
      const eduPos = rendered.indexOf("\\section{Education}");
      const expPos = rendered.indexOf("\\section{Experience}");

      expect(eduPos).toBeGreaterThan(-1);
      expect(expPos).toBeGreaterThan(-1);
      expect(eduPos).toBeLessThan(expPos);
    });
  });

  describe("convertRawLatexToTemplate", () => {
    it("extracts author name, email, and phone from raw LaTeX", () => {
      const rawTex = `
\\documentclass{article}
\\begin{document}
\\begin{center}
{\\Huge \\scshape Jane Doe} \\\\
123 Main St, Boston, MA $|$ (555) 123-4567 $|$ \\href{mailto:jane.doe@example.com}{jane.doe@example.com} $|$ github.com/janedoe
\\end{center}
\\section{Experience}
Software engineer at Tech Inc.
\\end{document}
      `;

      const result = convertRawLatexToTemplate(rawTex);
      expect(result.extractedData.personal?.name).toBe("Jane Doe");
      expect(result.extractedData.personal?.email).toBe("jane.doe@example.com");
      expect(result.extractedData.personal?.phone).toBe("(555) 123-4567");
      expect(result.extractedData.personal?.github).toBe("github.com/janedoe");
      expect(result.templateContent).toContain("{{name}}");
      expect(result.templateContent).toContain("{{phone}}");
    });

    it("returns template content unmodified if already parameterized", () => {
      const parameterized = `\\documentclass{article}\\begin{document}{{name}}\\end{document}`;
      const result = convertRawLatexToTemplate(parameterized);
      expect(result.templateContent).toBe(parameterized);
    });

    it("only reports fields it actually found", () => {
      const result = convertRawLatexToTemplate(
        "\\documentclass{article}\\begin{document}\\section*{Experience}\\end{document}"
      );
      expect(result.extractedData).toEqual({});
    });

    it("parameterizes every GitHub/LinkedIn occurrence without doubling the host", () => {
      const raw =
        "\\href{https://github.com/janedoe}{github.com/janedoe} | \\href{https://www.linkedin.com/in/jane-doe/}{linkedin.com/in/jane-doe}";
      const { templateContent, extractedData } = convertRawLatexToTemplate(raw);
      expect(extractedData.personal).toEqual({
        github: "github.com/janedoe",
        linkedin: "linkedin.com/in/jane-doe",
      });
      expect(templateContent).toBe(
        "\\href{https://{{github}}}{{{github}}} | \\href{https://{{linkedin}}}{{{linkedin}}}"
      );
      const data = getEmptyResumeData();
      data.personal = { ...data.personal, ...extractedData.personal, name: "Jane" };
      expect(renderTemplate(templateContent, data)).toBe(
        "\\href{https://github.com/janedoe}{github.com/janedoe} | \\href{https://linkedin.com/in/jane-doe}{linkedin.com/in/jane-doe}"
      );
    });
  });

  describe("context-aware escaping", () => {
    it("escapes URL targets differently from display text", () => {
      const data = getEmptyResumeData();
      data.personal.website = "example.com/~me/my_site?a=1&b=2#top";
      const rendered = renderTemplate("\\href{{{website}}}{{{website}}}", data);
      expect(rendered).toBe(
        "\\href{https://example.com/~me/my_site?a=1&b=2\\#top}{example.com/\\textasciitilde{}me/my\\_site?a=1\\&b=2\\#top}"
      );
    });

    it("does not double the scheme when the user enters a full URL", () => {
      const data = getEmptyResumeData();
      data.personal.github = "https://github.com/me";
      expect(renderTemplate("\\href{https://{{github}}}{x}", data)).toBe("\\href{https://github.com/me}{x}");
      data.personal.email = "a_b@example.com";
      expect(renderTemplate("\\href{mailto:{{email}}}{{{email}}}", data)).toBe(
        "\\href{mailto:a_b@example.com}{a\\_b@example.com}"
      );
    });

    it("percent-encodes characters that would break the \\href argument", () => {
      expect(escapeLatexUrl("https://x.com/{a} b\\c%")).toBe("https://x.com/\\%7Ba\\%7D\\%20b\\%5Cc\\%");
    });

    it("escapes custom template variables", () => {
      const data = getEmptyResumeData();
      data.customVariables = { award: "Top 5% & #1" };
      expect(renderTemplate("Award: {{award}}", data)).toBe("Award: Top 5\\% \\& \\#1");
    });

    it("keeps $-patterns in user text literal", () => {
      const data = getEmptyResumeData();
      data.experience = [
        { id: "e1", role: "Dev", company: "Co", bullets: ["Saved $'500k and $&"] },
      ];
      const rendered = renderTemplate("{{#experience}}{{#items}}{{#bullets}}* {{bullet}}{{/bullets}}{{/items}}{{/experience}}", data);
      expect(rendered).toBe("* Saved \\$'500k and \\$\\&");
    });

    it("renders an entry whose bullets are all empty instead of dropping it", () => {
      const data = getEmptyResumeData();
      data.experience = [{ id: "e1", role: "Engineer", company: "Acme", bullets: [""] }];
      const rendered = renderTemplate(BUILTIN_TEMPLATES[0].content, data);
      expect(rendered).toContain("\\textbf{Engineer}");
      expect(rendered).not.toContain("\\begin{itemize}[noitemsep,topsep=1pt]\n\\end{itemize}");
    });
  });

  describe("normalizeResumeData", () => {
    it("fills in missing sections from partial or legacy JSON", () => {
      const data = normalizeResumeData({ personal: { name: "John" } });
      expect(data.personal.name).toBe("John");
      expect(data.experience).toEqual([]);
      expect(data.customSections).toEqual([]);
      expect(data.customVariables).toEqual({});
    });

    it("drops malformed values and assigns missing ids", () => {
      const data = normalizeResumeData({
        experience: [{ role: "Dev", bullets: ["a", 3, null] }],
        customVariables: { ok: "yes", bad: 5 },
        sourceEditedManually: true,
      });
      expect(data.experience[0].id).toMatch(/^exp-/);
      expect(data.experience[0].bullets).toEqual(["a"]);
      expect(data.customVariables).toEqual({ ok: "yes" });
      expect(data.sourceEditedManually).toBe(true);
      expect(normalizeResumeData("not json").personal.name).toBe("");
    });
  });
});
