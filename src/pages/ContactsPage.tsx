import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Clock, MessageCircle } from 'lucide-react';

export default function ContactsPage() {
  return (
    <main className="pt-24 pb-16">
      <div className="container">
        <nav className="mb-8">
          <ol className="flex items-center gap-2 text-sm text-muted-foreground">
            <li><Link to="/" className="hover:text-foreground">Главная</Link></li>
            <li>/</li>
            <li className="text-foreground">Контакты</li>
          </ol>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-12">
          <h1 className="section-title mb-4">Контакты</h1>
          <p className="text-muted-foreground text-lg">Свяжитесь с нами удобным способом</p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12">
          <div className="space-y-8">
            {[
              { icon: Phone, title: 'Телефоны', content: <><a href="tel:+73452564164" className="block hover:text-primary">+7 (3452) 564-164 (офис)</a><a href="tel:+79220711174" className="block hover:text-primary">+7 (922) 071 11-74 (WhatsApp, Telegram)</a></> },
              { icon: Mail, title: 'Email', content: <a href="mailto:rosomaha-rus@mail.ru" className="hover:text-primary">rosomaha-rus@mail.ru</a> },
              { icon: MapPin, title: 'Адрес', content: 'Тюменская область, п. Московский, ул. Бурлаки 29В' },
              { icon: Clock, title: 'Режим работы', content: 'Пн – Пт: 9:00 – 18:00' },
            ].map((item) => (
              <div key={item.title} className="flex gap-4 p-6 bg-card rounded-lg border border-border">
                <item.icon className="w-6 h-6 text-primary flex-shrink-0" />
                <div><h3 className="font-display uppercase tracking-wider mb-2">{item.title}</h3><div className="text-muted-foreground">{item.content}</div></div>
              </div>
            ))}
          </div>

          <div className="bg-secondary/50 rounded-lg border border-border aspect-square flex items-center justify-center">
            <div className="text-center"><MapPin className="w-12 h-12 text-primary mx-auto mb-4" /><p className="text-muted-foreground">Карта расположения</p></div>
          </div>
        </div>

        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mt-16 text-center">
          <Link to="/order" className="btn-primary">Оставить заявку</Link>
        </motion.div>
      </div>
    </main>
  );
}
