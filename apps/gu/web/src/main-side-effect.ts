// 退役的本地偏好：只在真实入口清理一次，测试环境不注入。
try {
  sessionStorage.removeItem("gu-hide");
} catch {
  /* Storage may be unavailable; the retired preference is never read. */
}
export {};
