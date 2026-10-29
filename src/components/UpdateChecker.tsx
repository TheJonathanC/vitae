import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";
import { checkGithubReleases, getStoredChannel, RELEASES_PAGE_URL } from "../utils/updates";
import { IconBell } from "./Icons";

interface UpdateCheckerProps {
  channel?: string;
}

function UpdateChecker({ channel: propChannel }: UpdateCheckerProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string>(getStoredChannel);

  useEffect(() => {
    let isCancelled = false;
    const channel = propChannel || getStoredChannel();
    setActiveChannel(channel);

    // Clear stale banner whenever channel changes
    setUpdateAvailable(false);
    setUpdateInfo(null);

    const autoCheck = localStorage.getItem("vitae_auto_update") !== "false";
    if (autoCheck) {
      invoke<UpdateCheckResponse>("check_update_custom", {
        channel,
      })
        .then((update) => {
          if (isCancelled) return;
          if (update && update.should_update) {
            setUpdateAvailable(true);
            setUpdateInfo(update);
          } else {
            setUpdateAvailable(false);
            setUpdateInfo(null);
          }
        })
        .catch(async (error) => {
          if (isCancelled) return;
          console.warn("Primary update check failed, attempting GitHub Releases fallback:", error);
          
          try {
            const localVersion =
              (await getVersion().catch(() => null)) || packageInfo.version;
            const release = await checkGithubReleases(channel, localVersion);
            if (release?.should_update && !isCancelled) {
              setUpdateAvailable(true);
              setUpdateInfo(release);
              return;
            }
          } catch (ghErr) {
            // Ignore fallback failure in background auto-check
          }

          if (!isCancelled) {
            setUpdateAvailable(false);
            setUpdateInfo(null);
          }
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [propChannel]);

  const handleUpdate = async () => {
    if (!updateInfo) return;

    if (updateInfo.download_url) {
      try {
        await open(updateInfo.download_url);
        setUpdateAvailable(false);
      } catch (err) {
        console.error("Failed to open update URL:", err);
      }
      return;
    }

    setDownloading(true);
    try {
      await invoke("install_update_custom", { channel: activeChannel });
      // Restart the app to apply the update
      await relaunch();
    } catch (error) {
      try {
        await open(RELEASES_PAGE_URL);
      } catch {
        alert(`Update failed: ${error}`);
      }
      setDownloading(false);
    }
  };

  if (!updateAvailable || !updateInfo) return null;

  return (
    <div className="update-banner" data-testid="update-banner" role="region" aria-label="Update available">
      <div className="update-content">
        <IconBell size={18} className="update-icon" />
        <div className="update-text">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong>Update Available!</strong>
            <span
              className={
                activeChannel === "beta" ? "badge-beta" : "badge-stable"
              }
              style={{ fontSize: "0.75em", padding: "2px 6px", borderRadius: "3px" }}
            >
              {activeChannel.toUpperCase()}
            </span>
          </div>
          <span>
            {updateInfo.download_url
              ? `Version ${updateInfo.version} is available to download.`
              : `Version ${updateInfo.version} is ready to install.`}
          </span>
          {updateInfo.body && (
            <span className="update-notes-preview" title={updateInfo.body}>
              {updateInfo.body.length > 80
                ? `${updateInfo.body.slice(0, 80)}...`
                : updateInfo.body}
            </span>
          )}
        </div>
      </div>
      <div className="update-actions">
        <button
          onClick={handleUpdate}
          disabled={downloading}
          className="btn-update"
        >
          {downloading
            ? "Installing..."
            : updateInfo.download_url
            ? "Download"
            : "Update Now"}
        </button>
        <button
          onClick={() => setUpdateAvailable(false)}
          className="btn-update-later"
          disabled={downloading}
        >
          Later
        </button>
      </div>
    </div>
  );
}

export default UpdateChecker;
