import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APPLY_GUARD_ENV,
  APPLY_GUARD_VALUE,
  EXPECTED_MIN_WEEKLY_MICROS,
  MutationLock,
  PROTECTED_CAMPAIGN_IDS,
  TARGET_CAMPAIGN_ID,
  assertBudgetMutationPayload,
  deriveSafeBidCeiling,
  runBudgetOperation,
  sha256Json,
} from "./rosomaha-rus-direct-measurement.mjs";

function fixtureCampaign({ weekly = 10_000_000_000, bid = 150_000_000, state = "SUSPENDED" } = {}) {
  return {
    Id: TARGET_CAMPAIGN_ID,
    Name: "rosomaha-rus.ru Search draft 20260824",
    Status: "ACCEPTED",
    State: state,
    Type: "UNIFIED_CAMPAIGN",
    TimeZone: "Europe/Moscow",
    TimeTargeting: {
      ConsiderWorkingWeekends: "NO",
      HolidaysSchedule: null,
      Schedule: { Items: Array.from({ length: 7 }, (_, index) => `${index + 1},${Array(24).fill(100).join(",")}`) },
    },
    UnifiedCampaign: {
      CounterIds: { Items: [111905412] },
      PriorityGoals: null,
      BiddingStrategy: {
        Search: {
          BiddingStrategyType: "WB_MAXIMUM_CLICKS",
          PlacementTypes: {
            SearchResults: "YES",
            ProductGallery: "YES",
            DynamicPlaces: "NO",
            Maps: "NO",
            SearchOrganizationList: "NO",
          },
          WbMaximumClicks: {
            WeeklySpendLimit: weekly,
            BudgetType: "WEEKLY_BUDGET",
            BidCeiling: bid,
          },
        },
        Network: { BiddingStrategyType: "SERVING_OFF" },
      },
    },
  };
}

function fixtureGroups() {
  return Array.from({ length: 5 }, (_, index) => ({
    Id: 5791834449 + index,
    CampaignId: TARGET_CAMPAIGN_ID,
    Name: `group-${index}`,
    RegionIds: [225],
    RestrictedRegionIds: null,
    Status: "ACCEPTED",
    ServingStatus: "ELIGIBLE",
  }));
}

class FakeApi {
  constructor({ campaign = fixtureCampaign(), mutateState = false } = {}) {
    this.campaign = structuredClone(campaign);
    this.groups = fixtureGroups();
    this.protected = [{ Id: 708505950, State: "SUSPENDED", Status: "ACCEPTED" }];
    this.mutationRequests = 0;
    this.requestLog = [];
    this.mutateState = mutateState;
    this.suspendCalls = 0;
  }

  async getIdentity() {
    return { login: "rosomaha-rus999", clientId: 317930463, type: "CLIENT", currency: "RUB" };
  }

  async getTargetCampaign() {
    return structuredClone(this.campaign);
  }

  async getAdGroups() {
    return structuredClone(this.groups);
  }

  async getRubLimits() {
    return { minimumWeeklySpendLimit: 300_000_000, minimumBid: 300_000, maximumBid: 25_000_000_000 };
  }

  async getProtectedCampaignViews() {
    return {
      v501: structuredClone(this.protected),
      v5: structuredClone(this.protected),
    };
  }

  async updateBudget(payload) {
    assertBudgetMutationPayload(payload);
    this.mutationRequests += 1;
    this.campaign.UnifiedCampaign.BiddingStrategy = structuredClone(
      payload.Campaigns[0].UnifiedCampaign.BiddingStrategy,
    );
    if (this.mutateState) this.campaign.State = "ON";
    return { Id: TARGET_CAMPAIGN_ID };
  }

  async safetySuspend() {
    this.mutationRequests += 1;
    this.suspendCalls += 1;
    this.campaign.State = "SUSPENDED";
    return { Id: TARGET_CAMPAIGN_ID };
  }
}

