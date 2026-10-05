import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DiagramService } from './diagram.service';

/**
 * Teste unitário: a regra de resolução de papel isolada do banco.
 * O Prisma e o UserService são substituídos por dublês em memória.
 */
describe('DiagramService (unitário)', () => {
  const OWNER_ID = 'owner';
  const diagram = {
    id: 'd1',
    userId: OWNER_ID,
    name: 'D',
    nodes: [],
    edges: [],
  };

  function build(collaborators: Record<string, 'EDITOR' | 'VIEWER'> = {}) {
    const prisma = {
      diagram: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(where.id === diagram.id ? diagram : null),
        ),
        update: jest.fn(({ data }) => Promise.resolve({ ...diagram, ...data })),
      },
      diagramCollaborator: {
        findUnique: jest.fn(({ where }) => {
          const role = collaborators[where.diagramId_userId.userId];
          return Promise.resolve(role ? { role } : null);
        }),
        upsert: jest.fn(({ create }) => Promise.resolve(create)),
      },
    };
    const userService = {
      findByEmail: jest.fn((email: string) =>
        Promise.resolve(email === 'existe@x.com' ? { id: 'u-existe' } : null),
      ),
    };

    return {
      service: new DiagramService(prisma as any, userService as any),
      prisma,
    };
  }

  describe('getAccessRole', () => {
    it('reconhece o dono sem consultar a tabela de colaboradores', async () => {
      const { service, prisma } = build();

      await expect(service.getAccessRole('d1', OWNER_ID)).resolves.toBe(
        'OWNER',
      );
      expect(prisma.diagramCollaborator.findUnique).not.toHaveBeenCalled();
    });

    it.each(['EDITOR', 'VIEWER'] as const)(
      'retorna o papel %s do colaborador',
      async (role) => {
        const { service } = build({ ana: role });

        await expect(service.getAccessRole('d1', 'ana')).resolves.toBe(role);
      },
    );

    it('retorna null para quem não tem vínculo', async () => {
      const { service } = build();

      await expect(service.getAccessRole('d1', 'estranho')).resolves.toBeNull();
    });

    it('retorna null para diagrama inexistente', async () => {
      const { service } = build();

      await expect(
        service.getAccessRole('nao-existe', OWNER_ID),
      ).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('normaliza posições e campos opcionais antes de gravar', async () => {
      const { service, prisma } = build();

      await service.update(
        'd1',
        {
          name: '  Novo nome  ',
          nodes: [
            {
              id: 'n',
              type: 'entityNode',
              data: {},
              position: { x: '5' as any, y: undefined as any },
            },
          ],
          edges: [{ id: 'e', source: 'a', target: 'b' }],
        },
        OWNER_ID,
      );

      expect(prisma.diagram.update).toHaveBeenCalledWith({
        where: { id: 'd1' },
        data: {
          name: 'Novo nome',
          nodes: {
            set: [
              {
                id: 'n',
                type: 'entityNode',
                data: {},
                position: { x: 5, y: 0 },
                style: null,
              },
            ],
          },
          edges: {
            set: [
              {
                id: 'e',
                source: 'a',
                sourceHandle: null,
                target: 'b',
                label: null,
                type: null,
                data: null,
              },
            ],
          },
        },
      });
    });

    it('bloqueia VIEWER sem tocar no banco', async () => {
      const { service, prisma } = build({ leitor: 'VIEWER' });

      await expect(
        service.update('d1', { name: 'x' }, 'leitor'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.diagram.update).not.toHaveBeenCalled();
    });

    it('lança NotFound para diagrama inexistente', async () => {
      const { service } = build();

      await expect(
        service.update('nao-existe', {}, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('addCollaborator', () => {
    it('usa EDITOR como papel padrão', async () => {
      const { service, prisma } = build();

      await service.addCollaborator('d1', OWNER_ID, { email: 'existe@x.com' });

      expect(prisma.diagramCollaborator.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { diagramId: 'd1', userId: 'u-existe', role: 'EDITOR' },
        }),
      );
    });

    it('só o dono pode convidar', async () => {
      const { service } = build({ ana: 'EDITOR' });

      await expect(
        service.addCollaborator('d1', 'ana', { email: 'existe@x.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
