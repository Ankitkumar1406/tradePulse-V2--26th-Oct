#!/usr/bin/env python3
"""Verify: 1) screener pagination + fields, 2) spark bulk endpoint."""
import requests, json

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
s = requests.Session(); s.headers.update(UA)
try: s.get("https://fc.yahoo.com", timeout=10)
except Exception: pass
crumb = s.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=10).text.strip()
base = f"https://query2.finance.yahoo.com/v1/finance/screener?crumb={crumb}&formatted=false"
body = {"size": 250, "offset": 0, "sortField": "eodprice", "sortType": "DESC",
        "quoteType": "equity", "query": {"operator": "EQ", "operands": ["exchange", "NSI"]},
        "userId": "", "userIdType": "guid"}

r = s.post(base, json=body, timeout=25)
d = r.json()["finance"]["result"][0]
print("TOTAL:", d["total"], "| quotes in page:", len(d["quotes"]))
q = d["quotes"][10]
keys = sorted(q.keys())
print("FIELDS:", keys)
print("sample:", {k: q.get(k) for k in ["symbol","shortName","longName","sector","industry","marketCap","regularMarketPrice","regularMarketChangePercent","regularMarketVolume","averageDailyVolume3Month","fiftyTwoWeekHigh","fiftyTwoWeekLow","fiftyTwoWeekHighChangePercent","fiftyTwoWeekLowChangePercent"]})

# page 2
body2 = dict(body); body2["offset"] = 250
r2 = s.post(base, json=body2, timeout=25)
d2 = r2.json()["finance"]["result"][0]
print("page2 first:", d2["quotes"][0]["symbol"], "| count:", len(d2["quotes"]))

# Spark bulk test: 120 symbols, 1y daily closes
syms = [x["symbol"] for x in d["quotes"][:120]]
spark_url = f"https://query2.finance.yahoo.com/v7/finance/spark?crumb={crumb}"
r3 = s.get(spark_url, params={"symbols": ",".join(syms), "range": "1y", "interval": "1d"}, timeout=30)
print("spark status:", r3.status_code)
sd = r3.json()
cnt = len(sd.get("spark", {}).get("result", []))
print("spark results:", cnt)
if cnt:
    item = sd["spark"]["result"][0]
    print("spark keys:", sorted(item.keys()))
    print("sample:", item["symbol"], "| close points:", len(item["response"][0]["indicators"]["quote"][0]["close"]),
          "| timestamps:", len(item["response"][0]["timestamp"]))
