import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";

let _transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.EMAIL_SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.EMAIL_SMTP_PORT || 465);
  const secure =
    String(process.env.EMAIL_SMTP_SECURE || "true").toLowerCase() === "true";
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    throw new Error("Missing EMAIL_USER or EMAIL_PASS in environment");
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return _transporter;
}

const _templateCache = new Map<string, string>();

function loadTemplateHtml(templateName: string): string {
  const cached = _templateCache.get(templateName);
  if (cached) return cached;

  const templatePath = path.join(
    process.cwd(),
    "templates",
    `${templateName}.html`
  );
  const html = fs.readFileSync(templatePath, "utf8");
  _templateCache.set(templateName, html);
  return html;
}

function applyVariables(
  htmlContent: string,
  variables: Record<string, unknown> = {}
): string {
  let result = htmlContent;
  for (const [key, value] of Object.entries(variables)) {
    const safeValue = value == null ? "" : String(value);
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, safeValue);
  }
  return result;
}

interface EmailResult {
  ok: boolean;
  messageId?: string;
  response?: string;
  error?: { message: string; code?: string; response?: string };
}

export async function sendParkingEmail(
  to: string,
  subject: string,
  templateName: string,
  variables: Record<string, unknown> = {},
  options: { replyTo?: string } = {}
): Promise<EmailResult> {
  try {
    const transporter = getTransporter();

    const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const fromName = process.env.EMAIL_FROM_NAME || "Aura Apache Parking";

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");
    const htmlTemplate = loadTemplateHtml(templateName);
    const html = applyVariables(htmlTemplate, {
      heroImage: `${frontendUrl}/image-apartment.jpeg`,
      ...variables,
    });

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      html,
      replyTo: options.replyTo,
    });

    return { ok: true, messageId: info.messageId, response: info.response };
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string; response?: string };
    console.error("[SMTP ERROR]:", err.message);
    return {
      ok: false,
      error: {
        message: err?.message || "Unknown email error",
        code: err.code,
        response: err.response,
      },
    };
  }
}
