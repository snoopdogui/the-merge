#!/usr/bin/env python3
"""Proof-of-life: assets upload -> telablur-v1 merge -> download result."""
import json, os, ssl, time, urllib.request, pathlib
import certifi
SSL = ssl.create_default_context(cafile=certifi.where())
from PIL import Image, ImageDraw

BASE = "https://api.mothquantum.com/api/v1"
KEY = None
for line in pathlib.Path(".env.local").read_text().splitlines():
    if line.startswith("MOTH_API_KEY="):
        KEY = line.split("=", 1)[1].strip()
AUTH = {"Authorization": f"Bearer {KEY}"}

def api(method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(AUTH)
    if data: h["Content-Type"] = "application/json"
    h["User-Agent"] = "the-merge/0.1"
    req = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, context=SSL) as r:
            return r.read() if raw else json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} on {method} {path}\n{e.read().decode()[:1500]}")

def upload(path, mime="image/png"):
    b = pathlib.Path(path).read_bytes()
    a = api("POST", "/assets", {"filename": os.path.basename(path),
                                "content_type": mime, "size_bytes": len(b)})
    up = a["upload"]
    print(f"  created asset {a['asset_id']} status={a['status']} -> {up['method']} presigned")
    req = urllib.request.Request(up["url"], data=b, headers=up["headers"], method=up["method"])
    with urllib.request.urlopen(req, context=SSL) as r:
        print(f"  PUT bytes -> HTTP {r.status}")
    done = api("POST", f"/assets/{a['asset_id']}/complete")
    print(f"  complete -> status={done['status']} metadata={json.dumps(done.get('metadata'))}")
    return a["asset_id"]

def run(engine, params, input_files=None):
    body = {"params": params}
    if input_files: body["input_files"] = input_files
    j = api("POST", f"/engines/{engine}/process", body)
    jid = j["job_id"]
    print(f"  job {jid} queued")
    for _ in range(300):
        st = api("GET", f"/jobs/{jid}/status")
        if st["status"] in ("completed", "failed", "cancelled"): break
        time.sleep(2)
    print(f"  job {jid} -> {st['status']}")
    if st["status"] != "completed":
        raise SystemExit("FAILED: " + json.dumps(st)[:2000])
    return jid, api("GET", f"/jobs/{jid}/result")

# --- two same-size test images, visually distinct ---
SZ = 256
a_img = Image.new("RGB", (SZ, SZ), (20, 20, 24))
ImageDraw.Draw(a_img).ellipse([40, 40, 216, 216], fill=(235, 235, 230))
a_img.save("/tmp/canvas.png")
b_img = Image.new("RGB", (SZ, SZ), (240, 240, 235))
d = ImageDraw.Draw(b_img)
for i in range(0, SZ, 32): d.rectangle([i, 0, i + 16, SZ], fill=(30, 30, 35))
b_img.save("/tmp/upload.png")
print("built two 256x256 test images")

print("\n[1] fresh comet-qrng-v1 draw for strength")
_, qr = run("comet-qrng-v1", {"num_qubits": 12, "shots": 256, "mode": "emu",
                              "output_bytes": 8, "include_raw_counts": False,
                              "derive": {"floats": 1}})
strength = qr["result"]["output"]["random"]["derived"]["floats"][0]
print(f"  strength = {strength}")

print("\n[2] upload image1 (canvas)")
id1 = upload("/tmp/canvas.png")
print("[3] upload image2 (contribution)")
id2 = upload("/tmp/upload.png")

print(f"\n[4] telablur-v1 merge at strength={strength:.4f}")
jid, res = run("telablur-v1", {"strength": strength, "size": 256},
               {"image1": id1, "image2": id2})
print("  RAW RESULT:", json.dumps(res)[:900])

outs = res["outputs"]
print("\n[5] download merged image")
o = next(x for x in outs if x["slot"] == "result")
print("  output_asset_id:", o["output_asset_id"])
with urllib.request.urlopen(o["url"], context=SSL) as r:
    b = r.read()
pathlib.Path("/tmp/merged.png").write_bytes(b)
im = Image.open("/tmp/merged.png")
print(f"  merged.png {len(b)} bytes, {im.size}, mode={im.mode}")
c0, c1 = Image.open("/tmp/canvas.png"), Image.open("/tmp/upload.png")
import statistics
def mean(i): 
    g = i.convert("L").getdata(); return round(statistics.fmean(g), 1)
print(f"  mean luminance: canvas={mean(c0)} merged={mean(im)} upload={mean(c1)}  (strength={strength:.4f})")
