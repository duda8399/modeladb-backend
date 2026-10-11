export class AnalyzeDiagramDto {
  diagramName?: string;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
  focus?: string;
}
