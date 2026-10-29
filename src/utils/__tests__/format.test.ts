import { describe, it, expect } from "vitest";
import { formatBytes } from "../format";

describe("formatBytes", () => {
  it("formats sizes in decimal units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(15_984_000)).toBe("16 MB");
    expect(formatBytes(250_000_000)).toBe("250 MB");
    expect(formatBytes(1_250_000_000)).toBe("1.3 GB");
    expect(formatBytes(7_400_000_000_000)).toBe("7.4 TB");
  });
});
