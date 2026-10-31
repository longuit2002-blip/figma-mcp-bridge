import { isRecord } from "./guards";
import { roundNumbers } from "./rounding";

// --- Serialized paint types (discriminated union) ---
type SerializedSolidPaint = {
  type: "SOLID";
  color: string;
  opacity?: number;
};

type SerializedGradientPaint = {
  type: "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND";
  gradientStops: { color: string; opacity: number; position: number }[];
  gradientTransform: Transform;
  opacity?: number;
};

type SerializedImagePaint = {
  type: "IMAGE";
  scaleMode: string;
  imageHash?: string | null;
  imageTransform?: Transform;
  opacity?: number;
};

type SerializedPaint = SerializedSolidPaint | SerializedGradientPaint | SerializedImagePaint;

// --- Serialized effect types ---
type SerializedShadowEffect = {
  type: "DROP_SHADOW" | "INNER_SHADOW";
  color: string;
  opacity: number;
  offset: { x: number; y: number };
  radius: number;
  spread?: number;
  blendMode?: string;
};

type SerializedBlurEffect = {
  type: "LAYER_BLUR" | "BACKGROUND_BLUR";
  radius: number;
};

type SerializedEffect = SerializedShadowEffect | SerializedBlurEffect;

// --- Serialized auto-layout ---
type SerializedAutoLayout = {
  direction: "HORIZONTAL" | "VERTICAL";
  gap: number;
  primaryAxisAlign: string;
  counterAxisAlign: string;
  primaryAxisSizing: string;
  counterAxisSizing: string;
  wrap?: string;
  counterAxisSpacing?: number;
};

// --- Serialized styles ---
type SerializedStyles = {
  opacity?: number;
  blendMode?: string;
  visible?: boolean;
  fills?: SerializedPaint[] | "mixed";
  strokes?: SerializedPaint[] | "mixed";
  strokeWeight?: number | "mixed";
  strokeAlign?: string;
  dashPattern?: number[];
  effects?: SerializedEffect[];
  cornerRadius?: number | "mixed";
  cornerRadii?: {
    topLeft: number;
    topRight: number;
    bottomRight: number;
    bottomLeft: number;
  };
  cornerSmoothing?: number;
  autoLayout?: SerializedAutoLayout;
  padding?: { top: number; right: number; bottom: number; left: number };
  clipsContent?: boolean;
  rotation?: number;
  constraints?: { horizontal: string; vertical: string };
};

type SerializedBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SerializedNode = {
  id: string;
  name: string;
  type: string;
  bounds?: SerializedBounds;
  characters?: string;
  styles?: SerializedStyles;
  children?: SerializedNode[];
  childCount?: number;
  truncated?: boolean;
};

export type TreeLimits = { depth: number; maxNodes: number; maxBytes: number };

const DEFAULT_TREE_DEPTH = 3;
const DEFAULT_TREE_MAX_NODES = 300;
const DEFAULT_TREE_MAX_BYTES = 60_000;
export const resolveTreeLimits = (
  params: Record<string, unknown>,
  compact: boolean
): TreeLimits => {
  const pick = (value: unknown, fallback: number): number =>
    typeof value === "number" ? value : compact ? fallback : Infinity;
  return {
    depth: pick(params.depth, DEFAULT_TREE_DEPTH),
    maxNodes: pick(params.maxNodes, DEFAULT_TREE_MAX_NODES),
    maxBytes: pick(params.maxBytes, DEFAULT_TREE_MAX_BYTES),
  };
};

const OUTLINE_MAX_CHARACTERS = 80;
const TRUNCATION_MARKER_BYTES = 36;
const CHILDREN_WRAPPER_BYTES = 15;
const YIELD_INTERVAL = 200;

