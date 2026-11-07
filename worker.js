// Cloudflare Worker — Locket Plus order backend
// Giá và thông tin gói chỉ cấu hình tại PLANS bên dưới.
// Không đặt API key / webhook secret trong frontend hoặc GitHub.

const PLANS = [
  {
    id: "month",
    label: "LINH HOẠT",
    name: "Gói 1 Tháng",
    duration: "30 ngày",
    price: 30000, // SỬA GIÁ TẠI ĐÂY (VND)
    compare_at: 49000,
    badge: "",
    featured: false,
    button_text: "Chọn gói 1 tháng",
    features: ["Thời hạn 30 ngày", "Hỗ trợ theo chính sách dịch vụ", "Theo dõi đơn hàng trực tuyến"]
  },
  {
    id: "year",
    label: "TIẾT KIỆM",
    name: "Gói 1 Năm",
    duration: "365 ngày",
    price: 150000, // SỬA GIÁ TẠI ĐÂY (VND)
    compare_at: 199000,
    badge: "ĐƯỢC CHỌN NHIỀU",
    featured: true,
    button_text: "Chọn gói 1 năm",
    features: ["Thời hạn 365 ngày", "Hỗ trợ theo chính sách dịch vụ", "Theo dõi đơn hàng trực tuyến"]
  },
  {
    id: "lifetime",
    label: "TRỌN ĐỜI",
    name: "Gói Vĩnh Viễn",
    duration: "Theo điều kiện nhà cung cấp",
    price: 300000, // SỬA GIÁ TẠI ĐÂY (VND)
    compare_at: 399000,
    badge: "",
    featured: false,
    button_text: "Chọn gói vĩnh viễn",
    features: ["Thanh toán một lần", "Hỗ trợ theo chính sách dịch vụ", "Theo dõi đơn hàng trực tuyến"]
  }
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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  const row=await env.DB.prepare("SELECT order_code,amount,plan,status,expires_at FROM orders WHERE order_code=?").bind(code).first();
  if(!row) return json({error:"Không tìm thấy đơn hàng"},404,origin);
  if(row.status==="pending" && Date.now()>row.expires_at){
    await env.DB.prepare("UPDATE orders SET status='expired' WHERE order_code=? AND status='pending'").bind(code).run();
    row.status="expired";
  }
  return json({success:true,order_code:row.order_code,amount:row.amount,plan:row.plan,status:row.status,expires_at:row.expires_at},200,origin);
}
async function activatePaidOrder(order, env) {
  if(!env.UPGRADER_API_URL || !env.UPGRADER_API_KEY) return;
  // Chỉ gọi API kích hoạt do bạn sở hữu hoặc được nhà cung cấp cho phép.
  await env.DB.prepare("UPDATE orders SET status='processing' WHERE id=? AND status='paid'").bind(order.id).run();
  try {
    const r=await fetch(env.UPGRADER_API_URL,{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${env.UPGRADER_API_KEY}`},
      body:JSON.stringify({order_code:order.order_code,username:order.username,plan:order.plan,amount:order.amount})
    });
    if(!r.ok) throw new Error("Provider returned "+r.status);
    const data=await r.json();
    if(data.success!==true) throw new Error("Provider did not confirm success");
    await env.DB.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='processing'").bind(order.id).run();
  } catch(e) {
    console.error("Activation error",e);
    await env.DB.prepare("UPDATE orders SET status='activation_failed' WHERE id=? AND status='processing'").bind(order.id).run();
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
    const url=new URL(request.url), origin=allowedOrigin(request,env);
    if(request.method==="OPTIONS"){
      if(origin===null) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":origin||"null","Access-Control-Allow-Methods":"GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":"Content-Type, X-Webhook-Secret, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"
      }});
    }
    const isWebhook=url.pathname==="/webhook/sepay";
    if(!isWebhook && origin===null) return json({error:"Origin not allowed"},403,"");
    try{
      if(request.method==="GET" && url.pathname==="/health") return json({ok:true});
      if(request.method==="GET" && url.pathname==="/plans") return json({plans:publicPlans()},200,origin||"");
      if(request.method==="POST" && url.pathname==="/create-order") return await createOrder(request,env,origin||"");
      if(request.method==="GET" && url.pathname==="/check-payment") return await checkPayment(request,env,origin||"");
      if(request.method==="POST" && url.pathname==="/webhook/sepay") { const rawBody=await request.text(); return await paymentWebhook(request,env,rawBody); }
      if(request.method==="POST" && url.pathname==="/process-upgrade") return await processUpgrade(request,env);
      return json({error:"Not found"},404,origin||"");
    }catch(e){console.error("Worker error",e);return json({error:"Internal server error"},500,origin||"");}
  }
};