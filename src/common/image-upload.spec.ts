import { BadRequestException } from '@nestjs/common';
import { detectImage, sanitizeImage } from './image-upload';

const file = (buffer: Buffer, originalname = 'x.png', mimetype = 'image/png') =>
  ({ buffer, originalname, mimetype }) as Express.Multer.File;

describe('image-upload', () => {
  it.each([
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
    ['jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['gif', Buffer.from('GIF89a....')],
    ['webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
  ])('reconhece %s pela assinatura', (ext, buffer) => {
    expect(detectImage(buffer)?.ext).toBe(ext);
  });

  it('não confia na extensão nem no mimetype enviados', () => {
    expect(() =>
      sanitizeImage(
        file(Buffer.from('<svg onload=alert(1)>'), 'a.png'),
        'avatar',
      ),
    ).toThrow(BadRequestException);
  });

  it('renomeia o arquivo com a extensão detectada', () => {
    const result = sanitizeImage(
      file(
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        '../../evil.html',
        'text/html',
      ),
      'avatar',
    );

    expect(result.originalname).toBe('avatar.jpg');
    expect(result.mimetype).toBe('image/jpeg');
  });
});
