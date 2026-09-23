import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UpdateChecker from "../UpdateChecker";
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

describe("UpdateChecker component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not render when no update is available", async () => {
    (invoke as any).mockResolvedValueOnce({
      should_update: false,
    });

    render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
    });
  });

  it("renders update banner when an update is available", async () => {
    (invoke as any).mockResolvedValueOnce({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Important bug fixes for compilation",
    });

    render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeInTheDocument();
      expect(screen.getByText("BETA")).toBeInTheDocument();
      expect(
        screen.getByText(/Version 1.1.0-beta.2 is ready to install/i)
      ).toBeInTheDocument();
    });
  });

  it("allows dismissing the banner with 'Later'", async () => {
    (invoke as any).mockResolvedValueOnce({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Release notes",
    });

    render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Later"));

    await waitFor(() => {
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
    });
  });

  it("clears update banner when switching to a channel with no updates (stale banner bug)", async () => {
    // 1. Beta has an update
    (invoke as any).mockResolvedValueOnce({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Beta release notes",
    });

    const { rerender } = render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeInTheDocument();
    });

    // 2. Stable has NO update
    (invoke as any).mockResolvedValueOnce({
      should_update: false,
    });

    rerender(<UpdateChecker channel="stable" />);

    await waitFor(() => {
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
    });
  });

  it("does not check for updates when auto-update is disabled", async () => {
    localStorage.setItem("vitae_auto_update", "false");

    render(<UpdateChecker channel="beta" />);

    expect(invoke).not.toHaveBeenCalledWith("check_update_custom", expect.anything());
    expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
  });

  it("handles update installation and triggers relaunch", async () => {
    const { relaunch } = await import("@tauri-apps/api/process");
    (invoke as any).mockResolvedValueOnce({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Release notes",
    });

    render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeInTheDocument();
    });

    (invoke as any).mockResolvedValueOnce(undefined); // install_update_custom

    fireEvent.click(screen.getByText("Update Now"));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("install_update_custom", { channel: "beta" });
      expect(relaunch).toHaveBeenCalled();
    });
  });

  it("cancels in-flight update check when channel switches before response arrives", async () => {
    let resolveBeta: (val: any) => void;
    const betaPromise = new Promise((resolve) => {
      resolveBeta = resolve;
    });

    (invoke as any).mockImplementationOnce(() => betaPromise);

    const { rerender } = render(<UpdateChecker channel="beta" />);

    // Now switch channel to stable before beta resolves
    (invoke as any).mockResolvedValueOnce({
      should_update: false,
    });

    rerender(<UpdateChecker channel="stable" />);

    // Now resolve beta with an update
    resolveBeta!({
      should_update: true,
      version: "1.1.0-beta.2",
      date: "2026-09-22T00:00:00Z",
      body: "Beta release notes",
    });

    // Stable has no update, and the late beta response should NOT show the banner
    await waitFor(() => {
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument();
    });
  });

  it("falls back to GitHub Releases when check_update_custom fails and shows banner", async () => {
    (invoke as any).mockRejectedValueOnce(new Error("Could not fetch a valid release JSON from the remote."));

    const mockReleases = [
      {
        tag_name: "v1.1.0-beta.99",
        published_at: "2026-09-23T00:00:00Z",
        body: "Exciting new features",
        prerelease: true,
        assets: [
          {
            name: "Vitae_1.1.0-beta.99_x64-setup.exe",
            browser_download_url: "https://github.com/TheJonathanC/vitae/releases/download/v1.1.0-beta.99/Vitae_1.1.0-beta.99_x64-setup.exe",
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

    render(<UpdateChecker channel="beta" />);

    await waitFor(() => {
      expect(screen.getByTestId("update-banner")).toBeInTheDocument();
      expect(screen.getByText(/Version v1.1.0-beta.99 is available to download/i)).toBeInTheDocument();
      expect(screen.getByText("Download")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });
});
