import { useState, useRef, MouseEvent } from 'react';
import { motion, useInView } from 'framer-motion';

interface ProductShowcaseProps {
    image: string;
    alt: string;
    badges?: { label: string; value: string }[];
}

export default function ProductShowcase({ image, alt, badges = [] }: ProductShowcaseProps) {
    const [rotateX, setRotateX] = useState(0);
    const [rotateY, setRotateY] = useState(0);
    const cardRef = useRef<HTMLDivElement>(null);
    const isInView = useInView(cardRef, { once: true, amount: 0.3 });

    const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
        if (!cardRef.current) return;

        const rect = cardRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const deltaX = e.clientX - centerX;
        const deltaY = e.clientY - centerY;

        // Вычисляем углы поворота (максимум ±12 градусов)
        const maxRotation = 12;
        const rotX = -(deltaY / rect.height) * maxRotation;
        const rotY = (deltaX / rect.width) * maxRotation;

        setRotateX(rotX);
        setRotateY(rotY);
    };

    const handleMouseLeave = () => {
        setRotateX(0);
        setRotateY(0);
    };

    const defaultBadges = badges.length > 0 ? badges : [
        { label: 'Мощность', value: 'до 100 л.с.' },
        { label: 'Грузоподъемность', value: 'до 800 кг' },
        { label: 'Проходимость', value: '100%' },
    ];

    return (
        <div
            ref={cardRef}
            className="relative perspective-1000"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <motion.div
                animate={{
                    rotateX: rotateX,
                    rotateY: rotateY,
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ transformStyle: 'preserve-3d' }}
                className="relative bg-gradient-to-br from-card via-card to-secondary/20 rounded-2xl overflow-hidden border-2 border-border/50 hover:border-primary/30 transition-colors duration-500 shadow-2xl product-showcase-card"
            >
                {/* Light Sweep Effect */}
                <div className="absolute inset-0 light-sweep pointer-events-none" />

                {/* Image Container */}
                <div className="relative aspect-[4/3] overflow-hidden">
                    <motion.img
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={isInView ? { opacity: 1, scale: 1 } : {}}
                        transition={{ duration: 0.8, delay: 0.2 }}
                        src={image}
                        alt={alt}
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
                </div>

                {/* Badges */}
                <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
                    {defaultBadges.map((badge, index) => (
                        <motion.div
                            key={badge.label}
                            initial={{ opacity: 0, x: -20 }}
                            animate={isInView ? { opacity: 1, x: 0 } : {}}
                            transition={{ delay: 0.4 + index * 0.1, duration: 0.5 }}
                            className="backdrop-blur-md bg-primary/10 border border-primary/30 rounded-lg px-3 py-2 flex items-center gap-2"
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-slow" />
                            <span className="text-xs font-medium">
                                <span className="text-muted-foreground">{badge.label}:</span>{' '}
                                <span className="text-foreground">{badge.value}</span>
                            </span>
                        </motion.div>
                    ))}
                </div>

                {/* Glow effect */}
                <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10" />
            </motion.div>
        </div>
    );
}
