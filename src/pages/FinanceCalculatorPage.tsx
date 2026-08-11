import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, Check, Loader2, ShieldCheck } from "lucide-react";

import { products, type Product, formatPrice } from "@/data/products";
import { getAttribution } from "@/lib/attribution";
import {
  APPLICANT_TYPES,
  FINANCING_TYPES,
  FINANCE_INTAKE_URL,
  buildFinanceIntakePayload,
  createFinanceFormFingerprint,
  createFinanceSubmissionId,
  hasStalePrivacyVersion,
  isAcceptedFinanceReceipt,
  normalizeRussianPhone,
  parseFinancePrivacyMetadata,
  resolveFinanceSourceSite,
  type ApplicantType,
  type FinanceIntakePayload,
  type FinancePrivacyDocument,
  type FinancingType,
} from "@/lib/financeIntake";
import { trackLeadSubmit } from "@/lib/metrika";
import { useToast } from "@/hooks/use-toast";

type FormState = {
  applicantType: ApplicantType | "";
  financingType: FinancingType | "";
  productSlug: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  comment: string;
  downPayment: number;
  termMonths: number;
  privacyAccepted: boolean;
};

type SubmissionAttempt = Readonly<{
  fingerprint: string;
  submissionId: string;
  sourceSite: string;
  payload: FinanceIntakePayload;
}>;

const MIN_TERM_MONTHS = 1;
const MAX_TERM_MONTHS = 120;

const APPLICANT_TYPE_LABELS: Record<ApplicantType, string> = {
  individual: "Физическое лицо",
  sole_proprietor: "ИП",
  company: "Компания",
};

const FINANCING_TYPE_LABELS: Record<FinancingType, string> = {
  credit: "Кредит",
  leasing: "Лизинг",
  installment: "Рассрочка",
  unsure: "Нужна консультация",
};

const FINANCING_TYPE_DESCRIPTIONS: Record<FinancingType, string> = {
  credit: "Уточним задачу и проверим, доступен ли подходящий кредитный канал.",
  leasing: "Для ИП и компаний: проверим, доступен ли подходящий лизинговый канал.",
  installment: "Проверим, возможен ли согласованный график оплаты для выбранной комплектации.",
  unsure: "Менеджер уточнит задачу и поможет выбрать направление.",
};

const AFTER_SUBMISSION_STEPS = [
  "Менеджер проверит модель, контакты и параметры обращения.",
  "Свяжется с вами и уточнит комплектацию, срок и первоначальный взнос.",
  "Если подходящий канал доступен, назовёт партнёра и запросит отдельное согласие до передачи данных.",
] as const;

const visibleProducts = products;

function findProduct(slug: string | null): Product | undefined {
  return visibleProducts.find((product) => product.slug === slug);
}

function clampDownPayment(value: number, saleAmount: number) {
  return Math.min(Math.max(0, Number.isFinite(value) ? Math.round(value) : 0), saleAmount);
}

function clampTerm(value: number) {
  return Math.min(MAX_TERM_MONTHS, Math.max(MIN_TERM_MONTHS, Number.isFinite(value) ? Math.round(value) : MIN_TERM_MONTHS));
}

function createInitialForm(product?: Product): FormState {
  return {
    applicantType: "",
    financingType: "",
    productSlug: product?.slug ?? "",
    name: "",
    phone: "",
    email: "",
    city: "",
    comment: "",
    downPayment: 0,
    termMonths: 36,
    privacyAccepted: false,
  };
}

function writeFinanceReceipt(receipt: Record<string, unknown>) {
  try {
    sessionStorage.setItem("rosomaha_last_finance_receipt", JSON.stringify(receipt));
  } catch {
    // Diagnostic only.
  }
}

