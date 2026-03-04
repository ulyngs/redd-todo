#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_TRIPLE="x86_64-unknown-linux-gnu"
IMAGE_NAME="redd-do-linux-builder:latest"
DOCKERFILE_PATH="${ROOT_DIR}/scripts/docker/linux-builder.Dockerfile"

if [[ "$(uname -s)" == "Linux" ]]; then
  rustup target add "${TARGET_TRIPLE}" >/dev/null 2>&1 || true
  CI=false tauri build --target "${TARGET_TRIPLE}"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[build:linux] Docker is required on non-Linux hosts."
  echo "[build:linux] Install/start Docker Desktop, then rerun npm run build:linux."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[build:linux] Docker daemon is not running."
  echo "[build:linux] Start Docker Desktop, then rerun npm run build:linux."
  exit 1
fi

echo "[build:linux] Building Linux target in Docker..."

if [[ ! -f "${DOCKERFILE_PATH}" ]]; then
  echo "[build:linux] Missing Dockerfile: ${DOCKERFILE_PATH}"
  exit 1
fi

IMAGE_ARCH="$(docker image inspect "${IMAGE_NAME}" --format '{{.Architecture}}' 2>/dev/null || true)"
if [[ "${IMAGE_ARCH}" != "amd64" ]]; then
  if [[ -n "${IMAGE_ARCH}" ]]; then
    echo "[build:linux] Rebuilding ${IMAGE_NAME} for linux/amd64 (was ${IMAGE_ARCH})..."
  else
    echo "[build:linux] Creating local Linux builder image (${IMAGE_NAME})..."
  fi
  docker build --platform linux/amd64 -t "${IMAGE_NAME}" -f "${DOCKERFILE_PATH}" "${ROOT_DIR}"
fi

docker run --rm \
  --platform linux/amd64 \
  -e CI=false \
  -v "${ROOT_DIR}:/workspace:ro" \
  -v "${ROOT_DIR}/src-tauri/target:/out-target" \
  -w /tmp \
  "${IMAGE_NAME}" \
  bash -lc "
    set -euo pipefail
    TMP_BUILD_DIR=/tmp/redd-do-linux-build
    rm -rf \${TMP_BUILD_DIR}
    mkdir -p \${TMP_BUILD_DIR}
    cp -a /workspace/. \${TMP_BUILD_DIR}/repo
    cd \${TMP_BUILD_DIR}/repo
    rm -rf node_modules src-tauri/target src-tauri/src-tauri/target
    npm ci
    npx tauri build --target ${TARGET_TRIPLE}
    mkdir -p /out-target/${TARGET_TRIPLE}
    rm -rf /out-target/${TARGET_TRIPLE}
    cp -a src-tauri/target/${TARGET_TRIPLE} /out-target/
  "

echo "[build:linux] Docker build completed."
