import { Button, Collapse, Modal } from "animal-island-ui";
import {
  MdAdd,
  MdDelete,
  MdFolder,
  MdFolderOpen,
  MdSync,
  MdVideocam,
} from "react-icons/md";
import {
  formatBytes,
  formatEta,
  formatSpeed,
  useFolderSync,
  type SyncPlanSummary,
} from "../hooks/useFolderSync";
import "./SyncModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

function ProgressBar({
  value,
  label,
  sub,
  stats,
}: {
  value: number;
  label: string;
  sub?: string;
  stats?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="sync-progress-block">
      <div className="sync-progress-meta">
        <span title={label}>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="sync-progress-track">
        <div className="sync-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {sub ? (
        <div className="sync-progress-sub" title={sub}>
          {sub}
        </div>
      ) : null}
      {stats ? (
        <div className="sync-progress-stats" title={stats}>
          {stats}
        </div>
      ) : null}
    </div>
  );
}

function PlanDetails({ plan }: { plan: SyncPlanSummary }) {
  if (plan.alreadySynced) {
    return <p className="sync-empty">已完全同步，无需操作</p>;
  }

  const targetLabel = plan.targetDir;

  return (
    <>
      <p className="sync-plan-counts">
        {targetLabel}
        <br />
        移动 {plan.moveCount} · 复制 {plan.copyCount}（
        {formatBytes(plan.totalCopyBytes)}）· 回收站 {plan.trashCount} · 跳过{" "}
        {plan.skipCount}
      </p>
      <Collapse
        question={`B 内部移动（${plan.moveCount}）`}
        answer={
          plan.movePreview.length ? (
            <ul className="sync-result-list">
              {plan.movePreview.map((m) => (
                <li key={`${m.from}->${m.to}`}>
                  <div className="sync-result-path">{m.to}</div>
                  <div className="sync-result-meta">从 {m.from}</div>
                </li>
              ))}
              {plan.moveCount > plan.movePreview.length ? (
                <li className="sync-more">
                  …还有 {plan.moveCount - plan.movePreview.length} 个
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="sync-empty">无</p>
          )
        }
      />
      <Collapse
        question={`从 A 复制（${plan.copyCount} · ${formatBytes(plan.totalCopyBytes)}）`}
        answer={
          plan.copyPreview.length ? (
            <ul className="sync-result-list">
              {plan.copyPreview.map((c) => (
                <li key={c.path}>
                  <div className="sync-result-path">{c.path}</div>
                  <div className="sync-result-meta">{formatBytes(c.size)}</div>
                </li>
              ))}
              {plan.copyCount > plan.copyPreview.length ? (
                <li className="sync-more">
                  …还有 {plan.copyCount - plan.copyPreview.length} 个
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="sync-empty">无</p>
          )
        }
      />
      <Collapse
        question={`移到回收站 _trash_${plan.timestamp}/（${plan.trashCount}）`}
        answer={
          plan.trashPreview.length ? (
            <ul className="sync-result-list">
              {plan.trashPreview.map((p) => (
                <li key={p}>
                  <div className="sync-result-path">{p}</div>
                </li>
              ))}
              {plan.trashCount > plan.trashPreview.length ? (
                <li className="sync-more">
                  …还有 {plan.trashCount - plan.trashPreview.length} 个
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="sync-empty">无</p>
          )
        }
      />
    </>
  );
}

export default function SyncModal({ open, onClose }: Props) {
  const {
    sourceDir,
    targetDirs,
    phase,
    error,
    plans,
    progress,
    finished,
    throughput,
    chooseSourceDir,
    addTargetDir,
    removeTargetDir,
    planSync,
    startSync,
    cancelSync,
    resetSession,
    clearPaths,
  } = useFolderSync();

  const busy = phase === "planning" || phase === "syncing";
  const allAlreadySynced =
    plans.length > 0 && plans.every((p) => p.alreadySynced);

  const handleClose = () => {
    if (phase === "syncing") return;
    resetSession();
    clearPaths();
    onClose();
  };

  const copyPct =
    progress && progress.totalCopyBytes > 0
      ? (progress.bytesCopied / progress.totalCopyBytes) * 100
      : progress?.phase === "copying"
        ? 0
        : progress
          ? progress.filesTotal > 0
            ? (progress.filesDone / progress.filesTotal) * 100
            : 0
          : 0;

  const speedText = formatSpeed(throughput.bytesPerSec);
  const etaText = formatEta(throughput.etaSeconds);
  const copyStats =
    progress?.phase === "copying" && progress.totalCopyBytes > 0
      ? throughput.bytesPerSec > 0
        ? `速度 ${speedText} · 剩余 ${etaText}`
        : "速度计算中…"
      : undefined;

  return (
    <Modal
      open={open}
      title="同步到备份盘"
      width={720}
      typewriter={false}
      maskClosable={!busy}
      onClose={handleClose}
      footer={null}
    >
      <div className="sync-modal-body">
        {(phase === "idle" || phase === "planning") && (
          <>
            <p className="sync-hint">
              将素材目录镜像同步到一个或多个备份盘：识别同盘移动、跨盘复制，备份盘多余文件移入{" "}
              <code>_trash_*</code>，不直接删除。
            </p>

            <section className="sync-section">
              <div className="sync-section-head">
                <h3>
                  <MdVideocam /> 源目录（A）
                </h3>
                <Button
                  type="primary"
                  size="small"
                  disabled={busy}
                  onClick={chooseSourceDir}
                >
                  <MdFolderOpen style={{ marginRight: 4 }} />
                  选择
                </Button>
              </div>
              <div className="sync-path-box" title={sourceDir}>
                {sourceDir || "未选择源目录"}
              </div>
            </section>

            <section className="sync-section">
              <div className="sync-section-head">
                <h3>
                  <MdFolder /> 备份目标（可多选）
                </h3>
                <Button
                  type="primary"
                  size="small"
                  disabled={busy}
                  onClick={addTargetDir}
                >
                  <MdAdd style={{ marginRight: 4 }} />
                  添加
                </Button>
              </div>
              {targetDirs.length === 0 ? (
                <p className="sync-hint">可添加多个备份盘目录</p>
              ) : (
                <ul className="sync-path-list">
                  {targetDirs.map((p) => (
                    <li key={p}>
                      <span title={p}>{p}</span>
                      <button
                        type="button"
                        className="sync-icon-btn"
                        onClick={() => removeTargetDir(p)}
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

            <div className="sync-actions">
              <Button
                type="primary"
                onClick={planSync}
                disabled={busy || !sourceDir || !targetDirs.length}
              >
                <MdSync style={{ marginRight: 6 }} />
                {phase === "planning" ? "扫描比对中…" : "生成同步计划"}
              </Button>
            </div>
          </>
        )}

        {phase === "review" && plans.length > 0 && (
          <section className="sync-section">
            <h3>同步计划</h3>
            <p className="sync-hint">
              源：{plans[0].sourceDir}
              <br />
              源文件 {plans[0].sourceFileCount} 个 · 目标 {plans.length}{" "}
              个备份盘
            </p>

            {allAlreadySynced ? (
              <p className="sync-summary-counts">
                所有目标目录已完全同步，无需操作。
              </p>
            ) : (
              <div className="sync-collapses">
                {plans.map((plan) => (
                  <div key={plan.targetDir} className="sync-plan-block">
                    <PlanDetails plan={plan} />
                  </div>
                ))}
              </div>
            )}

            <div className="sync-actions">
              <Button onClick={resetSession}>返回</Button>
              {!allAlreadySynced ? (
                <Button type="primary" onClick={startSync}>
                  确认执行
                </Button>
              ) : null}
            </div>
          </section>
        )}

        {phase === "syncing" && (
          <section className="sync-section">
            <h3>
              正在同步
              {progress && progress.targetTotal > 1
                ? `（${progress.targetIndex + 1}/${progress.targetTotal}）`
                : ""}
            </h3>
            {progress?.targetDir ? (
              <p className="sync-hint" title={progress.targetDir}>
                目标：{progress.targetDir}
              </p>
            ) : null}
            <p className="sync-hint">
              {progress?.message || "准备中…"}
              {progress?.currentPath ? ` · ${progress.currentPath}` : ""}
            </p>
            <ProgressBar
              value={copyPct}
              label={
                progress?.phase === "scanning"
                  ? "扫描中"
                  : progress?.phase === "moving"
                    ? "移动中"
                    : progress?.phase === "trashing"
                      ? "清理中"
                      : "复制中"
              }
              sub={
                progress
                  ? progress.phase === "copying"
                    ? `${formatBytes(progress.bytesCopied)} / ${formatBytes(progress.totalCopyBytes)} · ${progress.filesDone}/${progress.filesTotal}`
                    : `${progress.filesDone}/${progress.filesTotal || "…"}`
                  : "准备中…"
              }
              stats={copyStats}
            />
            <div className="sync-actions">
              <Button onClick={cancelSync}>取消同步</Button>
            </div>
          </section>
        )}

        {phase === "done" && finished && (
          <section className="sync-section">
            <h3>{finished.cancelled ? "同步已取消" : "同步完成"}</h3>
            <div className="sync-collapses">
              {finished.results.map((r) => (
                <Collapse
                  key={r.targetDir || "source-error"}
                  question={`${r.targetDir || "源目录"}（移动 ${r.moved} · 复制 ${r.copied} · 回收站 ${r.trashed} · 失败 ${r.failed.length}${r.alreadySynced ? " · 已同步" : ""}）`}
                  answer={
                    <div>
                      {r.trashDir ? (
                        <p className="sync-hint">回收站：{r.trashDir}</p>
                      ) : null}
                      {r.failed.length ? (
                        <ul className="sync-result-list">
                          {r.failed.map((f) => (
                            <li key={f}>
                              <div className="sync-result-path">{f}</div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="sync-empty">
                          {r.alreadySynced ? "无需操作" : "无失败项"}
                        </p>
                      )}
                    </div>
                  }
                />
              ))}
            </div>
            <div className="sync-actions">
              <Button
                type="primary"
                onClick={() => {
                  resetSession();
                  clearPaths();
                }}
              >
                继续同步
              </Button>
              <Button onClick={handleClose}>关闭</Button>
            </div>
          </section>
        )}

        {error ? <pre className="sync-error">{error}</pre> : null}
      </div>
    </Modal>
  );
}
