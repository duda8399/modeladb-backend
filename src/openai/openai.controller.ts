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

      return await this.openAIService.generateDiagram(userId, dto.description);
    } catch (error) {
      throw new HttpException(
        error?.message || 'Não foi possível gerar o diagrama',
        error?.status || HttpStatus.BAD_REQUEST,
      );
    }
  }
}
