import { Button, Modal } from "animal-island-ui";
import { useAppContext } from "../context/AppContext";

export default function ProxySearchModal() {
  const { proxySearchPhase, cancelProxySearch, dismissProxySearchNotFound } =
    useAppContext();

  if (proxySearchPhase === "searching") {
    return (
      <Modal
        open
        title="自动搜索 Proxy 目录"
        width={420}
        typewriter={false}
        maskClosable={false}
        closable={false}
        onClose={cancelProxySearch}
        footer={
          <Button type="primary" onClick={cancelProxySearch}>
            终止搜索
          </Button>
        }
      >
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          正在自动搜索 Proxy 目录，请稍候…
        </p>
      </Modal>
    );
  }

  if (proxySearchPhase === "not_found") {
    return (
      <Modal
        open
        title="未找到 Proxy 目录"
        width={420}
        typewriter={false}
        maskClosable
        closable
        onClose={dismissProxySearchNotFound}
        footer={
          <Button type="primary" onClick={dismissProxySearchNotFound}>
            知道了
          </Button>
        }
      >
        <p
          style={{ margin: 0, color: "#794f27", fontSize: 14, lineHeight: 1.6 }}
        >
          未能自动定位与当前 Raw 目录匹配的 Proxy 目录，请手动选择。
        </p>
      </Modal>
    );
  }

  return null;
}
