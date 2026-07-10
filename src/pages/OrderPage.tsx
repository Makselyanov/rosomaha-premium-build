import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Send, Check, Loader2 } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import { trackLeadSubmit } from '@/lib/metrika';
import { getAttribution } from '@/lib/attribution';
import { PRIVACY_CONSENT_VERSION } from '@/lib/consent';

const CRM_WEBHOOK_URL = 'https://rosomaha.centrlp.ru/api/webhooks/site-form';
const USER_COMMENT_LIMIT = 700;
const CRM_COMMENT_LIMIT = 2400;

function normalizeRussianPhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits || undefined;
}

function isValidRussianPhone(value: string | undefined) {
  return Boolean(value && /^7\d{10}$/.test(value));
}

function createLeadSubmissionId() {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `rosomaha-${Date.now()}-${randomPart}`;
}

function extractCrmResponseId(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== 'object') return undefined;
  const data = responseBody as Record<string, unknown>;
  const id = data.id ?? data.deal_id ?? data.dealId ?? data.lead_id ?? data.leadId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function extractCrmSubmissionId(responseBody: unknown) {
  if (!responseBody || typeof responseBody !== 'object') return undefined;
  const value = (responseBody as Record<string, unknown>).lead_submission_id;
  return typeof value === 'string' ? value : undefined;
}

function writeLeadReceipt(receipt: Record<string, unknown>) {
  try {
    sessionStorage.setItem('rosomaha_last_lead_receipt', JSON.stringify(receipt));
  } catch {
    // Receipt is diagnostic only; form submission must not fail because storage is unavailable.
  }
}

