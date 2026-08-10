export const FINANCE_INTAKE_URL = "/api/finance/public-intake";
export const FINANCE_SOURCE_SITES = ["xn--80aa8ahaki9a.site", "rosomaha-rus.ru"] as const;

export const FINANCE_SOURCE = Object.freeze({
  source_site: "xn--80aa8ahaki9a.site",
  source_form: "credit_calculator",
  source_path: "/finansirovanie",
  consent_source: "rosomaha_site_credit",
});

export const APPLICANT_TYPES = ["individual", "sole_proprietor", "company"] as const;
export const FINANCING_TYPES = ["credit", "leasing", "installment", "unsure"] as const;

export type ApplicantType = (typeof APPLICANT_TYPES)[number];
export type FinancingType = (typeof FINANCING_TYPES)[number];
export type FinanceSourceSite = (typeof FINANCE_SOURCE_SITES)[number];

export type FinancePrivacyDocument = Readonly<{
  kind: "personal_data_processing";
  version: string;
  title: string;
  text: string;
  sha256: string;
}>;

export type FinanceAttribution = Partial<
  Record<
    | "utm_source"
    | "utm_medium"
    | "utm_campaign"
    | "utm_content"
    | "utm_term"
    | "yclid"
    | "ymclid"
    | "gclid"
    | "fbclid"
    | "vk_click_id",
    string
  >
>;

export type FinanceIntakePayload = Readonly<{
  lead_submission_id: string;
  source_site: FinanceSourceSite;
  source_form: typeof FINANCE_SOURCE.source_form;
  source_path: typeof FINANCE_SOURCE.source_path;
  consent_source: typeof FINANCE_SOURCE.consent_source;
  applicant_type: ApplicantType;
  financing_type: FinancingType;
  name: string;
  phone: string;
  email?: string;
  city?: string;
  product_name: string;
  comment?: string;
  sale_amount: number;
  down_payment_amount: number;
  desired_term_months: number;
  privacy_accepted: true;
  privacy_version: string;
  attribution: Readonly<FinanceAttribution>;
}>;

export type FinancePayloadInput = {
  leadSubmissionId: string;
  sourceSite?: FinanceSourceSite;
  sourcePath?: string;
  applicantType: ApplicantType;
  financingType: FinancingType;
  name: string;
  phone: string;
  email: string;
  city: string;
  product: string;
  comment: string;
  saleAmount: number;
  downPayment: number;
  termMonths: number;
  privacyVersion: string;
  attribution: Record<string, string | undefined>;
};

const ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "yclid",
  "ymclid",
  "gclid",
  "fbclid",
  "vk_click_id",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const optionalTrimmed = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function resolveFinanceSourceSite(hostname?: string): FinanceSourceSite {
  const normalized = hostname?.trim().toLowerCase().replace(/^www\./, "");

  if (
    normalized &&
    (FINANCE_SOURCE_SITES as readonly string[]).includes(normalized)
  ) {
    return normalized as FinanceSourceSite;
  }

  return FINANCE_SOURCE.source_site;
}

export function normalizeRussianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    return `+7${digits}`;
  }

  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }

  return null;
}

export function createFinanceSubmissionId(): string {
  const randomPart =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");

  return `rosomaha-${Date.now()}-${randomPart}`;
}

export function filterFinanceAttribution(
  source: Record<string, string | undefined>,
): Readonly<FinanceAttribution> {
  const filtered: FinanceAttribution = {};

  for (const key of ATTRIBUTION_KEYS) {
    const rawValue = source[key];
    if (typeof rawValue !== "string") {
      continue;
    }

    const value = Array.from(rawValue)
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code > 31 && code !== 127;
      })
      .join("")
      .trim()
      .slice(0, 255);
    if (value) {
      filtered[key] = value;
    }
  }

  return Object.freeze(filtered);
}

export function parseFinancePrivacyMetadata(value: unknown): FinancePrivacyDocument | null {
  if (!isRecord(value) || value.status !== "ok" || !isRecord(value.privacy_document)) {
    return null;
  }

  const document = value.privacy_document;
  if (
    document.kind !== "personal_data_processing" ||
    !nonEmptyString(document.version) ||
    !nonEmptyString(document.title) ||
    !nonEmptyString(document.text) ||
    typeof document.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(document.sha256)
  ) {
    return null;
  }

  return Object.freeze({
    kind: document.kind,
    version: document.version.trim(),
    title: document.title.trim(),
    text: document.text,
    sha256: document.sha256.trim(),
  });
}

export function buildFinanceIntakePayload(input: FinancePayloadInput): FinanceIntakePayload {
  const payload: FinanceIntakePayload = {
    ...FINANCE_SOURCE,
    source_site: input.sourceSite ?? FINANCE_SOURCE.source_site,
    source_path: input.sourcePath ?? FINANCE_SOURCE.source_path,
    lead_submission_id: input.leadSubmissionId,
    applicant_type: input.applicantType,
    financing_type: input.financingType,
    name: input.name.trim(),
    phone: input.phone,
    ...(optionalTrimmed(input.email) ? { email: optionalTrimmed(input.email) } : {}),
    ...(optionalTrimmed(input.city) ? { city: optionalTrimmed(input.city) } : {}),
    product_name: input.product.trim(),
    ...(optionalTrimmed(input.comment) ? { comment: optionalTrimmed(input.comment) } : {}),
    sale_amount: input.saleAmount,
    down_payment_amount: input.downPayment,
    desired_term_months: input.termMonths,
    privacy_accepted: true,
    privacy_version: input.privacyVersion,
    attribution: filterFinanceAttribution(input.attribution),
  };

  return Object.freeze(payload);
}

export function createFinanceFormFingerprint(input: Omit<FinancePayloadInput, "leadSubmissionId" | "attribution">): string {
  return JSON.stringify({
    applicant_type: input.applicantType,
    financing_type: input.financingType,
    name: input.name,
    phone: input.phone,
    email: input.email,
    city: input.city,
    product: input.product,
    comment: input.comment,
    sale_amount: input.saleAmount,
    down_payment: input.downPayment,
    term_months: input.termMonths,
    privacy_version: input.privacyVersion,
  });
}

export function isAcceptedFinanceReceipt(
  responseStatus: number,
  body: unknown,
  submissionId: string,
): body is Record<string, unknown> & { receipt_id: string; lead_submission_id: string } {
  if ((responseStatus !== 200 && responseStatus !== 201) || !isRecord(body)) {
    return false;
  }

  return (
    body.status === "ok" &&
    body.lead_submission_id === submissionId &&
    typeof body.receipt_id === "string" &&
    /^fin_[a-f0-9]{32}$/.test(body.receipt_id) &&
    typeof body.created === "boolean" &&
    typeof body.deduplicated === "boolean" &&
    body.created !== body.deduplicated
  );
}

export function hasStalePrivacyVersion(body: unknown): boolean {
  if (!isRecord(body)) {
    return false;
  }

  if (body.error === "stale_privacy_version" || body.code === "stale_privacy_version") {
    return true;
  }

  return isRecord(body.errors) && Object.prototype.hasOwnProperty.call(body.errors, "privacy_version");
}
