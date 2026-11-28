const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'question-sets.json');
const SAMPLE_PACK_PATH = path.join(__dirname, '..', 'sample-quiz-pack.json');

let pool = null;

function isUsingDb() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
}

function getPool() {
  if (!isUsingDb()) return null;
  if (!pool) {
    const connStr = process.env.DATABASE_URL.trim();
    const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');
    pool = new Pool({
      connectionString: connStr,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 10
    });
  }
  return pool;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonSets() {
  ensureDir();
  try {
    if (fs.existsSync(FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    // corrupted file — start fresh
  }
  return [];
}

function writeJsonSets(sets) {
  ensureDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(sets, null, 2), 'utf8');
}

function mapDbRow(row) {
  return {
    id: row.id,
    ownerId: row.owner_id || null,
    isPublic: Boolean(row.is_public),
    name: row.name,
    createdAt: Number(row.created_at) || Date.now(),
    questionCount: Number(row.question_count) || (Array.isArray(row.questions) ? row.questions.length : 0),
    questions: Array.isArray(row.questions) ? row.questions : []
  };
}

function loadStarterPack() {
  try {
    if (!fs.existsSync(SAMPLE_PACK_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(SAMPLE_PACK_PATH, 'utf8'));
    if (raw && Array.isArray(raw.questions) && raw.questions.length > 0) {
      return {
        name: String(raw.name || 'Finnival Starter Pack').slice(0, 60),
        questions: raw.questions
      };
    }
  } catch (e) {
    // ignore invalid starter pack
  }
  return null;
}

/**
 * Initializes Postgres tables when DATABASE_URL is configured, or ensures local JSON directory exists.
 */
async function initStorage() {
  if (!isUsingDb()) {
    ensureDir();
    return { mode: 'json' };
  }

  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS question_sets (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      name TEXT NOT NULL,
      question_count INTEGER NOT NULL,
      questions JSONB NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_question_sets_owner ON question_sets(owner_id);`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS uploaded_images (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_hidden_sets (
      user_id TEXT NOT NULL,
      set_id TEXT NOT NULL,
      PRIMARY KEY (user_id, set_id)
    );
  `);

  const countRes = await db.query('SELECT COUNT(*)::int AS total FROM question_sets');
  if (countRes.rows[0]?.total === 0) {
    const starter = loadStarterPack();
    if (starter) {
      await db.query(
        `INSERT INTO question_sets (id, owner_id, is_public, name, question_count, questions, created_at)
         VALUES ($1, NULL, TRUE, $2, $3, $4::jsonb, $5)`,
        [uuidv4(), starter.name, starter.questions.length, JSON.stringify(starter.questions), Date.now()]
      );
    }
  }

  return { mode: 'postgres' };
}

/**
 * Lists quiz packs visible to the given user.
 */
async function listSets({ userId = null, authEnabled = false } = {}) {
  if (isUsingDb()) {
    const db = getPool();
    let res;
    if (!authEnabled) {
      res = await db.query(
        'SELECT id, owner_id, is_public, name, created_at, question_count FROM question_sets ORDER BY created_at DESC'
      );
    } else if (userId) {
      res = await db.query(
        `SELECT q.id, q.owner_id, q.is_public, q.name, q.created_at, q.question_count
         FROM question_sets q
         WHERE (q.owner_id = $1 OR q.is_public = TRUE)
           AND NOT EXISTS (
             SELECT 1 FROM user_hidden_sets h WHERE h.user_id = $1 AND h.set_id = q.id
           )
         ORDER BY q.is_public ASC, q.created_at DESC`,
        [userId]
      );
    } else {
      res = await db.query(
        `SELECT id, owner_id, is_public, name, created_at, question_count
         FROM question_sets
         WHERE is_public = TRUE
         ORDER BY created_at DESC`
      );
    }

    return res.rows.map((row) => {
      const isPublic = Boolean(row.is_public);
      const isOwner = !authEnabled || Boolean(userId && row.owner_id === userId);
      return {
        id: row.id,
        name: row.name,
        createdAt: Number(row.created_at) || Date.now(),
        questionCount: Number(row.question_count) || 0,
        isPublic,
        isOwner,
        canDelete: !authEnabled || Boolean(userId && (isOwner || isPublic))
      };
    });
  }

  const sets = readJsonSets();
  return sets
    .filter((s) => {
      if (!authEnabled) return true;
      if (s.isPublic) {
        return !(userId && Array.isArray(s.hiddenBy) && s.hiddenBy.includes(userId));
      }
      return Boolean(userId && s.ownerId === userId);
    })
    .map((s) => {
      const isPublic = Boolean(s.isPublic);
      const isOwner = !authEnabled || Boolean(userId && s.ownerId === userId);
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        questionCount: s.questionCount,
        isPublic,
        isOwner,
        canDelete: !authEnabled || Boolean(userId && (isOwner || isPublic))
      };
    });
}

/**
 * Fetches one quiz pack with owner/public enforcement when authEnabled is true.
 */
async function getSet(id, { userId = null, authEnabled = false } = {}) {
  let set = null;
  if (isUsingDb()) {
    const db = getPool();
    const res = await db.query('SELECT * FROM question_sets WHERE id = $1 LIMIT 1', [id]);
    if (res.rows[0]) set = mapDbRow(res.rows[0]);
  } else {
    const found = readJsonSets().find((s) => s.id === id);
    if (found) {
      set = {
        ...found,
        ownerId: found.ownerId || null,
        isPublic: Boolean(found.isPublic)
      };
    }
  }

  if (!set) return null;
  if (authEnabled && !set.isPublic && (!userId || set.ownerId !== userId)) {
    return { forbidden: true };
  }
  return {
    id: set.id,
    name: set.name,
    createdAt: set.createdAt,
    questionCount: set.questionCount,
    questions: set.questions,
    isPublic: set.isPublic,
    isOwner: !authEnabled || Boolean(userId && set.ownerId === userId)
  };
}

/**
 * Saves a quiz pack owned by the authenticated user (or public/local in unauthenticated dev mode).
 */
async function saveSet(name, questions, { userId = null } = {}) {
  const entry = {
    id: uuidv4(),
    ownerId: userId || null,
    isPublic: false,
    name: String(name || '').slice(0, 60) || 'Untitled',
    createdAt: Date.now(),
    questionCount: questions.length,
    questions
  };

  if (isUsingDb()) {
    const db = getPool();
    await db.query(
      `INSERT INTO question_sets (id, owner_id, is_public, name, question_count, questions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [entry.id, entry.ownerId, entry.isPublic, entry.name, entry.questionCount, JSON.stringify(questions), entry.createdAt]
    );
    return entry;
  }

  const sets = readJsonSets();
  sets.push(entry);
  writeJsonSets(sets);
  return entry;
}

/**
 * Deletes a user's private quiz pack, or hides a public starter pack for that user.
 */
async function deleteSet(id, { userId = null, authEnabled = false } = {}) {
  if (isUsingDb()) {
    const db = getPool();
    const res = await db.query('SELECT id, owner_id, is_public FROM question_sets WHERE id = $1 LIMIT 1', [id]);
    const row = res.rows[0];
    if (!row) return { ok: false, reason: 'not_found' };
    if (authEnabled && row.is_public) {
      if (!userId) return { ok: false, reason: 'forbidden' };
      await db.query(
        'INSERT INTO user_hidden_sets (user_id, set_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, id]
      );
      return { ok: true, hiddenForUser: true };
    }
    if (authEnabled && (!userId || row.owner_id !== userId)) {
      return { ok: false, reason: 'forbidden' };
    }
    await db.query('DELETE FROM user_hidden_sets WHERE set_id = $1', [id]);
    await db.query('DELETE FROM question_sets WHERE id = $1', [id]);
    return { ok: true };
  }

  const sets = readJsonSets();
  const target = sets.find((s) => s.id === id);
  if (!target) return { ok: false, reason: 'not_found' };
  if (authEnabled && target.isPublic) {
    if (!userId) return { ok: false, reason: 'forbidden' };
    const next = sets.map((s) => {
      if (s.id !== id) return s;
      const hiddenBy = Array.isArray(s.hiddenBy) ? s.hiddenBy : [];
      return hiddenBy.includes(userId) ? s : { ...s, hiddenBy: [...hiddenBy, userId] };
    });
    writeJsonSets(next);
    return { ok: true, hiddenForUser: true };
  }
  if (authEnabled && (!userId || target.ownerId !== userId)) {
    return { ok: false, reason: 'forbidden' };
  }
  const filtered = sets.filter((s) => s.id !== id);
  writeJsonSets(filtered);
  return { ok: true };
}

/**
 * Collects every `/uploads/<filename>` basename referenced across all stored quiz packs.
 */
async function listReferencedImages() {
  const referenced = new Set();
  const collect = (questions) => {
    (questions || []).forEach((q) => {
      const img = q?.imageUrl || q?.image;
      if (typeof img === 'string' && img.startsWith('/uploads/')) {
        referenced.add(path.basename(img));
      }
    });
  };

  if (isUsingDb()) {
    const db = getPool();
    const res = await db.query('SELECT questions FROM question_sets');
    res.rows.forEach((row) => collect(row.questions));
    return referenced;
  }

  readJsonSets().forEach((s) => collect(s.questions));
  return referenced;
}

async function saveUploadedImage(filename, mimeType, buffer) {
  if (!isUsingDb() || !buffer) return;
  const db = getPool();
  await db.query(
    `INSERT INTO uploaded_images (filename, mime_type, data, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (filename) DO NOTHING`,
    [filename, mimeType || 'application/octet-stream', buffer, Date.now()]
  );
}

async function getUploadedImage(filename) {
  if (!isUsingDb()) return null;
  const db = getPool();
  const res = await db.query(
    'SELECT mime_type, data FROM uploaded_images WHERE filename = $1 LIMIT 1',
    [filename]
  );
  return res.rows[0] || null;
}

async function purgeDbOrphanImages(referencedSet, gracePeriodMs) {
  if (!isUsingDb()) return 0;
  const db = getPool();
  const cutoff = Date.now() - gracePeriodMs;
  const res = await db.query('SELECT filename, created_at FROM uploaded_images WHERE created_at < $1', [cutoff]);
  const stale = res.rows.map((r) => r.filename).filter((name) => !referencedSet.has(name));
  if (stale.length === 0) return 0;
  await db.query('DELETE FROM uploaded_images WHERE filename = ANY($1::text[])', [stale]);
  return stale.length;
}

module.exports = {
  isUsingDb,
  initStorage,
  listSets,
  getSet,
  saveSet,
  deleteSet,
  listReferencedImages,
  saveUploadedImage,
  getUploadedImage,
  purgeDbOrphanImages
};
