import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";
import { checkGithubReleases, RELEASES_PAGE_URL } from "../utils/updates";
import { useDialog } from "../hooks/useDialog";
import { IconX } from "./Icons";

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

  return (
    <div className="dialog-backdrop" data-testid="settings-modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
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

        <div className="dialog-body">
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

          <label className="check-row">
            <input
              type="checkbox"
              checked={autoCheck}
              onChange={(e) => handleAutoCheckToggle(e.target.checked)}
            />
            Check for updates when Vitae starts
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
          </div>
          {statusMessage && (
            <p className="update-status" role="status">
              {statusMessage}
            </p>
          )}

          <p className="about-line">
            Vitae {version}, {channel === "beta" ? "beta" : "stable"} channel
          </p>
        </div>

        <div className="dialog-foot">
          <button type="button" onClick={onClose} className="btn btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
