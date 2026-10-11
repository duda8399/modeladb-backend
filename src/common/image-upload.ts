import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;

type ImageKind = { mime: string; ext: string };

const SIGNATURES: { kind: ImageKind; test: (b: Buffer) => boolean }[] = [
  {
    kind: { mime: 'image/png', ext: 'png' },
    test: (b) =>
      b.length >= 8 &&
      b
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    kind: { mime: 'image/jpeg', ext: 'jpg' },
    test: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    kind: { mime: 'image/gif', ext: 'gif' },
    test: (b) =>
      b.length >= 6 &&
      ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii')),
  },
  {
    kind: { mime: 'image/webp', ext: 'webp' },
    test: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function detectImage(buffer: Buffer | undefined): ImageKind | null {
  if (!buffer) return null;
  return SIGNATURES.find((s) => s.test(buffer))?.kind ?? null;
}

export function imageUploadOptions(maxBytes: number) {
  return {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  };
}

export function sanitizeImage(
  file: Express.Multer.File,
  baseName: string,
): Express.Multer.File {
  const kind = detectImage(file.buffer);

  if (!kind) {
    throw new BadRequestException(
      'Formato de imagem não suportado. Envie PNG, JPEG, GIF ou WebP.',
    );
  }

  return {
    ...file,
    mimetype: kind.mime,
    originalname: `${baseName}.${kind.ext}`,
  };
}
