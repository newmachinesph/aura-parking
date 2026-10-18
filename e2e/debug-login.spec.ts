import { test, expect } from "@playwright/test";

test.describe("Debug Login", () => {
  test("manual login debug", async ({ page }) => {
    // Capture console logs
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Capture network errors
    page.on("requestfailed", (request) => {
      console.log(`REQUEST FAILED: ${request.url()} - ${request.failure()?.errorText}`);
    });

    // Listen for ALL network requests
    page.on("request", (request) => {
      if (request.url().includes("/api/")) {
        console.log(`REQUEST: ${request.method()} ${request.url()}`);
      }
    });

    page.on("response", (response) => {
      if (response.url().includes("/api/")) {
        console.log(`RESPONSE: ${response.url()} - ${response.status()}`);
        // Check for set-cookie header
        const setCookie = response.headers()["set-cookie"];
        if (setCookie) {
          console.log(`SET-COOKIE: ${setCookie.substring(0, 50)}...`);
        }
      }
    });

    // Go to login page
    await page.goto("/login");
    console.log("Navigated to /login");

    // Wait for form
    await page.waitForSelector("form", { timeout: 5000 });
    console.log("Form found");

    // Check inputs are present
    const emailInput = page.getByPlaceholder("Email");
    const passwordInput = page.getByPlaceholder("Password");
    const loginBtn = page.getByRole("button", { name: /login/i });

    expect(await emailInput.isVisible()).toBe(true);
    expect(await passwordInput.isVisible()).toBe(true);
    expect(await loginBtn.isVisible()).toBe(true);
    console.log("All form elements visible");

    // Fill form
    await emailInput.fill("r01@example.com");
    await passwordInput.fill(process.env.SEED_PASSWORD!);
    console.log("Form filled");

    // Click login and wait for network
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login"),
      { timeout: 10000 }
    ).catch((e) => {
      console.log("No login API response received:", e.message);
      return null;
    });

    await loginBtn.click();
    console.log("Login button clicked");

    const response = await responsePromise;
    if (response) {
      console.log("Login response status:", response.status());
      const body = await response.json().catch(() => null);
      console.log("Login response body:", JSON.stringify(body));
    }

    // Wait a bit for any redirects
    await page.waitForTimeout(2000);

    // Check current URL
    console.log("Current URL:", page.url());

    // Check for any error messages
    const errorBox = page.locator(".bg-red-50");
    if (await errorBox.isVisible().catch(() => false)) {
      const errorText = await errorBox.textContent();
      console.log("Error message:", errorText);
    }

    // Check the cookies
    const cookies = await page.context().cookies();
    console.log("Cookies:", JSON.stringify(cookies.map(c => ({ name: c.name, value: c.value.substring(0, 20) + "..." }))));

    // Print collected console logs
    console.log("\n--- Browser Console Logs ---");
    consoleLogs.forEach(log => console.log(log));
  });
});
