import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramDto } from './dto/diagram.dto';
import { UserService } from 'src/users/user.service';
import { UpdateDiagramDto } from './dto/update-diagram.dto';

@Injectable()
export class DiagramService {
  constructor(
    private prisma: PrismaService,
    private userService: UserService
  ) {}

  async create(dto: DiagramDto, userId: string) {
    const user = await this.userService.findById(userId);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return this.prisma.diagram.create({
      data: { name: dto.name, userId: user.id },
    });
  }

  async update(id: string, dto: UpdateDiagramDto, userId: string) {
    const diagram = await this.findById(id);

    if (!diagram) {
      throw new NotFoundException('Diagrama nao encontrado.');
    }

    if (diagram.userId !== userId) {
      throw new ForbiddenException('Sem permissão para editar este diagrama.');
    }

    const data: Record<string, unknown> = {};

    if (typeof dto.name === 'string' && dto.name.trim()) {
      data.name = dto.name.trim();
    }

    if (dto.nodes) {
      data.nodes = {
        set: dto.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          data: node.data,
          position: {
            x: Number(node.position?.x ?? 0),
            y: Number(node.position?.y ?? 0),
          },
          style: node.style ?? null,
        })),
      };
    }

    if (dto.edges) {
      data.edges = {
        set: dto.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? null,
          target: edge.target,
          label: edge.label ?? null,
          type: edge.type ?? null,
          data: edge.data ?? null,
        })),
      };
    }

    return this.prisma.diagram.update({
      where: { id },
      data,
    });
  }

  async updateThumbnail(id: string, file: Express.Multer.File, userId: string) {
    const diagram = await this.findById(id);

    if (!diagram) {
      throw new NotFoundException('Diagrama nao encontrado.');
    }

    if (diagram.userId !== userId) {
      throw new ForbiddenException('Sem permissão para editar este diagrama.');
    }

    const baseUrl = process.env.APP_URL || 'http://localhost:3001';
    const thumbnail = `${baseUrl}/storage/diagrams/${file.filename}`;

    return this.prisma.diagram.update({
      where: { id },
      data: { thumbnail },
    });
  }

  async findById(id: string) {
    return this.prisma.diagram.findUnique({
      where: { id },
    });
  }

  async getAccessRole(
    diagramId: string,
    userId: string,
  ): Promise<'OWNER' | 'EDITOR' | 'VIEWER' | null> {
    const diagram = await this.findById(diagramId);

    if (!diagram) return null;

    if (diagram.userId === userId) return 'OWNER';

    const collaborator = await this.prisma.diagramCollaborator.findUnique({
      where: { diagramId_userId: { diagramId, userId } },
    });

    return collaborator?.role ?? null;
  }

  async findByUserId(userId: string) {
    return this.prisma.diagram.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findRecentByUserId(userId: string) {
    return this.prisma.diagram.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 8,
    });
  }

  async deleteByIdForUser(id: string, userId: string) {
    const diagram = await this.findById(id);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    if (diagram.userId !== userId) {
      throw new ForbiddenException('Sem permissão para remover este diagrama.');
    }

    await this.prisma.diagram.delete({
      where: { id },
    });

    return {
      message: 'Diagrama removido com sucesso.',
    };
  }
}
