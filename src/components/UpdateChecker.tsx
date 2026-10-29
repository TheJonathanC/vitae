import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";
import { checkGithubReleases, getStoredChannel, RELEASES_PAGE_URL } from "../utils/updates";

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
    <div className="update-bar" data-testid="update-banner" role="region" aria-label="Update available">
      <p>
        {activeChannel === "beta" && <span className="tag">Beta</span>}
        {updateInfo.download_url
          ? `Version ${updateInfo.version} is available to download.`
          : `Version ${updateInfo.version} is ready to install.`}
      </p>
      <div className="update-bar-actions">
        <button
          type="button"
          onClick={() => setUpdateAvailable(false)}
          className="btn btn-small"
          disabled={downloading}
        >
          Later
        </button>
        <button
          type="button"
          onClick={handleUpdate}
          disabled={downloading}
          className="btn btn-primary btn-small"
        >
          {downloading ? "Installing…" : updateInfo.download_url ? "Download" : "Update and restart"}
        </button>
      </div>
    </div>
  );
}

export default UpdateChecker;
