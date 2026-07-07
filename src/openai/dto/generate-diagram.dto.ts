export class GenerateDiagramDto {
  description: string;
  diagramName?: string;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
}
