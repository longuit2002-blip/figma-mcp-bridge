import { isRecord } from "./guards";

const PIXEL_DECIMALS = 2;
const UNIT_DECIMALS = 3;
const TRANSFORM_DECIMALS = 4;
const MIN_NONZERO_OPACITY = 0.001;
const UNIT_RANGE_KEYS: ReadonlySet<string> = new Set(["opacity", "position", "cornerSmoothing"]);
const TRANSFORM_KEYS: ReadonlySet<string> = new Set(["gradientTransform", "imageTransform"]);

const roundTo = (value: number, decimals: number): number => {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
};

const roundScalar = (value: number, key: string | undefined): number => {
  if (key === undefined) return roundTo(value, PIXEL_DECIMALS);
  if (key === "opacity") {
    const rounded = roundTo(value, UNIT_DECIMALS);
    return value > 0 && rounded === 0 ? MIN_NONZERO_OPACITY : rounded;
  }
  if (UNIT_RANGE_KEYS.has(key)) return roundTo(value, UNIT_DECIMALS);
  if (TRANSFORM_KEYS.has(key)) return roundTo(value, TRANSFORM_DECIMALS);
  return roundTo(value, PIXEL_DECIMALS);
};

export const roundNumbers = <T>(value: T, key?: string): T => {
  if (typeof value === "number") return roundScalar(value, key) as T;
  if (Array.isArray(value)) return value.map((entry) => roundNumbers(entry, key)) as T;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [entryKey, roundNumbers(entry, entryKey)])
    ) as T;
  }
  return value;
};
