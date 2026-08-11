import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ShoppingCart, Phone, MessageCircle, Youtube } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import { officePhone, primaryPhone } from '@/data/contactInfo';
import { trackOrderCtaClick, trackPhoneClick, trackTelegramClick } from '@/lib/metrika';
import logoImage from '@/assets/logo-rosomaha.png';

const navigation = [
  { name: 'О компании', href: '/company' },
  { name: 'Каталог', href: '/catalog' },
  { name: 'Опции', href: '/options' },
  { name: 'Статьи', href: '/articles' },
  { name: 'Видео', href: '/media' },
  { name: 'Финансирование', shortName: 'Финансы', href: '/finansirovanie' },
  { name: 'Доставка и оплата', shortName: 'Доставка', href: '/delivery' },
  { name: 'Контакты', href: '/contacts' },
  { name: 'Дилеры', href: '/dealers' },
];

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const { toggleCart, getTotalItems } = useCartStore();
  const totalItems = getTotalItems();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border/50">
      <nav className="mx-auto flex h-20 w-full max-w-[1760px] items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link to="/" className="flex shrink-0 items-center gap-3">
          <img src={logoImage} alt="Росомаха" className="h-9 w-auto max-w-[128px] sm:h-10 sm:max-w-[150px]" />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden min-w-0 flex-1 items-center justify-center gap-3 px-3 xl:flex min-[1440px]:gap-4 min-[1680px]:gap-5">
          {navigation.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              aria-current={location.pathname === item.href ? 'page' : undefined}
              className={`nav-link whitespace-nowrap text-[11px] min-[1440px]:text-xs min-[1680px]:text-sm ${location.pathname === item.href ? 'active text-foreground' : ''}`}
            >
              {item.shortName ?? item.name}
            </Link>
          ))}
        </div>

        {/* Right Section */}
        <div className="flex shrink-0 items-center gap-1 min-[1440px]:gap-2 min-[1600px]:gap-3">
          {/* Phone */}
          <div className="hidden flex-col items-end leading-tight min-[1440px]:flex">
            <a
              href={primaryPhone.href}
              onClick={() => trackPhoneClick('header_primary')}
              className="flex items-center gap-2 whitespace-nowrap text-xs font-semibold transition-colors hover:text-primary min-[1680px]:text-sm"
            >
              <Phone className="w-4 h-4" />
              <span>{primaryPhone.display}</span>
            </a>
            <a
              href={officePhone.href}
              onClick={() => trackPhoneClick('header_office')}
              className="mt-1 hidden whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-primary min-[1880px]:block"
            >
              {officePhone.label}: {officePhone.display}
            </a>
          </div>

          {/* Social Links */}
          <div className="hidden items-center gap-1 min-[1800px]:flex">
            <a
              href="https://max.ru/u/f9LHodD0cOL3V4NXRmtmYF2IZjxHXKlaVXudIXvPuAhApJSxwS2OhFH8Id4"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
              aria-label="MAX"
              title="MAX"
            >
              <svg className="w-5 h-5" viewBox="0 0 42 42" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M21.47 41.88c-4.11 0-6.02-.6-9.34-3-2.1 2.7-8.75 4.81-9.04 1.2 0-2.71-.6-5-1.28-7.5C1 29.5.08 26.07.08 21.1.08 9.23 9.82.3 21.36.3c11.55 0 20.6 9.37 20.6 20.91a20.6 20.6 0 0 1-20.49 20.67m.17-31.32c-5.62-.29-10 3.6-10.97 9.7-.8 5.05.62 11.2 1.83 11.52.58.14 2.04-1.04 2.95-1.95a10.4 10.4 0 0 0 5.08 1.81 10.7 10.7 0 0 0 11.19-9.97 10.7 10.7 0 0 0-10.08-11.1Z" />
              </svg>
            </a>
            <a
              href="https://t.me/rosomaha_site"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackTelegramClick('header')}
              className="p-1.5 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
              aria-label="Telegram"
              title="Telegram"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
            <a
              href="https://vk.com/rosomaha_service"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
              aria-label="ВКонтакте"
              title="ВКонтакте"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.07 2H8.93C3.33 2 2 3.33 2 8.93v6.14C2 20.67 3.33 22 8.93 22h6.14c5.6 0 6.93-1.33 6.93-6.93V8.93C22 3.33 20.67 2 15.07 2zm3.13 14.01h-1.41c-.48 0-.63-.38-1.48-1.29-.76-.76-1.1-.86-1.29-.86-.26 0-.34.08-.34.47v1.18c0 .32-.1.51-1.01.51-1.49 0-3.14-.9-4.3-2.56-1.76-2.37-2.24-4.15-2.24-4.51 0-.19.08-.37.47-.37h1.41c.35 0 .48.16.62.54.68 1.98 1.83 3.71 2.3 3.71.18 0 .26-.08.26-.54V9.47c-.06-1.1-.64-1.19-.64-1.58 0-.16.13-.31.34-.31h2.2c.29 0 .4.16.4.5v3.01c0 .29.13.4.21.4.18 0 .33-.11.67-.44 1.04-1.17 1.79-2.97 1.79-2.97.1-.21.26-.37.61-.37h1.41c.42 0 .51.21.42.5-.17.8-1.86 3.17-1.86 3.17-.15.24-.21.35 0 .62.15.2.64.62 1 1.01.65.71 1.14 1.31 1.27 1.73.14.41-.07.62-.48.62z" />
              </svg>
            </a>
            <a
              href="https://www.youtube.com/@Rosomaha_Club"
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
              aria-label="YouTube"
              title="YouTube"
            >
              <Youtube className="w-5 h-5" />
            </a>
          </div>

          {/* Cart Button */}
          <button
            onClick={toggleCart}
            className="relative p-2 hover:bg-secondary rounded-lg transition-colors"
            aria-label="Корзина"
          >
            <ShoppingCart className="w-6 h-6" />
            {totalItems > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-xs font-bold rounded-full flex items-center justify-center">
                {totalItems}
              </span>
            )}
          </button>

          {/* CTA Button */}
          <Link
            to="/order"
            onClick={() => trackOrderCtaClick('header_desktop')}
            className="btn-primary hidden whitespace-nowrap px-4 py-3 text-sm min-[1600px]:inline-flex min-[1720px]:px-5"
          >
            Получить расчёт
          </Link>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-lg p-2 transition-colors hover:bg-secondary xl:hidden"
            aria-label="Меню"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            id="mobile-navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="max-h-[calc(100svh-5rem)] overflow-y-auto overscroll-contain border-t border-border bg-background xl:hidden"
          >
            <div className="container py-6 space-y-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={location.pathname === item.href ? 'page' : undefined}
                  className={`block py-3 text-lg font-display uppercase tracking-wider ${location.pathname === item.href
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {item.name}
                </Link>
              ))}
              <div className="space-y-2 pt-2">
                <a
                  href={primaryPhone.href}
                  onClick={() => trackPhoneClick('mobile_menu_primary')}
                  className="flex items-center gap-2 py-2 text-lg font-display uppercase tracking-wider text-primary"
                >
                  <Phone className="w-5 h-5" />
                  {primaryPhone.display}
                </a>
                <a
                  href={officePhone.href}
                  onClick={() => trackPhoneClick('mobile_menu_office')}
                  className="flex items-center gap-2 py-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  {officePhone.label}: {officePhone.display}
                </a>
                {/* Мессенджеры в мобильном меню */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-2">
                  <a
                    href="https://max.ru/u/f9LHodD0cOL3V4NXRmtmYF2IZjxHXKlaVXudIXvPuAhApJSxwS2OhFH8Id4"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 42 42" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                      <path fillRule="evenodd" clipRule="evenodd" d="M21.47 41.88c-4.11 0-6.02-.6-9.34-3-2.1 2.7-8.75 4.81-9.04 1.2 0-2.71-.6-5-1.28-7.5C1 29.5.08 26.07.08 21.1.08 9.23 9.82.3 21.36.3c11.55 0 20.6 9.37 20.6 20.91a20.6 20.6 0 0 1-20.49 20.67m.17-31.32c-5.62-.29-10 3.6-10.97 9.7-.8 5.05.62 11.2 1.83 11.52.58.14 2.04-1.04 2.95-1.95a10.4 10.4 0 0 0 5.08 1.81 10.7 10.7 0 0 0 11.19-9.97 10.7 10.7 0 0 0-10.08-11.1Z" />
                    </svg>
                    MAX
                  </a>
                  <a
                    href="https://t.me/rosomaha_site"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => trackTelegramClick('mobile_menu')}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    <MessageCircle className="w-5 h-5" />
                    Telegram
                  </a>
                  <a
                    href="https://vk.com/rosomaha_service"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M15.07 2H8.93C3.33 2 2 3.33 2 8.93v6.14C2 20.67 3.33 22 8.93 22h6.14c5.6 0 6.93-1.33 6.93-6.93V8.93C22 3.33 20.67 2 15.07 2zm3.13 14.01h-1.41c-.48 0-.63-.38-1.48-1.29-.76-.76-1.1-.86-1.29-.86-.26 0-.34.08-.34.47v1.18c0 .32-.1.51-1.01.51-1.49 0-3.14-.9-4.3-2.56-1.76-2.37-2.24-4.15-2.24-4.51 0-.19.08-.37.47-.37h1.41c.35 0 .48.16.62.54.68 1.98 1.83 3.71 2.3 3.71.18 0 .26-.08.26-.54V9.47c-.06-1.1-.64-1.19-.64-1.58 0-.16.13-.31.34-.31h2.2c.29 0 .4.16.4.5v3.01c0 .29.13.4.21.4.18 0 .33-.11.67-.44 1.04-1.17 1.79-2.97 1.79-2.97.1-.21.26-.37.61-.37h1.41c.42 0 .51.21.42.5-.17.8-1.86 3.17-1.86 3.17-.15.24-.21.35 0 .62.15.2.64.62 1 1.01.65.71 1.14 1.31 1.27 1.73.14.41-.07.62-.48.62z" />
                    </svg>
                    ВКонтакте
                  </a>
                </div>
              </div>
              <Link
                to="/order"
                onClick={() => setMobileMenuOpen(false)}
                onMouseDown={() => trackOrderCtaClick('header_mobile')}
                className="btn-primary w-full text-center"
              >
                Получить расчёт
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
