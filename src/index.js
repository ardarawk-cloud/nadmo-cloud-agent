import { inspectUrl } from "./scout.js";
import { closeDb, logActivity, upsertLead } from "./db.js";
import { config } from "./config.js";

function printSafety() {
  console.log("NADMO Cloud Agent v0.1");
  console.log("Safety gates:", config.safety);
}

async function main() {
  printSafety();

  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.log("\nUsage:");
    console.log("  npm run scout -- https://example.com");
    console.log("\nPhase 0 only inspects URLs and saves results locally.");
    console.log("It does NOT send messages, publish content, or make purchases.");
    return;
  }

  for (const url of urls) {
    try {
      console.log(`\nInspecting: ${url}`);
      const lead = await inspectUrl(url);
      upsertLead(lead);
      logActivity("INSPECT_URL", {
        sourceUrl: lead.sourceUrl,
        status: lead.status
      });
      console.log(lead);
    } catch (error) {
      logActivity("INSPECT_URL_ERROR", {
        sourceUrl: url,
        error: error.message
      });
      console.error(`Failed: ${url}`);
      console.error(error.message);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDb();
  });
