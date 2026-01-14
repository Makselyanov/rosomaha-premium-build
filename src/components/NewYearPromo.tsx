import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export default function NewYearPromo() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // Проверяем текущую дату (до 15 января 2026)
        const now = new Date();
        const endDate = new Date(2026, 0, 15); // 0 = январь

        if (now > endDate) {
            return; // Не показываем после 15 января
        }

        // Проверяем localStorage
        const dismissed = localStorage.getItem('ny-promo-2026-dismissed');
        if (!dismissed) {
            const timer = setTimeout(() => setIsVisible(true), 1500);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleClose = () => {
        localStorage.setItem('ny-promo-2026-dismissed', 'true');
        setIsVisible(false);
    };

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
                        className="fixed left-4 md:left-8 top-1/2 -translate-y-1/2 z-[1000] max-w-[92vw] md:max-w-lg"
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

                            {/* Контейнер для картинки и огоньков */}
                            <div className="relative">
                                <img
                                    src="/promo-ny.jpg"
                                    alt="Новогодняя акция"
                                    className="w-full h-auto max-h-[90vh] object-contain"
                                />

                                {/* Горящие огоньки - CSS анимация */}
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

                                    {/* Дополнительные мерцающие блики */}
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
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
