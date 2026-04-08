#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# yeet installer
# curl -fsSL https://raw.githubusercontent.com/aakashlpin/yeet/main/install.sh | bash
# ──────────────────────────────────────────────

VERSION="1.0.0"
REPO="aakashlpin/yeet"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
GRANOLA_PKG="granola-cli"

bold="\033[1m"
green="\033[32m"
red="\033[31m"
cyan="\033[36m"
yellow="\033[33m"
reset="\033[0m"

info()  { printf "${cyan}▸${reset} %s\n" "$*"; }
ok()    { printf "${green}✓${reset} %s\n" "$*"; }
warn()  { printf "${yellow}⚠${reset} %s\n" "$*"; }
fail()  { printf "${red}✗${reset} %s\n" "$*" >&2; exit 1; }

# ── Detect install directory ──
if [ -d "$HOME/.local/bin" ]; then
  INSTALL_DIR="$HOME/.local/bin"
elif [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  INSTALL_DIR="/usr/local/bin"
else
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
fi

info "Installing yeet v${VERSION}..."

# ── Download ──
curl -fsSL "${RAW_BASE}/yeet" -o "${INSTALL_DIR}/yeet" \
  || fail "Failed to download yeet. Check your internet connection."
chmod +x "${INSTALL_DIR}/yeet"

ok "Installed to ${INSTALL_DIR}/yeet"

# ── Check PATH ──
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  warn "${INSTALL_DIR} is not in your PATH."
  echo ""

  SHELL_NAME=$(basename "$SHELL")
  case "$SHELL_NAME" in
    zsh)  RC_FILE="$HOME/.zshrc" ;;
    bash) RC_FILE="$HOME/.bashrc" ;;
    fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
    *)    RC_FILE="$HOME/.profile" ;;
  esac

  if [ "$SHELL_NAME" = "fish" ]; then
    PATH_LINE="fish_add_path ${INSTALL_DIR}"
  else
    PATH_LINE="export PATH=\"${INSTALL_DIR}:\$PATH\""
  fi

  printf "   Add this to ${bold}%s${reset}:\n\n" "$RC_FILE"
  printf "   ${cyan}%s${reset}\n\n" "$PATH_LINE"
  printf "   Then run: ${bold}source %s${reset}\n\n" "$RC_FILE"
fi

# ── Check dependencies ──
echo ""
info "Checking dependencies..."

missing=()

if ! command -v node &>/dev/null; then
  missing+=("node (brew install node)")
fi

if ! command -v npm &>/dev/null; then
  missing+=("npm (comes with node)")
fi

if ! command -v fzf &>/dev/null; then
  missing+=("fzf (brew install fzf)")
fi

if ! command -v gh &>/dev/null; then
  missing+=("gh (brew install gh) — needed for gist backend")
fi

if ! command -v python3 &>/dev/null; then
  missing+=("python3 (brew install python3)")
fi

if [ ${#missing[@]} -eq 0 ]; then
  ok "All dependencies found"

  info "Preparing Granola CLI (${GRANOLA_PKG})..."
  if npm exec --yes --package="${GRANOLA_PKG}" -- granola --version >/dev/null 2>&1; then
    ok "Granola CLI ready"
  else
    warn "Could not preinstall ${GRANOLA_PKG}. yeet will retry on first run."
  fi
else
  warn "Missing dependencies:"
  for dep in "${missing[@]}"; do
    printf "   ${yellow}•${reset} %s\n" "$dep"
  done
  echo ""
fi

# ── Done ──
echo ""
printf "${green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}\n"
printf "${bold} yeet${reset} installed successfully!\n"
printf "${green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${reset}\n"
echo ""
printf " Run ${bold}yeet${reset} to pick a Granola meeting\n"
printf " and publish its transcript as a shareable link.\n"
echo ""
printf " ${cyan}yeet${reset}              → publish via GitHub Gist\n"
printf " ${cyan}yeet -j${reset}           → publish via Jotbird\n"
printf " ${cyan}yeet --help${reset}       → see all options\n"
echo ""
