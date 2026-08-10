import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFinanceIntakePayload,
  createFinanceFormFingerprint,
  filterFinanceAttribution,
  hasStalePrivacyVersion,
  isAcceptedFinanceReceipt,
  normalizeRussianPhone,
  parseFinancePrivacyMetadata,
  resolveFinanceSourceSite,
} from "./financeIntake.ts";

test("privacy metadata is fail closed", () => {
  assert.equal(parseFinancePrivacyMetadata({ status: "ok" }), null);
  assert.equal(
    parseFinancePrivacyMetadata({
      status: "ok",
      privacy_document: { kind: "finance", version: "v1", title: "Согласие", text: "", sha256: "abc" },
    }),
    null,
  );

  assert.equal(
    parseFinancePrivacyMetadata({
      status: "ok",
      privacy_document: { kind: "finance", version: "v1", title: "Согласие", text: "Текст", sha256: "abc" },
    })?.version,
    "v1",
  );
});

test("only allowlisted attribution is retained", () => {
  assert.deepEqual(
    filterFinanceAttribution({
      utm_source: " direct ",
      yclid: "abc",
      page_url: "https://example.test/private",
      attribution_summary: "not allowed",
    }),
    { utm_source: "direct", yclid: "abc" },
  );
});

test("Russian phone is normalized without accepting incomplete numbers", () => {
  assert.equal(normalizeRussianPhone("8 (912) 345-67-89"), "+79123456789");
  assert.equal(normalizeRussianPhone("+7 912 345 67 89"), "+79123456789");
  assert.equal(normalizeRussianPhone("9123456789"), "+79123456789");
  assert.equal(normalizeRussianPhone("912345"), null);
});

test("payload uses fixed public source and remains immutable", () => {
  const payload = buildFinanceIntakePayload({
    leadSubmissionId: "rosomaha-10000000000-test",
    sourceSite: "rosomaha-rus.ru",
    applicantType: "individual",
    financingType: "credit",
    name: " Иван ",
    phone: "+79123456789",
    email: "",
    city: " Тюмень ",
    product: "Росомаха",
    comment: "",
    saleAmount: 1_300_000,
    downPayment: 300_000,
    termMonths: 36,
    privacyVersion: "v1",
    attribution: { utm_source: "yandex", page_url: "not allowed" },
  });

  assert.equal(payload.source_path, "/finansirovanie");
  assert.equal(payload.source_site, "rosomaha-rus.ru");
  assert.equal(payload.source_form, "credit_calculator");
  assert.equal(payload.privacy_accepted, true);
  assert.equal(payload.city, "Тюмень");
  assert.equal("email" in payload, false);
  assert.deepEqual(payload.attribution, { utm_source: "yandex" });
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.attribution), true);
});

test("receipt requires exact echoed id and opaque nonempty receipt", () => {
  const submissionId = "rosomaha-10000000000-test";
  assert.equal(
    isAcceptedFinanceReceipt(201, { status: "ok", receipt_id: "fin_opaque", lead_submission_id: submissionId }, submissionId),
    true,
  );
  assert.equal(
    isAcceptedFinanceReceipt(201, { status: "ok", receipt_id: "fin_opaque", lead_submission_id: "other" }, submissionId),
    false,
  );
  assert.equal(
    isAcceptedFinanceReceipt(201, { status: "ok", receipt_id: "", lead_submission_id: submissionId }, submissionId),
    false,
  );
  assert.equal(
    isAcceptedFinanceReceipt(202, { status: "ok", receipt_id: "fin_opaque", lead_submission_id: submissionId }, submissionId),
    false,
  );
});

test("privacy conflict and form fingerprint are deterministic", () => {
  assert.equal(hasStalePrivacyVersion({ errors: { privacy_version: ["stale"] } }), true);
  assert.equal(hasStalePrivacyVersion({ errors: { phone: ["invalid"] } }), false);

  const input = {
    applicantType: "company" as const,
    financingType: "leasing" as const,
    name: "ООО Север",
    phone: "+73452123456",
    email: "",
    city: "Тюмень",
    product: "Росомаха",
    comment: "",
    saleAmount: 2_000_000,
    downPayment: 500_000,
    termMonths: 48,
    privacyVersion: "v1",
  };

  assert.equal(createFinanceFormFingerprint(input), createFinanceFormFingerprint({ ...input }));
  assert.notEqual(createFinanceFormFingerprint(input), createFinanceFormFingerprint({ ...input, termMonths: 36 }));
});

test("source site resolves only from the allowlist", () => {
  assert.equal(resolveFinanceSourceSite("www.rosomaha-rus.ru"), "rosomaha-rus.ru");
  assert.equal(resolveFinanceSourceSite("xn--80aa8ahaki9a.site"), "xn--80aa8ahaki9a.site");
  assert.equal(resolveFinanceSourceSite("evil.example"), "xn--80aa8ahaki9a.site");
});
