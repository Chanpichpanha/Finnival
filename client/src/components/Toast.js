import React from 'react';
import { motion } from 'framer-motion';

function Toast({ message, tone }) {
  return (
    <motion.div
      className={`toast toast-${tone || 'join'}`}
      initial={{ opacity: 0, y: -30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
    >
      {message}
    </motion.div>
  );
}

export default Toast;
