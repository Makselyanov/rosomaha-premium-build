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

  const refreshPrivacyDocument = async (resetConsent = false) => {
    setIsMetadataLoading(true);
    setMetadataError(null);

    try {
      const response = await fetch(FINANCE_INTAKE_URL, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const body = await response.json().catch(() => null);
      const parsed = parseFinancePrivacyMetadata(body);

      if (!response.ok || !parsed) {
        throw new Error("Finance legal metadata is unavailable.");
      }

      setPrivacyDocument(parsed);
      if (resetConsent) {
        submissionAttempt.current = undefined;
        setForm((current) => ({ ...current, privacyAccepted: false }));
      }
    } catch (error) {
      console.error("Finance privacy metadata failed", error);
      setPrivacyDocument(null);
      setMetadataError("Форма временно недоступна: не удалось получить актуальное согласие на обработку данных.");
    } finally {
      setIsMetadataLoading(false);
    }
  };

  useEffect(() => {
    void refreshPrivacyDocument();
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
        await refreshPrivacyDocument(true);
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
      <main className="min-h-screen flex items-center pb-16 pt-24">
        <div className="container max-w-2xl text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-green-600 text-white">
            <Check className="h-10 w-10" />
          </div>
          <h1 className="section-title mb-4 text-3xl">Заявка принята</h1>
          <p className="mx-auto mb-8 max-w-xl text-muted-foreground">
            Мы получили запрос по модели {selectedProduct.name}. Менеджер уточнит задачу, комплектность и доступные варианты кредита, лизинга или рассрочки.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                submissionAttempt.current = undefined;
                setForm(createInitialForm(selectedProduct));
                setIsSubmitted(false);
              }}
              className="btn-primary min-h-11 rounded-lg"
            >
              Новая заявка
            </button>
            <Link to={`/catalog/${selectedProduct.slug}`} className="btn-secondary">
              Вернуться к модели
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="pb-16 pt-24">
      <div className="container max-w-6xl">
        <nav className="mb-8">
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

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-8">
              <p className="mb-3 font-display text-sm uppercase tracking-[0.3em] text-primary">
                Кредит, лизинг, рассрочка
              </p>
              <h1 className="section-title mb-4 text-3xl md:text-5xl">
                Подберите финансирование для болотохода «Росомаха»
              </h1>
              <p className="max-w-3xl text-lg text-muted-foreground">
                Покажем стоимость техники, размер первоначального взноса и сумму к финансированию. Финальные условия подтверждаются после заявки и проверки партнёром.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
              <div>
                <p className="text-sm font-semibold">Заполнено разделов: {completedSteps} из 3</p>
                <p className="mt-1 text-sm text-muted-foreground">Модель и сумма, параметры заявки, контакты и согласие.</p>
              </div>
              <div className="flex gap-2" aria-label={`Заполнено ${completedSteps} из 3`}>
                {[1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={`h-2 w-12 rounded-full ${step <= completedSteps ? "bg-primary" : "bg-secondary"}`}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-8">
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
                  <div className="rounded-lg border border-border bg-secondary/30 p-5">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">Стоимость техники</span>
                      <span className="font-display text-2xl font-bold text-primary">{formatPrice(saleAmount)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Цена берётся из актуального каталога Rosomaha. В заявку уходит именно эта стоимость, без ручного ввода суммы.
                    </p>
                  </div>

                  <label className="rounded-lg border border-border bg-secondary/30 p-5">
                    <div className="mb-3 flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">Первоначальный взнос</span>
                      <span className="text-xl font-bold">{formatPrice(downPayment)}</span>
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

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium">Тип финансирования *</span>
                    <select
                      value={form.financingType}
                      onChange={(event) => updateForm("financingType", event.target.value as FinancingType | "")}
                      className="input-premium min-h-[52px]"
                      required
                    >
                      <option value="" disabled>Выберите вариант</option>
                      {FINANCING_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {FINANCING_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
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
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-sm text-muted-foreground">К финансированию</div>
                    <div className="mt-2 font-display text-3xl text-primary">{formatPrice(financedAmount)}</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/70 p-4">
                    <div className="text-sm text-muted-foreground">Срок</div>
                    <div className="mt-2 font-display text-3xl">{clampTerm(form.termMonths)} мес.</div>
                  </div>
                  <div className="rounded-lg border border-border bg-card/70 p-4">
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

                <label className="flex items-start gap-3 rounded-lg border border-border bg-card/70 px-4 py-4 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={form.privacyAccepted}
                    disabled={!privacyDocument || isMetadataLoading}
                    onChange={(event) => updateForm("privacyAccepted", event.target.checked)}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-border accent-primary"
                    required
                  />
                  <span>
                    Я подтверждаю согласие на обработку персональных данных по актуальной версии документа
                    {privacyDocument ? (
                      <>
                        {" "}
                        <span className="font-medium text-foreground">{privacyDocument.version}</span>.
                      </>
                    ) : null}{" "}
                    Я ознакомлен с{" "}
                    <Link
                      to="/politika-konfidencialnosti"
                      className="font-medium text-foreground underline decoration-primary underline-offset-4 hover:text-primary"
                    >
                      политикой конфиденциальности
                    </Link>.
                  </span>
                </label>

                <button type="submit" disabled={isSubmitting || isMetadataLoading || !privacyDocument || !form.privacyAccepted} className="btn-primary min-h-[52px] w-full rounded-lg disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:transform-none">
                  {isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" /> : null}
                  {isSubmitting ? "Отправка..." : "Отправить заявку на финансирование"}
                </button>
              </form>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="mb-4 font-display text-2xl uppercase tracking-wider">Что увидит менеджер</h2>
              <ul className="space-y-3 text-sm text-muted-foreground">
                <li>Выбранную модель и актуальную стоимость из каталога.</li>
                <li>Первоначальный взнос, срок и тип финансирования.</li>
                <li>Контакты для обратной связи и маркетинговую атрибуцию заявки.</li>
                <li>Версию согласия, с которой была отправлена заявка.</li>
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-6">
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

            <div className="rounded-lg border border-border bg-card p-6">
              <h2 className="mb-4 font-display text-xl uppercase tracking-wider">Актуальное согласие</h2>
              {isMetadataLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загружаем документ…
                </div>
              ) : privacyDocument ? (
                <>
                  <div className="mb-3 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">{privacyDocument.title}</div>
                    <div>Версия: {privacyDocument.version}</div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/20 p-4 text-sm leading-6 text-muted-foreground">
                    {privacyDocument.text}
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshPrivacyDocument(true)}
                    className="mt-4 inline-flex text-sm text-primary hover:underline"
                  >
                    Обновить документ
                  </button>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Документ недоступен. Повторите попытку позже.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
