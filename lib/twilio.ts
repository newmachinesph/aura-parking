import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

export function isTwilioTestMode(): boolean {
  return String(process.env.TWILIO_TEST_MODE || "").toLowerCase() === "true";
}

export function getTwilioClient() {
  if (isTwilioTestMode()) {
    // Return a marker so callers know Twilio is "available" in test mode
    return "TEST_MODE" as unknown as ReturnType<typeof twilio>;
  }
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  if (!client) {
    client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }
  return client;
}

export function getVerifyServiceSid(): string {
  return process.env.TWILIO_VERIFY_SERVICE_SID || "";
}

/** Test-mode code that is always accepted */
export const TEST_MODE_CODE = "123456";
