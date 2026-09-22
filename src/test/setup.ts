import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock window.prompt and window.confirm using vi.fn so tests can mock return values (e.g. cancel flows)
window.prompt = vi.fn(() => null);
window.confirm = vi.fn(() => true);
window.alert = vi.fn(() => {});

