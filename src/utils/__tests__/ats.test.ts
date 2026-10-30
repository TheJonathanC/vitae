import { describe, it, expect } from "vitest";
import { checkLatexSource, checkPdfText, hasPhoneNumber, stripComments, summarizeAts, AtsFinding } from "../ats";
import { joinTextItems } from "../pdfRenderer";
import { BUILTIN_TEMPLATES } from "../templatePresets";

const status = (findings: AtsFinding[], id: string) => findings.find((f) => f.id === id)?.status;

const GOOD_TEXT = `Jane Doe
jane@example.com | +1 (555) 019-2834 | Austin, TX
SUMMARY
Backend engineer.
EXPERIENCE
Backend Engineer, Acme  Jan 2022 - Present
Cut latency by 40% across the billing API.
EDUCATION
BSc Computer Science, State University  2014 - 2018
SKILLS
Go, SQL, Kubernetes ${"filler ".repeat(40)}`;

describe("stripComments", () => {
  it("removes comments but keeps escaped percent signs", () => {
    expect(stripComments("a % hidden\nb 50\\% off % gone")).toBe("a \nb 50\\% off ");
  });
});

describe("checkLatexSource", () => {
  const base = "\\documentclass{article}\n\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\begin{document}Hi\\end{document}";

  it("passes a plain single-column document", () => {
    expect(checkLatexSource(base).every((f) => f.status === "pass")).toBe(true);
  });

  it("warns when the text mapping is missing, ignoring one that is commented out", () => {
    expect(status(checkLatexSource("\\begin{document}x\\end{document}"), "unicode-map")).toBe("warn");
    expect(status(checkLatexSource("% \\pdfgentounicode=1\n\\begin{document}"), "unicode-map")).toBe("warn");
  });

  it("flags columns, images, icon fonts and tables", () => {
    expect(status(checkLatexSource(base + "\\usepackage{multicol}"), "columns")).toBe("warn");
    expect(status(checkLatexSource(base + "\\twocolumn"), "columns")).toBe("warn");
    expect(status(checkLatexSource(base + "\\begin{minipage}{.5\\textwidth}a\\end{minipage}\\begin{minipage}{.5\\textwidth}b\\end{minipage}"), "columns")).toBe("warn");
    expect(status(checkLatexSource(base + "\\includegraphics{x.png}"), "graphics")).toBe("warn");
    expect(status(checkLatexSource(base + "\\usepackage{fontawesome5}"), "graphics")).toBe("warn");
    expect(status(checkLatexSource(base + "\\begin{tabular*}{\\textwidth}{l}"), "tables")).toBe("warn");
  });

  it("doesn't ask XeLaTeX templates for a pdfTeX text mapping", () => {
    expect(status(checkLatexSource("\\usepackage{fontspec}\\begin{document}x"), "unicode-map")).toBe("pass");
    expect(status(checkLatexSource("% !TEX program = xelatex\n\\begin{document}x"), "unicode-map")).toBe("pass");
    expect(status(checkLatexSource("% \\usepackage{fontspec}\n\\begin{document}x"), "unicode-map")).toBe("warn");
  });

  it("does not flag things that are only in comments", () => {
    expect(status(checkLatexSource(base + "\n% \\includegraphics{x.png}"), "graphics")).toBe("pass");
  });

  it("passes every built-in template", () => {
    for (const template of BUILTIN_TEMPLATES) {
      const findings = checkLatexSource(template.content);
      expect(findings.filter((f) => f.status !== "pass").map((f) => `${template.name}: ${f.id}`)).toEqual([]);
    }
  });
});

describe("hasPhoneNumber", () => {
  it("accepts common formats", () => {
    for (const phone of ["+1 (555) 019-2834", "555-019-2834", "(555) 019 2834", "+44 20 7946 0958", "5550192834"]) {
      expect(hasPhoneNumber(`Call ${phone} today`)).toBe(true);
    }
  });
  it("doesn't mistake dates for phone numbers", () => {
    for (const text of ["2014 - 2018", "Jan 2022 - Present", "2018 2019 2020", "2014 \u2013 2018 and 2020 - 2022", "12345"]) {
      expect(hasPhoneNumber(text)).toBe(false);
    }
  });
});

