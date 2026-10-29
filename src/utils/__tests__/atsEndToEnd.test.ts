import { describe, it, expect, vi } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { BUILTIN_TEMPLATES } from "../templatePresets";
import { getDefaultResumeData, renderTemplate } from "../templateEngine";
import { checkLatexSource, checkPdfText } from "../ats";
import { extractPdfText } from "../pdfRenderer";

// In the browser the worker is a served URL; here pdf.js needs the file itself.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", async () => {
  const { pathToFileURL } = await import("url");
  const { resolve } = await import("path");
  return { default: pathToFileURL(resolve("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href };
});

function hasPdflatex(): boolean {
  try {
    execSync("pdflatex --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasPdflatex())("built-in templates, compiled and read back like an ATS would", () => {
  for (const template of BUILTIN_TEMPLATES) {
    it(`${template.name} passes every ATS check`, async () => {
      const data = getDefaultResumeData("Alex Morgan");
      const source = renderTemplate(template.content, data);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitae-ats-"));
      const tex = path.join(dir, "resume.tex");
      fs.writeFileSync(tex, source);
      execSync(`pdflatex -interaction=nonstopmode -halt-on-error -output-directory=${dir} ${tex}`, { stdio: "pipe" });
      const base64 = fs.readFileSync(path.join(dir, "resume.pdf")).toString("base64");

      const { text, pages } = await extractPdfText(base64);
      const findings = [...checkPdfText(text, pages, { name: data.personal.name }), ...checkLatexSource(source)];
      const problems = findings.filter((f) => f.status !== "pass").map((f) => `${f.id}: ${f.detail}`);
      expect(problems, `extracted text:\n${text.slice(0, 600)}`).toEqual([]);
      fs.rmSync(dir, { recursive: true, force: true });
    }, 60000);
  }
});
