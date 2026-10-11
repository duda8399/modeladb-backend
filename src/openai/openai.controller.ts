import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OpenAIService } from './openai.service';
import { GenerateDiagramDto } from './dto/generate-diagram.dto';
import { AnalyzeDiagramDto } from './dto/analyze-diagram.dto';

@Controller('openai')
export class OpenAIController {
  constructor(private openAIService: OpenAIService) {}

  @UseGuards(JwtAuthGuard)
  @Post('generate-diagram')
  async generateDiagram(
    @Body() dto: GenerateDiagramDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    try {
      const userId = req.user?.sub;

      if (!userId) {
        throw new UnauthorizedException('Usuário não autenticado');
      }

      return await this.openAIService.generateDiagram(userId, dto.description, {
        diagramName: dto.diagramName,
        nodes: dto.nodes,
        edges: dto.edges,
      });
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível gerar o diagrama',
        error?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('analyze-diagram')
  async analyzeDiagram(
    @Body() dto: AnalyzeDiagramDto,
    @Request() req: { user?: { sub?: string } },
  ) {
    const userId = req.user?.sub;

    if (!userId) {
      throw new UnauthorizedException('Usuário não autenticado');
    }

    try {
      return await this.openAIService.analyzeDiagram(userId, {
        diagramName: dto?.diagramName,
        nodes: Array.isArray(dto?.nodes) ? dto.nodes : [],
        edges: Array.isArray(dto?.edges) ? dto.edges : [],
        focus: typeof dto?.focus === 'string' ? dto.focus : undefined,
      });
    } catch (error) {
      const status = (error as { status?: number })?.status;
      throw new HttpException(
        (error as Error)?.message || 'Não foi possível analisar o diagrama',
        status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
