import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DiagramService } from 'src/diagrams/diagram.service';
import { DiagramEvents } from 'src/diagrams/diagram-events';
import { OperationLog, SyncCursor } from './operation-log';

const LOG_IDLE_MS = 30 * 60 * 1000;
const LOG_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

type DiagramRole = 'OWNER' | 'EDITOR' | 'VIEWER';

type SocketData = {
  userId?: string;
  email?: string;
  diagramId?: string;
  role?: DiagramRole;
};

type CollabSocket = Socket & { data: SocketData };

@WebSocketGateway({
  cors: {
    origin: (process.env.FRONT_URL || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, '')),
    credentials: true,
  },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private diagramService: DiagramService,
    private events: DiagramEvents,
    private operationLog: OperationLog,
  ) {}

  afterInit(server: Server) {
    this.events.restored.subscribe((event) => {
      this.operationLog.reset(event.diagramId);
      server.to(this.room(event.diagramId)).emit('document_restored', event);
    });

    const pruneTimer = setInterval(() => {
      this.operationLog.prune(
        LOG_IDLE_MS,
        (diagramId) => this.socketsInRoom(diagramId).length > 0,
      );
    }, LOG_PRUNE_INTERVAL_MS);
    pruneTimer.unref();

    this.events.accessChanged.subscribe((event) => {
      for (const socket of this.socketsInRoom(event.diagramId)) {
        if (socket.data.userId !== event.userId) continue;

        if (event.role) {
          socket.data.role = event.role;
          socket.emit('role_changed', {
            diagramId: event.diagramId,
            role: event.role,
          });
        } else {
          this.evict(socket, event.diagramId, {
            diagramId: event.diagramId,
            reason: event.byUserId === event.userId ? 'left' : 'removed',
          });
        }
      }
    });

    this.events.deleted.subscribe((event) => {
      this.operationLog.drop(event.diagramId);
      for (const socket of this.socketsInRoom(event.diagramId)) {
        this.evict(socket, event.diagramId, {
          diagramId: event.diagramId,
          reason: 'deleted',
        });
      }
    });
  }

  async handleConnection(client: CollabSocket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new Error('Token ausente');
      }

      const payload = await this.jwtService.verifyAsync<{
        sub?: string;
        email?: string;
        type?: string;
      }>(token);

      if (payload.type !== 'access' || !payload.sub) {
        throw new Error('Token inválido');
      }

      client.data.userId = payload.sub;
      client.data.email = payload.email;
    } catch {
      client.emit('error', { message: 'Não autorizado' });
      client.disconnect();
    }
  }

  handleDisconnect(client: CollabSocket) {
    const { diagramId, userId } = client.data;

    if (diagramId && userId) {
      client.to(this.room(diagramId)).emit('presence', {
        type: 'USER_LEFT',
        userId,
      });
    }
  }

  @SubscribeMessage('join_diagram')
  async joinDiagram(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() data: { diagramId?: string; since?: SyncCursor },
  ) {
    const { userId, email } = client.data;
    const diagramId = data?.diagramId;

    if (!userId || !diagramId) return;

    const role = await this.diagramService.getAccessRole(diagramId, userId);

    if (!role) {
      client.emit('error', { message: 'Sem acesso a este diagrama' });
      return;
    }

    client.data.diagramId = diagramId;
    client.data.role = role;

    await client.join(this.room(diagramId));

    client.emit('sync', this.operationLog.since(diagramId, data?.since));

    client.to(this.room(diagramId)).emit('presence', {
      type: 'USER_JOINED',
      userId,
      email,
    });

    client.emit('presence', {
      type: 'ONLINE_USERS',
      users: this.usersInRoom(diagramId).filter((u) => u.userId !== userId),
    });
  }

  @SubscribeMessage('operation')
  handleOperation(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() operation: Record<string, unknown>,
  ) {
    const { diagramId, role } = client.data;

    if (!diagramId) return;

    if (role === 'VIEWER') {
      client.emit('error', { message: 'Sem permissão para editar' });
      return;
    }

    const meta = this.operationLog.append(diagramId, operation);

    client.to(this.room(diagramId)).emit('operation', operation, meta);

    return meta;
  }

  @SubscribeMessage('cursor')
  handleCursor(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() cursor: { x?: unknown; y?: unknown },
  ) {
    const { diagramId, userId } = client.data;

    if (!diagramId || !userId) return;

    const x = cursor?.x;
    const y = cursor?.y;

    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return;
    }

    client.to(this.room(diagramId)).emit('cursor', { userId, x, y });
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;

    if (authToken) return authToken;

    const header = client.handshake.headers.authorization;

    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }

  private socketsInRoom(diagramId: string): CollabSocket[] {
    const room = this.server?.sockets.adapter.rooms.get(this.room(diagramId));

    if (!room) return [];

    return [...room]
      .map((socketId) => this.server.sockets.sockets.get(socketId))
      .filter((socket): socket is CollabSocket => Boolean(socket));
  }

  private evict(
    socket: CollabSocket,
    diagramId: string,
    payload: { diagramId: string; reason: 'left' | 'removed' | 'deleted' },
  ) {
    const { userId } = socket.data;

    socket.data.diagramId = undefined;
    socket.data.role = undefined;
    void socket.leave(this.room(diagramId));
    socket.emit('access_revoked', payload);

    if (userId) {
      this.server.to(this.room(diagramId)).emit('presence', {
        type: 'USER_LEFT',
        userId,
      });
    }
  }

  private usersInRoom(diagramId: string): { userId: string; email?: string }[] {
    return this.socketsInRoom(diagramId)
      .map((socket) => socket.data)
      .filter((data): data is SocketData => Boolean(data?.userId))
      .map((data) => ({ userId: data.userId as string, email: data.email }));
  }

  private room(diagramId: string) {
    return `diagram:${diagramId}`;
  }
}
