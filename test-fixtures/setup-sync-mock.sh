#!/usr/bin/env bash
# 生成「同步到备份盘」功能用的源目录 / 备份目录
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/sync-mock"

rm -rf "$ROOT"
mkdir -p \
  "$ROOT/source/A001" \
  "$ROOT/source/A002" \
  "$ROOT/source/deleted" \
  "$ROOT/source/starred" \
  "$ROOT/source/proxy" \
  "$ROOT/backup1/A001" \
  "$ROOT/backup1/A002/old_loc" \
  "$ROOT/backup1/extra" \
  "$ROOT/backup2/A001"

# ── 源目录 ──
# 已在 backup1/backup2 同路径同大小 → 应跳过
printf 'skip-same-content-v1' > "$ROOT/source/A001/CLIP_001.CRM"
# 同路径但内容不同 → 应复制（旧文件进 trash）
printf 'source-updated-v2!!!!' > "$ROOT/source/A001/CLIP_002.CRM"
# 仅源有 → 应复制
printf 'brand-new-clip-003' > "$ROOT/source/A001/CLIP_003.CRM"
# 源在 A002，backup1 在 old_loc 同名同大小 → 应 B 内移动
printf 'moved-same-size-xx' > "$ROOT/source/A002/CLIP_004.CRM"
# 筛完后放进 deleted / starred
printf 'deleted-clip-keep' > "$ROOT/source/deleted/CLIP_005.CRM"
printf 'starred-clip-keep' > "$ROOT/source/starred/CLIP_006.CRM"
printf 'proxy-mp4-bytes!!' > "$ROOT/source/proxy/CLIP_001.MP4"

# ── backup1：模拟旧备份（覆盖跳过 / 移动 / trash）──
printf 'skip-same-content-v1' > "$ROOT/backup1/A001/CLIP_001.CRM"
printf 'backup-old-content!!' > "$ROOT/backup1/A001/CLIP_002.CRM"
printf 'moved-same-size-xx' > "$ROOT/backup1/A002/old_loc/CLIP_004.CRM"
printf 'only-on-backup!!!!' > "$ROOT/backup1/extra/ORPHAN.CRM"
printf 'stale-gone!!!!!!!!!' > "$ROOT/backup1/A001/CLIP_GONE.CRM"

# ── backup2：几乎空，主要测复制 ──
printf 'skip-same-content-v1' > "$ROOT/backup2/A001/CLIP_001.CRM"

SOURCE="$(cd "$ROOT/source" && pwd)"
BACKUP1="$(cd "$ROOT/backup1" && pwd)"
BACKUP2="$(cd "$ROOT/backup2" && pwd)"

{
  echo "同步到备份盘测试目录"
  echo ""
  echo "源目录:"
  echo "  ${SOURCE}"
  echo ""
  echo "备份目标:"
  echo "  ${BACKUP1}"
  echo "  ${BACKUP2}"
  echo ""
  echo "预期（源 → backup1）:"
  echo "  - 跳过: A001/CLIP_001.CRM"
  echo "  - 移动: A002/old_loc/CLIP_004.CRM → A002/CLIP_004.CRM"
  echo "  - 复制: CLIP_002(更新), CLIP_003, deleted/, starred/, proxy/"
  echo "  - 回收站: CLIP_002 旧版, CLIP_GONE, extra/ORPHAN"
  echo ""
  echo "预期（源 → backup2）:"
  echo "  - 跳过: A001/CLIP_001.CRM"
  echo "  - 其余从源复制"
  echo ""
  echo "重新生成: bash test-fixtures/setup-sync-mock.sh"
} > "$ROOT/README.txt"

echo "已生成: $ROOT"
echo "源:     $SOURCE"
echo "备份1:  $BACKUP1"
echo "备份2:  $BACKUP2"
