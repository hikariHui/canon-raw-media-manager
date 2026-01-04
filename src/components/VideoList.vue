<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import {
  NRadioGroup,
  NRadio,
  NEmpty,
  NText,
  NIcon,
  NBadge,
  NSpin,
} from "naive-ui";
import { VideocamOutline } from "@vicons/ionicons5";
import { filesList } from "../hooks/useRawFile";
import { curCrmFile } from "../hooks/useRawFile";
import { deleteVideo, starVideo } from "../hooks/useMoveVideo";

/** 当前选中的文件索引 */
const curIndex = ref(-1);

// 提取文件名
const getFileName = (path: string) => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

// 格式化时长
const formatDuration = (seconds?: number): string => {
  if (seconds === undefined) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

// 监听当前选中的文件索引
watch(curIndex, (newVal) => {
  const file = filesList.value[newVal];
  curCrmFile.value = file?.path ?? "";
});

// 监听文件列表变化
watch(filesList, (newVal) => {
  // 如果文件列表为空，则设置当前选中的文件索引为 -1
  if (!newVal.length) {
    curIndex.value = -1;
    return;
  }
  // 如果当前选中的文件在文件列表中，则设置当前选中的文件索引为文件列表中的索引
  const newIndex = filesList.value.findIndex(
    (file) => file.path === curCrmFile.value,
  );
  if (newIndex !== -1) {
    curIndex.value = newIndex;
    return;
  }
  // 如果当前选中的文件索引小于文件列表长度，则设置当前选中的文件为文件列表中的文件
  if (curIndex.value < newVal.length) {
    curCrmFile.value = filesList.value[curIndex.value]?.path ?? "";
    return;
  }
  // 如果当前选中的文件索引大于文件列表长度，则设置当前选中的文件索引为最后一个
  curIndex.value = newVal.length - 1;
});

onMounted(() => {
  // 监听方向键上下移动
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp") {
      curIndex.value = Math.max(curIndex.value - 1, 0);
    } else if (event.key === "ArrowDown") {
      curIndex.value = Math.min(curIndex.value + 1, filesList.value.length - 1);
    }
  });
  // 监听删除键/退格键
  window.addEventListener("keydown", async (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!curCrmFile.value) {
        return;
      }
      await deleteVideo(curCrmFile.value);
    }
  });
  // 监听回车键
  window.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      if (!curCrmFile.value) {
        return;
      }
      await starVideo(curCrmFile.value);
    }
  });
});
</script>

<template>
  <div class="video-list-container">
    <div class="list-header">
      <h3 class="list-title">
        <NIcon size="18" :component="VideocamOutline" />
        视频列表
      </h3>
      <NBadge :value="filesList.length" :max="999" type="info" />
    </div>

    <NEmpty
      v-if="!filesList.length"
      description="暂无视频文件"
      class="empty-state"
    />

    <NRadioGroup
      v-else
      :value="curIndex"
      @update:value="(val) => (curIndex = val)"
      class="radio-group"
    >
      <div
        v-for="(file, index) in filesList"
        :key="file.path"
        class="radio-item"
        :class="{ active: curIndex === index }"
      >
        <NRadio :value="index" class="radio-control">
          <div class="file-info">
            <div class="file-header">
              <NText class="file-name">{{ getFileName(file.path) }}</NText>
              <div class="file-meta">
                <NSpin v-if="file.loading" :size="14" />
                <NText
                  v-else-if="file.duration"
                  depth="3"
                  class="file-duration"
                >
                  {{ formatDuration(file.duration) }}
                </NText>
              </div>
            </div>
            <NText depth="3" class="file-index">#{{ index + 1 }}</NText>
          </div>
        </NRadio>
      </div>
    </NRadioGroup>
  </div>
</template>

<style scoped>
.video-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-x: hidden;
}

.list-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  background: #fafafa;
  border-bottom: 1px solid #f0f0f0;
}

.list-title {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}

.empty-state {
  margin-top: 60px;
}

.radio-group {
  flex-grow: 1;
  height: 0;
  padding: 8px;
  overflow: hidden auto;
}

.radio-item {
  padding: 2px;
  margin-bottom: 4px;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.radio-item:hover {
  background: #f5f5f5;
}

.radio-item.active {
  background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
}

.radio-control {
  width: 100%;
  padding: 8px 12px;
}

.file-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.file-header {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
  width: 100%;
}

.file-name {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  overflow-wrap: break-word;
}

.file-meta {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  min-width: 50px;
  margin-right: 4px;
}

.file-duration {
  font-family: monospace;
  font-size: 11px;
  font-weight: 500;
  color: #667eea;
}

.file-index {
  font-size: 11px;
}

/* 自定义滚动条 */
.radio-group::-webkit-scrollbar {
  width: 6px;
}

.radio-group::-webkit-scrollbar-track {
  background: transparent;
}

.radio-group::-webkit-scrollbar-thumb {
  background: #d0d0d0;
  border-radius: 3px;
}

.radio-group::-webkit-scrollbar-thumb:hover {
  background: #b0b0b0;
}
</style>
