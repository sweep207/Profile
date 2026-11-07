// Cloudflare Worker: secure proxy for Uplocket Reseller API
// Secret required: UPLOCKET_API_KEY. Never expose this key in browser code.
const UPSTREAM = "https://uplocket.io.vn";
const ALLOWED_METHODS = "GET, POST, OPTIONS";

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const configured = String(env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed = !origin || local || configured.includes("*") || configured.includes(origin);
  return {
    allowed,
    headers: {
      "Access-Control-Allow-Origin": origin && allowed ? (configured.includes("*") ? "*" : origin) : "null",
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    }
  };
}
function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors }
  });
}
async function bodyJson(request) {
  try { return await request.json(); } catch { return null; }
}
async function upstream(path, method, env, body) {
  if (!env.UPLOCKET_API_KEY) return json({ success:false, error:"Worker chưa cấu hình Secret UPLOCKET_API_KEY." }, 503);
  const headers = { "Authorization": "Bearer " + env.UPLOCKET_API_KEY, "Accept":"application/json" };
  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(UPSTREAM + path, init); }
  catch { return json({ success:false, error:"Không kết nối được Uplocket API. Vui lòng thử lại." }, 502); }
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8", "Cache-Control":"no-store" }
  });
}
function validUsername(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 300;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (!cors.allowed) return json({ success:false, error:"Origin không được phép." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status:204, headers:cors.headers });
    const path = url.pathname;
    try {
      if (request.method === "GET" && path === "/health") {
        return json({ ok:true, service:"uplocket-proxy", configured:Boolean(env.UPLOCKET_API_KEY) }, 200, cors.headers);
      }
      if (request.method === "GET" && path === "/api/credits") {
        const r = await upstream("/api/v1/credits", "GET", env);
        return withCors(r, cors.headers);
      }
      if (request.method === "GET" && path === "/api/dns/activations") {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
        const r = await upstream("/api/v1/dns/activations?limit=" + limit, "GET", env);
        return withCors(r, cors.headers);
      }
      if (request.method === "GET" && path === "/api/dns/lookup") {
        const username = url.searchParams.get("username") || "";
        if (!validUsername(username)) return json({ success:false, error:"Vui lòng nhập username hoặc link Locket." }, 400, cors.headers);
        const r = await upstream("/api/v1/dns/lookup?username=" + encodeURIComponent(username.trim()), "GET", env);
        return withCors(r, cors.headers);
      }
      if (request.method === "POST" && path === "/api/dns/lookup") {
        const data = await bodyJson(request);
        if (!data || !validUsername(data.username)) return json({ success:false, error:"Thiếu username hoặc JSON không hợp lệ." }, 400, cors.headers);
        const r = await upstream("/api/v1/dns/lookup", "POST", env, { username:data.username.trim() });
        return withCors(r, cors.headers);
      }
      if (request.method === "POST" && path === "/api/locket/lookup") {
        const data = await bodyJson(request);
        if (!data || !validUsername(data.username)) return json({ success:false, error:"Vui lòng nhập username hoặc link Locket." }, 400, cors.headers);
        // This endpoint is public in Uplocket docs; do not attach reseller key.
        let r;
        try {
          r = await fetch(UPSTREAM + "/api/locket/lookup", {
            method:"POST", headers:{"Content-Type":"application/json","Accept":"application/json"},
            body:JSON.stringify({ username:data.username.trim() })
          });
        } catch { return json({ success:false, error:"Không kết nối được dịch vụ tra cứu Locket." }, 502, cors.headers); }
        return withCors(new Response(await r.text(), {status:r.status,headers:{"Content-Type":r.headers.get("Content-Type")||"application/json"}}), cors.headers);
      }
      if (request.method === "POST" && path === "/api/dns/export") {
        const data = await bodyJson(request);
        if (!data || !validUsername(data.username)) return json({ success:false, error:"Vui lòng cung cấp username Locket." }, 400, cors.headers);
        const payload = { username:data.username.trim() };
        if (data.durationDays !== undefined) payload.durationDays = Number(data.durationDays);
        if (data.packageName) payload.packageName = String(data.packageName).slice(0,80);
        if (data.videoMode) payload.videoMode = String(data.videoMode);
        if (data.memberSinceDate) payload.memberSinceDate = String(data.memberSinceDate);
        if (payload.durationDays !== undefined && (!Number.isInteger(payload.durationDays) || payload.durationDays < 1 || payload.durationDays > 9999)) {
          return json({ success:false, error:"durationDays phải là số nguyên từ 1 đến 9999." }, 400, cors.headers);
        }
        if (payload.videoMode && !["5s","15s","30s"].includes(payload.videoMode)) return json({ success:false, error:"videoMode chỉ nhận 5s, 15s hoặc 30s." }, 400, cors.headers);
        const r = await upstream("/api/v1/dns/export", "POST", env, payload);
        return withCors(r, cors.headers);
      }
      const action = path.match(/^\/api\/dns\/activations\/([^/]+)\/(renew|toggle)$/);
      if (request.method === "POST" && action) {
        const id = decodeURIComponent(action[1]);
        if (!id || id.length > 200) return json({ success:false, error:"ID hồ sơ không hợp lệ." }, 400, cors.headers);
        if (action[2] === "toggle") {
          const r = await upstream("/api/v1/dns/activations/" + encodeURIComponent(id) + "/toggle", "POST", env, {});
          return withCors(r, cors.headers);
        }
        const data = await bodyJson(request) || {};
        const durationDays = data.durationDays === undefined ? 30 : Number(data.durationDays);
        if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 9999) return json({ success:false, error:"Số ngày gia hạn phải từ 1 đến 9999." }, 400, cors.headers);
        const r = await upstream("/api/v1/dns/activations/" + encodeURIComponent(id) + "/renew", "POST", env, {durationDays});
        return withCors(r, cors.headers);
      }
      return json({ success:false, error:"Không tìm thấy endpoint." }, 404, cors.headers);
    } catch (error) {
      console.error("Worker error", error);
      return json({ success:false, error:"Lỗi xử lý Worker." }, 500, cors.headers);
    }
  }
};
function withCors(response, cors) {
  const headers = new Headers(response.headers);
  for (const [key,value] of Object.entries(cors)) headers.set(key,value);
  headers.set("Cache-Control","no-store");
  return new Response(response.body,{status:response.status,headers});
}
