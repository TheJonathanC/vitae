import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("needs a name", async () => {
    backend(null);
    renderDialog();
    expect(screen.getByText("Create resume")).toBeDisabled();
  });
});
