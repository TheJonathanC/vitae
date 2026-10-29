import { generateKeyPairSync, sign, createHash } from "node:crypto";
import {
  compareVersions,
  computeRelease,
  manifestsToWrite,
  parseLsRemoteTags,
  verifyUpdaterSignature,
} from "../release.mjs";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const tags = { "v1.1.1": OTHER, "v1.1.2": OTHER, "v1.1.3-beta.30": OTHER, "latest-beta": OTHER };
const base = { sha: SHA, baseVersion: "1.1.2", runNumber: 40, tags };

describe("compareVersions", () => {
  it("orders numeric pre-release identifiers numerically", () => {
    expect(compareVersions("1.1.3-beta.10", "1.1.3-beta.9")).toBeGreaterThan(0);
  });
  it("ranks a release above its pre-releases", () => {
    expect(compareVersions("1.1.3", "1.1.3-beta.99")).toBeGreaterThan(0);
    expect(compareVersions("1.1.3-beta.1", "1.1.2")).toBeGreaterThan(0);
  });
});

describe("computeRelease", () => {
  it("publishes main pushes as betas of the next patch", () => {
    expect(computeRelease({ ...base, event: "push", ref: "refs/heads/main" })).toEqual({
      version: "1.1.3-beta.40",
      tag: "v1.1.3-beta.40",
      channel: "beta",
      prerelease: true,
    });
  });

  it("keeps betas above stable when package.json lags behind the latest release", () => {
    const r = computeRelease({ ...base, baseVersion: "1.1.0", event: "push", ref: "refs/heads/main" });
    expect(r.version).toBe("1.1.3-beta.40");
  });

  it("publishes v-tags without a pre-release as stable", () => {
    const r = computeRelease({ ...base, tags: { ...tags, "v1.2.0": SHA }, event: "push", ref: "refs/tags/v1.2.0" });
    expect(r).toMatchObject({ version: "1.2.0", channel: "stable", prerelease: false });
  });

  it("treats rc/beta tags as beta", () => {
    const r = computeRelease({ ...base, tags: { ...tags, "v1.2.0-rc.1": SHA }, event: "push", ref: "refs/tags/v1.2.0-rc.1" });
    expect(r).toMatchObject({ channel: "beta", prerelease: true });
  });

  it("uses package.json for a manual stable release", () => {
    const r = computeRelease({ ...base, baseVersion: "1.1.3", event: "workflow_dispatch", ref: "refs/heads/main", inputChannel: "stable" });
    expect(r).toMatchObject({ version: "1.1.3", channel: "stable" });
  });

  it("rejects a stable release that is not newer than the latest stable", () => {
    expect(() =>
      computeRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/main", inputChannel: "stable", inputVersion: "1.0.5" })
    ).toThrow(/must be newer/);
    expect(() =>
      computeRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/main", inputChannel: "stable" })
    ).toThrow(/already exists/);
  });

  it("rejects a version whose kind doesn't match the selected channel", () => {
    expect(() =>
      computeRelease({ ...base, event: "workflow_dispatch", ref: "refs/heads/main", inputChannel: "stable", inputVersion: "1.2.0-beta.1" })
    ).toThrow(/beta version/);
  });

  it("allows re-running the release of an existing tag on the same commit", () => {
    const r = computeRelease({ ...base, tags: { ...tags, "v1.1.2": SHA }, event: "push", ref: "refs/tags/v1.1.2" });
    expect(r.version).toBe("1.1.2");
  });
});

describe("manifestsToWrite", () => {
  it("only updates the beta feed for betas", () => {
    expect(manifestsToWrite("beta", "1.1.3-beta.40", "1.1.3-beta.30")).toEqual(["latest-beta.json"]);
  });
  it("moves beta users to a newer stable release", () => {
    expect(manifestsToWrite("stable", "1.1.3", "1.1.3-beta.40")).toEqual(["latest.json", "latest-beta.json"]);
    expect(manifestsToWrite("stable", "1.1.3", null)).toEqual(["latest.json", "latest-beta.json"]);
  });
  it("leaves the beta feed alone when beta is ahead of a stable hotfix", () => {
    expect(manifestsToWrite("stable", "1.1.3", "1.2.0-beta.5")).toEqual(["latest.json"]);
  });
});

describe("parseLsRemoteTags", () => {
  it("dereferences annotated tags", () => {
    const out = `${OTHER}\trefs/tags/v1.0.0\n${SHA}\trefs/tags/v1.0.0^{}\n${OTHER}\trefs/tags/v1.0.1\n`;
    expect(parseLsRemoteTags(out)).toEqual({ "v1.0.0": SHA, "v1.0.1": OTHER });
  });
});

describe("verifyUpdaterSignature", () => {
  // Builds a minisign key pair and signature the way `tauri signer` does.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = Buffer.from("0123456789abcdef", "hex");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const pubkey = Buffer.from(
    `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyId, raw]).toString("base64")}\n`
  ).toString("base64");

  function signFile(data, id = keyId) {
    const sig = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const trusted = "timestamp:1\tfile:Vitae-setup.exe";
    const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey);
    const body = Buffer.concat([Buffer.from("ED"), id, sig]).toString("base64");
    return Buffer.from(
      `untrusted comment: signature from tauri secret key\n${body}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`
    ).toString("base64");
  }

  const data = Buffer.from("installer bytes");

  it("accepts a valid signature", () => {
    expect(verifyUpdaterSignature(pubkey, signFile(data), data)).toEqual({ ok: true });
  });
  it("rejects a modified file", () => {
    expect(verifyUpdaterSignature(pubkey, signFile(data), Buffer.from("tampered")).ok).toBe(false);
  });
  it("rejects a signature from another key", () => {
    expect(verifyUpdaterSignature(pubkey, signFile(data, Buffer.alloc(8)), data).reason).toMatch(/different key/);
  });
});
