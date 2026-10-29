import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AiSettings from "../AiSettings";
import { invoke } from "@tauri-apps/api/tauri";

vi.mock("@tauri-apps/api/tauri", () => ({ invoke: vi.fn() }));

const none = { has_key: false, provider: null, provider_name: null, model: null };
const connected = { has_key: true, provider: "anthropic", provider_name: "Anthropic", model: "claude-sonnet-5-5" };
const models = {
  provider: "anthropic",
  provider_name: "Anthropic",
  models: [
    { id: "claude-opus-5-5", created: 3, recommended: false },
    { id: "claude-sonnet-5-5", created: 2, recommended: true },
    { id: "claude-haiku-5-5", created: 1, recommended: false },
  ],
};

function backend(handlers: Record<string, (args: any) => unknown>) {
  (invoke as any).mockImplementation(async (cmd: string, args: any) => {
    if (!handlers[cmd]) throw new Error(`unexpected ${cmd}`);
    return handlers[cmd](args);
  });
}

describe("AiSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks a key, offers the models it can use with the recommended one chosen, and saves", async () => {
    backend({
      ai_get_settings: () => none,
      ai_validate_key: () => models,
      ai_save_settings: () => connected,
    });
    render(<AiSettings />);
    const input = await screen.findByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByText("Check key")).toBeDisabled();

    fireEvent.change(input, { target: { value: "sk-ant-secret" } });
    fireEvent.click(screen.getByText("Check key"));
    const select = (await screen.findByLabelText("Model for Anthropic")) as HTMLSelectElement;
    expect(select.value).toBe("claude-sonnet-5-5");
    expect(screen.getByText("claude-sonnet-5-5 (recommended)")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("ai_validate_key", { apiKey: "sk-ant-secret" });

    fireEvent.change(select, { target: { value: "claude-haiku-5-5" } });
    fireEvent.click(screen.getByText("Save"));
    expect(await screen.findByText(/Connected to/)).toHaveTextContent("Anthropic");
    expect(invoke).toHaveBeenCalledWith("ai_save_settings", { apiKey: "sk-ant-secret", model: "claude-haiku-5-5" });
    expect(screen.queryByDisplayValue("sk-ant-secret")).not.toBeInTheDocument();
  });

  it("shows why a key was rejected and stays on the key step", async () => {
    backend({
      ai_get_settings: () => none,
      ai_validate_key: () => {
        throw "Anthropic rejected the API key. Check that it's correct and active.";
      },
    });
    render(<AiSettings />);
    fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "sk-ant-bad" } });
    fireEvent.click(screen.getByText("Check key"));
    expect(await screen.findByRole("alert")).toHaveTextContent("rejected the API key");
    expect(screen.getByLabelText("API key")).toBeInTheDocument();
  });

  it("shows the connection and lets the user change the model without re-entering the key", async () => {
    backend({
      ai_get_settings: () => connected,
      ai_list_models: () => models,
      ai_save_settings: () => ({ ...connected, model: "claude-opus-5-5" }),
    });
    render(<AiSettings />);
    expect(await screen.findByText(/Connected to/)).toHaveTextContent("claude-sonnet-5-5");
    fireEvent.click(screen.getByText("Change model"));
    const select = (await screen.findByLabelText("Model for Anthropic")) as HTMLSelectElement;
    expect(select.value).toBe("claude-sonnet-5-5");
    fireEvent.change(select, { target: { value: "claude-opus-5-5" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(screen.getByText(/Connected to/)).toHaveTextContent("claude-opus-5-5"));
    expect(invoke).toHaveBeenCalledWith("ai_save_settings", { apiKey: null, model: "claude-opus-5-5" });
  });

  it("removes the key only after confirmation", async () => {
    backend({ ai_get_settings: () => connected, ai_clear_settings: () => undefined });
    render(<AiSettings />);
    fireEvent.click(await screen.findByText("Remove key"));
    expect(invoke).not.toHaveBeenCalledWith("ai_clear_settings");
    fireEvent.click(screen.getByText("Confirm remove"));
    expect(await screen.findByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByText("The key was removed from this computer.")).toBeInTheDocument();
  });

  it("tells the user where the key lives and what gets sent", async () => {
    backend({ ai_get_settings: () => none });
    render(<AiSettings />);
    expect(await screen.findByText(/stored on this computer/)).toHaveTextContent("not encrypted");
    expect(screen.getByText(/sent to your provider/)).toBeInTheDocument();
  });

  it("copes with the settings being unavailable", async () => {
    backend({ ai_get_settings: () => { throw new Error("nope"); } });
    render(<AiSettings />);
    expect(await screen.findByLabelText("API key")).toBeInTheDocument();
  });
});
