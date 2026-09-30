#!/usr/bin/env python3
"""Test lookup exchange filter + quoteSummary for sector data."""
import requests, time, json

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
s = requests.Session(); s.headers.update(UA)
try: s.get("https://fc.yahoo.com", timeout=10)
except Exception: pass
crumb = s.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=10).text.strip()

# --- Test 1: lookup with various exchange param spellings ---
for params in [
    {"query": "reli", "type": "equity", "exchange": "NSI", "count": 5},
    {"query": "reli", "type": "equity", "exchange": "NSE", "count": 5},
    {"query": "reli", "quoteType": "equity", "exchange": "NSI", "count": 5},
]:
    r = s.get("https://query2.finance.yahoo.com/v1/finance/lookup", params=params, timeout=15)
    try:
        docs = r.json()["finance"]["result"][0]["documents"] or []
        exs = {d.get("exchange") for d in docs[:5]}
        inds = {d.get("industryName") for d in docs[:5]}
        print("lookup", params.get("exchange"), "->", r.status_code, "exchanges:", exs, "industries:", list(inds)[:3])
    except Exception as e:
        print("lookup fail", params.get("exchange"), r.status_code, str(e)[:60])
    time.sleep(0.5)

# --- Test 2: quoteSummary assetProfile for sector ---
for i in range(6):
    sym = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "ITC.NS", "HDFCBANK.NS", "TATAMOTORS.NS"][i]
    r = s.get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{sym}?crumb={crumb}&modules=assetProfile", timeout=15)
    if r.status_code == 200:
        p = r.json()["quoteSummary"]["result"][0]["assetProfile"]
        print(f"quoteSummary {sym}: {r.status_code} sector={p.get('sector')} industry={p.get('industry')}")
    else:
        print(f"quoteSummary {sym}: {r.status_code} {r.text[:80]}")
    time.sleep(0.4)
