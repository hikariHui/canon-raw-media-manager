<script setup lang="ts">
import { NEmpty } from "naive-ui";
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
  <NEmpty v-if="!curProxyFileUrl" description="No proxy file"></NEmpty>
  <video
    v-else
    ref="videoRef"
    :src="curProxyFileUrl"
    controls
    style="max-width: 100%"
  ></video>
</template>
