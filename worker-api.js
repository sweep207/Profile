// Sweep207 Locket API — compatible with index.html
// Bind a Cloudflare D1 database as DB.
// Set ALLOWED_ORIGINS, BANK_ID, BANK_ACCOUNT, BANK_ACCOUNT_NAME as vars.
// Set SEPAY_API_KEY as a Worker secret before enabling the SePay webhook.

const PLANS = [
  { id:"trial", label:"DÙNG THỬ", name:"Locket Gold Trial", duration:"1 ngày", price:4000, compare_at:0, badge:"TRIAL", featured:true, button_text:"Đang chọn gói này", features:["Hạn sử dụng: 1 ngày","Quay video 30 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"pro", label:"PRO", name:"Locket Gold Pro", duration:"180 ngày", price:30000, compare_at:0, badge:"PRO", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 6 tháng","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"premium", label:"PREMIUM", name:"Locket Gold Premium", duration:"365 ngày", price:50000, compare_at:0, badge:"PREMIUM", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 1 năm","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"forever", label:"FOREVER", name:"Locket Gold Forever", duration:"Trọn đời", price:130000, compare_at:0, badge:"FOREVER", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: Vĩnh viễn","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] }
];

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",").map(v => v.trim()).filter(Boolean);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
function reply(data, status, origin, env) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders(origin, env) });
}
function secureEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function makeOrderCode() {
  return "LOCKET" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
}
async function applyRateLimit(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = Math.floor(Date.now() / 60000);
  const key = ip + ":" + bucket;
  const row = await env.DB.prepare("SELECT hits FROM rate_limits WHERE rate_key=?").bind(key).first();
  if (row && row.hits >= 8) return false;
  await env.DB.prepare(`
    INSERT INTO rate_limits(rate_key,hits,expires_at) VALUES(?,?,?)
    ON CONFLICT(rate_key) DO UPDATE SET hits=hits+1
  `).bind(key, 1, (bucket + 2) * 60000).run();
  return true;
}
async function createOrder(request, env, origin) {
  if (!env.DB) return reply({ success: false, error: "D1 database binding DB chưa được cấu hình." }, 503, origin, env);
  if (!await applyRateLimit(request, env)) return reply({ success: false, error: "Bạn thao tác quá nhanh. Vui lòng thử lại sau." }, 429, origin, env);
  let body;
  try { body = await request.json(); } catch { return reply({ success: false, error: "Dữ liệu không hợp lệ." }, 400, origin, env); }
  const username = String(body.username || "").trim();
  const plan = PLANS.find(p => p.id === String(body.plan || ""));
  if (!username || username.length > 100 || /[<>]/.test(username)) return reply({ success: false, error: "Username hoặc link Locket không hợp lệ." }, 400, origin, env);
  if (!plan) return reply({ success: false, error: "Không tìm thấy gói dịch vụ." }, 400, origin, env);
  if (!env.BANK_ID || !env.BANK_ACCOUNT || !env.BANK_ACCOUNT_NAME) return reply({ success: false, error: "Worker chưa cấu hình tài khoản nhận thanh toán." }, 503, origin, env);

  const id = crypto.randomUUID();
  const code = makeOrderCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  await env.DB.prepare(
    "INSERT INTO orders(id,order_code,username,plan,amount,status,expires_at) VALUES(?,?,?,?,?,'pending',?)"
  ).bind(id, code, username, plan.id, plan.price, expiresAt).run();

  const qr = new URL(`https://img.vietqr.io/image/${encodeURIComponent(env.BANK_ID)}-${encodeURIComponent(env.BANK_ACCOUNT)}-compact2.png`);
  qr.searchParams.set("amount", String(plan.price));
  qr.searchParams.set("addInfo", code);
  qr.searchParams.set("accountName", env.BANK_ACCOUNT_NAME);
  return reply({ success: true, order_code: code, amount: plan.price, plan: plan.name, expires_at: expiresAt, qr_url: qr.toString() }, 200, origin, env);
}
async function checkPayment(request, env, origin) {
  if (!env.DB) return reply({ success: false, error: "D1 database binding DB chưa được cấu hình." }, 503, origin, env);
  const code = new URL(request.url).searchParams.get("order_code");
  if (!code || !/^LOCKET[A-F0-9]{12}$/.test(code)) return reply({ success: false, error: "Mã đơn không hợp lệ." }, 400, origin, env);
  const row = await env.DB.prepare("SELECT order_code,amount,plan,status,expires_at FROM orders WHERE order_code=?").bind(code).first();
  if (!row) return reply({ success: false, error: "Không tìm thấy đơn hàng." }, 404, origin, env);
  if (row.status === "pending" && Date.now() > row.expires_at) {
    await env.DB.prepare("UPDATE orders SET status='expired' WHERE order_code=? AND status='pending'").bind(code).run();
    row.status = "expired";
  }
  return reply({ success: true, order_code: row.order_code, amount: row.amount, plan: row.plan, status: row.status, expires_at: row.expires_at }, 200, origin, env);
}
async function sepayWebhook(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const match = auth.match(/^Apikey\s+(.+)$/i);
  if (!env.SEPAY_API_KEY || !match || !secureEqual(match[1].trim(), env.SEPAY_API_KEY)) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  let data;
  try { data = await request.json(); } catch { return new Response(JSON.stringify({ success: false }), { status: 400 }); }
  if (String(data.transferType || "").toLowerCase() !== "in") return Response.json({ success: true });
  const content = String(data.content || data.code || "").toUpperCase();
  const code = content.match(/LOCKET[A-F0-9]{12}/)?.[0];
  const amount = Number(data.transferAmount);
  const transactionId = String(data.id ?? "").trim();
  if (!code || !transactionId || !Number.isSafeInteger(amount) || amount <= 0) return Response.json({ success: false, message: "Invalid transfer data" }, { status: 400 });

  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_code=?").bind(code).first();
  if (!order || order.amount !== amount || order.status !== "pending" || Date.now() > order.expires_at) return Response.json({ success: true });
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO payments(transaction_id,order_code,amount) VALUES(?,?,?)").bind(transactionId, code, amount).run();
  if (inserted.meta.changes === 1) {
    await env.DB.prepare("UPDATE orders SET status='paid' WHERE id=? AND status='pending' AND amount=?").bind(order.id, amount).run();
  }
  return Response.json({ success: true });
}

