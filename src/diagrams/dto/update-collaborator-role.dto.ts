import { DiagramRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateCollaboratorRoleDto {
  @IsEnum(DiagramRole, { message: 'Permissão inválida.' })
  role: DiagramRole;
}
