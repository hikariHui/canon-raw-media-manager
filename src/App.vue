<script setup lang="ts">
import { open } from "@tauri-apps/plugin-dialog";
import {
  NButton,
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NFlex,
  NLayoutHeader,
  NLayoutFooter,
} from "naive-ui";

import { rawDir, curCrmFile } from "./hooks/useRawFile";
import { proxyDir, curProxyFilePath } from "./hooks/useProxyFile";

import VideoList from "./components/VideoList.vue";
import PorxyPreview from "./components/PorxyPreview.vue";
import VideoInfo from "./components/VideoInfo.vue";
import OperationTips from "./components/OperationTips.vue";

import { undo } from "./utils/oprationHistory";

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

// 监听全局撤销快捷键
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    undo();
  }
});
</script>

<template>
  <div style="display: flex; flex-direction: column; height: 100vh">
    <NLayoutHeader bordered>
      <p>
        <NButton @click="chooseDir('rawDir')">Choose Raw Dir</NButton
        ><span>{{ rawDir }}</span>
      </p>

      <p>
        <NButton @click="chooseDir('proxyDir')">Choose Proxy Dir</NButton
        ><span>{{ proxyDir }}</span>
      </p>
    </NLayoutHeader>
    <NLayout has-sider>
      <NLayoutSider>
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
    <NLayoutFooter bordered>
      <OperationTips />
    </NLayoutFooter>
  </div>
</template>
