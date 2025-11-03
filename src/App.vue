<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { NButton, NLayout, NLayoutSider, NLayoutContent, NRadioGroup, NRadio } from "naive-ui";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from '@tauri-apps/api/core';

const rawDir = ref("");
const chooseRawDir = async () => {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  console.log(selected);
  if (selected) {
    rawDir.value = selected;
  }
};

const originFilesList = ref<string[]>([]);
let readDirectoryFilesTimer: number | null = null;
const readDirectoryFiles = async () => {
  if (readDirectoryFilesTimer) {
    clearTimeout(readDirectoryFilesTimer);
  }
  readDirectoryFilesTimer = setTimeout(async () => {
    const files: string[] = await invoke("read_directory_files", {
      dirPath: rawDir.value,
    });
    originFilesList.value = files;
  }, 300);
};

/** 监听目录变化 */
const watchDirectory = async (newVal: string, oldVal: string) => {
  try {
    if (oldVal) {
      await invoke("unwatch_directory", { dirPath: oldVal });
    }
  } catch (error) {
    console.error(error);
  }
  const result = await invoke("watch_directory", { dirPath: newVal });
  console.log(result);
};

watch(rawDir, (newVal, oldVal) => {
  readDirectoryFiles();
  watchDirectory(newVal, oldVal);
});

const proxyDir = ref("");
const chooseProxyDir = async () => {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  console.log(selected);
  if (selected) {
    proxyDir.value = selected;
  }
};

// 监听文件变更事件
onMounted(async () => {
  await listen(
    "file-change",
    (event: {
      event: string;
      payload: { kind: string; dir_path: string; paths: string[] };
      id: number;
    }) => {
      if (event.payload.dir_path !== rawDir.value) {
        return;
      }
      // 重新读取目录文件
      readDirectoryFiles();
    }
  );
});

const curCrmFile = ref("");
const crmFilesList = computed(() => {
  return originFilesList.value.filter((file) => file.toLowerCase().endsWith(".crm"));
});

const curProxyFileUrl = ref("");
watch(curCrmFile, async (crmPath) => {
  if (crmPath) {
    const crmFileName = crmPath.split(/[\\/]/).pop();
    const crmName = crmFileName?.split(".").shift();
    const proxyPath = (proxyDir.value ? proxyDir.value.replace(/[\\/]$/, "") + "/" : "") + crmName + "_proxy.mp4";
    const isExists = await invoke("is_file_exists", { filePath: proxyPath });
    if (isExists) {
      curProxyFileUrl.value = convertFileSrc(proxyPath);
      console.log("file exists");
    } else {
      curProxyFileUrl.value = "";
      console.log("file not exists");
    }
  }
});
</script>

<template>
  <NLayout has-sider>
    <NLayoutSider>
      <NButton @click="chooseRawDir">Choose Raw Dir</NButton>
      <p>{{ rawDir }}</p>
      <NButton @click="chooseProxyDir">Choose Proxy Dir</NButton>
      <p>{{ proxyDir }}</p>
      <NRadioGroup :value="curCrmFile" @update:value="(val) => curCrmFile = val">
        <NRadio v-for="file in crmFilesList" :key="file" :value="file">{{ file }}</NRadio>
      </NRadioGroup>
    </NLayoutSider>
    <NLayout>
      <NLayoutContent>
        <video :src="curProxyFileUrl" controls style="max-width: 100%;"></video>
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>
