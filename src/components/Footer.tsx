import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin, Clock, MessageCircle, Youtube, CreditCard } from 'lucide-react';
import { officePhone, primaryPhone } from '@/data/contactInfo';
import { trackPhoneClick, trackTelegramClick } from '@/lib/metrika';

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
                { name: 'Дополнительные опции', href: '/options' },
                { name: 'Статьи', href: '/articles' },
                { name: 'Видео', href: '/media' },
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
                  href="https://max.ru/u/f9LHodD0cOL3V4NXRmtmYF2IZjxHXKlaVXudIXvPuAhApJSxwS2OhFH8Id4"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors text-sm"
                >
                  <svg className="w-4 h-4" viewBox="0 0 42 42" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" clipRule="evenodd" d="M21.47 41.88c-4.11 0-6.02-.6-9.34-3-2.1 2.7-8.75 4.81-9.04 1.2 0-2.71-.6-5-1.28-7.5C1 29.5.08 26.07.08 21.1.08 9.23 9.82.3 21.36.3c11.55 0 20.6 9.37 20.6 20.91a20.6 20.6 0 0 1-20.49 20.67m.17-31.32c-5.62-.29-10 3.6-10.97 9.7-.8 5.05.62 11.2 1.83 11.52.58.14 2.04-1.04 2.95-1.95a10.4 10.4 0 0 0 5.08 1.81 10.7 10.7 0 0 0 11.19-9.97 10.7 10.7 0 0 0-10.08-11.1Z" />
                  </svg>
                  MAX
                </a>
              </li>
              <li>
                <a
                  href="https://t.me/rosomaha_site"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackTelegramClick('footer')}
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
                    href={primaryPhone.href}
                    onClick={() => trackPhoneClick('footer_primary')}
                    className="text-foreground hover:text-primary transition-colors block"
                  >
                    {primaryPhone.display}
                  </a>
                  <a
                    href={officePhone.href}
                    onClick={() => trackPhoneClick('footer_office')}
                    className="text-muted-foreground hover:text-primary transition-colors text-sm"
                  >
                    {officePhone.label}: {officePhone.display}
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
