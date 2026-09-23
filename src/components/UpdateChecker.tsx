import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
import { open } from "@tauri-apps/api/shell";
import packageInfo from "../../package.json";
import { UpdateCheckResponse } from "../types";

interface UpdateCheckerProps {
  channel?: string;
}

function UpdateChecker({ channel: propChannel }: UpdateCheckerProps) {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [activeChannel, setActiveChannel] = useState<string>("beta");

  useEffect(() => {
    let isCancelled = false;
    const channel = propChannel || localStorage.getItem("vitae_channel") || "beta";
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
            const ghResponse = await fetch("https://api.github.com/repos/TheJonathanC/vitae/releases");
            if (ghResponse.ok && !isCancelled) {
              const releases = await ghResponse.json();
              const targetRelease = releases.find((r: any) => {
                if (channel === "beta") return true;
                return !r.prerelease;
              });

              if (targetRelease) {
                const rawTag = targetRelease.tag_name || "";
                const remoteVersion = rawTag.replace(/^v/, "");
                const localVersion = (packageInfo.version || "").replace(/^v/, "");

                if (remoteVersion && remoteVersion !== localVersion) {
                  const exeAsset = targetRelease.assets?.find((a: any) =>
                    a.name.endsWith(".exe") || a.name.endsWith(".msi")
                  );
                  const downloadUrl = exeAsset?.browser_download_url || targetRelease.html_url;

                  setUpdateAvailable(true);
                  setUpdateInfo({
                    should_update: true,
                    version: rawTag,
                    date: targetRelease.published_at,
                    body: targetRelease.body || null,
                    download_url: downloadUrl,
                  });
                  return;
                }
              }
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
        await open("https://github.com/TheJonathanC/vitae/releases");
      } catch {
        alert(`Update failed: ${error}`);
      }
      setDownloading(false);
    }
  };

  if (!updateAvailable || !updateInfo) return null;

  return (
    <div className="update-banner" data-testid="update-banner">
      <div className="update-content">
        <span className="update-icon">🔔</span>
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