const DEFAULT_STYLE_VALUES: Readonly<Record<string, readonly unknown[]>> = {
  visible: [true],
  opacity: [1],
  cornerRadius: [0],
  clipsContent: [false],
  textDecoration: ["NONE"],
  textAlignHorizontal: ["LEFT"],
  textAlignVertical: ["TOP"],
};
const DEFAULT_AUTO_LAYOUT_VALUES: Readonly<Record<string, readonly unknown[]>> = {
  wrap: ["NO_WRAP"],
  primaryAxisAlign: ["MIN"],
  counterAxisAlign: ["MIN"],
};
const CONTAINER_TYPES: ReadonlySet<string> = new Set([
  "FRAME",
  "GROUP",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "SECTION",
]);
const FILL_SENSITIVE_TYPES: ReadonlySet<string> = new Set(["FRAME", "COMPONENT", "INSTANCE"]);

const isMixed = (value: unknown): value is symbol => typeof value === "symbol";

export const toHex = (color: RGB): string => {
  const clamp = (value: number) => Math.min(255, Math.max(0, Math.round(value * 255)));
  const [r, g, b] = [clamp(color.r), clamp(color.g), clamp(color.b)];
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
};

const serializeGradientStops = (
  stops: readonly ColorStop[]
): { color: string; opacity: number; position: number }[] =>
  stops.map((stop) => ({
    color: toHex(stop.color),
    opacity: stop.color.a,
    position: stop.position,
  }));

const serializePaints = (
  paints: readonly Paint[] | symbol | undefined
): SerializedPaint[] | "mixed" => {
  if (isMixed(paints)) return "mixed";
  if (!paints || !Array.isArray(paints)) return [];

  return paints
    .filter((paint) => paint.visible !== false)
    .flatMap((paint): SerializedPaint[] => {
      switch (paint.type) {
        case "SOLID":
          return [
            {
              type: "SOLID",
              color: toHex(paint.color),
              opacity: paint.opacity,
            },
          ];
        case "GRADIENT_LINEAR":
        case "GRADIENT_RADIAL":
        case "GRADIENT_ANGULAR":
        case "GRADIENT_DIAMOND":
          return [
            {
              type: paint.type,
              gradientStops: serializeGradientStops(paint.gradientStops),
              gradientTransform: paint.gradientTransform,
              opacity: paint.opacity,
            },
          ];
        case "IMAGE":
          return [
            {
              type: "IMAGE",
              scaleMode: paint.scaleMode,
              imageHash: paint.imageHash,
              imageTransform: paint.imageTransform,
              opacity: paint.opacity,
            },
          ];
        default:
          return [];
      }
    });
};

const serializeEffects = (effects: readonly Effect[]): SerializedEffect[] =>
  effects
    .filter((effect) => effect.visible !== false)
    .flatMap((effect): SerializedEffect[] => {
      switch (effect.type) {
        case "DROP_SHADOW":
        case "INNER_SHADOW":
          return [
            {
              type: effect.type,
              color: toHex(effect.color),
              opacity: effect.color.a,
              offset: effect.offset,
              radius: effect.radius,
              spread: effect.spread,
              blendMode: effect.blendMode,
            },
          ];
        case "LAYER_BLUR":
        case "BACKGROUND_BLUR":
          return [{ type: effect.type, radius: effect.radius }];
        default:
          return [];
      }
    });

const serializeLineHeight = (lineHeight: LineHeight | symbol) => {
  if (isMixed(lineHeight)) return "mixed";
  if ("value" in lineHeight) {
    return { value: lineHeight.value, unit: lineHeight.unit };
  }
  return { unit: lineHeight.unit };
};

const serializeLetterSpacing = (letterSpacing: LetterSpacing | symbol) => {
  if (isMixed(letterSpacing)) return "mixed";
  return { value: letterSpacing.value, unit: letterSpacing.unit };
};

const getBounds = (node: SerializableNode): SerializedBounds | undefined => {
  if ("x" in node && "y" in node && "width" in node && "height" in node) {
    return {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    };
  }
  return undefined;
};

