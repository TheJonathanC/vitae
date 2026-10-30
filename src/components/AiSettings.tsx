import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { AiModels, AiSettingsView } from "../types";

type Message = { tone: "ok" | "error"; text: string };

/** Connects an optional AI provider with the user's own API key and lets them pick a model. */
function AiSettings() {
  const [settings, setSettings] = useState<AiSettingsView | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [models, setModels] = useState<AiModels | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    invoke<AiSettingsView>("ai_get_settings")
      .then((view) => setSettings(view ?? null))
      .catch(() => setSettings(null));
  }, []);

  const connected = settings?.has_key === true;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setMessage({ tone: "error", text: String(err) });
    } finally {
      setBusy(false);
    }
  };

  const showModels = (found: AiModels, preferred?: string | null) => {
    setModels(found);
    const keep = found.models.find((m) => m.id === preferred);
    setModel(keep?.id ?? found.models.find((m) => m.recommended)?.id ?? found.models[0]?.id ?? "");
  };

  const checkKey = () =>
    run(async () => {
      showModels(await invoke<AiModels>("ai_validate_key", { apiKey: keyInput }));
    });

  const changeModel = () =>
    run(async () => {
      showModels(await invoke<AiModels>("ai_list_models"), settings?.model);
    });

  const save = () =>
    run(async () => {
      const view = await invoke<AiSettingsView>("ai_save_settings", { apiKey: connected ? null : keyInput, model });
      setSettings(view);
      setKeyInput("");
      setModels(null);
      setMessage({ tone: "ok", text: `Saved. AI help will use ${view.model}.` });
    });

  const remove = () =>
    run(async () => {
      await invoke("ai_clear_settings");
      setSettings({ has_key: false, provider: null, provider_name: null, model: null });
      setConfirmRemove(false);
      setMessage({ tone: "ok", text: "The key was removed from this computer." });
    });

  return (
    <div className="settings-section">
      <h3>AI assistant (optional)</h3>
      <p className="muted">
        Add your own Anthropic, OpenAI or Google Gemini API key and Vitae can suggest better wording for your bullets. You review every change before it's used, and nothing is sent unless you ask.
      </p>

      {models ? (
        <div className="field">
          <label htmlFor="ai-model">
            Model for {models.provider_name}
          </label>
          <select id="ai-model" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {m.recommended ? " (recommended)" : ""}
              </option>
            ))}
          </select>
          <p className="field-hint">These are the models your key can use. The recommended one balances quality and cost.</p>
          <div className="setup-actions">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !model}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn" onClick={() => { setModels(null); setKeyInput(""); setMessage(null); }} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : connected ? (
        <>
          <p>
            Connected to <strong>{settings?.provider_name}</strong>, using <strong>{settings?.model}</strong>.
          </p>
          <div className="setup-actions">
            <button type="button" className="btn" onClick={changeModel} disabled={busy}>
              {busy ? "Loading…" : "Change model"}
            </button>
            {confirmRemove ? (
              <>
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Confirm remove
                </button>
                <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmRemove(true)} disabled={busy}>
                Remove key
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="ai-key">API key</label>
          <input
            id="ai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-ant-…, sk-… or AIza…"
          />
          <div className="setup-actions">
            <button type="button" className="btn btn-primary" onClick={checkKey} disabled={busy || !keyInput.trim()}>
              {busy ? "Checking…" : "Check key"}
            </button>
          </div>
        </div>
      )}

      {(models?.provider ?? settings?.provider) === "gemini" && (
        <p className="field-hint">
          On Google's free Gemini tier, the text you send may be used to improve Google's products. Check Google's terms for your plan.
        </p>
      )}

      {message && (
        <p className={message.tone === "error" ? "setup-error" : "update-status"} role={message.tone === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
      <p className="field-hint">
        Your key is stored on this computer in Vitae's data folder, readable only by your account but not encrypted. When you use AI help, the bullets you choose and the job description are sent to your provider.
      </p>
    </div>
  );
}

export default AiSettings;
