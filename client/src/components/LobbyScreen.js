import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  playChatPop,
  playEmojiSound,
  isMuted,
  isMusicMuted,
  toggleMusicMute,
  startLobbyMusic,
  stopLobbyMusic
} from '../utils/sound';
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion';
import { resolveImageUrl, compressImage, preloadImages } from '../utils/imageUrl';
import { downloadJsonPack, parseImportedPack } from '../utils/questionPack';
import { useAppAuth } from '../auth/AuthContext';
import CartoonSelect from './CartoonSelect';

const serverUrl = process.env.REACT_APP_SERVER_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

const EMPTY_QUESTION = {
  type: 'classic',
  text: '',
  options: ['', '', '', ''],
  correctAnswer: 0,
  correctAnswerText: '',
  min: 0,
  max: 100,
  correctNumber: 50,
  pairs: [{ left: '', right: '' }, { left: '', right: '' }],
  timeLimit: 20,
  imageUrl: ''
};

const TYPE_META = {
  classic: { label: '🟦 Choice', full: 'Multiple Choice' },
  short_answer: { label: '✍️ Short Answer', full: 'Short Answer' },
  slider: { label: '🌡️ Slider', full: 'Number Slider' },
  match: { label: '🔗 Match Pairs', full: 'Match Pairs' }
};

const TIME_PRESETS = [
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 20, label: '20 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 60, label: '60 seconds' }
];
const TIME_PRESET_VALUES = TIME_PRESETS.map((t) => t.value);

function resolveCustomSeconds(rawVal, unit, fallback = 20) {
  const num = Number(rawVal);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const seconds = unit === 'min' ? Math.round(num * 60) : Math.round(num);
  return Math.max(5, seconds);
}

function formatTimeBadge(sec) {
  const total = Math.max(5, Math.round(Number(sec)) || 20);
  if (total <= 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

/**
 * Smoothly animates container height when inner content changes (tabs, drawers, dynamic fields)
 * without distorting borders/text, while giving child shadows breathing room to prevent clipping.
 */
function SmoothHeight({ children, style = {} }) {
  const innerRef = useRef(null);
  const [height, setHeight] = useState(undefined);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.scrollHeight);
    measure();
    const raf = requestAnimationFrame(() => { readyRef.current = true; });
    if (typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(raf);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <motion.div
      animate={height !== undefined ? { height } : undefined}
      transition={readyRef.current ? { type: 'spring', stiffness: 320, damping: 30, mass: 0.85 } : { duration: 0 }}
      style={{ overflow: 'hidden', margin: '-6px -8px -10px', ...style }}
    >
      <div ref={innerRef} style={{ padding: '6px 8px 10px' }}>
        {children}
      </div>
    </motion.div>
  );
}

function useCustomTimePicker(value, onChange) {
  const initialSec = Math.max(5, Math.round(Number(value)) || 20);
  const initialIsPreset = TIME_PRESET_VALUES.includes(initialSec);
  const initialUseMin = initialSec > 60 && initialSec % 60 === 0;

  const [isCustom, setIsCustom] = useState(!initialIsPreset);
  const [unit, setUnit] = useState(initialUseMin ? 'min' : 'sec');
  const [inputVal, setInputVal] = useState(
    initialUseMin ? String(initialSec / 60) : String(initialSec)
  );

  const handleSelectChange = (e) => {
    if (e.target.value === 'custom') {
      const curSec = Math.max(5, Math.round(Number(value)) || 20);
      const useMin = curSec > 60 && curSec % 60 === 0;
      setIsCustom(true);
      setUnit(useMin ? 'min' : 'sec');
      setInputVal(useMin ? String(curSec / 60) : String(curSec));
    } else {
      setIsCustom(false);
      onChange(Number(e.target.value));
    }
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    setInputVal(raw);
    if (raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) > 0) {
      onChange(resolveCustomSeconds(raw, unit, value));
    }
  };

  const handleBlur = () => {
    const clampedSec = resolveCustomSeconds(inputVal, unit, 20);
    setInputVal(unit === 'min' ? String(Math.max(1, Math.round(clampedSec / 60))) : String(clampedSec));
    onChange(clampedSec);
  };

  const handleUnitChange = (e) => {
    const nextUnit = e.target.value;
    const currentSec = resolveCustomSeconds(inputVal, unit, value);
    setUnit(nextUnit);
    if (nextUnit === 'min') {
      const mins = Math.max(1, Math.round(currentSec / 60));
      setInputVal(String(mins));
      onChange(mins * 60);
    } else {
      setInputVal(String(currentSec));
      onChange(currentSec);
    }
  };

  return {
    isCustom,
    unit,
    inputVal,
    handleSelectChange,
    handleInputChange,
    handleBlur,
    handleUnitChange
  };
}

const TIME_PRESET_OPTIONS = [
  ...TIME_PRESETS,
  { value: 'custom', label: '⏱️ Custom...' }
];

const DURATION_UNIT_OPTIONS = [
  { value: 'sec', label: 'seconds' },
  { value: 'min', label: 'minutes' }
];

function TimePresetSelect({ value, isCustom, onChange }) {
  return (
    <CartoonSelect
      value={isCustom ? 'custom' : (TIME_PRESET_VALUES.includes(Number(value)) ? Number(value) : 'custom')}
      options={TIME_PRESET_OPTIONS}
      onChange={onChange}
      ariaLabel="Time preset"
    />
  );
}

function CustomDurationRow({ picker, onKeyDown }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 10, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28 }}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 124px', gap: 8, flex: '1 1 210px', minWidth: 0 }}
    >
      <input
        type="number"
        min={picker.unit === 'min' ? '1' : '5'}
        className="input"
        placeholder={picker.unit === 'min' ? 'Minutes' : 'Seconds (min 5)'}
        value={picker.inputVal}
        onChange={picker.handleInputChange}
        onBlur={picker.handleBlur}
        onKeyDown={onKeyDown}
        style={{ width: '100%', minWidth: 0 }}
      />
      <CartoonSelect
        value={picker.unit}
        options={DURATION_UNIT_OPTIONS}
        onChange={picker.handleUnitChange}
        triggerStyle={{ padding: '11px 10px' }}
        ariaLabel="Duration unit"
      />
    </motion.div>
  );
}

function TimeLimitPicker({ value, onChange }) {
  const picker = useCustomTimePicker(value, onChange);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, width: '100%' }}>
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <TimePresetSelect value={value} isCustom={picker.isCustom} onChange={picker.handleSelectChange} />
      </div>
      {picker.isCustom && <CustomDurationRow key="time-limit-custom" picker={picker} />}
    </div>
  );
}

const questionKeyMap = new WeakMap();
let nextQuestionKey = 1;
function getQuestionKey(q) {
  if (!q || typeof q !== 'object') return String(q);
  let key = questionKeyMap.get(q);
  if (!key) {
    key = `q-${nextQuestionKey++}`;
    questionKeyMap.set(q, key);
  }
  return key;
}

function SortableQuestionItem({
  question,
  index,
  total,
  meta,
  isEditing,
  isConfirmingDelete,
  onEdit,
  onRemove,
  onDragEnd
}) {
  const dragControls = useDragControls();
  const canReorder = total > 1;

  const handleCardPointerDown = (e) => {
    if (!canReorder) return;
    // Let touch scrolling work normally when swiping on question text; use grip handle on touch.
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea')) return;
    dragControls.start(e);
  };

  const handleGripPointerDown = (e) => {
    if (!canReorder) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    dragControls.start(e);
  };

  return (
    <Reorder.Item
      as="div"
      value={question}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ layout: { type: 'spring', stiffness: 520, damping: 36 } }}
      whileDrag={{
        scale: 1.02,
        boxShadow: '0 14px 28px rgba(30, 27, 75, 0.28)',
        zIndex: 30,
        cursor: 'grabbing'
      }}
      className={`card quiz-queue-card${canReorder ? ' is-draggable' : ''}${isEditing ? ' is-editing' : ''}`}
      onPointerDown={handleCardPointerDown}
    >
      {canReorder && (
        <button
          type="button"
          className="quiz-drag-handle"
          onPointerDown={handleGripPointerDown}
          title="Drag to reorder"
          aria-label={`Drag question ${index + 1} to reorder`}
        >
          <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="4" r="1.8" />
            <circle cx="10" cy="4" r="1.8" />
            <circle cx="4" cy="10" r="1.8" />
            <circle cx="10" cy="10" r="1.8" />
            <circle cx="4" cy="16" r="1.8" />
            <circle cx="10" cy="16" r="1.8" />
          </svg>
        </button>
      )}

      <div style={{ minWidth: 0, flex: 1, wordBreak: 'break-word' }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{index + 1}. {question.text}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="q-type-pill">{meta.label}</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--muted)' }}>
            ⏱️ {formatTimeBadge(question.timeLimit)}
          </span>
          {(question.imageUrl || question.image) && (
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--plum)' }}>🖼️ Image</span>
          )}
        </div>
      </div>

      <div className="quiz-queue-actions">
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: '6px 11px', fontSize: '0.9rem' }}
          onClick={() => onEdit(index)}
          title="Edit question"
        >
          ✏️
        </button>
        <button
          type="button"
          className="btn btn-danger"
          style={{ padding: '6px 11px', fontSize: isConfirmingDelete ? '0.82rem' : '0.9rem' }}
          onClick={() => onRemove(index)}
          title={isConfirmingDelete ? 'Click again to confirm delete' : 'Remove question'}
        >
          {isConfirmingDelete ? '⚠️ Confirm?' : '🗑️'}
        </button>
      </div>
    </Reorder.Item>
  );
}