const serializeText = (node: TextNode, base: SerializedNode) => {
  let fontFamily: string | undefined;
  let fontStyle: string | undefined;
  if (typeof node.fontName === "symbol") {
    fontFamily = "mixed";
    fontStyle = "mixed";
  } else if (node.fontName) {
    fontFamily = node.fontName.family;
    fontStyle = node.fontName.style;
  }
  return {
    ...base,
    characters: node.characters,
    styles: {
      ...base.styles,
      fontSize: isMixed(node.fontSize) ? "mixed" : node.fontSize,
      fontFamily,
      fontStyle,
      fontWeight: isMixed(node.fontWeight) ? "mixed" : node.fontWeight,
      textDecoration: isMixed(node.textDecoration) ? "mixed" : node.textDecoration,
      lineHeight: serializeLineHeight(node.lineHeight),
      letterSpacing: serializeLetterSpacing(node.letterSpacing),
      textAlignHorizontal: isMixed(node.textAlignHorizontal) ? "mixed" : node.textAlignHorizontal,
      textAlignVertical: isMixed(node.textAlignVertical) ? "mixed" : node.textAlignVertical,
      textAutoResize: node.textAutoResize,
    },
  };
};

const serializeStyles = (node: SerializableNode): SerializedStyles => {
  const styles: SerializedStyles = {};

  if ("opacity" in node) {
    styles.opacity = node.opacity as number;
  }
  if ("blendMode" in node) {
    styles.blendMode = node.blendMode as string;
  }
  if ("visible" in node) {
    styles.visible = node.visible;
  }

  if ("fills" in node) {
    styles.fills = serializePaints(node.fills);
  }
  if ("strokes" in node) {
    styles.strokes = serializePaints(node.strokes);
  }
  if ("strokeWeight" in node) {
    styles.strokeWeight = isMixed(node.strokeWeight) ? "mixed" : (node.strokeWeight as number);
  }
  if ("strokeAlign" in node) {
    styles.strokeAlign = node.strokeAlign as string;
  }
  if ("dashPattern" in node) {
    const pattern = node.dashPattern as readonly number[];
    if (pattern.length > 0) {
      styles.dashPattern = [...pattern];
    }
  }

  if ("effects" in node) {
    const effects = node.effects as readonly Effect[];
    if (effects.length > 0) {
      styles.effects = serializeEffects(effects);
    }
  }

  if ("cornerRadius" in node) {
    styles.cornerRadius = isMixed(node.cornerRadius) ? "mixed" : (node.cornerRadius as number);
  }
  if ("topLeftRadius" in node) {
    const tl = node.topLeftRadius as number;
    const tr = node.topRightRadius as number;
    const br = node.bottomRightRadius as number;
    const bl = node.bottomLeftRadius as number;
    if (tl !== tr || tr !== br || br !== bl) {
      styles.cornerRadii = {
        topLeft: tl,
        topRight: tr,
        bottomRight: br,
        bottomLeft: bl,
      };
    }
  }
  if ("cornerSmoothing" in node) {
    const smoothing = node.cornerSmoothing as number;
    if (smoothing > 0) {
      styles.cornerSmoothing = smoothing;
    }
  }

  if ("layoutMode" in node) {
    const mode = node.layoutMode as string;
    if (mode !== "NONE") {
      styles.autoLayout = {
        direction: mode as "HORIZONTAL" | "VERTICAL",
        gap: (node as FrameNode).itemSpacing,
        primaryAxisAlign: (node as FrameNode).primaryAxisAlignItems as string,
        counterAxisAlign: (node as FrameNode).counterAxisAlignItems as string,
        primaryAxisSizing: (node as FrameNode).primaryAxisSizingMode as string,
        counterAxisSizing: (node as FrameNode).counterAxisSizingMode as string,
        wrap: "layoutWrap" in node ? (node.layoutWrap as string) : undefined,
        counterAxisSpacing:
          "counterAxisSpacing" in node ? (node.counterAxisSpacing as number) : undefined,
      };
    }
  }

  if ("paddingLeft" in node) {
    const top = node.paddingTop as number;
    const right = node.paddingRight as number;
    const bottom = node.paddingBottom as number;
    const left = node.paddingLeft as number;
    if (top > 0 || right > 0 || bottom > 0 || left > 0) {
      styles.padding = { top, right, bottom, left };
    }
  }

  if ("clipsContent" in node) {
    styles.clipsContent = node.clipsContent as boolean;
  }
  if ("rotation" in node) {
    const rotation = node.rotation as number;
    if (rotation !== 0) {
      styles.rotation = rotation;
    }
  }
  if ("constraints" in node) {
    const c = node.constraints as Constraints;
    styles.constraints = { horizontal: c.horizontal, vertical: c.vertical };
  }

  return styles;
};

