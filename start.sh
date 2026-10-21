#!/usr/bin/env bash
#
# LAN Camera Streaming - Supervisor and Startup Script for Ubuntu / Linux
# Mirrors functionality of start.ps1 for Ubuntu 24.04 and POSIX Linux environments.
#
# Default mode (zrok tunnel, phone gets HTTPS URL from zrok):
#   1. Installs npm dependencies and creates .env from .env.example when missing.
#   2. Loads configuration from .env.
#   3. Enables the zrok environment when ZROK_TOKEN is configured.
#   4. Starts the Node.js server and binds public zrok share.
#   5. Prints phone URL and terminal QR code, then releases resources on Ctrl+C.
#
# --local-only mode (direct LAN without zrok):
#   Serves the app over the LAN (HTTP or HTTPS if certificates are supplied).
#   Prints LAN IP URLs and terminal QR code.
#

set -o pipefail

# ANSI Color Codes
COLOR_CYAN="\033[36m"
COLOR_GREEN="\033[32m"
COLOR_YELLOW="\033[33m"
COLOR_RED="\033[31m"
COLOR_RESET="\033[0m"

# Parse Command-Line Arguments
LOCAL_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --local-only|-LocalOnly|-l)
      LOCAL_ONLY=true
      shift
      ;;
    --help|-h)
      echo -e "${COLOR_CYAN}LAN Camera Streaming - Ubuntu / Linux Startup Script${COLOR_RESET}"
      echo ""
      echo "Usage:"
      echo "  ./start.sh                Start with public zrok HTTPS tunnel"
      echo "  ./start.sh --local-only   Start in local LAN-only mode (no zrok quota used)"
      echo "  ./start.sh --help         Show this help message"
      echo ""
      exit 0
      ;;
    *)
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 0. First-run preparation: dependencies and .env
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo -e "${COLOR_CYAN}Installing npm dependencies (first run)...${COLOR_RESET}"
  if ! npm install; then
    echo -e "${COLOR_RED}npm install failed.${COLOR_RESET}" >&2
    exit 1
  fi
fi

ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
if [ ! -f "$ENV_FILE" ] && [ -f "$ENV_EXAMPLE" ]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo -e "${COLOR_YELLOW}Created .env from .env.example (set ZROK_TOKEN there for tunnel mode).${COLOR_RESET}"
fi

