#!/usr/bin/env bash
# Dropbox 데스크톱 앱 없이 rclone(API 기반)으로 동기화하는 절차를 로컬에서 검증하는 스크립트.
#
# 사용법:
#   REMOTE=dropbox ./scripts/test-dropbox-rclone-sync.sh
#     -> 실제 Dropbox remote(사전에 `rclone config`로 "dropbox" remote를 등록해둔 경우)로 테스트
#
#   ./scripts/test-dropbox-rclone-sync.sh
#     -> REMOTE 미지정 시, rclone "local" 타입 remote를 임시로 만들어 동기화 메커니즘만 검증
#        (실제 Dropbox 네트워크 접근이 막혀 있거나 아직 remote를 등록하지 않은 환경용)
#
# 자세한 절차 설명은 docs/dropbox-rclone-sync-guide.md 참고.

set -euo pipefail

WORKDIR="$(mktemp -d)"
SOURCE_DIR="$WORKDIR/test-sync-source"
DEST_PATH="test-sync-source"
REMOTE="${REMOTE:-}"
CONFIG_FILE=""

cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

if ! command -v rclone >/dev/null 2>&1; then
  echo "rclone이 설치되어 있지 않습니다. docs/dropbox-rclone-sync-guide.md 1절 참고." >&2
  exit 1
fi

mkdir -p "$SOURCE_DIR/subfolder"
echo "hello from file1" > "$SOURCE_DIR/note1.txt"
echo "hello from file2" > "$SOURCE_DIR/note2.txt"
echo "nested file" > "$SOURCE_DIR/subfolder/note3.txt"

if [ -z "$REMOTE" ]; then
  echo "REMOTE 미지정: 임시 'local' 타입 remote(localtest)로 동기화 메커니즘만 검증합니다."
  CONFIG_FILE="$WORKDIR/rclone.conf"
  rclone config create localtest local --config "$CONFIG_FILE" >/dev/null
  REMOTE="localtest"
  DEST_PATH="$WORKDIR/test-sync-dest/$DEST_PATH"
fi

RCLONE=(rclone)
if [ -n "$CONFIG_FILE" ]; then
  RCLONE=(rclone --config "$CONFIG_FILE")
fi

echo "=== 1) dry-run ==="
"${RCLONE[@]}" sync "$SOURCE_DIR" "$REMOTE:$DEST_PATH" --dry-run -v

echo
echo "=== 2) 실제 동기화 ==="
"${RCLONE[@]}" sync "$SOURCE_DIR" "$REMOTE:$DEST_PATH" -v

echo
echo "=== 3) 체크섬/크기 검증 ==="
"${RCLONE[@]}" check "$SOURCE_DIR" "$REMOTE:$DEST_PATH"

echo
echo "=== 4) 증분 변경(수정/추가/삭제) 후 재동기화 ==="
echo "modified content" >> "$SOURCE_DIR/note1.txt"
echo "brand new file" > "$SOURCE_DIR/note4.txt"
rm "$SOURCE_DIR/note2.txt"
"${RCLONE[@]}" sync "$SOURCE_DIR" "$REMOTE:$DEST_PATH" -v

echo
echo "검증 완료."
