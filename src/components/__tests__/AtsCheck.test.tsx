import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import AtsCheck from "../AtsCheck";
import { invoke } from "@tauri-apps/api/tauri";
import { extractPdfText } from "../../utils/pdfRenderer";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));
vi.mock("../../utils/pdfRenderer", () => ({ extractPdfText: vi.fn() }));

const GOOD =
  "Jane Doe\njane@example.com +1 555 019 2834\nEXPERIENCE\nEngineer 2022 2024\nEDUCATION\nBSc 2014 2018\nSKILLS\n" + "Go SQL ".repeat(60);
const SOURCE = "\\input{glyphtounicode}\\pdfgentounicode=1\\begin{document}x\\end{document}";

describe("AtsCheck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the compiled PDF and shows a checklist with a verdict", async () => {
    (invoke as any).mockResolvedValue("BASE64");
    (extractPdfText as any).mockResolvedValue({ text: GOOD, pages: 1 });
    render(<AtsCheck documentId="d1" latexSource={SOURCE} personal={{ name: "Jane Doe" }} onClose={vi.fn()} />);
    expect(await screen.findByText(/checks passed/)).toHaveTextContent("Ready");
    expect(invoke).toHaveBeenCalledWith("read_pdf_bytes", { id: "d1" });
    expect(extractPdfText).toHaveBeenCalledWith("BASE64");
    const list = screen.getByRole("list", { name: "Checks" });
    expect(within(list).getByText("Email found")).toBeInTheDocument();
    expect(within(list).getByText("Single-column layout")).toBeInTheDocument();
  });

  it("lists problems before passed checks", async () => {
    (invoke as any).mockResolvedValue("BASE64");
    (extractPdfText as any).mockResolvedValue({ text: GOOD.replace("jane@example.com", ""), pages: 1 });
    render(<AtsCheck documentId="d1" latexSource={SOURCE} personal={{ name: "Jane Doe" }} onClose={vi.fn()} />);
    await screen.findByText(/checks passed/);
    expect(screen.getByText(/checks passed/)).toHaveTextContent("Not ready");
    const first = within(screen.getByRole("list", { name: "Checks" })).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("No email found");
  });

  it("explains when the PDF can't be read", async () => {
    (invoke as any).mockRejectedValue("PDF not found. Please compile first.");
    render(<AtsCheck documentId="d1" latexSource={SOURCE} personal={{ name: "" }} onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be checked");
  });
});
