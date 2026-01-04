<script setup lang="ts">
import { NEmpty, NIcon } from "naive-ui";
import { VideocamOffOutline } from "@vicons/ionicons5";
import { curProxyFileUrl } from "../hooks/useProxyFile";
import { nextTick, onMounted, ref, watch } from "vue";

const videoRef = ref<HTMLVideoElement | null>(null);

/** 是否正在播放 */
const isPlaying = ref(false);

onMounted(() => {
  window.addEventListener("keydown", (event) => {
    // 监听空格键播放/暂停视频
    if (event.key === " ") {
      event.preventDefault();
      if (videoRef.value) {
        if (videoRef.value.paused) {
          videoRef.value.play();
          isPlaying.value = true;
        } else {
          videoRef.value.pause();
          isPlaying.value = false;
        }
      }
    }
    // 左右箭头快进/后退5秒
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (videoRef.value) {
        videoRef.value.currentTime += 5;
      }
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (videoRef.value) {
        videoRef.value.currentTime -= 5;
      }
    }
  });
});

watch(curProxyFileUrl, () => {
  // 视频切换后如果是播放状态则继续自动播放
  nextTick(() => {
    if (isPlaying.value && videoRef.value) {
      videoRef.value.play();
    }
  });
});
</script>

<template>
  <div class="preview-container">
    <NEmpty
      v-if="!curProxyFileUrl"
      description="暂无预览文件"
      class="empty-preview"
    >
      <template #icon>
        <NIcon size="64" :component="VideocamOffOutline" color="#d0d0d0" />
      </template>
    </NEmpty>

    <div v-else class="video-wrapper">
      <video
        ref="videoRef"
        :src="curProxyFileUrl"
        controls
        class="video-player"
      ></video>
    </div>
  </div>
</template>

<style scoped>
.preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  overflow: hidden;
  background: #000;
  border-radius: 4px;
}

.empty-preview {
  width: 100%;
  padding: 60px 20px;
  background: #1a1a1a;
}

/* stylelint-disable-next-line selector-class-pattern */
:deep(.n-empty .n-empty__description) {
  color: #999;
}

.video-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  background: #000;
}

.video-player {
  display: block;
  width: 100%;
  max-height: 70vh;
  outline: none;
}

.video-player:focus {
  outline: none;
}

/* 自定义视频控制栏样式 */
.video-player::-webkit-media-controls-panel {
  background: linear-gradient(transparent, rgb(0 0 0 / 80%));
}

.video-player::-webkit-media-controls-play-button {
  background-color: rgb(255 255 255 / 90%);
  border-radius: 50%;
}

.video-player::-webkit-media-controls-current-time-display,
.video-player::-webkit-media-controls-time-remaining-display {
  color: white;
}
</style>
