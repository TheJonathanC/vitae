import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { useDialog } from "../hooks/useDialog";
import { formatBytes } from "../utils/format";
import { TexOverview } from "../types";
import { IconX } from "./Icons";

interface PackageManagerProps {
  onClose: () => void;
}

const MAX_ROWS = 200;

function PackageManager({ onClose }: PackageManagerProps) {
  const [overview, setOverview] = useState<TexOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useDialog<HTMLDivElement>(() => {
    if (!removing) onClose();
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await invoke<TexOverview>("get_tex_overview"));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (overview?.packages ?? []).filter((p) => p.name.toLowerCase().includes(needle));
  }, [overview, filter]);

  const remove = async (name: string) => {
    setRemoving(name);
    setConfirming(null);
    setNotice(null);
    try {
      await invoke("remove_tex_package", { name });
      setNotice(`Removed ${name}.`);
      await load();
    } catch (err) {
      setNotice(String(err));
    } finally {
      setRemoving(null);
    }
  };

  const kindLabel = overview?.kind === "miktex" ? "MiKTeX" : "TeX Live";
  const shown = matches.slice(0, MAX_ROWS);

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-manager-title"
        tabIndex={-1}
      >
        <div className="dialog-head">
          <h2 id="package-manager-title">LaTeX packages</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" disabled={!!removing}>
            <IconX size={18} />
          </button>
        </div>

        <div className="dialog-body">
          {loading && !overview && (
            <p role="status" className="muted">
              Measuring your LaTeX installation…
            </p>
          )}
          {error && (
            <p className="setup-error" role="alert">
              {error}
            </p>
          )}
          {overview && (
            <>
              <p className="package-summary">
                <strong>{kindLabel}</strong> uses <strong>{formatBytes(overview.total_bytes)}</strong> on disk,
                with {overview.packages.length} packages.
              </p>
              <p className="muted">
                Sizes are estimates. Removing a package frees its space, and a template that needs it will
                usually install it again.
              </p>
              <div className="field package-filter">
                <label htmlFor="package-filter">Filter packages</label>
                <input
                  id="package-filter"
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search by name"
                />
              </div>
              {notice && (
                <p className="update-status" role="status">
                  {notice}
                </p>
              )}
              <ul className="package-list" aria-label="Installed packages">
                {shown.map((pkg) => (
                  <li key={pkg.name} className="package-row">
                    <span className="package-name">{pkg.name}</span>
                    <span className="package-size">{formatBytes(pkg.size_bytes)}</span>
                    <span className="package-action">
                      {pkg.core ? (
                        <span className="muted" title="LaTeX needs this to run">
                          Core
                        </span>
                      ) : confirming === pkg.name ? (
                        <>
                          <button type="button" className="btn btn-small btn-danger" onClick={() => remove(pkg.name)}>
                            Confirm remove
                          </button>
                          <button type="button" className="btn btn-small" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-small"
                          onClick={() => setConfirming(pkg.name)}
                          disabled={!!removing}
                          aria-label={`Remove ${pkg.name}`}
                        >
                          {removing === pkg.name ? "Removing…" : "Remove"}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
                {shown.length === 0 && <li className="package-row muted">No packages match.</li>}
              </ul>
              {matches.length > MAX_ROWS && (
                <p className="muted">
                  Showing the largest {MAX_ROWS} of {matches.length}. Filter to narrow the list.
                </p>
              )}
            </>
          )}
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn" onClick={load} disabled={loading || !!removing}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} disabled={!!removing}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default PackageManager;
