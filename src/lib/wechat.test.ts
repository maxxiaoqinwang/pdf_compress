import { describe, expect, it } from "vitest";
import { isWechatBrowser } from "./wechat";

describe("isWechatBrowser", () => {
  it("detects the mobile WeChat browser", () => {
    expect(
      isWechatBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.49"
      )
    ).toBe(true);
  });

  it("ignores normal mobile Safari", () => {
    expect(
      isWechatBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
      )
    ).toBe(false);
  });
});
