import { readImageSize } from "./image-size";

export type ScreenshotFormat = "PNG" | "SVG" | "JPG" | "PDF";

export type ScreenshotOptions = {
  format: ScreenshotFormat;
  scale?: number;
  clip: boolean;
  compact: boolean;
};

export type ScreenshotExport = {
  nodeId: string;
  nodeName: string;
  format: ScreenshotFormat;
  base64: string;
  width: number;
  height: number;
};

export const MAX_IMAGE_EDGE = 1568;
export const COMPACT_DEFAULT_FORMAT: ScreenshotFormat = "JPG";
export const VERBOSE_DEFAULT_FORMAT: ScreenshotFormat = "PNG";
const COMPACT_DEFAULT_SCALE = 1;
const VERBOSE_DEFAULT_SCALE = 2;
const MIN_EXPORT_SCALE = 0.01;
const SCALE_PRECISION = 10000;

export const isScreenshotFormat = (value: unknown): value is ScreenshotFormat =>
  value === "PNG" || value === "SVG" || value === "JPG" || value === "PDF";

const getUnscaledSize = (node: SceneNode, clip: boolean): { width: number; height: number } => {
  const renderBounds = !clip && "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null;
  const box = renderBounds ?? node.absoluteBoundingBox;
  return box
    ? { width: box.width, height: box.height }
    : { width: node.width, height: node.height };
};

const getCappedScale = (node: SceneNode, clip: boolean): number => {
  const { width, height } = getUnscaledSize(node, clip);
  const longestEdge = Math.max(width, height);
  if (longestEdge <= MAX_IMAGE_EDGE) return COMPACT_DEFAULT_SCALE;
  const scale = Math.floor((MAX_IMAGE_EDGE / longestEdge) * SCALE_PRECISION) / SCALE_PRECISION;
  return Math.max(MIN_EXPORT_SCALE, scale);
};

const exportRaster = async (
  node: SceneNode,
  format: "PNG" | "JPG",
  scale: number,
  clip: boolean
): Promise<Uint8Array> => {
  const commonSettings = clip ? { contentsOnly: true, useAbsoluteBounds: true } : {};
  return node.exportAsync({
    format,
    constraint: { type: "SCALE", value: scale },
    ...commonSettings,
  });
};

const exportCappedRaster = async (
  node: SceneNode,
  format: "PNG" | "JPG",
  clip: boolean
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> => {
  const scale = getCappedScale(node, clip);
  const bytes = await exportRaster(node, format, scale, clip);
  const size = readImageSize(bytes);
  if (!size) return null;
  const longestEdge = Math.max(size.width, size.height);
  if (longestEdge <= MAX_IMAGE_EDGE) return { bytes, ...size };

  const correctedScale = Math.max(
    MIN_EXPORT_SCALE,
    Math.floor(((scale * MAX_IMAGE_EDGE) / longestEdge) * SCALE_PRECISION) / SCALE_PRECISION
  );
  const correctedBytes = await exportRaster(node, format, correctedScale, clip);
  const correctedSize = readImageSize(correctedBytes);
  return correctedSize ? { bytes: correctedBytes, ...correctedSize } : null;
};

export const exportScreenshot = async (
  node: SceneNode,
  options: ScreenshotOptions
): Promise<ScreenshotExport> => {
  const { format, scale, clip, compact } = options;
  const identity = { nodeId: node.id, nodeName: node.name, format };

  if (format === "SVG" || format === "PDF") {
    const commonSettings = clip ? { contentsOnly: true, useAbsoluteBounds: true } : {};
    const bytes = await node.exportAsync({ format, ...commonSettings });
    return {
      ...identity,
      base64: figma.base64Encode(bytes),
      width: node.width,
      height: node.height,
    };
  }

  if (compact && scale === undefined) {
    const capped = await exportCappedRaster(node, format, clip);
    if (capped) {
      return {
        ...identity,
        base64: figma.base64Encode(capped.bytes),
        width: capped.width,
        height: capped.height,
      };
    }
  }

  const effectiveScale = scale ?? (compact ? COMPACT_DEFAULT_SCALE : VERBOSE_DEFAULT_SCALE);
  const bytes = await exportRaster(node, format, effectiveScale, clip);
  const size = compact ? readImageSize(bytes) : null;
  return {
    ...identity,
    base64: figma.base64Encode(bytes),
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
  };
};
