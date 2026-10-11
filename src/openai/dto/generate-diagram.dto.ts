import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class GenerateDiagramDto {
  @IsString({ message: 'A descrição não pode estar vazia' })
  @MaxLength(8000)
  description: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  diagramName?: string;

  @IsOptional()
  @IsArray()
  nodes?: Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  edges?: Record<string, unknown>[];
}
