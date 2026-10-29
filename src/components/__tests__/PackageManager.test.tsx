import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import PackageManager from "../PackageManager";
import { invoke } from "@tauri-apps/api/tauri";
import { TexOverview } from "../../types";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));

const overview = (names: string[] = ["sourcesanspro", "titlesec", "amsmath"]): TexOverview => ({
  kind: "miktex",
  total_bytes: 1_250_000_000,
  packages: names.map((name, i) => ({ name, size_bytes: (names.length - i) * 1_000_000, core: name === "amsmath" })),
});

describe("PackageManager component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows total size and packages with their sizes", async () => {
    (invoke as any).mockResolvedValue(overview());
    render(<PackageManager onClose={vi.fn()} />);
    expect(await screen.findByText("sourcesanspro")).toBeInTheDocument();
    expect(screen.getByText(/1\.3 GB/)).toBeInTheDocument();
    expect(screen.getByText(/with 3 packages/)).toBeInTheDocument();
    expect(screen.getByText("3.0 MB")).toBeInTheDocument();
  });

  it("filters the list by name", async () => {
    (invoke as any).mockResolvedValue(overview());
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("sourcesanspro");
    fireEvent.change(screen.getByLabelText("Filter packages"), { target: { value: "title" } });
    expect(screen.queryByText("sourcesanspro")).not.toBeInTheDocument();
    expect(screen.getByText("titlesec")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter packages"), { target: { value: "zzz" } });
    expect(screen.getByText("No packages match.")).toBeInTheDocument();
  });

  it("marks core packages and gives them no Remove button", async () => {
    (invoke as any).mockResolvedValue(overview());
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("amsmath");
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.queryByLabelText("Remove amsmath")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Remove titlesec")).toBeInTheDocument();
  });

  it("asks for confirmation, removes the package and reloads the list", async () => {
    let removed = false;
    (invoke as any).mockImplementation((cmd: string) => {
      if (cmd === "get_tex_overview") return Promise.resolve(overview(removed ? ["titlesec", "amsmath"] : undefined));
      if (cmd === "remove_tex_package") {
        removed = true;
        return Promise.resolve();
      }
      return Promise.reject(new Error(cmd));
    });
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("sourcesanspro");

    fireEvent.click(screen.getByLabelText("Remove sourcesanspro"));
    expect(invoke).not.toHaveBeenCalledWith("remove_tex_package", expect.anything());
    fireEvent.click(screen.getByText("Confirm remove"));

    await waitFor(() => expect(screen.queryByText("sourcesanspro")).not.toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("remove_tex_package", { name: "sourcesanspro" });
    expect(screen.getByText("Removed sourcesanspro.")).toBeInTheDocument();
  });

  it("lets the user back out of a removal", async () => {
    (invoke as any).mockResolvedValue(overview());
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("titlesec");
    fireEvent.click(screen.getByLabelText("Remove titlesec"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByLabelText("Remove titlesec")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("remove_tex_package", expect.anything());
  });

  it("reports a failed removal without losing the list", async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === "get_tex_overview" ? Promise.resolve(overview()) : Promise.reject("`titlesec` couldn't be removed.")
    );
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("titlesec");
    fireEvent.click(screen.getByLabelText("Remove titlesec"));
    fireEvent.click(screen.getByText("Confirm remove"));
    expect(await screen.findByText("`titlesec` couldn't be removed.")).toBeInTheDocument();
    expect(screen.getByText("titlesec")).toBeInTheDocument();
  });

  it("shows an error when LaTeX isn't installed", async () => {
    (invoke as any).mockRejectedValue("LaTeX isn't installed yet.");
    render(<PackageManager onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("LaTeX isn't installed yet.");
  });

  it("caps very long lists", async () => {
    const names = Array.from({ length: 250 }, (_, i) => `pkg${i}`);
    (invoke as any).mockResolvedValue(overview(names));
    render(<PackageManager onClose={vi.fn()} />);
    await screen.findByText("pkg0");
    const list = screen.getByRole("list", { name: "Installed packages" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(200);
    expect(screen.getByText(/Showing the largest 200 of 250/)).toBeInTheDocument();
  });
});