export default function FinanceCalculatorPage() {
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const productFromQuery = findProduct(searchParams.get("model"));
  const defaultProduct = productFromQuery ?? visibleProducts[0];

  const [form, setForm] = useState<FormState>(() => createInitialForm(defaultProduct));
  const [privacyDocument, setPrivacyDocument] = useState<FinancePrivacyDocument | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const submissionAttempt = useRef<SubmissionAttempt>();
  const privacyRequestSequence = useRef(0);
  const privacyRequestController = useRef<AbortController | null>(null);

  const selectedProduct = useMemo(
    () => visibleProducts.find((product) => product.slug === form.productSlug) ?? defaultProduct,
    [defaultProduct, form.productSlug],
  );

  const saleAmount = selectedProduct?.basePrice ?? 0;
  const downPayment = clampDownPayment(form.downPayment, saleAmount);
  const financedAmount = Math.max(0, saleAmount - downPayment);
  const progressPhone = normalizeRussianPhone(form.phone);
  const completedSteps = [
    Boolean(selectedProduct && saleAmount > 0 && form.termMonths >= MIN_TERM_MONTHS && form.termMonths <= MAX_TERM_MONTHS),
    Boolean(form.applicantType && form.financingType),
    Boolean(form.name.trim().length >= 2 && progressPhone && form.privacyAccepted && privacyDocument),
  ].filter(Boolean).length;

  useEffect(() => {
    if (!selectedProduct) {
      return;
    }

    setForm((current) => {
      const nextDownPayment = clampDownPayment(current.downPayment, selectedProduct.basePrice);
      if (current.downPayment === nextDownPayment) {
        return current;
      }

      return {
        ...current,
        downPayment: nextDownPayment,
      };
    });
  }, [selectedProduct]);

  const refreshPrivacyDocument = async () => {
    const requestSequence = privacyRequestSequence.current + 1;
    privacyRequestSequence.current = requestSequence;
    privacyRequestController.current?.abort();

    const controller = new AbortController();
    privacyRequestController.current = controller;

    submissionAttempt.current = undefined;
    setForm((current) => ({ ...current, privacyAccepted: false }));

    setIsMetadataLoading(true);
    setMetadataError(null);
    setPrivacyDocument(null);

    try {
      const response = await fetch(FINANCE_INTAKE_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      const body = await response.json().catch(() => null);
      const parsed = parseFinancePrivacyMetadata(body);

      if (controller.signal.aborted || requestSequence !== privacyRequestSequence.current) {
        return;
      }

      if (!response.ok || !parsed) {
        throw new Error("Finance legal metadata is unavailable.");
      }

      setPrivacyDocument(parsed);
    } catch (error) {
      if (controller.signal.aborted || requestSequence !== privacyRequestSequence.current) {
        return;
      }

      console.error("Finance privacy metadata failed", error);
      setPrivacyDocument(null);
      setMetadataError("Форма временно недоступна: не удалось получить актуальное согласие на обработку данных.");
    } finally {
      if (requestSequence === privacyRequestSequence.current) {
        if (privacyRequestController.current === controller) {
          privacyRequestController.current = null;
        }
        setIsMetadataLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshPrivacyDocument();

    return () => {
      privacyRequestSequence.current += 1;
      privacyRequestController.current?.abort();
      privacyRequestController.current = null;
    };
  }, []);

  const updateForm = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    submissionAttempt.current = undefined;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedProduct || !privacyDocument) {
      toast({
        title: "Форма недоступна",
        description: "Сначала нужно загрузить актуальные условия обработки данных.",
        variant: "destructive",
      });
      return;
    }

    const normalizedPhone = normalizeRussianPhone(form.phone);
    const name = form.name.trim();
    const applicantType = form.applicantType;
    const financingType = form.financingType;

    if (!applicantType || !financingType) {
      toast({
        title: "Заполните параметры заявки",
        description: "Выберите тип заявителя и желаемый вид финансирования.",
        variant: "destructive",
      });
      return;
    }

    if (name.length < 2 || !normalizedPhone || !form.privacyAccepted) {
      toast({
        title: "Проверьте контакты",
        description: "Нужны имя и телефон в российском формате, чтобы менеджер связался с вами.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const sourceSite =
        typeof window === "undefined"
          ? resolveFinanceSourceSite()
          : resolveFinanceSourceSite(window.location.hostname);

      const fingerprint = createFinanceFormFingerprint({
        applicantType,
        financingType,
        name,
        phone: normalizedPhone,
        email: form.email,
        city: form.city,
        product: selectedProduct.name,
        comment: form.comment,
        saleAmount,
        downPayment,
        termMonths: clampTerm(form.termMonths),
        privacyVersion: privacyDocument.version,
      });

      let attempt = submissionAttempt.current;
      if (!attempt || attempt.fingerprint !== fingerprint) {
        const leadSubmissionId = createFinanceSubmissionId();
        const attribution = await getAttribution();
        attempt = Object.freeze({
          fingerprint,
          submissionId: leadSubmissionId,
          sourceSite,
          payload: buildFinanceIntakePayload({
            leadSubmissionId,
            sourceSite,
            sourcePath: "/finansirovanie",
            applicantType,
            financingType,
            name,
            phone: normalizedPhone,
            email: form.email,
            city: form.city,
            product: selectedProduct.name,
            comment: form.comment,
            saleAmount,
            downPayment,
            termMonths: clampTerm(form.termMonths),
            privacyVersion: privacyDocument.version,
            attribution,
          }),
        });
        submissionAttempt.current = attempt;
      }

      const leadSubmissionId = attempt.submissionId;

      const response = await fetch(FINANCE_INTAKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Lead-Submission-ID": leadSubmissionId,
        },
        body: JSON.stringify(attempt.payload),
      });

      const body = await response.json().catch(() => null);

      if (response.status === 422 && hasStalePrivacyVersion(body)) {
        submissionAttempt.current = undefined;
        setForm((current) => ({ ...current, privacyAccepted: false }));
        await refreshPrivacyDocument();
        throw new Error("stale-privacy-version");
      }

      if (!isAcceptedFinanceReceipt(response.status, body, leadSubmissionId)) {
        throw new Error(`Finance intake ${response.status}`);
      }

      const receiptId = body.receipt_id.trim();
      writeFinanceReceipt({
        receipt_id: receiptId,
        lead_submission_id: leadSubmissionId,
        source_site: attempt.sourceSite,
        product_slug: selectedProduct.slug,
        sale_amount: saleAmount,
        down_payment: downPayment,
        term_months: clampTerm(form.termMonths),
        sent_at: new Date().toISOString(),
      });

      trackLeadSubmit({
        source: "finance_calculator",
        lead_submission_id: leadSubmissionId,
        receipt_id: receiptId,
        product_slug: selectedProduct.slug,
        financing_type: financingType,
        applicant_type: applicantType,
      });

      submissionAttempt.current = undefined;
      setIsSubmitted(true);
      toast({
        title: "Заявка отправлена",
        description: "Менеджер свяжется с вами и уточнит доступные варианты финансирования.",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "stale-privacy-version") {
        toast({
          title: "Согласие обновлено",
          description: "Подтвердите согласие повторно: условия обработки данных изменились.",
          variant: "destructive",
        });
      } else {
        console.error("Finance form submit failed", error);
        toast({
          title: "Не удалось отправить заявку",
          description: "Проверьте соединение или свяжитесь с нами по телефону. Данные не отправлены.",
          variant: "destructive",
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted && selectedProduct) {
    return (
      <main className="flex min-h-screen items-center pb-12 pt-24 sm:pb-16 sm:pt-28">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-600 text-white sm:mb-8 sm:h-20 sm:w-20">
              <Check className="h-8 w-8 sm:h-10 sm:w-10" />
            </div>
            <h1 className="section-title mb-4 text-3xl sm:text-4xl">Заявка принята</h1>
            <p className="mx-auto mb-6 max-w-xl text-muted-foreground sm:mb-8">
              Мы получили запрос по модели {selectedProduct.name}. Теперь заявку последовательно обработает менеджер.
            </p>

            <div className="mb-6 rounded-lg border border-border bg-card p-4 text-left sm:mb-8 sm:p-6">
              <h2 className="mb-4 font-display text-xl uppercase tracking-wider">Что произойдёт дальше</h2>
              <ol className="space-y-4 text-sm text-muted-foreground sm:text-base">
                {AFTER_SUBMISSION_STEPS.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 rounded-lg bg-secondary/50 p-3 text-sm text-foreground">
                Отправка заявки не означает одобрение финансирования и не фиксирует условия. Доступность варианта и финальные условия подтверждаются после проверки.
              </p>
            </div>

            <div className="flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => {
                  submissionAttempt.current = undefined;
                  setForm(createInitialForm(selectedProduct));
                  setIsSubmitted(false);
                }}
                className="btn-primary min-h-11 rounded-lg px-4 text-base sm:px-8 sm:text-lg"
              >
                Новая заявка
              </button>
              <Link to={`/catalog/${selectedProduct.slug}`} className="btn-secondary min-h-11 px-4 text-base sm:px-8 sm:text-lg">
                Вернуться к модели
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pb-12 pt-24 sm:pb-16 sm:pt-28">
      <div className="container">
        <nav className="mb-6 sm:mb-8">
          <ol className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <li>
              <Link to="/" className="transition-colors hover:text-foreground">
                Главная
              </Link>
            </li>
            <li>/</li>
            <li className="text-foreground">Финансирование</li>
          </ol>
        </nav>

        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] xl:gap-8">
          <section className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-4 sm:p-6 lg:p-8">
              <p className="mb-3 font-display text-sm uppercase tracking-[0.3em] text-primary">
                Кредит, лизинг, рассрочка
              </p>
              <h1 className="section-title mb-4 break-words text-3xl leading-tight sm:text-4xl lg:text-5xl">
                Подберите финансирование для болотохода «Росомаха»
              </h1>
              <p className="max-w-3xl text-base text-muted-foreground sm:text-lg">
                Покажем стоимость техники, размер первоначального взноса и сумму к финансированию. Финальные условия подтверждаются после заявки и проверки партнёром.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold">Заполнено разделов: {completedSteps} из 3</p>
                <p className="mt-1 text-sm text-muted-foreground">Модель и сумма, параметры заявки, контакты и согласие.</p>
              </div>
              <div className="grid w-full grid-cols-3 gap-2 sm:w-auto" aria-label={`Заполнено ${completedSteps} из 3`}>
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-2 min-w-0 rounded-full sm:w-12 ${step <= completedSteps ? "bg-primary" : "bg-secondary"}`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 sm:p-6 lg:p-8">
              <div className="mb-6 flex items-center gap-3">
                <ShieldCheck className="h-6 w-6 text-primary" />
                <h2 className="font-display text-2xl uppercase tracking-wider">
                  Калькулятор заявки
                </h2>
              </div>

              {metadataError ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                  {metadataError}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <p className="text-sm font-semibold text-primary">Раздел 1</p>
                  <h3 className="mt-1 font-display text-xl uppercase tracking-wider">Модель и сумма</h3>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Модель *</span>
                    <select
                      value={selectedProduct?.slug ?? ""}
                      onChange={(event) => {
                        const nextProduct = findProduct(event.target.value);
                        if (!nextProduct) {
                          return;
                        }

                        submissionAttempt.current = undefined;
                        setForm((current) => ({
                          ...current,
                          productSlug: nextProduct.slug,
                          downPayment: clampDownPayment(current.downPayment, nextProduct.basePrice),
                        }));
                      }}
                      className="input-premium min-h-[52px]"
                      required
                    >
                      {visibleProducts.map((product) => (
                        <option key={product.slug} value={product.slug}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Срок, месяцев *</span>
                    <input
                      type="number"
                      min={MIN_TERM_MONTHS}
                      max={MAX_TERM_MONTHS}
                      step={1}
                      value={form.termMonths}
                      onChange={(event) => updateForm("termMonths", clampTerm(Number(event.target.value)))}
                      className="input-premium min-h-[52px]"
                      required
                    />
                  </label>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="min-w-0 rounded-lg border border-border bg-secondary/30 p-4 sm:p-5">
                    <div className="mb-3 flex flex-col items-start gap-1 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between min-[390px]:gap-4">
                      <span className="text-sm text-muted-foreground">Стоимость техники</span>
                      <span className="max-w-full break-words font-display text-xl font-bold tabular-nums text-primary sm:text-2xl">{formatPrice(saleAmount)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Цена берётся из актуального каталога Rosomaha. В заявку уходит именно эта стоимость, без ручного ввода суммы.
                    </p>
                  </div>

                  <label className="min-w-0 rounded-lg border border-border bg-secondary/30 p-4 sm:p-5">
                    <div className="mb-3 flex flex-col items-start gap-1 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between min-[390px]:gap-4">
                      <span className="text-sm text-muted-foreground">Первоначальный взнос</span>
                      <span className="max-w-full break-words text-lg font-bold tabular-nums sm:text-xl">{formatPrice(downPayment)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={saleAmount || 0}
                      step={10000}
                      value={downPayment}
                      onChange={(event) => updateForm("downPayment", clampDownPayment(Number(event.target.value), saleAmount))}
                      className="mb-3 w-full accent-primary"
                    />
                    <input
                      type="number"
                      min={0}
                      max={saleAmount}
                      step={10000}
                      value={downPayment}
                      onChange={(event) => updateForm("downPayment", clampDownPayment(Number(event.target.value), saleAmount))}
                      className="input-premium min-h-[52px]"
                    />
                  </label>
                </div>

                <div className="border-t border-border pt-6">
                  <p className="text-sm font-semibold text-primary">Раздел 2</p>
                  <h3 className="mt-1 font-display text-xl uppercase tracking-wider">Параметры заявки</h3>
                </div>

                <fieldset>
                  <legend className="mb-3 text-sm font-medium">Тип финансирования *</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {FINANCING_TYPES.map((type) => {
                      const isSelected = form.financingType === type;

                      return (
                        <label
                          key={type}
                          className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border bg-secondary/30 text-muted-foreground hover:border-primary/60"
                          }`}
                        >
                          <input
                            type="radio"
                            name="financingType"
                            value={type}
                            checked={isSelected}
                            onChange={() => updateForm("financingType", type)}
                            className="mt-1 h-5 w-5 shrink-0 accent-primary"
                            required
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-foreground">{FINANCING_TYPE_LABELS[type]}</span>
                            <span className="mt-1 block text-sm leading-5">
                              {FINANCING_TYPE_DESCRIPTIONS[type]}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>

                <label className="block md:max-w-md">
                  <span className="mb-2 block text-sm font-medium">Кто оформляет заявку *</span>
                  <select
                    value={form.applicantType}
                    onChange={(event) => updateForm("applicantType", event.target.value as ApplicantType | "")}
                    className="input-premium min-h-[52px]"
                    required
                  >
                    <option value="" disabled>Выберите тип</option>
                    {APPLICANT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {APPLICANT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="min-w-0 rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-sm text-muted-foreground">К финансированию</div>
                    <div className="mt-2 max-w-full break-words font-display text-2xl tabular-nums text-primary sm:text-3xl">{formatPrice(financedAmount)}</div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-sm text-muted-foreground">Срок</div>
                    <div className="mt-2 font-display text-2xl tabular-nums sm:text-3xl">{clampTerm(form.termMonths)} мес.</div>
                  </div>
                  <div className="min-w-0 rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-sm text-muted-foreground">Формат обращения</div>
                    <div className="mt-2 text-base font-medium">
                      {form.financingType ? FINANCING_TYPE_LABELS[form.financingType] : "Не выбран"}
                    </div>
                  </div>
                </div>

                <div className="border-t border-border pt-6">
                  <p className="text-sm font-semibold text-primary">Раздел 3</p>
                  <h3 className="mt-1 font-display text-xl uppercase tracking-wider">Контакты и согласие</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Имя *</span>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(event) => updateForm("name", event.target.value)}
                      className="input-premium min-h-[52px]"
                      placeholder="Иван Иванов"
                      minLength={2}
                      maxLength={120}
                      autoComplete="name"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Телефон *</span>
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={(event) => updateForm("phone", event.target.value)}
                      className="input-premium min-h-[52px]"
                      placeholder="+7 (___) ___-__-__"
                      maxLength={24}
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">E-mail</span>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(event) => updateForm("email", event.target.value)}
                      className="input-premium min-h-[52px]"
                      placeholder="mail@example.ru"
                      maxLength={160}
                      autoComplete="email"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Город</span>
                    <input
                      type="text"
                      value={form.city}
                      onChange={(event) => updateForm("city", event.target.value)}
                      className="input-premium min-h-[52px]"
                      placeholder="Тюмень"
                      maxLength={120}
                      autoComplete="address-level2"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium">Комментарий</span>
                  <textarea
                    value={form.comment}
                    onChange={(event) => updateForm("comment", event.target.value)}
                    className="input-premium min-h-[140px]"
                    placeholder="Опишите задачу: для охоты, рыбалки, вахты, перевозки людей или груза."
                    maxLength={2000}
                  />
                </label>

                <div className="flex items-start gap-3 rounded-lg border border-border bg-card/70 px-4 py-4 text-sm text-muted-foreground">
                  <input
                    id="finance-privacy-consent"
                    type="checkbox"
                    checked={form.privacyAccepted}
                    disabled={!privacyDocument || isMetadataLoading}
                    onChange={(event) => updateForm("privacyAccepted", event.target.checked)}
                    aria-describedby="finance-privacy-policy-note"
                    className="mt-1 h-5 w-5 shrink-0 rounded border-border accent-primary"
                    required
                  />
                  <div className="min-w-0">
                    <label htmlFor="finance-privacy-consent" className="cursor-pointer text-foreground">
                      Я даю согласие ООО ТПК «РОСОМАХА» на обработку персональных данных для рассмотрения заявки и связи со мной
                      {privacyDocument ? (
                        <>
                          {" "}по документу «{privacyDocument.title}», версия <span className="font-medium">{privacyDocument.version}</span>.
                        </>
                      ) : (
                        "."
                      )}
                    </label>
                    <span id="finance-privacy-policy-note" className="mt-2 block">
                      Подробнее об обработке данных — в отдельной{" "}
                      <Link
                        to="/politika-konfidencialnosti"
                        className="font-medium text-foreground underline decoration-primary underline-offset-4 hover:text-primary"
                      >
                        политике конфиденциальности
                      </Link>.
                    </span>
                  </div>
                </div>

                <button type="submit" disabled={isSubmitting || isMetadataLoading || !privacyDocument || !form.privacyAccepted} className="btn-primary min-h-[52px] w-full rounded-lg px-4 py-3 text-base leading-snug disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:transform-none sm:px-8 sm:text-lg">
                  {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" /> : null}
                  {isSubmitting ? "Отправка..." : "Отправить заявку на финансирование"}
                </button>
              </form>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
              <h2 className="mb-4 font-display text-2xl uppercase tracking-wider">Что будет после отправки</h2>
              <ol className="space-y-4 text-sm text-muted-foreground">
                {AFTER_SUBMISSION_STEPS.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 rounded-lg bg-secondary/50 p-3 text-sm text-foreground">
                Заявка не равна одобрению и не фиксирует условия финансирования. Финальные условия подтверждаются только после проверки.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
              <div className="mb-3 flex items-center gap-2 text-primary">
                <AlertCircle className="h-5 w-5" />
                <h2 className="font-display text-xl uppercase tracking-wider">Что не запрашиваем на сайте</h2>
              </div>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>Паспортные данные.</li>
                <li>Сканы документов и фото.</li>
                <li>Реквизиты банковской карты.</li>
                <li>Подтверждение платежей на стороне сайта.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
              <h2 className="mb-4 font-display text-xl uppercase tracking-wider">Согласие и политика</h2>
              {isMetadataLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем документ…
                </div>
              ) : privacyDocument ? (
                <>
                  <div className="text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">{privacyDocument.title}</div>
                    <div className="mt-1">Актуальная версия: {privacyDocument.version}</div>
                  </div>
                  <details className="mt-4 border-y border-border py-3 text-sm">
                    <summary className="cursor-pointer font-medium text-foreground marker:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-card">
                      Точный текст документа, версия {privacyDocument.version}
                    </summary>
                    <div className="mt-3 whitespace-pre-wrap border-t border-border pt-3 leading-6 text-muted-foreground">
                      {privacyDocument.text}
                    </div>
                  </details>
                  <div className="mt-4 flex flex-col items-start gap-3 text-sm">
                    <Link
                      to="/politika-konfidencialnosti"
                      className="font-medium text-primary underline underline-offset-4 hover:text-foreground"
                    >
                      Открыть политику конфиденциальности
                    </Link>
                    <button
                      type="button"
                      onClick={() => void refreshPrivacyDocument()}
                      className="font-medium text-foreground underline decoration-primary underline-offset-4 hover:text-primary"
                    >
                      Проверить актуальную версию
                    </button>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    После обновления документа согласие нужно подтвердить повторно.
                  </p>
                </>
              ) : (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Документ недоступен. Пока версия не загружена, отправка формы заблокирована.</p>
                  <button
                    type="button"
                    onClick={() => void refreshPrivacyDocument()}
                    className="font-medium text-primary underline underline-offset-4 hover:text-foreground"
                  >
                    Повторить загрузку
                  </button>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
