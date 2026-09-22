import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { relaunch } from "@tauri-apps/api/process";
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
        .catch((error) => {
          if (isCancelled) return;
          console.log("Update check failed:", error);
          setUpdateAvailable(false);
          setUpdateInfo(null);
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [propChannel]);

  const handleUpdate = async () => {
    if (!updateInfo) return;

    setDownloading(true);
    try {
      await invoke("install_update_custom", { channel: activeChannel });
      // Restart the app to apply the update
      await relaunch();
    } catch (error) {
      alert(`Update failed: ${error}`);
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
          <span>Version {updateInfo.version} is ready to install.</span>
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
          {downloading ? "Installing..." : "Update Now"}
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
