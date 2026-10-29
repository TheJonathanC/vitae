import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DocumentMenu from "../DocumentMenu";

const documents = [
  {
    id: "doc-1",
    title: "Software Engineer",
    content: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-10-28T09:00:00Z",
  },
  {
    id: "doc-2",
    title: "Academic CV",
    content: "",
    created_at: "2026-01-02T00:00:00Z",
    updated_at: "2026-09-02T09:00:00Z",
  },
];

function renderMenu(overrides: Partial<React.ComponentProps<typeof DocumentMenu>> = {}) {
  const props = {
    documents,
    currentDocument: documents[0],
    onSelectDocument: vi.fn(),
    onCreateDocument: vi.fn(),
    onDeleteDocument: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<DocumentMenu {...props} />);
  return props;
}

describe("DocumentMenu", () => {
  it("lists resumes with when they were last edited and marks the open one", () => {
    renderMenu();
    expect(screen.getByRole("dialog", { name: "Your resumes" })).toBeInTheDocument();
    const current = screen.getByRole("button", { name: /^Software Engineer/ });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current).toHaveFocus();
    expect(screen.getByRole("button", { name: /^Academic CV/ })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByText(/^Edited /)).toHaveLength(2);
  });

  it("opens a resume when it is chosen", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByText("Academic CV"));
    expect(props.onSelectDocument).toHaveBeenCalledWith("doc-2");
  });

  it("starts a new resume", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "New resume" }));
    expect(props.onCreateDocument).toHaveBeenCalledTimes(1);
  });

  it("deletes a resume by name", () => {
    const props = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Delete Academic CV" }));
    expect(props.onDeleteDocument).toHaveBeenCalledWith("doc-2");
  });

  it("invites creating one when there are none", () => {
    renderMenu({ documents: [], currentDocument: null });
    expect(screen.getByText(/No resumes yet/)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const props = renderMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
