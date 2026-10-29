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

  describe("improving wording with AI", () => {
    const aiRow = {
      id: "e1",
      kind: "experience",
      data: JSON.stringify({ role: "Engineer", company: "Acme", startDate: "2022", endDate: "Present", bullets: ["Built Python APIs on AWS", "Ran Kubernetes clusters"] }),
      created_at: "",
      updated_at: "",
    };
    const settings = { has_key: true, provider: "anthropic", provider_name: "Anthropic", model: "claude-sonnet-5-5" };
    const JOB = "We need Python, AWS and Kubernetes experience.";

    function setup(opts: { settings?: object | null; rewrite?: () => unknown } = {}) {
      (invoke as any).mockImplementation(async (cmd: string) => {
        if (cmd === "get_person") return JSON.stringify({ name: "Jane Doe" });
        if (cmd === "list_library_items") return [aiRow];
        if (cmd === "list_profiles") return [];
        if (cmd === "ai_get_settings") return opts.settings === undefined ? settings : opts.settings;
        if (cmd === "ai_rewrite") return (opts.rewrite ?? (() => []))();
        throw new Error(cmd);
      });
      return renderDialog();
    }

    async function fill() {
      await waitFor(() => expect(screen.getByLabelText("Start from")).toHaveValue("everything"));
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "With AI" } });
      fireEvent.change(screen.getByLabelText("Job description"), { target: { value: JOB } });
    }

    it("only offers AI once a key is saved, otherwise points to Settings", async () => {
      setup({ settings: { has_key: false, provider: null, provider_name: null, model: null } });
      await fill();
      expect(screen.queryByLabelText(/Improve the wording with AI/)).not.toBeInTheDocument();
      expect(screen.getByText(/Add an API key in Settings/)).toBeInTheDocument();
    });

    it("sends the chosen bullets and job, then lets the user pick which changes to keep", async () => {
      const { onCreate } = setup({
        rewrite: () => [
          { id: "exp-0-0", text: "Designed and shipped Python APIs on AWS" },
          { id: "exp-0-1", text: "Operated Kubernetes clusters" },
        ],
      });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI \(claude-sonnet-5-5\)/));
      expect(screen.getByText(/Sends the bullets on this resume and the job description to Anthropic/)).toBeInTheDocument();
      fireEvent.click(screen.getByText("Create resume"));

      expect(await screen.findByRole("list", { name: "Suggested changes" })).toBeInTheDocument();
      expect(onCreate).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("ai_rewrite", {
        jobText: JOB,
        role: null,
        items: [
          { id: "exp-0-0", text: "Built Python APIs on AWS" },
          { id: "exp-0-1", text: "Ran Kubernetes clusters" },
        ],
      });

      fireEvent.click(screen.getByLabelText("Use suggestion: Operated Kubernetes clusters"));
      fireEvent.click(screen.getByText("Use selected changes"));
      const bullets = onCreate.mock.calls[0][0].resumeData.experience[0].bullets;
      expect(bullets).toEqual(["Designed and shipped Python APIs on AWS", "Ran Kubernetes clusters"]);
    });

    it("leaves suggestions that add a new number or tool unticked and says why", async () => {
      setup({ rewrite: () => [{ id: "exp-0-0", text: "Cut Python API latency by 40% on AWS" }] });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI/));
      fireEvent.click(screen.getByText("Create resume"));
      const box = await screen.findByLabelText("Use suggestion: Cut Python API latency by 40% on AWS");
      expect(box).not.toBeChecked();
      expect(screen.getByText(/Adds something not in your original: 40%/)).toBeInTheDocument();
      expect(screen.getByText("Use selected changes")).toBeDisabled();
    });

    it("can create the resume without any AI changes", async () => {
      const { onCreate } = setup({ rewrite: () => [{ id: "exp-0-0", text: "Designed Python APIs on AWS" }] });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI/));
      fireEvent.click(screen.getByText("Create resume"));
      fireEvent.click(await screen.findByText("Create without AI changes"));
      expect(onCreate.mock.calls[0][0].resumeData.experience[0].bullets[0]).toBe("Built Python APIs on AWS");
    });

    it("explains an AI failure and still lets the user create the resume", async () => {
      const { onCreate } = setup({
        rewrite: () => {
          throw "Anthropic rejected the API key. Check that it's correct and active.";
        },
      });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI/));
      fireEvent.click(screen.getByText("Create resume"));
      expect(await screen.findByRole("alert")).toHaveTextContent("rejected the API key");
      fireEvent.click(screen.getByText("Create without AI changes"));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("handles an AI answer with nothing to change", async () => {
      const { onCreate } = setup({ rewrite: () => [{ id: "exp-0-0", text: "Built Python APIs on AWS" }] });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI/));
      fireEvent.click(screen.getByText("Create resume"));
      expect(await screen.findByText(/didn't suggest any changes/)).toBeInTheDocument();
      expect(screen.getByText("Use selected changes")).toBeDisabled();
      fireEvent.click(screen.getByText("Create without AI changes"));
      expect(onCreate).toHaveBeenCalledTimes(1);
    });

    it("goes back to the form from the review", async () => {
      setup({ rewrite: () => [{ id: "exp-0-0", text: "Designed Python APIs on AWS" }] });
      await fill();
      fireEvent.click(await screen.findByLabelText(/Improve the wording with AI/));
      fireEvent.click(screen.getByText("Create resume"));
      await screen.findByRole("list", { name: "Suggested changes" });
      fireEvent.click(screen.getByText("Back"));
      expect(screen.getByLabelText("Job description")).toHaveValue(JOB);
    });

    it("skips the AI when it isn't ticked", async () => {
      const { onCreate } = setup();
      await fill();
      await screen.findByLabelText(/Improve the wording with AI/);
      fireEvent.click(screen.getByText("Create resume"));
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(invoke).not.toHaveBeenCalledWith("ai_rewrite", expect.anything());
    });
  });

  it("needs a name", async () => {
    backend(null);
    renderDialog();
    expect(screen.getByText("Create resume")).toBeDisabled();
  });
});