function limitCrmText(value: string | undefined, limit: number) {
  const text = value?.trim();
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit - 24).trimEnd()}\n...[сокращено]` : text;
}

export default function OrderPage() {
  const { items, clearCart, getTotalPrice, getItemTotal } = useCartStore();
  const { toast } = useToast();
  const pendingSubmissionId = useRef<string>();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    comment: '',
    privacyAccepted: false,
  });

  const formatPrice = (price: number) => new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedPhone = normalizeRussianPhone(formData.phone);
    const customerName = formData.name.trim();

    if (customerName.length < 2 || !isValidRussianPhone(normalizedPhone)) {
      toast({
        title: 'Проверьте контакты',
        description: 'Нужны имя и телефон в формате +7, чтобы мы могли связаться.',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);

    // Детализация корзины — читаемый текст в комментарий к заявке
    const orderDetails = items.map((item, index) => {
      const options = item.options.length > 0
        ? `\n   Опции: ${item.options.map(o => `${o.name} (+${formatPrice(o.price)})`).join(', ')}`
        : '';
      return `${index + 1}. ${item.product.name} (${item.variant.name}) - ${item.quantity} шт.
   Цвет: ${item.color.name}
   Цена: ${formatPrice(getItemTotal(item))}${options}`;
    }).join('\n\n');

    const totalStr = formatPrice(getTotalPrice());
    const commentWithOrder = limitCrmText([
      limitCrmText(formData.comment, USER_COMMENT_LIMIT),
      orderDetails ? `\n\n--- Заказ ---\n${orderDetails}\n\nИтого: ${totalStr}` : '',
    ].filter(Boolean).join(''), CRM_COMMENT_LIMIT);

    // Первая позиция корзины (если есть) → в структурированные поля сделки
    const firstItem = items[0];
    const modelText = firstItem
      ? `${firstItem.product.name} (${firstItem.variant.name})`
      : undefined;
    const colorName = firstItem?.color?.name;

    try {
      const attribution = await getAttribution();
      const leadSubmissionId = pendingSubmissionId.current || createLeadSubmissionId();
      pendingSubmissionId.current = leadSubmissionId;

      const payload = {
        name: customerName,
        phone: formData.phone,
        phone_normalized: normalizedPhone,
        lead_submission_id: leadSubmissionId,
        comment: commentWithOrder,
        source: 'росомаха.site',
        form_name: 'order_page',
        privacy_accepted: formData.privacyAccepted ? '1' : '0',
        privacy_accepted_at: new Date().toISOString(),
        privacy_version: PRIVACY_CONSENT_VERSION,
        consent_source: 'росомаха.site/order',
        model_text: modelText,
        color: colorName,
        deal_amount: getTotalPrice() || undefined,
        ...attribution,
      };

      const response = await fetch(CRM_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`CRM webhook ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const responseText = await response.text().catch(() => '');
      let crmResponse: Record<string, unknown> | undefined;
      try {
        crmResponse = responseText ? JSON.parse(responseText) as Record<string, unknown> : undefined;
      } catch {
        crmResponse = undefined;
      }
      const crmResponseId = extractCrmResponseId(crmResponse);
      const crmSubmissionId = extractCrmSubmissionId(crmResponse);

      if (!crmResponseId || crmSubmissionId !== leadSubmissionId) {
        throw new Error('CRM did not confirm the submitted lead id');
      }

      writeLeadReceipt({
        lead_submission_id: leadSubmissionId,
        crm_response_id: crmResponseId,
        sent_at: new Date().toISOString(),
        form_name: payload.form_name,
        phone_normalized: normalizedPhone,
        source_platform: attribution.source_platform,
        source_channel: attribution.source_channel,
        utm_source: attribution.utm_source,
        utm_medium: attribution.utm_medium,
        utm_campaign: attribution.utm_campaign,
        yclid: attribution.yclid,
        ym_client_id: attribution.ym_client_id,
      });

      trackLeadSubmit({
        source: 'order_page',
        items_count: items.length,
        lead_submission_id: leadSubmissionId,
        crm_response_id: crmResponseId || '',
        source_platform: attribution.source_platform || '',
        source_channel: attribution.source_channel || '',
        utm_source: attribution.utm_source || '',
        utm_medium: attribution.utm_medium || '',
        utm_campaign: attribution.utm_campaign || '',
        yclid: attribution.yclid || '',
        ym_client_id: attribution.ym_client_id || '',
      });

      pendingSubmissionId.current = undefined;
      setIsSubmitted(true);
      clearCart();
      toast({ title: 'Заявка отправлена!', description: 'Мы свяжемся с вами в ближайшее время.' });
    } catch (error) {
      console.error('Lead submission failed:', error);
      toast({
        title: 'Ошибка отправки',
        description: 'Не удалось отправить заявку. Пожалуйста, проверьте соединение или свяжитесь с нами по телефону.',
        variant: 'destructive'
      });
    } finally {
      setIsSending(false);
    }
  };

  if (isSubmitted) {
    return (
      <main className="pt-24 pb-16 min-h-screen flex items-center">
        <div className="container max-w-xl text-center">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-20 h-20 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-8">
            <Check className="w-10 h-10 text-white" />
          </motion.div>
          <h1 className="section-title text-3xl mb-4">Спасибо за заявку!</h1>
          <p className="text-muted-foreground mb-8">Наши менеджеры свяжутся с вами в ближайшее время для уточнения деталей.</p>
          <Link to="/" className="btn-primary">На главную</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="pt-24 pb-16">
      <div className="container max-w-2xl">
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li><Link to="/" className="hover:text-foreground">Главная</Link></li>
            <li>/</li>
            <li className="text-foreground">Получить расчёт</li>
          </ol>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="section-title text-3xl mb-8">Получить расчёт снегоболотохода</h1>

          {items.length > 0 && (
            <div className="bg-card p-6 rounded-lg border border-border mb-8">
              <h2 className="font-display uppercase tracking-wider mb-4">Выбранные товары</h2>
              <div className="space-y-4 mb-4">
                {items.map((item, index) => (
                  <div key={index} className="border-b border-border pb-4 last:border-0 last:pb-0">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="font-medium">{item.product.name}</p>
                        <p className="text-sm text-muted-foreground">{item.variant.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="w-4 h-4 rounded-full border border-border"
                            style={{ backgroundColor: item.color.hex }}
                          />
                          <span className="text-xs text-muted-foreground">{item.color.name}</span>
                        </div>
                      </div>
                      <span className="text-primary font-medium">{formatPrice(getItemTotal(item))}</span>
                    </div>
                    {item.options.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2 pl-4 border-l-2 border-primary/30 space-y-1">
                        {item.options.map((opt) => (
                          <div key={opt.id} className="flex justify-between">
                            <span>{opt.name}</span>
                            <span className="text-primary">+{opt.priceFormatted}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-4 flex justify-between font-bold">
                <span>Итого:</span>
                <span className="text-gradient text-xl">{formatPrice(getTotalPrice())}</span>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-medium mb-2">Ваше имя *</label>
              <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="input-premium" placeholder="Иван Иванов" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Телефон *</label>
              <input type="tel" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="input-premium" placeholder="+7 (___) ___-__-__" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Комментарий</label>
              <textarea value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} className="input-premium min-h-[120px]" placeholder="Маршрут, сезон, людей/груза, интересующая модель..." />
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-card/60 px-4 py-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                required
                checked={formData.privacyAccepted}
                onChange={(e) => setFormData({ ...formData, privacyAccepted: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-border"
              />
              <span>
                Я даю согласие ООО ТПК «РОСОМАХА» на обработку моих персональных данных для обработки заявки, связи со мной и подготовки предложения.
                {" "}
                <Link to="/privacy" className="text-primary underline underline-offset-4">
                  Политика обработки персональных данных
                </Link>
                .
              </span>
            </label>
            <button type="submit" className="btn-primary w-full" disabled={isSending}>
              {isSending ? (
                <Loader2 className="mr-2 w-5 h-5 animate-spin" />
              ) : (
                <Send className="mr-2 w-5 h-5" />
              )}
              {isSending ? 'Отправка...' : 'Получить расчёт'}
            </button>
          </form>
        </motion.div>
      </div>
    </main>
  );
}
