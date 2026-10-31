import { roundNumbers } from "./serializer";

export const COMPACT_LAYOUT_MAX_NODES = 300;
export const VERBOSE_LAYOUT_MAX_NODES = 2000;
const MAX_LAYOUT_DEPTH = 100;
const TRANSLATION_EPSILON = 1e-6;

type Box = { x: number; y: number; width: number; height: number } | null;

const isPureTranslation = (transform: Transform): boolean => {
  const [[a, c], [b, d]] = transform;
  return (
    Math.abs(a - 1) < TRANSLATION_EPSILON &&
    Math.abs(d - 1) < TRANSLATION_EPSILON &&
    Math.abs(b) < TRANSLATION_EPSILON &&
    Math.abs(c) < TRANSLATION_EPSILON
  );
};

const isSameBox = (first: Box, second: Box): boolean =>
  first === second ||
  (first !== null &&
    second !== null &&
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    first.height === second.height);

const buildVerboseEntry = (node: SceneNode) => ({
  id: node.id,
  parentId: node.parent?.id,
  name: node.name,
  type: node.type,
  visible: node.visible,
  localSize: { width: node.width, height: node.height },
  absoluteTransform: node.absoluteTransform,
  absoluteBoundingBox: node.absoluteBoundingBox,
  absoluteRenderBounds: "absoluteRenderBounds" in node ? node.absoluteRenderBounds : null,
  clipsContent: "clipsContent" in node ? node.clipsContent : false,
});

const buildCompactEntry = (node: SceneNode) => {
  const { absoluteTransform, absoluteRenderBounds, absoluteBoundingBox, ...rest } =
    buildVerboseEntry(node);
  const roundedBounds = roundNumbers(absoluteBoundingBox);
  const roundedRenderBounds = roundNumbers(absoluteRenderBounds);
  return roundNumbers({
    ...rest,
    ...(isPureTranslation(absoluteTransform) ? {} : { absoluteTransform }),
    absoluteBoundingBox: roundedBounds,
    ...(isSameBox(roundedRenderBounds, roundedBounds)
      ? {}
      : { absoluteRenderBounds: roundedRenderBounds }),
  });
};

export const collectLayoutNodes = (root: SceneNode, maxNodes: number, compact: boolean) => {
  const nodes: unknown[] = [];
  let truncated = false;
  const visit = (node: SceneNode, depth: number) => {
    if (nodes.length >= maxNodes || depth > MAX_LAYOUT_DEPTH) {
      truncated = true;
      return;
    }
    nodes.push(compact ? buildCompactEntry(node) : buildVerboseEntry(node));
    if ("children" in node) for (const child of node.children) visit(child, depth + 1);
  };
  visit(root, 0);
  return { nodes, truncated };
};
