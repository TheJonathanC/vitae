import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Sidebar from "../Sidebar";

describe("Sidebar component", () => {
  const mockDocuments = [
    {
      id: "doc-1",
      title: "Document 1",
      content: "Hello LaTeX",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "doc-2",
      title: "Document 2",
      content: "Second Document",
      created_at: "2026-01-02T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
  ];

  it("renders document titles and metadata", () => {
    render(
      <Sidebar
        documents={mockDocuments}
        currentDocument={mockDocuments[0]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getByText("Document 1")).toBeInTheDocument();
    expect(screen.getByText("Document 2")).toBeInTheDocument();
  });

  it("calls onCreateDocument when 'New' is clicked", () => {
    const handleCreate = vi.fn();
    render(
      <Sidebar
        documents={mockDocuments}
        currentDocument={mockDocuments[0]}
        onSelectDocument={vi.fn()}
        onCreateDocument={handleCreate}
        onDeleteDocument={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /new/i }));
    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  it("calls onSelectDocument when a document is clicked", () => {
    const handleSelect = vi.fn();
    render(
      <Sidebar
        documents={mockDocuments}
        currentDocument={mockDocuments[0]}
        onSelectDocument={handleSelect}
        onCreateDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Document 2"));
    expect(handleSelect).toHaveBeenCalledWith("doc-2");
  });

  it("calls onDeleteDocument when delete button is clicked", () => {
    const handleDelete = vi.fn();
    render(
      <Sidebar
        documents={mockDocuments}
        currentDocument={mockDocuments[0]}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onDeleteDocument={handleDelete}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    const deleteButtons = screen.getAllByTitle("Delete document");
    fireEvent.click(deleteButtons[0]);
    expect(handleDelete).toHaveBeenCalledWith("doc-1");
  });

  it("shows empty state when no documents exist", () => {
    render(
      <Sidebar
        documents={[]}
        currentDocument={null}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
        collapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getByText(/No documents yet/i)).toBeInTheDocument();
  });

  it("renders collapsed view toggle button", () => {
    const handleToggle = vi.fn();
    render(
      <Sidebar
        documents={mockDocuments}
        currentDocument={null}
        onSelectDocument={vi.fn()}
        onCreateDocument={vi.fn()}
        onDeleteDocument={vi.fn()}
        collapsed={true}
        onToggleCollapse={handleToggle}
      />
    );

    const expandBtn = screen.getByRole("button", { name: /expand sidebar/i });
    fireEvent.click(expandBtn);
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });
});
