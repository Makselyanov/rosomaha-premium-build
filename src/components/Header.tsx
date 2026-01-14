import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ShoppingCart, Phone, MessageCircle, Youtube } from 'lucide-react';
import { useCartStore } from '@/store/cartStore';
import logoImage from '@/assets/logo-rosomaha.png';

const navigation = [
  { name: 'О компании', href: '/company' },
  { name: 'Каталог', href: '/catalog' },
  { name: 'Статьи', href: '/articles' },
  { name: 'Доставка и оплата', href: '/delivery' },
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
      <nav className="container flex items-center justify-between h-20">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3">
          <img src={logoImage} alt="Росомаха" className="h-10 w-auto" />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center gap-8">
          {navigation.map((item) => (
            <Link
              key={item.name}
              to={item.href}
              className={`nav-link ${location.pathname === item.href ? 'active text-foreground' : ''}`}
            >
              {item.name}
            </Link>
          ))}
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* Phone */}
          <a
            href="tel:+73452564164"
            className="hidden md:flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
          >
            <Phone className="w-4 h-4" />
            <span>+7 (3452) 564-164</span>
          </a>

          {/* Social Links */}
          <div className="hidden md:flex items-center gap-2">
            <a
              href="https://t.me/rosomaha_site"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
              aria-label="Telegram"
              title="Telegram"
            >
              <MessageCircle className="w-5 h-5" />
            </a>
            <a
              href="https://vk.com/rosomaha_service"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
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
              className="p-2 hover:bg-secondary hover:text-primary rounded-lg transition-colors"
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
            className="hidden sm:inline-flex btn-primary text-sm py-3 px-6"
          >
            Заказать
          </Link>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 hover:bg-secondary rounded-lg transition-colors"
            aria-label="Меню"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="lg:hidden bg-background border-t border-border"
          >
            <div className="container py-6 space-y-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block py-3 text-lg font-display uppercase tracking-wider ${location.pathname === item.href
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                    }`}
                >
                  {item.name}
                </Link>
              ))}
              <a
                href="tel:+73452564164"
                className="flex items-center gap-2 py-3 text-lg font-display uppercase tracking-wider text-primary"
              >
                <Phone className="w-5 h-5" />
                +7 (3452) 564-164
              </a>
              <Link
                to="/order"
                onClick={() => setMobileMenuOpen(false)}
                className="btn-primary w-full text-center"
              >
                Подать заявку
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
