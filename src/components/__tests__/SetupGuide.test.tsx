import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SetupGuide from "../SetupGuide";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { TexStatus } from "../../types";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/shell", () => ({ open: vi.fn() }));

const missing = (platform: TexStatus["platform"], linux_command: TexStatus["linux_command"] = null): TexStatus => ({
  installed: false,
  kind: null,
  platform,
  linux_command,
});
const present: TexStatus = { installed: true, kind: "miktex", platform: "windows", linux_command: null };

/** Routes invoke() by command name; later calls to get_tex_status walk through `statuses`. */
function mockBackend(statuses: TexStatus[], extra: Record<string, () => unknown> = {}) {
  let call = 0;
  (invoke as any).mockImplementation((cmd: string) => {
    if (cmd === "get_tex_status") return Promise.resolve(statuses[Math.min(call++, statuses.length - 1)]);
    if (extra[cmd]) return Promise.resolve(extra[cmd]());
    return Promise.reject(new Error(`unexpected command ${cmd}`));
  });
}

async function goToInstallStep() {
  fireEvent.click(screen.getByText("Next"));
  await screen.findByText("Install LaTeX");
}

describe("SetupGuide component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (listen as any).mockResolvedValue(() => {});
  });

  it("can be dismissed from the first step", async () => {
    mockBackend([missing("windows")]);
    const onClose = vi.fn();
    render(<SetupGuide onClose={onClose} />);
    expect(screen.getByText("Vitae needs LaTeX")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Not now"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Next disabled on the install step until LaTeX is detected", async () => {
    mockBackend([missing("windows")]);
    render(<SetupGuide onClose={vi.fn()} />);
    await goToInstallStep();
    expect(screen.getByText("Next")).toBeDisabled();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Vitae needs LaTeX")).toBeInTheDocument();
  });

  it("installs MiKTeX with one click on Windows, shows progress and finishes", async () => {
    let finishInstall: () => void = () => {};
    let progressHandler: (e: { payload: { phase: string; message: string } }) => void = () => {};
    (listen as any).mockImplementation((_event: string, handler: typeof progressHandler) => {
      progressHandler = handler;
      return Promise.resolve(() => {});
    });
    mockBackend([missing("windows"), present], {
      install_miktex: () => new Promise<void>((resolve) => (finishInstall = resolve)),
    });
    const onClose = vi.fn();
    render(<SetupGuide onClose={onClose} />);
    await goToInstallStep();

    fireEvent.click(screen.getByText("Install MiKTeX"));
    expect(await screen.findByRole("status")).toHaveTextContent("Starting");
    await waitFor(() => expect(listen).toHaveBeenCalled());
    progressHandler({ payload: { phase: "download", message: "Downloading MiKTeX packages." } });
    expect(await screen.findByText("Downloading MiKTeX packages.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("install_miktex", { packageSet: "basic" });

    finishInstall();
    expect(await screen.findByText("You're all set")).toBeInTheDocument();
    expect(screen.getByText(/no need to restart/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses the essential package set when the smaller install is chosen", async () => {
    mockBackend([missing("windows"), present], { install_miktex: () => undefined });
    render(<SetupGuide onClose={vi.fn()} />);
    await goToInstallStep();
    fireEvent.click(screen.getByLabelText(/smaller install/i));
    fireEvent.click(screen.getByText("Install MiKTeX"));
    await screen.findByText("You're all set");
    expect(invoke).toHaveBeenCalledWith("install_miktex", { packageSet: "essential" });
  });

  it("explains a failed install and offers a retry and the manual download", async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === "get_tex_status" ? Promise.resolve(missing("windows")) : Promise.reject("The MiKTeX packages couldn't be downloaded.")
    );
    render(<SetupGuide onClose={vi.fn()} />);
    await goToInstallStep();
    fireEvent.click(screen.getByText("Install MiKTeX"));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be downloaded");
    expect(screen.getByText("miktex.org/download")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeEnabled();
  });

  it("shows the detected distro's command on Linux and moves on after Check again", async () => {
    mockBackend(
      [
        missing("linux", { manager: "apt", command: "sudo apt-get install texlive-latex-base" }),
        missing("linux"),
        { installed: true, kind: "texlive", platform: "linux", linux_command: null },
      ]
    );
    render(<SetupGuide onClose={vi.fn()} />);
    await screen.findByText(/Next/);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_tex_status"));
    await goToInstallStep();
    expect(await screen.findByText("sudo apt-get install texlive-latex-base")).toBeInTheDocument();
    expect(screen.getByText(/detected: apt/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Check again"));
    expect(await screen.findByText(/still isn't detected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Check again"));
    expect(await screen.findByText("You're all set")).toBeInTheDocument();
  });

  it("offers BasicTeX and MacTeX on macOS", async () => {
    mockBackend([missing("macos")]);
    render(<SetupGuide onClose={vi.fn()} />);
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    await goToInstallStep();
    expect(await screen.findByText("Download BasicTeX")).toBeInTheDocument();
    expect(screen.getByText("Download MacTeX")).toBeInTheDocument();
    expect(screen.getByText("brew install --cask basictex")).toBeInTheDocument();
  });

  it("ignores Escape while an install is running", async () => {
    (invoke as any).mockImplementation((cmd: string) =>
      cmd === "get_tex_status" ? Promise.resolve(missing("windows")) : new Promise(() => {})
    );
    const onClose = vi.fn();
    render(<SetupGuide onClose={onClose} />);
    await goToInstallStep();
    fireEvent.click(screen.getByText("Install MiKTeX"));
    await screen.findByRole("status");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
