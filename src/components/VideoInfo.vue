<script setup lang="ts">
import { ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";

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
watch(
  () => props.videoPath,
  async newVal => {
    try {
      const info: VideoInfo = await invoke("get_video_info", {
        videoPath: newVal,
      });
      videoInfo.value = info;
      errMsg.value = null;
    } catch (error) {
      errMsg.value = error as string;
      console.error(error);
    }
  }
);
</script>

<template>
  <div>{{ videoPath }}</div>
  <div v-if="errMsg">{{ errMsg }}</div>
  <div v-else>{{ videoInfo }}</div>
</template>
