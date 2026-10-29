import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import App from "../../App";
import { invoke } from "@tauri-apps/api/tauri";
import { getEmptyResumeData } from "../../utils/templateEngine";

// Mock Monaco Editor for jsdom testing
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="monaco-mock"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
  loader: {
    config: vi.fn(),
    init: vi.fn(),
    __getMonacoInstance: vi.fn(),
  },
}));

// The real Monaco setup isn't needed with the mocked editor
vi.mock("../../monaco", () => ({}));

// PDF.js needs a real canvas; render one fake page per PDF
vi.mock("../../utils/pdfRenderer", () => ({
  renderPdfPages: vi.fn(async (_b64: string, width: number) => [
    { url: "blob:page-1", width, height: width * 1.3 },
  ]),
}));

// Mock Tauri APIs
vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.1.2"),
}));

const formData = {
  ...getEmptyResumeData(),
  personal: { ...getEmptyResumeData().personal, name: "Riley Chen" },
};

const mockDocs = [
  {
    id: "doc-1",
    title: "Resume 2026",
    content: "\\documentclass{article}\\begin{document}Riley Chen\\end{document}",
    template_id: "template-modern",
    resume_data: JSON.stringify(formData),
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  },
  {
    // Hand-written LaTeX from before the form existed
    id: "doc-2",
    title: "Cover Letter",
    content: "\\documentclass{article}\\begin{document}Cover\\end{document}",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  },
];

type Handler = (cmd: string, args?: any) => Promise<unknown> | undefined;

