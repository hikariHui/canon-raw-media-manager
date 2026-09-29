/// <reference types="vite/client" />

declare module "animal-island-ui/style";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
