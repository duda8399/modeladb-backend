import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DiagramService } from 'src/diagrams/diagram.service';

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
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private diagramService: DiagramService,
  ) {}

  async handleConnection(client: CollabSocket) {
    try {
      const token = this.extractToken(client);

      if (!token) {
        throw new Error('Token ausente');
      }

      const payload = await this.jwtService.verifyAsync(token);

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
    @MessageBody() data: { diagramId?: string },
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

    client.to(this.room(diagramId)).emit('operation', operation);
  }

  @SubscribeMessage('cursor')
  handleCursor(
    @ConnectedSocket() client: CollabSocket,
    @MessageBody() cursor: { x: number; y: number },
  ) {
    const { diagramId, userId } = client.data;

    if (!diagramId) return;

    client.to(this.room(diagramId)).emit('cursor', { userId, ...cursor });
  }

  private extractToken(client: Socket): string | undefined {
    const authToken = client.handshake.auth?.token as string | undefined;

    if (authToken) return authToken;

    const header = client.handshake.headers.authorization;

    return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  }

  private usersInRoom(
    diagramId: string,
  ): { userId: string; email?: string }[] {
    const room = this.server.sockets.adapter.rooms.get(this.room(diagramId));

    if (!room) return [];

    return [...room]
      .map(
        (socketId) =>
          (this.server.sockets.sockets.get(socketId) as CollabSocket)?.data,
      )
      .filter((data): data is SocketData => Boolean(data?.userId))
      .map((data) => ({ userId: data.userId as string, email: data.email }));
  }

  private room(diagramId: string) {
    return `diagram:${diagramId}`;
  }
}
