import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Truck, CreditCard, Shield, Clock } from 'lucide-react';

export default function DeliveryPage() {
  return (
    <main className="pt-24 pb-16">
      <div className="container max-w-4xl">
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li><Link to="/" className="hover:text-foreground">Главная</Link></li>
            <li>/</li>
            <li className="text-foreground">Доставка и оплата</li>
          </ol>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="section-title mb-8">Доставка и оплата</h1>

          <div className="grid md:grid-cols-2 gap-8 mb-12">
            {[
              { icon: Truck, title: 'Доставка по России', desc: 'Отправляем технику любой транспортной компанией в любую точку РФ и стран таможенного союза.' },
              { icon: CreditCard, title: 'Удобная оплата', desc: 'Безналичный расчёт для юридических лиц. Предоплата или рассрочка по договорённости.' },
              { icon: Shield, title: 'Гарантия', desc: '6 месяцев или 200 моточасов на всю технику. Гарантийное обслуживание у дилеров.' },
              { icon: Clock, title: 'Сроки', desc: 'Изготовление под заказ от 2 недель. Наличие уточняйте у менеджеров.' },
            ].map((item) => (
              <div key={item.title} className="p-8 bg-card rounded-lg border border-border">
                <item.icon className="w-10 h-10 text-primary mb-4" />
                <h3 className="font-display text-xl uppercase tracking-wider mb-3">{item.title}</h3>
                <p className="text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="bg-primary/10 p-8 rounded-lg border border-primary/30 text-center">
            <p className="text-lg mb-4">Стоимость доставки рассчитывается индивидуально</p>
            <Link to="/order" className="btn-primary">Запросить расчёт</Link>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
