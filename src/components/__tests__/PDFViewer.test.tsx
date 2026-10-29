import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PDFViewer from "../PDFViewer";
import { invoke } from "@tauri-apps/api/tauri";
import { renderPdfPages } from "../../utils/pdfRenderer";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
}));

// PDF.js needs a real canvas; tests control what the renderer returns.
vi.mock("../../utils/pdfRenderer", () => ({
  renderPdfPages: vi.fn(),
}));

const DOC_ID = "a1a2a3a4-b1b2-c1c2-d1d2-d3d4d5d6d7d8";

describe("PDFViewer component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue("JVBERi0xLjQ=");
    vi.mocked(renderPdfPages).mockImplementation(async (_b64, width) => [
      { url: "blob:page-1", width, height: width * 1.3 },
      { url: "blob:page-2", width, height: width * 1.3 },
    ]);
  });

  it("shows the empty mat message when there is no compiled document", () => {
    render(<PDFViewer documentId={null} revision={0} emptyMessage="Create a resume to see it here." />);
    expect(screen.getByText("Create a resume to see it here.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("requests the PDF by document id and renders each page as a sheet", async () => {
    render(<PDFViewer documentId={DOC_ID} revision={1} />);

    const pages = await screen.findAllByRole("img");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveAttribute("alt", "Page 1 of 2");
    expect(pages[0]).toHaveAttribute("src", "blob:page-1");
    expect(invoke).toHaveBeenCalledWith("read_pdf_bytes", { id: DOC_ID });
    expect(renderPdfPages).toHaveBeenCalledWith("JVBERi0xLjQ=", expect.any(Number));
  });

  it("falls back to the built-in PDF viewer when rendering fails", async () => {
    vi.mocked(renderPdfPages).mockRejectedValue(new Error("no canvas"));
    render(<PDFViewer documentId={DOC_ID} revision={1} />);

    await waitFor(() => {
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe.getAttribute("src")).toBe("data:application/pdf;base64,JVBERi0xLjQ=");
    });
  });

  it("reloads when the revision changes", async () => {
    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    rerender(<PDFViewer documentId={DOC_ID} revision={2} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it("returns to the empty message when the document is cleared", async () => {
    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);
    await screen.findAllByRole("img");

    rerender(<PDFViewer documentId={null} revision={0} emptyMessage="Nothing here" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("explains when the PDF can't be read", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("Failed to read compiled PDF: not found");

    render(<PDFViewer documentId={DOC_ID} revision={1} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /The preview couldn't be loaded: Failed to read compiled PDF/
      );
    });
  });

  it("ignores a response that arrives after the document changed", async () => {
    let resolveFirst: (value: string) => void = () => {};
    vi.mocked(invoke)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve as (v: string) => void)))
      .mockResolvedValueOnce("U0VDT05E");

    const { rerender } = render(<PDFViewer documentId={DOC_ID} revision={1} />);
    rerender(<PDFViewer documentId="b1b2b3b4-b1b2-c1c2-d1d2-d3d4d5d6d7d8" revision={2} />);

    await waitFor(() => expect(renderPdfPages).toHaveBeenCalledWith("U0VDT05E", expect.any(Number)));
    resolveFirst("RklSU1Q=");
    await new Promise((r) => setTimeout(r, 0));
    expect(renderPdfPages).not.toHaveBeenCalledWith("RklSU1Q=", expect.any(Number));
  });

  it("announces updates while a new build is running", async () => {
    render(<PDFViewer documentId={DOC_ID} revision={1} isCompiling={true} />);

    await screen.findAllByRole("img");
    expect(screen.getByTestId("pdf-compiling-indicator")).toHaveTextContent("Updating preview");
  });
});
