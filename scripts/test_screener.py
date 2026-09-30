#!/usr/bin/env python3
"""Test Yahoo screener API to enumerate the full NSE (NSI) equity universe."""
import requests

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
s = requests.Session()
s.headers.update(UA)

# Step 1: get cookie
try:
    s.get("https://fc.yahoo.com", timeout=10)
except Exception as e:
    print("cookie step:", e)

# Step 2: get crumb
r = s.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=10)
crumb = r.text.strip()
print("crumb:", crumb[:20], "...")

# Step 3: POST screener for all NSI equities
url = f"https://query2.finance.yahoo.com/v1/finance/screener?crumb={crumb}&formatted=false"
body = {
    "size": 250,
    "offset": 0,
    "sortField": "eodprice",
    "sortType": "DESC",
    "quoteType": "equity",
    "query": {"operator": "EQ", "operands": ["exchange", "NSI"]},
    "userId": "",
    "userIdType": "guid",
}
r = s.post(url, json=body, timeout=20)
print("status:", r.status_code)
d = r.json()
print("total:", d.get("total"))
docs = d.get("documents") or (d.get("hits") or {}).get("result") or []
print("docs in page:", len(docs))
for x in docs[:5]:
    print(x.get("symbol"), "|", (x.get("shortName") or x.get("longName") or "")[:40])
