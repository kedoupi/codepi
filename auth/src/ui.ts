import { PRODUCT_BRAND } from "../../shared/brand";
import tokens from "../../shared/styles/tokens.css";

const escape = (text: string) => text.replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function loginPage(name: string, email: string, nonce: string): string {
  const [local, domain] = email.split("@");
  const masked = `${local.slice(0, 1)}***@${domain}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${PRODUCT_BRAND} · 登录</title>
<style nonce="${nonce}">
${tokens}
:root{--ink:var(--kdp-ink);--muted:var(--kdp-muted);--line:var(--kdp-line);--accent:var(--kdp-accent)}
*{box-sizing:border-box}body{margin:0;min-height:100svh;color:var(--ink);font:16px/1.7 var(--kdp-font);background:radial-gradient(ellipse at 80% 0%,var(--kdp-accent-soft),transparent 55%),var(--kdp-canvas);display:grid;place-items:center;padding:28px}
main{width:min(100%,460px)}.brand{font-size:16px;font-weight:600;margin-bottom:32px}.card{background:var(--kdp-surface);border:1px solid var(--line);border-radius:var(--kdp-radius-lg);padding:36px;box-shadow:var(--kdp-shadow)}
.eyebrow{font-size:13px;color:var(--muted)}h1{font-size:32px;font-weight:650;line-height:1.3;margin:14px 0}p{color:var(--muted);margin:16px 0}label{display:block;font-size:14px;margin-bottom:8px}
button,input{font:inherit;width:100%;border-radius:8px;padding:12px 16px}button{cursor:pointer;background:var(--accent);color:white;border:1px solid var(--accent);margin-top:16px}button:disabled{opacity:.55;cursor:wait}input{border:1px solid var(--line);background:#fff;font:24px/1.5 monospace;letter-spacing:.3em;color:var(--ink)}
button:focus-visible,input:focus-visible{outline:2px solid var(--kdp-focus);outline-offset:3px}button:hover:not(:disabled){background:var(--kdp-accent-strong)}.secondary{background:transparent;color:var(--accent)}.secondary:hover:not(:disabled){background:var(--kdp-accent-soft)}.foot{font-size:12px;text-align:center;margin-top:24px}.status{font-size:14px;min-height:24px;color:var(--muted)}.status[data-kind="error"]{color:var(--kdp-danger)}form{margin-top:16px}a{color:var(--accent)}[hidden]{display:none!important}@media(max-width:440px){body{padding:20px}.card{padding:26px}.brand{margin-bottom:28px}h1{font-size:28px}}
</style></head><body><main><div class="brand">${PRODUCT_BRAND}</div><section class="card">
<div class="eyebrow">继续访问 ${escape(name)}</div><h1>欢迎回来。</h1>
<p>使用你的专属邮箱登录。一次登录，连接你的工作空间。</p>
<p id="recipient">验证码将发送至 <strong>${escape(masked)}</strong></p>
<button id="send" type="button">发送验证码</button>
<form id="verify" hidden><label for="code">6 位邮箱验证码</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-describedby="status"><button id="submit" type="submit">登录并继续</button></form>
<p id="status" class="status" role="status" aria-live="polite"></p>
<p id="expired" hidden>登录请求已过期。<a href="" id="restart">重新开始</a></p>
</section><p class="foot">仅限本人访问 · 网站登录与第三方数据授权独立</p></main>
<script nonce="${nonce}">
const send=document.querySelector('#send'),form=document.querySelector('#verify'),input=document.querySelector('#code'),status=document.querySelector('#status'),submit=document.querySelector('#submit');
let timer;
const messages={rate_limited:'发送次数较多，请稍后再试。',rate_limited_daily:'今日验证码额度已用完，北京时间 0 点恢复。',invalid_code:'验证码不正确、已过期或尝试次数过多，请重新获取。',invalid_transaction:'登录请求已过期，请重新开始。',mail_unavailable:'邮件暂时无法发送，请稍后再试。',auth_unavailable:'登录服务暂时不可用，请稍后重试。'};
async function call(path,body){const res=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok){if(data.error==='invalid_transaction'){document.querySelector('#expired').hidden=false;document.querySelector('#restart').href=location.href}throw Error(messages[data.error]||messages.auth_unavailable)}return data}
send.onclick=async()=>{send.disabled=true;status.textContent='';status.dataset.kind='info';try{await call('/api/auth/request-otp',{});form.hidden=false;input.focus();status.textContent='验证码已发送，8 分钟内有效。';let seconds=60;send.textContent=seconds+' 秒后重新发送';send.classList.add('secondary');clearInterval(timer);timer=setInterval(()=>{seconds--;send.textContent=seconds>0?seconds+' 秒后重新发送':'重新发送验证码';if(seconds<=0){clearInterval(timer);send.disabled=false}},1000)}catch(e){status.dataset.kind='error';status.textContent=e.message;send.disabled=false}};
form.onsubmit=async e=>{e.preventDefault();submit.disabled=true;status.textContent='';status.dataset.kind='info';try{const data=await call('/api/auth/verify-otp',{code:input.value.trim()});location.assign(data.redirect)}catch(e){status.dataset.kind='error';status.textContent=e.message;submit.disabled=false}};
</script></body></html>`;
}
