import { useEffect, useState } from "react";
import { checkUpdate, installUpdate } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";

function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    try {
      const update = await checkUpdate();
      if (update.shouldUpdate) {
        setUpdateAvailable(true);
        setUpdateInfo(update);
      }
    } catch (error) {
      // Silently fail - don't bother user if update check fails
      console.log("Update check failed:", error);
    }
  };

  const handleUpdate = async () => {
    if (!updateInfo) return;

    setDownloading(true);
    try {
      await installUpdate();
      // Restart the app to apply the update
      await relaunch();
    } catch (error) {
      alert(`Update failed: ${error}`);
      setDownloading(false);
    }
  };

  if (!updateAvailable) return null;

  return (
    <div className="update-banner">
      <div className="update-content">
        <span className="update-icon">🔔</span>
        <div className="update-text">
          <strong>Update Available!</strong>
          <span>Version {updateInfo?.manifest?.version} is ready to install.</span>
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
