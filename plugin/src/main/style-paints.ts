import { roundNumbers, toHex } from "./serializer";

type BoundVariableIds = Record<string, string | string[]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readAliasId = (alias: unknown): string | undefined =>
  isRecord(alias) && typeof alias.id === "string" ? alias.id : undefined;

const toBoundVariableIds = (bound: unknown): BoundVariableIds | undefined => {
  if (!isRecord(bound)) return undefined;
  const entries = Object.entries(bound).flatMap(([key, alias]): [string, string | string[]][] => {
    if (Array.isArray(alias)) {
      const ids = alias.map(readAliasId).filter((id): id is string => id !== undefined);
      return ids.length > 0 ? [[key, ids]] : [];
    }
    const id = readAliasId(alias);
    return id === undefined ? [] : [[key, id]];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const serializeStops = (stops: readonly ColorStop[]) =>
  stops.map((stop) => {
    const boundVariables = toBoundVariableIds(stop.boundVariables);
    return {
      color: toHex(stop.color),
      opacity: stop.color.a,
      position: stop.position,
      ...(boundVariables ? { boundVariables } : {}),
    };
  });

const serializeCommon = (paint: Paint) => {
  const boundVariables = toBoundVariableIds(
    "boundVariables" in paint ? paint.boundVariables : undefined
  );
  return {
    ...(paint.visible === false ? { visible: false } : {}),
    ...(paint.blendMode && paint.blendMode !== "NORMAL" ? { blendMode: paint.blendMode } : {}),
    ...(boundVariables ? { boundVariables } : {}),
  };
};

const serializeStylePaint = (paint: Paint): Record<string, unknown> => {
  const common = serializeCommon(paint);
  switch (paint.type) {
    case "SOLID":
      return { type: paint.type, color: toHex(paint.color), opacity: paint.opacity, ...common };
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return {
        type: paint.type,
        gradientStops: serializeStops(paint.gradientStops),
        gradientTransform: paint.gradientTransform,
        opacity: paint.opacity,
        ...common,
      };
    case "IMAGE":
      return {
        type: paint.type,
        scaleMode: paint.scaleMode,
        imageHash: paint.imageHash,
        imageTransform: paint.imageTransform,
        opacity: paint.opacity,
        ...common,
      };
    default:
      return { type: (paint as Paint).type, ...common };
  }
};

const dropFullOpacity = (paint: Record<string, unknown>): Record<string, unknown> =>
  paint.opacity === undefined || paint.opacity === 1
    ? Object.fromEntries(Object.entries(paint).filter(([key]) => key !== "opacity"))
    : paint;

export const serializeStylePaints = (paints: readonly Paint[], compact: boolean): unknown =>
  compact
    ? paints.map((paint) => dropFullOpacity(roundNumbers(serializeStylePaint(paint))))
    : paints;
