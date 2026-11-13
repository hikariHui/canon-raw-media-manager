import type { CSSProperties } from "react";

/** EXIF Orientation 1–8 → CSS transform（配合 image-orientation: none） */
export function orientationCss(
  orientation: number | null | undefined,
): CSSProperties {
  const o =
    orientation && orientation >= 1 && orientation <= 8 ? orientation : 1;
  switch (o) {
    case 2:
      return { transform: "scaleX(-1)" };
    case 3:
      return { transform: "rotate(180deg)" };
    case 4:
      return { transform: "scaleY(-1)" };
    case 5:
      return { transform: "rotate(90deg) scaleX(-1)" };
    case 6:
      return { transform: "rotate(90deg)" };
    case 7:
      return { transform: "rotate(-90deg) scaleX(-1)" };
    case 8:
      return { transform: "rotate(-90deg)" };
    default:
      return {};
  }
}

/** 90/270 类朝向会交换视觉宽高 */
export function orientationSwapsAxes(
  orientation: number | null | undefined,
): boolean {
  return (
    orientation === 5 ||
    orientation === 6 ||
    orientation === 7 ||
    orientation === 8
  );
}
