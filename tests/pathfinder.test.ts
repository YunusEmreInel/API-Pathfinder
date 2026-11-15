import { describe, expect, it } from "vitest";
import { TestDriver } from "testdriverai/vitest/hooks";

describe("API Pathfinder UI", () => {
  it("should load the application and import demo OpenAPI document", async (context) => {
    const testdriver = TestDriver(context);

    const appUrl =
      process.env.APP_URL ||
      "https://leading-material-permit-railway.trycloudflare.com";

    await testdriver.provision.chrome({ url: appUrl });

    // Load bundled Demo Store API document into the textarea
    const demoButton = await testdriver.find("\"Demo dokümanı yükle\" button");
    await demoButton.click();

    // Verify textarea populated with OpenAPI JSON
    const assertJsonLoaded = await testdriver.assert(
      "The textarea is populated with the Demo Store API OpenAPI JSON document"
    );
    expect(assertJsonLoaded).toBeTruthy();

    // Click Import button
    const importButton = await testdriver.find("\"İçe aktar\" button");
    await importButton.click();

    // Verify UI displays import interface and responds
    const assertUiResponse = await testdriver.assert(
      "The API Pathfinder application displays the OpenAPI import interface"
    );
    expect(assertUiResponse).toBeTruthy();
  });
});
