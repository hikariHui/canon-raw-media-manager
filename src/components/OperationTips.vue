<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { NSpace, NTag, NAlert, NIcon } from "naive-ui";
import {
  PlayOutline,
  ArrowForwardOutline,
  ArrowBackOutline,
  TrashOutline,
  StarOutline,
  WarningOutline,
} from "@vicons/ionicons5";

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
  <div class="operation-tips">
    <div v-show="isFoucsed" class="tips-content">
      <span class="tips-label">快捷键：</span>
      <NSpace :size="8">
        <NTag size="small" :bordered="false" class="tip-tag">
          <NIcon :component="PlayOutline" class="tip-icon" />
          <kbd>空格</kbd> 播放/暂停
        </NTag>
        <NTag size="small" :bordered="false" class="tip-tag">
          <NIcon :component="ArrowBackOutline" class="tip-icon" />
          <kbd>←</kbd> 后退5秒
        </NTag>
        <NTag size="small" :bordered="false" class="tip-tag">
          <NIcon :component="ArrowForwardOutline" class="tip-icon" />
          <kbd>→</kbd> 快进5秒
        </NTag>
        <NTag size="small" :bordered="false" class="tip-tag">
          <NIcon :component="TrashOutline" class="tip-icon" />
          <kbd>Backspace</kbd> 删除
        </NTag>
        <NTag size="small" :bordered="false" class="tip-tag">
          <NIcon :component="StarOutline" class="tip-icon" />
          <kbd>Enter</kbd> 星标
        </NTag>
      </NSpace>
    </div>

    <NAlert
      v-show="!isFoucsed"
      type="warning"
      size="small"
      :bordered="false"
      class="focus-alert"
    >
      <template #icon>
        <NIcon :component="WarningOutline" />
      </template>
      应用未聚焦，快捷键不可用
    </NAlert>
  </div>
</template>

<style scoped>
.operation-tips {
  display: flex;
  align-items: center;
  min-height: 40px;
}

.tips-content {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.tips-label {
  font-size: 14px;
  font-weight: 500;
  color: #666;
}

.tip-tag {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 4px 10px;
  color: #666;
  background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
}

/* stylelint-disable-next-line selector-class-pattern */
.tip-tag :deep(.n-tag__content) {
  display: flex;
  gap: 6px;
  align-items: center;
}

.tip-icon {
  font-size: 14px;
}

kbd {
  padding: 2px 6px;
  font-family: monospace;
  font-size: 11px;
  background: white;
  border: 1px solid #d0d0d0;
  border-radius: 3px;
  box-shadow: 0 1px 2px rgb(0 0 0 / 10%);
}

.focus-alert {
  width: 100%;
}

/* stylelint-disable-next-line selector-class-pattern */
:deep(.n-alert .n-alert__content) {
  font-size: 13px;
}
</style>
