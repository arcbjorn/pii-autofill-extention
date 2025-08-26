#!/bin/bash

# Chrome Extension Auto-Install Script
# Builds and loads the PII Autofill Extension

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Chrome/Chromium is installed
check_chrome() {
    if command -v google-chrome >/dev/null 2>&1; then
        CHROME_CMD="google-chrome"
    elif command -v chromium >/dev/null 2>&1; then
        CHROME_CMD="chromium"
    elif command -v chromium-browser >/dev/null 2>&1; then
        CHROME_CMD="chromium-browser"
    else
        print_error "Chrome or Chromium not found. Please install Chrome/Chromium first."
        exit 1
    fi
    print_status "Found browser: $CHROME_CMD"
}

# Build the extension
build_extension() {
    print_status "Building extension..."
    
    # Clean previous build
    rm -rf dist
    mkdir -p dist
    
    # Copy all source files
    cp -r src/* dist/
    cp manifest.json dist/
    
    # Remove development-only files from production build
    if [ -f "dist/dev-client.js" ]; then
        rm dist/dev-client.js
        print_status "Removed dev-client.js from production build"
    fi
    
    print_success "Extension built successfully in ./dist/"
}

# Get Chrome user data directory
get_chrome_user_dir() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        CHROME_USER_DIR="$HOME/.config/google-chrome"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        CHROME_USER_DIR="$HOME/Library/Application Support/Google/Chrome"
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
        CHROME_USER_DIR="$APPDATA/Google/Chrome/User Data"
    else
        print_warning "Unknown OS, using default Chrome user directory"
        CHROME_USER_DIR="$HOME/.config/google-chrome"
    fi
}

# Enable developer mode using Chrome preferences
enable_developer_mode() {
    print_status "Enabling developer mode..."
    
    get_chrome_user_dir
    PREFS_FILE="$CHROME_USER_DIR/Default/Preferences"
    
    if [ ! -f "$PREFS_FILE" ]; then
        print_warning "Chrome preferences file not found. Developer mode must be enabled manually."
        return 1
    fi
    
    # Backup original preferences
    cp "$PREFS_FILE" "$PREFS_FILE.backup"
    
    # Enable developer mode in preferences
    # This modifies the extensions.ui.developer_mode setting
    python3 -c "
import json
import sys

try:
    with open('$PREFS_FILE', 'r') as f:
        prefs = json.load(f)
    
    # Ensure extensions object exists
    if 'extensions' not in prefs:
        prefs['extensions'] = {}
    if 'ui' not in prefs['extensions']:
        prefs['extensions']['ui'] = {}
    
    # Enable developer mode
    prefs['extensions']['ui']['developer_mode'] = True
    
    with open('$PREFS_FILE', 'w') as f:
        json.dump(prefs, f, indent=2)
    
    print('Developer mode enabled in Chrome preferences')
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null || {
        print_warning "Failed to enable developer mode automatically. Please enable manually."
        return 1
    }
    
    print_success "Developer mode enabled"
}

# Open Chrome extensions page and load extension
load_extension() {
    print_status "Opening Chrome extensions page..."
    
    # Get absolute path to dist directory
    DIST_PATH=$(realpath ./dist)
    
    # Open Chrome with extensions page
    $CHROME_CMD --new-window "chrome://extensions/" &
    CHROME_PID=$!
    
    print_status "Chrome opened with extensions page"
    print_status "Extension directory: $DIST_PATH"
    
    # Wait a moment for Chrome to open
    sleep 3
    
    # Attempt to load extension using Chrome command line (if supported)
    print_status "Attempting to load unpacked extension..."
    
    # Try to load the extension directory
    $CHROME_CMD --load-extension="$DIST_PATH" >/dev/null 2>&1 || {
        print_warning "Automatic loading failed. Please manually:"
        echo "  1. Click 'Load unpacked' button"
        echo "  2. Select directory: $DIST_PATH"
        return 1
    }
    
    print_success "Extension loaded successfully!"
}

# Manual installation instructions
show_manual_instructions() {
    print_status "Manual installation steps:"
    echo ""
    echo "1. Open Chrome and go to: chrome://extensions/"
    echo "2. Enable 'Developer mode' toggle (top right)"
    echo "3. Click 'Load unpacked' button"
    echo "4. Select the 'dist' folder: $(realpath ./dist)"
    echo ""
    print_status "The extension should now appear in your extensions list"
}

# Main installation process
main() {
    echo "==================================="
    echo "PII Autofill Extension Installer"
    echo "==================================="
    echo ""
    
    # Step 1: Check for Chrome
    check_chrome
    
    # Step 2: Build extension
    build_extension
    
    # Step 3: Enable developer mode
    if ! enable_developer_mode; then
        print_warning "Developer mode setup failed, continuing..."
    fi
    
    # Step 4: Load extension
    if ! load_extension; then
        print_warning "Automatic loading failed, showing manual instructions..."
        show_manual_instructions
    fi
    
    echo ""
    print_success "Installation process completed!"
    print_status "Extension directory: $(realpath ./dist)"
    
    # Show additional info
    echo ""
    print_status "Development commands:"
    echo "  pnpm run dev     - Start development server"
    echo "  pnpm run build   - Rebuild extension"
    echo "  ./install.sh     - Reinstall extension"
}

# Run main function
main "$@"