import { Injectable, NotFoundException } from '@nestjs/common';
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

  async create(dto: DiagramDto) {
    const user = await this.userService.findById(dto.userId);

    if (!user) {
      throw new NotFoundException('Usuário não encontrado.');
    }

    return this.prisma.diagram.create({
      data: { name: dto.name, userId: user.id },
    });
  }

  async update(id: string, dto: UpdateDiagramDto) {
    const diagram = await this.findById(id);

    if (!diagram) {
      throw new NotFoundException('Diagrama nao encontrado.');
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
        })),
      };
    }

    return this.prisma.diagram.update({
      where: { id },
      data,
    });
  }

  async findById(id: string) {
    return this.prisma.diagram.findUnique({
      where: { id },
    });
  }
}
