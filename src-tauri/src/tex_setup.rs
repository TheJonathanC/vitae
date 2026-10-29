//! Installing a TeX distribution and managing the packages in it.
//!
//! Kept free of Tauri types so it can be unit-tested on any platform. The
//! MiKTeX installer is Windows-only; macOS and Linux get instructions instead,
//! because their installers need an administrator password that a GUI app
//! can't prompt for.

use crate::latex::{create_silent_command, run_with_timeout, LatexBinary, PassOutput, RunError};
use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

/// Always-current alias for MiKTeX's command-line setup tool (a zip).
pub const MIKTEX_SETUP_URL: &str = "https://miktex.org/download/win/miktexsetup-x64.zip";
pub const MIKTEX_REPOSITORY: &str = "https://mirrors.ctan.org/systems/win32/miktex/tm/packages/";
const SETUP_EXE: &str = "miktexsetup_standalone.exe";
const SETUP_STEP_TIMEOUT: Duration = Duration::from_secs(40 * 60);
const SMALL_STEP_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const REMOVE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// Packages Vitae won't offer to remove: without them nothing compiles.
const CORE_PACKAGES: &[&str] = &[
    "base", "tools", "amsmath", "amsfonts", "graphics", "graphics-cfg", "graphics-def", "l3kernel",
    "l3packages", "l3backend", "babel", "hyperref", "url", "oberdiek", "latexconfig", "cm", "psnfss",
    "pdftex", "hyph-utf8", "etex", "kvoptions", "pdfescape", "ltxcmds", "infwarerr", "kvsetkeys",
    "latex", "latex-fonts", "lm", "cm-super", "ec", "tex-ini-files", "unicode-data", "luatex",
];

// ---------------------------------------------------------------------------
// Linux / macOS guidance
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct InstallCommand {
    pub manager: String,
    pub command: String,
}

fn os_release_value(os_release: &str, key: &str) -> String {
    os_release
        .lines()
        .find_map(|line| line.strip_prefix(&format!("{}=", key)))
        .map(|v| v.trim().trim_matches('"').to_lowercase())
        .unwrap_or_default()
}

/// The command a Linux user should run to get a working `pdflatex`, chosen from
/// `/etc/os-release` and falling back to whichever package manager exists.
pub fn linux_install_command(os_release: &str, has: &dyn Fn(&str) -> bool) -> Option<InstallCommand> {
    let family = format!("{} {}", os_release_value(os_release, "ID"), os_release_value(os_release, "ID_LIKE"));
    let any = |names: &[&str]| names.iter().any(|n| family.split_whitespace().any(|f| f == *n));
    let apt = InstallCommand {
        manager: "apt".into(),
        command: "sudo apt-get install texlive-latex-base texlive-latex-extra texlive-fonts-recommended".into(),
    };
    let dnf = InstallCommand { manager: "dnf".into(), command: "sudo dnf install texlive-scheme-medium".into() };
    let pacman = InstallCommand { manager: "pacman".into(), command: "sudo pacman -S texlive-core texlive-latexextra".into() };
    let zypper = InstallCommand { manager: "zypper".into(), command: "sudo zypper install texlive-scheme-medium".into() };

    if any(&["debian", "ubuntu", "linuxmint", "pop", "raspbian"]) {
        Some(apt)
    } else if any(&["fedora", "rhel", "centos", "rocky", "almalinux"]) {
        Some(dnf)
    } else if any(&["arch", "manjaro", "endeavouros"]) {
        Some(pacman)
    } else if any(&["suse", "opensuse", "opensuse-leap", "opensuse-tumbleweed"]) {
        Some(zypper)
    } else if has("apt-get") {
        Some(apt)
    } else if has("dnf") {
        Some(dnf)
    } else if has("pacman") {
        Some(pacman)
    } else if has("zypper") {
        Some(zypper)
    } else {
        None
    }
}

pub fn on_path(program: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(program).is_file()))
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// One-click MiKTeX (Windows)
// ---------------------------------------------------------------------------

/// `essential` downloads less and fetches the rest on demand; `basic` includes
/// the packages most templates use.
pub fn validate_package_set(set: &str) -> Result<&str, String> {
    match set {
        "essential" | "basic" => Ok(set),
        other => Err(format!("Unknown MiKTeX package set: {}", other)),
    }
}

