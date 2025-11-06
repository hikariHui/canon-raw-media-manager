<script setup lang="ts">
import { NEmpty } from "naive-ui";
import { curProxyFileUrl } from "../hooks/useProxyFile";
</script>

<template>
  <NEmpty v-if="!curProxyFileUrl" description="No proxy file"></NEmpty>
  <video v-else :src="curProxyFileUrl" controls style="max-width: 100%"></video>
</template>
