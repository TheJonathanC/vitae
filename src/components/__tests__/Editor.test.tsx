import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Editor from "../Editor";
import { latexMonarchTokens, latexLanguageConfiguration } from "../../monaco";

// Mock Monaco Editor for unit testing
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, loading }: any) => (
    <div data-testid="monaco-container">
      {loading}
      <textarea
        data-testid="monaco-editor-mock"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  ),
  loader: {
    config: vi.fn(),
    init: vi.fn(),
  },
}));

describe("Editor component", () => {
  it("renders editor with initial content and handles change", () => {
    const handleChange = vi.fn();
    const initialContent = "Hello LaTeX";
    render(<Editor content={initialContent} onChange={handleChange} />);

    const textarea = screen.getByTestId("monaco-editor-mock") as HTMLTextAreaElement;
    expect(textarea.value).toBe(initialContent);

    fireEvent.change(textarea, { target: { value: "Updated LaTeX" } });
    expect(handleChange).toHaveBeenCalledWith("Updated LaTeX");
  });

  it("renders custom loading placeholder", () => {
    render(<Editor content="test" onChange={() => {}} />);
    expect(screen.getByText("Loading editor...")).toBeInTheDocument();
  });
});

describe("LaTeX Monaco Language Definition", () => {
  it("defines standard LaTeX keywords", () => {
    expect(latexMonarchTokens.keywords).toContain("documentclass");
    expect(latexMonarchTokens.keywords).toContain("usepackage");
    expect(latexMonarchTokens.keywords).toContain("begin");
    expect(latexMonarchTokens.keywords).toContain("end");
    expect(latexMonarchTokens.keywords).toContain("section");
    expect(latexMonarchTokens.keywords).toContain("title");
  });

  it("defines line comment configuration with %", () => {
    expect(latexLanguageConfiguration.comments?.lineComment).toBe("%");
  });

  it("defines bracket auto-closing pairs for curly, square, and math symbols", () => {
    const pairs = latexLanguageConfiguration.autoClosingPairs;
    expect(pairs).toBeDefined();
    expect(pairs?.some((p) => p.open === "{" && p.close === "}")).toBe(true);
    expect(pairs?.some((p) => p.open === "[" && p.close === "]")).toBe(true);
    expect(pairs?.some((p) => p.open === "$" && p.close === "$")).toBe(true);
  });
});
