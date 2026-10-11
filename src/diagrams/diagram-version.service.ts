import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Diagram, DiagramRole, Prisma, VersionKind } from '@prisma/client';
import { PrismaService } from 'src/database/prisma.service';
import { DiagramService } from './diagram.service';
import { DiagramEvents } from './diagram-events';

const MAX_AUTO_VERSIONS = 50;
const MAX_LABEL_LENGTH = 120;

type Snapshot = Pick<Diagram, 'name' | 'nodes' | 'edges'>;

const summarySelect = {
  id: true,
  diagramId: true,
  name: true,
  label: true,
  kind: true,
  tableCount: true,
  viewCount: true,
  relationCount: true,
  createdById: true,
  createdByName: true,
  restoredFromId: true,
  createdAt: true,
} satisfies Prisma.DiagramVersionSelect;

function countRelations(edges: Diagram['edges']): number {
  const junctions = new Set<string>();
  let count = 0;
  for (const edge of edges) {
    const junctionId = (edge.data as { junctionId?: string } | null)
      ?.junctionId;
    if (!junctionId) count++;
    else if (!junctions.has(junctionId)) {
      junctions.add(junctionId);
      count++;
    }
  }
  return count;
}

function toNodeInputs(nodes: Diagram['nodes']): Prisma.NodeCreateInput[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.type,
    data: (node.data ?? {}) as Prisma.InputJsonValue,
    position: { x: node.position.x, y: node.position.y },
    ...(node.style === null || node.style === undefined
      ? {}
      : { style: node.style as Prisma.InputJsonValue }),
  }));
}

function toEdgeInputs(edges: Diagram['edges']): Prisma.EdgeCreateInput[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    label: edge.label,
    type: edge.type,
    ...(edge.data === null || edge.data === undefined
      ? {}
      : { data: edge.data as Prisma.InputJsonValue }),
  }));
}

function contentSignature(snapshot: Snapshot): string {
  return JSON.stringify([snapshot.name, snapshot.nodes, snapshot.edges]);
}

function normalizeLabel(label?: string | null): string | null {
  const trimmed = (label ?? '').trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed || null;
}

@Injectable()
export class DiagramVersionService {
  autoIntervalMs =
    Number(process.env.AUTO_VERSION_INTERVAL_MINUTES ?? 10) * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    private diagramService: DiagramService,
    private events: DiagramEvents,
  ) {}

  async recordAutoVersion(diagram: Diagram, userId: string) {
    const latest = await this.prisma.diagramVersion.findFirst({
      where: { diagramId: diagram.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (latest) {
      const elapsed = Date.now() - latest.createdAt.getTime();
      if (elapsed < this.autoIntervalMs) return null;
      if (contentSignature(latest) === contentSignature(diagram)) return null;
    }

    const version = await this.snapshot(
      diagram,
      userId,
      VersionKind.AUTO,
      null,
    );
    await this.pruneAutoVersions(diagram.id);
    return version;
  }

  async list(diagramId: string, userId: string) {
    await this.requireRole(diagramId, userId, 'VIEW');
    return this.prisma.diagramVersion.findMany({
      where: { diagramId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: summarySelect,
    });
  }

  async get(diagramId: string, versionId: string, userId: string) {
    await this.requireRole(diagramId, userId, 'VIEW');
    return this.findVersion(diagramId, versionId);
  }

  async create(diagramId: string, userId: string, label?: string) {
    const diagram = await this.requireRole(diagramId, userId, 'EDIT');
    const version = await this.snapshot(
      diagram,
      userId,
      VersionKind.MANUAL,
      normalizeLabel(label),
    );
    return this.summary(version.id);
  }

  async rename(
    diagramId: string,
    versionId: string,
    userId: string,
    label?: string | null,
  ) {
    await this.requireRole(diagramId, userId, 'EDIT');
    await this.findVersion(diagramId, versionId);
    await this.prisma.diagramVersion.update({
      where: { id: versionId },
      data: { label: normalizeLabel(label) },
    });
    return this.summary(versionId);
  }

  async remove(diagramId: string, versionId: string, userId: string) {
    await this.requireRole(diagramId, userId, 'OWNER');
    await this.findVersion(diagramId, versionId);
    await this.prisma.diagramVersion.delete({ where: { id: versionId } });
    return { message: 'Versão removida.' };
  }

  async restore(diagramId: string, versionId: string, userId: string) {
    const diagram = await this.requireRole(diagramId, userId, 'EDIT');
    const version = await this.findVersion(diagramId, versionId);

    await this.snapshot(diagram, userId, VersionKind.RESTORE, null, version.id);

    const restored = await this.prisma.diagram.update({
      where: { id: diagramId },
      data: {
        name: version.name,
        nodes: { set: toNodeInputs(version.nodes) },
        edges: { set: toEdgeInputs(version.edges) },
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    this.events.restored.next({
      diagramId,
      versionId,
      userId,
      userName: user?.name ?? null,
    });

    const role = await this.diagramService.getAccessRole(diagramId, userId);
    return { ...restored, currentUserRole: role };
  }

  private async snapshot(
    diagram: Diagram,
    userId: string,
    kind: VersionKind,
    label: string | null,
    restoredFromId: string | null = null,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return this.prisma.diagramVersion.create({
      data: {
        diagramId: diagram.id,
        name: diagram.name,
        label,
        kind,
        nodes: toNodeInputs(diagram.nodes),
        edges: toEdgeInputs(diagram.edges),
        tableCount: diagram.nodes.filter((n) => n.type === 'entityNode').length,
        viewCount: diagram.nodes.filter((n) => n.type === 'viewNode').length,
        relationCount: countRelations(diagram.edges),
        createdById: userId,
        createdByName: user?.name ?? null,
        restoredFromId,
      },
    });
  }

  private async pruneAutoVersions(diagramId: string) {
    const stale = await this.prisma.diagramVersion.findMany({
      where: { diagramId, kind: VersionKind.AUTO },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: MAX_AUTO_VERSIONS,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.diagramVersion.deleteMany({
        where: { id: { in: stale.map((v) => v.id) } },
      });
    }
  }

  private summary(versionId: string) {
    return this.prisma.diagramVersion.findUniqueOrThrow({
      where: { id: versionId },
      select: summarySelect,
    });
  }

  private async findVersion(diagramId: string, versionId: string) {
    const version = /^[0-9a-f]{24}$/i.test(versionId)
      ? await this.prisma.diagramVersion.findUnique({
          where: { id: versionId },
        })
      : null;
    if (!version || version.diagramId !== diagramId) {
      throw new NotFoundException('Versão não encontrada.');
    }
    return version;
  }

  private async requireRole(
    diagramId: string,
    userId: string,
    level: 'VIEW' | 'EDIT' | 'OWNER',
  ) {
    const diagram = /^[0-9a-f]{24}$/i.test(diagramId)
      ? await this.diagramService.findById(diagramId)
      : null;
    if (!diagram) throw new NotFoundException('Diagrama não encontrado.');

    const role = await this.diagramService.getAccessRole(diagramId, userId);
    const allowed =
      level === 'VIEW'
        ? !!role
        : level === 'EDIT'
          ? role === 'OWNER' || role === DiagramRole.EDITOR
          : role === 'OWNER';

    if (!allowed) {
      throw new ForbiddenException(
        level === 'VIEW'
          ? 'Sem acesso a este diagrama.'
          : level === 'EDIT'
            ? 'Sem permissão para alterar o histórico deste diagrama.'
            : 'Só o dono pode excluir versões.',
      );
    }
    return diagram;
  }
}
