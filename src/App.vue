<script setup lang="ts">
import { NLayoutFooter } from "naive-ui";

import AppHeader from "./components/AppHeader.vue";
import MainWorkspace from "./components/MainWorkspace.vue";
import OperationTips from "./components/OperationTips.vue";

import { undo } from "./utils/oprationHistory";

// 监听全局撤销快捷键
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    undo();
  }
});
</script>

<template>
  <div class="app-container">
    <AppHeader />

    <MainWorkspace />

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

.footer {
  padding: 12px 24px;
  background: white;
  box-shadow: 0 -2px 8px rgb(0 0 0 / 6%);
}
</style>
