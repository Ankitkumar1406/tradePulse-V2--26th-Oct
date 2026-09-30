/** Direct autopay pass: renews lapsed Pro mandates. Run: bun scripts/test-renewal.ts */
import { processDueRenewals } from "../src/lib/payments";
const r = await processDueRenewals();
console.log("renewal pass:", r);
process.exit(0);
