import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PDFViewer from "../PDFViewer";
import { invoke } from "@tauri-apps/api/tauri";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
}));

const DOC_ID = "a1a2a3a4-b1b2-c1c2-d1d2-d3d4d5d6d7d8";

describe("PDFViewer component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue("JVBERi0xLjQ=");
  });

  it("renders placeholder when there is no compiled document", () => {
    render(<PDFViewer documentId={null} revision={0} />);
    expect(screen.getByText(/Click Compile .* to preview the PDF/i)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requests the PDF by document id and renders it as a data URL", async () => {
    render(<PDFViewer documentId={DOC_ID} revision={1} />);

    await waitFor(() => {
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe.getAttribute("src")).toBe("data:application/pdf;base64,JVBERi0xLjQ=");
    });
    expect(invoke).toHaveBeenCalledWith("read_pdf_bytes", { id: DOC_ID });
  });

  it("reloads when the revision changes", async () => {
    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    rerender(<PDFViewer documentId={DOC_ID} revision={2} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("returns to the placeholder when the document is cleared", async () => {
    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF Preview")).toBeInTheDocument();
    });

    rerender(<PDFViewer documentId={null} revision={0} />);

    expect(screen.getByText(/to preview the PDF/i)).toBeInTheDocument();
    expect(screen.queryByTitle("PDF Preview")).not.toBeInTheDocument();
  });

  it("renders error state when the PDF can't be read", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Failed to read compiled PDF: not found");

    render(<PDFViewer documentId={DOC_ID} revision={1} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Failed to load PDF: Failed to read compiled PDF/);
    });
  });

  it("ignores a response that arrives after the document changed", async () => {
    let resolveFirst: (value: string) => void = () => {};
    vi.mocked(invoke)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve as (v: string) => void)))
      .mockResolvedValueOnce("U0VDT05E");

    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);
    rerender(<PDFViewer documentId="b1b2b3b4-b1b2-c1c2-d1d2-d3d4d5d6d7d8" revision={2} />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF Preview").getAttribute("src")).toContain("U0VDT05E");
    });
    resolveFirst("RklSU1Q=");
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTitle("PDF Preview").getAttribute("src")).toContain("U0VDT05E");
  });

  it("renders compiling indicator badge when isCompiling is true and pdf is loaded", async () => {
    render(<PDFViewer documentId={DOC_ID} revision={1} isCompiling={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-compiling-indicator")).toBeInTheDocument();
      expect(screen.getByText(/Updating preview.../i)).toBeInTheDocument();
    });
  });

  it("shows a compiling message instead of the placeholder hint while the first compile runs", () => {
    render(<PDFViewer documentId={null} revision={0} isCompiling={true} />);
    expect(screen.getByText(/Compiling your document/i)).toBeInTheDocument();
  });
});
