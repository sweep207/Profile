// Cloudflare Worker — Locket Plus order backend
// Giá và thông tin gói chỉ cấu hình tại PLANS bên dưới.
// Không đặt API key / webhook secret trong frontend hoặc GitHub.

const PLANS = [
  { id:"trial", label:"DÙNG THỬ", name:"Locket Gold Trial", duration:"1 ngày", price:4000, compare_at:0, badge:"TRIAL", featured:true, button_text:"Đang chọn gói này", features:["Hạn sử dụng: 1 ngày","Quay video 30 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"pro", label:"PRO", name:"Locket Gold Pro", duration:"180 ngày", price:30000, compare_at:0, badge:"PRO", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 6 tháng","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"premium", label:"PREMIUM", name:"Locket Gold Premium", duration:"365 ngày", price:50000, compare_at:0, badge:"PREMIUM", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: 1 năm","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] },
  { id:"forever", label:"FOREVER", name:"Locket Gold Forever", duration:"Trọn đời", price:130000, compare_at:0, badge:"FOREVER", featured:false, button_text:"Chọn gói này", features:["Hạn sử dụng: Vĩnh viễn","Quay video 60 giây","Up ảnh và video từ bộ sưu tập","Ghi âm khi quay video","Khung widget tuỳ chỉnh","Photobooth cực đẹp","Filter AI siêu xịn","Tặng Spotify Premium miễn phí","Không liên quan đến iCloud"] }
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
function orderCode() {
  return "LOCKET" + crypto.randomUUID().replaceAll("-","").slice(0,12).toUpperCase();
}
function publicPlans() {
  return PLANS.map(({id,label,name,duration,price,compare_at,badge,featured,button_text,features}) =>
    ({id,label,name,duration,price,compare_at,badge,featured,button_text,features}));
}
async function rateLimit(request, env) {
  const ip=request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket=Math.floor(Date.now()/60000);
  const key=ip+":"+bucket;
  const row=await env.DB.prepare("SELECT hits FROM rate_limits WHERE rate_key=?").bind(key).first();
  if(row && row.hits>=8) return false;
  await env.DB.prepare(`
    INSERT INTO rate_limits(rate_key,hits,expires_at) VALUES(?,?,?)
    ON CONFLICT(rate_key) DO UPDATE SET hits=hits+1
  `).bind(key,1,(bucket+2)*60000).run();
  return true;
}
async function createOrder(request, env, origin) {
  if(!await rateLimit(request,env)) return json({error:"Bạn thao tác quá nhanh. Vui lòng thử lại sau."},429,origin);
  let body; try{body=await request.json();}catch{return json({error:"Dữ liệu không hợp lệ"},400,origin);}
  const username=String(body.username||"").trim();
  const plan=PLANS.find(p=>p.id===String(body.plan||""));
  if(!username || username.length>100 || /[<>]/.test(username)) return json({error:"Username hoặc link không hợp lệ"},400,origin);
  if(!plan || !Number.isSafeInteger(plan.price) || plan.price<=0) return json({error:"Gói dịch vụ chưa được cấu hình hợp lệ"},400,origin);
  if(!env.BANK_ID || !env.BANK_ACCOUNT || !env.BANK_ACCOUNT_NAME) return json({error:"Máy chủ chưa cấu hình tài khoản nhận tiền"},503,origin);

  const id=crypto.randomUUID(), code=orderCode(), expires=Date.now()+10*60*1000;
  await env.DB.prepare(`
    INSERT INTO orders(id,order_code,username,plan,amount,status,expires_at)
    VALUES(?,?,?,?,?,'pending',?)
  `).bind(id,code,username,plan.id,plan.price,expires).run();

  const qr=new URL(`https://img.vietqr.io/image/${encodeURIComponent(env.BANK_ID)}-${encodeURIComponent(env.BANK_ACCOUNT)}-compact2.png`);
  qr.searchParams.set("amount",String(plan.price));
  qr.searchParams.set("addInfo",code);
  qr.searchParams.set("accountName",env.BANK_ACCOUNT_NAME);
  return json({success:true,order_code:code,amount:plan.price,plan:plan.name,expires_at:expires,qr_url:qr.toString()},200,origin);
}
async function checkPayment(request, env, origin) {
  const code=new URL(request.url).searchParams.get("order_code");
  if(!code || !/^LOCKET[A-F0-9]{12}$/.test(code)) return json({error:"Mã đơn không hợp lệ"},400,origin);
  const row=await env.DB.prepare("SELECT order_code,amount,plan,status,expires_at,install_url,activation_code,provider_error FROM orders WHERE order_code=?").bind(code).first();
  if(!row) return json({error:"Không tìm thấy đơn hàng"},404,origin);
  if(row.status==="pending" && Date.now()>row.expires_at){
    await env.DB.prepare("UPDATE orders SET status='expired' WHERE order_code=? AND status='pending'").bind(code).run();
    row.status="expired";
  }
  return json({success:true,order_code:row.order_code,amount:row.amount,plan:row.plan,status:row.status,expires_at:row.expires_at,install_url:row.install_url||null,activation_code:row.activation_code||null,provider_error:row.provider_error||null},200,origin);
}
async function activatePaidOrder(order, env) {
  if (!env.UPLOCKET_API_KEY) {
    console.error("UPLOCKET_API_KEY is not configured; order remains paid.");
    return;
  }
  const plan = PLANS.find(p => p.id === order.plan);
  if (!plan) {
    await env.DB.prepare("UPDATE orders SET status='activation_failed', provider_error=? WHERE id=? AND status='paid'").bind("Không tìm thấy cấu hình gói dịch vụ.", order.id).run();
    return;
  }
  const claimed = await env.DB.prepare("UPDATE orders SET status='processing' WHERE id=? AND status='paid'").bind(order.id).run();
  if (claimed.meta?.changes !== 1) return;
  const durationDays = ({trial:1, pro:180, premium:365, forever:9999})[plan.id];
  try {
    const response = await fetch("https://uplocket.io.vn/api/v1/dns/export", {
      method: "POST",
      headers: {"Authorization":"Bearer " + env.UPLOCKET_API_KEY,"Content-Type":"application/json","Accept":"application/json"},
      body: JSON.stringify({username:order.username,durationDays,packageName:plan.name})
    });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Uplocket trả về dữ liệu không hợp lệ (HTTP " + response.status + ")."); }
    if (!response.ok || data.success !== true || !data.data) {
      throw new Error("Uplocket: " + String(data.error || data.message || ("HTTP " + response.status)).slice(0, 500));
    }
    const d = data.data;
    await env.DB.prepare("UPDATE orders SET status='completed', provider_activation_id=?, activation_code=?, install_url=?, provider_error=NULL WHERE id=? AND status='processing'")
      .bind(String(d.id || ""),String(d.activationCode || ""),String(d.installUrl || d.downloadUrl || d.enrollUrl || d.url || ""),order.id).run();
  } catch (e) {
    const message = String(e?.message || "Không xác định").slice(0, 500);
    console.error("Uplocket activation error:", message);
    await env.DB.prepare("UPDATE orders SET status='activation_failed', provider_error=? WHERE id=? AND status='processing'").bind(message,order.id).run();
  }
}
async function verifySePayApiKey(request, env) {
  // SePay API Key webhook sends: Authorization: Apikey YOUR_API_KEY
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Apikey\\s+(.+)$/i);
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
  const match = content.match(/LOCKET[A-F0-9]{12}/);
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


function hasFrameAdmin(request, env) {
  const auth = request.headers.get("Authorization") || "";
  return !!env.FRAME_ADMIN_TOKEN && secureEqual(auth, "Bearer " + env.FRAME_ADMIN_TOKEN);
}
async function listFrames(env, origin) {
  const result = await env.DB.prepare("SELECT id,title,category,note,created_at FROM frames WHERE active=1 ORDER BY created_at DESC").all();
  return json({frames:(result.results||[]).map(row=>({...row,image_url:"/frame-image/"+row.id}))},200,origin||"");
}
async function addFrame(request, env, origin) {
  if (!hasFrameAdmin(request,env)) return json({error:"Mã quản lý không đúng."},401,origin||"");
  if (!env.FRAMES_BUCKET) return json({error:"Chưa cấu hình R2 bucket FRAMES_BUCKET."},503,origin||"");
  const form=await request.formData();
  const title=String(form.get("title")||"").trim().slice(0,80);
  const category=String(form.get("category")||"Khung mới").trim().slice(0,40);
  const note=String(form.get("note")||"").trim().slice(0,120);
  const file=form.get("image");
  if(!title || !(file instanceof File) || !file.size) return json({error:"Nhập tên khung và chọn ảnh."},400,origin||"");
  if(file.size>5*1024*1024) return json({error:"Ảnh tối đa 5 MB."},400,origin||"");
  const allowed={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
  const ext=allowed[file.type];
  if(!ext) return json({error:"Chỉ nhận ảnh JPG, PNG hoặc WEBP."},400,origin||"");
  const id=crypto.randomUUID();
  const key="frames/"+id+"."+ext;
  await env.FRAMES_BUCKET.put(key,file.stream(),{httpMetadata:{contentType:file.type}});
  try {
    await env.DB.prepare("INSERT INTO frames(id,title,category,note,image_key,active,created_at) VALUES(?,?,?,?,?,1,?)")
      .bind(id,title,category,note,key,Date.now()).run();
  } catch(e) {
    await env.FRAMES_BUCKET.delete(key);
    throw e;
  }
  return json({success:true,id},201,origin||"");
}
async function removeFrame(request, id, env, origin) {
  if (!hasFrameAdmin(request,env)) return json({error:"Mã quản lý không đúng."},401,origin||"");
  const row=await env.DB.prepare("SELECT image_key FROM frames WHERE id=?").bind(id).first();
  if(!row) return json({error:"Không tìm thấy khung."},404,origin||"");
  await env.DB.prepare("DELETE FROM frames WHERE id=?").bind(id).run();
  if(env.FRAMES_BUCKET && row.image_key) await env.FRAMES_BUCKET.delete(row.image_key);
  return json({success:true},200,origin||"");
}
async function getInstallVideo(env, origin) {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key='install_video_url'").first();
  return json({video_url: row?.value || ""}, 200, origin || "");
}
function validInstallVideoUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && (["youtube.com","www.youtube.com","youtu.be","www.youtu.be","vimeo.com","www.vimeo.com","player.vimeo.com"].includes(u.hostname) || /\.mp4$/i.test(u.pathname)); } catch { return false; }
}
async function saveInstallVideo(request, env, origin) {
  if (!hasFrameAdmin(request, env)) return json({error:"Mã quản lý không đúng."},401,origin||"");
  let body; try { body = await request.json(); } catch { return json({error:"Dữ liệu JSON không hợp lệ."},400,origin||""); }
  const value = String(body.video_url || "").trim();
  if (value && !validInstallVideoUrl(value)) return json({error:"Chỉ nhận link HTTPS YouTube, Vimeo hoặc MP4."},400,origin||"");
  await env.DB.prepare("INSERT INTO site_settings(key,value,updated_at) VALUES('install_video_url',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(value,Date.now()).run();
  return json({success:true,video_url:value},200,origin||"");
}
async function serveFrameImage(id, env) {
  if(!env.FRAMES_BUCKET) return new Response("Frames storage is not configured",{status:503});
  const row=await env.DB.prepare("SELECT image_key FROM frames WHERE id=? AND active=1").bind(id).first();
  if(!row) return new Response("Not found",{status:404});
  const object=await env.FRAMES_BUCKET.get(row.image_key);
  if(!object) return new Response("Not found",{status:404});
  const headers=new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control","public, max-age=86400");
  headers.set("X-Content-Type-Options","nosniff");
  return new Response(object.body,{headers});
}

async function processUpgrade(request, env) {
  const auth=request.headers.get("Authorization")||"";
  if(!env.INTERNAL_SECRET || !secureEqual(auth,`Bearer ${env.INTERNAL_SECRET}`)) return json({error:"Unauthorized"},401,"");
  let body; try{body=await request.json();}catch{return json({error:"Bad JSON"},400,"");}
  const order=await env.DB.prepare("SELECT * FROM orders WHERE order_code=? AND status='paid'").bind(String(body.order_code||"")).first();
  if(!order) return json({error:"Đơn chưa thanh toán hoặc không tồn tại"},400,"");
  await activatePaidOrder(order,env);
  const after=await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(order.id).first();
  return json({success:true,status:after?.status||"paid"});
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);\n    if (!env.DB && url.pathname !== "/health") return json({error:"D1 binding DB chưa được cấu hình."},503);\n    const origin=allowedOrigin(request,env);
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
      if(request.method==="GET" && url.pathname==="/health") return json({ok:true,service:"Locket Gold order API"});
      if(request.method==="GET" && url.pathname==="/plans") return json({plans:publicPlans()},200,origin||"");
      if(request.method==="GET" && url.pathname==="/recent-purchases") return await recentPurchases(env, origin);
      if(request.method==="GET" && url.pathname==="/frames") return await listFrames(env,origin);
      if(request.method==="GET" && url.pathname==="/install-video") return await getInstallVideo(env,origin);
      if(request.method==="POST" && url.pathname==="/admin/install-video") return await saveInstallVideo(request,env,origin);
      if(request.method==="POST" && url.pathname==="/admin/frames") return await addFrame(request,env,origin);
      if(request.method==="DELETE" && url.pathname.startsWith("/admin/frames/")) return await removeFrame(request,url.pathname.split("/").pop(),env,origin);
      if(request.method==="GET" && url.pathname.startsWith("/frame-image/")) return await serveFrameImage(url.pathname.split("/").pop(),env);
      if(request.method==="POST" && url.pathname==="/create-order") return await createOrder(request,env,origin||"");
      if(request.method==="GET" && url.pathname==="/check-payment") return await checkPayment(request,env,origin||"");
      if(request.method==="POST" && url.pathname==="/webhook/sepay") { const rawBody=await request.text(); return await paymentWebhook(request,env,rawBody); }
      if(request.method==="POST" && url.pathname==="/process-upgrade") return await processUpgrade(request,env);
      return json({error:"Not found"},404,origin||"");
    }catch(e){console.error("Worker error",e);return json({error:"Internal server error"},500,origin||"");}
  }
};