function mockBackend(overrides: Handler = () => undefined) {
  (invoke as any).mockImplementation((cmd: string, args?: any) => {
    const overridden = overrides(cmd, args);
    if (overridden !== undefined) return overridden;
    switch (cmd) {
      case "check_latex_installed":
        return Promise.resolve(true);
      case "get_all_documents":
        return Promise.resolve(mockDocs.map((d) => ({ ...d })));
      case "get_document":
        return Promise.resolve({ ...(mockDocs.find((d) => d.id === args?.id) || mockDocs[0]) });
      case "create_document_with_template":
        return Promise.resolve({
          id: "doc-new",
          title: args?.title,
          content: args?.initialContent,
          template_id: args?.templateId,
          resume_data: args?.resumeData,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      case "compile_latex":
        return Promise.resolve({
          success: true,
          pdf_path: "C:/path/to/doc.pdf",
          errors: [],
        });
      case "read_pdf_bytes":
        return Promise.resolve("JVBERi0xLjQ=");
      case "check_update_custom":
        return Promise.resolve({ should_update: false });
      default:
        return Promise.resolve();
    }
  });
}

async function renderApp() {
  render(<App />);
  await waitFor(() => {
    expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
  });
}

const openDrawer = () => fireEvent.click(screen.getByTestId("btn-toggle-sidebar"));

/** Turns auto-update off so a test controls when builds run. */
const manualBuilds = () => localStorage.setItem("vitae_auto_compile", "false");

const savedCalls = () =>
  (invoke as any).mock.calls.filter(([cmd]: [string]) => cmd === "update_document_full");

describe("App Integration Tests", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockBackend();
  });

  it("loads and displays documents on startup with the document menu closed", async () => {
    await renderApp();
    expect(screen.queryByText("Cover Letter")).not.toBeInTheDocument();

    openDrawer();
    expect(screen.getByText("Cover Letter")).toBeInTheDocument();
  });

  it("creates a new document with an empty form from the new-document dialog", async () => {
    await renderApp();
    openDrawer();

    fireEvent.click(screen.getByRole("button", { name: /new resume/i }));
    const dialog = screen.getByRole("dialog", { name: "New resume" });
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Curriculum Vitae" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create resume" }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith(
        "create_document_with_template",
        expect.objectContaining({ title: "Curriculum Vitae", templateId: "template-modern" })
      );
      expect(screen.getByRole("heading", { level: 1, name: "Curriculum Vitae" })).toBeInTheDocument();
    });

    // The title is not used as the person's name, and no sample data is filled in
    expect(screen.getByTestId("input-personal-name")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("");
  });

  it("switches documents when another document is clicked in the sidebar", async () => {
    await renderApp();
    openDrawer();

    fireEvent.click(screen.getByText("Cover Letter"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_document", { id: "doc-2" });
      expect(screen.getByRole("heading", { level: 1, name: "Cover Letter" })).toBeInTheDocument();
    });
  });

  it("opens hand-written LaTeX in the source tab and keeps the form from overwriting it", async () => {
    await renderApp();
    openDrawer();
    fireEvent.click(screen.getByText("Cover Letter"));

    await waitFor(() => {
      expect(screen.getByTestId("tab-code-view")).toHaveClass("active");
    });
    expect(await screen.findByTestId("monaco-mock")).toHaveValue(mockDocs[1].content);

    fireEvent.click(screen.getByTestId("tab-form-view"));
    expect(screen.getByTestId("form-locked-banner")).toBeInTheDocument();
    expect(screen.getByTestId("input-personal-name")).toBeDisabled();

    await new Promise((r) => setTimeout(r, 700));
    expect(savedCalls()).toHaveLength(0);
  });

  it("locks the form after the LaTeX source is edited by hand", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("tab-code-view"));
    const editor = await screen.findByTestId("monaco-mock");
    fireEvent.change(editor, { target: { value: "\\documentclass{article}% custom" } });

    await waitFor(() => expect(savedCalls().length).toBeGreaterThan(0));
    const [, saved] = savedCalls()[savedCalls().length - 1];
    expect(saved.content).toBe("\\documentclass{article}% custom");
    expect(JSON.parse(saved.resumeData).sourceEditedManually).toBe(true);

    fireEvent.click(screen.getByTestId("tab-form-view"));
    expect(screen.getByTestId("form-locked-banner")).toBeInTheDocument();

    // Regenerating from the form is explicit and confirmed
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("btn-regenerate-from-form"));
    expect(screen.queryByTestId("form-locked-banner")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-personal-name")).not.toBeDisabled();
  });

  it("deletes a document when user confirms", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await renderApp();
    openDrawer();

    const deleteButtons = screen.getAllByTitle("Delete document");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_document", { id: "doc-1" });
      expect(screen.queryByRole("heading", { level: 1, name: "Resume 2026" })).not.toBeInTheDocument();
    });
  });

  it("cancels document deletion when user cancels confirmation (cancel flow test)", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await renderApp();
    openDrawer();

    const deleteButtons = screen.getAllByTitle("Delete document");
    fireEvent.click(deleteButtons[0]);

    expect(invoke).not.toHaveBeenCalledWith("delete_document", expect.anything());
    expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
  });

  it("keeps the preview up to date automatically", async () => {
    await renderApp();

    expect(await screen.findByRole("img", { name: "Page 1 of 1" }, { timeout: 4000 })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("compile_latex", {
      id: "doc-1",
      content: mockDocs[0].content,
    });
    expect(invoke).toHaveBeenCalledWith("read_pdf_bytes", { id: "doc-1" });
    expect(screen.getByText("Up to date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export pdf/i })).toBeEnabled();
  });

  it("builds on request when auto-update is off", async () => {
    manualBuilds();
    await renderApp();

    expect(screen.getByRole("switch", { name: /auto-update/i })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /export pdf/i })).toBeDisabled();
    fireEvent.click(screen.getByText("Update preview"));

    expect(await screen.findByRole("img", { name: "Page 1 of 1" })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("compile_latex", { id: "doc-1", content: mockDocs[0].content });
  });

  it("ignores a compile result that arrives after switching documents", async () => {
    let finishCompile: (value: unknown) => void = () => {};
    mockBackend((cmd) =>
      cmd === "compile_latex"
        ? new Promise((resolve) => {
            finishCompile = resolve;
          })
        : undefined
    );
    manualBuilds();
    await renderApp();

    fireEvent.click(screen.getByText("Update preview"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("compile_latex", expect.anything()));

    openDrawer();
    fireEvent.click(screen.getByText("Cover Letter"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Cover Letter" })).toBeInTheDocument();
    });

    await act(async () => {
      finishCompile({
        success: false,
        pdf_path: null,
        errors: [{ line: 3, message: "Error from the other document", severity: "error" }],
      });
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(screen.queryByText(/Couldn't build the PDF/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Page 1/ })).not.toBeInTheDocument();
  });

  it("reports build errors in the preview bar with details on request", async () => {
    mockBackend((cmd) =>
      cmd === "compile_latex"
        ? Promise.resolve({
            success: false,
            pdf_path: undefined,
            errors: [{ line: 12, message: "Undefined control sequence \\foo", severity: "error" }],
          })
        : undefined
    );
    manualBuilds();
    await renderApp();

    fireEvent.click(screen.getByText("Update preview"));

    expect(await screen.findByText("Couldn't build the PDF, 1 error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See errors" }));

    const details = screen.getByRole("region", { name: "Why the PDF couldn't be built" });
    expect(details).toHaveTextContent("Line 12");
    expect(details).toHaveTextContent("Undefined control sequence \\foo");

    // Jump to the source, where the lines are marked
    fireEvent.click(screen.getByRole("button", { name: "Open LaTeX source" }));
    expect(screen.getByTestId("tab-code-view")).toHaveClass("active");
  });

  it("keeps a failed save queued and retries it", async () => {
    let attempts = 0;
    mockBackend((cmd) => {
      if (cmd !== "update_document_full") return undefined;
      attempts += 1;
      return attempts === 1 ? Promise.reject("database is locked") : Promise.resolve();
    });
    await renderApp();

    fireEvent.change(screen.getByTestId("input-personal-name"), { target: { value: "Riley Q. Chen" } });

    await waitFor(() => {
      expect(screen.getByText(/Your changes couldn't be saved \(database is locked\)/)).toBeInTheDocument();
    });
    await waitFor(() => expect(attempts).toBe(2), { timeout: 5000 });
    const [, retried] = savedCalls()[1];
    expect(JSON.parse(retried.resumeData).personal.name).toBe("Riley Q. Chen");
  });

  it("applies an imported template and only fills empty fields with detected details", async () => {
    mockBackend((cmd, args) =>
      cmd === "create_template"
        ? Promise.resolve({
            id: "custom-1",
            name: args.name,
            description: args.description,
            content: args.content,
            is_builtin: false,
            created_at: new Date().toISOString(),
          })
        : undefined
    );
    await renderApp();

    fireEvent.click(screen.getByTestId("btn-open-templates"));
    const file = new File(
      ["\\documentclass{article}\\begin{document}{\\Huge Jane Doe} jane@example.com\\end{document}"],
      "jane.tex",
      { type: "text/plain" }
    );
    fireEvent.change(screen.getByTestId("template-file-input"), { target: { files: [file] } });
    // Saving is enabled once the file has been read
    const save = await screen.findByRole("button", { name: "Save and use template" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(
      () => {
        expect(screen.getByTestId("btn-open-templates")).toHaveTextContent("Template: jane");
      },
      { timeout: 4000 }
    );
    // Existing name is kept; the empty email is filled from the template
    expect(screen.getByTestId("input-personal-name")).toHaveValue("Riley Chen");
    expect(screen.getByLabelText("Email")).toHaveValue("jane@example.com");

    await waitFor(() => expect(savedCalls().length).toBeGreaterThan(0));
    const [, saved] = savedCalls()[savedCalls().length - 1];
    expect(saved.templateId).toBe("custom-1");
    expect(saved.content).toContain("Riley Chen");
  });

  it("shows setup button when LaTeX is not detected", async () => {
    mockBackend((cmd) => (cmd === "check_latex_installed" ? Promise.resolve(false) : undefined));
    localStorage.setItem("vitae_setup_complete", "true");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("LaTeX isn't installed")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Set up LaTeX" })).toBeInTheDocument();
    });
  });

  it("opens settings modal and allows toggling channel", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("btn-settings"));

    await waitFor(() => {
      expect(screen.getByText("Release channel")).toBeInTheDocument();
    });

    // Stable is the default for new installs
    expect((screen.getByDisplayValue("stable") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByText("Beta"));

    await waitFor(() => {
      expect(localStorage.getItem("vitae_channel")).toBe("beta");
    });
  });

  it("defaults to Visual Form tab and allows switching to LaTeX Source tab", async () => {
    await renderApp();

    const formTab = screen.getByTestId("tab-form-view");
    const codeTab = screen.getByTestId("tab-code-view");

    expect(formTab).toHaveClass("active");
    expect(codeTab).not.toHaveClass("active");
    expect(screen.getByTestId("resume-form")).toBeInTheDocument();

    // The switch sits in the same place in both views but is a new element
    fireEvent.click(codeTab);
    expect(screen.getByTestId("tab-code-view")).toHaveClass("active");
    expect(screen.getByTestId("tab-form-view")).not.toHaveClass("active");
    expect(await screen.findByTestId("monaco-mock")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-form-view"));
    expect(screen.getByTestId("tab-form-view")).toHaveClass("active");
    expect(screen.getByTestId("resume-form")).toBeInTheDocument();
  });

  it("opens template manager modal when clicking Templates button", async () => {
    await renderApp();

    fireEvent.click(screen.getByTestId("btn-open-templates"));

    await waitFor(() => {
      expect(screen.getByTestId("template-manager-modal")).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
    });

    // Escape closes the dialog
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("template-manager-modal")).not.toBeInTheDocument();
  });

  it("supports switching layout view modes (Split, Form Only, Preview Only)", async () => {
    await renderApp();

    const splitBtn = screen.getByTestId("btn-toggle-split");
    const editorBtn = screen.getByTestId("btn-toggle-editor");
    const previewBtn = screen.getByTestId("btn-toggle-preview");

    expect(splitBtn).toHaveClass("active");

    fireEvent.click(editorBtn);
    expect(editorBtn).toHaveClass("active");
    expect(splitBtn).not.toHaveClass("active");

    fireEvent.click(previewBtn);
    expect(previewBtn).toHaveClass("active");
    expect(editorBtn).not.toHaveClass("active");

    fireEvent.click(splitBtn);
    expect(splitBtn).toHaveClass("active");
  });

  it("recovers from a corrupt stored split ratio", async () => {
    localStorage.setItem("vitae_split_ratio", "not-a-number");
    await renderApp();
    const pane = document.querySelector(".editor-pane") as HTMLElement;
    expect(pane.style.flexBasis).toBe("50%");
  });
});
