import { readImageSize } from "./image-size";

type Size = { width: number; height: number };

export type ScreenshotFormat = "PNG" | "SVG" | "JPG" | "PDF";

export type ScreenshotOptions = {
  format?: ScreenshotFormat;
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
const OPAQUE_DEFAULT_FORMAT: ScreenshotFormat = "JPG";
const TRANSPARENT_DEFAULT_FORMAT: ScreenshotFormat = "PNG";
const BOX_FILLING_TYPES: ReadonlySet<string> = new Set([
  "RECTANGLE",
  "FRAME",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);
const GRADIENT_FILLING_TYPES: ReadonlySet<string> = new Set(["FRAME", "COMPONENT", "INSTANCE"]);
const COMPACT_DEFAULT_SCALE = 1;
const VERBOSE_DEFAULT_SCALE = 2;
const MIN_EXPORT_SCALE = 0.01;
const SCALE_PRECISION = 10000;
const MAX_RE_EXPORTS = 2;

export const isScreenshotFormat = (value: unknown): value is ScreenshotFormat =>
  value === "PNG" || value === "SVG" || value === "JPG" || value === "PDF";

const getUnscaledSize = (node: SceneNode, clip: boolean): Size => {
  const renderBounds = !clip && "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null;
  const box = renderBounds ?? node.absoluteBoundingBox;
  return box
    ? { width: box.width, height: box.height }
    : { width: node.width, height: node.height };
};

const scaleForEdge = (currentScale: number, longestEdge: number): number =>
  Math.max(
    MIN_EXPORT_SCALE,
    Math.floor(((currentScale * MAX_IMAGE_EDGE) / longestEdge) * SCALE_PRECISION) / SCALE_PRECISION
  );

const getCappedScale = (node: SceneNode, clip: boolean): number => {
  const { width, height } = getUnscaledSize(node, clip);
  const longestEdge = Math.max(width, height);
  if (longestEdge <= MAX_IMAGE_EDGE) return COMPACT_DEFAULT_SCALE;
  return scaleForEdge(COMPACT_DEFAULT_SCALE, longestEdge);
};

const getConservativeBox = (node: SceneNode): Size => {
  const boxes: Array<Size | null> = [
    { width: node.width, height: node.height },
    "absoluteBoundingBox" in node ? node.absoluteBoundingBox : null,
    "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null,
  ];
  return boxes.reduce<Size>(
    (largest, box) =>
      box
        ? {
            width: Math.max(largest.width, box.width),
            height: Math.max(largest.height, box.height),
          }
        : largest,
    { width: 0, height: 0 }
  );
};

const getConservativeScale = (node: SceneNode): number => {
  const { width, height } = getConservativeBox(node);
  const longestEdge = Math.max(width, height);
  return longestEdge <= MAX_IMAGE_EDGE ? COMPACT_DEFAULT_SCALE : scaleForEdge(1, longestEdge);
};

const estimateSize = (node: SceneNode, scale: number): Size => {
  const { width, height } = getConservativeBox(node);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
};

const isOpaquePaint = (paint: Paint, allowGradient: boolean): boolean => {
  if (paint.visible === false || (paint.opacity ?? 1) !== 1) return false;
  if ((paint.blendMode ?? "NORMAL") !== "NORMAL") return false;
  if (paint.type === "SOLID" || paint.type === "IMAGE") return true;
  return (
    allowGradient &&
    (paint.type === "GRADIENT_LINEAR" ||
      paint.type === "GRADIENT_RADIAL" ||
      paint.type === "GRADIENT_ANGULAR" ||
      paint.type === "GRADIENT_DIAMOND") &&
    paint.gradientStops.every((stop) => stop.color.a === 1)
  );
};

const hasOpaqueOwnFill = (node: SceneNode): boolean => {
  if (!BOX_FILLING_TYPES.has(node.type) || !("fills" in node)) return false;
  if (("opacity" in node ? node.opacity : 1) !== 1) return false;
  const { fills } = node;
  if (typeof fills === "symbol") return false;
  const allowGradient = GRADIENT_FILLING_TYPES.has(node.type);
  return fills.some((paint) => isOpaquePaint(paint, allowGradient));
};

const exportsBeyondBounds = (node: SceneNode, clip: boolean): boolean => {
  if (clip || !("absoluteRenderBounds" in node)) return false;
  const { absoluteRenderBounds: render, absoluteBoundingBox: box } = node;
  if (!render || !box) return false;
  return (
    render.x < box.x ||
    render.y < box.y ||
    render.x + render.width > box.x + box.width ||
    render.y + render.height > box.y + box.height
  );
};

const pickDefaultFormat = (node: SceneNode, clip: boolean): ScreenshotFormat =>
  hasOpaqueOwnFill(node) && !exportsBeyondBounds(node, clip)
    ? OPAQUE_DEFAULT_FORMAT
    : TRANSPARENT_DEFAULT_FORMAT;

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
): Promise<{ bytes: Uint8Array; width: number; height: number }> => {
  let scale = getCappedScale(node, clip);
  let bytes = await exportRaster(node, format, scale, clip);
  const conservativeScale = getConservativeScale(node);

  for (let reExports = 0; ; reExports++) {
    const size = readImageSize(bytes);
    if (size && Math.max(size.width, size.height) <= MAX_IMAGE_EDGE) return { bytes, ...size };
    if (size && reExports === MAX_RE_EXPORTS) return { bytes, ...size };
    if (!size && (scale <= conservativeScale || reExports === MAX_RE_EXPORTS)) {
      return { bytes, ...estimateSize(node, scale) };
    }

    scale = size ? scaleForEdge(scale, Math.max(size.width, size.height)) : conservativeScale;
    bytes = await exportRaster(node, format, scale, clip);
  }
};

export const exportScreenshot = async (
  node: SceneNode,
  options: ScreenshotOptions
): Promise<ScreenshotExport> => {
  const { scale, clip, compact } = options;
  const format =
    options.format ?? (compact ? pickDefaultFormat(node, clip) : TRANSPARENT_DEFAULT_FORMAT);
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
    return {
      ...identity,
      base64: figma.base64Encode(capped.bytes),
      width: capped.width,
      height: capped.height,
    };
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
