/**
 * 获取 proxy 文件路径
 * @param rawVideoPath 原始文件路径
 * @param proxyDir 代理文件目录路径
 * @returns 代理文件路径
 */
export const getProxyVideoPath = (rawVideoPath: string, proxyDir: string) => {
  const crmFileName = rawVideoPath.split(/[\\/]/).pop();
  const crmName = crmFileName?.split(".").shift();
  return proxyDir.replace(/[\\/]$/, "") + "/" + crmName + "_proxy.mp4";
};
