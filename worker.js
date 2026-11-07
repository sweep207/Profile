// Cloudflare Worker — Locket Plus order backend
// Giá và thông tin gói chỉ cấu hình tại PLANS bên dưới.
// Không đặt API key / webhook secret trong frontend hoặc GitHub.

const PLANS = [
  { id:"trial", label:"DÙNG THỬ", name:"Locket Gold Trial", duration:"3 ngày", price:3000, compare_at:0, badge:"TRIAL", featured:true, button_text:"Đang chọn gói này", features:["Hạn sử dụng: 3 ngày","Quay video 30 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"pro", label:"PRO", name:"Locket Gold Pro", duration:"180 ngày", price:20000, compare_at:0, badge:"PRO", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 6 tháng","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"premium", label:"PREMIUM", name:"Locket Gold Premium", duration:"365 ngày", price:50000, compare_at:0, badge:"PREMIUM", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 1 năm","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"forever", label:"FOREVER", name:"Locket Gold Forever", duration:"Trọn đời", price:79000, compare_at:0, badge:"FOREVER", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: Vĩnh viễn","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] }
];

const ALLOWED_STATUSES = ["pending","paid","processing","completed","expired","activation_failed"];

function json(data, status=200, origin="") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin || "null",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Webhook-Secret, Authorization",
      "Access-Control-Max-Age": "86400"
    }
  });
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const list = String(env.ALLOWED_ORIGINS || "").split(",").map(x=>x.trim()).filter(Boolean);
  if (!origin) return "";
  return list.includes(origin) ? origin : null;
}
function secureEqual(a,b) {
  if(typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false;
  let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
async function orderCode(env) {
  // Mã ngắn: LOCKET + 6 chữ số. Kiểm tra trước để tránh trùng mã trong D1.
  for (let attempt = 0; attempt < 30; attempt++) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const digits = String(bytes[0] % 1000000).padStart(6, "0");
    const code = "LOCKET" + digits;
    const existing = await env.DB.prepare("SELECT 1 AS found FROM orders WHERE order_code=?").bind(code).first();
    if (!existing) return code;
  }
  throw new Error("Không thể tạo mã đơn hàng duy nhất. Vui lòng thử lại.");
}
function publicPlans() {
  return PLANS.map(({id,label,name,duration,price,compare_at,badge,featured,button_text,features}) =>
    ({id,label,name,duration,price,compare_at,badge,featured,button_text,features}));
}
async function rateLimit(request, env) {
  const ip=request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket=Math.floor(Date.now()/60000);
  const key=ip+":"+bucket;
  try {
    const row=await env.DB.prepare("SELECT hits FROM rate_limits WHERE rate_key=?").bind(key).first();
    if(row && row.hits>=8) return false;
    await env.DB.prepare(`
      INSERT INTO rate_limits(rate_key,hits,expires_at) VALUES(?,?,?)
      ON CONFLICT(rate_key) DO UPDATE SET hits=hits+1
    `).bind(key,1,(bucket+2)*60000).run();
    return true;
  } catch (error) {
    // A missing rate_limits table must not break account verification.
    console.error("Rate limit storage error:", String(error?.message || error));
    return true;
  }
}
async function verifyLocketAccount(username, env) {
  try {
  if (!env.UPLOCKET_API_KEY) {
    return { ok: false, status: 503, error: "Máy chủ chưa cấu hình dịch vụ xác minh tài khoản." };
  }

  let response;
  try {
    response = await fetch("https://uplocket.io.vn/api/v1/dns/lookup", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.UPLOCKET_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ username }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (error) {
    console.error("Uplocket account lookup request failed:", String(error?.name || "network error"));
    return { ok: false, status: 503, error: "Không thể kết nối dịch vụ xác minh Locket. Vui lòng thử lại sau." };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    console.error("Uplocket account lookup returned invalid JSON; HTTP", response.status);
    return { ok: false, status: 503, error: "Dịch vụ xác minh Locket trả về dữ liệu không hợp lệ." };
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 404) {
      return { ok: false, status: 422, error: "Không tìm thấy tài khoản Locket hợp lệ. Hãy kiểm tra lại username hoặc link." };
    }
    console.error("Uplocket account lookup HTTP error:", response.status);
    return { ok: false, status: 503, error: "Dịch vụ xác minh Locket đang bận hoặc không khả dụng. Vui lòng thử lại sau." };
  }

  // Uplocket có thể trả success/ok hoặc status=success tuỳ phiên bản API.
  // Chỉ từ chối rõ ràng khi provider báo thất bại; không coi trường provisional bị
  // lược bỏ là bằng chứng tài khoản giả.
  const lookupSucceeded =
    data?.success === true ||
    data?.ok === true ||
    ["ok", "success"].includes(String(data?.status || "").trim().toLowerCase());
  if (!lookupSucceeded || data?.success === false || data?.ok === false) {
    console.error("Uplocket account lookup did not confirm success; HTTP", response.status);
    return { ok: false, status: 503, error: "Uplocket chưa xác nhận được tài khoản. Vui lòng thử lại sau." };
  }

  if (data?.provisional === true || data?.data?.provisional === true || data?.result?.provisional === true) {
    return { ok: false, status: 422, error: "Username này chưa được xác nhận là tài khoản Locket thật. Vui lòng kiểm tra lại." };
  }

  // Uplocket có thể bọc hồ sơ trong data/result; chuẩn hóa các dạng phản hồi phổ biến.
  const envelopes = [data, data?.data, data?.result].filter(x => x && typeof x === "object");
  const profileCandidates = [
    data?.profile, data?.data?.profile, data?.result?.profile,
    data?.account, data?.data?.account, data?.result?.account,
    data?.user, data?.data?.user, data?.result?.user
  ].filter(x => x && typeof x === "object");
  let profile = profileCandidates.find(x => x.uid || x.userId || x.user_id || x.id);
  if (!profile) {
    profile = envelopes.find(x => x.uid || x.userId || x.user_id || x.id) || null;
  }
  const uid = String(profile?.uid || profile?.userId || profile?.user_id || profile?.id || "").trim();
  if (!profile || !uid) {
    console.error("Uplocket account lookup returned an incomplete or provisional profile.");
    return { ok: false, status: 503, error: "Uplocket chưa trả về hồ sơ xác minh đầy đủ. Chưa thể tạo đơn lúc này." };
  }

  // Đọc trạng thái Gold cả khi API đặt status bên trong subscription/membership.
  const normalizeGold = value => {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    if (typeof value !== "string") return null;
    const state = value.trim().toLowerCase().replace(/[ -]+/g, "_");
    if (["true","1","active","gold","gold_active","premium","subscribed","enabled","valid","đang_hoạt_động"].includes(state)) return true;
    if (["false","0","inactive","none","free","no_gold","not_gold","not_subscribed","expired","disabled","bản_free","chưa_có_gold"].includes(state)) return false;
    if (/(gold|premium)/.test(state) && !/(free|inactive|expired|not|no_)/.test(state)) return true;
    if (/(^|_)(free|inactive|expired|disabled|not_gold|no_gold)(_|$)/.test(state)) return false;
    return null;
  };
  function findGoldFlag(value, depth=0, inEntitlement=false) {
    if (!value || typeof value !== "object" || depth > 8) return null;
    const entries = Array.isArray(value) ? value.map((v,i)=>[String(i),v]) : Object.entries(value);
    for (const [key, child] of entries) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      const entitlementKey = /(gold|premium|subscription|entitlement|membership|plan|tier)/i.test(key);
      const statusKey = /^(status|state|active|enabled|isactive|isgold|hasgold|ispremium|haspremium)$/i.test(normalizedKey);
      if (entitlementKey) {
        const direct = normalizeGold(child);
        if (direct !== null) return direct;
        if (child && typeof child === "object") {
          const nested = findGoldFlag(child, depth+1, true);
          if (nested !== null) return nested;
        }
      } else if (statusKey && inEntitlement) {
        const direct = normalizeGold(child);
        if (direct !== null) return direct;
      } else if ((normalizedKey === "status" || normalizedKey === "state") && typeof child === "string") {
        const direct = normalizeGold(child);
        if (direct !== null && /(gold|premium|free)/i.test(child)) return direct;
      }
    }
    for (const child of entries.map(entry=>entry[1])) {
      if (child && typeof child === "object") {
        const nested = findGoldFlag(child, depth+1, inEntitlement);
        if (nested !== null) return nested;
      }
    }
    return null;
  }
  const goldActive = envelopes.reduce((found, root) => found !== null ? found : findGoldFlag(root), null);
  // Chỉ có hai nhãn hiển thị: có Gold xác nhận thì GOLD, còn lại là BẢN FREE (chưa xác nhận Gold).
  const goldStatus = goldActive === true ? "GOLD" : "BẢN FREE";
  const verifiedUsername = String(profile.username || profile.userName || profile.handle || username).trim().replace(/^@/,"");
  if (!verifiedUsername || verifiedUsername.length > 100) {
    return { ok: false, status: 503, error: "Dữ liệu hồ sơ xác minh từ Uplocket không hợp lệ." };
  }
  const displayName = profile.name || profile.displayName || profile.fullName || profile.full_name || "";
  const avatarUrl = profile.avatar || profile.avatarUrl || profile.photoURL || profile.photo_url || profile.picture || "";
  return {
    ok: true,
    username: verifiedUsername,
    goldStatus,
    profile: {
      username: verifiedUsername,
      uid,
      name: String(displayName).slice(0,100),
      avatar: String(avatarUrl).slice(0,1000)
    }
  };
  } catch (error) {
    // Log diagnostic details without username, API key, or response payload.
    console.error("verifyLocketAccount unexpected error:", {
      name: String(error?.name || "Error"),
      message: String(error?.message || error).slice(0, 300),
      stack: String(error?.stack || "").split("\n").slice(0, 5).join("\n")
    });
    return {
      ok: false,
      status: 503,
      error: "Không thể xác minh tài khoản lúc này. Dịch vụ đang gặp lỗi xử lý; vui lòng thử lại sau."
    };
  }
}
async function lookupInstallLink(request, env, origin) {
  if(!await rateLimit(request,env)) return json({success:false,error:"Bạn thao tác quá nhanh. Vui lòng thử lại sau."},429,origin);
  let body; try{body=await request.json();}catch{return json({success:false,error:"Dữ liệu không hợp lệ."},400,origin);}
  const raw=String(body.username||"").trim();
  if(!raw || raw.length>200 || /[<>]/.test(raw)) return json({success:false,error:"Link Locket không hợp lệ."},400,origin);
  let username=raw;
  try { if(/^https?:\/\//i.test(raw)){const u=new URL(raw);if(!/(^|\.)locket\.cam$/i.test(u.hostname)) return json({success:false,error:"Hãy nhập link trang cá nhân locket.cam."},400,origin);username=u.pathname.split("/").filter(Boolean).pop()||"";} } catch { return json({success:false,error:"Link Locket không hợp lệ."},400,origin); }
  username=username.replace(/^@/,"").trim();
  if(!username || username.length>100) return json({success:false,error:"Username Locket không hợp lệ."},400,origin);
  const verification=await verifyLocketAccount(username,env);
  if(!verification.ok) return json({success:false,error:verification.error},verification.status,origin);
  const row=await env.DB.prepare("SELECT install_url,plan,created_at,activation_date FROM orders WHERE lower(username)=lower(?) AND status='completed' AND install_url IS NOT NULL AND install_url<>'' ORDER BY created_at DESC LIMIT 1").bind(verification.username).first();
  if(!row) return json({success:false,error:"Không tìm thấy link DNS đã kích hoạt cho tài khoản này. Hãy kiểm tra tài khoản hoặc liên hệ hỗ trợ."},404,origin);
  return json({success:true,install_url:row.install_url,plan:row.plan,created_at:row.created_at,activation_date:row.activation_date||null},200,origin);
}
async function createOrder(request, env, origin) {
  try {
    if(!await rateLimit(request,env)) return json({success:false,error:"Bạn thao tác quá nhanh. Vui lòng thử lại sau."},429,origin);
    let body;
    try { body=await request.json(); }
    catch { return json({success:false,error:"Dữ liệu đơn hàng không hợp lệ."},400,origin); }

    const username=String(body.username||"").trim();
    const plan=PLANS.find(p=>p.id===String(body.plan||""));
    if(!username || username.length>100 || /[<>]/.test(username)) return json({success:false,error:"Username hoặc link không hợp lệ."},400,origin);
    if(!plan || !Number.isSafeInteger(plan.price) || plan.price<=0) return json({success:false,error:"Gói dịch vụ chưa được cấu hình hợp lệ."},400,origin);
    if(!env.BANK_ID || !env.BANK_ACCOUNT || !env.BANK_ACCOUNT_NAME) return json({success:false,error:"Máy chủ chưa cấu hình tài khoản nhận tiền."},503,origin);

    // Xác minh lại username ở phía máy chủ trước khi tạo đơn.
    const verification = await verifyLocketAccount(username, env);
    if (!verification.ok) return json({success:false,error:verification.error},verification.status,origin);
    const verifiedUsername = verification.username;

    // Tương thích database cũ: thêm cột nếu chưa có.
    // Không dùng PRAGMA table_info trong request tạo đơn vì một số cấu hình D1
    // không hỗ trợ câu lệnh PRAGMA qua prepared statement.
    try {
      await env.DB.prepare("ALTER TABLE orders ADD COLUMN activation_date TEXT").run();
    } catch (migrationError) {
      const migrationMessage = String(migrationError?.message || migrationError);
      if (!/duplicate column name|already exists/i.test(migrationMessage)) {
        console.error("Orders schema compatibility check failed:", migrationMessage);
        throw migrationError;
      }
    }

    const id=crypto.randomUUID();
    const code=await orderCode(env);
    const expires=Date.now()+10*60*1000;
    const activationDate=String(body.activationDate||"").trim();
    if (activationDate && !/^\d{4}-\d{2}-\d{2}$/.test(activationDate)) {
      return json({success:false,error:"Ngày kích hoạt không hợp lệ."},400,origin);
    }
    await env.DB.prepare(`
      INSERT INTO orders(id,order_code,username,plan,amount,status,expires_at,activation_date)
      VALUES(?,?,?,?,?,'pending',?,?)
    `).bind(id,code,verifiedUsername,plan.id,plan.price,expires,activationDate).run();

    const qr=new URL(`https://img.vietqr.io/image/${encodeURIComponent(env.BANK_ID)}-${encodeURIComponent(env.BANK_ACCOUNT)}-compact2.png`);
    qr.searchParams.set("amount",String(plan.price));
    qr.searchParams.set("addInfo",code);
    qr.searchParams.set("accountName",env.BANK_ACCOUNT_NAME);
    return json({success:true,order_code:code,amount:plan.price,plan:plan.name,expires_at:expires,qr_url:qr.toString()},200,origin);
  } catch (error) {
    const message=String(error?.message||"Lỗi không xác định");
    console.error("Create order failed:",message);
    // Trả lỗi vận hành an toàn để dễ xác định nguyên nhân, không tiết lộ thông tin bí mật.
    const publicMessage=/no such table|no such column|has no column named/i.test(message)
      ? "Cơ sở dữ liệu đơn hàng chưa đúng cấu trúc. Vui lòng báo quản trị viên kiểm tra D1."
      : /UPLOCKET|Uplocket|lookup|fetch failed|timed out/i.test(message)
        ? "Dịch vụ xác minh Locket đang lỗi. Vui lòng thử lại sau."
        : "Không thể tạo đơn hàng lúc này. Vui lòng thử lại sau.";
    return json({success:false,error:publicMessage,debug:message.slice(0,180)},500,origin);
  }
}

async function checkPayment(request, env, origin) {
  const code=new URL(request.url).searchParams.get("order_code");
  if(!code || !/^LOCKET(?:\d{6}|[A-F0-9]{12})$/.test(code)) return json({error:"Mã đơn không hợp lệ"},400,origin);
  const row=await env.DB.prepare("SELECT order_code,amount,plan,status,expires_at,install_url,activation_code,provider_error,activation_date FROM orders WHERE order_code=?").bind(code).first();
  if(!row) return json({error:"Không tìm thấy đơn hàng"},404,origin);
  if(row.status==="pending" && Date.now()>row.expires_at){
    await env.DB.prepare("UPDATE orders SET status='expired' WHERE order_code=? AND status='pending'").bind(code).run();
    row.status="expired";
  }
  return json({success:true,order_code:row.order_code,amount:row.amount,plan:row.plan,status:row.status,expires_at:row.expires_at,install_url:row.install_url||null,activation_code:row.activation_code||null,provider_error:row.provider_error||null,activation_date:row.activation_date||null},200,origin);
}
async function activatePaidOrder(order, env) {
  if (!env.UPLOCKET_API_KEY) {
    const message = "Máy chủ chưa cấu hình UPLOCKET_API_KEY. Đơn đã thanh toán, cần cấu hình API key rồi xử lý lại.";
    console.error(message);
    await env.DB.prepare("UPDATE orders SET status='activation_failed', provider_error=? WHERE id=? AND status='paid'")
      .bind(message, order.id).run();
    return;
  }
  const plan = PLANS.find(p => p.id === order.plan);
  if (!plan) {
    await env.DB.prepare("UPDATE orders SET status='activation_failed', provider_error=? WHERE id=? AND status='paid'").bind("Không tìm thấy cấu hình gói dịch vụ.", order.id).run();
    return;
  }
  const claimed = await env.DB.prepare("UPDATE orders SET status='processing' WHERE id=? AND status='paid'").bind(order.id).run();
  if (claimed.meta?.changes !== 1) return;
  const durationDays = ({trial:3, pro:180, premium:365, forever:9999})[plan.id];
  try {
    const response = await fetch("https://uplocket.io.vn/api/v1/dns/export", {
      method: "POST",
      headers: {"Authorization":"Bearer " + env.UPLOCKET_API_KEY,"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify({username:order.username,durationDays,packageName:plan.name,activationDate:order.activation_date||null})
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Uplocket trả về dữ liệu không hợp lệ (HTTP " + response.status + ")."); }
    if (!response.ok || data.success !== true || !data.data) {
      throw new Error("Uplocket: " + String(data.error || data.message || ("HTTP " + response.status)).slice(0, 500));
    }
    const d = data.data;
    const installUrl = String(d.installUrl || d.install_url || d.downloadUrl || d.download_url || d.enrollUrl || d.enroll_url || d.url || "").trim();
    if (!installUrl) {
      throw new Error("Uplocket phản hồi thành công nhưng không có link cài đặt DNS. Đơn được giữ ở trạng thái lỗi để kiểm tra, không báo kích hoạt thành công giả.");
    }
    let parsedInstallUrl;
    try { parsedInstallUrl = new URL(installUrl); } catch { throw new Error("Uplocket trả về link DNS không hợp lệ."); }
    if (parsedInstallUrl.protocol !== "https:") throw new Error("Uplocket trả về link DNS không an toàn.");
    await env.DB.prepare("UPDATE orders SET status='completed', provider_activation_id=?, activation_code=?, install_url=?, provider_error=NULL WHERE id=? AND status='processing'")
      .bind(String(d.id || ""),String(d.activationCode || d.activation_code || ""),installUrl,order.id).run();
  } catch (e) {
    const message = String(e?.message || "Không xác định").slice(0, 500);
    console.error("Uplocket activation error:", message);
    await env.DB.prepare("UPDATE orders SET status='activation_failed', provider_error=? WHERE id=? AND status='processing'").bind(message,order.id).run();
  }
}
async function verifySePayApiKey(request, env) {
  // SePay API Key webhook sends: Authorization: Apikey YOUR_API_KEY
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Apikey\s+(.+)$/i);
  return Boolean(env.SEPAY_API_KEY && match && secureEqual(match[1].trim(), env.SEPAY_API_KEY));
}
async function paymentWebhook(request, env, rawBody) {
  if (!await verifySePayApiKey(request, env)) {
    return new Response(JSON.stringify({success:false,message:"Invalid signature"}), {
      status:401, headers:{"Content-Type":"application/json"}
    });
  }
  let data;
  try { data = JSON.parse(rawBody); }
  catch { return new Response(JSON.stringify({success:false,message:"Invalid JSON"}), {status:400,headers:{"Content-Type":"application/json"}}); }

  const direction = String(data.transferType || "").toLowerCase();
  if (direction !== "in") return new Response(JSON.stringify({success:true}), {status:200,headers:{"Content-Type":"application/json"}});

  const content = String(data.content || data.code || "").toUpperCase();
  const match = content.match(/LOCKET(?:\d{6}|[A-F0-9]{12})/);
  const code = match?.[0];
  const amount = Number(data.transferAmount);
  const tx = String(data.id ?? "").trim();
  if (!code || !tx || !Number.isSafeInteger(amount) || amount <= 0) {
    return new Response(JSON.stringify({success:false,message:"Missing payment fields"}), {status:400,headers:{"Content-Type":"application/json"}});
  }

  const order = await env.DB.prepare("SELECT * FROM orders WHERE order_code=?").bind(code).first();
  // Acknowledge unrelated transfers; only exact order code + exact amount can mark an order paid.
  if (!order || order.amount !== amount) {
    return new Response(JSON.stringify({success:true}), {status:200,headers:{"Content-Type":"application/json"}});
  }
  if (order.status !== "pending" || Date.now() > order.expires_at) {
    return new Response(JSON.stringify({success:true}), {status:200,headers:{"Content-Type":"application/json"}});
  }

  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO payments(transaction_id,order_code,amount) VALUES(?,?,?)"
  ).bind(tx, code, amount).run();
  if (inserted.meta.changes !== 1) {
    return new Response(JSON.stringify({success:true}), {status:200,headers:{"Content-Type":"application/json"}});
  }

  const update = await env.DB.prepare(
    "UPDATE orders SET status='paid' WHERE id=? AND status='pending' AND amount=?"
  ).bind(order.id, amount).run();
  if (update.meta.changes === 1) await activatePaidOrder(order, env);
  return new Response(JSON.stringify({success:true}), {status:200,headers:{"Content-Type":"application/json"}});
}

async function recentPurchases(env, origin) {
  const rows = await env.DB.prepare(
    "SELECT username, plan, status, created_at FROM orders WHERE status = 'completed' ORDER BY created_at DESC LIMIT 12"
  ).all();
  const names = Object.fromEntries(PLANS.map(p => [p.id, p.name]));
  const items = (rows.results || []).map(row => {
    const raw = String(row.username || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
    const user = (raw.split(/[/?#]/)[0] || "Khách hàng").replace(/[^a-zA-Z0-9_.-]/g, "");
    const buyer = user.length <= 2 ? user[0] + "***" : user.slice(0, 2) + "***";
    return { buyer, plan_name: names[row.plan] || "Locket Gold", created_at: Number(row.created_at) };
  });
  return json({ items }, 200, origin || "");
}


function hasSiteAdmin(request, env) {
 const auth=request.headers.get("Authorization")||"";
 return !!env.SITE_ADMIN_TOKEN && secureEqual(auth,"Bearer "+env.SITE_ADMIN_TOKEN);
}
async function getInstallVideo(env, origin) {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='install_video_url'").first();
  return json({video_url: row?.value || ""}, 200, origin || "");
}
function validInstallVideoUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && (["youtube.com","www.youtube.com","youtu.be","www.youtu.be","vimeo.com","www.vimeo.com","player.vimeo.com"].includes(u.hostname) || /\.mp4$/i.test(u.pathname)); } catch { return false; }
}
async function saveInstallVideo(request, env, origin) {
  if (!hasSiteAdmin(request, env)) return json({error:"Mã quản lý không đúng."},401,origin||"");
  let body; try { body = await request.json(); } catch { return json({error:"Dữ liệu JSON không hợp lệ."},400,origin||""); }
  const value = String(body.video_url || "").trim();
  if (value && !validInstallVideoUrl(value)) return json({error:"Chỉ nhận link HTTPS YouTube, Vimeo hoặc MP4."},400,origin||"");
  await env.DB.prepare("INSERT INTO site_settings(key,value,updated_at) VALUES('install_video_url',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(value,Date.now()).run();
  return json({success:true,video_url:value},200,origin||"");
}
async function processUpgrade(request, env) {
  const auth=request.headers.get("Authorization")||"";
  if(!env.INTERNAL_SECRET || !secureEqual(auth,`Bearer ${env.INTERNAL_SECRET}`)) return json({error:"Unauthorized"},401,"");
  let body; try{body=await request.json();}catch{return json({error:"Bad JSON"},400,"");}
  const order=await env.DB.prepare("SELECT * FROM orders WHERE order_code=? AND status IN ('paid','activation_failed')").bind(String(body.order_code||"")).first();
  if(!order) return json({error:"Đơn chưa thanh toán hoặc không tồn tại"},400,"");
  if(order.status==="activation_failed") await env.DB.prepare("UPDATE orders SET status='paid', provider_error=NULL WHERE id=? AND status='activation_failed'").bind(order.id).run();
  await activatePaidOrder(order,env);
  const after=await env.DB.prepare("SELECT status,provider_error FROM orders WHERE id=?").bind(order.id).first();
  return json({success:after?.status==="completed",status:after?.status||"paid",error:after?.provider_error||null});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    const origin=allowedOrigin(request,env);
    if(request.method==="OPTIONS"){
      if(origin===null) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type, X-Webhook-Secret, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"
      }});
    }
    const isWebhook=url.pathname==="/webhook/sepay";
    if(!isWebhook && origin===null) return json({error:"Origin not allowed"},403,"");
    try{
      if(request.method==="GET" && url.pathname==="/health") return json({ok:Boolean(env.DB),service:"Locket Gold order API",database:Boolean(env.DB)},env.DB?200:503,origin||"");
      if(!env.DB) return json({error:"D1 binding DB chưa được cấu hình."},503,origin||"");
      if(request.method==="GET" && url.pathname==="/plans") return json({plans:publicPlans()},200,origin||"");
      if(request.method==="POST" && url.pathname==="/lookup-install-link") return await lookupInstallLink(request,env,origin||"");
      if(request.method==="POST" && url.pathname==="/verify-account") {
        if(!await rateLimit(request,env)) return json({success:false,error:"Bạn thao tác quá nhanh. Vui lòng thử lại sau."},429,origin||"");
        let body; try{body=await request.json();}catch{return json({success:false,error:"Dữ liệu không hợp lệ."},400,origin||"");}
        const raw=String(body.username||"").trim();
        if(!raw||raw.length>200||/[<>]/.test(raw)) return json({success:false,error:"Username hoặc link không hợp lệ."},400,origin||"");
        let username=raw;
        try {
          if(/^https?:\/\//i.test(raw)) {
            const u=new URL(raw);
            if(!/(^|\.)locket\.cam$/i.test(u.hostname)) return json({success:false,error:"Hãy nhập username hoặc link trang cá nhân locket.cam."},400,origin||"");
            username=u.pathname.split("/").filter(Boolean).pop()||"";
          }
        } catch { return json({success:false,error:"Link Locket không hợp lệ."},400,origin||""); }
        username=username.replace(/^@/,"").trim();
        if(!username||username.length>100) return json({success:false,error:"Username Locket không hợp lệ."},400,origin||"");
        const verification=await verifyLocketAccount(username,env);
        if(!verification.ok) return json({success:false,error:verification.error},verification.status,origin||"");
        return json({success:true,profile:verification.profile,gold_status:verification.goldStatus,gold_checked:true},200,origin||"");
      }
      if(request.method==="GET" && url.pathname==="/recent-purchases") return await recentPurchases(env, origin);
      if(request.method==="GET" && url.pathname==="/install-video") return await getInstallVideo(env,origin);
      if(request.method==="POST" && url.pathname==="/admin/install-video") return await saveInstallVideo(request,env,origin);
      if(request.method==="POST" && url.pathname==="/create-order") return await createOrder(request,env,origin||"");
      if(request.method==="GET" && url.pathname==="/check-payment") return await checkPayment(request,env,origin||"");
      if(request.method==="POST" && url.pathname==="/webhook/sepay") { const rawBody=await request.text(); return await paymentWebhook(request,env,rawBody); }
      if(request.method==="POST" && url.pathname==="/process-upgrade") return await processUpgrade(request,env);
      return json({error:"Not found"},404,origin||"");
    }catch(e){console.error("Worker error",e);return json({error:"Internal server error"},500,origin||"");}
  }
};