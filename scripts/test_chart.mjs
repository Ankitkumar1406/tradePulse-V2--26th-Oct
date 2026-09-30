const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function main() {
  const url = "https://query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=5d&interval=1d&includePrePost=false";
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://finance.yahoo.com/" },
      signal: AbortSignal.timeout(20000),
    });
    console.log("status:", res.status, "in", Date.now() - t0, "ms");
    const j = await res.json();
    const r = j.chart?.result?.[0];
    console.log("bars:", r?.timestamp?.length ?? 0);
  } catch (e) {
    console.log("FAILED:", e?.message ?? e, "after", Date.now() - t0, "ms");
  }
}
main();
