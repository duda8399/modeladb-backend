import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: Number(process.env.MAIL_PORT),
      secure: false,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const resetLink = `${process.env.FRONT_URL}/reset-password?token=${token}`;
    
    try {
      const response = await this.transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: 'Recuperação de senha',
        html: `
          <p>Olá 👋</p>
          <p>Você solicitou a recuperação de senha.</p>
          <p>Clique no link abaixo para criar uma nova senha:</p>
          <p>
            <a href="${resetLink}">
              Redefinir senha
            </a>
          </p>
          <p>Este link expira em 15 minutos.</p>
          <p>Se você não solicitou, ignore este e-mail.</p>
        `,
      });
      console.log('response', response);
    } catch (error) {
      console.error(error);
      throw new InternalServerErrorException(
        'Erro ao enviar e-mail de recuperação',
      );
    }
  }
}
