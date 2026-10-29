// Loaded lazily by PDFViewer. The legacy build supports older system webviews
// (e.g. WKWebView on older macOS), which the modern build doesn't.
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  url: string;
  /** Page size in CSS pixels at the requested width. */
  width: number;
  height: number;
}

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Renders every page of a PDF to an image `cssWidth` CSS pixels wide (at the
 * screen's pixel density). Callers own the returned object URLs.
 */
export async function renderPdfPages(base64: string, cssWidth: number): Promise<RenderedPage[]> {
  const pdf = await getDocument({
    data: decodeBase64(base64),
    // Keep working under the app's Content-Security-Policy (no 'unsafe-eval').
    isEvalSupported: false,
  }).promise;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const pages: RenderedPage[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const cssScale = cssWidth / base.width;
      const viewport = page.getViewport({ scale: cssScale * dpr });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is not available");

      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not encode page image");

      pages.push({
        url: URL.createObjectURL(blob),
        width: cssWidth,
        height: base.height * cssScale,
      });
      page.cleanup();
    }
  } catch (err) {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    throw err;
  } finally {
    await pdf.destroy();
  }
  return pages;
}
