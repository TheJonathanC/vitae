import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock window.prompt and window.confirm using vi.fn so tests can mock return values (e.g. cancel flows)
window.prompt = vi.fn(() => null);
window.confirm = vi.fn(() => true);
window.alert = vi.fn(() => {});

if (typeof document !== "undefined" && !document.queryCommandSupported) {
  document.queryCommandSupported = () => false;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

