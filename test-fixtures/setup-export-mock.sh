#!/usr/bin/env bash
# 生成导出功能用的模拟存储卡 / 导出盘目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/export-mock"
DATE="$(date +%Y.%m.%d)"

rm -rf "$ROOT"
mkdir -p \
  "$ROOT/cards/R52_card1/DCIM/100EOSR5" \
  "$ROOT/cards/R52_card1/CRM/REEL_0001" \
  "$ROOT/cards/R52_card1/XFVC/REEL_0001" \
  "$ROOT/cards/R52_card1/MISC" \
  "$ROOT/cards/R52_card1/XMLTAG" \
  "$ROOT/cards/R62_card2/DCIM/100EOSR6" \
  "$ROOT/exports/disk_a" \
  "$ROOT/exports/disk_b"

# R5II
printf 'CR3-PHOTO-001' > "$ROOT/cards/R52_card1/DCIM/100EOSR5/IMG_0001.CR3"
printf 'JPG-PHOTO-001' > "$ROOT/cards/R52_card1/DCIM/100EOSR5/IMG_0001.JPG"
printf 'CR3-PHOTO-002' > "$ROOT/cards/R52_card1/DCIM/100EOSR5/IMG_0002.CR3"
dd if=/dev/urandom of="$ROOT/cards/R52_card1/CRM/REEL_0001/A001C001_240911_R5II.CRM" bs=1024 count=256 status=none
dd if=/dev/urandom of="$ROOT/cards/R52_card1/CRM/REEL_0001/A001C002_240911_R5II.CRM" bs=1024 count=128 status=none
dd if=/dev/urandom of="$ROOT/cards/R52_card1/XFVC/REEL_0001/A001C001_240911_R5II.MP4" bs=1024 count=64 status=none
dd if=/dev/urandom of="$ROOT/cards/R52_card1/XFVC/REEL_0001/A001C002_240911_R5II.MP4" bs=1024 count=32 status=none
printf '<xml>news-meta</xml>' > "$ROOT/cards/R52_card1/CRM/REEL_0001/A001C001_240911_R5II.XML"
printf 'misc-config' > "$ROOT/cards/R52_card1/MISC/Canon0001.CTG"
printf '<tag/>' > "$ROOT/cards/R52_card1/XMLTAG/NEWS0001.XML"

# R6II
printf 'CR3-R6-001' > "$ROOT/cards/R62_card2/DCIM/100EOSR6/IMG_0101.CR3"
printf 'JPG-R6-001' > "$ROOT/cards/R62_card2/DCIM/100EOSR6/IMG_0101.JPG"
dd if=/dev/urandom of="$ROOT/cards/R62_card2/DCIM/100EOSR6/MVI_0101.MP4" bs=1024 count=96 status=none
dd if=/dev/urandom of="$ROOT/cards/R62_card2/DCIM/100EOSR6/MVI_0102.MP4" bs=1024 count=48 status=none

# disk_a: interrupted conflict stub
mkdir -p "$ROOT/exports/disk_a/${DATE}/CRM/REEL_0001"
printf 'PARTIAL-INTERRUPTED' > "$ROOT/exports/disk_a/${DATE}/CRM/REEL_0001/A001C001_240911_R5II.CRM"

# disk_b: identical file (preserve mtime)
mkdir -p "$ROOT/exports/disk_b/${DATE}/DCIM/100EOSR6"
cp -p "$ROOT/cards/R62_card2/DCIM/100EOSR6/IMG_0101.JPG" \
  "$ROOT/exports/disk_b/${DATE}/DCIM/100EOSR6/IMG_0101.JPG"

CARD1="$(cd "$ROOT/cards/R52_card1" && pwd)"
CARD2="$(cd "$ROOT/cards/R62_card2" && pwd)"
DISKA="$(cd "$ROOT/exports/disk_a" && pwd)"
DISKB="$(cd "$ROOT/exports/disk_b" && pwd)"

{
  echo "模拟导出测试目录（日期文件夹预埋为 ${DATE}）"
  echo ""
  echo "存储卡路径:"
  echo "  ${CARD1}"
  echo "  ${CARD2}"
  echo ""
  echo "导出路径:"
  echo "  ${DISKA}"
  echo "  ${DISKB}"
  echo ""
  echo "测试点:"
  echo "  - R52: DCIM + CRM + XFVC; XML/MISC/XMLTAG 不应被导出"
  echo "  - R62: DCIM 内 CR3/JPG/MP4"
  echo "  - disk_a: CRM 半文件 -> 冲突确认"
  echo "  - disk_b: JPG 一致 -> identical 跳过"
  echo "  - 两卡并行、两盘多备份"
  echo ""
  echo "重新生成: bash test-fixtures/setup-export-mock.sh"
} > "$ROOT/README.txt"

echo "已生成: $ROOT"
echo "卡1: $CARD1"
echo "卡2: $CARD2"
echo "盘A: $DISKA"
echo "盘B: $DISKB"
