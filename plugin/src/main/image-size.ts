export type ImageSize = { width: number; height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
const PNG_HEADER_BYTES = 24;
const JPEG_SOI = [0xff, 0xd8];
const JPEG_STANDALONE_MARKERS = new Set([0x01, 0xd8, 0xd9]);
const JPEG_NON_FRAME_MARKERS = new Set([0xc4, 0xc8, 0xcc]);

const readUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] << 8) | bytes[offset + 1];

const readUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((value, index) => bytes[index] === value);

const isJpegFrameMarker = (marker: number): boolean =>
  marker >= 0xc0 && marker <= 0xcf && !JPEG_NON_FRAME_MARKERS.has(marker);

const readPngSize = (bytes: Uint8Array): ImageSize | null =>
  bytes.length >= PNG_HEADER_BYTES
    ? { width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
    : null;

const readJpegSize = (bytes: Uint8Array): ImageSize | null => {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (JPEG_STANDALONE_MARKERS.has(marker) || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (isJpegFrameMarker(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { height: readUint16(bytes, offset + 5), width: readUint16(bytes, offset + 7) };
    }
    offset += 2 + readUint16(bytes, offset + 2);
  }
  return null;
};

export const readImageSize = (bytes: Uint8Array): ImageSize | null => {
  if (startsWith(bytes, PNG_SIGNATURE)) return readPngSize(bytes);
  if (startsWith(bytes, JPEG_SOI)) return readJpegSize(bytes);
  return null;
};
