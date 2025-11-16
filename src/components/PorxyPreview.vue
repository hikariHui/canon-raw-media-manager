<script setup lang="ts">
import { NEmpty } from "naive-ui";
import { curProxyFileUrl } from "../hooks/useProxyFile";
import { onMounted, ref } from "vue";

const videoRef = ref<HTMLVideoElement | null>(null);

onMounted(() => {
  // 监听空格键播放/暂停视频
  window.addEventListener("keydown", event => {
    if (event.key === " ") {
      event.preventDefault();
      if (videoRef.value) {
        if (videoRef.value.paused) {
          videoRef.value.play();
        } else {
          videoRef.value.pause();
        }
      }
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
