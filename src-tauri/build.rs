fn main() {
    #[cfg(target_os = "linux")]
    {
        println!("cargo:rustc-link-search=native=/home/jon/.local/lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN");
        println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/../lib");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/home/jon/.local/lib");
    }
    tauri_build::build()
}
