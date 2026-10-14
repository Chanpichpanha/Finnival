const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const FILE_PATH = path.join(DATA_DIR, 'question-sets.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readSets() {
  ensureDir();
  try {
    if (fs.existsSync(FILE_PATH)) {
      return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    }
  } catch (e) {
    // corrupted file — start fresh
  }
  return [];
}

function writeSets(sets) {
  ensureDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(sets, null, 2), 'utf8');
}

function listSets() {
  return readSets().map(({ id, name, createdAt, questionCount }) => ({
    id, name, createdAt, questionCount
  }));
}

function getSet(id) {
  return readSets().find((s) => s.id === id) || null;
}

function saveSet(name, questions) {
  const sets = readSets();
  const entry = {
    id: uuidv4(),
    name: String(name || '').slice(0, 60) || 'Untitled',
    createdAt: Date.now(),
    questionCount: questions.length,
    questions
  };
  sets.push(entry);
  writeSets(sets);
  return entry;
}

function deleteSet(id) {
  const sets = readSets();
  const filtered = sets.filter((s) => s.id !== id);
  if (filtered.length === sets.length) return false;
  writeSets(filtered);
  return true;
}

module.exports = { listSets, getSet, saveSet, deleteSet };
