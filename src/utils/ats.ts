/**
 * Checks for applicant tracking systems (ATS): what the LaTeX source does that
 * parsers struggle with, and what a parser would actually read out of the PDF.
 * Pure functions so they can be tested without a PDF.
 */

export type AtsStatus = "pass" | "warn" | "fail";

export interface AtsFinding {
  id: string;
  status: AtsStatus;
  title: string;
  detail: string;
}

export interface AtsPerson {
  name?: string;
  email?: string;
}

const finding = (id: string, status: AtsStatus, title: string, detail: string): AtsFinding => ({
  id,
  status,
  title,
  detail,
});

/** Drops LaTeX comments (an unescaped % to the end of the line). */
export function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/(?<!\\)%.*$/, ""))
    .join("\n");
}

export function checkLatexSource(source: string): AtsFinding[] {
  const code = stripComments(source);
  const findings: AtsFinding[] = [];

  // XeLaTeX (which Vitae uses for fontspec templates) writes Unicode text by itself.
  const unicodeEngine =
    /%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*xe(?:la)?tex/i.test(source) ||
    /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\bfontspec\b[^}]*\}/.test(code);
  findings.push(
    unicodeEngine
      ? finding("unicode-map", "pass", "Text is copyable", "XeLaTeX writes Unicode text, so ligatures and accents read correctly.")
      : /\\pdfgentounicode\s*=\s*1/.test(code)
      ? finding("unicode-map", "pass", "Text is copyable", "The PDF embeds a text mapping, so ligatures and accents read correctly.")
      : finding(
          "unicode-map",
          "warn",
          "Text may not copy cleanly",
          "Add \\input{glyphtounicode} and \\pdfgentounicode=1 before \\begin{document} so ligatures like \"fi\" and accented letters are read correctly."
        )
  );

  const minipages = (code.match(/\\begin\{minipage\}/g) ?? []).length;
  findings.push(
    /\\twocolumn|\\begin\{multicols\*?\}|\\usepackage(\[[^\]]*\])?\{multicol\}/.test(code) || minipages >= 2
      ? finding("columns", "warn", "Layout uses columns", "Many parsers read columns line by line across the page and scramble the order. A single column is safest.")
      : finding("columns", "pass", "Single-column layout", "Text flows top to bottom, the order parsers expect.")
  );

  findings.push(
    /\\includegraphics|\\includepdf|\\begin\{tikzpicture\}|\\usepackage(\[[^\]]*\])?\{(fontawesome5?|academicons|tcolorbox)\}/.test(code)
      ? finding("graphics", "warn", "Images or icons found", "Parsers can't read images, and icon fonts turn into stray characters. Use plain text for anything that matters.")
      : finding("graphics", "pass", "No images or icons", "Everything is plain text.")
  );

  findings.push(
    /\\begin\{(tabular\*?|tabularx|longtable)\}/.test(code)
      ? finding("tables", "warn", "Tables found", "Some parsers read tables cell by cell and mix up the order. Prefer simple lines with \\hfill for dates.")
      : finding("tables", "pass", "No tables", "Content isn't locked inside table cells.")
  );

  return findings;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_CANDIDATE = /\+?\(?\d[\d\s().-]{7,}\d/g;
const ONLY_YEARS = /^(?:(?:19|20)\d{2}[\s\u2013-]*)+$/;

/** A phone number has 10 to 15 digits; runs of years like "2014 - 2018" don't count. */
export function hasPhoneNumber(text: string): boolean {
  return (text.match(PHONE_CANDIDATE) ?? []).some((candidate) => {
    const digits = candidate.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 15 && !ONLY_YEARS.test(candidate.trim());
  });
}
const YEAR = /\b(19|20)\d{2}\b/g;
// Private-use area (icon fonts), the replacement character and unresolved font glyphs.
const GARBLED = /[\uE000-\uF8FF\uFFFD]|\(cid:\d+\)/;
const LIGATURES = /[\uFB00-\uFB06]/;

const HEADING_MODIFIERS = "professional|work|relevant|technical|core|key|employment|academic|additional";

/**
 * A heading is a short line that is a section keyword, optionally with a modifier in
 * front ("Technical Skills") or an "& more" after it ("Skills & Competencies"). A
 * sentence that merely starts with the word ("Experience with Kubernetes") isn't one.
 */
function hasHeading(text: string, keywords: string[]): boolean {
  const pattern = new RegExp(
    `^\\s*(?:(?:${HEADING_MODIFIERS})\\s+)?(?:${keywords.join("|")})(?:\\s*(?:&|and|/)\\s*[a-z][a-z ]{0,30})?\\s*:?\\s*$`,
    "im"
  );
  return pattern.test(text);
}

export function checkPdfText(text: string, pageCount: number, person: AtsPerson = {}): AtsFinding[] {
  const findings: AtsFinding[] = [];
  const length = text.replace(/\s/g, "").length;

  if (length < 50) {
    findings.push(
      finding("readable", "fail", "Text can't be read", "Almost no text could be extracted. A parser would see an empty resume.")
    );
  } else if (length < 300) {
    findings.push(finding("readable", "warn", "Very little text", "Only a small amount of text could be extracted. Check that the resume has its content."));
  } else {
    findings.push(finding("readable", "pass", "Text can be read", `${length.toLocaleString()} characters extracted.`));
  }

  if (GARBLED.test(text)) {
    findings.push(finding("garbled", "fail", "Garbled characters", "Some characters came out as symbols or boxes, often from icon fonts or missing text mapping. A parser would read them as noise."));
  } else if (LIGATURES.test(text)) {
    findings.push(finding("garbled", "warn", "Ligatures in the text", "Letter pairs like \"fi\" were extracted as single symbols, which can break keyword matching. Enable the text mapping in the LaTeX source."));
  } else {
    findings.push(finding("garbled", "pass", "No garbled characters", "Letters and punctuation extract cleanly."));
  }

  findings.push(
    EMAIL.test(text)
      ? finding("email", "pass", "Email found", "A parser can find your email address.")
      : finding("email", "fail", "No email found", "Add an email address. Recruiters and ATS need it to contact you.")
  );
  findings.push(
    hasPhoneNumber(text)
      ? finding("phone", "pass", "Phone number found", "A parser can find your phone number.")
      : finding("phone", "warn", "No phone number found", "Add a phone number if you're comfortable sharing one.")
  );

  if (person.name?.trim()) {
    const top = text.slice(0, 250).toLowerCase();
    findings.push(
      top.includes(person.name.trim().toLowerCase())
        ? finding("name", "pass", "Name at the top", "Your name is the first thing a parser reads.")
        : finding("name", "warn", "Name isn't at the top", "A parser takes the first lines as your name. Put it first, as plain text.")
    );
  }

  const missing: string[] = [];
  if (!hasHeading(text, ["experience", "employment history", "work history", "employment"])) missing.push("Experience");
  if (!hasHeading(text, ["education"])) missing.push("Education");
  if (!hasHeading(text, ["skills", "competencies"])) missing.push("Skills");
  findings.push(
    missing.length === 0
      ? finding("headings", "pass", "Standard section headings", "Experience, Education and Skills are labelled the way parsers expect.")
      : finding("headings", "warn", "Unusual or missing headings", `Couldn't find a plain heading for: ${missing.join(", ")}. Parsers sort content by headings like these.`)
  );

  findings.push(
    (text.match(YEAR) ?? []).length >= 2
      ? finding("dates", "pass", "Dates found", "Parsers use dates to work out your experience.")
      : finding("dates", "warn", "Few or no dates", "Add start and end dates to your roles and education.")
  );

  findings.push(
    pageCount <= 2
      ? finding("length", "pass", "Sensible length", pageCount === 1 ? "One page." : "Two pages.")
      : finding("length", "warn", "Long resume", `${pageCount} pages. Most recruiters and parsers expect one or two.`)
  );

  return findings;
}

export interface AtsSummary {
  passed: number;
  total: number;
  /** 0 to 100; warnings count half. */
  score: number;
  verdict: "Ready" | "Needs attention" | "Not ready";
}

export function summarizeAts(findings: AtsFinding[]): AtsSummary {
  const passed = findings.filter((f) => f.status === "pass").length;
  const warns = findings.filter((f) => f.status === "warn").length;
  const fails = findings.filter((f) => f.status === "fail").length;
  const total = findings.length;
  const score = total === 0 ? 0 : Math.round(((passed + warns * 0.5) / total) * 100);
  return {
    passed,
    total,
    score,
    verdict: fails > 0 ? "Not ready" : warns > 0 ? "Needs attention" : "Ready",
  };
}
