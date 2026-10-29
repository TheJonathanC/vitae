#!/usr/bin/env node
// Release helpers for .github/workflows/ci-cd.yml. Enforces the rules in RELEASING.md:
//
//   node scripts/release.mjs version            -> computes version/tag/channel, writes GITHUB_OUTPUT
//   node scripts/release.mjs manifest <dir>     -> signs (if needed) and verifies the NSIS installer,
//                                                  then writes the updater manifest(s) into <dir>
//
// Pure functions are exported for tests (scripts/__tests__/release.test.mjs).
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.GITHUB_REPOSITORY || "TheJonathanC/vitae";
export const BETA_MANIFEST_URL = `https://github.com/${REPO}/releases/download/latest-beta/latest-beta.json`;

// ---------------------------------------------------------------------------
// Semver
// ---------------------------------------------------------------------------
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version) {
  const m = SEMVER.exec(String(version).trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split(".") : [] };
}

/** Semver precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a, b) {
  const x = typeof a === "string" ? parseVersion(a) : a;
  const y = typeof b === "string" ? parseVersion(b) : b;
  if (!x || !y) throw new Error(`Not a semver version: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pNum = /^\d+$/.test(p);
    const qNum = /^\d+$/.test(q);
    if (pNum && qNum && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pNum !== qNum) return pNum ? -1 : 1;
    if (!pNum && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const isStable = (v) => parseVersion(v)?.pre.length === 0;

// ---------------------------------------------------------------------------
// Version computation
// ---------------------------------------------------------------------------

/**
 * Decides what a workflow run publishes.
 *
 * @param {object} o
 * @param {"push"|"workflow_dispatch"} o.event
 * @param {string} o.ref            e.g. refs/heads/main or refs/tags/v1.2.0
 * @param {string} o.sha            commit being released
 * @param {string} [o.inputChannel] workflow_dispatch channel
 * @param {string} [o.inputVersion] workflow_dispatch version
 * @param {string} o.baseVersion    package.json version
 * @param {number|string} o.runNumber
 * @param {Record<string,string>} o.tags  existing tag name -> commit sha
 */
export function computeRelease({ event, ref, sha, inputChannel, inputVersion, baseVersion, runNumber, tags }) {
  const versionTags = Object.keys(tags).filter((t) => parseVersion(t));
  const stableTags = versionTags.filter(isStable);
  const highestStable = stableTags.sort((a, b) => compareVersions(b, a))[0]?.replace(/^v/, "") || "0.0.0";
  const explicit = (inputVersion || "").trim().replace(/^v/, "");

  let version;
  if (ref.startsWith("refs/tags/v")) {
    version = ref.slice("refs/tags/v".length);
  } else if (explicit) {
    version = explicit;
  } else if (event === "workflow_dispatch" && inputChannel === "stable") {
    version = baseVersion.split("-")[0];
  } else {
    // Continuous beta: a pre-release of the patch after the newest stable release
    // (or after package.json, whichever is higher), so betas always sort above stable.
    const base = [baseVersion.split("-")[0], highestStable].sort((a, b) => compareVersions(b, a))[0];
    const [maj, min, pat] = parseVersion(base).core;
    version = `${maj}.${min}.${pat + 1}-beta.${runNumber}`;
  }

  if (!parseVersion(version)) throw new Error(`"${version}" is not a valid semver version`);
  const channel = isStable(version) ? "stable" : "beta";
  if (event === "workflow_dispatch" && inputChannel && inputChannel !== channel) {
    throw new Error(`Version ${version} is a ${channel} version but the "${inputChannel}" channel was selected`);
  }

  const tag = `v${version}`;
  if (tags[tag] && tags[tag] !== sha) {
    throw new Error(`Tag ${tag} already exists on ${tags[tag].slice(0, 7)}; versions are immutable, pick a new one`);
  }
  // Stable users never get a lower version, and beta users get stable only when it is newer.
  if (compareVersions(version, highestStable) < 0 || (compareVersions(version, highestStable) === 0 && !tags[tag])) {
    throw new Error(`Version ${version} must be newer than the latest stable release ${highestStable}`);
  }

  return { version, tag, channel, prerelease: channel === "beta" };
}

