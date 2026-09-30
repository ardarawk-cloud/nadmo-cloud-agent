import hashlib,hmac,json,os,sqlite3,threading,time,urllib.error,urllib.parse,urllib.request,uuid
from datetime import datetime,timezone
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlparse

HOST="127.0.0.1"; PORT=int(os.getenv("PORT","8792"))
DB=os.getenv("BIDIGI_DB","/var/lib/nadmo/bidigi.db")
BASE="https://api.digiflazz.com/v1"
PUBLIC=os.getenv("BIDIGI_PUBLIC_BASE","https://bidigi.nadmo.id").rstrip("/")
MARKUP=int(float(os.getenv("BIDIGI_MARKUP_FLAT","1500"))); PCT=float(os.getenv("BIDIGI_MARKUP_PERCENT","0"))
SYNC=max(900,int(os.getenv("BIDIGI_SYNC_SECONDS","1800")))
LOCK=threading.RLock()

def E(n,d=""): return os.getenv(n,d).strip()
def now(): return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
def digi_ok(): return bool(E("DIGIFLAZZ_USERNAME") and E("DIGIFLAZZ_API_KEY"))
def pay_ok(): return bool(E("IPAYMU_VA") and E("IPAYMU_API_KEY"))
def price(v): return max(0,int(round(int(float(v or 0))*(1+PCT/100)))+MARKUP)
def conn():
    Path(DB).parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB,timeout=30,check_same_thread=False); c.row_factory=sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL"); return c
