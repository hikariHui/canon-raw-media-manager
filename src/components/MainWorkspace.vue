<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from "vue";
import { NLayout, NLayoutSider, NLayoutContent, NCard } from "naive-ui";
import VideoList from "./VideoList.vue";
import PorxyPreview from "./PorxyPreview.vue";
import VideoInfo from "./VideoInfo.vue";
import { curCrmFile } from "../hooks/useRawFile";
import { curProxyFilePath } from "../hooks/useProxyFile";

/** 内容区域引用 */
const contentRef = useTemplateRef("contentRef");

// 监听视频切换，自动滚回顶部
watch(curCrmFile, () => {
  nextTick(() => {
    if (contentRef.value) {
      contentRef.value.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    }
  });
});
</script>

<template>
  <NLayout has-sider class="main-workspace">
    <NLayoutSider
      bordered
      :width="280"
      :native-scrollbar="false"
      class="sidebar"
    >
      <VideoList />
    </NLayoutSider>

    <NLayout ref="contentRef">
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
</template>

<style scoped>
.main-workspace {
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

@media (width <= 1200px) {
  .info-section {
    grid-template-columns: 1fr;
  }
}
</style>
