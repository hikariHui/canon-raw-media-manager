# 佳能 raw 视频管理工具

基于使用佳能 R5M2 拍摄 Raw 的情况下，素材文件管理麻烦这样小众而又蛋疼的场景而开发的管理工具。

## 功能

- **Raw / Proxy 联动**：按文件名自动映射，删除与星标会同步处理 Raw、Proxy 及对应 `.cpf`
- **自动定位 Proxy**：选定 Raw 目录后，在允许管理的根目录内自动搜索匹配的 Proxy 目录
- **Proxy 预览**：内置播放器，支持空格播放/暂停、←/→ 快进后退
- **素材管理**：Backspace 删除（移入 deleted）、Enter 星标（移入 starred），`Cmd/Ctrl+Z` 撤销
- **文件列表**：键盘上下切换素材，展示时长；目录变更实时刷新
- **视频信息**：分辨率、编码、帧率、码率、音频声道、文件大小与修改时间等
- **允许目录**：设置中配置可管理的根路径，防止多备份盘选错目录
- **存储卡导出**：从相机卡（DCIM / CRM / XFVC）批量导出到本地，支持多卡并行、冲突检测与进度显示
- **应用更新**：启动时检查新版本，可一键下载安装并重启

## 安装与打开

从 [Releases](https://github.com/hikariHui/canon-raw-media-manager/releases) 下载 `.dmg`，将应用拖到「应用程序」后打开即可。

当前发布包尚未做 Apple 公证。若从浏览器下载后提示「已损坏、无法打开」，在终端执行（路径按实际安装位置调整）：

```bash
xattr -cr /Applications/canon-raw-media-manager.app
```

然后再打开应用。也可在「系统设置 → 隐私与安全性」中选择仍要打开。

## 开发说明

### 环境依赖

- Node.js@24
- pnpm@12
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
