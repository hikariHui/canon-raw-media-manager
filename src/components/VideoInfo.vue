<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  NText,
  NSpin,
  NEmpty,
  NDescriptions,
  NDescriptionsItem,
  NTag,
} from "naive-ui";
import { updateFileDuration } from "../hooks/useRawFile";

const props = defineProps<{
  videoPath: string;
}>();

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
  codec: string;
  bit_rate: string;
  frame_rate: string;
  audio_codec: string | null;
  audio_channels: number | null;
}

const videoInfo = ref<VideoInfo | null>(null);
const errMsg = ref<string | null>(null);
const loading = ref(false);

// 格式化时长
const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
};

// 格式化比特率
const formatBitrate = (bitrate: string) => {
  const rate = parseInt(bitrate);
  if (rate > 1000000) {
    return `${(rate / 1000000).toFixed(2)} Mbps`;
  }
  return `${(rate / 1000).toFixed(2)} Kbps`;
};

// 格式化帧率
const formatFrameRate = (frameRate: string) => {
  // 如果是分数格式 (如 "60/1")
  if (frameRate.includes("/")) {
    const [numerator, denominator] = frameRate.split("/").map(Number);
    if (denominator && denominator !== 0) {
      const fps = numerator / denominator;
      return fps % 1 === 0 ? fps.toString() : fps.toFixed(2);
    }
  }
  return frameRate;
};

// 获取文件名
const fileName = computed(() => {
  if (!props.videoPath) return "";
  const parts = props.videoPath.split(/[/\\]/);
  return parts[parts.length - 1] || props.videoPath;
});

watch(
  () => props.videoPath,
  async (newVal) => {
    if (!newVal) {
      videoInfo.value = null;
      errMsg.value = null;
      return;
    }

    loading.value = true;
    try {
      const info: VideoInfo = await invoke("get_video_info", {
        videoPath: newVal,
      });
      videoInfo.value = info;
      errMsg.value = null;

      // 更新时长缓存到列表
      updateFileDuration(newVal);
    } catch (error) {
      errMsg.value = error as string;
      videoInfo.value = null;
      console.error(error);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="video-info-container">
    <NEmpty v-if="!videoPath" description="未选择文件" size="small" />

    <NSpin v-else-if="loading" size="small" class="loading-spinner">
      <template #description>加载中...</template>
    </NSpin>

    <div v-else-if="errMsg" class="error-message">
      <NText type="error">{{ errMsg }}</NText>
    </div>

    <div v-else-if="videoInfo" class="info-content">
      <NText depth="3" class="file-path" :title="videoPath">
        {{ fileName }}
      </NText>

      <NDescriptions
        :column="1"
        size="small"
        label-placement="left"
        class="info-descriptions"
      >
        <NDescriptionsItem label="分辨率">
          <NTag size="small" type="info">
            {{ videoInfo.width }} × {{ videoInfo.height }}
          </NTag>
        </NDescriptionsItem>

        <NDescriptionsItem label="时长">
          {{ formatDuration(videoInfo.duration) }}
        </NDescriptionsItem>

        <NDescriptionsItem label="视频编码">
          <NTag size="small" type="success">{{ videoInfo.codec }}</NTag>
        </NDescriptionsItem>

        <NDescriptionsItem label="比特率">
          {{ formatBitrate(videoInfo.bit_rate) }}
        </NDescriptionsItem>

        <NDescriptionsItem label="帧率">
          {{ formatFrameRate(videoInfo.frame_rate) }} fps
        </NDescriptionsItem>

        <NDescriptionsItem v-if="videoInfo.audio_codec" label="音频编码">
          <NTag size="small" type="warning">{{ videoInfo.audio_codec }}</NTag>
        </NDescriptionsItem>

        <NDescriptionsItem v-if="videoInfo.audio_channels" label="音频声道">
          {{ videoInfo.audio_channels }} 声道
        </NDescriptionsItem>
      </NDescriptions>
    </div>
  </div>
</template>

<style scoped>
.video-info-container {
  min-height: 200px;
}

.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.error-message {
  padding: 16px;
  text-align: center;
}

.info-content {
  padding: 8px 0;
}

.file-path {
  display: block;
  padding: 8px;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  font-size: 12px;
  white-space: nowrap;
  background: #f5f5f5;
  border-radius: 4px;
}

.info-descriptions {
  margin-top: 8px;
}

:deep(.n-descriptions-table-wrapper) {
  padding: 0;
}

/* stylelint-disable-next-line selector-class-pattern */
:deep(.n-descriptions .n-descriptions-table-content__label) {
  font-weight: 500;
  color: #666;
}
</style>
