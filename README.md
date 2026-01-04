# 佳能 raw 视频管理工具

基于拍摄时录制 raw（4通道音频）+ proxy（2通道音频）情况下，素材文件管理麻烦这样小众而又蛋疼的场景而开发的管理工具。

## 功能

- 自动映射 raw 和 proxy，同步删除文件
- 同步添加星标（移动到 starred 文件夹）

## 开发说明

### 环境依赖

- Node.js@22
- pnpm@10
- rust

### 依赖安装

```bash
pnpm i
```

### 启动开发环境

```bash
pnpm tauri dev
```

### 构建

```bash
pnpm tauri build
```
