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

    expect(screen.getByText("Release Channel")).toBeInTheDocument();
    expect(screen.getByText("Beta Channel (Recommended)")).toBeInTheDocument();
    expect(screen.getByText("Stable Channel")).toBeInTheDocument();

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

    const stableCard = screen.getByText("Stable Channel");
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

    const checkBtn = screen.getByText("Check for Updates Now");
    fireEvent.click(checkBtn);

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("check_update_custom", {
        channel: "beta",
      });
      expect(
        screen.getByText(/Update 1.1.0-beta.2 is available!/i)
      ).toBeInTheDocument();
      expect(screen.getByText("Install 1.1.0-beta.2")).toBeInTheDocument();
    });
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

    fireEvent.click(screen.getByText("×"));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });
});
