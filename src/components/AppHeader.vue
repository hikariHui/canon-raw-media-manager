<script setup lang="ts">
import { h } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { NButton, NLayoutHeader, NIcon, NText, NSpace } from "naive-ui";
import { FolderOpenOutline } from "@vicons/ionicons5";

import { rawDir } from "../hooks/useRawFile";
import { proxyDir } from "../hooks/useProxyFile";

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
  <NLayoutHeader bordered class="header">
    <div class="header-content">
      <h2 class="app-title">Canon 媒体管理器</h2>
      <NSpace vertical :size="12">
        <div class="dir-selector">
          <NButton
            type="primary"
            @click="chooseDir('rawDir')"
            :icon="
              () => h(NIcon, null, { default: () => h(FolderOpenOutline) })
            "
          >
            选择 Raw 目录
          </NButton>
          <NText depth="3" class="dir-path">
            {{ rawDir || "未选择" }}
          </NText>
        </div>

        <div class="dir-selector">
          <NButton
            type="primary"
            @click="chooseDir('proxyDir')"
            :icon="
              () => h(NIcon, null, { default: () => h(FolderOpenOutline) })
            "
          >
            选择 Proxy 目录
          </NButton>
          <NText depth="3" class="dir-path">
            {{ proxyDir || "未选择" }}
          </NText>
        </div>
      </NSpace>
    </div>
  </NLayoutHeader>
</template>

<style scoped>
.header {
  padding: 16px 24px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
}

.header-content {
  max-width: 1400px;
  margin: 0 auto;
}

.app-title {
  margin: 0 0 16px;
  font-size: 24px;
  font-weight: 600;
  color: white;
}

.dir-selector {
  display: flex;
  gap: 12px;
  align-items: center;
}

.dir-selector :deep(.n-button) {
  min-width: 150px;
}

.dir-path {
  flex: 1;
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  font-size: 13px;
  color: rgb(255 255 255 / 90%);
  white-space: nowrap;
}
</style>
