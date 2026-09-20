import { Button, Modal } from "animal-island-ui";
import { MdAdd, MdDelete, MdFolderSpecial } from "react-icons/md";
import { useAllowedDirs } from "../hooks/useAllowedDirs";
import "./SettingsModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const { dirs, addDir, removeDir } = useAllowedDirs();

  return (
    <Modal
      open={open}
      title="设置"
      width={640}
      typewriter={false}
      maskClosable
      closable
      onClose={onClose}
      footer={
        <Button type="primary" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="settings-modal-body">
        <section className="settings-section">
          <div className="settings-section-head">
            <h3>
              <MdFolderSpecial /> 允许管理的文件目录
            </h3>
            <Button type="primary" size="small" onClick={addDir}>
              <MdAdd style={{ marginRight: 4 }} />
              添加
            </Button>
          </div>
          <p className="settings-hint">
            必须先配置至少一个根目录。之后选择 Raw / Proxy
            目录时必须落在下列路径之下，避免多备份盘选错。
          </p>
          {dirs.length === 0 ? (
            <p className="settings-empty">
              尚未添加，此时无法选择 Raw / Proxy 目录
            </p>
          ) : (
            <ul className="settings-path-list">
              {dirs.map((p) => (
                <li key={p}>
                  <span title={p}>{p}</span>
                  <button
                    type="button"
                    className="settings-icon-btn"
                    onClick={() => removeDir(p)}
                    aria-label="删除"
                  >
                    <MdDelete />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
