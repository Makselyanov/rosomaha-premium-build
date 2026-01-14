import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Clock, MessageCircle, Youtube, CreditCard } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-card border-t border-border">
      <div className="container py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12">
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
                { name: 'Статьи', href: '/articles' },
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

          {/* Social Media & Finance */}
          <div>
            <h3 className="font-display text-lg uppercase tracking-wider mb-6">
              Соцсети
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://t.me/rosomaha_site"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  Telegram
                </a>
              </li>
              <li>
                <a
                  href="https://vk.com/rosomaha_service"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M15.07 2H8.93C3.33 2 2 3.33 2 8.93v6.14C2 20.67 3.33 22 8.93 22h6.14c5.6 0 6.93-1.33 6.93-6.93V8.93C22 3.33 20.67 2 15.07 2zm3.13 14.01h-1.41c-.48 0-.63-.38-1.48-1.29-.76-.76-1.1-.86-1.29-.86-.26 0-.34.08-.34.47v1.18c0 .32-.1.51-1.01.51-1.49 0-3.14-.9-4.3-2.56-1.76-2.37-2.24-4.15-2.24-4.51 0-.19.08-.37.47-.37h1.41c.35 0 .48.16.62.54.68 1.98 1.83 3.71 2.3 3.71.18 0 .26-.08.26-.54V9.47c-.06-1.1-.64-1.19-.64-1.58 0-.16.13-.31.34-.31h2.2c.29 0 .4.16.4.5v3.01c0 .29.13.4.21.4.18 0 .33-.11.67-.44 1.04-1.17 1.79-2.97 1.79-2.97.1-.21.26-.37.61-.37h1.41c.42 0 .51.21.42.5-.17.8-1.86 3.17-1.86 3.17-.15.24-.21.35 0 .62.15.2.64.62 1 1.01.65.71 1.14 1.31 1.27 1.73.14.41-.07.62-.48.62z" />
                  </svg>
                  ВКонтакте
                </a>
              </li>
              <li>
                <a
                  href="https://www.youtube.com/@Rosomaha_Club"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <Youtube className="w-4 h-4" />
                  YouTube
                </a>
              </li>
            </ul>

            <h3 className="font-display text-lg uppercase tracking-wider mb-6 mt-8">
              Условия покупки
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://abc-cred.ru/ooo-tzvt-ooo-tpk-rosomaxa/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <CreditCard className="w-4 h-4" />
                  Кредит
                </a>
              </li>
              <li>
                <a
                  href="https://abc-cred.ru/ooo-tzvt-ooo-tpk-rosomaxa/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <CreditCard className="w-4 h-4" />
                  Рассрочка
                </a>
              </li>
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
              to="/politika-konfidencialnosti"
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
