import { useState, useRef, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

interface MagneticButtonProps {
    to: string;
    children: React.ReactNode;
    className?: string;
}

export default function MagneticButton({ to, children, className = '' }: MagneticButtonProps) {
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const buttonRef = useRef<HTMLAnchorElement>(null);

    const handleMouseMove = (e: MouseEvent<HTMLAnchorElement>) => {
        if (!buttonRef.current) return;

        const rect = buttonRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Вычисляем расстояние от центра кнопки
        const deltaX = e.clientX - centerX;
        const deltaY = e.clientY - centerY;

        // Ограничиваем магнитный эффект (максимум 15px в каждую сторону)
        const maxDistance = 15;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const factor = Math.min(distance / 100, 1);

        setPosition({
            x: (deltaX / distance) * maxDistance * factor || 0,
            y: (deltaY / distance) * maxDistance * factor || 0,
        });
    };

    const handleMouseLeave = () => {
        setPosition({ x: 0, y: 0 });
    };

    return (
        <Link
            ref={buttonRef}
            to={to}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className={`relative inline-block ${className}`}
        >
            <motion.span
                animate={{ x: position.x, y: position.y }}
                transition={{ type: 'spring', stiffness: 150, damping: 15, mass: 0.1 }}
                className="btn-primary magnetic-button inline-flex items-center"
            >
                {children}
            </motion.span>
        </Link>
    );
}
