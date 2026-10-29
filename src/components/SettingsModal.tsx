import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";
import { checkGithubReleases, RELEASES_PAGE_URL } from "../utils/updates";
import { useDialog } from "../hooks/useDialog";
import { IconSettings, IconX } from "./Icons";

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
    setStatusMessage("Checking for updates on the " + (channel === "beta" ? "Beta" : "Stable") + " channel...");
    setAvailableUpdate(null);

    try {
      const res = await invoke<UpdateCheckResponse>("check_update_custom", { channel });
      if (res.should_update) {
        setAvailableUpdate(res);
        setStatusMessage(`Update ${res.version} is available!`);
      } else {
        setStatusMessage("You are up to date! No new updates found.");
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
            setStatusMessage(`Update ${release.version} is available on GitHub!`);
          } else {
            setStatusMessage(`You are up to date! (${release.version} is the latest release)`);
          }
        }
      } catch (ghErr) {
        console.error("GitHub Releases API fallback check failed:", ghErr);
      }

      if (!fallbackSuccess) {
        const errStr = String(err);
        if (errStr.includes("Could not fetch a valid release JSON") || errStr.includes("Could not fetch release manifest")) {
          setStatusMessage(`No updater manifest found for this channel. Check ${RELEASES_PAGE_URL} for updates.`);
        } else {
          setStatusMessage(`Update check failed: ${errStr}`);
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
        setStatusMessage("Opened installer download in your browser.");
      } catch (e) {
        console.error("Failed to open URL:", e);
        setStatusMessage(`Download manually at: ${availableUpdate.download_url}`);
      }
      return;
    }

    setInstalling(true);
    setStatusMessage("Downloading and applying update...");

    try {
      await invoke("install_update_custom", { channel });
      setStatusMessage("Update installed successfully! Restarting...");
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
        setStatusMessage(`Direct installation failed (${err}). Opened releases page in browser.`);
      } catch {
        setStatusMessage(`Failed to install update: ${err}`);
      }
      setInstalling(false);
    }
  };

  return (
    <div className="setup-overlay" data-testid="settings-modal-overlay">
      <div
        ref={dialogRef}
        className="setup-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="setup-header">
          <h2 id="settings-title">
            <IconSettings size={18} aria-hidden="true" />
            <span>Settings</span>
          </h2>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </button>
        </div>

        <div className="setup-content">
          <section className="settings-section">
            <h3>Release Channel</h3>
            <p className="settings-desc">
              Choose which release stream you want to receive updates from.
            </p>

            <div className="channel-options" role="radiogroup" aria-label="Release channel">
              <label
                className={`channel-card ${channel === "stable" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="update-channel"
                  value="stable"
                  checked={channel === "stable"}
                  onChange={() => handleChannelSelect("stable")}
                />
                <div className="channel-info">
                  <div className="channel-title">
                    <span>Stable Channel (Recommended)</span>
                    <span className="badge-stable">Stable</span>
                  </div>
                  <div className="channel-text">
                    Only receive official releases once they have been tested and promoted to stable.
                  </div>
                </div>
              </label>

              <label
                className={`channel-card ${channel === "beta" ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="update-channel"
                  value="beta"
                  checked={channel === "beta"}
                  onChange={() => handleChannelSelect("beta")}
                />
                <div className="channel-info">
                  <div className="channel-title">
                    <span>Beta Channel</span>
                    <span className="badge-beta">Beta</span>
                  </div>
                  <div className="channel-text">
                    Receive automated builds from the latest commits, with new features and fixes before they are tested for stable.
                  </div>
                </div>
              </label>
            </div>
          </section>

          <section className="settings-section">
            <h3>Update Preferences</h3>
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={autoCheck}
                onChange={(e) => handleAutoCheckToggle(e.target.checked)}
              />
              <span>Automatically check for updates on startup</span>
            </label>

            <div className="settings-update-check">
              <button
                className="btn-primary"
                onClick={checkForUpdates}
                disabled={checking || installing}
              >
                {checking ? "Checking..." : "Check for Updates Now"}
              </button>

              {availableUpdate && (
                <button
                  className="btn-update"
                  style={{ marginLeft: "10px" }}
                  onClick={installUpdate}
                  disabled={installing}
                >
                  {installing
                    ? "Installing..."
                    : availableUpdate.download_url
                    ? `Download ${availableUpdate.version}`
                    : `Install ${availableUpdate.version}`}
                </button>
              )}
            </div>

            {statusMessage && (
              <div className="settings-status-box">
                {statusMessage}
              </div>
            )}
          </section>

          <section className="settings-section">
            <h3>About Vitae</h3>
            <div className="settings-about-grid">
              <div><strong>Version:</strong> {version}</div>
              <div><strong>Active Channel:</strong> {channel === "beta" ? "Beta" : "Stable"}</div>
              <div><strong>Platform:</strong> Desktop (Tauri + React)</div>
            </div>
          </section>
        </div>

        <div className="setup-footer">
          <div style={{ flex: 1 }}></div>
          <button onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
