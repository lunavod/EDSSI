/**
 * Just enough of a zip reader for a mod download: stored and deflated entries, no zip64, no
 * encryption. Everything is read from the central directory, so data descriptors don't matter.
 */

import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  /** The path inside the archive, with forward slashes. Directories end in `/`. */
  name: string;
  data: Buffer;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

export function readZip(zip: Buffer): ZipEntry[] {
  const end = findEndOfCentralDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('Broken zip directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength).replaceAll('\\', '/');
    offset += 46 + nameLength + extraLength + commentLength;

    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error(`Broken zip: ${name}`);
    const start =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(start, start + compressedSize);

    if (method === 0) entries.push({ name, data: Buffer.from(raw) });
    else if (method === 8) entries.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`Unsupported zip compression ${method}: ${name}`);
  }
  return entries;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  // The record is 22 bytes, followed by a comment of at most 65535.
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  throw new Error('Not a zip file');
}
