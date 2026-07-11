import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Diagram, DiagramRole } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramDto } from './dto/diagram.dto';
import { UserService } from 'src/users/user.service';
import { UpdateDiagramDto } from './dto/update-diagram.dto';
import { AddCollaboratorDto } from './dto/add-collaborator.dto';
import { UpdateCollaboratorRoleDto } from './dto/update-collaborator-role.dto';

type AccessRole = 'OWNER' | DiagramRole;

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

    const role = await this.resolveRole(diagram, userId);

    if (role !== 'OWNER' && role !== DiagramRole.EDITOR) {
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

    const role = await this.resolveRole(diagram, userId);

    if (role !== 'OWNER' && role !== DiagramRole.EDITOR) {
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

  async findByIdForUser(id: string, userId: string) {
    const diagram = await this.findById(id);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    const role = await this.resolveRole(diagram, userId);

    if (!role) {
      throw new ForbiddenException('Sem acesso a este diagrama.');
    }

    return diagram;
  }

  async getAccessRole(
    diagramId: string,
    userId: string,
  ): Promise<AccessRole | null> {
    const diagram = await this.findById(diagramId);

    if (!diagram) return null;

    return this.resolveRole(diagram, userId);
  }

  private async resolveRole(
    diagram: Diagram,
    userId: string,
  ): Promise<AccessRole | null> {
    if (diagram.userId === userId) return 'OWNER';

    const collaborator = await this.prisma.diagramCollaborator.findUnique({
      where: { diagramId_userId: { diagramId: diagram.id, userId } },
    });

    return collaborator?.role ?? null;
  }

  async addCollaborator(
    diagramId: string,
    requesterId: string,
    dto: AddCollaboratorDto,
  ) {
    const diagram = await this.findById(diagramId);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    if (diagram.userId !== requesterId) {
      throw new ForbiddenException(
        'Apenas o dono pode compartilhar este diagrama.',
      );
    }

    const user = await this.userService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    if (user.id === diagram.userId) {
      throw new ForbiddenException('O dono já tem acesso total ao diagrama.');
    }

    return this.prisma.diagramCollaborator.upsert({
      where: { diagramId_userId: { diagramId, userId: user.id } },
      update: { role: dto.role ?? DiagramRole.EDITOR },
      create: {
        diagramId,
        userId: user.id,
        role: dto.role ?? DiagramRole.EDITOR,
      },
    });
  }

  async listCollaborators(diagramId: string, requesterId: string) {
    const diagram = await this.findById(diagramId);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    const role = await this.resolveRole(diagram, requesterId);

    if (!role) {
      throw new ForbiddenException('Sem acesso a este diagrama.');
    }

    return this.prisma.diagramCollaborator.findMany({
      where: { diagramId },
      include: {
        user: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });
  }

  async updateCollaboratorRole(
    diagramId: string,
    requesterId: string,
    targetUserId: string,
    dto: UpdateCollaboratorRoleDto,
  ) {
    const diagram = await this.findById(diagramId);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    if (diagram.userId !== requesterId) {
      throw new ForbiddenException('Apenas o dono pode alterar permissões.');
    }

    try {
      return await this.prisma.diagramCollaborator.update({
        where: { diagramId_userId: { diagramId, userId: targetUserId } },
        data: { role: dto.role },
      });
    } catch {
      throw new NotFoundException('Colaborador não encontrado.');
    }
  }

  async removeCollaborator(
    diagramId: string,
    requesterId: string,
    targetUserId: string,
  ) {
    const diagram = await this.findById(diagramId);

    if (!diagram) {
      throw new NotFoundException('Diagrama não encontrado.');
    }

    const isOwner = diagram.userId === requesterId;
    const isSelf = requesterId === targetUserId;

    if (!isOwner && !isSelf) {
      throw new ForbiddenException(
        'Sem permissão para remover este colaborador.',
      );
    }

    try {
      await this.prisma.diagramCollaborator.delete({
        where: { diagramId_userId: { diagramId, userId: targetUserId } },
      });
    } catch {
      throw new NotFoundException('Colaborador não encontrado.');
    }

    return { message: 'Colaborador removido com sucesso.' };
  }

  async findSharedWithUser(userId: string) {
    return this.prisma.diagram.findMany({
      where: { collaborators: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
    });
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