/// Arguments for `miktexsetup_standalone.exe` (`download` or `install`).
pub fn miktexsetup_args(command: &str, package_set: &str, repo_dir: &Path, install_dir: &Path) -> Vec<String> {
    let mut args = vec![
        "--quiet".to_string(),
        format!("--local-package-repository={}", repo_dir.display()),
        format!("--package-set={}", package_set),
    ];
    if command == "download" {
        args.push(format!("--remote-package-repository={}", MIKTEX_REPOSITORY));
    } else {
        // User mode: no administrator rights needed. Vitae finds pdflatex at this
        // location itself, so the user's PATH is left alone.
        args.push("--shared=no".to_string());
        args.push(format!("--user-install={}", install_dir.display()));
        args.push("--modify-path=no".to_string());
    }
    args.push(command.to_string());
    args
}

/// Where a user-mode MiKTeX install goes; matches the paths `detect_pdflatex` searches.
pub fn miktex_install_dir(local_app_data: &Path) -> PathBuf {
    local_app_data.join("Programs").join("MiKTeX")
}

const PS_DOWNLOAD: &str = r#"$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $r = Invoke-WebRequest -Uri $env:VITAE_URL -OutFile $env:VITAE_OUT -UseBasicParsing -PassThru
  if ($r.BaseResponse.ResponseUri -and $r.BaseResponse.ResponseUri.Scheme -ne 'https') { throw 'The download was redirected to an insecure address' }
  Expand-Archive -LiteralPath $env:VITAE_OUT -DestinationPath $env:VITAE_DIR -Force
} catch { Write-Output ('ERROR: ' + $_.Exception.Message); exit 1 }"#;

fn run(mut cmd: std::process::Command, timeout: Duration, what: &str) -> Result<PassOutput, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    run_with_timeout(cmd, timeout).map_err(|e| match e {
        RunError::TimedOut => format!("{} took too long and was stopped", what),
        RunError::Spawn(msg) => format!("Couldn't start {}: {}", what, msg),
    })
}

/// Downloads and installs MiKTeX for the current user, reporting each phase
/// through `emit(phase, message)`. Temporary files are always removed.
pub fn install_miktex(
    package_set: &str,
    work_dir: &Path,
    install_dir: &Path,
    emit: &dyn Fn(&str, &str),
) -> Result<(), String> {
    let package_set = validate_package_set(package_set)?;
    let result = install_miktex_inner(package_set, work_dir, install_dir, emit);
    emit("cleanup", "Cleaning up…");
    let _ = fs::remove_dir_all(work_dir);
    result
}

fn install_miktex_inner(
    package_set: &str,
    work_dir: &Path,
    install_dir: &Path,
    emit: &dyn Fn(&str, &str),
) -> Result<(), String> {
    let _ = fs::remove_dir_all(work_dir);
    fs::create_dir_all(work_dir).map_err(|e| format!("Couldn't create a working folder: {}", e))?;
    let zip = work_dir.join("miktexsetup.zip");
    let tool_dir = work_dir.join("tool");
    let repo_dir = work_dir.join("repository");

    emit("setup", "Downloading the MiKTeX setup tool…");
    let mut ps = create_silent_command("powershell.exe");
    ps.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_DOWNLOAD])
        .env("VITAE_URL", MIKTEX_SETUP_URL)
        .env("VITAE_OUT", &zip)
        .env("VITAE_DIR", &tool_dir);
    let fetched = run(ps, SMALL_STEP_TIMEOUT, "the setup download")?;
    let tool = tool_dir.join(SETUP_EXE);
    if !fetched.success || !tool.is_file() {
        let detail = fetched.stdout.lines().find(|l| l.starts_with("ERROR:")).unwrap_or("").to_string();
        return Err(format!("Couldn't download the MiKTeX setup tool. {}", detail).trim().to_string());
    }

    emit("download", "Downloading MiKTeX packages. This can take several minutes…");
    let mut download = create_silent_command(&tool);
    download.args(miktexsetup_args("download", package_set, &repo_dir, install_dir));
    if !run(download, SETUP_STEP_TIMEOUT, "the MiKTeX download")?.success {
        return Err("The MiKTeX packages couldn't be downloaded. Check your internet connection and try again.".into());
    }

    emit("install", "Installing MiKTeX…");
    let mut install = create_silent_command(&tool);
    install.args(miktexsetup_args("install", package_set, &repo_dir, install_dir));
    if !run(install, SETUP_STEP_TIMEOUT, "the MiKTeX installation")?.success {
        return Err("MiKTeX couldn't be installed.".into());
    }

    // MiKTeX won't install missing packages on the fly until the package database
    // has been refreshed once and auto-install is on. Best effort: Vitae also
    // installs packages itself if these don't take.
    emit("configure", "Finishing setup…");
    let bin_dir = install_dir.join("miktex").join("bin").join("x64");
    let mut mpm = create_silent_command(bin_dir.join("mpm.exe"));
    mpm.args(["--update-db".to_string(), format!("--repository={}", MIKTEX_REPOSITORY)]);
    let _ = run(mpm, SMALL_STEP_TIMEOUT, "the package database update");
    let mut initexmf = create_silent_command(bin_dir.join("initexmf.exe"));
    initexmf.arg("--set-config-value=[MPM]AutoInstall=1");
    let _ = run(initexmf, SMALL_STEP_TIMEOUT, "the MiKTeX configuration");
    Ok(())
}

