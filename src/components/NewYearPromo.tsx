import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function NewYearPromo() {
    const [isVisible, setIsVisible] = useState(false);
    const [promoConfig, setPromoConfig] = useState<{
        image: string;
        alt: string;
        key: string;
        showLights: boolean;
    } | null>(null);

    useEffect(() => {
        const now = new Date();

        // Новогодняя акция: 15 декабря - 15 января
        const nyStart = new Date(2025, 11, 15);
        const nyEnd = new Date(2026, 0, 15, 23, 59, 59);

        // Акция по доставке: 16 января - 15 февраля
        const deliveryStart = new Date(2026, 0, 16);
        const deliveryEnd = new Date(2026, 1, 15, 23, 59, 59);

        let config = null;

        if (now >= nyStart && now <= nyEnd) {
            config = {
                image: '/promo-ny.jpg',
                alt: 'Новогодняя акция',
                key: 'ny-promo-2026-dismissed',
                showLights: true
            };
        } else if (now >= deliveryStart && now <= deliveryEnd) {
            config = {
                image: '/promo-delivery.jpg',
                alt: 'Акция: Бесплатная доставка',
                key: 'delivery-promo-2026-dismissed',
                showLights: false
            };
        }

        if (!config) {
            return;
        }

        setPromoConfig(config);

        // Проверяем localStorage для конкретной акции
        const dismissed = localStorage.getItem(config.key);
        if (!dismissed) {
            const timer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleClose = () => {
        if (promoConfig) {
            localStorage.setItem(promoConfig.key, 'true');
        }
        setIsVisible(false);
    };

    if (!promoConfig) return null;

    return (
        <AnimatePresence>
            {isVisible && (
                <>
                    {/* Затемнение фона */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[999]"
                        onClick={handleClose}
                    />

                    {/* Попап с анимацией диагонального появления */}
                    <motion.div
                        initial={{ x: -300, y: -300, opacity: 0, scale: 0.8 }}
                        animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
                        exit={{ x: -300, y: -300, opacity: 0, scale: 0.8 }}
                        transition={{
                            type: 'spring',
                            damping: 20,
                            stiffness: 100,
                            duration: 0.6
                        }}
                        className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 lg:-translate-y-[calc(50%+40px)] z-[1000] max-w-[92vw] md:max-w-lg"
                    >
                        <div className="relative bg-card border-2 border-primary rounded-xl shadow-2xl overflow-hidden">
                            {/* Крестик закрытия */}
                            <button
                                onClick={handleClose}
                                className="absolute top-3 right-3 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-full transition-colors backdrop-blur-sm"
                                aria-label="Закрыть"
                            >
                                <X className="w-5 h-5 text-white" />
                            </button>

                            {/* Контейнер для картинки */}
                            <div className="relative">
                                <img
                                    src={promoConfig.image}
                                    alt={promoConfig.alt}
                                    className="w-full h-auto max-h-[90vh] object-contain"
                                />

                                {promoConfig.showLights && (
                                    <div className="absolute inset-0 pointer-events-none">
                                        {[...Array(8)].map((_, i) => (
                                            <motion.div
                                                key={i}
                                                className="absolute w-2 h-2 rounded-full bg-yellow-400"
                                                style={{
                                                    left: `${15 + i * 12}%`,
                                                    top: `${10 + (i % 3) * 25}%`,
                                                    boxShadow: '0 0 10px rgba(250, 204, 21, 0.8)',
                                                }}
                                                animate={{
                                                    opacity: [0.3, 1, 0.3],
                                                    scale: [0.8, 1.2, 0.8],
                                                }}
                                                transition={{
                                                    duration: 1.5 + (i * 0.2),
                                                    repeat: Infinity,
                                                    ease: 'easeInOut',
                                                    delay: i * 0.15,
                                                }}
                                            />
                                        ))}

                                        {[...Array(6)].map((_, i) => (
                                            <motion.div
                                                key={`blink-${i}`}
                                                className="absolute w-1 h-1 rounded-full bg-orange-300"
                                                style={{
                                                    right: `${10 + i * 15}%`,
                                                    bottom: `${20 + (i % 2) * 30}%`,
                                                    boxShadow: '0 0 8px rgba(253, 186, 116, 0.7)',
                                                }}
                                                animate={{
                                                    opacity: [0.2, 0.9, 0.2],
                                                    scale: [1, 1.5, 1],
                                                }}
                                                transition={{
                                                    duration: 2 + (i * 0.3),
                                                    repeat: Infinity,
                                                    ease: 'easeInOut',
                                                    delay: i * 0.25,
                                                }}
                                            />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
