#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
# yeet installer
# curl -fsSL https://raw.githubusercontent.com/shawshankkumar/yeet/main/install.sh | bash
# ──────────────────────────────────────────────

VERSION="2.0.0"
REPO="${YEET_REPO:-shawshankkumar/yeet}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"
CONFIG_DIR="$HOME/.config/yeet"

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

# ── Download the yeet entrypoint ──
curl -fsSL "${RAW_BASE}/yeet" -o "${INSTALL_DIR}/yeet" \
  || fail "Failed to download yeet. Check your internet connection."
chmod +x "${INSTALL_DIR}/yeet"
ok "Installed to ${INSTALL_DIR}/yeet"

# ── Download the Granola MCP client helper + its package manifest ──
mkdir -p "$CONFIG_DIR"
curl -fsSL "${RAW_BASE}/granola-mcp.mjs" -o "${CONFIG_DIR}/granola-mcp.mjs" \
  || fail "Failed to download granola-mcp.mjs."
curl -fsSL "${RAW_BASE}/package.json" -o "${CONFIG_DIR}/package.json" \
  || fail "Failed to download package.json."
ok "Installed Granola MCP helper to ${CONFIG_DIR}/granola-mcp.mjs"

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
command -v node    &>/dev/null || missing+=("node (brew install node)")
command -v npm     &>/dev/null || missing+=("npm (comes with node)")
command -v fzf     &>/dev/null || missing+=("fzf (brew install fzf)")
command -v gh      &>/dev/null || missing+=("gh (brew install gh) — needed for gist backend")
command -v python3 &>/dev/null || missing+=("python3 (brew install python3)")

if [ ${#missing[@]} -eq 0 ]; then
  ok "All dependencies found"

  # Preload the MCP client SDK so the first `yeet` run doesn't pause to
  # npm-install (and never hangs on an interactive npx prompt).
  info "Installing Granola MCP client dependencies..."
  if ( cd "$CONFIG_DIR" && npm install --silent >/dev/null 2>&1 ); then
    ok "Granola MCP client ready"
  else
    warn "Could not preinstall MCP client deps. yeet will retry on first run."
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
printf " Run ${bold}yeet${reset} to pick a Granola meeting and publish its\n"
printf " notes (or transcript) as a shareable link.\n"
echo ""
printf " First run opens your browser to sign in to Granola (OAuth);\n"
printf " the token is cached so later runs are silent.\n"
echo ""
printf " ${cyan}yeet${reset}              → publish notes + summary via GitHub Gist\n"
printf " ${cyan}yeet -t${reset}           → publish raw transcript (paid Granola plan)\n"
printf " ${cyan}yeet -j${reset}           → publish via Jotbird\n"
printf " ${cyan}yeet --help${reset}       → see all options\n"
echo ""
