import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

type PositionDto = {
  x: number;
  y: number;
};

type NodeDto = {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position: PositionDto;
  style?: Record<string, unknown> | null;
};

type EdgeDto = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  label?: string | null;
  type?: string | null;
  data?: Record<string, unknown>;
};

export class UpdateDiagramDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsArray()
  nodes?: NodeDto[];

  @IsOptional()
  @IsArray()
  edges?: EdgeDto[];
}
