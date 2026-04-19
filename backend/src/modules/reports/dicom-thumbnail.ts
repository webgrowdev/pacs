/**
 * DICOM thumbnail extractor — Sección 6
 *
 * Extracts a representative thumbnail from a DICOM file.
 * Supports:
 *   - JPEG Baseline (TS 1.2.840.10008.1.2.4.50) — extracted directly
 *   - JPEG Extended (TS 1.2.840.10008.1.2.4.51) — extracted directly
 *   - Uncompressed (Explicit/Implicit VR Little Endian) — converted to PNG
 *   - Unknown / unsupported — returns null
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import dicomParser from 'dicom-parser';
import { resolveStoragePath } from '../../storage/file-storage.js';

/** Transfer syntax UIDs for JPEG-compressed pixel data */
const JPEG_BASELINE_TS  = '1.2.840.10008.1.2.4.50';
const JPEG_EXTENDED_TS  = '1.2.840.10008.1.2.4.51';

/** Max thumbnail dimension (px) used when resizing raw pixel data */
const MAX_THUMB_SIZE = 200;

/**
 * Returns a Buffer containing JPEG or PNG image data for the first frame
 * of a DICOM file, or null if extraction is not possible.
 *
 * @param dicomFilePath - Absolute path to the .dcm file
 */
export async function extractDicomThumbnail(dicomFilePath: string): Promise<Buffer | null> {
  try {
    if (!fs.existsSync(dicomFilePath)) return null;
    const raw = fs.readFileSync(dicomFilePath);
    const byteArray = raw as unknown as Uint8Array;
    const ds = dicomParser.parseDicom(byteArray);

    // Determine transfer syntax from file meta information
    const transferSyntax = ds.string('x00020010') ?? '';

    const pixelElement = ds.elements['x7fe00010'];
    if (!pixelElement) return null;

    // ── JPEG-compressed (encapsulated) ─────────────────────────────────────
    if (
      transferSyntax === JPEG_BASELINE_TS ||
      transferSyntax === JPEG_EXTENDED_TS
    ) {
      if (pixelElement.encapsulatedPixelData && pixelElement.fragments?.length) {
        const frag = pixelElement.fragments[0];
        // dicom-parser Fragment has: offset (absolute), position, length
        // `position` is the byte offset of the fragment data in the byteArray
        const jpegBytes = raw.slice(frag.position, frag.position + frag.length);
        if (jpegBytes.length > 2) return jpegBytes;
      }
    }

    // ── Uncompressed raw pixel data ─────────────────────────────────────────
    const cols        = ds.uint16('x00280011') ?? 0;
    const rows        = ds.uint16('x00280010') ?? 0;
    const bitsAlloc   = ds.uint16('x00280100') ?? 8;
    const samples     = ds.uint16('x00280002') ?? 1;

    if (cols === 0 || rows === 0) return null;

    // Only handle grayscale (1 sample per pixel)
    if (samples !== 1) return null;

    const bytesPer = bitsAlloc <= 8 ? 1 : 2;
    const expectedBytes = cols * rows * bytesPer;
    if (pixelElement.length < expectedBytes) return null;

    // Build 8-bit grayscale pixel array, downsampling to MAX_THUMB_SIZE
    const scale = Math.min(1, MAX_THUMB_SIZE / Math.max(cols, rows));
    const thumbW = Math.round(cols * scale);
    const thumbH = Math.round(rows * scale);

    const pixels8 = new Uint8Array(thumbW * thumbH);

    // Compute window center/width from full pixel range
    let minVal = Infinity, maxVal = -Infinity;
    const dataOffset = pixelElement.dataOffset;
    for (let i = 0; i < cols * rows; i++) {
      let v: number;
      if (bytesPer === 1) {
        v = raw[dataOffset + i];
      } else {
        v = raw.readUInt16LE(dataOffset + i * 2);
      }
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
    const range = maxVal - minVal || 1;

    for (let ty = 0; ty < thumbH; ty++) {
      for (let tx = 0; tx < thumbW; tx++) {
        const srcX = Math.round(tx / scale);
        const srcY = Math.round(ty / scale);
        const srcIdx = srcY * cols + srcX;
        let v: number;
        if (bytesPer === 1) {
          v = raw[dataOffset + srcIdx];
        } else {
          v = raw.readUInt16LE(dataOffset + srcIdx * 2);
        }
        pixels8[ty * thumbW + tx] = Math.round(((v - minVal) / range) * 255);
      }
    }

    return buildGrayscalePng(thumbW, thumbH, pixels8);
  } catch {
    return null;
  }
}

/**
 * Resolves a storage-relative DicomFile path to an absolute filesystem path.
 */
export function resolveAbsoluteDicomPath(filePath: string): string {
  return resolveStoragePath(filePath);
}

// ─── Pure-JS grayscale PNG builder ───────────────────────────────────────────

function buildGrayscalePng(width: number, height: number, pixels: Uint8Array): Buffer {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit depth=8, color type=0 (grayscale)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width,  0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8]  = 8;   // bit depth
  ihdrData[9]  = 0;   // color type: grayscale
  ihdrData[10] = 0;   // compression
  ihdrData[11] = 0;   // filter
  ihdrData[12] = 0;   // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw image data: 1 filter byte (0 = None) + row bytes
  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      raw[y * (1 + width) + 1 + x] = pixels[y * width + x];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 1 });
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([typeBytes, data]);
  const crcVal = crc32(crcBuf);
  const crcOut = Buffer.alloc(4);
  crcOut.writeInt32BE(crcVal, 0);
  return Buffer.concat([length, typeBytes, data, crcOut]);
}

/** CRC-32 as required by the PNG spec */
function crc32(buf: Buffer): number {
  const table = makeCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) | 0;
}

let crcTableCache: Int32Array | null = null;
function makeCrcTable(): Int32Array {
  if (crcTableCache) return crcTableCache;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[n] = c;
  }
  crcTableCache = t;
  return t;
}
