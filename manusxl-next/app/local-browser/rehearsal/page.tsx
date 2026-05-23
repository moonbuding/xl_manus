import { headers } from "next/headers";
import { readAuthUserFromCookieHeader } from "@/server/auth/auth-store";

export const dynamic = "force-dynamic";

export default async function LocalBrowserRehearsalPage() {
  const headerStore = await headers();
  const user = readAuthUserFromCookieHeader(headerStore.get("cookie"));

  return (
    <main className="rehearsal-page">
      <section className="rehearsal-hero">
        <div className="empty-kicker">LOCAL BROWSER REHEARSAL</div>
        <h1>{user ? "已读取到用户登录态" : "需要先登录 ManusXL"}</h1>
        <p>
          这个页面用于模拟付费文章/登录态页面。把 `localhost` 加入本地浏览器 allowlist 后，
          Agent 通过 CDP 读取本页时，应看到与当前 ManusXL 登录用户相关的正文。
        </p>
      </section>

      <section className="rehearsal-article">
        {user ? (
          <>
            <p className="rehearsal-status is-open">MANUSXL_LOCAL_BROWSER_AUTHENTICATED_REHEARSAL</p>
            <h2>付费文章正文演练</h2>
            <p>
              当前浏览器已携带有效 ManusXL 登录 Cookie，用户为 {user.displayName}（{user.email}）。
              本地浏览器工具读取到这段文字时，说明它正在使用用户本机浏览器的已登录态，而不是匿名请求。
            </p>
            <p>
              验收方式：在 Chrome 远程调试模式打开此页，Settings / 本地浏览器中设置 allowlist 为
              `localhost`，再执行 snapshot 或让 Agent 使用 local_browser 工具读取页面。
            </p>
          </>
        ) : (
          <>
            <p className="rehearsal-status is-locked">LOCKED_PAYWALL_REHEARSAL</p>
            <h2>正文已被登录墙隐藏</h2>
            <p>
              当前请求没有有效 ManusXL 登录 Cookie。请先在同一个本地 Chrome 浏览器里登录 ManusXL，
              再回到本页刷新。
            </p>
          </>
        )}
      </section>
    </main>
  );
}
