import { useState } from "react";
import { open } from "@tauri-apps/api/shell";
import { useDialog } from "../hooks/useDialog";

interface SetupGuideProps {
  onClose: () => void;
}

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

function SetupGuide({ onClose }: SetupGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  const userAgent = navigator.userAgent.toLowerCase();
  const isWindows = userAgent.includes("win");
  const isMac = userAgent.includes("mac");
  const isLinux = !isWindows && !isMac;

  const steps = [
    {
      title: "Vitae needs LaTeX",
      content: (
        <>
          <p>
            Vitae turns your resume into a PDF with LaTeX, the typesetting system used for
            academic papers and books. It runs on your computer, so nothing is uploaded.
          </p>
          <p>LaTeX isn't installed yet. The next step shows how to install it.</p>
        </>
      ),
    },
    {
      title: "Install LaTeX",
      content: (
        <>
          {isWindows && (
            <>
              <p>
                Install <strong>MiKTeX</strong> (about 200 to 500 MB):
              </p>
              <ol className="steps-list">
                <li>
                  Download the installer from{" "}
                  <ExternalLink href="https://miktex.org/download">miktex.org/download</ExternalLink>.
                </li>
                <li>Run it and choose to install for yourself or for all users.</li>
                <li>
                  When asked about missing packages, choose <strong>Yes</strong> so they install
                  automatically.
                </li>
              </ol>
            </>
          )}
          {isMac && (
            <>
              <p>
                Install <strong>MacTeX</strong> (about 4 to 5 GB):
              </p>
              <ol className="steps-list">
                <li>
                  Download it from{" "}
                  <ExternalLink href="https://www.tug.org/mactex/">tug.org/mactex</ExternalLink>.
                </li>
                <li>Open MacTeX.pkg and follow the installer.</li>
              </ol>
              <p className="muted">
                Prefer something smaller? <code>brew install --cask basictex</code> installs BasicTeX
                (about 100 MB).
              </p>
            </>
          )}
          {isLinux && (
            <>
              <p>Install TeX Live with your package manager:</p>
              <pre className="command-block">
                {`# Ubuntu or Debian
sudo apt-get install texlive-latex-base texlive-latex-extra

# Fedora
sudo dnf install texlive-scheme-medium

# Arch Linux
sudo pacman -S texlive-core texlive-latexextra`}
              </pre>
            </>
          )}
        </>
      ),
    },
    {
      title: "Restart Vitae",
      content: (
        <>
          <p>When the installation finishes, quit and reopen Vitae.</p>
          <p>
            The preview then updates as you type, and <strong>Export PDF</strong> saves a copy you
            can send.
          </p>
        </>
      ),
    },
  ];

  const isLast = currentStep === steps.length - 1;

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
            <button type="button" onClick={() => setCurrentStep(currentStep - 1)} className="btn">
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
            <button type="button" onClick={() => setCurrentStep(currentStep + 1)} className="btn btn-primary">
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupGuide;