const isDefaultLineHeight = (value: unknown): boolean => isRecord(value) && value.unit === "AUTO";

const isDefaultLetterSpacing = (value: unknown): boolean => isRecord(value) && value.value === 0;

const isDefaultConstraints = (value: unknown): boolean =>
  isRecord(value) && value.horizontal === "MIN" && value.vertical === "MIN";

const isDefaultBlendMode = (type: string, value: unknown): boolean =>
  value === (CONTAINER_TYPES.has(type) ? "PASS_THROUGH" : "NORMAL");

type PruneContext = { type: string; hasStrokes: boolean };

const isDefaultStyleEntry = (key: string, value: unknown, context: PruneContext): boolean => {
  const { type, hasStrokes } = context;
  if (value === undefined) return true;
  if (Array.isArray(value))
    return value.length === 0 && !(key === "fills" && FILL_SENSITIVE_TYPES.has(type));
  if (DEFAULT_STYLE_VALUES[key]?.includes(value)) return true;
  switch (key) {
    case "blendMode":
      return isDefaultBlendMode(type, value);
    case "strokeWeight":
    case "strokeAlign":
      return !hasStrokes;
    case "constraints":
      return isDefaultConstraints(value);
    case "lineHeight":
      return isDefaultLineHeight(value);
    case "letterSpacing":
      return isDefaultLetterSpacing(value);
    default:
      return false;
  }
};

const pruneAutoLayout = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key, entry]) => {
      if (entry === undefined) return false;
      if (key === "counterAxisSpacing") return Boolean(entry);
      return !DEFAULT_AUTO_LAYOUT_VALUES[key]?.includes(entry);
    })
  );
};

const omitKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

const prunePaint = (paint: unknown): unknown =>
  isRecord(paint) && paint.opacity === 1 ? omitKeys(paint, ["opacity"]) : paint;

const pruneEffect = (effect: unknown): unknown => {
  if (!isRecord(effect)) return effect;
  const redundant = [
    ...(!effect.spread ? ["spread"] : []),
    ...(effect.blendMode === "NORMAL" ? ["blendMode"] : []),
  ];
  return omitKeys(effect, redundant);
};

const pruneStyleEntry = (key: string, value: unknown): unknown => {
  if (key === "autoLayout") return pruneAutoLayout(value);
  if (!Array.isArray(value)) return value;
  if (key === "fills" || key === "strokes") return value.map(prunePaint);
  if (key === "effects") return value.map(pruneEffect);
  return value;
};

const pruneDefaultStyles = (
  styles: Record<string, unknown>,
  type: string
): Record<string, unknown> => {
  const hasStrokes = Array.isArray(styles.strokes)
    ? styles.strokes.length > 0
    : "strokes" in styles;
  const context: PruneContext = { type, hasStrokes };
  return Object.fromEntries(
    Object.entries(styles)
      .filter(([key, value]) => !isDefaultStyleEntry(key, value, context))
      .map(([key, value]) => [key, pruneStyleEntry(key, value)])
  );
};

const compactNode = (node: SerializedNode): SerializedNode => {
  const { styles, ...rest } = roundNumbers(node);
  const pruned = styles ? pruneDefaultStyles(styles, node.type) : {};
  return Object.keys(pruned).length > 0 ? { ...rest, styles: pruned as SerializedStyles } : rest;
};

