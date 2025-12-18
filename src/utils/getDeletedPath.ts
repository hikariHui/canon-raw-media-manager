/**
 * 获取删除文件路径
 * @param orginalPath 原始文件路径
 * @returns 删除文件路径
 */
export const getDeletedPath = (orginalPath: string) => {
  // 放到原始文件的同级 deleted 目录下，文件名不变
  const orginalDir = orginalPath.split(/[\\/]/).slice(0, -1).join("/");
  const deletedDir = orginalDir + "/deleted";
  const fileName = orginalPath.split(/[\\/]/).pop();
  return deletedDir + "/" + fileName;
};

/** 获取星标文件路径 */
export const getStarredPath = (orginalPath: string) => {
  // 放到原始文件的同级 starred 目录下，文件名不变
  const orginalDir = orginalPath.split(/[\\/]/).slice(0, -1).join("/");
  const starredDir = orginalDir + "/starred";
  const fileName = orginalPath.split(/[\\/]/).pop();
  return starredDir + "/" + fileName;
};
