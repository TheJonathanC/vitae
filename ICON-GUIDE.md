# Icon Generation Guide

## Required Icons for Tauri

Place these icons in `src-tauri/icons/`:

- `32x32.png` - Taskbar icon
- `128x128.png` - Main app icon
- `128x128@2x.png` - Retina display
- `icon.icns` - macOS icon
- `icon.ico` - Windows icon (contains multiple sizes: 16, 24, 32, 48, 64, 256)
- `icon.png` - Base icon (at least 512x512 or 1024x1024)

## How to Generate Icons

### Option 1: Use Tauri CLI (Easiest)
1. Create a 1024x1024 PNG icon as `app-icon.png` in project root
2. Run:
```bash
npm install -g @tauri-apps/cli
cd src-tauri
npx @tauri-apps/cli icon ../app-icon.png
```

### Option 2: Online Tools
- Use https://icon.kitchen or https://cloudconvert.com/png-to-ico
- Upload your base PNG (1024x1024 recommended)
- Download all sizes

### Option 3: Manual with ImageMagick
```bash
# Install ImageMagick first
# Then convert your base icon
magick convert icon.png -resize 32x32 32x32.png
magick convert icon.png -resize 128x128 128x128.png
magick convert icon.png -resize 256x256 128x128@2x.png
magick convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
```

## Your Current Icon
You have a basic blue "V" icon at `src-tauri/icons/icon.ico`
Replace it with a professional design for better branding.
