<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import { NButton, NLayout, NLayoutSider, NLayoutContent, NFlex } from "naive-ui";

import { rawDir, curCrmFile } from "./hooks/useRawFile";
import { proxyDir, curProxyFilePath } from "./hooks/useProxyFile";

import VideoList from "./components/VideoList.vue";
import PorxyPreview from "./components/PorxyPreview.vue";
import VideoInfo from "./components/VideoInfo.vue";

const dirValMap = {
  rawDir,
  proxyDir,
};

/** 选择文件目录 */
const chooseDir = async (targetValue: "rawDir" | "proxyDir") => {
  const selected = await open({
    multiple: false,
    directory: true,
  });
  console.log(selected);
  if (selected) {
    dirValMap[targetValue].value = selected;
  }
};
</script>

<template>
  <NLayout style="max-height: 100vh;" position="absolute" has-sider>
    <NLayoutSider>
      <NButton @click="chooseDir('rawDir')">Choose Raw Dir</NButton>
      <p>{{ rawDir }}</p>
      <NButton @click="chooseDir('proxyDir')">Choose Proxy Dir</NButton>
      <p>{{ proxyDir }}</p>
      <VideoList />
    </NLayoutSider>
    <NLayout>
      <NLayoutContent>
        <PorxyPreview />
        <NFlex>
          <VideoInfo :video-path="curCrmFile" />
          <VideoInfo :video-path="curProxyFilePath" />
        </NFlex>
      </NLayoutContent>
    </NLayout>
  </NLayout>
</template>