async function recentPurchases(env, origin) {
  const rows = await env.DB.prepare("SELECT username, plan, created_at FROM orders WHERE status IN ('paid','processing','completed') ORDER BY created_at DESC LIMIT 12").all();
  const names = Object.fromEntries(PLANS.map(p => [p.id, p.name]));
  const items = (rows.results || []).map(row => {
    const raw = String(row.username || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    const user = (raw.split(/[/?#]/)[0] || "Khách hàng").replace(/[^a-zA-Z0-9_.-]/g, "");
    const buyer = user.length <= 2 ? user.slice(0,1) + "***" : user.slice(0,2) + "***";
    return { buyer, plan_name: names[row.plan] || "Locket Gold", created_at: Number(row.created_at) };
  });
  return reply({ items }, 200, origin, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const isWebhook = url.pathname === "/webhook/sepay";
    const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
    if (request.method === "OPTIONS") {
      if (origin && !allowed.includes(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
    }
    if (!isWebhook && origin && !allowed.includes(origin)) return reply({ success: false, error: "Origin not allowed." }, 403, "", env);
    try {
      if (request.method === "GET" && url.pathname === "/health") return reply({ ok: true, service: "Sweep207 Locket API" }, 200, origin, env);
      if (request.method === "GET" && url.pathname === "/plans") return reply({ plans: PLANS }, 200, origin, env);\n      if (request.method === "GET" && url.pathname === "/recent-purchases") return await recentPurchases(env, origin);
      if (request.method === "POST" && url.pathname === "/create-order") return await createOrder(request, env, origin);
      if (request.method === "GET" && url.pathname === "/check-payment") return await checkPayment(request, env, origin);
      if (request.method === "POST" && isWebhook) return await sepayWebhook(request, env);
      return reply({ success: false, error: "Not found." }, 404, origin, env);
    } catch (error) {
      console.error("Worker API error:", error);
      return reply({ success: false, error: "Lỗi máy chủ. Vui lòng thử lại." }, 500, origin, env);
    }
  }
};
