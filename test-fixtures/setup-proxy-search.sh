#!/usr/bin/env bash
# 生成「自动搜索 Proxy 目录」用的模拟素材结构
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/proxy-search"

rm -rf "$ROOT"

# 场景 A：带自定义日期目录名（搜索应停在日期层内）
DATE_DIR="$ROOT/2026.09.01 开学"
mkdir -p \
  "$DATE_DIR/CRM/REEL_0001" \
  "$DATE_DIR/XFVC/REEL_0002" \
  "$DATE_DIR/XFVC/REEL_0003" \
  "$DATE_DIR/DCIM"

# raw：CRM/REEL_0001（含 .CRM 与 .mp4 源）
printf 'raw-crm-a001' > "$DATE_DIR/CRM/REEL_0001/A001.CRM"
printf 'raw-mp4-a002' > "$DATE_DIR/CRM/REEL_0001/A002.mp4"
printf 'raw-crm-b001' > "$DATE_DIR/CRM/REEL_0001/B001.CRM"

# proxy：不同 REEL 编号（REEL_0002），大小写混用验证不敏感匹配
printf 'proxy-a001' > "$DATE_DIR/XFVC/REEL_0002/A001_proxy.mp4"
printf 'proxy-a002' > "$DATE_DIR/XFVC/REEL_0002/A002_Proxy.MP4"
printf 'proxy-b001' > "$DATE_DIR/XFVC/REEL_0002/b001_proxy.mp4"

# 干扰项：另一 REEL，只有无关文件，不应被选中
printf 'proxy-noise' > "$DATE_DIR/XFVC/REEL_0003/C999_proxy.mp4"

# 日期目录外的噪声（不应越界搜到）
mkdir -p "$ROOT/XFVC/REEL_9999"
printf 'outside-noise' > "$ROOT/XFVC/REEL_9999/A001_proxy.mp4"

# 场景 B：无日期文件夹的卡根（向上 2 层停在卡根）
CARD="$ROOT/card-root"
mkdir -p "$CARD/CRM/REEL_0001" "$CARD/XFVC/REEL_0002"
printf 'card-raw' > "$CARD/CRM/REEL_0001/MVI_0101.CRM"
printf 'card-proxy' > "$CARD/XFVC/REEL_0002/MVI_0101_proxy.mp4"

RAW_A="$(cd "$DATE_DIR/CRM/REEL_0001" && pwd)"
PROXY_A="$(cd "$DATE_DIR/XFVC/REEL_0002" && pwd)"
RAW_B="$(cd "$CARD/CRM/REEL_0001" && pwd)"
PROXY_B="$(cd "$CARD/XFVC/REEL_0002" && pwd)"

{
  echo "自动搜索 Proxy 目录 — 测试夹具"
  echo ""
  echo "场景 A（日期目录「2026.09.01 开学」）"
  echo "  选择 Raw:   ${RAW_A}"
  echo "  期望 Proxy: ${PROXY_A}"
  echo "  说明: REEL_0001 → REEL_0002；含 .CRM / .mp4 源；大小写混用"
  echo ""
  echo "场景 B（无日期，卡根）"
  echo "  选择 Raw:   ${RAW_B}"
  echo "  期望 Proxy: ${PROXY_B}"
  echo ""
  echo "重新生成: bash test-fixtures/setup-proxy-search.sh"
} > "$ROOT/README.txt"

echo "已生成: $ROOT"
echo ""
echo "场景 A Raw:   $RAW_A"
echo "场景 A Proxy: $PROXY_A"
echo ""
echo "场景 B Raw:   $RAW_B"
echo "场景 B Proxy: $PROXY_B"
