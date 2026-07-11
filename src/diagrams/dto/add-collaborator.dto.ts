import { DiagramRole } from '@prisma/client';

export class AddCollaboratorDto {
  email: string;
  role?: DiagramRole;
}
