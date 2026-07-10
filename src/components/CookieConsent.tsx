import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { COOKIE_CONSENT_EVENT, COOKIE_CONSENT_KEY } from '@/lib/consent';
import { initAttribution } from '@/lib/attribution';

export default function CookieConsent() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
        if (!consent) {
            setIsVisible(true);
        }
    }, []);

    const handleAccept = useCallback(() => {
        localStorage.setItem(COOKIE_CONSENT_KEY, 'true');
        initAttribution();
        window.dispatchEvent(new Event(COOKIE_CONSENT_EVENT));
        setIsVisible(false);
    }, []);

    useEffect(() => {
        if (!isVisible) {
            return;
        }

        const handleContinue = (event?: Event) => {
            const panel = document.getElementById('cookie-consent-panel');
            if (event?.target instanceof Node && panel?.contains(event.target)) {
                return;
            }

            handleAccept();
        };

        const handleScroll = () => handleContinue();
        const handlePointer = (event: PointerEvent) => handleContinue(event);
        const handleKey = (event: KeyboardEvent) => handleContinue(event);

        window.addEventListener('scroll', handleScroll, { once: true, passive: true });
        document.addEventListener('pointerdown', handlePointer, true);
        document.addEventListener('keydown', handleKey, true);

        return () => {
            window.removeEventListener('scroll', handleScroll);
            document.removeEventListener('pointerdown', handlePointer, true);
            document.removeEventListener('keydown', handleKey, true);
        };
    }, [handleAccept, isVisible]);

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
                        <div
                            id="cookie-consent-panel"
                            className="bg-card border border-border p-6 md:p-8 rounded-lg shadow-2xl flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden backdrop-blur-md bg-card/95"
                        >
                            <div className="absolute top-0 left-0 w-1 h-full bg-primary" />

                            <div className="flex-1">
                                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                                    Мы используем файлы cookie, чтобы улучшать работу сайта, запоминать ваши предпочтения и показывать релевантную рекламу.
                                    Продолжая пользоваться сайтом или нажимая «Принять», вы соглашаетесь с использованием файлов cookie.
                                    Подробнее — в <Link to="/politika-konfidencialnosti" className="text-primary hover:underline underline-offset-4">Политике конфиденциальности</Link>.
                                </p>
                            </div>

                            <div className="flex w-full flex-shrink-0 items-center gap-4 md:w-auto">
                                <button
                                    onClick={handleAccept}
                                    className="btn-primary flex-1 px-6 py-3 text-sm md:flex-none md:px-8"
                                >
                                    Принять
                                </button>
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
