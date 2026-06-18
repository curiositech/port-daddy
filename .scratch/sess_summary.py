import sys,json,time,urllib.request
from collections import Counter
raw=urllib.request.urlopen("http://localhost:9876/sessions",timeout=6).read()
d=json.loads(raw)
s=d.get("sessions",[])
now=time.time()*1000
print("TOTAL sessions:",len(s))
print("by status:",dict(Counter(x.get("status") for x in s)))
print("by project:",dict(Counter(x.get("identityProject") for x in s)))
live=[x for x in s if x.get("status") not in ("completed","abandoned")]
print("\n=== LIVE (not completed/abandoned):",len(live),"===")
for x in sorted(live,key=lambda x:x.get("updatedAt") or 0,reverse=True)[:40]:
    age=(now-(x.get("updatedAt") or 0))/3600000
    print("  [%s] %s :: %s (upd %.1fh, files=%s notes=%s)"%(x.get("status"),x.get("identityProject"),(x.get("purpose") or "")[:55],age,x.get("fileCount"),x.get("noteCount")))
print("\n=== abandoned recent (10) ===")
for x in sorted([x for x in s if x.get("status")=="abandoned"],key=lambda x:x.get("updatedAt") or 0,reverse=True)[:10]:
    age=(now-(x.get("updatedAt") or 0))/3600000
    print("  %s :: %s (%.1fh)"%(x.get("identityProject"),(x.get("purpose") or "")[:50],age))