/**
 * `serializeNode` is also called with the current page (get_document,
 * get_design_context), which shares the id/name/type/children surface it reads.
 * Every property beyond that is read behind an `in` check.
 */
export type SerializableNode = SceneNode | PageNode;

const buildShallowNode = (node: SerializableNode): SerializedNode => {
  const base: SerializedNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    styles: serializeStyles(node),
  };

  // Handle Figma TEXT nodes and FigJam STICKY / SHAPE_WITH_TEXT nodes (which
  // expose their label through a `.text` sublayer).
  if (node.type === "TEXT") {
    return serializeText(node, base);
  }
  if ((node.type === "STICKY" || node.type === "SHAPE_WITH_TEXT") && "text" in node) {
    try {
      const textNode = node.text;
      return {
        ...base,
        characters: textNode.characters,
      };
    } catch {
      // text sub-node may not be accessible
    }
  }

  return base;
};

export const serializeNodeShallow = (node: SerializableNode, compact = false): SerializedNode => {
  const shallow = buildShallowNode(node);
  return compact ? compactNode(shallow) : shallow;
};

const readLabel = (node: SerializableNode): string | undefined => {
  if (node.type === "TEXT") return node.characters;
  if ((node.type === "STICKY" || node.type === "SHAPE_WITH_TEXT") && "text" in node) {
    try {
      return node.text.characters;
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const serializeNodeOutline = (node: SerializableNode): SerializedNode => {
  const label = readLabel(node);
  return roundNumbers({
    id: node.id,
    name: node.name,
    type: node.type,
    bounds: getBounds(node),
    ...(label === undefined ? {} : { characters: label.slice(0, OUTLINE_MAX_CHARACTERS) }),
  });
};

export type TreeShape = "verbose" | "compact" | "outline";

const serializeByShape = (node: SerializableNode, shape: TreeShape): SerializedNode =>
  shape === "outline"
    ? serializeNodeOutline(node)
    : serializeNodeShallow(node, shape === "compact");

type PendingNode = { source: SerializableNode; target: SerializedNode; level: number };

export type TruncationReason = "depth" | "maxNodes" | "maxBytes";

export type TreeTruncation = { reason: TruncationReason; omittedRoots: number };

export type TreeResult = { nodes: SerializedNode[]; truncation?: TreeTruncation };

type HaltReason = Exclude<TruncationReason, "depth">;

const TRUNCATION_PRECEDENCE: readonly TruncationReason[] = ["maxBytes", "maxNodes", "depth"];

const yieldToMainThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const isLiveAndVisible = (node: SceneNode): boolean => {
  try {
    return !node.removed && node.visible !== false;
  } catch {
    return false;
  }
};

const getVisibleChildren = (node: SerializableNode): readonly SceneNode[] =>
  "children" in node ? node.children.filter(isLiveAndVisible) : [];

const trySerializeShallow = (node: SerializableNode, shape: TreeShape): SerializedNode | null => {
  try {
    return node.removed ? null : serializeByShape(node, shape);
  } catch {
    return null;
  }
};

const measureBytes = (node: SerializedNode): number => JSON.stringify(node).length + 1;

type WalkState = {
  emitted: number;
  bytes: number;
  haltReason?: HaltReason;
  reasons: Set<TruncationReason>;
};

const findAffordableChildren = (
  children: readonly SceneNode[],
  shape: TreeShape,
  limits: TreeLimits,
  state: WalkState
): { included: SceneNode[]; serialized: SerializedNode[] } => {
  const included: SceneNode[] = [];
  const serialized: SerializedNode[] = [];
  for (const child of children) {
    if (!state.haltReason && state.emitted >= limits.maxNodes) state.haltReason = "maxNodes";
    if (state.haltReason) break;
    const target = trySerializeShallow(child, shape);
    if (!target) continue;
    const size = measureBytes(target);
    if (state.bytes + size > limits.maxBytes) {
      state.haltReason = "maxBytes";
      break;
    }
    included.push(child);
    serialized.push(target);
    state.emitted++;
    state.bytes += size;
  }
  return { included, serialized };
};

const expandNode = (
  { source, target, level }: PendingNode,
  shape: TreeShape,
  limits: TreeLimits,
  state: WalkState,
  queue: PendingNode[]
): void => {
  const children = getVisibleChildren(source);
  if (children.length === 0) {
    if (shape === "verbose" && "children" in source) target.children = [];
    return;
  }

  const canDescend = level < limits.depth;
  const { included, serialized } = canDescend
    ? findAffordableChildren(children, shape, limits, state)
    : { included: [], serialized: [] };
  if (included.length > 0) {
    const pending = included.map((child, index) => ({
      source: child,
      target: serialized[index],
      level: level + 1,
    }));
    target.children = serialized;
    state.bytes += CHILDREN_WRAPPER_BYTES;
    queue.push(...pending);
  }

  const isCut = !canDescend || state.haltReason !== undefined;
  if (isCut && included.length < children.length) {
    target.childCount = children.length;
    target.truncated = true;
    state.bytes += TRUNCATION_MARKER_BYTES;
    state.reasons.add(canDescend ? (state.haltReason ?? "maxNodes") : "depth");
  }
};

const summarizeTruncation = (
  state: WalkState,
  omittedRoots: number
): TreeTruncation | undefined => {
  const reason = TRUNCATION_PRECEDENCE.find((candidate) => state.reasons.has(candidate));
  return reason ? { reason, omittedRoots } : undefined;
};

const collectRoots = (
  roots: readonly SerializableNode[],
  shape: TreeShape,
  limits: TreeLimits,
  state: WalkState
): { queue: PendingNode[]; omittedRoots: number } => {
  const queue: PendingNode[] = [];
  let visitedRoots = 0;
  for (const source of roots) {
    if (queue.length >= limits.maxNodes) {
      state.haltReason = "maxNodes";
      break;
    }
    const target = trySerializeShallow(source, shape);
    if (target) {
      const size = measureBytes(target);
      if (queue.length > 0 && state.bytes + size > limits.maxBytes) {
        state.haltReason = "maxBytes";
        break;
      }
      queue.push({ source, target, level: 0 });
      state.bytes += size;
    }
    visitedRoots++;
  }
  state.emitted = queue.length;
  const omittedRoots = roots.length - visitedRoots;
  if (omittedRoots > 0 && state.haltReason) state.reasons.add(state.haltReason);
  return { queue, omittedRoots };
};

/**
 * Serializes `roots` breadth first so a cut-off trims the deepest levels
 * instead of whole sibling subtrees. The walk stops adding nodes at whichever
 * of `depth`, `maxNodes` or `maxBytes` (approximate serialized size) is hit
 * first. A node whose children were left out reports `childCount` and
 * `truncated: true`, and the result carries the reason that cut the tree.
 * Removed nodes are skipped, and a node that disappears while the walk is
 * suspended is dropped without failing the call.
 * Yields to the event loop every `YIELD_INTERVAL` nodes to keep Figma responsive.
 */
export const serializeTree = async (
  roots: readonly SerializableNode[],
  shape: TreeShape,
  limits: TreeLimits
): Promise<TreeResult> => {
  const state: WalkState = { emitted: 0, bytes: 0, reasons: new Set() };
  const { queue, omittedRoots } = collectRoots(roots, shape, limits, state);
  const nodes = queue.map((entry) => entry.target);

  for (let index = 0; index < queue.length; index++) {
    if (index > 0 && index % YIELD_INTERVAL === 0) await yieldToMainThread();
    try {
      expandNode(queue[index], shape, limits, state, queue);
    } catch {
      continue;
    }
  }

  const truncation = summarizeTruncation(state, omittedRoots);
  return truncation ? { nodes, truncation } : { nodes };
};
