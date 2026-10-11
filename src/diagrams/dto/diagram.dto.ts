import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class DiagramDto {
  @IsString()
  @IsNotEmpty({ message: 'Informe o nome do diagrama.' })
  @MaxLength(120)
  name: string;
}
