import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const checks = [
  {
    file: "src/pages/OrderPage.tsx",
    required: [
      "CRM_WEBHOOK_URL = 'https://rosomaha.centrlp.ru/api/webhooks/site-form'",
      "normalizeRussianPhone",
      "isValidRussianPhone",
      "lead_submission_id",
      "rosomaha_last_lead_receipt",
      "trackLeadSubmit",
      "response.ok",
    ],
  },
  {
    file: "src/lib/metrika.ts",
    required: [
      'leadSubmit: "lead_submit"',
      'crmConversion: "crm_conversion"',
      "flushMetrikaGoalQueue",
    ],
  },
  {
    file: "src/lib/attribution.ts",
    required: [
      "ym_client_id",
      "yclid",
      "utm_campaign",
      "attribution_summary",
    ],
  },
  {
    file: "scripts/dry-run-lead-chain.mjs",
    required: [
      "rosomaha_last_lead_receipt",
      "Fetch.fulfillRequest",
      "lead_submit",
      "crm_conversion",
      "codex_dry_run_9of10",
    ],
  },
  {
    file: "scripts/rosomaha-launch-gate.mjs",
    required: [
      "launchAllowed",
      "readiness",
      "708505950",
      "SUSPENDED",
      "directReportToday",
    ],
  },
  {
    file: "scripts/rosomaha-metrika-real-test-verifier.mjs",
    required: [
      "ROSOMAHA_LEAD_CHAIN_REAL_",
      "517599639",
      "api-metrika.yandex.net/stat/v1/data",
      "No REAL lead-chain artifact exists",
      "process.exit(2)",
    ],
  },
  {
    file: "scripts/rosomaha-direct-relaunch-scope-audit.mjs",
    required: [
      "SEARCH_QUERY_PERFORMANCE_REPORT",
      "relaunchScopeClean",
      "техноволк",
      "708505950",
      "process.exitCode = 2",
    ],
  },
];

const failures = [];

for (const check of checks) {
  const filePath = path.join(rootDir, check.file);
  const source = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";

  if (!source) {
    failures.push(`${check.file}: missing or empty`);
    continue;
  }

  for (const marker of check.required) {
    if (!source.includes(marker)) {
      failures.push(`${check.file}: missing marker ${marker}`);
    }
  }
}

if (failures.length) {
  console.error("Lead-chain readiness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Lead-chain readiness check passed.");
