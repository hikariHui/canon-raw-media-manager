<script setup lang="ts">
import { h } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import {
  NButton,
  NLayout,
  NLayoutSider,
  NLayoutContent,
  NLayoutHeader,
  NLayoutFooter,
  NIcon,
  NText,
  NSpace,
  NCard,
} from "naive-ui";
import { FolderOpenOutline } from "@vicons/ionicons5";

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
  <div class="app-container">
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

    <NLayout has-sider class="main-layout">
      <NLayoutSider
        bordered
        :width="280"
        :native-scrollbar="false"
        class="sidebar"
      >
        <VideoList />
      </NLayoutSider>

      <NLayout>
        <NLayoutContent class="content">
          <div class="preview-section">
            <PorxyPreview />
          </div>

          <div class="info-section">
            <NCard title="Raw 文件信息" size="small" class="info-card">
              <VideoInfo :video-path="curCrmFile" />
            </NCard>
            <NCard title="Proxy 文件信息" size="small" class="info-card">
              <VideoInfo :video-path="curProxyFilePath" />
            </NCard>
          </div>
        </NLayoutContent>
      </NLayout>
    </NLayout>

    <NLayoutFooter bordered class="footer">
      <OperationTips />
    </NLayoutFooter>
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

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

.main-layout {
  flex: 1;
  overflow: hidden;
}

.sidebar {
  background: white;
  box-shadow: 2px 0 8px rgb(0 0 0 / 6%);
}

.sidebar :deep(.n-scrollbar-content) {
  height: 100%;
}

.content {
  padding: 20px;
  overflow-y: auto;
  background: #f5f5f5;
}

.preview-section {
  padding: 16px;
  margin-bottom: 20px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

.info-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.info-card {
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
}

.footer {
  padding: 12px 24px;
  background: white;
  box-shadow: 0 -2px 8px rgb(0 0 0 / 6%);
}

@media (width <= 1200px) {
  .info-section {
    grid-template-columns: 1fr;
  }
}
</style>
