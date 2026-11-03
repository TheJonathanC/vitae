import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TemplateManager from "../TemplateManager";
import { BUILTIN_TEMPLATES } from "../../utils/templatePresets";
import { invoke } from "@tauri-apps/api/tauri";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
}));

describe("TemplateManager component", () => {
  const templates = [...BUILTIN_TEMPLATES];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all templates in gallery with correct badges", () => {
    render(
      <TemplateManager
        templates={templates}
        currentTemplateId="template-modern"
        onSelectTemplate={vi.fn()}
        onTemplatesUpdated={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("Modern Professional")).toBeInTheDocument();
    expect(screen.getByText("Classic Academic")).toBeInTheDocument();
    expect(screen.getByText("Minimalist Single-Column")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Templates" })).toBeInTheDocument();
  });

  it("calls onSelectTemplate when another template is chosen", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(
      <TemplateManager
        templates={templates}
        currentTemplateId="template-modern"
        onSelectTemplate={onSelect}
        onTemplatesUpdated={vi.fn()}
        onClose={onClose}
      />
    );

    const classicCard = screen.getByTestId("template-card-template-classic");
    const useBtn = classicCard.querySelector(".btn-select") as HTMLButtonElement;
    fireEvent.click(useBtn);

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "template-classic" })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("switches to Import tab and allows saving a new custom template", async () => {
    const onTemplatesUpdated = vi.fn();
    const onSelectTemplate = vi.fn();
    const onClose = vi.fn();

    (invoke as any).mockResolvedValueOnce({
      id: "tpl-custom-1",
      name: "My Custom Resume",
      description: "Custom uploaded",
      content: "\\documentclass{article}\\begin{document}{{name}}\\end{document}",
      is_builtin: false,
      created_at: new Date().toISOString(),
    });

    render(
      <TemplateManager
        templates={templates}
        currentTemplateId="template-modern"
        onSelectTemplate={onSelectTemplate}
        onTemplatesUpdated={onTemplatesUpdated}
        onClose={onClose}
      />
    );

    // Fill in template details manually
    // Trigger file change mock
    const file = new File(
      ["\\documentclass{article}\\begin{document}{\\Huge John Doe}\\end{document}"],
      "my_resume.tex",
      { type: "text/plain" }
    );

    const input = screen.getByTestId("template-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Import a template" })).toBeInTheDocument();
      expect(screen.getByLabelText("Template name")).toHaveValue("my_resume");
      expect(screen.getByText("John Doe")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save and use template"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_template", expect.any(Object));
      expect(onTemplatesUpdated).toHaveBeenCalled();
    });
  });

  it("shows the sections found in an imported file and lets you correct them", async () => {
    const onSelectTemplate = vi.fn();
    (invoke as any).mockImplementation((_cmd: string, args: any) =>
      Promise.resolve({ id: "tpl-2", name: args.name, description: "", content: args.content, is_builtin: false, created_at: "" })
    );
    render(
      <TemplateManager
        templates={templates}
        currentTemplateId="template-modern"
        onSelectTemplate={onSelectTemplate}
        onTemplatesUpdated={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const tex = [
      "\\documentclass{article}\\begin{document}",
      "{\\Huge Ana Silva}",
      "\\section{Experience}",
      "\\textbf{Engineer} \\hfill 2020 -- 2023 \\\\ \\textit{Acme Corp}",
      "\\begin{itemize}\\item Shipped it\\end{itemize}",
      "\\section{Awards}",
      "\\begin{itemize}\\item \\textbf{Best Paper} 2021\\item \\textbf{Hackathon Winner} 2019\\end{itemize}",
      "\\end{document}",
    ].join("\n");
    fireEvent.change(screen.getByTestId("template-file-input"), {
      target: { files: [new File([tex], "ana.tex", { type: "text/plain" })] },
    });

    const experience = await screen.findByTestId("import-section-s0");
    expect(experience).toHaveTextContent("1 entry · 1 bullet");
    expect(screen.getByLabelText("Use as", { selector: "#import-section-s0" })).toHaveValue("experience");
    expect(screen.getByLabelText("Engineer")).toHaveValue("role");
    expect(screen.getByLabelText("2020 -- 2023")).toHaveValue("dates");
    expect(screen.getByLabelText("Use as", { selector: "#import-section-s1" })).toHaveValue("list");
    expect(screen.getByTestId("import-match")).toHaveTextContent("prints all of the file's text");

    // Correct a guess: the company should be kept as written.
    fireEvent.change(screen.getByLabelText("Acme Corp"), { target: { value: "" } });
    expect((screen.getByLabelText("LaTeX source") as HTMLTextAreaElement).value).toContain("\\textit{Acme Corp}");

    fireEvent.click(screen.getByText("Save and use template"));
    await waitFor(() => expect(onSelectTemplate).toHaveBeenCalled());
    const imported = onSelectTemplate.mock.calls[0][1];
    expect(imported.personal).toEqual({ name: "Ana Silva" });
    expect(imported.experience[0]).toMatchObject({ role: "Engineer", company: "", startDate: "2020", endDate: "2023" });
    expect(imported.customLists.awards.map((i: any) => i.fields)).toEqual([
      { title: "Best Paper", dates: "2021" },
      { title: "Hackathon Winner", dates: "2019" },
    ]);
  });
});
