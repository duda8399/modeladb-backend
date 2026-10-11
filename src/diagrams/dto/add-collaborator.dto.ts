import { DiagramRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';

export class AddCollaboratorDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;

  @IsOptional()
  @IsEnum(DiagramRole, { message: 'Permissão inválida.' })
  role?: DiagramRole;
}
