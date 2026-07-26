import { isWechatBrowser } from "../lib/wechat";

export function WechatNotice() {
  if (!isWechatBrowser()) {
    return null;
  }

  return (
    <aside className="wechat-notice">
      WeChat may hide some document files in its picker. If EPUB selection fails, open this page
      from the top-right menu in your system browser.
    </aside>
  );
}
