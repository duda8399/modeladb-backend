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
  data?: Record<string, unknown>;
};

export class UpdateDiagramDto {
  name?: string;
  nodes?: NodeDto[];
  edges?: EdgeDto[];
  thumbnail?: string;
}
