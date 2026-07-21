'use client';

import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from 'motion/react';
import { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react';

import './Dock.css';

function DockItem({ children, className = '', onClick, hoveredIndex, index, spring, magnification, baseItemSize, label }) {
    const ref = useRef(null);
    const isHovered = useMotionValue(0);
    const targetSize = useMotionValue(baseItemSize);

    useEffect(() => {
        if (hoveredIndex !== null) {
            const indexDistance = Math.abs(index - hoveredIndex);
            if (indexDistance < 2) {
                // Linear decay of size within 2 items distance
                targetSize.set(baseItemSize + (magnification - baseItemSize) * (1 - indexDistance / 2));
            } else {
                targetSize.set(baseItemSize);
            }
        } else {
            targetSize.set(baseItemSize);
        }
    }, [hoveredIndex, index, baseItemSize, magnification, targetSize]);

    const size = useSpring(targetSize, spring);

    const handleKeyDown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.();
        }
    };

    return (
        <motion.div
            ref={ref}
            style={{
                width: size,
                height: size
            }}
            onHoverStart={() => isHovered.set(1)}
            onHoverEnd={() => isHovered.set(0)}
            onFocus={() => isHovered.set(1)}
            onBlur={() => isHovered.set(0)}
            onClick={onClick}
            className={`dock-item ${className}`}
            tabIndex={0}
            role="button"
            aria-haspopup="true"
            aria-label={label}
            onKeyDown={handleKeyDown}
        >
            {Children.map(children, child => cloneElement(child, { isHovered }))}
        </motion.div>
    );
}

function DockLabel({ children, className = '', ...rest }) {
    const { isHovered } = rest;
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const unsubscribe = isHovered.on('change', latest => {
            setIsVisible(latest === 1);
        });
        return () => unsubscribe();
    }, [isHovered]);

    return (
        <AnimatePresence>
            {isVisible && (
                <motion.div
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: 1, y: 10 }}
                    exit={{ opacity: 0, y: 0 }}
                    transition={{ duration: 0.2 }}
                    className={`dock-label ${className}`}
                    role="tooltip"
                    style={{ x: '-50%' }}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

function DockIcon({ children, className = '' }) {
    return <div className={`dock-icon ${className}`}>{children}</div>;
}

export default function Dock({
    items,
    className = '',
    spring = { mass: 0.1, stiffness: 150, damping: 12 },
    magnification = 70,
    panelHeight = 68,
    dockHeight = 256,
    baseItemSize = 50
}) {
    const [hoveredIndex, setHoveredIndex] = useState(null);
    const panelRef = useRef(null);
    const isHovered = useMotionValue(0);

    const maxHeight = useMemo(
        () => Math.max(dockHeight, magnification + magnification / 2 + 4),
        [magnification, dockHeight]
    );
    const heightRow = useTransform(isHovered, [0, 1], [panelHeight, maxHeight]);
    const height = useSpring(heightRow, spring);

    const handleMouseMove = (e) => {
        isHovered.set(1);
        if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect();
            const relativeX = e.clientX - rect.left;
            // Calculate a smooth fractional index based on relative mouse position inside the panel
            const index = (relativeX / rect.width) * items.length - 0.5;
            setHoveredIndex(index);
        }
    };

    const handleMouseLeave = () => {
        isHovered.set(0);
        setHoveredIndex(null);
    };

    return (
        <motion.div style={{ height, scrollbarWidth: 'none' }} className="dock-outer">
            <motion.div
                ref={panelRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className={`dock-panel ${className}`}
                style={{ height: panelHeight }}
                role="toolbar"
                aria-label="Application dock"
            >
                {items.map((item, index) => (
                    <DockItem
                        key={index}
                        index={index}
                        hoveredIndex={hoveredIndex}
                        onClick={item.onClick}
                        className={item.className}
                        spring={spring}
                        magnification={magnification}
                        baseItemSize={baseItemSize}
                        label={item.label}
                    >
                        <DockIcon>{item.icon}</DockIcon>
                        <DockLabel>{item.label}</DockLabel>
                    </DockItem>
                ))}
            </motion.div>
        </motion.div>
    );
}
