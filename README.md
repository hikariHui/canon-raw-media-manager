# 佳能 raw 视频管理工具

基于拍摄时录制 raw（4通道音频）+ proxy（2通道音频）情况下，素材文件管理麻烦这样小众而又蛋疼的场景而开发的管理工具。

## 功能

- 自动映射 raw 和 proxy，同步删除文件
- 同步添加星标（移动到 starred 文件夹）

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
