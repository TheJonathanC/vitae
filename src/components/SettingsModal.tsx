import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";
import { checkGithubReleases, RELEASES_PAGE_URL } from "../utils/updates";
import { useDialog } from "../hooks/useDialog";
import { IconX, IconDownload, IconSparkles, IconTerminal } from "./Icons";
import PackageManager from "./PackageManager";
import AiSettings from "./AiSettings";

type SectionId = "updates" | "ai" | "latex";

const SECTIONS: { id: SectionId; label: string; Icon: typeof IconX }[] = [
  { id: "updates", label: "Updates", Icon: IconDownload },
  { id: "ai", label: "AI assistant", Icon: IconSparkles },
  { id: "latex", label: "LaTeX", Icon: IconTerminal },
];

interface SettingsModalProps {
  onClose: () => void;
  currentChannel: string;
  onChannelChange: (newChannel: string) => void;
}

function SettingsModal({ onClose, currentChannel, onChannelChange }: SettingsModalProps) {
  const [channel, setChannel] = useState<string>(currentChannel);
  const [version, setVersion] = useState<string>(packageInfo.version);
  const [autoCheck, setAutoCheck] = useState<boolean>(() => {
    return localStorage.getItem("vitae_auto_update") !== "false";
  });
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<UpdateCheckResponse | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showPackages, setShowPackages] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("updates");
  const navClickedAt = useRef(0);
  const dialogRef = useDialog<HTMLDivElement>(onClose);

  useEffect(() => {
    getVersion()
      .then((v) => {
        if (v) setVersion(v);
      })
      .catch(() => {
        // Fallback to packageInfo.version
      });
  }, []);

  const handleChannelSelect = (selectedChannel: string) => {
    setChannel(selectedChannel);
    localStorage.setItem("vitae_channel", selectedChannel);
    onChannelChange(selectedChannel);
    setStatusMessage(null);
    setAvailableUpdate(null);
  };

  const handleAutoCheckToggle = (checked: boolean) => {
    setAutoCheck(checked);
    localStorage.setItem("vitae_auto_update", checked ? "true" : "false");
  };

  const checkForUpdates = async () => {
    setChecking(true);
    setStatusMessage("Checking for updates…");
    setAvailableUpdate(null);

    try {
      const res = await invoke<UpdateCheckResponse>("check_update_custom", { channel });
      if (res.should_update) {
        setAvailableUpdate(res);
        setStatusMessage(`Version ${res.version} is available.`);
      } else {
        setStatusMessage("You have the latest version.");
      }
    } catch (err: any) {
      console.warn("Primary updater endpoint check returned:", err);
      // Fallback: If updater manifest JSON is not found, check GitHub Releases directly
      let fallbackSuccess = false;
      try {
        const release = await checkGithubReleases(channel, version);
        if (release) {
          fallbackSuccess = true;
          if (release.should_update) {
            setAvailableUpdate(release);
            setStatusMessage(`Version ${release.version} is available to download.`);
          } else {
            setStatusMessage(`You have the latest version (${release.version}).`);
          }
        }
      } catch (ghErr) {
        console.error("GitHub Releases API fallback check failed:", ghErr);
      }

      if (!fallbackSuccess) {
        const errStr = String(err);
        if (errStr.includes("Could not fetch a valid release JSON") || errStr.includes("Could not fetch release manifest")) {
          setStatusMessage(`Updates for this channel aren't published yet. You can check ${RELEASES_PAGE_URL} instead.`);
        } else {
          setStatusMessage(`Couldn't check for updates: ${errStr}`);
        }
      }
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!availableUpdate) return;

    if (availableUpdate.download_url) {
      try {
        await open(availableUpdate.download_url);
        setStatusMessage("The download opened in your browser.");
      } catch (e) {
        console.error("Failed to open URL:", e);
        setStatusMessage(`Download it from ${availableUpdate.download_url}`);
      }
      return;
    }

    setInstalling(true);
    setStatusMessage("Downloading and installing the update…");

    try {
      await invoke("install_update_custom", { channel });
      setStatusMessage("Update installed. Restarting…");
      setTimeout(async () => {
        try {
          await relaunch();
        } catch (e) {
          console.error("Failed to relaunch:", e);
        }
      }, 1000);
    } catch (err) {
      console.error("Failed to install update:", err);
      try {
        await open(RELEASES_PAGE_URL);
        setStatusMessage(`The update couldn't be installed (${err}), so the releases page opened in your browser.`);
      } catch {
        setStatusMessage(`The update couldn't be installed: ${err}`);
      }
      setInstalling(false);
    }
  };

  const scrollToSection = (id: SectionId) => {
    setActiveSection(id);
    // Keep the clicked item highlighted while the smooth scroll runs; a short last
    // section can't reach the top, so the scroll position alone would pick another.
    navClickedAt.current = Date.now();
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Highlights the section the reader has scrolled to.
  const handleBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (Date.now() - navClickedAt.current < 1000) return;
    const body = e.currentTarget;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) {
      setActiveSection(SECTIONS[SECTIONS.length - 1].id);
      return;
    }
    let current: SectionId = SECTIONS[0].id;
    for (const section of SECTIONS) {
      const el = document.getElementById(`settings-${section.id}`);
      if (el && el.offsetTop - body.offsetTop <= body.scrollTop + 24) current = section.id;
    }
    setActiveSection(current);
  };

  return (
    <>
      <div className="dialog-backdrop" data-testid="settings-modal-overlay" onClick={onClose}>
        <div
          ref={dialogRef}
          className="dialog dialog-settings"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="dialog-head">
            <h2 id="settings-title">Settings</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <IconX size={18} />
            </button>
          </div>

          <div className="settings-layout">
            <nav className="settings-nav" aria-label="Settings sections">
              {SECTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  className={activeSection === id ? "active" : ""}
                  aria-current={activeSection === id ? "true" : undefined}
                  onClick={() => scrollToSection(id)}
                >
                  <Icon size={16} />
                  {label}
                </button>
              ))}
              <p className="settings-version">Vitae {version}</p>
            </nav>

            <div className="dialog-body settings-body" onScroll={handleBodyScroll}>
              <section className="settings-section" id="settings-updates" aria-labelledby="settings-updates-title">
                <div className="settings-section-head">
                  <h3 id="settings-updates-title">Updates</h3>
                  <p className="muted">
                    You're on Vitae {version}, {channel === "beta" ? "beta" : "stable"} channel.
                  </p>
                </div>

                <fieldset className="choice-group">
                  <legend>Release channel</legend>
                  <label className={`choice ${channel === "stable" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="update-channel"
                      value="stable"
                      checked={channel === "stable"}
                      onChange={() => handleChannelSelect("stable")}
                    />
                    <span className="choice-text">
                      <span className="choice-title">Stable (recommended)</span>
                      <span className="choice-desc">Tested releases only.</span>
                    </span>
                  </label>
                  <label className={`choice ${channel === "beta" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="update-channel"
                      value="beta"
                      checked={channel === "beta"}
                      onChange={() => handleChannelSelect("beta")}
                    />
                    <span className="choice-text">
                      <span className="choice-title">Beta</span>
                      <span className="choice-desc">New builds as soon as they're made. Expect rough edges.</span>
                    </span>
                  </label>
                </fieldset>

                <label className="settings-row">
                  <span className="settings-row-text">
                    <span className="settings-row-title">Check for updates when Vitae starts</span>
                    <span className="muted">You'll see a note at the top of the window when there's a new version.</span>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={autoCheck}
                      onChange={(e) => handleAutoCheckToggle(e.target.checked)}
                    />
                    <span className="switch-track" aria-hidden="true" />
                  </span>
                </label>

                <div className="update-check">
                  <button type="button" className="btn" onClick={checkForUpdates} disabled={checking || installing}>
                    {checking ? "Checking…" : "Check for updates"}
                  </button>
                  {availableUpdate && (
                    <button type="button" className="btn btn-primary" onClick={installUpdate} disabled={installing}>
                      {installing
                        ? "Installing…"
                        : availableUpdate.download_url
                          ? `Download ${availableUpdate.version}`
                          : `Install ${availableUpdate.version}`}
                    </button>
                  )}
                  {statusMessage && (
                    <p className="update-status" role="status">
                      {statusMessage}
                    </p>
                  )}
                </div>
              </section>

              <AiSettings />

              <section className="settings-section" id="settings-latex" aria-labelledby="settings-latex-title">
                <div className="settings-section-head">
                  <h3 id="settings-latex-title">LaTeX</h3>
                  <p className="muted">See how much space LaTeX packages use and remove the ones you don't need.</p>
                </div>
                <div>
                  <button type="button" className="btn" onClick={() => setShowPackages(true)}>
                    Manage LaTeX packages…
                  </button>
                </div>
              </section>
            </div>
          </div>

          <div className="dialog-foot">
            <button type="button" onClick={onClose} className="btn btn-primary">
              Done
            </button>
          </div>
        </div>
      </div>
      {showPackages && <PackageManager onClose={() => setShowPackages(false)} />}
    </>
  );
}

export default SettingsModal;
