import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export type DiagramRestoredEvent = {
  diagramId: string;
  versionId: string;
  userId: string;
  userName: string | null;
};

@Injectable()
export class DiagramEvents {
  readonly restored = new Subject<DiagramRestoredEvent>();
}
