<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { NRadioGroup, NRadio } from "naive-ui";
import { filesList } from "../hooks/useRawFile";
import { curCrmFile } from "../hooks/useRawFile";
import { deleteVideo } from "../hooks/useDeleteVideo";

/** 当前选中的文件索引 */
const curIndex = ref(-1);
// 监听当前选中的文件索引
watch(curIndex, (newVal) => {
  curCrmFile.value = filesList.value[newVal] ?? "";
});

// 监听文件列表变化
watch(filesList, (newVal) => {
  // 如果文件列表为空，则设置当前选中的文件索引为 -1
  if (!newVal.length) {
    curIndex.value = -1;
    return;
  }
  // 如果当前选中的文件在文件列表中，则设置当前选中的文件索引为文件列表中的索引
  const newIndex = filesList.value.indexOf(curCrmFile.value);
  if (newIndex !== -1) {
    curIndex.value = newIndex;
    return;
  }
  // 如果当前选中的文件索引小于文件列表长度，则设置当前选中的文件为文件列表中的文件
  if (curIndex.value < newVal.length) {
    curCrmFile.value = filesList.value[curIndex.value] ?? "";
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
});
</script>

<template>
  <NRadioGroup :value="curIndex" @update:value="(val) => (curIndex = val)">
    <NRadio v-for="(file, index) in filesList" :key="index" :value="index">{{
      file
    }}</NRadio>
  </NRadioGroup>
</template>
