import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/api/shell";
import { useDialog } from "../hooks/useDialog";
import { TexInstallProgress, TexStatus } from "../types";

interface SetupGuideProps {
  onClose: () => void;
}

type InstallState = "idle" | "installing" | "failed";

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        open(href).catch((err) => console.error("Failed to open URL in browser:", err));
      }}
    >
      {children}
    </a>
  );
}

function CommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(command)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  };
  return (
    <div className="command-row">
      <pre className="command-block">{command}</pre>
      <button type="button" className="btn btn-small" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function SetupGuide({ onClose }: SetupGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState<TexStatus | null>(null);
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [progress, setProgress] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [smallInstall, setSmallInstall] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const installing = installState === "installing";
  const dialogRef = useDialog<HTMLDivElement>(() => {
    if (!installing) onClose();
  });

  useEffect(() => {
    invoke<TexStatus>("get_tex_status")
      .then(setStatus)
      .catch((err) => console.error("Failed to read LaTeX status:", err));
  }, []);

  const userAgent = navigator.userAgent.toLowerCase();
  const platform =
    status?.platform ?? (userAgent.includes("win") ? "windows" : userAgent.includes("mac") ? "macos" : "linux");
  const installed = status?.installed === true;
  const lastStep = 2;

  const installMiktex = async () => {
    setInstallState("installing");
    setInstallError(null);
    setProgress("Starting…");
    const unlisten = await listen<TexInstallProgress>("tex-install-progress", (event) =>
      setProgress(event.payload.message)
    ).catch(() => null);
    try {
      await invoke("install_miktex", { packageSet: smallInstall ? "essential" : "basic" });
      setStatus(await invoke<TexStatus>("get_tex_status"));
      setInstallState("idle");
      setCurrentStep(lastStep);
    } catch (err) {
      setInstallError(String(err));
      setInstallState("failed");
    } finally {
      unlisten?.();
    }
  };

  const checkAgain = async () => {
    setChecking(true);
    setCheckMessage(null);
    try {
      const next = await invoke<TexStatus>("get_tex_status");
      setStatus(next);
      if (next.installed) {
        setCurrentStep(lastStep);
      } else {
        setCheckMessage("LaTeX still isn't detected. Finish the installation, then check again.");
      }
    } catch (err) {
      setCheckMessage(`Couldn't check: ${err}`);
    } finally {
      setChecking(false);
    }
  };

  const checkAgainButton = (
    <button type="button" className="btn" onClick={checkAgain} disabled={checking || installing}>
      {checking ? "Checking…" : "Check again"}
    </button>
  );

  const steps = [
    {
      title: "Vitae needs LaTeX",
      content: (
        <>
          <p>
            Vitae turns your resume into a PDF with LaTeX, the typesetting system used for
            academic papers and books. It runs on your computer, so nothing is uploaded.
          </p>
          <p>LaTeX isn't installed yet. The next step gets it set up.</p>
        </>
      ),
    },
    {
      title: "Install LaTeX",
      content: (
        <>
          {platform === "windows" && (
            <>
              <p>
                Vitae can install <strong>MiKTeX</strong> for you. It installs for your account only, so
                Windows won't ask for administrator rights.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={smallInstall}
                  disabled={installing}
                  onChange={(e) => setSmallInstall(e.target.checked)}
                />
                Smaller install: essentials only, extra packages download when a template needs them
              </label>
              <div className="setup-actions">
                <button type="button" className="btn btn-primary" onClick={installMiktex} disabled={installing}>
                  {installState === "failed" ? "Try again" : installing ? "Installing…" : "Install MiKTeX"}
                </button>
                {checkAgainButton}
              </div>
              {installing && (
                <div className="install-progress" role="status">
                  <div className="progress-bar" aria-hidden="true">
                    <span />
                  </div>
                  <p>{progress}</p>
                  <p className="muted">Keep Vitae open until this finishes.</p>
                </div>
              )}
              {installState === "failed" && (
                <p className="setup-error" role="alert">
                  {installError} You can also install it yourself from{" "}
                  <ExternalLink href="https://miktex.org/download">miktex.org/download</ExternalLink>, then
                  choose Check again.
                </p>
              )}
            </>
          )}
          {platform === "macos" && (
            <>
              <p>Install a TeX distribution, then come back and choose Check again:</p>
              <ul className="option-list">
                <li>
                  <strong>BasicTeX</strong> (about 100 MB, recommended). Vitae adds the packages it needs.{" "}
                  <ExternalLink href="https://www.tug.org/mactex/morepackages.html">Download BasicTeX</ExternalLink>
                </li>
                <li>
                  <strong>MacTeX</strong> (about 4 to 5 GB). Everything included.{" "}
                  <ExternalLink href="https://www.tug.org/mactex/">Download MacTeX</ExternalLink>
                </li>
              </ul>
              <p className="muted">Or, if you use Homebrew, run this in Terminal:</p>
              <CommandBlock command="brew install --cask basictex" />
              <div className="setup-actions">{checkAgainButton}</div>
            </>
          )}
          {platform === "linux" && (
            <>
              <p>
                Run this in a terminal
                {status?.linux_command ? ` (detected: ${status.linux_command.manager})` : ""}, then choose Check
                again:
              </p>
              <CommandBlock
                command={
                  status?.linux_command?.command ??
                  `# Ubuntu or Debian\nsudo apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended\n\n# Fedora\nsudo dnf install texlive-scheme-medium\n\n# Arch Linux\nsudo pacman -S texlive-core texlive-latexextra`
                }
              />
              <div className="setup-actions">{checkAgainButton}</div>
            </>
          )}
          {checkMessage && (
            <p className="muted" role="status">
              {checkMessage}
            </p>
          )}
        </>
      ),
    },
    {
      title: "You're all set",
      content: (
        <>
          <p>
            LaTeX is installed{status?.kind === "miktex" ? " (MiKTeX)" : ""}. There's no need to restart
            Vitae.
          </p>
          <p>
            The preview now updates as you type, and <strong>Export PDF</strong> saves a copy you can send.
            If a template needs extra packages, Vitae installs them for you. You can review and remove them
            under <strong>Settings → LaTeX packages</strong>.
          </p>
        </>
      ),
    },
  ];

  const isLast = currentStep === lastStep;

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-guide-title"
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 id="setup-guide-title">{steps[currentStep].title}</h2>
          <span className="step-count">
            Step {currentStep + 1} of {steps.length}
          </span>
        </div>
        <div className="dialog-body prose">{steps[currentStep].content}</div>
        <div className="dialog-foot">
          {currentStep > 0 ? (
            <button
              type="button"
              onClick={() => setCurrentStep(currentStep - 1)}
              className="btn"
              disabled={installing}
            >
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose} className="btn">
              Not now
            </button>
          )}
          {isLast ? (
            <button type="button" onClick={onClose} className="btn btn-primary">
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCurrentStep(currentStep + 1)}
              className="btn btn-primary"
              disabled={currentStep === 1 && !installed}
              title={currentStep === 1 && !installed ? "Install LaTeX first" : undefined}
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupGuide;
