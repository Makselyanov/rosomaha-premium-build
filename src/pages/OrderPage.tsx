import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { Send, Check } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { useToast } from '@/hooks/use-toast';

export default function OrderPage() {
  const navigate = useNavigate();
  const { items, clearCart, getTotalPrice } = useCartStore();
  const { toast } = useToast();
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    comment: '',
  });

  const formatPrice = (price: number) => new Intl.NumberFormat('ru-RU').format(price) + ' ₽';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitted(true);
    clearCart();
    toast({ title: 'Заявка отправлена!', description: 'Мы свяжемся с вами в ближайшее время.' });
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
              <div className="space-y-3 mb-4">
                {items.map((item) => (
                  <div key={item.model.id} className="flex justify-between">
                    <span>{item.model.name} × {item.quantity}</span>
                    <span className="text-primary">{formatPrice(item.model.price * item.quantity)}</span>
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
            <button type="submit" className="btn-primary w-full">
              <Send className="mr-2 w-5 h-5" />
              Отправить заявку
            </button>
          </form>
        </motion.div>
      </div>
    </main>
  );
}
