import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Animated party-game custom select dropdown replacing native OS <select> menus.
 * Renders via a portal to prevent clipping inside cards or animated containers.
 */
function CartoonSelect({
  value,
  options = [],
  onChange,
  placeholder = 'Select...',
  style = {},
  triggerStyle = {},
  disabled = false,
  ariaLabel
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 200, openUpward: false, maxHeight: 260 });
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selectedIndex = options.findIndex((opt) => String(opt.value) === String(value));
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const estimatedHeight = Math.min(264, options.length * 44 + 16);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openUpward = spaceBelow < Math.min(estimatedHeight, 190) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(270, openUpward ? spaceAbove : spaceBelow));

    setCoords({
      top: openUpward ? rect.top - 8 : rect.bottom + 8,
      left: rect.left,
      width: Math.max(rect.width, 132),
      openUpward,
      maxHeight
    });
  }, [options.length]);

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);

    const handleOutside = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    const handleReposition = () => updatePosition();

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, selectedIndex, updatePosition]);

  const selectOption = (opt) => {
    if (!opt || disabled) return;
    setIsOpen(false);
    if (onChange) {
      onChange({ target: { value: opt.value } }, opt);
    }
  };

  const handleKeyDown = (e) => {
    if (disabled) return;
    if (e.key === 'Escape') {
      setIsOpen(false);
      return;
    }
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(1, options.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + options.length) % Math.max(1, options.length));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[activeIndex]) {
        selectOption(options[activeIndex]);
      }
    }
  };

  const menuPortal = typeof document !== 'undefined' ? createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          role="listbox"
          className="cartoon-select-menu"
          style={{
            position: 'fixed',
            left: Math.min(coords.left, Math.max(8, window.innerWidth - coords.width - 8)),
            top: coords.openUpward ? 'auto' : coords.top,
            bottom: coords.openUpward ? window.innerHeight - coords.top : 'auto',
            width: coords.width,
            maxHeight: coords.maxHeight,
            transformOrigin: coords.openUpward ? 'bottom center' : 'top center',
            zIndex: 10040
          }}
          initial={{ opacity: 0, y: coords.openUpward ? 10 : -10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: coords.openUpward ? 8 : -8, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }}
        >
          <div className="cartoon-select-list">
            {options.map((opt, idx) => {
              const isSelected = String(opt.value) === String(value);
              const isHighlighted = idx === activeIndex;
              return (
                <motion.button
                  key={`${opt.value}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`cartoon-select-option${isSelected ? ' is-selected' : ''}${isHighlighted ? ' is-focused' : ''}`}
                  onClick={() => selectOption(opt)}
                  onMouseEnter={() => setActiveIndex(idx)}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.14), duration: 0.14 }}
                  whileTap={{ scale: 0.97 }}
                >
                  <span className="cartoon-select-label">{opt.label}</span>
                  {isSelected && <span className="cartoon-select-check">✓</span>}
                </motion.button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  ) : null;

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0, ...style }}>
      <motion.button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={`cartoon-select-trigger${isOpen ? ' is-open' : ''}`}
        style={triggerStyle}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        whileTap={disabled ? undefined : { scale: 0.985 }}
      >
        <span className="cartoon-select-value">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <motion.span
          className="cartoon-select-arrow"
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          aria-hidden="true"
        >
          ▾
        </motion.span>
      </motion.button>
      {menuPortal}
    </div>
  );
}

export default CartoonSelect;
