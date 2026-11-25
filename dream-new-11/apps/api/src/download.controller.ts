import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/jwt-auth.guard';
import { Env, InjectEnv } from './config/config.module';

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Public, shareable "Get the app" page. The button points at APP_DOWNLOAD_URL. */
@Public()
@SkipThrottle()
@Controller()
export class DownloadController {
  constructor(@InjectEnv() private readonly env: Env) {}

  @Get('download')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  page(): string {
    const url = this.env.APP_DOWNLOAD_URL;
    const demo = this.env.APP_MODE === 'demo';
    const button = url
      ? `<a class="btn" href="${escape(url)}" rel="noopener">Download for Android</a><p class="hint">Allow “Install unknown apps” for your browser if Android asks.</p>`
      : `<span class="btn off" aria-disabled="true">Download coming soon</span><p class="hint">The installable app is being prepared. Check back shortly.</p>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Get Dream New 11</title>
<style>
:root{--bg:#0A1128;--card:#121C3D;--accent:#22E06B;--muted:#8A94B8}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#1B2D63,var(--bg) 60%);color:#fff;font-family:Inter,system-ui,sans-serif;padding:24px}
.card{max-width:420px;width:100%;background:var(--card);border:1px solid #24305C;border-radius:28px;padding:32px 24px;text-align:center}
.logo{width:84px;height:84px;border-radius:24px;background:linear-gradient(135deg,#3BF283,#0FA44B);display:grid;place-items:center;margin:0 auto 18px;font-weight:900;font-size:40px;color:var(--bg)}
h1{margin:0;font-size:26px}h1 span{color:var(--accent)}p{color:var(--muted);line-height:1.5}
.btn{display:block;margin:22px 0 8px;padding:16px;border-radius:16px;background:linear-gradient(135deg,#3BF283,#14B856);color:var(--bg);font-weight:800;text-decoration:none;font-size:17px}
.off{background:#24305C;color:var(--muted)}.hint{font-size:13px}
.demo{display:inline-block;margin-top:14px;padding:6px 12px;border-radius:999px;background:#FFB547;color:var(--bg);font-weight:800;font-size:12px}
</style></head><body><main class="card">
<div class="logo" aria-hidden="true">11</div>
<h1>DREAM <span>NEW 11</span></h1>
<p>Create Your Team. Play Your Game.<br>Fantasy cricket for 18+ players.</p>
${button}
${demo ? '<span class="demo">DEMO · Practice play only · No real money</span>' : ''}
</main></body></html>`;
  }
}
