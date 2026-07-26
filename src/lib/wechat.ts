export function isWechatBrowser(userAgent = navigator.userAgent): boolean {
  return /micromessenger/i.test(userAgent);
}