def init():
    with LOCK,conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS products(kind TEXT,sku TEXT,product_name TEXT,category TEXT,ui_category TEXT,brand TEXT,type TEXT,description TEXT,cost INTEGER DEFAULT 0,admin INTEGER DEFAULT 0,commission INTEGER DEFAULT 0,sell_price INTEGER DEFAULT 0,buyer_active INTEGER DEFAULT 0,seller_active INTEGER DEFAULT 0,raw_json TEXT DEFAULT '{}',updated_at TEXT,PRIMARY KEY(kind,sku));
        CREATE INDEX IF NOT EXISTS p_ui ON products(ui_category,brand,sell_price);
        CREATE TABLE IF NOT EXISTS orders(ref_id TEXT PRIMARY KEY,kind TEXT,sku TEXT,product_name TEXT,customer_no TEXT,buyer_name TEXT DEFAULT '',buyer_phone TEXT DEFAULT '',buyer_email TEXT DEFAULT '',cost INTEGER DEFAULT 0,sell_price INTEGER DEFAULT 0,payment_status TEXT DEFAULT 'unpaid',payment_provider TEXT DEFAULT '',payment_ref TEXT DEFAULT '',payment_url TEXT DEFAULT '',supplier_status TEXT DEFAULT 'not_started',supplier_rc TEXT DEFAULT '',supplier_message TEXT DEFAULT '',sn TEXT DEFAULT '',status TEXT DEFAULT 'created',raw_json TEXT DEFAULT '{}',created_at TEXT,updated_at TEXT);
        CREATE TABLE IF NOT EXISTS callbacks(provider TEXT,event_id TEXT,payload_json TEXT,created_at TEXT,PRIMARY KEY(provider,event_id));
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
        """); c.commit()
def meta(k,v=None):
    with LOCK,conn() as c:
        if v is None:
            r=c.execute("SELECT value FROM meta WHERE key=?",(k,)).fetchone(); return r["value"] if r else ""
        c.execute("INSERT INTO meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",(k,str(v),now())); c.commit()
def req_json(url,payload,headers=None):
    raw=json.dumps(payload,ensure_ascii=False,separators=(",",":")).encode()
    h={"Content-Type":"application/json","Accept":"application/json"}; h.update(headers or {})
    r=urllib.request.Request(url,data=raw,method="POST",headers=h)
    try:
        with urllib.request.urlopen(r,timeout=45) as x: b=x.read(); s=x.status
    except urllib.error.HTTPError as x: b=x.read(); s=x.code
    try: d=json.loads(b.decode()) if b else {}
    except: d={"raw":b.decode("utf-8","replace")}
    return s,d
def dsign(x): return hashlib.md5((E("DIGIFLAZZ_USERNAME")+E("DIGIFLAZZ_API_KEY")+x).encode()).hexdigest()
def category(kind,cat,brand,typ,name):
    t=" ".join([cat,brand,typ,name]).lower()
    if kind=="postpaid": return "Tagihan"
    if "esim" in t or "e-sim" in t: return "eSIM"
    if "game" in t: return "Top Up Game"
    if "pln" in t or "listrik" in t: return "PLN"
    if any(x in t for x in ("e-money","emoney","e-wallet","ewallet","dana","ovo","gopay","shopeepay","linkaja")): return "E-Wallet"
    if "data" in t or "internet" in t: return "Paket Data"
    if "pulsa" in t or "reload" in t: return "Pulsa"
    return cat or "Lainnya"
def product_count(kind=None):
    with LOCK,conn() as c:
        if kind:
            return int(c.execute("SELECT COUNT(*) c FROM products WHERE kind=?",(kind,)).fetchone()["c"])
        return int(c.execute("SELECT COUNT(*) c FROM products").fetchone()["c"])

def sync_products(kind=None):
    if not digi_ok(): return {"ok":False,"error":"DIGIFLAZZ_NOT_CONFIGURED"}
    now_ts=int(time.time())
    try:last_attempt=int(meta("last_pricelist_attempt") or "0")
    except:last_attempt=0
    wait=max(0,305-(now_ts-last_attempt))
    if wait>0:
        return {"ok":False,"error":"PRICELIST_LOCAL_COOLDOWN","retry_after":wait}
    if kind not in ("prepaid","postpaid"):
        if product_count("prepaid")==0:
            kind="prepaid"
        elif product_count("postpaid")==0:
            kind="postpaid"
        else:
            kind="postpaid" if meta("last_pricelist_kind")=="prepaid" else "prepaid"
    cmd="prepaid" if kind=="prepaid" else "pasca"
    meta("last_pricelist_attempt",str(now_ts)); meta("last_pricelist_kind",kind)
    s,d=req_json(BASE+"/price-list",{"cmd":cmd,"username":E("DIGIFLAZZ_USERNAME"),"sign":dsign("pricelist")})
    rows=d.get("data") if isinstance(d,dict) else None
    if s>=400 or not isinstance(rows,list):
        rc=str((d.get("data") or {}).get("rc") or "") if isinstance(d,dict) else ""
        msg=str((d.get("data") or {}).get("message") or d)[:500] if isinstance(d,dict) else str(d)[:500]
        return {"ok":False,"error":"PRICELIST_UPSTREAM","kind":kind,"rc":rc,"message":msg,"retry_after":300 if rc=="83" else 0}
    seen=[]
    with LOCK,conn() as c:
        for x in rows:
            sku=str(x.get("buyer_sku_code") or "").strip()
            if not sku: continue
            seen.append(sku); name=str(x.get("product_name") or x.get("brand") or sku); cat=str(x.get("category") or ""); brand=str(x.get("brand") or ""); typ=str(x.get("type") or ""); desc=str(x.get("desc") or "")
            cost=int(float(x.get("price") or 0)) if kind=="prepaid" else 0
            sell=price(cost) if kind=="prepaid" else 0
            c.execute("""INSERT INTO products(kind,sku,product_name,category,ui_category,brand,type,description,cost,admin,commission,sell_price,buyer_active,seller_active,raw_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(kind,sku) DO UPDATE SET product_name=excluded.product_name,category=excluded.category,ui_category=excluded.ui_category,brand=excluded.brand,type=excluded.type,description=excluded.description,cost=excluded.cost,admin=excluded.admin,commission=excluded.commission,sell_price=excluded.sell_price,buyer_active=excluded.buyer_active,seller_active=excluded.seller_active,raw_json=excluded.raw_json,updated_at=excluded.updated_at""",
            (kind,sku,name,cat,category(kind,cat,brand,typ,name),brand,typ,desc,cost,int(float(x.get("admin") or 0)),int(float(x.get("commission") or 0)),sell,1 if x.get("buyer_product_status",True) else 0,1 if x.get("seller_product_status",True) else 0,json.dumps(x,ensure_ascii=False,separators=(",",":")),now()))
        c.commit()
    stamp=now(); meta("last_sync_"+kind,stamp); meta("last_sync",stamp)
    return {"ok":True,"kind":kind,"count":len(seen),"next_kind":"postpaid" if kind=="prepaid" else "prepaid"}
def balance():
    if not digi_ok(): raise RuntimeError("DIGIFLAZZ_NOT_CONFIGURED")
    return req_json(BASE+"/cek-saldo",{"cmd":"deposit","username":E("DIGIFLAZZ_USERNAME"),"sign":dsign("depo")})
def dtrx(o,command=None):
    p={"username":E("DIGIFLAZZ_USERNAME"),"buyer_sku_code":o["sku"],"customer_no":o["customer_no"],"ref_id":o["ref_id"],"sign":dsign(o["ref_id"])}
    if E("DIGIFLAZZ_TESTING","true").lower() in ("1","true","yes","on"): p["testing"]=True
    if command: p["commands"]=command
    elif int(o["cost"] or 0): p["max_price"]=int(o["cost"])
    if E("DIGIFLAZZ_WEBHOOK_SECRET"): p["cb_url"]=PUBLIC+"/api/digiflazz/webhook"
    return req_json(BASE+"/transaction",p)
def order(ref):
    with LOCK,conn() as c: return c.execute("SELECT * FROM orders WHERE ref_id=?",(ref,)).fetchone()
def pub(r):
    if not r:return None
    return {k:r[k] for k in ("ref_id","kind","sku","product_name","customer_no","sell_price","payment_status","payment_url","supplier_status","supplier_rc","supplier_message","sn","status","created_at","updated_at")}
def upd(ref,**f):
    f["updated_at"]=now(); ks=list(f)
    with LOCK,conn() as c: c.execute("UPDATE orders SET "+",".join(k+"=?" for k in ks)+" WHERE ref_id=?",[f[k] for k in ks]+[ref]); c.commit()
def ipaymu_payment(o):
    secret=E("IPAYMU_API_KEY"); va=E("IPAYMU_VA"); env=E("IPAYMU_ENV","sandbox").lower()
    base="https://my.ipaymu.com" if env=="production" else "https://sandbox.ipaymu.com"
    p={"name":o["buyer_name"],"phone":o["buyer_phone"],"email":o["buyer_email"],"amount":int(o["sell_price"]),"notifyUrl":PUBLIC+"/api/payment/ipaymu/callback","successUrl":PUBLIC+"/?payment=success&ref="+urllib.parse.quote(o["ref_id"]),"cancelUrl":PUBLIC+"/?payment=cancel&ref="+urllib.parse.quote(o["ref_id"]),"referenceId":o["ref_id"],"paymentMethod":"qris","paymentChannel":"mpm","product":[o["product_name"]],"qty":[1],"price":[int(o["sell_price"])]}
    raw=json.dumps(p,ensure_ascii=False,separators=(",",":")).encode(); bh=hashlib.sha256(raw).hexdigest().lower()
    sig=hmac.new(secret.encode(),("POST:"+va+":"+bh+":"+secret).encode(),hashlib.sha256).hexdigest()
    r=urllib.request.Request(base+"/api/v2/payment/direct",data=raw,method="POST",headers={"Content-Type":"application/json","va":va,"signature":sig,"timestamp":datetime.now().strftime("%Y%m%d%H%M%S")})
    try:
        with urllib.request.urlopen(r,timeout=45) as x:b=x.read();s=x.status
    except urllib.error.HTTPError as x:b=x.read();s=x.code
    try:d=json.loads(b.decode())
    except:d={"raw":b.decode("utf-8","replace")}
    return s,d
def ipaymu_valid(data,got):
    if not pay_ok() or not got:return False
    out={}
    for k,v in data.items():
        if isinstance(v,list) and len(v)==1:v=v[0]
        if k=="is_escrow": out[k]=str(v).lower() in ("true","1")
        elif k in ("trx_id","status_code","transaction_status_code","paid_off"):
            try:out[k]=int(v)
            except:out[k]=0
        elif k=="additional_info":out[k]=[] if v in ("",None,"[]") else v
        elif k!="signature":out[k]=str(v) if v is not None else ""
    out.setdefault("additional_info",[]); out={k:out[k] for k in sorted(out)}
    raw=json.dumps(out,ensure_ascii=False,separators=(",",":")).replace("/","\\/")
    calc=hmac.new(E("IPAYMU_VA").encode(),raw.encode(),hashlib.sha256).hexdigest()
    return hmac.compare_digest(calc.lower(),got.strip().lower())
def digi_webhook_valid(raw,got):
    sec=E("DIGIFLAZZ_WEBHOOK_SECRET")
    if not sec or not got:return False
    calc=hmac.new(sec.encode(),raw,hashlib.sha1).hexdigest(); got=got.lower().replace("sha1=","")
    return hmac.compare_digest(calc,got)
def fulfill(ref):
    r=order(ref)
    if not r or r["payment_status"]!="paid" or r["supplier_status"]=="success":return
    upd(ref,supplier_status="submitting",status="processing"); r=order(ref)
    try:s,d=dtrx(r,"pay-pasca" if r["kind"]=="postpaid" else None)
    except Exception as e:upd(ref,supplier_status="error",supplier_message=str(e),status="supplier_failed");return
    x=d.get("data") if isinstance(d,dict) and isinstance(d.get("data"),dict) else {}
    st=str(x.get("status") or "").lower(); rc=str(x.get("rc") or "")
    if st=="sukses" or rc=="00": ss,overall="success","success"
    elif st=="pending" or rc=="03":ss,overall="pending","processing"
    else:ss,overall="failed","supplier_failed"
    upd(ref,supplier_status=ss,supplier_rc=rc,supplier_message=str(x.get("message") or d)[:1000],sn=str(x.get("sn") or "")[:500],status=overall,raw_json=json.dumps(d,ensure_ascii=False)[:20000])

class H(BaseHTTPRequestHandler):
    server_version="BIDIGICore/1.0"
    def log_message(self,f,*a): print(self.address_string(),"-",f%a,flush=True)
    def out(self,d,s=200):
        b=json.dumps(d,ensure_ascii=False,separators=(",",":")).encode(); self.send_response(s); self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.send_header("Content-Length",str(len(b)));self.end_headers();self.wfile.write(b)
    def raw(self,n=1048576):
        try:l=int(self.headers.get("Content-Length","0") or 0)
        except:l=0
        if l>n:self.out({"ok":False,"error":"BODY_TOO_LARGE"},413);return None
        return self.rfile.read(l) if l else b""
    def js(self):
        b=self.raw()
        if b is None:return None
        try:return json.loads(b.decode()) if b else {}
        except:self.out({"ok":False,"error":"INVALID_JSON"},400);return None
    def admin(self):
        t=E("BIDIGI_ADMIN_TOKEN");g=self.headers.get("X-Admin-Token","");return bool(t and g and hmac.compare_digest(t,g))
    def do_GET(self):
        p=urlparse(self.path); path=p.path; q=parse_qs(p.query)
        if path=="/api/_egress":
            try:
                with urllib.request.urlopen("https://api.ipify.org",timeout=10) as r:ip=r.read(128).decode().strip()
                return self.out({"ok":True,"outbound_ipv4":ip})
            except:return self.out({"ok":False,"error":"EGRESS_LOOKUP_FAILED"},502)
        if path in ("/api/_healthcheck","/api/status"):
            with LOCK,conn() as c: pc=c.execute("SELECT COUNT(*) c FROM products WHERE buyer_active=1 AND seller_active=1").fetchone()["c"];oc=c.execute("SELECT COUNT(*) c FROM orders").fetchone()["c"]
            return self.out({"ok":True,"service":"bidigi-core","digiflazz":{"configured":digi_ok(),"testing":E("DIGIFLAZZ_TESTING","true").lower() in ("1","true","yes","on"),"products":pc,"last_sync":meta("last_sync")},"payment":{"provider":"ipaymu","configured":pay_ok(),"environment":E("IPAYMU_ENV","sandbox")},"pricing":{"flat_markup":MARKUP,"percent_markup":PCT},"orders":oc})
        if path=="/api/products":
            sql="SELECT kind,sku,product_name,category,ui_category,brand,type,description,cost,admin,commission,sell_price FROM products WHERE buyer_active=1 AND seller_active=1";a=[]
            cat=(q.get("category",[""])[0] or "").strip(); search=(q.get("q",[""])[0] or "").strip()
            if cat:sql+=" AND ui_category=?";a.append(cat)
            if search:sql+=" AND (product_name LIKE ? OR brand LIKE ? OR category LIKE ? OR sku LIKE ?)";like="%"+search+"%";a += [like]*4
            sql+=" ORDER BY ui_category,brand,sell_price,product_name LIMIT 100"
            with LOCK,conn() as c:rows=[dict(x) for x in c.execute(sql,a).fetchall()]
            return self.out({"ok":True,"data":rows})
        if path.startswith("/api/order/"):
            r=order(path.split("/",3)[3]);return self.out({"ok":bool(r),"order":pub(r)},200 if r else 404)
        if path=="/api/admin/balance":
            if not self.admin():return self.out({"ok":False,"error":"UNAUTHORIZED"},401)
            try:s,d=balance();return self.out({"ok":s<400,"data":d},200 if s<400 else 502)
            except Exception as e:return self.out({"ok":False,"error":str(e)},503)
        return self.out({"ok":False,"error":"NOT_FOUND"},404)
    def create_pay(self,ref):
        r=order(ref)
        try:s,d=ipaymu_payment(r)
        except Exception as e:return self.out({"ok":False,"error":str(e)},502)
        x=d.get("Data") if isinstance(d,dict) and isinstance(d.get("Data"),dict) else {}
        ok=s<400 and bool(d.get("Success") or d.get("success"))
        if not ok:upd(ref,status="payment_failed",raw_json=json.dumps(d,ensure_ascii=False)[:20000]);return self.out({"ok":False,"error":"PAYMENT_CREATE_FAILED"},502)
        upd(ref,status="awaiting_payment",payment_provider="ipaymu",payment_ref=str(x.get("TransactionId") or x.get("ReferenceId") or ""),payment_url=str(x.get("Url") or ""),raw_json=json.dumps(d,ensure_ascii=False)[:20000])
        return self.out({"ok":True,"order":pub(order(ref)),"payment":x})
    def do_POST(self):
        path=urlparse(self.path).path
        if path=="/api/admin/sync":
            if not self.admin():return self.out({"ok":False,"error":"UNAUTHORIZED"},401)
            try:return self.out(sync_products())
            except Exception as e:return self.out({"ok":False,"error":str(e)},502)
        if path=="/api/order/prepaid":
            d=self.js()
            if d is None:return
            sku=str(d.get("sku") or "").strip();cust=str(d.get("customer_no") or "").strip(); name=str(d.get("name") or "").strip();phone=str(d.get("phone") or "").strip();email=str(d.get("email") or "").strip()
            if not sku or not cust:return self.out({"ok":False,"error":"SKU_AND_CUSTOMER_REQUIRED"},400)
            if not name or not phone or not email:return self.out({"ok":False,"error":"BUYER_CONTACT_REQUIRED"},400)
            if not pay_ok():return self.out({"ok":False,"error":"PAYMENT_NOT_CONFIGURED"},503)
            with LOCK,conn() as c:p=c.execute("SELECT * FROM products WHERE kind='prepaid' AND sku=? AND buyer_active=1 AND seller_active=1",(sku,)).fetchone()
            if not p:return self.out({"ok":False,"error":"PRODUCT_NOT_AVAILABLE"},404)
            ref="BDG-"+datetime.now().strftime("%Y%m%d%H%M%S")+"-"+uuid.uuid4().hex[:8].upper();t=now()
            with LOCK,conn() as c:c.execute("INSERT INTO orders(ref_id,kind,sku,product_name,customer_no,buyer_name,buyer_phone,buyer_email,cost,sell_price,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(ref,"prepaid",sku,p["product_name"],cust,name[:100],phone[:50],email[:200],p["cost"],p["sell_price"],"created",t,t));c.commit()
            return self.create_pay(ref)
        if path=="/api/order/postpaid/inquiry":
            d=self.js()
            if d is None:return
            sku=str(d.get("sku") or "").strip();cust=str(d.get("customer_no") or "").strip()
            if not sku or not cust:return self.out({"ok":False,"error":"SKU_AND_CUSTOMER_REQUIRED"},400)
            with LOCK,conn() as c:p=c.execute("SELECT * FROM products WHERE kind='postpaid' AND sku=? AND buyer_active=1 AND seller_active=1",(sku,)).fetchone()
            if not p:return self.out({"ok":False,"error":"PRODUCT_NOT_AVAILABLE"},404)
            ref="BDG-"+datetime.now().strftime("%Y%m%d%H%M%S")+"-"+uuid.uuid4().hex[:8].upper();temp={"ref_id":ref,"sku":sku,"customer_no":cust,"cost":0}
            try:s,r=dtrx(temp,"inq-pasca")
            except Exception as e:return self.out({"ok":False,"error":str(e)},503)
            x=r.get("data") if isinstance(r,dict) and isinstance(r.get("data"),dict) else {}
            if s>=400 or str(x.get("rc") or "")!="00":return self.out({"ok":False,"error":"INQUIRY_FAILED"},400)
            cost=int(float(x.get("selling_price") or x.get("price") or 0));t=now()
            with LOCK,conn() as c:c.execute("INSERT INTO orders(ref_id,kind,sku,product_name,customer_no,buyer_name,buyer_phone,buyer_email,cost,sell_price,supplier_status,supplier_rc,status,raw_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(ref,"postpaid",sku,p["product_name"],cust,str(d.get("name") or x.get("customer_name") or "")[:100],str(d.get("phone") or "")[:50],str(d.get("email") or "")[:200],cost,price(cost),"inquired","00","inquired",json.dumps(r,ensure_ascii=False)[:20000],t,t));c.commit()
            return self.out({"ok":True,"order":pub(order(ref)),"inquiry":x})
        if path=="/api/order/postpaid/pay":
            d=self.js()
            if d is None:return
            ref=str(d.get("ref_id") or "").strip();r=order(ref)
            if not r or r["kind"]!="postpaid":return self.out({"ok":False,"error":"ORDER_NOT_FOUND"},404)
            name=str(d.get("name") or r["buyer_name"] or "").strip();phone=str(d.get("phone") or r["buyer_phone"] or "").strip();email=str(d.get("email") or r["buyer_email"] or "").strip()
            if not name or not phone or not email:return self.out({"ok":False,"error":"BUYER_CONTACT_REQUIRED"},400)
            if not pay_ok():return self.out({"ok":False,"error":"PAYMENT_NOT_CONFIGURED"},503)
            upd(ref,buyer_name=name[:100],buyer_phone=phone[:50],buyer_email=email[:200]);return self.create_pay(ref)
        if path=="/api/payment/ipaymu/callback":
            raw=self.raw()
            if raw is None:return
            try:
                if "application/json" in self.headers.get("Content-Type",""):d=json.loads(raw.decode())
                else:d={k:(v[0] if len(v)==1 else v) for k,v in parse_qs(raw.decode(),keep_blank_values=True).items()}
            except:return self.out({"ok":False,"error":"INVALID_CALLBACK"},400)
            if not ipaymu_valid(d,self.headers.get("X-Signature","")):return self.out({"ok":False,"error":"INVALID_SIGNATURE"},400)
            eid=str(d.get("trx_id") or d.get("sid") or hashlib.sha256(raw).hexdigest())
            with LOCK,conn() as c:
                try:c.execute("INSERT INTO callbacks VALUES(?,?,?,?)",("ipaymu",eid,json.dumps(d,ensure_ascii=False)[:50000],now()));c.commit()
                except sqlite3.IntegrityError:return self.out({"status":"OK","idempotent":True})
            ref=str(d.get("reference_id") or d.get("referenceId") or "");r=order(ref)
            if not r:return self.out({"status":"OK","warning":"ORDER_NOT_FOUND"})
            code=str(d.get("transaction_status_code") or d.get("status_code") or "");txt=str(d.get("status") or d.get("status_desc") or "").lower()
            if code in ("1","6") or txt in ("berhasil","success","paid"):
                upd(ref,payment_status="paid",status="paid");threading.Thread(target=fulfill,args=(ref,),daemon=True).start()
            return self.out({"status":"OK"})
        if path=="/api/digiflazz/webhook":
            raw=self.raw()
            if raw is None:return
            if not digi_webhook_valid(raw,self.headers.get("X-Hub-Signature","")):return self.out({"ok":False,"error":"INVALID_SIGNATURE"},400)
            try:d=json.loads(raw.decode());x=d.get("data") or {}
            except:return self.out({"ok":False,"error":"INVALID_JSON"},400)
            ref=str(x.get("ref_id") or "");r=order(ref)
            if r:
                st=str(x.get("status") or "").lower();rc=str(x.get("rc") or "")
                if st=="sukses" or rc=="00":ss,overall="success","success"
                elif st=="pending" or rc=="03":ss,overall="pending","processing"
                else:ss,overall="failed","supplier_failed"
                upd(ref,supplier_status=ss,supplier_rc=rc,supplier_message=str(x.get("message") or "")[:1000],sn=str(x.get("sn") or "")[:500],status=overall,raw_json=json.dumps(d,ensure_ascii=False)[:20000])
            return self.out({"ok":True})
        return self.out({"ok":False,"error":"NOT_FOUND"},404)

def loop():
    time.sleep(5)
    if product_count()>0 and not meta("last_pricelist_attempt"):
        meta("last_pricelist_attempt",str(int(time.time()))); meta("last_pricelist_kind","prepaid")
    while True:
        try:
            if digi_ok():
                try:last_attempt=int(meta("last_pricelist_attempt") or "0")
                except:last_attempt=0
                needed_delay=305 if product_count("prepaid")==0 or product_count("postpaid")==0 else max(305,SYNC)
                if time.time()-last_attempt>=needed_delay:
                    print("sync",sync_products(),flush=True)
                with LOCK,conn() as c: refs=[x["ref_id"] for x in c.execute("SELECT ref_id FROM orders WHERE payment_status='paid' AND supplier_status='pending' ORDER BY updated_at LIMIT 50").fetchall()]
                for ref in refs: fulfill(ref)
        except Exception as e: print("background error",repr(e),flush=True)
        time.sleep(30)
if __name__=="__main__":
    init();threading.Thread(target=loop,daemon=True).start();print("BIDIGI core",PORT,"Digiflazz",digi_ok(),"iPaymu",pay_ok(),flush=True);ThreadingHTTPServer((HOST,PORT),H).serve_forever()