// ---------------------------------------------------------------------------
// Installed packages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct TexPackage {
    pub name: String,
    pub size_bytes: u64,
    pub core: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TexOverview {
    pub kind: String,
    pub total_bytes: u64,
    pub packages: Vec<TexPackage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TexInstall {
    /// Everything the distribution occupies; its size is what the user cares about.
    pub root: PathBuf,
    /// The tree holding `tex/`, `fonts/` and `doc/`.
    pub base: PathBuf,
}

fn is_package_tree(dir: &Path) -> bool {
    dir.join("texmf-dist").is_dir() || (dir.join("tex").is_dir() && dir.join("miktex").is_dir())
}

fn resolve_on_path(program: &Path) -> Option<PathBuf> {
    if program.components().count() > 1 {
        return Some(program.to_path_buf());
    }
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(program))
        .find(|candidate| candidate.is_file())
}

fn install_from_root(root: &Path) -> TexInstall {
    let texlive_dist = root.join("texmf-dist");
    TexInstall {
        base: if texlive_dist.is_dir() { texlive_dist } else { root.to_path_buf() },
        root: root.to_path_buf(),
    }
}

/// Finds the directory tree that holds the installed TeX packages, starting
/// from where `pdflatex` lives (following symlinks such as /Library/TeX/texbin).
pub fn find_install(bin: &LatexBinary) -> Option<TexInstall> {
    if let Some(real) = resolve_on_path(&bin.path).and_then(|p| fs::canonicalize(p).ok()) {
        if let Some(root) = real.ancestors().skip(1).find(|dir| is_package_tree(dir)) {
            return Some(install_from_root(root));
        }
    }
    // Distro packages (e.g. Debian) keep binaries apart from the texmf tree.
    let mut cmd = create_silent_command("kpsewhich");
    cmd.arg("-var-value=TEXMFDIST").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let out = run_with_timeout(cmd, Duration::from_secs(15)).ok()?;
    let dist = PathBuf::from(out.stdout.trim());
    if out.success && dist.is_dir() {
        return Some(TexInstall { root: dist.parent().unwrap_or(&dist).to_path_buf(), base: dist });
    }
    None
}

/// Total size of the files under `path`, without following symlinks.
pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(t) if t.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

fn child_dirs(path: &Path) -> Vec<PathBuf> {
    fs::read_dir(path)
        .map(|rd| rd.flatten().filter(|e| e.file_type().map_or(false, |t| t.is_dir())).map(|e| e.path()).collect())
        .unwrap_or_default()
}

/// Estimated size per package. A package's files live in folders named after it
/// (`tex/latex/<pkg>`, `doc/latex/<pkg>`, `fonts/<kind>/<supplier>/<pkg>`), so
/// summing those folders approximates what removing it would free.
pub fn scan_packages(base: &Path) -> Vec<TexPackage> {
    let mut sizes: BTreeMap<String, u64> = BTreeMap::new();
    let mut add = |dir: PathBuf| {
        if let Some(name) = dir.file_name().and_then(OsStr::to_str) {
            if is_package_name(name) {
                *sizes.entry(name.to_string()).or_default() += dir_size(&dir);
            }
        }
    };
    for tree in ["tex/latex", "tex/generic", "tex/xelatex", "tex/lualatex", "doc/latex", "doc/generic", "source/latex"] {
        child_dirs(&base.join(tree)).into_iter().for_each(&mut add);
    }
    for kind in child_dirs(&base.join("fonts")) {
        for supplier in child_dirs(&kind) {
            child_dirs(&supplier).into_iter().for_each(&mut add);
        }
    }
    let mut packages: Vec<TexPackage> = sizes
        .into_iter()
        .map(|(name, size_bytes)| TexPackage { core: is_core(&name), name, size_bytes })
        .collect();
    packages.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name)));
    packages
}

