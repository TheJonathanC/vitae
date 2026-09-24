import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../../App";
import { invoke } from "@tauri-apps/api/tauri";

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

// Mock Tauri APIs
vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("1.1.0"),
}));

const mockDocs = [
  {
    id: "doc-1",
    title: "Resume 2026",
    content: "\\documentclass{article}\\begin{document}Hello\\end{document}",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  },
  {
    id: "doc-2",
    title: "Cover Letter",
    content: "\\documentclass{article}\\begin{document}Cover\\end{document}",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
  },
];

describe("App Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mocks
    (invoke as any).mockImplementation((cmd: string, args?: any) => {
      switch (cmd) {
        case "check_latex_installed":
          return Promise.resolve(true);
        case "get_all_documents":
          return Promise.resolve([...mockDocs]);
        case "get_document":
          return Promise.resolve(mockDocs.find((d) => d.id === args?.id) || mockDocs[0]);
        case "create_document":
          return Promise.resolve({
            id: "doc-new",
            title: args?.title,
            content: `\\title{${args?.title}}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        case "update_document":
          return Promise.resolve();
        case "delete_document":
          return Promise.resolve();
        case "compile_latex":
          return Promise.resolve({
            success: true,
            pdf_path: "C:/path/to/doc.pdf",
            errors: [],
          });
        case "check_update_custom":
          return Promise.resolve({ should_update: false });
        default:
          return Promise.resolve();
      }
    });
  });

  it("loads and displays documents on startup", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
      expect(screen.getByText("Cover Letter")).toBeInTheDocument();
    });
  });

  it("creates a new document when requested", async () => {
    vi.mocked(window.prompt).mockReturnValueOnce("Curriculum Vitae");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /new/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_document", {
        title: "Curriculum Vitae",
      });
      expect(screen.getByRole("heading", { level: 1, name: "Curriculum Vitae" })).toBeInTheDocument();
    });
  });

  it("switches documents when another document is clicked in the sidebar", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Cover Letter")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Cover Letter"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("get_document", { id: "doc-2" });
      expect(screen.getByRole("heading", { level: 1, name: "Cover Letter" })).toBeInTheDocument();
    });
  });

  it("deletes a document when user confirms", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(true);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle("Delete document");
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("delete_document", { id: "doc-1" });
      expect(screen.queryByRole("heading", { level: 1, name: "Resume 2026" })).not.toBeInTheDocument();
    });
  });

  it("cancels document deletion when user cancels confirmation (cancel flow test)", async () => {
    vi.mocked(window.confirm).mockReturnValueOnce(false);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle("Delete document");
    fireEvent.click(deleteButtons[0]);

    // Should NOT call delete_document
    expect(invoke).not.toHaveBeenCalledWith("delete_document", expect.anything());
    // Document should still be selected
    expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
  });

  it("compiles the document when Compile button is clicked", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Compile"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("compile_latex", {
        id: "doc-1",
        content: mockDocs[0].content,
      });
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe).toBeInTheDocument();
      expect(iframe.getAttribute("src")).toContain("asset://localhost/C:/path/to/doc.pdf");
    });
  });

  it("displays compilation errors and error banner when compilation fails", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "compile_latex") {
        return Promise.resolve({
          success: false,
          pdf_path: undefined,
          errors: [
            { line: 12, message: "Undefined control sequence \\foo", severity: "error" },
          ],
        });
      }
      if (cmd === "check_latex_installed") return Promise.resolve(true);
      if (cmd === "get_all_documents") return Promise.resolve([...mockDocs]);
      if (cmd === "check_update_custom") return Promise.resolve({ should_update: false });
      return Promise.resolve();
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Compile"));

    await waitFor(() => {
      expect(screen.getByText(/Compilation failed:/i)).toBeInTheDocument();
      expect(screen.getByText(/Line 12: Undefined control sequence \\foo/i)).toBeInTheDocument();
    });
  });

  it("shows setup button when LaTeX is not detected", async () => {
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "check_latex_installed") return Promise.resolve(false);
      if (cmd === "get_all_documents") return Promise.resolve([...mockDocs]);
      if (cmd === "check_update_custom") return Promise.resolve({ should_update: false });
      return Promise.resolve();
    });

    localStorage.setItem("vitae_setup_complete", "true");

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Setup LaTeX/i)).toBeInTheDocument();
    });
  });

  it("opens settings modal and allows toggling channel", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("btn-settings"));

    await waitFor(() => {
      expect(screen.getByText("Release Channel")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Stable Channel"));

    await waitFor(() => {
      expect(localStorage.getItem("vitae_channel")).toBe("stable");
    });
  });

  it("defaults to Visual Form tab and allows switching to LaTeX Source tab", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    // Form tab should be active by default
    const formTab = screen.getByTestId("tab-form-view");
    const codeTab = screen.getByTestId("tab-code-view");

    expect(formTab).toHaveClass("active");
    expect(codeTab).not.toHaveClass("active");
    expect(screen.getByTestId("resume-form")).toBeInTheDocument();

    // Switch to code tab
    fireEvent.click(codeTab);
    expect(codeTab).toHaveClass("active");
    expect(formTab).not.toHaveClass("active");
    expect(screen.getByTestId("monaco-mock")).toBeInTheDocument();

    // Switch back to form tab
    fireEvent.click(formTab);
    expect(formTab).toHaveClass("active");
    expect(screen.getByTestId("resume-form")).toBeInTheDocument();
  });

  it("opens template manager modal when clicking Templates button", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    const templatesBtn = screen.getByTestId("btn-open-templates");
    fireEvent.click(templatesBtn);

    await waitFor(() => {
      expect(screen.getByTestId("template-manager-modal")).toBeInTheDocument();
      expect(screen.getByText("Resume Templates")).toBeInTheDocument();
    });
  });

  it("supports switching layout view modes (Split, Form Only, Preview Only)", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Resume 2026" })).toBeInTheDocument();
    });

    const splitBtn = screen.getByTestId("btn-toggle-split");
    const editorBtn = screen.getByTestId("btn-toggle-editor");
    const previewBtn = screen.getByTestId("btn-toggle-preview");

    // Default is split mode
    expect(splitBtn).toHaveClass("active");

    // Switch to Form Only
    fireEvent.click(editorBtn);
    expect(editorBtn).toHaveClass("active");
    expect(splitBtn).not.toHaveClass("active");

    // Switch to Preview Only
    fireEvent.click(previewBtn);
    expect(previewBtn).toHaveClass("active");
    expect(editorBtn).not.toHaveClass("active");

    // Switch back to Split
    fireEvent.click(splitBtn);
    expect(splitBtn).toHaveClass("active");
  });
});
