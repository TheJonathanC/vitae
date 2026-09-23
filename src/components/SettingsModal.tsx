import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";

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
        const ghResponse = await fetch("https://api.github.com/repos/TheJonathanC/vitae/releases");
        if (ghResponse.ok) {
          const releases = await ghResponse.json();
          const targetRelease = releases.find((r: any) => {
            if (channel === "beta") return true;
            return !r.prerelease;
          });

          if (targetRelease) {
            const rawTag = targetRelease.tag_name || "";
            const remoteVersion = rawTag.replace(/^v/, "");
            const localVersion = version.replace(/^v/, "");

            if (remoteVersion && remoteVersion !== localVersion) {
              const exeAsset = targetRelease.assets?.find((a: any) =>
                a.name.endsWith(".exe") || a.name.endsWith(".msi")
              );
              const downloadUrl = exeAsset?.browser_download_url || targetRelease.html_url;

              setAvailableUpdate({
                should_update: true,
                version: rawTag,
                date: targetRelease.published_at,
                body: targetRelease.body || null,
                download_url: downloadUrl,
              });
              setStatusMessage(`Update ${rawTag} is available on GitHub!`);
              fallbackSuccess = true;
            } else {
              setStatusMessage(`You are up to date! (${rawTag} is the latest release)`);
              fallbackSuccess = true;
            }
          }
        }
      } catch (ghErr) {
        console.error("GitHub Releases API fallback check failed:", ghErr);
      }

      if (!fallbackSuccess) {
        const errStr = String(err);
        if (errStr.includes("Could not fetch a valid release JSON") || errStr.includes("Could not fetch release manifest")) {
          setStatusMessage("No updater manifest found for this channel. Check https://github.com/TheJonathanC/vitae/releases for updates.");
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
        await open("https://github.com/TheJonathanC/vitae/releases");
        setStatusMessage(`Direct installation failed (${err}). Opened releases page in browser.`);
      } catch {
        setStatusMessage(`Failed to install update: ${err}`);
      }
      setInstalling(false);
    }
  };

  return (
    <div className="setup-overlay" data-testid="settings-modal-overlay">
      <div className="setup-modal settings-modal">
        <div className="setup-header">
          <h2>⚙️ Settings</h2>
          <button className="settings-close-btn" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="setup-content">
          <section className="settings-section">
            <h3>Release Channel</h3>
            <p className="settings-desc">
              Choose which release stream you want to receive updates from.
            </p>

            <div className="channel-options">
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
                    <span>Beta Channel (Recommended)</span>
                    <span className="badge-beta">v1.1-beta</span>
                  </div>
                  <div className="channel-text">
                    Receive the latest automated builds, bug fixes, and preview features directly from commits.
                  </div>
                </div>
              </label>

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
                    <span>Stable Channel</span>
                    <span className="badge-stable">v2.0</span>
                  </div>
                  <div className="channel-text">
                    Only receive official milestone releases once tested and promoted to stable.
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