pub fn is_core(name: &str) -> bool {
    CORE_PACKAGES.contains(&name)
}

/// Names are passed to MiKTeX's `mpm` / `tlmgr`, so keep them to plain package names.
pub fn is_package_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && !name.starts_with(['-', '.'])
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
}

pub fn overview(bin: &LatexBinary) -> Result<TexOverview, String> {
    let install = find_install(bin).ok_or("Couldn't find where LaTeX packages are installed.")?;
    Ok(TexOverview {
        kind: if bin.is_miktex { "miktex" } else { "texlive" }.to_string(),
        total_bytes: dir_size(&install.root),
        packages: scan_packages(&install.base),
    })
}

/// Removes an installed package through the distribution's own tool.
pub fn remove_package(bin: &LatexBinary, name: &str) -> Result<(), String> {
    if !is_package_name(name) {
        return Err("That isn't a valid package name.".into());
    }
    if is_core(name) {
        return Err(format!("`{}` is needed by LaTeX itself and can't be removed.", name));
    }
    let install = find_install(bin).ok_or("Couldn't find where LaTeX packages are installed.")?;
    if !scan_packages(&install.base).iter().any(|p| p.name == name) {
        return Err(format!("`{}` isn't installed.", name));
    }
    let bin_dir = bin.path.parent().filter(|d| !d.as_os_str().is_empty());
    let exe = |stem: &str| -> PathBuf {
        let file = match (cfg!(windows), stem) {
            (true, "tlmgr") => "tlmgr.bat".to_string(),
            (true, _) => format!("{}.exe", stem),
            (false, _) => stem.to_string(),
        };
        bin_dir.map_or_else(|| PathBuf::from(&file), |dir| dir.join(&file))
    };
    let mut cmd;
    if bin.is_miktex {
        cmd = create_silent_command(exe("mpm"));
        cmd.arg(format!("--uninstall={}", name));
    } else {
        cmd = create_silent_command(exe("tlmgr"));
        cmd.args(["remove", "--force", name]);
    }
    if run(cmd, REMOVE_TIMEOUT, "the package remover")?.success {
        Ok(())
    } else {
        Err(format!("`{}` couldn't be removed. It may belong to a system-wide TeX install; use your package manager instead.", name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_tree(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vitae-tex-setup-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn test_linux_install_command_by_distro() {
        let none = |_: &str| false;
        let ubuntu = "NAME=\"Ubuntu\"\nID=ubuntu\nID_LIKE=debian\n";
        assert_eq!(linux_install_command(ubuntu, &none).unwrap().manager, "apt");
        let mint = "ID=linuxmint\nID_LIKE=\"ubuntu debian\"\n";
        assert_eq!(linux_install_command(mint, &none).unwrap().manager, "apt");
        let fedora = "ID=fedora\n";
        assert!(linux_install_command(fedora, &none).unwrap().command.contains("dnf install texlive"));
        let manjaro = "ID=manjaro\nID_LIKE=arch\n";
        assert_eq!(linux_install_command(manjaro, &none).unwrap().manager, "pacman");
        let tumbleweed = "ID=\"opensuse-tumbleweed\"\nID_LIKE=\"opensuse suse\"\n";
        assert_eq!(linux_install_command(tumbleweed, &none).unwrap().manager, "zypper");
    }

    #[test]
    fn test_linux_install_command_falls_back_to_installed_manager() {
        let only_pacman = |p: &str| p == "pacman";
        assert_eq!(linux_install_command("ID=weirdos\n", &only_pacman).unwrap().manager, "pacman");
        assert_eq!(linux_install_command("", &|_: &str| false), None);
    }

    #[test]
    fn test_miktexsetup_args() {
        let repo = Path::new("C:/tmp/repo");
        let dest = Path::new("C:/Users/me/AppData/Local/Programs/MiKTeX");
        let download = miktexsetup_args("download", "basic", repo, dest);
        assert_eq!(download.last().unwrap(), "download");
        assert!(download.contains(&"--package-set=basic".to_string()));
        assert!(download.iter().any(|a| a.starts_with("--remote-package-repository=https://")));
        assert!(!download.iter().any(|a| a.starts_with("--user-install")));

        let install = miktexsetup_args("install", "essential", repo, dest);
        assert_eq!(install.last().unwrap(), "install");
        assert!(install.contains(&"--shared=no".to_string()), "must install for the current user only");
        assert!(install.contains(&"--modify-path=no".to_string()));
        assert!(install.iter().any(|a| a.starts_with("--user-install=") && a.contains("MiKTeX")));
        assert!(install.contains(&"--quiet".to_string()), "no prompts");
    }

    #[test]
    fn test_validate_package_set() {
        assert!(validate_package_set("basic").is_ok());
        assert!(validate_package_set("essential").is_ok());
        assert!(validate_package_set("complete").is_err());
        assert!(validate_package_set("basic --evil").is_err());
    }

    #[test]
    fn test_miktex_install_dir_matches_detection_path() {
        let dir = miktex_install_dir(Path::new("C:/Users/me/AppData/Local"));
        assert!(dir.ends_with("Programs/MiKTeX"));
    }

    #[test]
    fn test_is_package_name_and_core() {
        assert!(is_package_name("sourcesanspro"));
        assert!(is_package_name("l3kernel"));
        assert!(!is_package_name("--force"));
        assert!(!is_package_name("../x"));
        assert!(!is_package_name("a b"));
        assert!(is_core("amsmath"));
        assert!(!is_core("sourcesanspro"));
    }

    #[test]
    fn test_scan_packages_sums_package_folders_and_sorts_by_size() {
        let base = temp_tree("scan");
        write(&base.join("tex/latex/sourcesanspro/sourcesanspro.sty"), 100);
        write(&base.join("fonts/type1/adobe/sourcesanspro/a.pfb"), 5000);
        write(&base.join("doc/latex/sourcesanspro/readme.txt"), 20);
        write(&base.join("tex/latex/titlesec/titlesec.sty"), 300);
        write(&base.join("tex/latex/amsmath/amsmath.sty"), 50);
        write(&base.join("tex/latex/loose-file.sty"), 10); // not a package folder
        let packages = scan_packages(&base);
        assert_eq!(packages[0], TexPackage { name: "sourcesanspro".into(), size_bytes: 5120, core: false });
        assert_eq!(packages[1].name, "titlesec");
        assert_eq!(packages[1].size_bytes, 300);
        assert!(packages.iter().find(|p| p.name == "amsmath").unwrap().core);
        assert_eq!(packages.len(), 3);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn test_dir_size() {
        let dir = temp_tree("size");
        write(&dir.join("a/one"), 10);
        write(&dir.join("a/b/two"), 25);
        assert_eq!(dir_size(&dir), 35);
        assert_eq!(dir_size(&dir.join("missing")), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_find_install_for_texlive_and_miktex_layouts() {
        let texlive = temp_tree("tl");
        write(&texlive.join("texmf-dist/tex/latex/x/x.sty"), 1);
        write(&texlive.join("bin/x86_64-linux/pdflatex"), 1);
        let bin = LatexBinary { path: texlive.join("bin/x86_64-linux/pdflatex"), is_miktex: false };
        let found = find_install(&bin).unwrap();
        assert_eq!(found.base, fs::canonicalize(&texlive).unwrap().join("texmf-dist"));
        assert_eq!(found.root, fs::canonicalize(&texlive).unwrap());

        let miktex = temp_tree("mk");
        write(&miktex.join("tex/latex/x/x.sty"), 1);
        write(&miktex.join("miktex/bin/x64/pdflatex.exe"), 1);
        let bin = LatexBinary { path: miktex.join("miktex/bin/x64/pdflatex.exe"), is_miktex: true };
        let found = find_install(&bin).unwrap();
        assert_eq!(found.base, fs::canonicalize(&miktex).unwrap());
        let _ = fs::remove_dir_all(&texlive);
        let _ = fs::remove_dir_all(&miktex);
    }

    #[test]
    fn test_remove_package_refuses_core_and_bad_names() {
        let bin = LatexBinary { path: PathBuf::from("pdflatex"), is_miktex: false };
        assert!(remove_package(&bin, "amsmath").unwrap_err().contains("needed by LaTeX"));
        assert!(remove_package(&bin, "--all").unwrap_err().contains("valid package name"));
    }
}
