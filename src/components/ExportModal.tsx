import { Button, Modal, Collapse } from "animal-island-ui";
import {
  MdAdd,
  MdDelete,
  MdSdStorage,
  MdFolder,
  MdFileUpload,
} from "react-icons/md";
import {
  useCardExport,
  formatBytes,
  formatMtime,
  type ExportResultItem,
} from "../hooks/useCardExport";
import "./ExportModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

function ProgressBar({
  value,
  label,
  sub,
}: {
  value: number;
  label: string;
  sub?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="export-progress-block">
      <div className="export-progress-meta">
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="export-progress-track">
        <div className="export-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {sub ? <div className="export-progress-sub">{sub}</div> : null}
    </div>
  );
}

function ResultList({ items }: { items: ExportResultItem[] }) {
  if (!items.length) return <p className="export-empty">无</p>;
  return (
    <ul className="export-result-list">
      {items.map((item, i) => (
        <li key={`${item.destPath}-${i}`}>
          <div className="export-result-path">{item.relativePath}</div>
          <div className="export-result-meta">
            → {item.exportPath}
            {item.reason === "identical"
              ? " · 一致跳过"
              : item.reason === "conflict_skipped"
                ? " · 冲突未覆盖"
                : ""}
            {item.error ? ` · ${item.error}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ExportModal({ open, onClose }: Props) {
  const {
    cardPaths,
    exportPaths,
    phase,
    error,
    scanResults,
    conflicts,
    overwriteKeys,
    setOverwriteKeys,
    dateFolder,
    progress,
    cardProgress,
    finished,
    addCardPath,
    removeCardPath,
    addExportPath,
    removeExportPath,
    prepareExport,
    confirmConflictsAndExport,
    cancelExport,
    resetSession,
  } = useCardExport();

  const busy = phase === "scanning" || phase === "exporting";
  const totalFiles = scanResults.reduce((n, s) => n + s.files.length, 0);
  const totalBytes = scanResults.reduce((n, s) => n + s.totalBytes, 0);

  const handleClose = () => {
    if (phase === "exporting") return;
    resetSession();
    onClose();
  };

  const toggleOverwrite = (key: string) => {
    setOverwriteKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const overallPct =
    progress && progress.totalBytes > 0
      ? (progress.bytesCopied / progress.totalBytes) * 100
      : 0;

  const skippedAll = finished
    ? [...finished.skippedIdentical, ...finished.skippedConflict]
    : [];

  return (
    <Modal
      open={open}
      title="从存储卡导出"
      width={720}
      typewriter={false}
      maskClosable={!busy}
      closable={!busy}
      onClose={handleClose}
      footer={null}
    >
      <div className="export-modal-body">
        {/* 路径配置 */}
        {(phase === "idle" || phase === "scanning") && (
          <>
            <section className="export-section">
              <div className="export-section-head">
                <h3>
                  <MdSdStorage /> 存储卡路径
                </h3>
                <Button
                  type="primary"
                  size="small"
                  onClick={addCardPath}
                  disabled={busy}
                >
                  <MdAdd style={{ marginRight: 4 }} />
                  添加
                </Button>
              </div>
              {cardPaths.length === 0 ? (
                <p className="export-hint">
                  选择相机存储卡根目录（含 DCIM/CRM/XFVC）
                </p>
              ) : (
                <ul className="export-path-list">
                  {cardPaths.map((p) => (
                    <li key={p}>
                      <span title={p}>{p}</span>
                      <button
                        type="button"
                        className="export-icon-btn"
                        onClick={() => removeCardPath(p)}
                        disabled={busy}
                        aria-label="删除"
                      >
                        <MdDelete />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="export-section">
              <div className="export-section-head">
                <h3>
                  <MdFolder /> 导出路径（多备份）
                </h3>
                <Button
                  type="primary"
                  size="small"
                  onClick={addExportPath}
                  disabled={busy}
                >
                  <MdAdd style={{ marginRight: 4 }} />
                  添加
                </Button>
              </div>
              {exportPaths.length === 0 ? (
                <p className="export-hint">可添加多个硬盘目录做备份</p>
              ) : (
                <ul className="export-path-list">
                  {exportPaths.map((p) => (
                    <li key={p}>
                      <span title={p}>{p}</span>
                      <button
                        type="button"
                        className="export-icon-btn"
                        onClick={() => removeExportPath(p)}
                        disabled={busy}
                        aria-label="删除"
                      >
                        <MdDelete />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="export-actions">
              <Button
                type="primary"
                onClick={prepareExport}
                disabled={busy || !cardPaths.length || !exportPaths.length}
              >
                <MdFileUpload style={{ marginRight: 6 }} />
                {phase === "scanning" ? "扫描中…" : "开始导出"}
              </Button>
            </div>
          </>
        )}

        {/* 冲突确认 */}
        {phase === "conflicts" && (
          <section className="export-section">
            <h3>发现同名但不一致的文件（可能是上次中断残留）</h3>
            <p className="export-hint">
              日期文件夹：{dateFolder}。勾选需要覆盖的项，未勾选将跳过。
            </p>
            <div className="export-conflict-actions">
              <Button
                size="small"
                onClick={() =>
                  setOverwriteKeys(new Set(conflicts.map((c) => c.key)))
                }
              >
                全部覆盖
              </Button>
              <Button size="small" onClick={() => setOverwriteKeys(new Set())}>
                全部跳过
              </Button>
            </div>
            <ul className="export-conflict-list">
              {conflicts.map((c) => (
                <li key={c.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={overwriteKeys.has(c.key)}
                      onChange={() => toggleOverwrite(c.key)}
                    />
                    <div>
                      <div className="export-result-path">{c.relativePath}</div>
                      <div className="export-result-meta">
                        目标：{c.exportPath}
                      </div>
                      <div className="export-result-meta">
                        源 {formatBytes(c.sourceSize)} /{" "}
                        {formatMtime(c.sourceMtimeSecs)}
                      </div>
                      <div className="export-result-meta">
                        目标 {formatBytes(c.destSize)} /{" "}
                        {formatMtime(c.destMtimeSecs)}
                      </div>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="export-actions">
              <Button onClick={resetSession}>返回</Button>
              <Button type="primary" onClick={confirmConflictsAndExport}>
                继续导出
              </Button>
            </div>
          </section>
        )}

        {/* 进度 */}
        {phase === "exporting" && (
          <section className="export-section">
            <h3>正在导出到 {dateFolder}</h3>
            {scanResults.length > 0 && (
              <p className="export-hint">
                扫描到 {totalFiles} 个文件 · {formatBytes(totalBytes)}
                {exportPaths.length > 1
                  ? ` · ${exportPaths.length} 个备份盘`
                  : ""}
              </p>
            )}
            <ProgressBar
              value={overallPct}
              label="总进度"
              sub={
                progress
                  ? `${formatBytes(progress.bytesCopied)} / ${formatBytes(progress.totalBytes)} · ${progress.filesDone}/${progress.filesTotal} · ${progress.fileName}`
                  : "准备中…"
              }
            />
            {Object.entries(cardProgress).map(([card, p]) => {
              const pct =
                p.cardTotalBytes > 0
                  ? (p.cardBytesCopied / p.cardTotalBytes) * 100
                  : 0;
              return (
                <ProgressBar
                  key={card}
                  value={pct}
                  label={card}
                  sub={`${formatBytes(p.cardBytesCopied)} / ${formatBytes(p.cardTotalBytes)}`}
                />
              );
            })}
            <div className="export-actions">
              <Button onClick={cancelExport}>取消导出</Button>
            </div>
          </section>
        )}

        {/* 完成汇总 */}
        {phase === "done" && finished && (
          <section className="export-section">
            <h3>
              {finished.cancelled ? "导出已取消" : "导出完成"}（
              {finished.dateFolder}）
            </h3>
            <p className="export-summary-counts">
              成功 {finished.succeeded.length} · 同名未复制 {skippedAll.length}{" "}
              · 失败 {finished.failed.length}
            </p>
            <div className="export-collapses">
              <Collapse
                question={`成功导出（${finished.succeeded.length}）`}
                answer={<ResultList items={finished.succeeded} />}
              />
              <Collapse
                question={`同名未复制（${skippedAll.length}）`}
                answer={<ResultList items={skippedAll} />}
              />
              <Collapse
                question={`失败（${finished.failed.length}）`}
                answer={<ResultList items={finished.failed} />}
              />
            </div>
            <div className="export-actions">
              <Button
                type="primary"
                onClick={() => {
                  resetSession();
                }}
              >
                继续导出
              </Button>
              <Button onClick={handleClose}>关闭</Button>
            </div>
          </section>
        )}

        {error ? <pre className="export-error">{error}</pre> : null}
      </div>
    </Modal>
  );
}