describe("checkPdfText", () => {
  it("passes a well-formed resume", () => {
    const findings = checkPdfText(GOOD_TEXT, 1, { name: "Jane Doe" });
    expect(findings.filter((f) => f.status !== "pass")).toEqual([]);
    expect(summarizeAts(findings)).toMatchObject({ verdict: "Ready", score: 100 });
  });

  it("fails when nothing can be extracted", () => {
    expect(status(checkPdfText("", 1), "readable")).toBe("fail");
    expect(status(checkPdfText("a few words only", 1), "readable")).toBe("fail");
    expect(status(checkPdfText("x".repeat(120), 1), "readable")).toBe("warn");
  });

  it("detects garbled text and ligatures", () => {
    expect(status(checkPdfText(GOOD_TEXT + " \uE0A1", 1), "garbled")).toBe("fail");
    expect(status(checkPdfText(GOOD_TEXT + " (cid:123)", 1), "garbled")).toBe("fail");
    expect(status(checkPdfText(GOOD_TEXT + " e\uFB03cient", 1), "garbled")).toBe("warn");
  });

  it("requires an email and notices a missing phone", () => {
    const noContact = GOOD_TEXT.replace("jane@example.com | +1 (555) 019-2834", "");
    expect(status(checkPdfText(noContact, 1), "email")).toBe("fail");
    expect(status(checkPdfText(noContact, 1), "phone")).toBe("warn");
    expect(status(checkPdfText(GOOD_TEXT.replace("+1 (555) 019-2834", ""), 1), "phone")).toBe("warn");
  });

  it("checks that the name comes first, only when a name is known", () => {
    const moved = "jane@example.com\n" + "x".repeat(300) + "\nJane Doe\nEXPERIENCE\nEDUCATION\nSKILLS 2020 2021";
    expect(status(checkPdfText(moved, 1, { name: "Jane Doe" }), "name")).toBe("warn");
    expect(status(checkPdfText(moved, 1), "name")).toBeUndefined();
  });

  it("looks for standard headings and names the missing ones", () => {
    const text = GOOD_TEXT.replace("EXPERIENCE", "WHERE I'VE BEEN").replace("SKILLS", "STUFF");
    const heading = checkPdfText(text, 1).find((f) => f.id === "headings")!;
    expect(heading.status).toBe("warn");
    expect(heading.detail).toContain("Experience");
    expect(heading.detail).toContain("Skills");
    expect(heading.detail).not.toContain("Education");
    expect(status(checkPdfText(GOOD_TEXT.replace("EXPERIENCE", "Work Experience"), 1), "headings")).toBe("pass");
    expect(status(checkPdfText(GOOD_TEXT.replace("SKILLS", "Skills & Competencies"), 1), "headings")).toBe("pass");
    expect(status(checkPdfText(GOOD_TEXT.replace("EDUCATION", "Education and Training"), 1), "headings")).toBe("pass");
    expect(status(checkPdfText(GOOD_TEXT.replace("SKILLS", "Core Competencies"), 1), "headings")).toBe("pass");
    // A sentence that starts with a keyword is not a heading.
    const sentence = GOOD_TEXT.replace("EXPERIENCE", "WHERE I'VE BEEN\nExperience with Kubernetes");
    expect(status(checkPdfText(sentence, 1), "headings")).toBe("warn");
  });

  it("wants dates and a sensible length", () => {
    expect(status(checkPdfText(GOOD_TEXT.replace(/20\d\d|19\d\d/g, "then"), 1), "dates")).toBe("warn");
    expect(status(checkPdfText(GOOD_TEXT, 2), "length")).toBe("pass");
    expect(status(checkPdfText(GOOD_TEXT, 3), "length")).toBe("warn");
  });
});

describe("summarizeAts", () => {
  const f = (s: AtsFinding["status"]): AtsFinding => ({ id: s, status: s, title: "", detail: "" });
  it("counts warnings as half and any failure as not ready", () => {
    expect(summarizeAts([f("pass"), f("warn")])).toMatchObject({ score: 75, verdict: "Needs attention", passed: 1, total: 2 });
    expect(summarizeAts([f("pass"), f("fail")])).toMatchObject({ score: 50, verdict: "Not ready" });
    expect(summarizeAts([])).toMatchObject({ score: 0, total: 0 });
  });
});

describe("joinTextItems", () => {
  it("starts a new line when the vertical position changes", () => {
    const items = [
      { str: "Jane", transform: [1, 0, 0, 1, 10, 700] },
      { str: "Doe", transform: [1, 0, 0, 1, 40, 700] },
      { str: "jane@example.com", transform: [1, 0, 0, 1, 10, 680] },
    ];
    expect(joinTextItems(items)).toBe("Jane Doe\njane@example.com");
  });
  it("ignores empty runs and tidies spaces", () => {
    expect(joinTextItems([{ str: "a" }, { str: "" }, { str: " b" }])).toBe("a b");
  });
});
