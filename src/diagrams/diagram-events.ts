import { Injectable } from '@nestjs/common';
import { DiagramRole } from '@prisma/client';
import { Subject } from 'rxjs';

export type DiagramRestoredEvent = {
  diagramId: string;
  versionId: string;
  userId: string;
  userName: string | null;
};

export type DiagramAccessChangedEvent = {
  diagramId: string;
  userId: string;
  role: DiagramRole | null;
  byUserId: string;
};

export type DiagramDeletedEvent = {
  diagramId: string;
  byUserId: string;
};

@Injectable()
export class DiagramEvents {
  readonly restored = new Subject<DiagramRestoredEvent>();
  readonly accessChanged = new Subject<DiagramAccessChangedEvent>();
  readonly deleted = new Subject<DiagramDeletedEvent>();
}
