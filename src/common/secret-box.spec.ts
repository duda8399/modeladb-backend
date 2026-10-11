import { decryptSecret, encryptSecret, isEncrypted } from './secret-box';

describe('secret-box', () => {
  const previous = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
  });

  afterAll(() => {
    process.env.JWT_SECRET = previous;
  });

  it('cifra e decifra o mesmo valor', () => {
    const encrypted = encryptSecret('sk-abc123');

    expect(isEncrypted(encrypted)).toBe(true);
    expect(encrypted).not.toContain('sk-abc123');
    expect(decryptSecret(encrypted)).toBe('sk-abc123');
  });

  it('gera um texto cifrado diferente a cada chamada', () => {
    expect(encryptSecret('sk-x')).not.toBe(encryptSecret('sk-x'));
  });

  it('devolve valores legados em texto puro sem alteração', () => {
    expect(decryptSecret('sk-legado')).toBe('sk-legado');
  });

  it('devolve null quando o conteúdo cifrado foi adulterado', () => {
    const encrypted = encryptSecret('sk-abc123');
    const tampered = encrypted.slice(0, -4) + 'AAAA';

    expect(decryptSecret(tampered)).toBeNull();
  });

  it('devolve null quando a chave mudou', () => {
    const encrypted = encryptSecret('sk-abc123');
    process.env.JWT_SECRET = 'outro-segredo';

    expect(decryptSecret(encrypted)).toBeNull();
    process.env.JWT_SECRET = 'segredo-de-teste';
  });
});
