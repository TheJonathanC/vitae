import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import NewDocumentDialog from "../NewDocumentDialog";
import { invoke } from "@tauri-apps/api/tauri";
import { Template } from "../../types";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));

const templates: Template[] = [
  { id: "t1", name: "Modern", description: "", content: "", is_builtin: true, created_at: "" },
  { id: "t2", name: "Classic", description: "", content: "", is_builtin: true, created_at: "" },
];

const backend = (person: object | null, rows: object[] = [], profiles: object[] = []) =>
  (invoke as any).mockImplementation(async (cmd: string) => {
    if (cmd === "get_person") return person ? JSON.stringify(person) : null;
    if (cmd === "list_library_items") return rows;
    if (cmd === "list_profiles") return profiles;
    throw new Error(cmd);
  });

const experienceRow = {
  id: "e1",
  kind: "experience",
  data: JSON.stringify({ role: "Engineer", company: "Acme", bullets: ["Built APIs"] }),
  created_at: "",
  updated_at: "",
};

function renderDialog() {
  const onCreate = vi.fn();
  const onOpenDetails = vi.fn();
  render(<NewDocumentDialog templates={templates} onCreate={onCreate} onCancel={vi.fn()} onOpenDetails={onOpenDetails} />);
  return { onCreate, onOpenDetails };
}

describe("NewDocumentDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts blank and points to My details when nothing is saved yet", async () => {
    backend(null);
    const { onCreate, onOpenDetails } = renderDialog();
    await waitFor(() => expect(screen.getByText("Set up my details")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Set up my details"));
    expect(onOpenDetails).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Blank one" } });
    fireEvent.click(screen.getByText("Create resume"));
    const options = onCreate.mock.calls[0][0];
    expect(options).toMatchObject({ title: "Blank one", templateId: "t1" });
    expect(options.resumeData.personal.name).toBe("");
  });

  it("fills a new resume from saved details", async () => {
    backend({ name: "Jane Doe", email: "jane@example.com" }, [experienceRow]);
    const { onCreate } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText("Start from")).toHaveValue("everything"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.click(screen.getByText("Create resume"));
    const data = onCreate.mock.calls[0][0].resumeData;
    expect(data.personal).toMatchObject({ name: "Jane Doe", email: "jane@example.com" });
    expect(data.experience[0]).toMatchObject({ role: "Engineer", company: "Acme", bullets: ["Built APIs"] });
  });

  it("uses the chosen profile's headline, selection and the chosen template", async () => {
    const profile = {
      id: "p1",
      name: "Backend",
      data: JSON.stringify({ headline: "Backend Engineer", summary: "Servers.", experienceIds: [], projectIds: [], educationIds: [], skillIds: [] }),
      created_at: "",
      updated_at: "",
    };
    backend({ name: "Jane Doe" }, [experienceRow], [profile]);
    const { onCreate } = renderDialog();
    await waitFor(() => expect(screen.getByLabelText("Start from")).toHaveValue("p1"));
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Backend 2026" } });
    fireEvent.click(screen.getByText("Create resume"));
    const options = onCreate.mock.calls[0][0];
    expect(options.templateId).toBe("t2");
    expect(options.resumeData.personal).toMatchObject({ title: "Backend Engineer", summary: "Servers." });
    expect(options.resumeData.experience).toEqual([]);
  });

  describe("tailoring to a job", () => {
    const rows = [
      {
        id: "e1",
        kind: "experience",
        data: JSON.stringify({
          role: "Engineer",
          company: "Acme",
          startDate: "2022",
          endDate: "Present",
          bullets: ["Built Python APIs on AWS", "Ran Kubernetes clusters", "Organised the office party"],
        }),
        created_at: "",
        updated_at: "",
      },
    ];
    const JOB = "We need Python, AWS and Kubernetes experience. Terraform is a plus. You will own payments. Payments reliability matters.";

    async function open() {
      backend({ name: "Jane Doe" }, rows);
      const handlers = renderDialog();
      await waitFor(() => expect(screen.getByLabelText("Start from")).toHaveValue("everything"));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Targeted" } });
      return handlers;
    }

    it("previews the match and which terms are used or missing", async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Job description"), { target: { value: JOB } });
      const preview = await screen.findByRole("region", { name: "Match preview" });
      expect(preview).toHaveTextContent(/\d+% of the job's key terms/);
      expect(within(preview).getByRole("list", { name: "On your resume" })).toHaveTextContent("python");
      expect(within(preview).getByRole("list", { name: "Not in your details" })).toHaveTextContent("terraform");
      expect(preview).toHaveTextContent("Using 1 of 1 role");
    });

    it("creates a resume with only the bullets that fit, plus the role's headline", async () => {
      const { onCreate } = await open();
      fireEvent.change(screen.getByLabelText("Role"), { target: { value: "backend" } });
      fireEvent.change(screen.getByLabelText("Job description"), { target: { value: JOB } });
      await screen.findByRole("region", { name: "Match preview" });
      fireEvent.click(screen.getByText("Create resume"));
      const data = onCreate.mock.calls[0][0].resumeData;
      expect(data.experience[0].bullets).toEqual(["Built Python APIs on AWS", "Ran Kubernetes clusters"]);
      expect(data.personal.title).toBe("Backend Engineer");
    });

    it("lets the user override the headline", async () => {
      const { onCreate } = await open();
      fireEvent.change(screen.getByLabelText("Role"), { target: { value: "backend" } });
      fireEvent.change(screen.getByLabelText("Headline on the resume"), { target: { value: "Payments Engineer" } });
      fireEvent.click(screen.getByText("Create resume"));
      expect(onCreate.mock.calls[0][0].resumeData.personal.title).toBe("Payments Engineer");
    });

    it("works from a role alone", async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Role"), { target: { value: "devops" } });
      expect(await screen.findByRole("region", { name: "Match preview" })).toBeInTheDocument();
    });

    it("changes nothing when no role or job is given", async () => {
      const { onCreate } = await open();
      expect(screen.queryByRole("region", { name: "Match preview" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Create resume"));
      expect(onCreate.mock.calls[0][0].resumeData.experience[0].bullets).toHaveLength(3);
    });

    it("is unavailable for a blank resume", async () => {
      await open();
      fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "blank" } });
      expect(screen.queryByLabelText("Job description")).not.toBeInTheDocument();
      expect(screen.getByText(/Choose a profile or "Everything I've saved"/)).toBeInTheDocument();
    });
  });

  it("needs a name", async () => {
    backend(null);
    renderDialog();
    expect(screen.getByText("Create resume")).toBeDisabled();
  });
});
