import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';

export default function MatchGame({ question, submitAnswer, answered, isFrozen, isReveal, isPaused, isScrambled, oraclePair, scrambleTrigger, onMatchesChange }) {
    
    const [matches, setMatches] = useState({}); // { leftIndex: rightIndex }
    const matchesRef = useRef(matches);
    useEffect(() => {
        matchesRef.current = matches;
    }, [matches]);

    const [activeDragTarget, setActiveDragTarget] = useState(null); // leftIndex being dragged
    const [pointerPos, setPointerPos] = useState(null); // {x, y} for dragging line
    const [peekedRightIdx, setPeekedRightIdx] = useState(null); // Shell game: single peeked card index
    const containerRef = useRef(null);
    const leftRefs = useRef([]);
    const rightRefs = useRef([]);
    
    const [lockedLefts, setLockedLefts] = useState(new Set());
    const isComplete = Object.keys(matches).length === (question.pairs?.length || 0);

    useEffect(() => {
        setMatches({});
        setLockedLefts(new Set());
        setPeekedRightIdx(null);
    }, [question?.text, question?.pairs]);

    const [matchOrder, setMatchOrder] = useState(() => {
        const order = question.pairs?.map((_, i) => i) || [];
        for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        return order;
    });

    useEffect(() => {
        if (onMatchesChange) onMatchesChange(matches);
    }, [matches, onMatchesChange]);

    useEffect(() => {
        if (!oraclePair) return;
        const { left, right } = oraclePair;
        setMatches(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(k => {
                if (Number(k) === left || next[k] === right) delete next[k];
            });
            next[left] = right;
            return next;
        });
        setLockedLefts(prev => new Set([...prev, left]));
    }, [oraclePair]);

    // Shell Game: Shuffle unmatched right items & cancel active drag line
    useEffect(() => {
        if (!scrambleTrigger) return;
        setActiveDragTarget(null);
        setPointerPos(null);
        setPeekedRightIdx(null);

        setMatchOrder(prev => {
            const currentMatches = matchesRef.current || {};
            const matchedVals = new Set(Object.values(currentMatches));
            const unmatchedPos = [];
            prev.forEach((val, pos) => {
                if (!matchedVals.has(val)) unmatchedPos.push(pos);
            });
            // If fewer than 2 unmatched cards remain, skip shuffle cleanly
            if (unmatchedPos.length < 2) return prev;

            const newOrder = [...prev];
            const valsToShuffle = unmatchedPos.map(pos => newOrder[pos]);

            // Guaranteed derangement: every unmatched item must shift to a different slot
            let shuffled = [...valsToShuffle];
            let attempts = 0;
            while (attempts < 20) {
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                if (shuffled.every((val, idx) => val !== valsToShuffle[idx])) break;
                attempts++;
            }
            if (!shuffled.every((val, idx) => val !== valsToShuffle[idx])) {
                shuffled = [...valsToShuffle.slice(1), valsToShuffle[0]];
            }

            unmatchedPos.forEach((pos, idx) => {
                newOrder[pos] = shuffled[idx];
            });
            return newOrder;
        });
    }, [scrambleTrigger]);

    // Auto-clear peeked card on pause, un-scramble, answered, frozen, or reveal
    useEffect(() => {
        if (!isScrambled || answered || isFrozen || isPaused || isReveal) {
            setPeekedRightIdx(null);
        }
        if (isPaused) {
            setActiveDragTarget(null);
            setPointerPos(null);
        }
    }, [isScrambled, answered, isFrozen, isPaused, isReveal]);

    useEffect(() => {
        const handleGlobalPointerMove = (e) => {
            if (activeDragTarget !== null) {
                setPointerPos({ x: e.clientX, y: e.clientY });

                // Cross-device hit-test card under pointer during active drag
                const rightCardEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-right-idx]');
                if (rightCardEl) {
                    const hoveredIdx = parseInt(rightCardEl.getAttribute('data-right-idx'), 10);
                    const isMatched = Object.values(matchesRef.current || {}).includes(hoveredIdx);
                    if (isScrambled && !isReveal && !isMatched) {
                        setPeekedRightIdx(hoveredIdx);
                    } else {
                        setPeekedRightIdx(null);
                    }
                } else if (isScrambled) {
                    setPeekedRightIdx(null);
                }
            }
        };

        const handleGlobalPointerUp = (e) => {
            if (activeDragTarget === null) return;
            
            const rightBtn = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-right-idx]');
            if (rightBtn) {
                const rightIdx = parseInt(rightBtn.getAttribute('data-right-idx'), 10);
                const isMatched = Object.values(matchesRef.current || {}).includes(rightIdx);
                if (!isMatched) {
                    setMatches(prev => {
                        const newMatches = { ...prev };
                        Object.keys(newMatches).forEach(key => {
                            if (newMatches[key] === rightIdx) delete newMatches[key];
                        });
                        newMatches[activeDragTarget] = rightIdx;
                        return newMatches;
                    });
                }
            }
            
            setActiveDragTarget(null);
            setPointerPos(null);
            setPeekedRightIdx(null);
        };

        if (activeDragTarget !== null) {
            window.addEventListener('pointermove', handleGlobalPointerMove);
            window.addEventListener('pointerup', handleGlobalPointerUp);
        }
        return () => {
            window.removeEventListener('pointermove', handleGlobalPointerMove);
            window.removeEventListener('pointerup', handleGlobalPointerUp);
        };
    }, [activeDragTarget, isScrambled, isReveal]);

    const handlePointerDown = (e, leftIdx) => {
        if (answered || isFrozen || isReveal || isPaused || lockedLefts.has(leftIdx)) return;
        e.target.setPointerCapture(e.pointerId);
        setActiveDragTarget(leftIdx);
        setPointerPos({ x: e.clientX, y: e.clientY });
    };

    const handleRightClick = (rightIdx) => {
        if (answered || isFrozen || isReveal || isPaused) return;

        const isMatched = Object.values(matches).includes(rightIdx);
        if (isMatched) return;

        // In Scramble fog, first tap peeks the card if not already peeked (does NOT connect yet)
        if (isScrambled && !isReveal && peekedRightIdx !== rightIdx) {
            setPeekedRightIdx(rightIdx);
            return;
        }

        // Second tap on already-peeked card (or when not scrambled), connect if left card is active
        if (activeDragTarget !== null) {
            const newMatches = { ...matches };
            Object.keys(newMatches).forEach(key => {
                if (newMatches[key] === rightIdx) delete newMatches[key];
            });
            newMatches[activeDragTarget] = rightIdx;
            setMatches(newMatches);
            setActiveDragTarget(null);
            setPeekedRightIdx(null);
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
        <div style={{ padding: 16, background: 'rgba(42,33,66,0.45)', borderRadius: 12 }}>
            <h3 style={{ color: 'white', textAlign: 'center', marginBottom: 16 }}>Connect the pairs (Drag or Click)</h3>
            {isScrambled && !isReveal && (
                <div style={{ 
                    marginBottom: 16, 
                    padding: '10px 18px', 
                    background: 'rgba(237, 116, 63, 0.25)', 
                    border: '2px solid var(--orange)', 
                    borderRadius: 12, 
                    color: '#FFC173', 
                    fontSize: '1.05rem', 
                    fontWeight: 'bold',
                    textAlign: 'center'
                }}>
                    🌀 Scramble Storm! Right cards hidden — tap or drag over cards to peek!
                </div>
            )}
            
            <div ref={containerRef} style={{ display: 'flex', gap: 60, justifyContent: 'center', position: 'relative', touchAction: 'none' }} >
                {/* SVG Overlay for Lines */}
                <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                    {lines.map((l, i) => {
                        const isCorrect = l.leftIdx === l.rightIdx;
                        const colors = ['#FFAF50', '#ED743F', '#824C97', '#2BA89A'];
                        let lineColor = colors[l.leftIdx % colors.length];
                        if (lockedLefts.has(l.leftIdx)) lineColor = '#FFAF50';
                        if (isReveal) lineColor = isCorrect ? '#3DBE8B' : '#E5484D';
                        
                        return (
                        <g key={`line-${l.leftIdx}-${l.rightIdx}`}>
                            {/* Thick black cartoon outline */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke="#2A2142" strokeWidth={13}
                                strokeLinecap="round"
                                initial={{ pathLength: 0 }}
                                animate={{ pathLength: 1 }}
                                transition={{ duration: 0.5, type: 'spring', bounce: 0.5 }}
                            />
                            {/* Bright inner cartoon color */}
                            <motion.line 
                                x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                stroke={lineColor} strokeWidth={8}
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
                                stroke="#2A2142" strokeWidth={13} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}
                            />
                            <line 
                                x1={dragLine.x1} y1={dragLine.y1} x2={dragLine.x2} y2={dragLine.y2}
                                stroke="#FFF6EC" strokeWidth={8} strokeLinecap="round" strokeDasharray="16 16" style={{ transition: "none" }}
                            />
                        </g>
                    )}
                </svg>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, zIndex: 2, position: 'relative' }}>
                    {question.pairs?.map((p, i) => (
                        <button 
                            key={`left-${i}`}
                            ref={el => leftRefs.current[i] = el}
                            className="btn"
                            onPointerDown={(e) => handlePointerDown(e, i)}
                            onDragStart={(e) => e.preventDefault()}
                            draggable={false}
                            onClick={() => {
                                if (answered || isFrozen || isReveal || isPaused || lockedLefts.has(i)) return;
                                setActiveDragTarget(activeDragTarget === i ? null : i); // Toggle click
                            }}
                            style={{ 
                                padding: 16, 
                                fontSize: '1.1rem', 
                                background: matches[i] !== undefined || activeDragTarget === i ? '#423465' : 'linear-gradient(180deg, #9560AB 0%, var(--plum) 100%)',
                                color: 'white',
                                border: '3px solid var(--indigo-deep)',
                                boxShadow: '0 4px 0 var(--indigo-deep)',
                                borderRadius: '12px',
                                cursor: (answered || isFrozen || isReveal || isPaused || lockedLefts.has(i)) ? 'not-allowed' : 'grab',
                                transition: 'all 0.2s ease'
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
                        const isFogged = isScrambled && !isReveal && !isMatched && peekedRightIdx !== realIndex;
                        const isPeeked = isScrambled && !isReveal && !isMatched && peekedRightIdx === realIndex;

                        let cardText = p.right;
                        let cardBg = isMatched ? '#423465' : 'linear-gradient(180deg, #9560AB 0%, var(--plum) 100%)';
                        let cardBorder = '3px solid var(--indigo-deep)';
                        let cardShadow = '0 4px 0 var(--indigo-deep)';

                        if (isFogged) {
                            cardText = '???';
                            cardBg = 'linear-gradient(180deg, #3B2A59 0%, #241A38 100%)';
                            cardBorder = '3px dashed #6D5499';
                        } else if (isPeeked) {
                            cardBorder = '3px solid #FFAF50';
                            cardShadow = '0 0 14px rgba(255, 175, 80, 0.6), 0 4px 0 #D48016';
                        }

                        return (
                            <motion.button 
                                key={`right-${realIndex}`}
                                layout
                                ref={el => rightRefs.current[realIndex] = el}
                                className="btn match-right-btn"
                                data-index={realIndex}
                                data-right-idx={realIndex}
                                onClick={() => handleRightClick(realIndex)}
                                onDragStart={(e) => e.preventDefault()}
                                draggable={false}
                                transition={{ layout: { type: 'spring', damping: 22, stiffness: 280 } }}
                                style={{ 
                                    padding: 16, 
                                    fontSize: '1.1rem', 
                                    background: cardBg,
                                    color: isFogged ? '#B8A4D9' : 'white',
                                    letterSpacing: isFogged ? '3px' : 'normal',
                                    border: cardBorder,
                                    boxShadow: cardShadow,
                                    borderRadius: '12px',
                                    cursor: (answered || isFrozen || isReveal || isPaused || isMatched) ? 'default' : 'pointer',
                                    transition: 'background 0.2s ease, border 0.2s ease, box-shadow 0.2s ease'
                                }}
                            >
                                {cardText}
                            </motion.button>
                        );
                    })}
                </div>
            </div>

            <div style={{ marginTop: 32, textAlign: 'center' }}>
                {!isReveal && (
                    <motion.button 
                        className="btn btn-primary"
                        onClick={handleSubmit}
                        disabled={Object.keys(matches).length === 0 || answered || isFrozen || isPaused}
                        style={{ padding: '16px 32px', fontSize: '1.2rem', fontWeight: 'bold' }}
                        whileHover={{ scale: Object.keys(matches).length > 0 && !answered && !isFrozen && !isPaused ? 1.05 : 1 }}
                        whileTap={{ scale: Object.keys(matches).length > 0 && !answered && !isFrozen && !isPaused ? 0.95 : 1 }}
                    >
                        {answered 
                            ? 'Answer Submitted' 
                            : Object.keys(matches).length === (question.pairs?.length || 0)
                              ? 'Submit All Matches'
                              : `Submit Matches (${Object.keys(matches).length}/${question.pairs?.length || 0})`}
                    </motion.button>
                )}
                {isReveal && (
                    <div style={{ color: 'white', fontSize: '1.2rem', fontWeight: 'bold' }}>
                        Correct matches will have green lines.
                    </div>
                )}
            </div>
        </div>
    );
}
