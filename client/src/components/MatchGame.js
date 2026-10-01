import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function MatchGame({ question, submitAnswer, answered, isFrozen, isReveal }) {
    
    const [matches, setMatches] = useState({}); // { leftIndex: rightIndex }
    const [activeDragTarget, setActiveDragTarget] = useState(null); // leftIndex being dragged
    const [pointerPos, setPointerPos] = useState(null); // {x, y} for dragging line
    const containerRef = useRef(null);
    const leftRefs = useRef([]);
    const rightRefs = useRef([]);
    
    const isComplete = Object.keys(matches).length === (question.pairs?.length || 0);

    // We don't have scrambler logic directly here for rendering order unless passed down,
    // but typically match questions just display pairs in order, or we can shuffle right side.
    // Let's implement a stable scramble for the right side so it's not a straight line.
    const [matchOrder] = useState(() => {
        const order = question.pairs?.map((_, i) => i) || [];
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        return order;
    });

    
    useEffect(() => {
        const handleGlobalPointerMove = (e) => {
            if (activeDragTarget !== null) {
                setPointerPos({ x: e.clientX, y: e.clientY });
            }
        };
        const handleGlobalPointerUp = (e) => {
            if (activeDragTarget === null) return;
            
            const rightBtn = document.elementFromPoint(e.clientX, e.clientY)?.closest('.match-right-btn');
            if (rightBtn) {
                const rightIdx = parseInt(rightBtn.getAttribute('data-index'), 10);
                setMatches(prev => {
                    const newMatches = { ...prev };
                    Object.keys(newMatches).forEach(key => {
                        if (newMatches[key] === rightIdx) delete newMatches[key];
                    });
                    newMatches[activeDragTarget] = rightIdx;
                    return newMatches;
                });
            }
            
            setActiveDragTarget(null);
            setPointerPos(null);
        };

        if (activeDragTarget !== null) {
            window.addEventListener('pointermove', handleGlobalPointerMove);
            window.addEventListener('pointerup', handleGlobalPointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handleGlobalPointerMove);
            window.removeEventListener('pointerup', handleGlobalPointerUp);
        };
    }, [activeDragTarget]);

    const handlePointerDown = (e, leftIdx) => {
        if (answered || isFrozen || isReveal) return;
        e.target.setPointerCapture(e.pointerId);
        setActiveDragTarget(leftIdx);
        setPointerPos({ x: e.clientX, y: e.clientY });
    };

    

    const handleRightClick = (rightIdx) => {
        if (answered || isFrozen || isReveal) return;
        
        if (activeDragTarget !== null) {
            const newMatches = { ...matches };
            Object.keys(newMatches).forEach(key => {
                if (newMatches[key] === rightIdx) delete newMatches[key];
            });
            newMatches[activeDragTarget] = rightIdx;
            setMatches(newMatches);
            setActiveDragTarget(null);
        }
    };

    const lines = [];
    if (containerRef.current) {
        const containerRect = containerRef.current.getBoundingClientRect();
        Object.entries(matches).forEach(([leftIdxStr, rightIdx]) => {
            const leftIdx = parseInt(leftIdxStr, 10);
            const leftEl = leftRefs.current[leftIdx];
            const rightEl = rightRefs.current[rightIdx];
            if (leftEl && rightEl) {
                const lRect = leftEl.getBoundingClientRect();
                const rRect = rightEl.getBoundingClientRect();
                lines.push({
                    leftIdx,
                    rightIdx,
                    x1: lRect.right - containerRect.left - 15,
                    y1: lRect.top + lRect.height / 2 - containerRect.top,
                    x2: rRect.left - containerRect.left + 15,
                    y2: rRect.top + rRect.height / 2 - containerRect.top
                });
            }
        });
    }

    const handleSubmit = () => {
        const payload = Object.entries(matches).map(([left, right]) => ({
            left: parseInt(left, 10),
            right
        }));
        submitAnswer(payload);
    };

    // Calculate active drag line
    let dragLine = null;
    if (activeDragTarget !== null && pointerPos && containerRef.current) {
        const leftEl = leftRefs.current[activeDragTarget];
        if (leftEl) {
            const lRect = leftEl.getBoundingClientRect();
            const containerRect = containerRef.current.getBoundingClientRect();
            dragLine = {
                x1: lRect.right - containerRect.left - 15,
                y1: lRect.top + lRect.height / 2 - containerRect.top,
                x2: pointerPos.x - containerRect.left,
                y2: pointerPos.y - containerRect.top
            };
        }
    }

    return (
        <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
            <h3 style={{ color: 'white', textAlign: 'center', marginBottom: 24 }}>Connect the pairs (Drag or Click)</h3>
            
            <div ref={containerRef} style={{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' }} >
                {/* SVG Overlay for Lines */}
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    {lines.map((l, i) => {
                        const isCorrect = l.leftIdx === l.rightIdx;
                        const colors = ['#fbc531', '#00a8ff', '#9c88ff', '#e84118'];
                        let lineColor = colors[l.leftIdx % colors.length];
                        if (isReveal) lineColor = isCorrect ? '#4cd137' : '#e84118';
                        
                        return (
                        <g key={`line-${l.leftIdx}-${l.rightIdx}`}>
                            {/* Thick black cartoon outline */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke="#1e272e"
                                strokeWidth={13}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}
                            />
                            {/* Bright inner cartoon color */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke={lineColor}
                                strokeWidth={8}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}
                            />
                        </g>
                        );
                    })}
                    {dragLine && (
                        <g>
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#1e272e" strokeWidth={13} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}
                            />
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#ffffff" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}
                            />
                        </g>
                    )}
                </svg>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, zIndex: 2, position: 'relative' }}>
                    {question.pairs?.map((p, i) => (
                        <button 
                            key={`left-${i}`}
                            ref={el => leftRefs.current[i] = el}
                            className={`btn ${matches[i] !== undefined || activeDragTarget === i ? 'btn-primary' : 'btn-secondary'}`}
                            onPointerDown={(e) => handlePointerDown(e, i)}
                            onDragStart={(e) => e.preventDefault()}
                            draggable={false}
                            onClick={() => {
                                if (answered || isFrozen || isReveal) return;
                                setActiveDragTarget(activeDragTarget === i ? null : i); // Toggle click
                            }}
                            
                            style={{ 
                                padding: 16, 
                                fontSize: '1.1rem', 
                                border: '3px solid var(--dark)',
                                
                                cursor: (answered || isFrozen || isReveal) ? 'not-allowed' : 'grab'
                            }}
                        >
                            {p.left}
                        </button>
                    ))}
                </div>
                
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, zIndex: 2, position: 'relative' }}>
                    {matchOrder.map((realIndex) => {
                        const p = question.pairs[realIndex];
                        const isMatched = Object.values(matches).includes(realIndex);
                        return (
                            <button 
                                key={`right-${realIndex}`}
                                ref={el => rightRefs.current[realIndex] = el}
                                className={`btn ${isMatched ? 'btn-primary' : 'btn-secondary'} match-right-btn`}
                                data-index={realIndex}
                                onClick={() => handleRightClick(realIndex)}
                                onDragStart={(e) => e.preventDefault()}
                                draggable={false}
                                
                                style={{ 
                                    padding: 16, 
                                    fontSize: '1.1rem', 
                                    border: '3px solid var(--dark)',
                                    
                                }}
                            >
                                {p.right}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div style={{ marginTop: 32, textAlign: 'center' }}>
                {!isReveal && (
                    <motion.button 
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={!isComplete || answered || isFrozen}
                        style={{ padding: '16px 32px', fontSize: '1.2rem', fontWeight: 'bold' }}
                        whileHover={{ scale: isComplete && !answered && !isFrozen ? 1.05 : 1 }}
                        whileTap={{ scale: isComplete && !answered && !isFrozen ? 0.95 : 1 }}
                    >
                        {answered ? 'Answer Submitted' : 'Submit Matches'}
                    </motion.button>
                )}
                {isReveal && (
                    <div style={{ color: 'white', fontSize: '1.2rem', fontWeight: 'bold' }}>
                        Correct matches are highlighted in green.
                    </div>
                )}
            </div>
        </div>
    );
}