/** Reads `git ls-remote --tags` output into { tag: commitSha }, dereferencing annotated tags. */
export function parseLsRemoteTags(output) {
  const tags = {};
  for (const line of output.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!ref?.startsWith("refs/tags/")) continue;
    const name = ref.slice("refs/tags/".length);
    if (name.endsWith("^{}")) tags[name.slice(0, -3)] = sha;
    else if (!(name in tags)) tags[name] = sha;
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Signatures (minisign format used by the Tauri updater)
// ---------------------------------------------------------------------------
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verifies a Tauri updater signature (base64 of a minisign .sig file) for `data`
 * against the base64 public key from tauri.conf.json, exactly as the updater does.
 */
export function verifyUpdaterSignature(pubkeyB64, signatureB64, data) {
  const pubLines = Buffer.from(pubkeyB64, "base64").toString("utf8").split(/\r?\n/);
  const sigLines = Buffer.from(signatureB64, "base64").toString("utf8").split(/\r?\n/);
  const pk = Buffer.from(pubLines[1], "base64");
  const sig = Buffer.from(sigLines[1], "base64");
  const trusted = sigLines[2]?.replace(/^trusted comment: /, "") ?? "";
  const globalSig = Buffer.from(sigLines[3] || "", "base64");

  if (!pk.subarray(2, 10).equals(sig.subarray(2, 10))) {
    return { ok: false, reason: "signed with a different key than tauri.conf.json's updater pubkey" };
  }
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pk.subarray(10)]), format: "der", type: "spki" });
  const alg = sig.subarray(0, 2).toString("latin1");
  const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, key, sig.subarray(10))) return { ok: false, reason: "signature does not match the file" };
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, globalSig)) {
    return { ok: false, reason: "trusted comment signature is invalid" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Manifests
// ---------------------------------------------------------------------------
export function buildManifest({ version, channel, sha, url, signature, pubDate }) {
  return {
    version,
    notes: `Vitae ${version} (${channel} channel). Commit: ${sha}`,
    pub_date: pubDate,
    platforms: { "windows-x86_64": { signature, url } },
  };
}

/**
 * Which manifests a release writes. Stable releases also feed the beta channel,
 * but only when they are newer than the beta currently published there.
 */
export function manifestsToWrite(channel, version, currentBetaVersion) {
  if (channel === "beta") return ["latest-beta.json"];
  const files = ["latest.json"];
  if (!currentBetaVersion || compareVersions(version, currentBetaVersion) > 0) files.push("latest-beta.json");
  return files;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function setOutputs(values) {
  for (const [k, v] of Object.entries(values)) {
    console.log(`${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

function versionCommand() {
  const env = process.env;
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const tags = parseLsRemoteTags(execFileSync("git", ["ls-remote", "--tags", "origin"], { encoding: "utf8" }));
  const result = computeRelease({
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    sha: env.GITHUB_SHA,
    inputChannel: env.INPUT_CHANNEL,
    inputVersion: env.INPUT_VERSION,
    baseVersion: pkg.version,
    runNumber: env.GITHUB_RUN_NUMBER,
    tags,
  });
  setOutputs(result);
}

/** The beta feed's current version, or null if no feed exists yet. Other failures throw
 *  so a network hiccup can't make a stable release overwrite a newer beta. */
async function fetchCurrentBetaVersion() {
  const res = await fetch(BETA_MANIFEST_URL);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read the current beta feed (${res.status} from ${BETA_MANIFEST_URL})`);
  return (await res.json()).version || null;
}

async function manifestCommand(dir) {
  const { RELEASE_VERSION: version, RELEASE_CHANNEL: channel, RELEASE_TAG: tag, GITHUB_SHA: sha } = process.env;
  const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const pubkey = conf.tauri.updater.pubkey;

  // The updater always installs the NSIS setup.exe (MSI is only offered as a manual download).
  const installers = readdirSync(dir).filter((f) => f.endsWith("-setup.exe"));
  if (installers.length !== 1) throw new Error(`Expected exactly one *-setup.exe in ${dir}, found: ${installers.join(", ") || "none"}`);
  const installer = installers[0];
  const sigPath = join(dir, `${installer}.sig`);

  if (!existsSync(sigPath)) {
    if (!process.env.TAURI_PRIVATE_KEY) throw new Error("TAURI_PRIVATE_KEY is not set; refusing to publish an unsigned update");
    console.log(`Signing ${installer}`);
    const cli = join("node_modules", "@tauri-apps", "cli", "tauri.js");
    execFileSync(process.execPath, [cli, "signer", "sign", "-k", process.env.TAURI_PRIVATE_KEY, "-p", process.env.TAURI_KEY_PASSWORD || "", join(dir, installer)], {
      stdio: ["ignore", "ignore", "inherit"],
    });
  }
  const signature = readFileSync(sigPath, "utf8").trim();
  const check = verifyUpdaterSignature(pubkey, signature, readFileSync(join(dir, installer)));
  if (!check.ok) throw new Error(`Update signature check failed for ${installer}: ${check.reason}`);
  console.log(`Verified ${installer} against the updater public key`);

  const manifest = buildManifest({
    version,
    channel,
    sha,
    url: `https://github.com/${REPO}/releases/download/${tag}/${installer}`,
    signature,
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const currentBeta = channel === "stable" ? await fetchCurrentBetaVersion() : null;
  for (const file of manifestsToWrite(channel, version, currentBeta)) {
    writeFileSync(join(dir, file), JSON.stringify(manifest, null, 2) + "\n");
    console.log(`Wrote ${file}`);
  }
  if (channel === "stable" && currentBeta && compareVersions(version, currentBeta) <= 0) {
    console.log(`Beta channel keeps ${currentBeta}, which is newer than ${version}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === "version") versionCommand();
    else if (cmd === "manifest") await manifestCommand(arg || "release-assets");
    else throw new Error("Usage: release.mjs version | manifest <dir>");
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
