import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Send, Check, Loader2 } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';
import emailjs from '@emailjs/browser';

export default function OrderPage() {
  const { items, clearCart, getTotalPrice, getItemTotal } = useCartStore();
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    comment: '',
  });

  const formatPrice = (price: number) => new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);

    const orderDetails = items.map((item, index) => {
      const options = item.options.length > 0
        ? `\n   Опции: ${item.options.map(o => `${o.name} (+${formatPrice(o.price)})`).join(', ')}`
        : '';
      return `${index + 1}. ${item.product.name} (${item.variant.name}) - ${item.quantity} шт.
   Цвет: ${item.color.name}
   Цена: ${formatPrice(getItemTotal(item))}${options}`;
    }).join('\n\n');

    const templateParams = {
      customer_name: formData.name,
      customer_phone: formData.phone,
      message: formData.comment,
      order_details: orderDetails,
      total_price: formatPrice(getTotalPrice()),
      subject: 'заявка с сайта росомаха.site',
      to_email: 'rosomaha-rus999@yandex.ru, rosomaha-rus@mail.ru'
    };

    try {
      const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
      const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
      const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;

      if (!serviceId || !templateId || !publicKey) {
        throw new Error('EmailJS configuration missing');
      }

      await emailjs.send(
        serviceId,
        templateId,
        templateParams,
        publicKey
      );

      setIsSubmitted(true);
      clearCart();
      toast({ title: 'Заявка отправлена!', description: 'Мы свяжемся с вами в ближайшее время.' });
    } catch (error) {
      console.error('Email sending failed:', error);
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
            <li className="text-foreground">Оформление заявки</li>
          </ol>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="section-title text-3xl mb-8">Оформление заявки</h1>

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
              <textarea value={formData.comment} onChange={(e) => setFormData({ ...formData, comment: e.target.value })} className="input-premium min-h-[120px]" placeholder="Интересующая модель, вопросы..." />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={isSending}>
              {isSending ? (
                <Loader2 className="mr-2 w-5 h-5 animate-spin" />
              ) : (
                <Send className="mr-2 w-5 h-5" />
              )}
              {isSending ? 'Отправка...' : 'Отправить заявку'}
            </button>
          </form>
        </motion.div>
      </div>
    </main>
  );
}
