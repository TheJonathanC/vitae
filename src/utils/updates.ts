import { UpdateCheckResponse } from "../types";

export const RELEASES_API_URL = "https://api.github.com/repos/TheJonathanC/vitae/releases";
export const RELEASES_PAGE_URL = "https://github.com/TheJonathanC/vitae/releases";

export type UpdateChannel = "stable" | "beta";

/** New installs follow stable releases; beta is opt-in. */
export const DEFAULT_CHANNEL: UpdateChannel = "stable";

export function getStoredChannel(): UpdateChannel {
  return localStorage.getItem("vitae_channel") === "beta" ? "beta" : DEFAULT_CHANNEL;
}

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(version: string): ParsedVersion | null {
  const match = SEMVER.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** Semver precedence: negative if a < b, 0 if equal, positive if a > b. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i]) return a.core[i] - b.core[i];
  }
  // A release outranks any of its pre-releases.
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name?: string;
  prerelease?: boolean;
  draft?: boolean;
  html_url?: string;
  published_at?: string | null;
  body?: string | null;
  assets?: GithubAsset[];
}

function isWindowsHost(): boolean {
  return /windows/i.test(navigator.userAgent);
}

/**
 * Picks an installer the user can actually run. Releases currently only ship
 * Windows installers, so other platforms get the release page instead.
 */
function downloadUrlFor(release: GithubRelease): string {
  if (isWindowsHost()) {
    const assets = release.assets || [];
    const installer =
      assets.find((a) => /setup\.exe$/i.test(a.name)) ||
      assets.find((a) => /\.msi$/i.test(a.name)) ||
      assets.find((a) => /\.exe$/i.test(a.name));
    if (installer) return installer.browser_download_url;
  }
  return release.html_url || RELEASES_PAGE_URL;
}

/**
 * Fallback update check against the GitHub Releases API, used when the
 * signed updater manifest isn't reachable. Ignores drafts and tags that aren't
 * versions (such as the rolling "latest-beta" tag) and only reports versions
 * newer than `localVersion`. Returns null when no usable release exists.
 */
export async function checkGithubReleases(
  channel: string,
  localVersion: string,
  fetchImpl: typeof fetch = fetch
): Promise<UpdateCheckResponse | null> {
  const response = await fetchImpl(RELEASES_API_URL);
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const releases: GithubRelease[] = await response.json();
  const local = parseVersion(localVersion);

  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((r) => !r.draft && typeof r.tag_name === "string")
    .map((r) => ({ release: r, version: parseVersion(r.tag_name as string) }))
    .filter(
      (c): c is { release: GithubRelease; version: ParsedVersion } =>
        c.version !== null &&
        (channel === "beta" || (!c.release.prerelease && c.version.pre.length === 0))
    )
    .sort((a, b) => compareVersions(b.version, a.version));

  const latest = candidates[0];
  if (!latest) return null;

  const isNewer = local ? compareVersions(latest.version, local) > 0 : false;
  return {
    should_update: isNewer,
    version: latest.release.tag_name ?? null,
    date: latest.release.published_at ?? null,
    body: latest.release.body ?? null,
    download_url: isNewer ? downloadUrlFor(latest.release) : null,
  };
}
