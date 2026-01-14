import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function CookieConsent() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const consent = localStorage.getItem('cookie-consent');
        if (!consent) {
            const timer = setTimeout(() => setIsVisible(true), 2000);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem('cookie-consent', 'true');
        setIsVisible(false);
    };

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6"
                >
                    <div className="container max-w-6xl mx-auto">
                        <div className="bg-card border border-border p-6 md:p-8 rounded-lg shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden backdrop-blur-md bg-card/95">
                            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />

                            <div className="flex-1">
                                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                                    Мы используем файлы cookie, чтобы улучшать работу сайта, запоминать ваши предпочтения и показывать релевантную рекламу.
                                    Продолжая пользоваться сайтом или нажимая «Принять», вы соглашаетесь с использованием файлов cookie.
                                    Подробнее — в <Link to="/politika-konfidencialnosti" className="text-primary hover:underline underline-offset-4">Политике конфиденциальности</Link>.
                                </p>
                            </div>

                            <div className="flex items-center gap-4 flex-shrink-0">
                                <button
                                    onClick={handleAccept}
                                    className="btn-primary py-3 px-8 text-sm whitespace-nowrap"
                                >
                                    Принять
                                </button>
                                <button
                                    onClick={() => setIsVisible(false)}
                                    className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                                    aria-label="Закрыть"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
