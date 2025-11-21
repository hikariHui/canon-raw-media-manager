<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const isFoucsed = ref(false);

const onFocus = () => {
  isFoucsed.value = true;
};

const onBlur = () => {
  isFoucsed.value = false;
};

onMounted(() => {
  isFoucsed.value = document.hasFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
});

onUnmounted(() => {
  window.removeEventListener("focus", onFocus);
  window.removeEventListener("blur", onBlur);
});
</script>

<template>
  <div v-show="isFoucsed">
    空格键：播放；左右箭头：快进/后退5秒；退格键：删除
  </div>
  <div v-show="!isFoucsed">应用未聚焦，快捷键不可用</div>
</template>
