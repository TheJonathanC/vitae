import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import PDFViewer, { uint8ArrayToBase64 } from "../PDFViewer";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("Command not found")),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
}));

vi.mock("@tauri-apps/api/fs", () => ({
  readBinaryFile: vi.fn().mockRejectedValue(new Error("File not found")),
}));

describe("PDFViewer component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders placeholder when pdfPath is null", () => {
    render(<PDFViewer pdfPath={null} />);
    expect(
      screen.getByText(/Compile your LaTeX document to preview the PDF/i)
    ).toBeInTheDocument();
  });

  it("renders iframe when pdfPath is provided", async () => {
    render(<PDFViewer pdfPath="C:/path/to/test.pdf" />);

    await waitFor(() => {
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe).toBeInTheDocument();
      expect(iframe.getAttribute("src")).toContain("asset://localhost/C:/path/to/test.pdf");
      expect(iframe.getAttribute("src")).toMatch(/\?t=\d+/);
    });
  });

  it("strips pre-existing query parameters before generating asset URL", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/tauri");
    render(<PDFViewer pdfPath="C:/path/to/test.pdf?t=999999" />);

    await waitFor(() => {
      expect(convertFileSrc).toHaveBeenCalledWith("C:/path/to/test.pdf");
    });
  });

  it("updates correctly when pdfPath changes from path to null", async () => {
    const { rerender } = render(<PDFViewer pdfPath="C:/path/to/test.pdf" />);

    await waitFor(() => {
      expect(screen.getByTitle("PDF Preview")).toBeInTheDocument();
    });

    rerender(<PDFViewer pdfPath={null} />);

    expect(
      screen.getByText(/Compile your LaTeX document to preview the PDF/i)
    ).toBeInTheDocument();
    expect(screen.queryByTitle("PDF Preview")).not.toBeInTheDocument();
  });

  it("renders error state when convertFileSrc throws", async () => {
    const { convertFileSrc } = await import("@tauri-apps/api/tauri");
    vi.mocked(convertFileSrc).mockImplementationOnce(() => {
      throw new Error("Conversion failed");
    });

    render(<PDFViewer pdfPath="C:/bad/path.pdf" />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load PDF: Error: Conversion failed/i)).toBeInTheDocument();
    });
  });

  it("renders compiling indicator badge when isCompiling is true and pdf is loaded", async () => {
    render(<PDFViewer pdfPath="C:/path/to/test.pdf" isCompiling={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("pdf-compiling-indicator")).toBeInTheDocument();
      expect(screen.getByText(/Updating preview.../i)).toBeInTheDocument();
    });
  });

  it("loads and renders PDF via read_pdf_bytes data URI to prevent asset.localhost errors", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const fakeBytes = new TextEncoder().encode("%PDF-1.4 test data");
    vi.mocked(invoke).mockResolvedValueOnce(Array.from(fakeBytes));

    render(<PDFViewer pdfPath="C:/path/to/resume.pdf" />);

    await waitFor(() => {
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe).toBeInTheDocument();
      expect(iframe.getAttribute("src")).toContain("data:application/pdf;base64,");
    });
  });

  it("falls back to readBinaryFile when read_pdf_bytes invoke fails", async () => {
    const { invoke } = await import("@tauri-apps/api/tauri");
    const { readBinaryFile } = await import("@tauri-apps/api/fs");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("invoke error"));
    const fakeBytes = new TextEncoder().encode("%PDF-1.4 fallback data");
    vi.mocked(readBinaryFile).mockResolvedValueOnce(fakeBytes);

    render(<PDFViewer pdfPath="C:/path/to/resume.pdf" />);

    await waitFor(() => {
      const iframe = screen.getByTitle("PDF Preview");
      expect(iframe).toBeInTheDocument();
      expect(iframe.getAttribute("src")).toContain("data:application/pdf;base64,");
    });
  });

  it("correctly encodes Uint8Array to base64 including chunks", () => {
    const sample = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(uint8ArrayToBase64(sample)).toBe(btoa("Hello"));

    // Larger buffer to exercise chunking
    const large = new Uint8Array(10000);
    for (let i = 0; i < large.length; i++) {
      large[i] = i % 256;
    }
    expect(uint8ArrayToBase64(large)).toBeDefined();
    expect(uint8ArrayToBase64(large).length).toBeGreaterThan(0);
  });
});