function LobbyScreen({ socket, room, pin, playerId, setScreen }) {
  const { authEnabled, isSignedIn, userId, getToken } = useAppAuth();
  const [questions, setQuestions] = useState(() => room?.questions || []);
  const [builderTab, setBuilderTab] = useState('ai'); // 'ai' | 'manual' | 'saved'
  const [newQuestion, setNewQuestion] = useState(EMPTY_QUESTION);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editorVersion, setEditorVersion] = useState(0);

  const [musicMuted, setLocalMusicMuted] = useState(isMusicMuted());
  const [globalMuted, setLocalGlobalMuted] = useState(isMuted());
  const settings = room?.settings || { powerMode: 'choose', powerCooldownSec: 120, shuffleQuestions: false };
  const [showRules, setShowRules] = useState(false);
  const [isCustomCooldown, setIsCustomCooldown] = useState(![60, 120, 180, -1].includes(settings.powerCooldownSec));
  const initialCooldownUseMin = settings.powerCooldownSec > 60 && settings.powerCooldownSec % 60 === 0;
  const [customCooldownUnit, setCustomCooldownUnit] = useState(initialCooldownUseMin ? 'min' : 'sec');
  const [customCooldownInput, setCustomCooldownInput] = useState(
    settings.powerCooldownSec > 0
      ? String(initialCooldownUseMin ? settings.powerCooldownSec / 60 : settings.powerCooldownSec)
      : '120'
  );

  // Saved packs & JSON import/export
  const [savedSets, setSavedSets] = useState([]);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [pasteImportText, setPasteImportText] = useState('');
  const [importError, setImportError] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [showSavePack, setShowSavePack] = useState(false);
  const [savePackName, setSavePackName] = useState('');
  const [savingPack, setSavingPack] = useState(false);
  const [packMsg, setPackMsg] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);
  const [confirmDeleteSetId, setConfirmDeleteSetId] = useState(null);
  const [confirmDeleteQuestionKey, setConfirmDeleteQuestionKey] = useState(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Built-in AI Quiz Generator
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(10);
  const [isCustomAiCount, setIsCustomAiCount] = useState(false);
  const [customAiCountInput, setCustomAiCountInput] = useState('10');
  const [aiTypes, setAiTypes] = useState(['classic', 'short_answer', 'slider', 'match']);
  const [aiDifficulty, setAiDifficulty] = useState('mixed');
  const [aiTimeLimit, setAiTimeLimit] = useState(20);
  const aiTimePicker = useCustomTimePicker(aiTimeLimit, setAiTimeLimit);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResultMsg, setAiResultMsg] = useState(null);
  const [aiError, setAiError] = useState(null);

  // Manual image upload
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [importingImageUrl, setImportingImageUrl] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageUploadError, setImageUploadError] = useState(null);

  // Social / Chat / Room header controls
  const [chatMessages, setChatMessages] = useState(room?.chatMessages || []);
  const [chatInput, setChatInput] = useState('');
  const [emojiCooldown, setEmojiCooldown] = useState(0);
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const [copiedJoinLink, setCopiedJoinLink] = useState(false);
  const [serverLanIp, setServerLanIp] = useState(room?.lanIp || null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [lockPending, setLockPending] = useState(false);

  const chatContainerRef = useRef(null);
  const builderSectionRef = useRef(null);
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const editingIndexRef = useRef(editingIndex);
  editingIndexRef.current = editingIndex;
  const reorderTimerRef = useRef(null);
  const pendingReorderRef = useRef(false);
  const currentImageUrlRef = useRef('');
  currentImageUrlRef.current = newQuestion.imageUrl || '';
  const attemptedImportUrlsRef = useRef(new Set());
  const importRetryTimerRef = useRef(null);
  const previewImgRef = useRef(null);

  const isHost = room?.host?.id === playerId;

  useEffect(() => {
    if (!newQuestion.imageUrl) return;
    const img = previewImgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImageLoaded(true);
      setImageError(false);
    }
  }, [newQuestion.imageUrl]);

  useEffect(() => {
    return () => {
      if (importRetryTimerRef.current) {
        clearTimeout(importRetryTimerRef.current);
        importRetryTimerRef.current = null;
      }
      if (reorderTimerRef.current) {
        clearTimeout(reorderTimerRef.current);
        reorderTimerRef.current = null;
      }
      if (pendingReorderRef.current) {
        pendingReorderRef.current = false;
        socket.emit('setQuestions', { questions: questionsRef.current });
      }
    };
  }, [socket]);

  useEffect(() => {
    startLobbyMusic();
    const onMusicChange = (e) => setLocalMusicMuted(e.detail.musicMuted);
    const onMuteChange = (e) => setLocalGlobalMuted(e.detail.muted);
    window.addEventListener('finnival_music_change', onMusicChange);
    window.addEventListener('finnival_mute_change', onMuteChange);
    return () => {
      stopLobbyMusic();
      window.removeEventListener('finnival_music_change', onMusicChange);
      window.removeEventListener('finnival_mute_change', onMuteChange);
    };
  }, []);

  useEffect(() => {
    const sec = room?.settings?.powerCooldownSec;
    if (sec === undefined) return;
    if ([60, 120, 180, -1].includes(sec)) {
      setIsCustomCooldown(false);
    } else {
      setIsCustomCooldown(true);
      if (sec > 60 && sec % 60 === 0) {
        setCustomCooldownUnit('min');
        setCustomCooldownInput(String(sec / 60));
      } else {
        setCustomCooldownUnit('sec');
        setCustomCooldownInput(String(sec));
      }
    }
  }, [room?.settings?.powerCooldownSec]);

  useEffect(() => {
    if (room?.lanIp) setServerLanIp(room.lanIp);
  }, [room?.lanIp]);

  useEffect(() => {
    fetch(`${serverUrl}/api/network-info`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.lanIp && d.lanIp !== 'localhost') {
          setServerLanIp(d.lanIp);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (room?.chatMessages && room.chatMessages.length > chatMessages.length) {
      setChatMessages(room.chatMessages);
    }
  }, [room?.chatMessages, chatMessages.length]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    const onLobbyChat = (msg) => {
      setChatMessages((prev) => [...prev.slice(-49), msg]);
      playChatPop();
    };

    const onLobbyReaction = (reaction) => {
      playEmojiSound(reaction.emoji);
      const randomX = 15 + Math.random() * 70;
      setFloatingEmojis((prev) => [
        ...prev.slice(-19),
        { id: reaction.id || `${Date.now()}-${Math.random()}`, emoji: reaction.emoji, x: randomX }
      ]);
    };

    socket.on('lobbyChat', onLobbyChat);
    socket.on('lobbyReaction', onLobbyReaction);
    return () => {
      socket.off('lobbyChat', onLobbyChat);
      socket.off('lobbyReaction', onLobbyReaction);
    };
  }, [socket]);

  useEffect(() => {
    if (emojiCooldown <= 0) return;
    const timer = setInterval(() => {
      setEmojiCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [emojiCooldown]);

  const buildAuthHeaders = async (extra = {}) => {
    const headers = { ...extra };
    if (authEnabled) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const refreshSets = async () => {
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch(`${serverUrl}/api/question-sets`, { headers });
      if (!res.ok) return;
      const list = await res.json();
      if (Array.isArray(list)) setSavedSets(list);
    } catch (e) {}
  };

  useEffect(() => {
    if (!isHost) return;
    if (authEnabled && !isSignedIn) {
      setSavedSets([]);
      return;
    }
    setSavedSets([]);
    refreshSets();
  }, [isHost, authEnabled, isSignedIn, userId]);

  useEffect(() => {
    const handleQuestionsLoaded = ({ questions: loaded }) => {
      if (reorderTimerRef.current) {
        clearTimeout(reorderTimerRef.current);
        reorderTimerRef.current = null;
      }
      pendingReorderRef.current = false;
      questionsRef.current = loaded;
      editingIndexRef.current = null;
      setEditingIndex(null);
      setQuestions(loaded);
      setPackMsg('✅ Quiz pack loaded!');
      setTimeout(() => setPackMsg(null), 3000);
    };
    socket.on('questionsLoaded', handleQuestionsLoaded);
    return () => socket.off('questionsLoaded', handleQuestionsLoaded);
  }, [socket]);

  const updateSettings = (patch) => {
    socket.emit('updateSettings', patch);
  };

  const commitCustomCooldown = (rawOverride = customCooldownInput, unitOverride = customCooldownUnit) => {
    const clampedSec = resolveCustomSeconds(rawOverride, unitOverride, 120);
    setCustomCooldownInput(unitOverride === 'min' ? String(Math.max(1, Math.round(clampedSec / 60))) : String(clampedSec));
    updateSettings({ powerCooldownSec: clampedSec });
  };

  const handleCooldownUnitChange = (e) => {
    const nextUnit = e.target.value;
    const currentSec = resolveCustomSeconds(customCooldownInput, customCooldownUnit, 120);
    setCustomCooldownUnit(nextUnit);
    if (nextUnit === 'min') {
      const mins = Math.max(1, Math.round(currentSec / 60));
      setCustomCooldownInput(String(mins));
      updateSettings({ powerCooldownSec: mins * 60 });
    } else {
      setCustomCooldownInput(String(currentSec));
      updateSettings({ powerCooldownSec: currentSec });
    }
  };

  const flushReorderSync = () => {
    if (reorderTimerRef.current) {
      clearTimeout(reorderTimerRef.current);
      reorderTimerRef.current = null;
    }
    if (pendingReorderRef.current) {
      pendingReorderRef.current = false;
      socket.emit('setQuestions', { questions: questionsRef.current });
    }
  };

  const updateEditingIndexAfterReorder = (prevList, nextList) => {
    const curEditIdx = editingIndexRef.current;
    if (curEditIdx === null) return;
    const editingItem = prevList[curEditIdx];
    if (!editingItem) return;
    const nextIdx = nextList.indexOf(editingItem);
    const resolvedIdx = nextIdx !== -1 ? nextIdx : null;
    editingIndexRef.current = resolvedIdx;
    setEditingIndex(resolvedIdx);
  };

  const syncQuestions = (list) => {
    if (reorderTimerRef.current) {
      clearTimeout(reorderTimerRef.current);
      reorderTimerRef.current = null;
    }
    pendingReorderRef.current = false;
    questionsRef.current = list;
    setQuestions(list);
    socket.emit('setQuestions', { questions: list });
  };

  const handleReorder = (nextList) => {
    updateEditingIndexAfterReorder(questionsRef.current, nextList);
    questionsRef.current = nextList;
    setQuestions(nextList);
    pendingReorderRef.current = true;
    if (reorderTimerRef.current) clearTimeout(reorderTimerRef.current);
    reorderTimerRef.current = setTimeout(() => {
      flushReorderSync();
    }, 220);
  };

  const handleDragEnd = () => {
    flushReorderSync();
  };

  const exportSavedSet = async (setId, fallbackName) => {
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch(`${serverUrl}/api/question-sets/${setId}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch set');
      const set = await res.json();
      downloadJsonPack(set.name || fallbackName, set.questions || []);
    } catch (e) {
      setImportError('Could not export that quiz pack right now.');
    }
  };

  const processImportedText = (rawText) => {
    try {
      setImportError(null);
      const pack = parseImportedPack(rawText);
      if (questions.length === 0) {
        syncQuestions(pack.questions);
        setShowPasteImport(false);
        setPasteImportText('');
        setPackMsg(`✅ Imported ${pack.questions.length} question${pack.questions.length !== 1 ? 's' : ''}!`);
        setTimeout(() => setPackMsg(null), 3500);
      } else {
        setPendingImport(pack);
      }
    } catch (err) {
      setImportError(err.message || 'Invalid JSON format.');
    }
  };

  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      processImportedText(String(reader.result || ''));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const applyPendingImport = (mode) => {
    if (!pendingImport) return;
    const nextList = mode === 'append'
      ? [...questions, ...pendingImport.questions]
      : pendingImport.questions;
    syncQuestions(nextList);
    if (pendingImport.source === 'ai') {
      setAiResultMsg(`${mode === 'append' ? 'Added' : 'Loaded'} ${pendingImport.questions.length} questions! Scroll down to review or edit.`);
    } else {
      setPackMsg(`✅ ${mode === 'append' ? 'Added' : 'Loaded'} ${pendingImport.questions.length} questions!`);
      setTimeout(() => setPackMsg(null), 3500);
    }
    setPendingImport(null);
    setShowPasteImport(false);
    setPasteImportText('');
  };

  const clearPendingImageImport = () => {
    if (importRetryTimerRef.current) {
      clearTimeout(importRetryTimerRef.current);
      importRetryTimerRef.current = null;
    }
  };

  const tryImportExternalImage = async (targetUrl) => {
    if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) return;
    if (attemptedImportUrlsRef.current.has(targetUrl)) return;
    attemptedImportUrlsRef.current.add(targetUrl);

    setImportingImageUrl(true);
    setImageError(false);
    setImageUploadError(null);
    try {
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`${serverUrl}/api/import-image-url`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json().catch(() => ({}));
      if (currentImageUrlRef.current.trim() !== targetUrl) return;

      if (res.ok && data.imageUrl) {
        setNewQuestion((prev) => ({ ...prev, imageUrl: data.imageUrl }));
        setImageLoaded(false);
        setImageError(false);
        setImageUploadError(null);
        preloadImages([{ imageUrl: data.imageUrl }]);
      } else {
        setImageError(true);
        setImageUploadError(data.error || null);
      }
    } catch (err) {
      if (currentImageUrlRef.current.trim() === targetUrl) {
        setImageError(true);
      }
    } finally {
      if (currentImageUrlRef.current.trim() === targetUrl) {
        setImportingImageUrl(false);
      }
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearPendingImageImport();
    setImportingImageUrl(false);
    setImageUploadError(null);
    if (file.size > 15 * 1024 * 1024) {
      setImageUploadError('Image is too large (max 15MB).');
      e.target.value = '';
      return;
    }
    try {
      setUploadingImage(true);
      const processedFile = await compressImage(file);
      const formData = new FormData();
      formData.append('image', processedFile);
      const headers = await buildAuthHeaders();
      const res = await fetch(`${serverUrl}/api/upload-image`, {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await res.json();
      if (data.imageUrl) {
        setNewQuestion((prev) => ({ ...prev, imageUrl: data.imageUrl }));
        setImageLoaded(false);
        setImageError(false);
        preloadImages([{ imageUrl: data.imageUrl }]);
      } else if (data.error) {
        setImageUploadError(data.error);
      }
    } catch (err) {
      setImageUploadError('Could not upload image right now.');
    } finally {
      setUploadingImage(false);
      e.target.value = '';
    }
  };

  const handleSendChat = (e) => {
    e?.preventDefault();
    const trimmed = chatInput.trim().slice(0, 120);
    if (!trimmed) return;
    socket.emit('sendLobbyChat', { text: trimmed });
    setChatInput('');
  };

  const handleSendReaction = (emoji) => {
    if (emojiCooldown > 0) return;
    setEmojiCooldown(5);
    socket.emit('sendLobbyReaction', { emoji });
  };

  const toggleAiType = (typeId) => {
    setAiTypes((prev) => {
      if (prev.includes(typeId)) {
        return prev.length > 1 ? prev.filter((t) => t !== typeId) : prev;
      }
      return [...prev, typeId];
    });
  };

  const resolvedAiCount = isCustomAiCount
    ? Math.min(25, Math.max(1, Math.round(Number(customAiCountInput)) || 10))
    : aiCount;

  const handleGenerateAiQuiz = async () => {
    if (!aiTopic.trim() || aiGenerating) return;
    setAiGenerating(true);
    setAiError(null);
    setAiResultMsg(null);
    try {
      const sessionToken = sessionStorage.getItem('finnival-sessionToken');
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`${serverUrl}/api/generate-quiz`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pin,
          sessionToken,
          topic: aiTopic.trim(),
          count: resolvedAiCount,
          types: aiTypes,
          difficulty: aiDifficulty,
          timeLimit: aiTimeLimit
        })
      });
      const rawText = await res.text();
      let data = null;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        throw new Error('Could not reach the quiz generator right now. Please try again in a moment.');
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Could not generate questions right now.');
      }
      const pack = {
        name: data.packName || aiTopic.trim(),
        questions: data.questions,
        source: 'ai'
      };
      if (questions.length === 0) {
        syncQuestions(pack.questions);
        setAiResultMsg(`Created ${pack.questions.length} questions! Scroll down to review, edit, or click Start Game.`);
      } else {
        setPendingImport(pack);
      }
    } catch (err) {
      setAiError(err.message || 'Could not generate questions right now.');
    } finally {
      setAiGenerating(false);
    }
  };

  const resetManualEditor = () => {
    clearPendingImageImport();
    setEditingIndex(null);
    setNewQuestion(EMPTY_QUESTION);
    setEditorVersion((v) => v + 1);
    setImageLoaded(false);
    setImportingImageUrl(false);
    setImageError(false);
    setImageUploadError(null);
  };

  const addQuestion = () => {
    if (!newQuestion.text.trim()) return;
    if ((!newQuestion.type || newQuestion.type === 'classic') && newQuestion.options.some((o) => !o.trim())) return;
    if (newQuestion.type === 'match' && newQuestion.pairs.some((p) => !p.left.trim() || !p.right.trim())) return;

    const finalTimeLimit = Math.max(5, Math.round(Number(newQuestion.timeLimit)) || 20);

    const qToSave = {
      ...newQuestion,
      timeLimit: finalTimeLimit,
      image: newQuestion.imageUrl || null,
      imageUrl: newQuestion.imageUrl || null
    };

    if (editingIndex !== null) {
      const updated = questions.map((q, i) => (i === editingIndex ? qToSave : q));
      syncQuestions(updated);
    } else {
      syncQuestions([...questions, qToSave]);
    }
    resetManualEditor();
  };

  const editQuestion = (i) => {
    clearPendingImageImport();
    const q = questions[i];
    const limit = Math.max(5, Math.round(Number(q.timeLimit)) || 20);
    setNewQuestion({ ...EMPTY_QUESTION, ...q, timeLimit: limit, imageUrl: q.imageUrl || q.image || '' });
    setImageLoaded(false);
    setImportingImageUrl(false);
    setImageError(false);
    setImageUploadError(null);
    setEditingIndex(i);
    setEditorVersion((v) => v + 1);
    setBuilderTab('manual');
    setTimeout(() => {
      builderSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const removeQuestion = (i) => {
    const q = questions[i];
    if (!q) return;
    const qKey = getQuestionKey(q);
    if (confirmDeleteQuestionKey !== qKey) {
      setConfirmDeleteQuestionKey(qKey);
      setTimeout(() => setConfirmDeleteQuestionKey((prev) => (prev === qKey ? null : prev)), 3500);
      return;
    }
    setConfirmDeleteQuestionKey(null);
    const updated = questions.filter((_, idx) => idx !== i);
    syncQuestions(updated);
    if (editingIndex === i) {
      resetManualEditor();
    } else if (editingIndex !== null && i < editingIndex) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleClearAllQuestions = () => {
    if (!confirmClearAll) {
      setConfirmClearAll(true);
      setTimeout(() => setConfirmClearAll(false), 3500);
      return;
    }
    syncQuestions([]);
    resetManualEditor();
    setConfirmClearAll(false);
    setConfirmDeleteQuestionKey(null);
  };

  const startGame = () => {
    flushReorderSync();
    socket.emit('startGame');
  };

  const kickPlayer = (targetId) => {
    socket.emit('kickPlayer', { playerId: targetId });
  };

  const handleAbandon = () => {
    if (!confirmAbandon) {
      setConfirmAbandon(true);
      setTimeout(() => setConfirmAbandon(false), 3500);
      return;
    }
    socket.emit('abandonLobby');
    sessionStorage.removeItem('finnival-pin');
    sessionStorage.removeItem('finnival-sessionToken');
    sessionStorage.removeItem('finnival-playerId');
    sessionStorage.removeItem('finnival-role');
    setScreen('home');
  };

  const handleLeave = () => {
    socket.emit('leaveRoom');
    sessionStorage.removeItem('finnival-pin');
    sessionStorage.removeItem('finnival-sessionToken');
    sessionStorage.removeItem('finnival-playerId');
    sessionStorage.removeItem('finnival-role');
    setScreen('home');
  };

  const toggleLock = () => {
    if (lockPending) return;
    setLockPending(true);
    const newLocked = !room?.locked;
    socket.emit('setLocked', { locked: newLocked }, () => {
      setLockPending(false);
    });
    setTimeout(() => setLockPending(false), 1000);
  };

  const openSavePackInput = () => {
    if (questions.length === 0) return;
    setSavePackName(aiTopic.trim() || room?.gameName || '');
    setShowSavePack(true);
  };

  const submitSaveCurrentSet = async (e) => {
    e?.preventDefault();
    const trimmed = savePackName.trim();
    if (!trimmed || questions.length === 0 || savingPack) return;
    setSavingPack(true);
    try {
      const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch(`${serverUrl}/api/question-sets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: trimmed, questions })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Could not save quiz pack right now.');
      }
      await refreshSets();
      setShowSavePack(false);
      setSavePackName('');
      setSaveMsg(`✅ Saved "${trimmed}" to Saved Packs!`);
      setTimeout(() => setSaveMsg(null), 3500);
    } catch (err) {
      setSaveMsg(`⚠️ ${err.message || 'Could not save quiz pack right now.'}`);
    } finally {
      setSavingPack(false);
    }
  };

  const loadSet = async (setId) => {
    const authToken = authEnabled ? await getToken() : null;
    socket.emit('loadQuestionSet', { setId, authToken });
  };

  const deleteSet = async (setId) => {
    if (confirmDeleteSetId !== setId) {
      setConfirmDeleteSetId(setId);
      setTimeout(() => setConfirmDeleteSetId((prev) => (prev === setId ? null : prev)), 3500);
      return;
    }
    setConfirmDeleteSetId(null);
    try {
      const headers = await buildAuthHeaders();
      const res = await fetch(`${serverUrl}/api/question-sets/${setId}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        await refreshSets();
      }
    } catch (e) {}
  };

  const activeLanIp = serverLanIp || room?.lanIp;
  const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const joinHost = (isLocal && activeLanIp && activeLanIp !== 'localhost') ? activeLanIp : (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
  const joinPort = (typeof window !== 'undefined' && window.location.port) ? `:${window.location.port}` : '';
  const joinUrl = (typeof window !== 'undefined') ? `${window.location.protocol}//${joinHost}${joinPort}/?pin=${pin}` : `/?pin=${pin}`;

  const rulesSummary = [
    settings.powerMode === 'off' ? '🚫 Powers Off' : settings.powerMode === 'random' ? '🎲 Random Powers' : '🎮 Choose Powers',
    settings.powerMode !== 'off' ? `⏱️ ${settings.powerCooldownSec === -1 ? 'Once/game' : formatTimeBadge(settings.powerCooldownSec)}` : null,
    settings.shuffleQuestions ? '🔀 Shuffled' : null
  ].filter(Boolean).join(' · ');

  return (
    <div>
      {/* Floating Emojis Animation Overlay */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998, overflow: 'hidden' }}>
        <AnimatePresence>
          {floatingEmojis.map((f) => (
            <motion.div
              key={f.id}
              initial={{ opacity: 1, y: '85vh', x: `${f.x}vw`, scale: 0.6 }}
              animate={{ opacity: [1, 1, 0], y: '15vh', scale: [0.6, 1.4, 1.1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2.4, ease: 'easeOut' }}
              onAnimationComplete={() => {
                setFloatingEmojis((prev) => prev.filter((item) => item.id !== f.id));
              }}
              style={{ position: 'absolute', fontSize: '3rem', textShadow: '0 4px 12px rgba(0,0,0,0.35)' }}
            >
              {f.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Header */}
      <motion.div
        className="lobby-header"
        initial={{ opacity: 0, y: -18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 26 }}
      >
        <h1 style={{ fontSize: '2.5rem', color: 'var(--purple)', marginBottom: 4 }}>{room?.gameName || 'FINNIVAL'}</h1>
        <p style={{ fontSize: '1.1rem', marginBottom: 8, fontWeight: 700, color: 'var(--indigo)' }}>
          Share this code with your friends:
        </p>
        <motion.div
          className="pin-display"
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.08 }}
          whileHover={{ scale: 1.04 }}
        >
          {pin}
        </motion.div>

        {isHost && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '16px auto 10px', maxWidth: 380 }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.82 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.14 }}
              whileHover={{ scale: 1.04, rotate: 1 }}
              style={{
                background: 'white',
                padding: 10,
                borderRadius: 16,
                border: '3px solid var(--indigo-deep)',
                boxShadow: '0 6px 18px rgba(42, 33, 66, 0.18)',
                display: 'inline-block'
              }}
            >
              <QRCodeSVG value={joinUrl} size={132} level="M" marginSize={2} bgColor="#ffffff" fgColor="#1e1835" />
            </motion.div>
            <div style={{ marginTop: 8, fontSize: '0.88rem', fontWeight: 700, color: 'var(--indigo)', textAlign: 'center' }}>
              📷 Scan to Join
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <motion.button
                type="button"
                className={copiedJoinLink ? 'btn btn-success' : 'btn btn-secondary'}
                style={{ padding: '6px 16px', fontSize: '0.84rem', borderRadius: 10 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  navigator.clipboard?.writeText(joinUrl);
                  setCopiedJoinLink(true);
                  setTimeout(() => setCopiedJoinLink(false), 2000);
                }}
              >
                {copiedJoinLink ? '✅ Copied!' : '📋 Copy Link'}
              </motion.button>
            </div>
          </div>
        )}

        <p style={{ marginTop: 10, fontWeight: 700, color: 'var(--indigo)' }}>
          {room?.players.length || 0} player{room?.players.length !== 1 ? 's' : ''} in lobby
        </p>

        <AnimatePresence mode="wait">
          <motion.div
            key={room?.locked ? 'locked' : 'unlocked'}
            className={`lobby-status-banner ${room?.locked ? 'locked' : 'unlocked'}`}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.25 }}
          >
            {room?.locked ? '🔒 Lobby Locked — No new players can join' : '🟢 Lobby Open — Anyone with the PIN can join'}
          </motion.div>
        </AnimatePresence>

        {isHost ? (
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={room?.locked ? 'btn btn-danger' : 'btn btn-secondary'}
              onClick={toggleLock}
              style={{ fontSize: '0.9rem', padding: '8px 16px' }}
            >
              {room?.locked ? '🔓 Unlock Lobby' : '🔒 Lock Lobby'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setLocalMusicMuted(toggleMusicMute())}
              style={{ fontSize: '0.9rem', padding: '8px 16px', opacity: globalMuted ? 0.65 : 1 }}
              title={globalMuted ? 'Global sound is muted (top-right)' : 'Toggle lobby music'}
            >
              {musicMuted ? '🔇 Music: Off' : globalMuted ? '🎵 Music (Muted)' : '🎵 Music: On'}
            </button>
            <button
              type="button"
              className={confirmAbandon ? 'btn btn-danger' : 'btn btn-secondary'}
              onClick={handleAbandon}
              style={{ fontSize: '0.9rem', padding: '8px 16px' }}
            >
              {confirmAbandon ? '⚠️ Confirm Close?' : '🚪 Close Room'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLocalMusicMuted(toggleMusicMute())}
                style={{ fontSize: '0.9rem', padding: '8px 16px', opacity: globalMuted ? 0.65 : 1 }}
                title={globalMuted ? 'Global sound is muted (top-right)' : 'Toggle lobby music'}
              >
                {musicMuted ? '🔇 Music: Off' : globalMuted ? '🎵 Music (Muted)' : '🎵 Music: On'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleLeave}
                style={{ fontSize: '0.9rem', padding: '8px 16px' }}
              >
                🚪 Leave Lobby
              </button>
            </div>
            <span style={{ display: 'inline-block', fontSize: '0.84rem', fontWeight: 700, color: 'var(--indigo)', background: 'var(--cream)', border: '2px solid var(--indigo-deep)', borderRadius: 999, padding: '5px 14px' }}>
              {rulesSummary}
            </span>
          </div>
        )}
      </motion.div>

      <div className="lobby-container">
        {/* Players Roster */}
        <h2 style={{ color: 'white', marginBottom: 12 }}>👥 Players ({room?.players.length || 0})</h2>
        {room?.players.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px', marginBottom: 20 }}>
            Waiting for players to join...
          </div>
        ) : (
          <div className="player-list" style={{ marginBottom: 20 }}>
            <AnimatePresence>
              {room?.players.map((p, i) => (
                <motion.div
                  key={p.id}
                  className="player-card"
                  layout
                  initial={{ opacity: 0, y: 16, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 300, damping: 22 }}
                >
                  <div className="player-avatar">{p.avatar}</div>
                  <div style={{ fontWeight: 700 }}>{p.name}</div>
                  {p.isHost && <div style={{ fontSize: '0.8rem', color: 'var(--purple)' }}>👑 Host</div>}
                  {!p.connected && <div style={{ fontSize: '0.8rem', color: 'var(--red)', fontWeight: 700 }}>Connection Lost</div>}
                  {isHost && !p.isHost && (
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => kickPlayer(p.id)}
                        style={{ padding: '4px 14px', fontSize: '0.75rem', borderRadius: 8 }}
                      >
                        Kick
                      </button>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Reactions & Lobby Chat */}
        <div className="card" style={{ padding: 16, marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem' }}>💬 Lobby Chat</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {emojiCooldown > 0 && (
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--orange-dark)' }}>
                  {emojiCooldown}s
                </span>
              )}
              {['🔥', '💀', '😭', '😂', '👑', '🪝'].map((emoji) => (
                <motion.button
                  key={emoji}
                  type="button"
                  onClick={() => handleSendReaction(emoji)}
                  disabled={emojiCooldown > 0}
                  whileHover={emojiCooldown > 0 ? undefined : { scale: 1.18, y: -3, rotate: -6 }}
                  whileTap={emojiCooldown > 0 ? undefined : { scale: 0.85, rotate: 6 }}
                  transition={{ type: 'spring', stiffness: 450, damping: 18 }}
                  style={{
                    fontSize: '1.3rem',
                    padding: '4px 9px',
                    borderRadius: 10,
                    background: emojiCooldown > 0 ? '#f0ecf5' : 'var(--amber-tint)',
                    border: '2px solid var(--indigo-deep)',
                    cursor: emojiCooldown > 0 ? 'not-allowed' : 'pointer',
                    opacity: emojiCooldown > 0 ? 0.5 : 1
                  }}
                >
                  {emoji}
                </motion.button>
              ))}
            </div>
          </div>

          <div
            ref={chatContainerRef}
            style={{
              maxHeight: 150,
              minHeight: 72,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              background: 'rgba(42, 33, 66, 0.92)',
              borderRadius: 10,
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginBottom: 10
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ color: 'rgba(255,255,255,0.6)', fontStyle: 'italic', textAlign: 'center', margin: 'auto', fontSize: '0.9rem' }}>
                Say hello while waiting!
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {chatMessages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, x: -12, scale: 0.96 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 24 }}
                    style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: '0.9rem' }}
                  >
                    <span>{msg.senderAvatar}</span>
                    <strong style={{ color: msg.isHost ? 'var(--amber)' : '#ffffff' }}>
                      {msg.isHost ? 'Host' : msg.senderName}:
                    </strong>
                    <span style={{ wordBreak: 'break-word', color: 'rgba(255,255,255,0.92)' }}>{msg.text}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>

          <form onSubmit={handleSendChat} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              placeholder="Send a chat message..."
              maxLength={120}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              style={{ flex: 1, margin: 0, padding: '8px 12px' }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: '8px 18px', fontSize: '0.9rem' }}>
              Send
            </button>
          </form>
        </div>

        {/* Host Workspace */}
        {isHost && (
          <div>
            {/* Compact Collapsible Game Rules Bar */}
            <div className="card" style={{ marginBottom: 20, padding: '16px 20px' }}>
              <div className="rules-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'Fredoka One', cursive", fontSize: '1.15rem' }}>⚙️ Game Rules</span>
                  <span className="q-type-pill">{rulesSummary}</span>
                </div>
                <button
                  type="button"
                  className={showRules ? 'btn btn-primary' : 'btn btn-secondary'}
                  style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                  onClick={() => setShowRules((prev) => !prev)}
                >
                  {showRules ? 'Done ▴' : 'Customize ▾'}
                </button>
              </div>

              <AnimatePresence initial={false}>
                {showRules && (
                  <motion.div
                    key="rules-drawer"
                    initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                    exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    style={{ margin: '0 -6px -8px' }}
                  >
                    <SmoothHeight style={{ margin: 0 }}>
                      <div style={{ marginTop: 18, paddingTop: 16, paddingBottom: 4, borderTop: '2px dashed rgba(66, 52, 101, 0.18)' }}>
                        <div style={{ marginBottom: 16 }}>
                          <label style={{ display: 'block', marginBottom: 8, fontWeight: 800 }}>Power Mode</label>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {[
                              { id: 'choose', label: '🎮 Players Choose' },
                              { id: 'random', label: '🎲 Random Powers' },
                              { id: 'off', label: '🚫 Powers Off' }
                            ].map((m) => (
                              <motion.button
                                key={m.id}
                                type="button"
                                className={settings.powerMode === m.id ? 'btn btn-primary' : 'btn btn-secondary'}
                                style={{ flex: '1 1 140px', padding: '9px 12px', fontSize: '0.9rem', opacity: settings.powerMode === m.id ? 1 : 0.7 }}
                                onClick={() => updateSettings({ powerMode: m.id })}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.96 }}
                              >
                                {m.label}
                              </motion.button>
                            ))}
                          </div>
                        </div>

                        <AnimatePresence initial={false}>
                          {settings.powerMode !== 'off' && (
                            <motion.div
                              key="power-cooldown-drawer"
                              initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                              animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                              style={{ margin: '0 -4px' }}
                            >
                              <div style={{ padding: '2px 4px 16px' }}>
                                <label style={{ display: 'block', marginBottom: 8, fontWeight: 800 }}>Power Cooldown</label>
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 8,
                                    width: '100%'
                                  }}
                                >
                                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                    <CartoonSelect
                                      value={isCustomCooldown ? 'custom' : settings.powerCooldownSec}
                                      ariaLabel="Power Cooldown"
                                      options={[
                                        { value: 60, label: '⚡ Fast (60 seconds)' },
                                        { value: 120, label: '⚖️ Normal (120 seconds)' },
                                        { value: 180, label: '🐢 Slow (180 seconds)' },
                                        { value: -1, label: '🎯 Once per game' },
                                        { value: 'custom', label: '⏱️ Custom...' }
                                      ]}
                                      onChange={(e) => {
                                        if (e.target.value === 'custom') {
                                          const fallbackSec = settings.powerCooldownSec > 0 ? settings.powerCooldownSec : 120;
                                          const useMin = fallbackSec > 60 && fallbackSec % 60 === 0;
                                          setIsCustomCooldown(true);
                                          setCustomCooldownUnit(useMin ? 'min' : 'sec');
                                          setCustomCooldownInput(useMin ? String(fallbackSec / 60) : String(fallbackSec));
                                        } else {
                                          setIsCustomCooldown(false);
                                          updateSettings({ powerCooldownSec: Number(e.target.value) });
                                        }
                                      }}
                                    />
                                  </div>
                                  {isCustomCooldown && (
                                    <CustomDurationRow
                                      key="cooldown-custom-row"
                                      picker={{
                                        unit: customCooldownUnit,
                                        inputVal: customCooldownInput,
                                        handleInputChange: (e) => setCustomCooldownInput(e.target.value),
                                        handleBlur: () => commitCustomCooldown(),
                                        handleUnitChange: handleCooldownUnitChange
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          commitCustomCooldown();
                                        }
                                      }}
                                    />
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 800 }}>🔀 Shuffle Question Order</div>
                          <motion.button
                            type="button"
                            className={settings.shuffleQuestions ? 'btn btn-success' : 'btn btn-secondary'}
                            style={{ padding: '7px 18px', fontSize: '0.9rem', minWidth: 100 }}
                            onClick={() => updateSettings({ shuffleQuestions: !settings.shuffleQuestions })}
                            whileHover={{ scale: 1.04 }}
                            whileTap={{ scale: 0.94 }}
                          >
                            {settings.shuffleQuestions ? '✅ ON' : 'OFF'}
                          </motion.button>
                        </div>
                      </div>
                    </SmoothHeight>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Unified 3-Tab Quiz Builder */}
            <div ref={builderSectionRef}>
              <h2 style={{ color: 'white', marginBottom: 12 }}>🎯 Build Your Quiz</h2>
              <div className="card" style={{ marginBottom: 24 }}>
                <div className="lobby-tabs">
                  {[
                    { id: 'ai', label: '✨ AI Quiz' },
                    { id: 'manual', label: `✏️ ${editingIndex !== null ? `Editing #${editingIndex + 1}` : 'Add Manually'}` },
                    { id: 'saved', label: `📚 Saved (${savedSets.length})` }
                  ].map((tab) => {
                    const active = builderTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        className={`lobby-tab-btn ${active ? 'active' : ''}`}
                        onClick={() => setBuilderTab(tab.id)}
                      >
                        {active && (
                          <motion.span
                            layoutId="lobbyBuilderTabPill"
                            className="lobby-tab-pill"
                            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                          />
                        )}
                        <span className="lobby-tab-label">{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <SmoothHeight>
                  <AnimatePresence mode="wait">
                  {/* TAB 1: AI QUIZ GENERATOR */}
                  {builderTab === 'ai' && (
                    <motion.div
                      key="tab-ai"
                      initial={{ opacity: 0, y: 12, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    >
                      <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Topic</label>
                      <input
                        className="input"
                        placeholder="e.g. Ocean wildlife, World capitals, 90s anime, Database basics..."
                        value={aiTopic}
                        onChange={(e) => setAiTopic(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleGenerateAiQuiz();
                          }
                        }}
                        style={{ width: '100%', marginBottom: 14 }}
                      />

                      <label style={{ display: 'block', marginBottom: 8, fontWeight: 800 }}>Question Types</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                        {[
                          { id: 'classic', label: '🟦 Choice' },
                          { id: 'short_answer', label: '✍️ Short Answer' },
                          { id: 'slider', label: '🌡️ Slider' },
                          { id: 'match', label: '🔗 Match' }
                        ].map((t) => {
                          const active = aiTypes.includes(t.id);
                          return (
                            <motion.button
                              key={t.id}
                              type="button"
                              className={active ? 'btn btn-primary' : 'btn btn-secondary'}
                              style={{ flex: '1 1 120px', padding: '8px 10px', fontSize: '0.88rem', opacity: active ? 1 : 0.58 }}
                              onClick={() => toggleAiType(t.id)}
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.95 }}
                            >
                              {active ? '✓ ' : ''}{t.label}
                            </motion.button>
                          );
                        })}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 10, marginBottom: (isCustomAiCount || aiTimePicker.isCustom) ? 10 : 16 }}>
                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.85rem' }}>Questions</label>
                          <CartoonSelect
                            value={isCustomAiCount ? 'custom' : aiCount}
                            ariaLabel="Questions count"
                            options={[
                              ...[5, 10, 15, 20, 25].map((n) => ({ value: n, label: `${n} questions` })),
                              { value: 'custom', label: '✏️ Custom...' }
                            ]}
                            onChange={(e) => {
                              if (e.target.value === 'custom') {
                                setIsCustomAiCount(true);
                                setCustomAiCountInput(String(aiCount));
                              } else {
                                setIsCustomAiCount(false);
                                setAiCount(Number(e.target.value));
                              }
                            }}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.85rem' }}>Difficulty</label>
                          <CartoonSelect
                            value={aiDifficulty}
                            ariaLabel="Difficulty"
                            options={[
                              { value: 'mixed', label: '🎲 Mixed' },
                              { value: 'easy', label: '🟢 Easy' },
                              { value: 'medium', label: '🟡 Medium' },
                              { value: 'hard', label: '🔴 Hard' }
                            ]}
                            onChange={(e) => setAiDifficulty(e.target.value)}
                          />
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.85rem' }}>Time Each</label>
                          <TimePresetSelect
                            value={aiTimeLimit}
                            isCustom={aiTimePicker.isCustom}
                            onChange={aiTimePicker.handleSelectChange}
                          />
                        </div>
                      </div>

                      <AnimatePresence>
                        {(isCustomAiCount || aiTimePicker.isCustom) && (
                          <motion.div
                            key="ai-custom-tray"
                            initial={{ opacity: 0, y: -8, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -8, scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                              gap: 10,
                              marginBottom: 16,
                              padding: 12,
                              background: 'var(--cream)',
                              borderRadius: 12,
                              border: '2px dashed rgba(66, 52, 101, 0.25)'
                            }}
                          >
                            {isCustomAiCount && (
                              <div style={{ minWidth: 0 }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.85rem' }}>Custom Questions (1–25)</label>
                                <input
                                  type="number"
                                  min="1"
                                  max="25"
                                  className="input"
                                  value={customAiCountInput}
                                  onChange={(e) => setCustomAiCountInput(e.target.value)}
                                  onBlur={() => {
                                    const clamped = Math.min(25, Math.max(1, Math.round(Number(customAiCountInput)) || 10));
                                    setCustomAiCountInput(String(clamped));
                                    setAiCount(clamped);
                                  }}
                                  style={{ width: '100%', minWidth: 0 }}
                                  placeholder="1-25"
                                />
                              </div>
                            )}
                            {aiTimePicker.isCustom && (
                              <div style={{ minWidth: 0 }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 700, fontSize: '0.85rem' }}>⏱️ Custom Time Each</label>
                                <CustomDurationRow picker={aiTimePicker} />
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <motion.button
                        type="button"
                        className="btn btn-success"
                        onClick={handleGenerateAiQuiz}
                        disabled={!aiTopic.trim() || aiGenerating}
                        whileHover={!aiTopic.trim() || aiGenerating ? undefined : { scale: 1.02 }}
                        whileTap={!aiTopic.trim() || aiGenerating ? undefined : { scale: 0.97 }}
                        style={{ width: '100%', fontSize: '1.05rem' }}
                      >
                        {aiGenerating
                          ? `⏳ Generating ${resolvedAiCount} questions...`
                          : `✨ Generate ${resolvedAiCount} Questions`}
                      </motion.button>

                      <AnimatePresence>
                        {aiResultMsg && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(61,190,139,0.16)', color: 'var(--indigo-deep)', fontWeight: 700, fontSize: '0.9rem' }}
                          >
                            ✅ {aiResultMsg}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {aiError && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(229,72,77,0.12)', color: 'var(--red)', fontWeight: 700, fontSize: '0.9rem' }}
                          >
                            ⚠️ {aiError}
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <AnimatePresence>
                        {pendingImport?.source === 'ai' && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.96, y: 8 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--amber-tint)', border: '2px solid var(--orange)' }}
                          >
                            <div style={{ fontWeight: 800, marginBottom: 8 }}>
                              Generated {pendingImport.questions.length} questions! Replace your current {questions.length}, or add them together?
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button type="button" className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => applyPendingImport('replace')}>
                                Replace Current
                              </button>
                              <button type="button" className="btn btn-success" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => applyPendingImport('append')}>
                                Add to Current
                              </button>
                              <button type="button" className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => setPendingImport(null)}>
                                Cancel
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )}

                  {/* TAB 2: MANUAL QUESTION EDITOR */}
                  {builderTab === 'manual' && (
                    <motion.div
                      key="tab-manual"
                      initial={{ opacity: 0, y: 12, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    >
                      {editingIndex !== null && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: 1, scale: 1 }}
                          style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 10, background: 'var(--amber-tint)', border: '2px solid var(--orange)', fontWeight: 800, fontSize: '0.9rem' }}
                        >
                          ✏️ Editing Question #{editingIndex + 1}
                        </motion.div>
                      )}

                      <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Question Type</label>
                      <CartoonSelect
                        value={newQuestion.type || 'classic'}
                        ariaLabel="Question Type"
                        style={{ marginBottom: 12 }}
                        options={[
                          { value: 'classic', label: '🟦 Multiple Choice' },
                          { value: 'short_answer', label: '✍️ Short Answer' },
                          { value: 'slider', label: '🌡️ Number Slider' },
                          { value: 'match', label: '🔗 Match Pairs' }
                        ]}
                        onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value })}
                      />

                      <input
                        className="input"
                        placeholder="Write your question..."
                        value={newQuestion.text}
                        onChange={(e) => setNewQuestion({ ...newQuestion, text: e.target.value })}
                        style={{ width: '100%', marginBottom: 12 }}
                      />

                      {/* Optional Image (right below question, matching gameplay order) */}
                      <div style={{ marginBottom: 14, padding: 12, background: 'var(--cream)', borderRadius: 10, border: '2px dashed rgba(66, 52, 101, 0.25)' }}>
                        <label style={{ display: 'block', marginBottom: 6, fontWeight: 800, fontSize: '0.9rem' }}>
                          📷 Image (Optional)
                        </label>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            className="input"
                            placeholder="Paste image URL or link..."
                            value={newQuestion.imageUrl || ''}
                            onChange={(e) => {
                              clearPendingImageImport();
                              setImportingImageUrl(false);
                              setImageLoaded(false);
                              setImageError(false);
                              setImageUploadError(null);
                              setNewQuestion({ ...newQuestion, imageUrl: e.target.value });
                            }}
                            style={{ flex: '1 1 160px', minWidth: 0, margin: 0 }}
                          />
                          <label className="btn btn-secondary" style={{ cursor: uploadingImage ? 'wait' : 'pointer', margin: 0, padding: '9px 14px', fontSize: '0.88rem', whiteSpace: 'nowrap' }}>
                            {uploadingImage ? '⏳ Uploading...' : '📁 Upload'}
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/gif"
                              style={{ display: 'none' }}
                              disabled={uploadingImage}
                              onChange={handleImageUpload}
                            />
                          </label>
                          {newQuestion.imageUrl && (
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: '9px 12px', margin: 0, fontSize: '0.85rem' }}
                              onClick={() => {
                                clearPendingImageImport();
                                setNewQuestion({ ...newQuestion, imageUrl: '' });
                                setImageLoaded(false);
                                setImportingImageUrl(false);
                                setImageError(false);
                                setImageUploadError(null);
                              }}
                            >
                              ✕ Clear
                            </button>
                          )}
                        </div>
                        {imageUploadError && (
                          <div style={{ color: 'var(--red)', fontSize: '0.85rem', fontWeight: 700, marginTop: 6 }}>
                            ⚠️ {imageUploadError}
                          </div>
                        )}
                        <AnimatePresence>
                          {newQuestion.imageUrl && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.94 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.94 }}
                              style={{ marginTop: 10 }}
                            >
                              <img
                                key={resolveImageUrl(newQuestion.imageUrl) || newQuestion.imageUrl}
                                ref={previewImgRef}
                                src={resolveImageUrl(newQuestion.imageUrl)}
                                alt="Preview"
                                referrerPolicy="no-referrer"
                                onError={() => {
                                  setImageLoaded(false);
                                  const raw = (newQuestion.imageUrl || '').trim();
                                  const isExternal = raw.startsWith('http://') || raw.startsWith('https://');
                                  if (isExternal && !attemptedImportUrlsRef.current.has(raw) && !uploadingImage) {
                                    clearPendingImageImport();
                                    importRetryTimerRef.current = setTimeout(() => {
                                      tryImportExternalImage(raw);
                                    }, 350);
                                  } else {
                                    setImageError(true);
                                  }
                                }}
                                onLoad={() => {
                                  clearPendingImageImport();
                                  setImageLoaded(true);
                                  setImageError(false);
                                  setImportingImageUrl(false);
                                }}
                                style={{
                                  maxHeight: 110,
                                  maxWidth: '100%',
                                  borderRadius: 8,
                                  border: '2px solid var(--indigo-deep)',
                                  objectFit: 'contain',
                                  display: (imageLoaded && !imageError) ? 'block' : 'none'
                                }}
                              />
                              {!imageLoaded && !imageError && (
                                <div style={{ color: 'var(--muted)', fontSize: '0.84rem', fontWeight: 700 }}>
                                  {importingImageUrl ? '⏳ Importing image from link...' : '⏳ Loading preview...'}
                                </div>
                              )}
                              {imageError && !imageUploadError && (
                                <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: 4 }}>
                                  ⚠️ Could not load image preview — try right-click → &quot;Copy image address&quot; or Upload
                                </div>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      <AnimatePresence mode="wait">
                        {(!newQuestion.type || newQuestion.type === 'classic') && (
                          <motion.div
                            key="qtype-classic"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18 }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <label style={{ fontWeight: 800 }}>Choices</label>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                                  onClick={() => setNewQuestion({ ...newQuestion, options: [...newQuestion.options, ''] })}
                                >
                                  + Choice
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                                  disabled={newQuestion.options.length <= 2}
                                  onClick={() => {
                                    const nextOpts = newQuestion.options.slice(0, -1);
                                    setNewQuestion({
                                      ...newQuestion,
                                      options: nextOpts,
                                      correctAnswer: Math.min(newQuestion.correctAnswer, nextOpts.length - 1)
                                    });
                                  }}
                                >
                                  - Remove
                                </button>
                              </div>
                            </div>
                            {newQuestion.options.map((opt, i) => (
                              <input
                                key={i}
                                className="input"
                                placeholder={`Choice ${String.fromCharCode(65 + i)}`}
                                value={opt}
                                onChange={(e) => {
                                  const opts = [...newQuestion.options];
                                  opts[i] = e.target.value;
                                  setNewQuestion({ ...newQuestion, options: opts });
                                }}
                                style={{ width: '100%', marginBottom: 8 }}
                              />
                            ))}
                            <label style={{ display: 'block', marginTop: 8, marginBottom: 6, fontWeight: 800 }}>Correct Choice</label>
                            <CartoonSelect
                              value={newQuestion.correctAnswer}
                              ariaLabel="Correct Choice"
                              style={{ marginBottom: 12 }}
                              options={newQuestion.options.map((opt, i) => ({
                                value: i,
                                label: `Choice ${String.fromCharCode(65 + i)}${opt.trim() ? ` — ${opt.trim()}` : ''}`
                              }))}
                              onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswer: Number(e.target.value) })}
                            />
                          </motion.div>
                        )}

                        {newQuestion.type === 'short_answer' && (
                          <motion.div
                            key="qtype-short"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18 }}
                          >
                            <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Correct Answer</label>
                            <input
                              className="input"
                              placeholder="e.g. Paris"
                              value={newQuestion.correctAnswerText || ''}
                              onChange={(e) => setNewQuestion({ ...newQuestion, correctAnswerText: e.target.value })}
                              style={{ width: '100%', marginBottom: 12 }}
                            />
                          </motion.div>
                        )}

                        {newQuestion.type === 'slider' && (
                          <motion.div
                            key="qtype-slider"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18 }}
                          >
                            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                              <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Min Value</label>
                                <input
                                  type="number"
                                  className="input"
                                  value={newQuestion.min ?? 0}
                                  onChange={(e) => setNewQuestion({ ...newQuestion, min: Number(e.target.value) })}
                                  style={{ width: '100%' }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Max Value</label>
                                <input
                                  type="number"
                                  className="input"
                                  value={newQuestion.max ?? 100}
                                  onChange={(e) => setNewQuestion({ ...newQuestion, max: Number(e.target.value) })}
                                  style={{ width: '100%' }}
                                />
                              </div>
                            </div>
                            <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Exact Target Number</label>
                            <input
                              type="number"
                              className="input"
                              value={newQuestion.correctNumber ?? 50}
                              onChange={(e) => setNewQuestion({ ...newQuestion, correctNumber: Number(e.target.value) })}
                              style={{ width: '100%', marginBottom: 12 }}
                            />
                          </motion.div>
                        )}

                        {newQuestion.type === 'match' && (
                          <motion.div
                            key="qtype-match"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18 }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                              <label style={{ fontWeight: 800 }}>Matching Pairs</label>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                                  onClick={() => setNewQuestion({ ...newQuestion, pairs: [...(newQuestion.pairs || []), { left: '', right: '' }] })}
                                >
                                  + Pair
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  style={{ padding: '4px 10px', fontSize: '0.82rem' }}
                                  disabled={(newQuestion.pairs?.length || 0) <= 2}
                                  onClick={() => setNewQuestion({ ...newQuestion, pairs: newQuestion.pairs.slice(0, -1) })}
                                >
                                  - Remove
                                </button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                              {(newQuestion.pairs || []).map((p, i) => (
                                <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', background: 'var(--cream)', padding: 10, borderRadius: 10, border: '2px dashed var(--plum)' }}>
                                  <span style={{ fontWeight: 'bold', width: 26 }}>#{i + 1}</span>
                                  <input
                                    className="input"
                                    placeholder="Left item"
                                    value={p.left}
                                    onChange={(e) => {
                                      const np = [...newQuestion.pairs];
                                      np[i] = { ...np[i], left: e.target.value };
                                      setNewQuestion({ ...newQuestion, pairs: np });
                                    }}
                                    style={{ flex: '1 1 110px', minWidth: 0, margin: 0 }}
                                  />
                                  <span style={{ fontSize: '1.3rem' }}>➔</span>
                                  <input
                                    className="input"
                                    placeholder="Matching answer"
                                    value={p.right}
                                    onChange={(e) => {
                                      const np = [...newQuestion.pairs];
                                      np[i] = { ...np[i], right: e.target.value };
                                      setNewQuestion({ ...newQuestion, pairs: np });
                                    }}
                                    style={{ flex: '1 1 110px', minWidth: 0, margin: 0 }}
                                  />
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Time Limit */}
                      <label style={{ display: 'block', marginBottom: 6, fontWeight: 800 }}>Time Limit</label>
                      <div style={{ marginBottom: 16 }}>
                        <TimeLimitPicker
                          key={editorVersion}
                          value={newQuestion.timeLimit}
                          onChange={(sec) => setNewQuestion((prev) => ({ ...prev, timeLimit: sec }))}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: 10 }}>
                        <motion.button
                          type="button"
                          className="btn btn-primary"
                          onClick={addQuestion}
                          style={{ flex: 1 }}
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          {editingIndex !== null ? '💾 Save Changes' : '+ Add Question'}
                        </motion.button>
                        {editingIndex !== null && (
                          <motion.button
                            type="button"
                            className="btn btn-secondary"
                            onClick={resetManualEditor}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                          >
                            Cancel
                          </motion.button>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* TAB 3: SAVED PACKS & IMPORT */}
                  {builderTab === 'saved' && (
                    <motion.div
                      key="tab-saved"
                      initial={{ opacity: 0, y: 12, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.985 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                        <span style={{ fontWeight: 800, color: 'var(--indigo)' }}>Your Quiz Library</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <label className="btn btn-secondary" style={{ padding: '7px 13px', fontSize: '0.84rem', cursor: 'pointer', flex: '1 1 auto', textAlign: 'center' }}>
                            📥 Import (.json)
                            <input
                              type="file"
                              accept=".json,application/json"
                              style={{ display: 'none' }}
                              onChange={handleImportFile}
                            />
                          </label>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '7px 13px', fontSize: '0.84rem', flex: '1 1 auto' }}
                            onClick={() => {
                              setShowPasteImport((prev) => !prev);
                              setImportError(null);
                            }}
                          >
                            📋 Paste JSON
                          </button>
                        </div>
                      </div>

                      <AnimatePresence initial={false}>
                        {showPasteImport && (
                          <motion.div
                            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
                            animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
                            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                            style={{ margin: '0 -4px' }}
                          >
                            <div style={{ padding: '2px 4px 14px' }}>
                              <div style={{ padding: 12, background: 'var(--cream)', border: '2px dashed var(--plum)', borderRadius: 12 }}>
                                <textarea
                                  className="input"
                                  rows={5}
                                  placeholder="Paste your quiz JSON here..."
                                  value={pasteImportText}
                                  onChange={(e) => setPasteImportText(e.target.value)}
                                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem', marginBottom: 8 }}
                                />
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                                    onClick={() => processImportedText(pasteImportText)}
                                  >
                                    Load JSON
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '6px 14px', fontSize: '0.85rem' }}
                                    onClick={() => { setShowPasteImport(false); setImportError(null); }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {importError && (
                        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(229,72,77,0.12)', color: 'var(--red)', fontWeight: 700, fontSize: '0.88rem' }}>
                          ⚠️ {importError}
                        </div>
                      )}

                      {packMsg && (
                        <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(61,190,139,0.16)', color: 'var(--indigo-deep)', fontWeight: 700, fontSize: '0.88rem' }}>
                          {packMsg}
                        </div>
                      )}

                      {pendingImport && pendingImport.source !== 'ai' && (
                        <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: 'var(--amber-tint)', border: '2px solid var(--orange)' }}>
                          <div style={{ fontWeight: 800, marginBottom: 8 }}>
                            Ready to import {pendingImport.questions.length} question{pendingImport.questions.length !== 1 ? 's' : ''}{pendingImport.name ? ` ("${pendingImport.name}")` : ''}. Replace your current {questions.length}?
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-danger" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => applyPendingImport('replace')}>
                              Replace Current
                            </button>
                            <button type="button" className="btn btn-success" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => applyPendingImport('append')}>
                              Add to Current
                            </button>
                            <button type="button" className="btn btn-secondary" style={{ padding: '6px 14px', fontSize: '0.85rem' }} onClick={() => setPendingImport(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {savedSets.length === 0 ? (
                        <p style={{ color: 'var(--muted)', textAlign: 'center', padding: '16px 0' }}>
                          No saved packs yet. Build a quiz and click Save under Your Quiz!
                        </p>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {savedSets.map((s) => (
                            <motion.div
                              key={s.id}
                              className="saved-pack-row"
                              layout
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.96 }}
                            >
                              <div className="saved-pack-meta">
                                <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span>{s.name}</span>
                                  {s.isPublic && (
                                    <span style={{ fontSize: '0.7rem', padding: '1px 6px', borderRadius: 999, background: 'var(--amber-tint)', color: '#9A3412', fontWeight: 800 }}>
                                      🌟 Starter
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{s.questionCount} question{s.questionCount !== 1 ? 's' : ''}</div>
                              </div>
                              <div className="saved-pack-actions">
                                <button type="button" className="btn btn-primary" style={{ padding: '5px 12px', fontSize: '0.84rem' }} onClick={() => loadSet(s.id)}>
                                  Load
                                </button>
                                <button type="button" className="btn btn-secondary" style={{ padding: '5px 11px', fontSize: '0.84rem' }} onClick={() => exportSavedSet(s.id, s.name)}>
                                  📤 Export
                                </button>
                                {(s.canDelete !== undefined ? s.canDelete : (s.isOwner !== false || (s.isPublic && (!authEnabled || isSignedIn)))) && (
                                  <button type="button" className="btn btn-danger" style={{ padding: '5px 11px', fontSize: '0.84rem' }} onClick={() => deleteSet(s.id)}>
                                    {confirmDeleteSetId === s.id ? 'Confirm?' : '🗑️'}
                                  </button>
                                )}
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  )}
                  </AnimatePresence>
                </SmoothHeight>
              </div>
            </div>

            {/* Active Quiz Queue */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: questions.length > 1 ? 6 : 12, flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ color: 'white', margin: 0 }}>
                  📋 Your Quiz ({questions.length} question{questions.length !== 1 ? 's' : ''})
                </h2>
                {questions.length > 0 && (
                  <button
                    type="button"
                    className={confirmClearAll ? 'btn btn-danger' : 'btn btn-secondary'}
                    style={{ padding: '6px 14px', fontSize: '0.82rem' }}
                    onClick={handleClearAllQuestions}
                  >
                    {confirmClearAll ? '⚠️ Confirm Clear All?' : '🗑️ Clear All'}
                  </button>
                )}
              </div>

              {questions.length > 1 && (
                <div style={{ marginBottom: 12 }}>
                  {settings.shuffleQuestions ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 12px', borderRadius: 10, background: 'rgba(245, 166, 35, 0.2)', border: '1.5px solid rgba(245, 166, 35, 0.65)', color: '#FDE68A', fontSize: '0.82rem', fontWeight: 700 }}>
                      <span>🔀 Shuffle Order is ON in Game Rules — custom order is ignored during play.</span>
                      <button
                        type="button"
                        onClick={() => updateSettings({ shuffleQuestions: false })}
                        style={{ background: '#F5A623', color: '#1E1B4B', border: '2px solid #1E1B4B', borderRadius: 8, padding: '2px 8px', fontWeight: 900, fontSize: '0.76rem', cursor: 'pointer' }}
                      >
                        Turn Shuffle OFF
                      </button>
                    </div>
                  ) : (
                    <div style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: '0.84rem', fontWeight: 700 }}>
                      ✋ Drag questions to reorder
                    </div>
                  )}
                </div>
              )}

              {questions.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--muted)', padding: '20px' }}>
                  No questions yet — generate with AI, add manually, or load a saved pack above!
                </div>
              ) : (
                <>
                  <Reorder.Group
                    as="div"
                    axis="y"
                    values={questions}
                    onReorder={handleReorder}
                    style={{ display: 'flex', flexDirection: 'column', listStyle: 'none', padding: 0, margin: 0 }}
                  >
                    <AnimatePresence initial={false}>
                      {questions.map((q, i) => {
                        const meta = TYPE_META[q.type || 'classic'] || TYPE_META.classic;
                        const qKey = getQuestionKey(q);
                        return (
                          <SortableQuestionItem
                            key={qKey}
                            question={q}
                            index={i}
                            total={questions.length}
                            meta={meta}
                            isEditing={editingIndex === i}
                            isConfirmingDelete={confirmDeleteQuestionKey === qKey}
                            onEdit={editQuestion}
                            onRemove={removeQuestion}
                            onDragEnd={handleDragEnd}
                          />
                        );
                      })}
                    </AnimatePresence>
                  </Reorder.Group>

                  {/* Save & Export Bar — visible only when 1+ questions are added */}
                  <div className="card" style={{ marginTop: 14, padding: 14 }}>
                    {showSavePack ? (
                      <form onSubmit={submitSaveCurrentSet} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <input
                          type="text"
                          className="input"
                          placeholder="Name your quiz pack..."
                          value={savePackName}
                          onChange={(e) => setSavePackName(e.target.value)}
                          maxLength={60}
                          autoFocus
                          style={{ flex: '1 1 180px', minWidth: 0, margin: 0, padding: '8px 12px' }}
                        />
                        <button type="submit" className="btn btn-success" disabled={!savePackName.trim() || savingPack} style={{ padding: '8px 16px', fontSize: '0.88rem' }}>
                          {savingPack ? 'Saving...' : '💾 Save'}
                        </button>
                        <button type="button" className="btn btn-secondary" onClick={() => setShowSavePack(false)} style={{ padding: '8px 14px', fontSize: '0.88rem' }}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-success"
                          onClick={openSavePackInput}
                          style={{ flex: '1 1 190px' }}
                        >
                          💾 Save Current Quiz
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => downloadJsonPack(room?.gameName || 'finnival-pack', questions)}
                          style={{ flex: '1 1 160px' }}
                        >
                          📤 Export (.json)
                        </button>
                      </div>
                    )}
                    {saveMsg && (
                      <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(61,190,139,0.16)', color: 'var(--indigo-deep)', fontWeight: 700, fontSize: '0.88rem' }}>
                        {saveMsg}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <motion.button
              type="button"
              className="btn btn-success"
              onClick={startGame}
              disabled={questions.length === 0}
              whileHover={questions.length === 0 ? undefined : { scale: 1.02, y: -2 }}
              whileTap={questions.length === 0 ? undefined : { scale: 0.97, y: 1 }}
              animate={questions.length > 0 && (room?.players?.length || 0) > 0 ? { boxShadow: ['0 4px 0 var(--indigo-deep)', '0 4px 0 var(--indigo-deep), 0 0 24px rgba(255, 175, 80, 0.7)', '0 4px 0 var(--indigo-deep)'] } : {}}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              style={{ width: '100%', fontSize: '1.3rem', padding: '16px' }}
            >
              {questions.length === 0
                ? 'Add at least 1 question to Start'
                : `🚀 Start Game (${questions.length} Question${questions.length !== 1 ? 's' : ''})`}
            </motion.button>
          </div>
        )}

        {!isHost && (
          <div style={{ marginTop: 28, textAlign: 'center' }}>
            <p style={{ color: 'white', fontSize: '1.2rem', fontWeight: 700 }}>
              Waiting for the host to start the game...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default LobbyScreen;
