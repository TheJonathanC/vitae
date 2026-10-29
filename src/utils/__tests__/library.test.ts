import { describe, it, expect } from "vitest";
import {
  buildResumeData,
  dateValue,
  defaultProfileSpec,
  emptyLibrary,
  itemKey,
  newEntriesFromResume,
  parseItem,
  parseLibrary,
  parsePerson,
  parseProfile,
  serializeItem,
  sortByRecency,
} from "../library";
import { LibraryRow, ResumeData } from "../../types";
import { getEmptyResumeData } from "../templateEngine";

const row = (id: string, kind: LibraryRow["kind"], data: object): LibraryRow => ({
  id,
  kind,
  data: JSON.stringify(data),
  created_at: "",
  updated_at: "",
});

describe("dateValue and sortByRecency", () => {
  it("reads common date formats", () => {
    expect(dateValue("Jan 2022")).toBe(2022 * 12);
    expect(dateValue("March 2021")).toBe(2021 * 12 + 2);
    expect(dateValue("03/2021")).toBe(2021 * 12 + 2);
    expect(dateValue("2019")).toBe(2019 * 12);
    expect(dateValue("sometime")).toBeNull();
    expect(dateValue(undefined)).toBeNull();
  });

  it("lists running roles first, then newest by end date, then start date", () => {
    const jobs = [
      { id: "old", startDate: "2015", endDate: "2017" },
      { id: "now", startDate: "2022", endDate: "Present" },
      { id: "mid-late", startDate: "2018", endDate: "Dec 2020" },
      { id: "mid-early", startDate: "2017", endDate: "Dec 2020" },
      { id: "open", startDate: "2020", endDate: "" },
    ];
    expect(sortByRecency(jobs).map((j) => j.id)).toEqual(["now", "open", "mid-late", "mid-early", "old"]);
  });

  it("doesn't mutate its input", () => {
    const jobs = [{ startDate: "2015" }, { startDate: "2020" }];
    sortByRecency(jobs);
    expect(jobs[0].startDate).toBe("2015");
  });
});

describe("parsing stored data", () => {
  it("fills in missing fields and ignores junk", () => {
    expect(parsePerson(null).name).toBe("");
    expect(parsePerson("not json").email).toBe("");
    expect(parsePerson(JSON.stringify({ name: "Jane", email: 5 }))).toMatchObject({ name: "Jane", email: "" });
    const exp = parseItem("experience", "e1", JSON.stringify({ role: "Dev", bullets: ["a", 7, "b"] }));
    expect(exp).toMatchObject({ id: "e1", role: "Dev", company: "", bullets: ["a", "b"] });
  });

  it("builds a library sorted newest first, ignoring unknown kinds", () => {
    const library = parseLibrary([
      row("a", "experience", { role: "Old", startDate: "2015", endDate: "2016" }),
      row("b", "experience", { role: "New", startDate: "2022", endDate: "Present" }),
      row("c", "skill", { category: "Languages", skills: "Go, SQL" }),
      { ...row("d", "experience", {}), kind: "hobby" as never },
    ]);
    expect(library.experience.map((e) => e.role)).toEqual(["New", "Old"]);
    expect(library.skill).toHaveLength(1);
  });

  it("round-trips an item without its id", () => {
    const item = parseItem("project", "p1", JSON.stringify({ name: "Vitae", bullets: ["x"] }));
    const json = serializeItem(item);
    expect(JSON.parse(json).id).toBeUndefined();
    expect(parseItem("project", "p1", json)).toEqual(item);
  });

  it("parses profiles", () => {
    const profile = parseProfile({
      id: "p",
      name: "Backend",
      data: JSON.stringify({ headline: "Backend Engineer", experienceIds: ["a"] }),
      created_at: "",
      updated_at: "",
    });
    expect(profile).toMatchObject({ id: "p", name: "Backend", headline: "Backend Engineer", experienceIds: ["a"], skillIds: [] });
  });
});

describe("buildResumeData", () => {
  const library = parseLibrary([
    row("e1", "experience", { role: "Engineer", company: "Acme", startDate: "2022", endDate: "Present", bullets: ["Built APIs"] }),
    row("e2", "experience", { role: "Intern", company: "Beta", startDate: "2020", endDate: "2021", bullets: ["Wrote tests"] }),
    row("p1", "project", { name: "Vitae", bullets: ["Shipped"] }),
    row("s1", "skill", { category: "Languages", skills: "Go, SQL" }),
  ]);
  const person = parsePerson(JSON.stringify({ name: "Jane Doe", email: "jane@example.com", title: "Developer", summary: "General." }));

  it("combines shared personal info with the profile's own headline and summary", () => {
    const data = buildResumeData(person, library, {
      ...defaultProfileSpec(library),
      headline: "Backend Engineer",
      summary: "Backend focus.",
    });
    expect(data.personal).toMatchObject({ name: "Jane Doe", email: "jane@example.com", title: "Backend Engineer", summary: "Backend focus." });
  });

  it("falls back to the personal title and summary when the profile has none", () => {
    const data = buildResumeData(person, library, defaultProfileSpec(library));
    expect(data.personal.title).toBe("Developer");
    expect(data.personal.summary).toBe("General.");
  });

  it("includes only the chosen entries, in the profile's order, with fresh ids", () => {
    const spec = { ...defaultProfileSpec(library), experienceIds: ["e2", "gone", "e1"], projectIds: [], skillIds: ["s1"] };
    const data = buildResumeData(person, library, spec);
    expect(data.experience.map((e) => e.role)).toEqual(["Intern", "Engineer"]);
    expect(data.projects).toEqual([]);
    expect(data.skills[0]).toMatchObject({ category: "Languages", skills: "Go, SQL" });
    expect(data.experience[0].id).not.toBe("e2");
  });

  it("copies bullets so editing a resume can't change the library", () => {
    const data = buildResumeData(person, library, defaultProfileSpec(library));
    data.experience[0].bullets.push("Added later");
    expect(library.experience[0].bullets).toEqual(["Built APIs"]);
  });

  it("works with an empty library", () => {
    const data = buildResumeData(person, emptyLibrary(), defaultProfileSpec(emptyLibrary()));
    expect(data.experience).toEqual([]);
    expect(data.personal.name).toBe("Jane Doe");
  });
});

describe("newEntriesFromResume", () => {
  const library = parseLibrary([row("e1", "experience", { role: "Engineer", company: "Acme", startDate: "2022" })]);
  const resume: ResumeData = {
    ...getEmptyResumeData(),
    experience: [
      { id: "x", role: " engineer ", company: "ACME", startDate: "2022", bullets: [] },
      { id: "y", role: "Intern", company: "Beta", startDate: "2020", bullets: ["t"] },
      { id: "z", role: "", company: "", bullets: [] },
    ],
    projects: [
      { id: "p", name: "Vitae", bullets: [] },
      { id: "p2", name: "vitae", bullets: [] },
    ],
  };

  it("skips entries already in the library, blank ones and duplicates within the resume", () => {
    const found = newEntriesFromResume(resume, library);
    expect(found.map((f) => `${f.kind}:${itemKey(f.kind, f.item)}`)).toEqual([
      "experience:intern|beta|2020",
      "project:vitae",
    ]);
  });
});