test("dry-run строит точный payload 300 ₽ и 30 ₽ без мутаций", async () => {
  const api = new FakeApi();
  const result = await runBudgetOperation({ mode: "dry-run", api, generatedAt: "2026-08-24T21:20:00Z" });
  assert.equal(result.status, "ready");
  assert.equal(result.mutationRequests, 0);
  const clicks = result.payload.Campaigns[0].UnifiedCampaign.BiddingStrategy.Search.WbMaximumClicks;
  assert.equal(clicks.WeeklySpendLimit, EXPECTED_MIN_WEEKLY_MICROS);
  assert.equal(clicks.BidCeiling, 30_000_000);
  assert.equal(result.payload.Campaigns[0].UnifiedCampaign.BiddingStrategy.Network.BiddingStrategyType, "SERVING_OFF");
});

test("арифметический ceiling ограничивает один клик десятью процентами недельного лимита", () => {
  const limits = { minimumWeeklySpendLimit: 300_000_000, minimumBid: 300_000, maximumBid: 25_000_000_000 };
  assert.equal(deriveSafeBidCeiling(150_000_000, limits), 30_000_000);
  assert.equal(deriveSafeBidCeiling(20_000_000, limits), 20_000_000);
});

test("budget payload не может затронуть protected id", () => {
  const api = new FakeApi();
  return runBudgetOperation({ mode: "dry-run", api }).then((result) => {
    result.payload.Campaigns[0].Id = 708505950;
    assert.throws(() => assertBudgetMutationPayload(result.payload), /только для 713802902/u);
  });
});

test("apply требует exact guard и CAS", async () => {
  const api = new FakeApi();
  const expected = sha256Json(api.campaign);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-direct-budget-"));
  const lock = new MutationLock(path.join(temp, "mutation.lock"));
  await assert.rejects(
    runBudgetOperation({ mode: "apply-budget", api, expectedCampaignSha256: expected, env: {}, lock }),
    /Apply заблокирован/u,
  );
  assert.equal(api.mutationRequests, 0);
  assert.equal(fs.existsSync(path.join(temp, "mutation.lock")), false);
});

test("apply при уже точном лимите становится read-only no-op", async () => {
  const api = new FakeApi({ campaign: fixtureCampaign({ weekly: 300_000_000, bid: 30_000_000 }) });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-direct-budget-"));
  const lock = new MutationLock(path.join(temp, "mutation.lock"));
  const result = await runBudgetOperation({ mode: "apply-budget", api, env: {}, lock });
  assert.equal(result.status, "already_exact");
  assert.equal(api.mutationRequests, 0);
  assert.equal(result.mutationLock.released, true);
});

test("apply меняет только budget, сохраняет SUSPENDED и protected snapshot", async () => {
  const api = new FakeApi();
  const expected = sha256Json(api.campaign);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-direct-budget-"));
  const lock = new MutationLock(path.join(temp, "mutation.lock"));
  const result = await runBudgetOperation({
    mode: "apply-budget",
    api,
    expectedCampaignSha256: expected,
    env: { [APPLY_GUARD_ENV]: APPLY_GUARD_VALUE },
    lock,
  });
  assert.equal(result.status, "applied");
  assert.equal(result.after.state, "SUSPENDED");
  assert.equal(result.after.weeklySpendLimitMicros, 300_000_000);
  assert.equal(result.after.bidCeilingMicros, 30_000_000);
  assert.equal(api.mutationRequests, 1);
  assert.equal(api.suspendCalls, 0);
  assert.equal(result.mutationLock.released, true);
});

test("неожиданный выход из SUSPENDED вызывает safety suspend и fail", async () => {
  const api = new FakeApi({ mutateState: true });
  const expected = sha256Json(api.campaign);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "rosomaha-direct-budget-"));
  const lock = new MutationLock(path.join(temp, "mutation.lock"));
  await assert.rejects(
    runBudgetOperation({
      mode: "apply-budget",
      api,
      expectedCampaignSha256: expected,
      env: { [APPLY_GUARD_ENV]: APPLY_GUARD_VALUE },
      lock,
    }),
    /safety suspend выполнен/u,
  );
  assert.equal(api.suspendCalls, 1);
  assert.equal(api.campaign.State, "SUSPENDED");
  assert.equal(fs.existsSync(path.join(temp, "mutation.lock")), false);
});
