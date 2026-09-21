import "dotenv/config";

const asBool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
};

const asInt = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? "development",
  headless: asBool(process.env.HEADLESS, true),
  databasePath: process.env.DATABASE_PATH ?? "./nadmo-agent.db",
  browserTimeoutMs: asInt(process.env.BROWSER_TIMEOUT_MS, 30000),
  approvalGatewayBaseUrl:
    process.env.SCOUT_APPROVAL_BASE_URL ??
    "https://nadmo-scout-approval-gateway-hid7pd.v2.appdeploy.ai",
  safety: Object.freeze({
    allowOutreach: asBool(process.env.ALLOW_OUTREACH, false),
    allowPublish: asBool(process.env.ALLOW_PUBLISH, false),
    allowPurchase: asBool(process.env.ALLOW_PURCHASE, false)
  })
});
