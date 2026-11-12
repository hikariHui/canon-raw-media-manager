export interface PhotoMeta {
  path: string;
  file_name: string;
  datetime_ms: number | null;
  continuous_drive: number | null;
  burst_key: string | null;
}

export interface BurstGroup {
  id: string;
  photos: PhotoMeta[];
}

/** ContinuousDrive: 0=Single, 1/3/4/5/8=Continuous variants */
const isContinuousDrive = (v: number | null | undefined) =>
  v !== null && v !== undefined && v !== 0 && v !== 2 && v !== 6 && v !== 9;

const GAP_MS = 1000;

/**
 * 连拍分组：优先 burst_key；否则按时间间隙 ≤1s，
 * 且（连拍标志或间隙极小）合并。
 */
export function groupBursts(photos: PhotoMeta[]): BurstGroup[] {
  if (!photos.length) return [];

  const byKey = new Map<string, PhotoMeta[]>();
  const unkeyed: PhotoMeta[] = [];

  for (const p of photos) {
    if (p.burst_key) {
      const list = byKey.get(p.burst_key) ?? [];
      list.push(p);
      byKey.set(p.burst_key, list);
    } else {
      unkeyed.push(p);
    }
  }

  const groups: BurstGroup[] = [];

  for (const [key, list] of byKey) {
    list.sort(
      (a, b) =>
        (a.datetime_ms ?? 0) - (b.datetime_ms ?? 0) ||
        a.file_name.localeCompare(b.file_name),
    );
    groups.push({ id: `key:${key}`, photos: list });
  }

  unkeyed.sort(
    (a, b) =>
      (a.datetime_ms ?? 0) - (b.datetime_ms ?? 0) ||
      a.file_name.localeCompare(b.file_name),
  );

  let current: PhotoMeta[] = [];

  const flush = () => {
    if (!current.length) return;
    // 用组内首张 path 作稳定 id，避免重扫后 time:idx 跳变导致当前组掉回第一组
    groups.push({ id: `time:${current[0].path}`, photos: current });
    current = [];
  };

  for (const photo of unkeyed) {
    if (!current.length) {
      current = [photo];
      continue;
    }
    const prev = current[current.length - 1];
    const t0 = prev.datetime_ms;
    const t1 = photo.datetime_ms;

    if (t0 == null || t1 == null) {
      flush();
      current = [photo];
      continue;
    }

    const gap = t1 - t0;
    const continuous =
      isContinuousDrive(photo.continuous_drive) ||
      isContinuousDrive(prev.continuous_drive);
    const tight = gap <= 200;

    if (gap <= GAP_MS && (continuous || tight)) {
      current.push(photo);
    } else {
      flush();
      current = [photo];
    }
  }
  flush();

  groups.sort((a, b) => {
    const ta = a.photos[0]?.datetime_ms ?? 0;
    const tb = b.photos[0]?.datetime_ms ?? 0;
    return ta - tb;
  });

  return groups;
}
