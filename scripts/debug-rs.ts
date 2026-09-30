/** Debug the RS-high scan outside Next.js. */
import { getNiftyCloses } from "../src/lib/bars";

async function main() {
  const nifty = await getNiftyCloses();
  console.log("nifty points:", nifty.d.length, "first:", nifty.d[0], "last:", nifty.d[nifty.d.length - 1], "lastClose:", nifty.c[nifty.c.length - 1]);
}
main();
