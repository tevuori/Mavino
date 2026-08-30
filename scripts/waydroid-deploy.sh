#!/usr/bin/env bash
# Build the Mavino Android APK, install it into Waydroid, and launch it.
#
# Usage:
#   ./scripts/waydroid-deploy.sh          # build + install + launch
#   ./scripts/waydroid-deploy.sh --skip-build  # install + launch only (reuse existing APK)
#
# Requirements:
#   - Waydroid container service running:  sudo systemctl start waydroid-container
#   - Waydroid session running:            waydroid session start &
#   - JDK 21 at ~/.local/share/jvm/jdk-21.0.12+8 (Gradle 8.x doesn't support Java 25)
#   - Mavino server running on the host:   bun run dev:server
#
# Inside Waydroid, the host is reachable at 192.168.240.1 (the waydroid0 bridge).
# Enter http://192.168.240.1:3001 as the server address on the Mavino login screen.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APK="$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
PACKAGE="stud.mavino.net"

# JDK 21 (Fedora 44 only ships Java 25, which Gradle 8.x can't run on)
JDK21="$HOME/.local/share/jvm/jdk-21.0.12+8"
if [ ! -d "$JDK21" ]; then
  echo "ERROR: JDK 21 not found at $JDK21"
  echo "Install it with:"
  echo "  mkdir -p ~/.local/share/jvm"
  echo "  curl -sL 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse?project=jdk' -o /tmp/jdk21.tar.gz"
  echo "  tar -xzf /tmp/jdk21.tar.gz -C ~/.local/share/jvm"
  exit 1
fi
export JAVA_HOME="$JDK21"
export PATH="$JAVA_HOME/bin:$PATH"

# Check Waydroid is running
if ! waydroid status 2>&1 | grep -q "Session:.*RUNNING"; then
  echo "Waydroid session is not running. Starting it..."
  waydroid session start &
  sleep 5
fi

SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

if [ "$SKIP_BUILD" = false ]; then
  echo "==> Syncing web assets (cap sync)..."
  cd "$ROOT_DIR"
  bun run cap:sync

  echo "==> Building debug APK..."
  cd "$ROOT_DIR/android"
  ./gradlew assembleDebug
fi

if [ ! -f "$APK" ]; then
  echo "ERROR: APK not found at $APK"
  echo "Run without --skip-build to build it first."
  exit 1
fi

echo "==> Installing APK into Waydroid..."
waydroid app install "$APK"

echo "==> Launching Mavino..."
waydroid app launch "$PACKAGE"

echo ""
echo "Done! Mavino is launching in Waydroid."
echo ""
echo "On the login screen, enter this as the server address:"
echo "  http://192.168.240.1:3001"
echo ""
echo "Make sure the Mavino server is running on the host:"
echo "  bun run dev:server"
