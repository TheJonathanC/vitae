import { useState } from "react";

interface SetupGuideProps {
  onClose: () => void;
}

function SetupGuide({ onClose }: SetupGuideProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const isWindows = navigator.platform.toLowerCase().includes("win");
  const isMac = navigator.platform.toLowerCase().includes("mac");
  const isLinux = !isWindows && !isMac;

  const steps = [
    {
      title: "Welcome to Vitae!",
      content: (
        <div>
          <p style={{ marginBottom: "16px" }}>
            Vitae is a powerful LaTeX editor that compiles documents locally on
            your computer.
          </p>
          <p style={{ marginBottom: "16px" }}>
            To compile LaTeX documents, you need to install a LaTeX distribution
            on your system.
          </p>
          <p style={{ color: "#858585" }}>
            Don't worry - we'll guide you through the process!
          </p>
        </div>
      ),
    },
    {
      title: "Install LaTeX Distribution",
      content: (
        <div>
          {isWindows && (
            <>
              <h3 style={{ marginBottom: "12px", color: "#cccccc" }}>
                For Windows - MiKTeX (Recommended)
              </h3>
              <ol style={{ marginLeft: "20px", marginBottom: "16px" }}>
                <li style={{ marginBottom: "8px" }}>
                  Download MiKTeX from{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open("https://miktex.org/download");
                    }}
                    style={{ color: "#0e639c", textDecoration: "underline" }}
                  >
                    miktex.org/download
                  </a>
                </li>
                <li style={{ marginBottom: "8px" }}>
                  Run the installer (MiKTeX Setup)
                </li>
                <li style={{ marginBottom: "8px" }}>
                  Choose "Install MiKTeX for all users" or "for yourself"
                </li>
                <li style={{ marginBottom: "8px" }}>
                  <strong>Important:</strong> Set "Install missing packages
                  on-the-fly" to <strong>Yes</strong>
                </li>
                <li style={{ marginBottom: "8px" }}>
                  Complete the installation
                </li>
                <li style={{ marginBottom: "8px" }}>
                  <strong>Restart Vitae</strong> after installation
                </li>
              </ol>
              <p style={{ color: "#858585", fontSize: "0.9em" }}>
                Installation size: ~200-500 MB
              </p>
            </>
          )}
          {isMac && (
            <>
              <h3 style={{ marginBottom: "12px", color: "#cccccc" }}>
                For macOS - MacTeX
              </h3>
              <ol style={{ marginLeft: "20px", marginBottom: "16px" }}>
                <li style={{ marginBottom: "8px" }}>
                  Download MacTeX from{" "}
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open("https://www.tug.org/mactex/");
                    }}
                    style={{ color: "#0e639c", textDecoration: "underline" }}
                  >
                    tug.org/mactex
                  </a>
                </li>
                <li style={{ marginBottom: "8px" }}>
                  Run the MacTeX.pkg installer
                </li>
                <li style={{ marginBottom: "8px" }}>
                  Follow the installation wizard
                </li>
                <li style={{ marginBottom: "8px" }}>
                  <strong>Restart Vitae</strong> after installation
                </li>
              </ol>
              <p style={{ color: "#858585", fontSize: "0.9em" }}>
                Installation size: ~4-5 GB
              </p>
            </>
          )}
          {isLinux && (
            <>
              <h3 style={{ marginBottom: "12px", color: "#cccccc" }}>
                For Linux - TeX Live
              </h3>
              <p style={{ marginBottom: "12px" }}>
                Install using your package manager:
              </p>
              <div
                style={{
                  backgroundColor: "#1e1e1e",
                  padding: "12px",
                  borderRadius: "4px",
                  fontFamily: "monospace",
                  marginBottom: "16px",
                }}
              >
                <div style={{ marginBottom: "8px" }}>
                  # Ubuntu/Debian
                  <br />
                  sudo apt-get install texlive-latex-base texlive-latex-extra
                </div>
                <div style={{ marginBottom: "8px" }}>
                  # Fedora
                  <br />
                  sudo dnf install texlive-scheme-medium
                </div>
                <div>
                  # Arch Linux
                  <br />
                  sudo pacman -S texlive-core texlive-latexextra
                </div>
              </div>
              <p style={{ marginBottom: "8px" }}>
                <strong>Restart Vitae</strong> after installation
              </p>
            </>
          )}
        </div>
      ),
    },
    {
      title: "You're All Set!",
      content: (
        <div>
          <p style={{ marginBottom: "16px" }}>
            Once you've installed the LaTeX distribution and restarted Vitae,
            you'll be able to:
          </p>
          <ul style={{ marginLeft: "20px", marginBottom: "16px" }}>
            <li style={{ marginBottom: "8px" }}>
              ✅ Create and edit LaTeX documents
            </li>
            <li style={{ marginBottom: "8px" }}>
              ✅ Compile to PDF with live preview
            </li>
            <li style={{ marginBottom: "8px" }}>
              ✅ Export PDFs to share with others
            </li>
            <li style={{ marginBottom: "8px" }}>
              ✅ Work completely offline
            </li>
          </ul>
          <p style={{ color: "#858585" }}>
            If you've already installed LaTeX, restart Vitae to begin!
          </p>
        </div>
      ),
    },
  ];

  return (
    <div className="setup-overlay">
      <div className="setup-modal">
        <div className="setup-header">
          <h2>{steps[currentStep].title}</h2>
          <div className="setup-progress">
            Step {currentStep + 1} of {steps.length}
          </div>
        </div>
        <div className="setup-content">{steps[currentStep].content}</div>
        <div className="setup-footer">
          {currentStep > 0 && (
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="btn-secondary"
            >
              Back
            </button>
          )}
          <div style={{ flex: 1 }}></div>
          {currentStep < steps.length - 1 ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="btn-primary"
            >
              Next
            </button>
          ) : (
            <button onClick={onClose} className="btn-primary">
              Got It!
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SetupGuide;