# 1. Load configuration from .env (without overwriting existing env variables)
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Trim whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    if [ -n "$line" ] && [[ ! "$line" =~ ^# ]] && [[ "$line" =~ = ]]; then
      key="${line%%=*}"
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"
      val="${line#*=}"
      val="${val#"${val%%[![:space:]]*}"}"
      val="${val%"${val##*[![:space:]]}"}"
      # Strip outer quotes
      if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
        val="${val:1:-1}"
      fi
      if [ -z "${!key+x}" ]; then
        export "$key=$val"
      fi
    fi
  done < "$ENV_FILE"
fi

PORT="${PORT:-3000}"
HOST_ADDR="${HOST:-0.0.0.0}"
PIN="${ACCESS_PIN:-123456}"
ZROK_TOKEN="${ZROK_TOKEN:-}"

# In tunnel mode, zrok proxies plain HTTP to the local server
if [ "$LOCAL_ONLY" != "true" ]; then
  unset HTTPS_CERT_PATH
  unset HTTPS_KEY_PATH
fi

SCHEME="http"
if [ -n "$HTTPS_CERT_PATH" ] && [ -n "$HTTPS_KEY_PATH" ] && [ -f "$HTTPS_CERT_PATH" ] && [ -f "$HTTPS_KEY_PATH" ]; then
  SCHEME="https"
fi

TARGET_URL="${SCHEME}://127.0.0.1:$PORT"

# Helper Functions
test_server_healthy() {
  local s_scheme="$1"
  local s_port="$2"
  if [ "$s_scheme" = "https" ]; then
    timeout 1 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$s_port" 2>/dev/null && return 0 || return 1
  fi
  if command -v curl >/dev/null 2>&1; then
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "http://127.0.0.1:$s_port/health" 2>/dev/null || true)
    [ "$status" = "200" ] && return 0 || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null -T 1 "http://127.0.0.1:$s_port/health" 2>/dev/null && return 0 || return 1
  else
    timeout 1 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$s_port" 2>/dev/null && return 0 || return 1
  fi
}

get_lan_addresses() {
  local addrs=()
  if command -v hostname >/dev/null 2>&1; then
    for ip in $(hostname -I 2>/dev/null); do
      if [[ "$ip" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
        addrs+=("$ip")
      fi
    done
  fi
  if [ ${#addrs[@]} -eq 0 ] && command -v ip >/dev/null 2>&1; then
    for ip in $(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1); do
      if [[ "$ip" =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
        addrs+=("$ip")
      fi
    done
  fi
  echo "${addrs[@]}"
}

show_terminal_qr() {
  local url="$1"
  node -e "import('qrcode-terminal').then(q => q.default.generate(process.argv[1], { small: true })).catch(() => {})" "$url" 2>/dev/null || true
}

find_zrok_binary() {
  if command -v zrok >/dev/null 2>&1; then
    command -v zrok
    return 0
  fi
  if command -v zrok2 >/dev/null 2>&1; then
    command -v zrok2
    return 0
  fi
  local possible_paths=(
    "/usr/local/bin/zrok"
    "/usr/bin/zrok"
    "/opt/zrok/bin/zrok"
    "/opt/zrok/zrok"
    "$HOME/.zrok/bin/zrok"
  )
  for p in "${possible_paths[@]}"; do
    if [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

# Banner
echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"
if [ "$LOCAL_ONLY" = "true" ]; then
  echo -e "${COLOR_GREEN} LAN Camera Streaming (local only, no zrok)${COLOR_RESET}"
else
  echo -e "${COLOR_GREEN} LAN Camera Streaming & zrok Public Tunnel${COLOR_RESET}"
fi
echo -e "${COLOR_CYAN} Port: $PORT | Host: $HOST_ADDR | PIN: $PIN | Scheme: $SCHEME${COLOR_RESET}"
echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"

ZROK_BIN=""
if [ "$LOCAL_ONLY" != "true" ]; then
  if ! ZROK_BIN="$(find_zrok_binary)"; then
    echo -e "${COLOR_RED}error: zrok executable was not found.${COLOR_RESET}" >&2
    echo "To install zrok on Ubuntu 24.04:"
    echo "  curl -sSL https://get.zrok.io | bash"
    echo "Or run in local LAN-only mode:"
    echo "  ./start.sh --local-only"
    exit 1
  fi

  # Enable zrok environment if token configured and not already set up
  if [ -n "$ZROK_TOKEN" ]; then
    status_out=$("$ZROK_BIN" status 2>&1 || true)
    if echo "$status_out" | grep -q "Account Token" && echo "$status_out" | grep -q "<<SET>>"; then
      echo -e "${COLOR_GREEN}zrok environment is already enabled.${COLOR_RESET}"
    else
      echo -e "${COLOR_CYAN}Enabling zrok environment with configured ZROK_TOKEN...${COLOR_RESET}"
      "$ZROK_BIN" enable "$ZROK_TOKEN" --headless
    fi
  fi
fi

# Track processes for cleanup
SERVER_PID=""
ZROK_PID=""
ACTIVE_SHARE_TOKEN=""
IS_RESERVED=false
IS_V2=false
CLEANED_UP=false

cleanup() {
  if [ "$CLEANED_UP" = "true" ]; then
    return
  fi
  CLEANED_UP=true

  echo ""
  echo -e "${COLOR_YELLOW}Shutting down...${COLOR_RESET}"

  if [ -n "$ZROK_PID" ] && kill -0 "$ZROK_PID" 2>/dev/null; then
    echo -e "${COLOR_CYAN}Stopping zrok share process (PID: $ZROK_PID)...${COLOR_RESET}"
    kill -TERM "$ZROK_PID" 2>/dev/null || true
    wait "$ZROK_PID" 2>/dev/null || true
  fi

  if [ "$IS_RESERVED" != "true" ] && [ -n "$ACTIVE_SHARE_TOKEN" ] && [ -n "$ZROK_BIN" ]; then
    echo -e "${COLOR_CYAN}Releasing dynamic share endpoint '$ACTIVE_SHARE_TOKEN'...${COLOR_RESET}"
    if [ "$IS_V2" = "true" ]; then
      "$ZROK_BIN" delete share "$ACTIVE_SHARE_TOKEN" >/dev/null 2>&1 || true
    else
      "$ZROK_BIN" release "$ACTIVE_SHARE_TOKEN" >/dev/null 2>&1 || true
    fi
  fi

  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "${COLOR_CYAN}Stopping background Node.js server (PID: $SERVER_PID)...${COLOR_RESET}"
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi

  echo -e "${COLOR_GREEN}Shutdown complete. Resources released.${COLOR_RESET}"
}

trap cleanup INT TERM EXIT

# Check if Node.js server is already active
if test_server_healthy "$SCHEME" "$PORT"; then
  echo -e "${COLOR_GREEN}Node.js server is already running on $TARGET_URL.${COLOR_RESET}"
else
  echo -e "${COLOR_CYAN}Starting Node.js server in background...${COLOR_RESET}"
  node src/server/index.js &
  SERVER_PID=$!

  attempts=0
  healthy=false
  while [ $attempts -lt 20 ]; do
    sleep 0.5
    attempts=$((attempts + 1))
    if test_server_healthy "$SCHEME" "$PORT"; then
      echo -e "${COLOR_GREEN}Node.js server verified healthy ($TARGET_URL).${COLOR_RESET}"
      healthy=true
      break
    fi
  done

  if [ "$healthy" != "true" ]; then
    echo -e "${COLOR_RED}Node.js server failed to respond within 10 seconds.${COLOR_RESET}" >&2
    exit 1
  fi
fi

# Local-Only Mode
if [ "$LOCAL_ONLY" = "true" ]; then
  read -ra lan_ips <<< "$(get_lan_addresses)"
  echo ""
  echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"
  echo -e "${COLOR_GREEN} LOCAL MODE - no zrok traffic${COLOR_RESET}"
  echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"
  echo -e "${COLOR_YELLOW}Viewer on this machine: ${SCHEME}://localhost:$PORT/viewer${COLOR_RESET}"
  for addr in "${lan_ips[@]}"; do
    echo -e "${COLOR_CYAN}Sender on phone:        ${SCHEME}://${addr}:$PORT/sender${COLOR_RESET}"
  done

  if [ ${#lan_ips[@]} -eq 0 ]; then
    echo -e "${COLOR_YELLOW}Warning: No private LAN IPv4 address found. Check network connection.${COLOR_RESET}"
  else
    echo ""
    show_terminal_qr "${SCHEME}://${lan_ips[0]}:$PORT/sender"
  fi

  if [ "$SCHEME" = "http" ]; then
    echo -e "${COLOR_YELLOW}Note: Phone browsers require HTTPS for camera permissions. On phone Chrome, navigate to:"
    echo "  chrome://flags/#unsafely-treat-insecure-origin-as-secure"
    echo -e "  add the sender URL above, enable it, and relaunch Chrome.${COLOR_RESET}"
  fi

  echo ""
  echo -e "${COLOR_YELLOW}If mobile cannot open the URL, allow traffic through ufw: sudo ufw allow $PORT/tcp${COLOR_RESET}"

  if [ -n "$SERVER_PID" ]; then
    echo -e "${COLOR_YELLOW}Press Ctrl+C to stop the server.${COLOR_RESET}"
    wait "$SERVER_PID"
  else
    echo -e "${COLOR_YELLOW}Server was already running; keeping session open. Press Ctrl+C to exit.${COLOR_RESET}"
    while true; do sleep 3600; done
  fi
  exit 0
fi

# Configure zrok Public Tunnel
echo -e "${COLOR_CYAN}Configuring zrok public share for $TARGET_URL...${COLOR_RESET}"

ACTIVE_SHARE_URL=""
NAME_SELECTION=""
IS_NAMED=false

share_json=$(node --input-type=module -e '
  import { isZrokV2, getZrokShares, findExistingShare, reserveNewShare } from "./src/server/zrok-helper.js";
  const zrokBin = process.argv[1];
  const port = process.argv[2];
  const targetUrl = process.argv[3];
  try {
    const isV2 = isZrokV2(zrokBin);
    const shares = getZrokShares(zrokBin);
    let chosen = findExistingShare(shares, port);
    let isReserved = false;
    if (chosen) {
      isReserved = true;
    } else {
      chosen = reserveNewShare(zrokBin, targetUrl);
      if (chosen) {
        isReserved = true;
      }
    }
    const token = chosen ? (chosen.token || chosen.shareToken) : null;
    const url = chosen ? (chosen.url || chosen.frontendEndpoint) : null;
    const nameSelection = chosen ? (chosen.nameSelection || (token ? "public:" + token : null)) : null;
    const isNamed = Boolean(chosen && chosen.isNamedReservation);
    console.log(JSON.stringify({ isV2, token, url, nameSelection, isNamed, isReserved }));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
' "$ZROK_BIN" "$PORT" "$TARGET_URL" 2>/dev/null || true)

if [ -n "$share_json" ]; then
  IS_V2=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { console.log(JSON.parse(d).isV2); } catch { console.log(false); } })')
  ACTIVE_SHARE_TOKEN=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { const t = JSON.parse(d).token; console.log(t || ""); } catch { console.log(""); } })')
  ACTIVE_SHARE_URL=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { const u = JSON.parse(d).url; console.log(u || ""); } catch { console.log(""); } })')
  NAME_SELECTION=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { const n = JSON.parse(d).nameSelection; console.log(n || ""); } catch { console.log(""); } })')
  IS_NAMED=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { console.log(JSON.parse(d).isNamed); } catch { console.log(false); } })')
  IS_RESERVED=$(echo "$share_json" | node -e 'process.stdin.on("data", d => { try { console.log(JSON.parse(d).isReserved); } catch { console.log(false); } })')
fi

if [ -n "$ACTIVE_SHARE_TOKEN" ]; then
  echo -e "${COLOR_GREEN}Found reserved share '$ACTIVE_SHARE_TOKEN' ($ACTIVE_SHARE_URL).${COLOR_RESET}"
  echo -e "${COLOR_CYAN}Hosting on reserved share '$ACTIVE_SHARE_TOKEN'...${COLOR_RESET}"

  if [ "$IS_V2" = "true" ] || [ "$IS_NAMED" = "true" ]; then
    n_sel="${NAME_SELECTION:-public:$ACTIVE_SHARE_TOKEN}"
    "$ZROK_BIN" share public "$TARGET_URL" -n "$n_sel" --backend-mode proxy --headless &
    ZROK_PID=$!
  else
    "$ZROK_BIN" share reserved "$ACTIVE_SHARE_TOKEN" --override-endpoint "$TARGET_URL" --headless &
    ZROK_PID=$!
  fi

  sleep 2

  if ! kill -0 "$ZROK_PID" 2>/dev/null; then
    echo -e "${COLOR_YELLOW}Warning: Could not start reserved share '$ACTIVE_SHARE_TOKEN'. Falling back to dynamic share...${COLOR_RESET}"
    ACTIVE_SHARE_TOKEN=""
    ACTIVE_SHARE_URL=""
    IS_RESERVED=false
  fi
fi

if [ -z "$ACTIVE_SHARE_TOKEN" ]; then
  echo -e "${COLOR_CYAN}Starting dynamic public share...${COLOR_RESET}"
  "$ZROK_BIN" share public "$TARGET_URL" --backend-mode proxy --headless &
  ZROK_PID=$!

  attempts=0
  while [ $attempts -lt 15 ] && [ -z "$ACTIVE_SHARE_URL" ]; do
    sleep 1
    attempts=$((attempts + 1))
    dyn_json=$(node --input-type=module -e '
      import { getZrokShares } from "./src/server/zrok-helper.js";
      const zrokBin = process.argv[1];
      const port = process.argv[2];
      const shares = getZrokShares(zrokBin);
      const match = shares.filter(s => (s.backendProxyEndpoint && s.backendProxyEndpoint.includes(":" + port)) || (s.target && s.target.includes(":" + port))).pop() || (shares.length > 0 ? shares[shares.length - 1] : null);
      if (match && match.shareToken) {
        const ep = match.frontendEndpoint || ("https://" + match.shareToken + ".share.zrok.io");
        console.log(JSON.stringify({ token: match.shareToken, url: ep }));
      }
    ' "$ZROK_BIN" "$PORT" 2>/dev/null || true)
    if [ -n "$dyn_json" ]; then
      ACTIVE_SHARE_TOKEN=$(echo "$dyn_json" | node -e 'process.stdin.on("data", d => { try { console.log(JSON.parse(d).token || ""); } catch { console.log(""); } })')
      ACTIVE_SHARE_URL=$(echo "$dyn_json" | node -e 'process.stdin.on("data", d => { try { console.log(JSON.parse(d).url || ""); } catch { console.log(""); } })')
      break
    fi
  done
fi

DISPLAY_URL="${ACTIVE_SHARE_URL:-http://localhost:$PORT}"
SENDER_DISPLAY_URL="$DISPLAY_URL/sender"

echo ""
echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"
echo -e "${COLOR_GREEN} SCAN TO CONNECT ON PHONE${COLOR_RESET}"
echo -e "${COLOR_CYAN}=================================================${COLOR_RESET}"
echo -e "${COLOR_YELLOW}Public Stream URL: $DISPLAY_URL${COLOR_RESET}"
echo -e "${COLOR_CYAN}Sender URL:        $SENDER_DISPLAY_URL${COLOR_RESET}"
echo -e "${COLOR_YELLOW}Viewer on this PC: http://localhost:$PORT/viewer  (no zrok traffic)${COLOR_RESET}"
echo ""

show_terminal_qr "$SENDER_DISPLAY_URL"

echo ""
echo -e "${COLOR_YELLOW}Press Ctrl+C to terminate both zrok tunnel and server.${COLOR_RESET}"
echo ""

if [ -n "$ZROK_PID" ]; then
  wait "$ZROK_PID"
fi
