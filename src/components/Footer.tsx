import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Clock } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-card border-t border-border">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Logo & Description */}
          <div className="lg:col-span-1">
            <Link to="/" className="inline-block mb-6">
              <span className="text-2xl font-display font-bold tracking-wider text-foreground">
                РОСОМАХА
              </span>
            </Link>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              Тюменский завод вездеходной техники. Производим снегоболотоходы 
              повышенной проходимости с 2012 года.
            </p>
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} ООО ТПК «РОСОМАХА»
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h3 className="font-display text-lg uppercase tracking-wider mb-6">
              Навигация
            </h3>
            <ul className="space-y-3">
              {[
                { name: 'О компании', href: '/company' },
                { name: 'Каталог моделей', href: '/catalog' },
                { name: 'Опции и запчасти', href: '/accessories' },
                { name: 'Доставка и оплата', href: '/delivery' },
                { name: 'Дилеры', href: '/dealers' },
                { name: 'Контакты', href: '/contacts' },
              ].map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-muted-foreground hover:text-primary transition-colors text-sm"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Models */}
          <div>
            <h3 className="font-display text-lg uppercase tracking-wider mb-6">
              Модели
            </h3>
            <ul className="space-y-3">
              {[
                { name: 'Классические модели', href: '/catalog?category=classic' },
                { name: 'Пикапы', href: '/catalog?category=pickup' },
                { name: 'Шестиколёсники', href: '/catalog?category=sixwheel' },
                { name: 'Прицепы', href: '/catalog?category=trailer' },
              ].map((item) => (
                <li key={item.name}>
                  <Link
                    to={item.href}
                    className="text-muted-foreground hover:text-primary transition-colors text-sm"
                  >
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contacts */}
          <div>
            <h3 className="font-display text-lg uppercase tracking-wider mb-6">
              Контакты
            </h3>
            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <Phone className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <a
                    href="tel:+73452564164"
                    className="text-foreground hover:text-primary transition-colors block"
                  >
                    +7 (3452) 564-164
                  </a>
                  <a
                    href="tel:+79220711174"
                    className="text-muted-foreground hover:text-primary transition-colors text-sm"
                  >
                    +7 (922) 071 11-74 (WhatsApp)
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Mail className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <a
                  href="mailto:rosomaha-rus@mail.ru"
                  className="text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  rosomaha-rus@mail.ru
                </a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <span className="text-muted-foreground text-sm">
                  Тюменская область, п. Московский, ул. Бурлаки 29В
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <span className="text-muted-foreground text-sm">
                  Пн – Пт: 9:00 – 18:00
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-border">
        <div className="container py-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-muted-foreground">
            ИНН 7224087219 | ОГРН 1237200009133
          </p>
          <div className="flex items-center gap-6">
            <Link
              to="/privacy"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Политика конфиденциальности
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
