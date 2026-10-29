import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SettingsModal from "../SettingsModal";
import { invoke } from "@tauri-apps/api/tauri";

vi.mock("@tauri-apps/api/tauri", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/process", () => ({
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/shell", () => ({
  open: vi.fn(),
}));

describe("SettingsModal component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("renders with the current channel selected", () => {
    render(
      <SettingsModal
        onClose={vi.fn()}
        currentChannel="beta"
        onChannelChange={vi.fn()}
      />
    );

    expect(screen.getByText("Release channel")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Stable (recommended)")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /settings/i })).toBeInTheDocument();

    const betaRadio = screen.getByDisplayValue("beta") as HTMLInputElement;
    expect(betaRadio.checked).toBe(true);
  });

  it("allows switching between beta and stable channels", () => {
    const handleChannelChange = vi.fn();
    render(
      <SettingsModal
        onClose={vi.fn()}
        currentChannel="beta"
        onChannelChange={handleChannelChange}
      />
    );

    const stableCard = screen.getByText("Stable (recommended)");
    fireEvent.click(stableCard);

    expect(handleChannelChange).toHaveBeenCalledTimes(1);
    expect(handleChannelChange).toHaveBeenCalledWith("stable");
    expect(localStorage.getItem("vitae_channel")).toBe("stable");
  });

  it("triggers manual update check and shows status", async () => {
    (invoke as any).mockResolvedValueOnce({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Fixed compiler issues",
    });

    render(
      <SettingsModal
        onClose={vi.fn()}
        currentChannel="beta"
        onChannelChange={vi.fn()}
      />
    );

    const checkBtn = screen.getByText("Check for updates");
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_update_custom", {
        channel: "beta",
      });
      expect(
        screen.getByText(/Version 1.1.0-beta.2 is available\./i)
      ).toBeInTheDocument();
      expect(screen.getByText("Install 1.1.0-beta.2")).toBeInTheDocument();
    });
  });

  it("falls back to GitHub Releases when updater JSON is missing and shows available update", async () => {
    (invoke as any).mockRejectedValueOnce("Could not fetch a valid release JSON from the remote.");

    // Mock fetch for GitHub Releases API
    const mockReleases = [
      {
        tag_name: "v1.2.0-beta.9",
        published_at: "2026-09-23T00:00:00Z",
        body: "New features",
        prerelease: true,
        assets: [
          {
            name: "Vitae_1.2.0-beta.9_x64-setup.exe",
            browser_download_url: "https://github.com/TheJonathanC/vitae/releases/download/v1.2.0-beta.9/Vitae_1.2.0-beta.9_x64-setup.exe",
          },
        ],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockReleases,
      })
    );

    render(
      <SettingsModal
        onClose={vi.fn()}
        currentChannel="beta"
        onChannelChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Check for updates"));

    await waitFor(() => {
      expect(screen.getByText(/Version v1.2.0-beta.9 is available to download/i)).toBeInTheDocument();
      expect(screen.getByText("Download v1.2.0-beta.9")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("ignores non-version tags and releases older than the installed version", async () => {
    (invoke as any).mockRejectedValueOnce("Could not fetch a valid release JSON from the remote.");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { tag_name: "latest-beta", prerelease: true, assets: [] },
          { tag_name: "v1.1.0-beta.99", prerelease: true, assets: [] },
          { tag_name: "v1.1.2", prerelease: false, assets: [] },
        ],
      })
    );

    render(<SettingsModal onClose={vi.fn()} currentChannel="beta" onChannelChange={vi.fn()} />);
    fireEvent.click(screen.getByText("Check for updates"));

    await waitFor(() => {
      expect(screen.getByText(/You have the latest version \(v1.1.2\)/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Download/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("closes on Escape", () => {
    const handleClose = vi.fn();
    render(<SettingsModal onClose={handleClose} currentChannel="stable" onChannelChange={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("shows friendly message when updater manifest is missing and GitHub API fails", async () => {
    (invoke as any).mockRejectedValueOnce("Could not fetch a valid release JSON from the remote.");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new Error("Network offline"))
    );

    render(
      <SettingsModal
        onClose={vi.fn()}
        currentChannel="beta"
        onChannelChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Check for updates"));

    await waitFor(() => {
      expect(
        screen.getByText(/Updates for this channel aren't published yet. You can check https:\/\/github.com\/TheJonathanC\/vitae\/releases instead./i)
      ).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("calls onClose when 'Done' or '×' is clicked", () => {
    const handleClose = vi.fn();
    render(
      <SettingsModal
        onClose={handleClose}
        currentChannel="beta"
        onChannelChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Done"));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
