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
    expect(screen.getByText("✓ Active Template")).toBeInTheDocument();
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

    // Click Import Custom Template tab
    fireEvent.click(screen.getByText(/Import Custom Template/i));
    expect(screen.getByText("Upload Your LaTeX Resume Template")).toBeInTheDocument();

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
      expect(screen.getByText("Save Template to Library")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Save Template to Library"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("create_template", expect.any(Object));
      expect(onTemplatesUpdated).toHaveBeenCalled();
    });
  });
});
