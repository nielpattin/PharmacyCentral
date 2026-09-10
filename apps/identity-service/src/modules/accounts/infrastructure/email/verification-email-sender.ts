import { createTransport, type Transporter } from "nodemailer";
import { Resend } from "resend";

import type { VerificationEmailSender } from "../../application/account-service.ts";

export type VerificationEmailOptions = {
  from: string;
  verificationBaseUrl: string;
  resendApiKey?: string | undefined;
  smtpHost: string;
  smtpPort: number;
};

type EmailInput = { email: string; accountId: string; token: string };

export class ResendVerificationEmailSender implements VerificationEmailSender {
  private readonly client: Resend;

  public constructor(private readonly options: VerificationEmailOptions) {
    if (!options.resendApiKey) {
      throw new Error("RESEND_API_KEY is required for the Resend email provider");
    }
    this.client = new Resend(options.resendApiKey);
  }

  public async sendVerificationEmail(input: EmailInput): Promise<void> {
    await this.send(input.email, "Verify your Pharmacy Central account", this.createVerificationUrl(input));
  }

  public async sendPasswordResetEmail(input: EmailInput): Promise<void> {
    await this.send(input.email, "Reset your Pharmacy Central password", this.createPasswordResetUrl(input));
  }

  private async send(to: string, subject: string, url: string): Promise<void> {
    const result = await this.client.emails.send({
      from: this.options.from,
      to,
      subject,
      html: `<p><a href="${url}">${url}</a></p>`,
    });
    if (result.error) {
      throw new Error(`Email delivery failed: ${result.error.message}`);
    }
  }

  private createVerificationUrl(input: EmailInput): string {
    return `${this.options.verificationBaseUrl}/auth/verify-email?accountId=${encodeURIComponent(input.accountId)}&token=${encodeURIComponent(input.token)}`;
  }

  private createPasswordResetUrl(input: EmailInput): string {
    return `${this.options.verificationBaseUrl}/auth/reset-password?accountId=${encodeURIComponent(input.accountId)}&token=${encodeURIComponent(input.token)}`;
  }
}

export class SmtpVerificationEmailSender implements VerificationEmailSender {
  private readonly transporter: Transporter;

  public constructor(private readonly options: VerificationEmailOptions) {
    this.transporter = createTransport({ host: options.smtpHost, port: options.smtpPort, secure: false });
  }

  public async sendVerificationEmail(input: EmailInput): Promise<void> {
    await this.send(input.email, "Verify your Pharmacy Central account", this.createVerificationUrl(input));
  }

  public async sendPasswordResetEmail(input: EmailInput): Promise<void> {
    await this.send(input.email, "Reset your Pharmacy Central password", this.createPasswordResetUrl(input));
  }

  private async send(to: string, subject: string, url: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to,
      subject,
      text: url,
      html: `<p><a href="${url}">${url}</a></p>`,
    });
  }

  private createVerificationUrl(input: EmailInput): string {
    return `${this.options.verificationBaseUrl}/auth/verify-email?accountId=${encodeURIComponent(input.accountId)}&token=${encodeURIComponent(input.token)}`;
  }

  private createPasswordResetUrl(input: EmailInput): string {
    return `${this.options.verificationBaseUrl}/auth/reset-password?accountId=${encodeURIComponent(input.accountId)}&token=${encodeURIComponent(input.token)}`;
  }
}

export class LoggingVerificationEmailSender implements VerificationEmailSender {
  public constructor(private readonly log: (input: EmailInput) => void) {}

  public async sendVerificationEmail(input: EmailInput): Promise<void> {
    this.log(input);
  }

  public async sendPasswordResetEmail(input: EmailInput): Promise<void> {
    this.log(input);
  }
}
