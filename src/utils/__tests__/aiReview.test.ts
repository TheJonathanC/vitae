import { describe, it, expect } from "vitest";
import { applyReview, collectBullets, makeReviewRows } from "../aiReview";
import { newFactsIn } from "../targeting";
import { getEmptyResumeData } from "../templateEngine";
import { ResumeData } from "../../types";

describe("newFactsIn", () => {
  it("flags numbers and tools that weren't in the original", () => {
    expect(newFactsIn("Improved the API", "Cut API latency by 40%")).toEqual(["40%"]);
    expect(newFactsIn("Built the backend", "Built the backend in Python on AWS")).toEqual(expect.arrayContaining(["python", "aws"]));
  });

  it("allows rewording, reordering and the same numbers and tools", () => {
    expect(newFactsIn("Led a team of 5 building Python services", "Led 5 engineers building Python services")).toEqual([]);
    expect(newFactsIn("Cut latency 40% using Postgres", "Reduced latency by 40% with PostgreSQL")).toEqual([]);
    expect(newFactsIn("Worked on ML models", "Developed machine learning models")).toEqual([]);
  });

  it("doesn't flag everyday business words", () => {
    expect(newFactsIn("Sped up the checkout", "Improved performance and scalability of the checkout")).toEqual([]);
    expect(newFactsIn("Ran standups", "Led agile ceremonies with stakeholder management")).toEqual([]);
  });

  it("treats decimals and trailing punctuation sensibly", () => {
    expect(newFactsIn("Saved $2.5M.", "Saved $2.5M annually")).toEqual([]);
    expect(newFactsIn("Saved money", "Saved $2.5M")).toEqual(["2.5"]);
  });
});

const data: ResumeData = {
  ...getEmptyResumeData(),
  experience: [
    { id: "a", role: "Eng", company: "Acme", bullets: ["Built APIs", "", "Ran clusters"] },
    { id: "b", role: "Intern", company: "Beta", bullets: ["Fixed bugs"] },
  ],
  projects: [{ id: "p", name: "Vitae", bullets: ["Shipped it"] }],
};

describe("collectBullets", () => {
  it("lists non-empty bullets with position-based ids", () => {
    expect(collectBullets(data)).toEqual([
      { id: "exp-0-0", text: "Built APIs" },
      { id: "exp-0-2", text: "Ran clusters" },
      { id: "exp-1-0", text: "Fixed bugs" },
      { id: "proj-0-0", text: "Shipped it" },
    ]);
  });
});

describe("makeReviewRows", () => {
  const asked = collectBullets(data);

  it("keeps only changed bullets, ticking safe ones and leaving flagged ones unticked", () => {
    const rows = makeReviewRows(asked, [
      { id: "exp-0-0", text: "Designed and shipped APIs" },
      { id: "exp-0-2", text: "Ran clusters" },
      { id: "exp-1-0", text: "Fixed 12 bugs in Kubernetes" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["exp-0-0", "exp-1-0"]);
    expect(rows[0]).toMatchObject({ use: true, flags: [] });
    // Naming a specific technology the original didn't is a new claim, so it needs a deliberate tick.
    const rest = makeReviewRows(asked, [{ id: "exp-0-0", text: "Built REST APIs" }]);
    expect(rest[0]).toMatchObject({ use: false, flags: ["rest api"] });
    expect(rows[1].use).toBe(false);
    expect(rows[1].flags).toEqual(expect.arrayContaining(["12", "kubernetes"]));
  });

  it("ignores answers for bullets that weren't asked about or are missing", () => {
    expect(makeReviewRows(asked, [{ id: "exp-9-9", text: "Ghost" }])).toEqual([]);
    expect(makeReviewRows(asked, [])).toEqual([]);
  });
});

describe("applyReview", () => {
  const rows = makeReviewRows(collectBullets(data), [
    { id: "exp-0-0", text: "Designed and shipped APIs" },
    { id: "proj-0-0", text: "Shipped Vitae to users" },
  ]);

  it("replaces only ticked bullets, leaving the rest and the input untouched", () => {
    rows[1].use = false;
    const next = applyReview(data, rows);
    expect(next.experience[0].bullets).toEqual(["Designed and shipped APIs", "", "Ran clusters"]);
    expect(next.projects[0].bullets).toEqual(["Shipped it"]);
    expect(data.experience[0].bullets[0]).toBe("Built APIs");
  });

  it("skips a row if the bullet changed since the AI saw it", () => {
    const edited = { ...data, experience: [{ ...data.experience[0], bullets: ["Different", "", "Ran clusters"] }, data.experience[1]] };
    expect(applyReview(edited, [{ ...rows[0], use: true }]).experience[0].bullets[0]).toBe("Different");
  });

  it("ignores malformed ids", () => {
    expect(applyReview(data, [{ id: "../x", original: "a", suggestion: "b", flags: [], use: true }])).toEqual(data);
  });
});
