const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MAX_PAGE_SIZE = 100;
const PERSON_FIELDS = [
  'parentId',
  'generation',
  'name',
  'alias',
  'birthDate',
  'deathDate',
  'notes',
  'sex',
  'type'
];

function generationNumber(generation) {
  const values = {
    上代: -2, 本代: -1, 零世: -1,
    一世: 1, 二世: 2, 三世: 3, 四世: 4, 五世: 5,
    六世: 6, 七世: 7, 八世: 8, 九世: 9, 十世: 10,
    十一世: 11, 十二世: 12, 十三世: 13, 十四世: 14, 十五世: 15,
    十六世: 16, 十七世: 17, 十八世: 18, 十九世: 19, 二十世: 20
  };
  return values[generation] ?? null;
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} 必须是正整数`);
  }
  return number;
}

function validatePerson(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('人物数据格式无效');
  }

  const result = {};
  for (const field of PERSON_FIELDS) {
    if (partial && !(field in input)) continue;
    result[field] = input[field];
  }

  if (!partial || 'parentId' in result) {
    result.parentId = result.parentId === null || result.parentId === undefined
      ? null
      : positiveInteger(result.parentId, 'parentId');
  }
  if (!partial || 'generation' in result) {
    if (typeof result.generation !== 'string' || !result.generation.trim()) {
      throw new TypeError('generation 不能为空');
    }
    result.generation = result.generation.trim();
  }
  if (!partial || 'name' in result) {
    if (typeof result.name !== 'string' || !result.name.trim()) {
      throw new TypeError('name 不能为空');
    }
    result.name = result.name.trim();
  }
  for (const field of ['alias', 'birthDate', 'deathDate', 'notes']) {
    if (!partial || field in result) result[field] = nullableText(result[field]);
  }
  if (!partial || 'sex' in result) {
    result.sex = result.sex ?? '男';
    if (!['男', '女'].includes(result.sex)) throw new TypeError('sex 只能是男或女');
  }
  if (!partial || 'type' in result) {
    result.type = result.type ?? '宗亲';
    if (!['宗亲', '配偶'].includes(result.type)) throw new TypeError('type 只能是宗亲或配偶');
  }

  return result;
}

function mapLineageRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    fileName: row.fileName,
    total: Number(row.total),
    relatives: Number(row.relatives),
    spouses: Number(row.spouses),
    generationStart: row.generationStart,
    generationEnd: row.generationEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapPersonRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    lineageId: Number(row.lineageId),
    sourceId: row.sourceId === null ? null : Number(row.sourceId),
    parentId: row.parentId === null ? null : Number(row.parentId),
    generation: row.generation,
    generationNumber: row.generationNumber === null ? null : Number(row.generationNumber),
    name: row.name,
    alias: row.alias,
    birthDate: row.birthDate,
    deathDate: row.deathDate,
    notes: row.notes,
    sex: row.sex,
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function createDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS lineages (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      file_name TEXT UNIQUE,
      source_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY,
      lineage_id INTEGER NOT NULL REFERENCES lineages(id) ON DELETE CASCADE,
      source_id INTEGER,
      parent_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
      generation TEXT NOT NULL,
      generation_number INTEGER,
      name TEXT NOT NULL,
      alias TEXT,
      birth_date TEXT,
      death_date TEXT,
      notes TEXT,
      sex TEXT NOT NULL DEFAULT '男' CHECK (sex IN ('男', '女')),
      person_type TEXT NOT NULL DEFAULT '宗亲' CHECK (person_type IN ('宗亲', '配偶')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;

    CREATE INDEX IF NOT EXISTS persons_lineage_idx ON persons(lineage_id);
    CREATE INDEX IF NOT EXISTS persons_parent_idx ON persons(parent_id);
    CREATE INDEX IF NOT EXISTS persons_generation_idx ON persons(lineage_id, generation_number);
    CREATE INDEX IF NOT EXISTS persons_name_idx ON persons(lineage_id, name);
    CREATE INDEX IF NOT EXISTS persons_type_idx ON persons(lineage_id, person_type);

    CREATE TRIGGER IF NOT EXISTS persons_parent_lineage_insert
    BEFORE INSERT ON persons
    WHEN NEW.parent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM persons parent
        WHERE parent.id = NEW.parent_id AND parent.lineage_id = NEW.lineage_id
      )
    BEGIN
      SELECT RAISE(ABORT, '父级人物必须属于同一世系');
    END;

    CREATE TRIGGER IF NOT EXISTS persons_parent_lineage_update
    BEFORE UPDATE OF parent_id, lineage_id ON persons
    WHEN NEW.parent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM persons parent
        WHERE parent.id = NEW.parent_id AND parent.lineage_id = NEW.lineage_id
      )
    BEGIN
      SELECT RAISE(ABORT, '父级人物必须属于同一世系');
    END;

    CREATE TRIGGER IF NOT EXISTS persons_touch_lineage_insert
    AFTER INSERT ON persons
    BEGIN
      UPDATE lineages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.lineage_id;
    END;

    CREATE TRIGGER IF NOT EXISTS persons_touch_lineage_update
    AFTER UPDATE ON persons
    BEGIN
      UPDATE lineages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.lineage_id;
    END;

    CREATE TRIGGER IF NOT EXISTS persons_touch_lineage_delete
    AFTER DELETE ON persons
    BEGIN
      UPDATE lineages SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.lineage_id;
    END;

    PRAGMA user_version = 1;
  `);

  const insertLineage = database.prepare(`
    INSERT INTO lineages (name, file_name, source_hash) VALUES (?, ?, ?)
  `);
  const findLineageByFile = database.prepare(`SELECT id, source_hash AS sourceHash FROM lineages WHERE file_name = ?`);
  const insertPerson = database.prepare(`
    INSERT INTO persons (
      lineage_id, source_id, parent_id, generation, generation_number,
      name, alias, birth_date, death_date, notes, sex, person_type, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function importJsonFile(filePath, { replace = false } = {}) {
    const fileName = path.basename(filePath);
    const name = fileName.replace(/\.json$/i, '');
    const source = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    const tree = JSON.parse(source);
    if (!Array.isArray(tree)) throw new TypeError(`${fileName} 的根节点必须是数组`);

    const existing = findLineageByFile.get(fileName);
    if (existing && !replace) return { lineageId: Number(existing.id), imported: false };

    database.exec('BEGIN IMMEDIATE');
    try {
      let lineageId;
      if (existing) {
        lineageId = Number(existing.id);
        database.prepare('DELETE FROM persons WHERE lineage_id = ?').run(lineageId);
        database.prepare(`
          UPDATE lineages SET name = ?, source_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(name, hash, lineageId);
      } else {
        lineageId = Number(insertLineage.run(name, fileName, hash).lastInsertRowid);
      }

      function insertNodes(nodes, parentId = null) {
        nodes.forEach((node, sortOrder) => {
          const person = validatePerson(node);
          const result = insertPerson.run(
            lineageId,
            Number.isInteger(node.id) ? node.id : null,
            parentId,
            person.generation,
            generationNumber(person.generation),
            person.name,
            person.alias,
            person.birthDate,
            person.deathDate,
            person.notes,
            person.sex,
            person.type,
            sortOrder
          );
          if (Array.isArray(node.chirdrensList)) {
            insertNodes(node.chirdrensList, Number(result.lastInsertRowid));
          }
        });
      }

      insertNodes(tree);
      database.exec('COMMIT');
      return { lineageId, imported: true };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function importDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) return [];
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((entry) => importJsonFile(path.join(directoryPath, entry.name)));
  }

  function listLineages() {
    return database.prepare(`
      SELECT
        l.id,
        l.name,
        l.file_name AS fileName,
        COUNT(p.id) AS total,
        SUM(CASE WHEN p.person_type = '宗亲' THEN 1 ELSE 0 END) AS relatives,
        SUM(CASE WHEN p.person_type = '配偶' THEN 1 ELSE 0 END) AS spouses,
        MIN(p.generation_number) AS generationStart,
        MAX(p.generation_number) AS generationEnd,
        l.created_at AS createdAt,
        l.updated_at AS updatedAt
      FROM lineages l
      LEFT JOIN persons p ON p.lineage_id = l.id
      GROUP BY l.id
      ORDER BY l.name COLLATE NOCASE
    `).all().map(mapLineageRow);
  }

  function createLineage(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim()) {
      throw new TypeError('世系名称不能为空');
    }
    const name = input.name.trim();
    const result = insertLineage.run(name, nullableText(input.fileName), null);
    return Number(result.lastInsertRowid);
  }

  function updateLineage(id, changes) {
    id = positiveInteger(id, 'id');
    if (!changes || typeof changes.name !== 'string' || !changes.name.trim()) {
      throw new TypeError('世系名称不能为空');
    }
    const name = changes.name.trim();
    const result = database.prepare(`
      UPDATE lineages
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, id);
    if (!result.changes) throw new Error('世系不存在');
    return listLineages().find((lineage) => lineage.id === id) || null;
  }

  function deleteLineage(id) {
    id = positiveInteger(id, 'id');
    database.exec('BEGIN IMMEDIATE');
    try {
      const lineage = database.prepare('SELECT id FROM lineages WHERE id = ?').get(id);
      if (!lineage) throw new Error('世系不存在');
      const result = database.prepare('DELETE FROM lineages WHERE id = ?').run(id);
      database.exec('COMMIT');
      return { deleted: Number(result.changes) };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function listPersons(options = {}) {
    const lineageId = positiveInteger(options.lineageId, 'lineageId');
    const page = Math.max(1, Number.parseInt(options.page, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(options.pageSize, 10) || 50));
    const conditions = ['p.lineage_id = ?'];
    const parameters = [lineageId];

    if (options.generation) {
      conditions.push('p.generation = ?');
      parameters.push(String(options.generation));
    }
    if (['宗亲', '配偶'].includes(options.type)) {
      conditions.push('p.person_type = ?');
      parameters.push(options.type);
    }
    if (['男', '女'].includes(options.sex)) {
      conditions.push('p.sex = ?');
      parameters.push(options.sex);
    }
    const query = nullableText(options.query)?.trim();
    if (query) {
      const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      conditions.push(`(
        p.name LIKE ? ESCAPE '\\' OR p.alias LIKE ? ESCAPE '\\' OR
        p.birth_date LIKE ? ESCAPE '\\' OR p.death_date LIKE ? ESCAPE '\\' OR
        p.notes LIKE ? ESCAPE '\\'
      )`);
      parameters.push(pattern, pattern, pattern, pattern, pattern);
    }

    const where = conditions.join(' AND ');
    const total = Number(database.prepare(`SELECT COUNT(*) AS count FROM persons p WHERE ${where}`).get(...parameters).count);
    const rows = database.prepare(`
      SELECT
        p.id, p.lineage_id AS lineageId, p.source_id AS sourceId,
        p.parent_id AS parentId, p.generation,
        p.generation_number AS generationNumber, p.name, p.alias,
        p.birth_date AS birthDate, p.death_date AS deathDate, p.notes,
        p.sex, p.person_type AS type,
        p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM persons p
      WHERE ${where}
      ORDER BY p.generation_number, p.sort_order, p.id
      LIMIT ? OFFSET ?
    `).all(...parameters, pageSize, (page - 1) * pageSize).map(mapPersonRow);

    return { items: rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  function getPerson(id) {
    return mapPersonRow(database.prepare(`
      SELECT id, lineage_id AS lineageId, source_id AS sourceId, parent_id AS parentId,
        generation, generation_number AS generationNumber, name, alias,
        birth_date AS birthDate, death_date AS deathDate,
        notes, sex, person_type AS type, created_at AS createdAt, updated_at AS updatedAt
      FROM persons WHERE id = ?
    `).get(positiveInteger(id, 'id')));
  }

  function createPerson(input) {
    const lineageId = positiveInteger(input?.lineageId, 'lineageId');
    const person = validatePerson(input);
    const result = insertPerson.run(
      lineageId, null, person.parentId, person.generation, generationNumber(person.generation),
      person.name, person.alias, person.birthDate, person.deathDate, person.notes,
      person.sex, person.type, Number.parseInt(input.sortOrder, 10) || 0
    );
    return getPerson(Number(result.lastInsertRowid));
  }

  function createPersonAbove(input) {
    const lineageId = positiveInteger(input?.lineageId, 'lineageId');
    const childId = positiveInteger(input?.childId, 'childId');
    const person = validatePerson(input);
    const child = database.prepare(`
      SELECT id, lineage_id AS lineageId, parent_id AS parentId, sort_order AS sortOrder
      FROM persons
      WHERE id = ?
    `).get(childId);
    if (!child) throw new Error('人物不存在');
    if (Number(child.lineageId) !== lineageId) throw new Error('人物必须属于同一世系');

    database.exec('BEGIN IMMEDIATE');
    try {
      const result = insertPerson.run(
        lineageId, null, child.parentId, person.generation, generationNumber(person.generation),
        person.name, person.alias, person.birthDate, person.deathDate, person.notes,
        person.sex, person.type, Number.parseInt(child.sortOrder, 10) || 0
      );
      const parentId = Number(result.lastInsertRowid);
      database.prepare(`
        UPDATE persons
        SET parent_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(parentId, childId);
      database.exec('COMMIT');
      return getPerson(parentId);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function updatePerson(id, changes) {
    id = positiveInteger(id, 'id');
    const person = validatePerson(changes, true);
    if ('parentId' in person && person.parentId !== null) {
      const createsCycle = database.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM persons WHERE id = ?
          UNION ALL
          SELECT child.id FROM persons child JOIN subtree parent ON child.parent_id = parent.id
        )
        SELECT 1 AS found FROM subtree WHERE id = ? LIMIT 1
      `).get(id, person.parentId);
      if (createsCycle) throw new Error('上级人物不能选择自己或自己的后代');
    }
    const columns = {
      parentId: 'parent_id', generation: 'generation', name: 'name', alias: 'alias',
      birthDate: 'birth_date', deathDate: 'death_date', notes: 'notes', sex: 'sex', type: 'person_type'
    };
    const entries = Object.entries(person);
    if (!entries.length) return getPerson(id);
    const assignments = entries.map(([field]) => `${columns[field]} = ?`);
    const values = entries.map(([field, value]) => value);
    if ('generation' in person) {
      assignments.push('generation_number = ?');
      values.push(generationNumber(person.generation));
    }
    assignments.push('updated_at = CURRENT_TIMESTAMP');
    const result = database.prepare(`UPDATE persons SET ${assignments.join(', ')} WHERE id = ?`).run(...values, id);
    if (!result.changes) throw new Error('人物不存在');
    return getPerson(id);
  }

  function deletePerson(id) {
    id = positiveInteger(id, 'id');
    database.exec('BEGIN IMMEDIATE');
    try {
      const descendants = database.prepare(`
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM persons WHERE id = ?
          UNION ALL
          SELECT p.id FROM persons p JOIN subtree s ON p.parent_id = s.id
        ) SELECT id FROM subtree
      `).all(id).map((row) => Number(row.id));
      if (!descendants.length) throw new Error('人物不存在');
      const statement = database.prepare('DELETE FROM persons WHERE id = ?');
      descendants.reverse().forEach((personId) => statement.run(personId));
      database.exec('COMMIT');
      return { deleted: descendants.length };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    close: () => {
      // Consolidate WAL pages before closing so a copied project keeps a
      // self-contained SQLite file (the -wal/-shm files are still supported).
      try {
        database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        database.close();
      }
    },
    importDirectory,
    importJsonFile,
    listLineages,
    createLineage,
    updateLineage,
    deleteLineage,
    listPersons,
    getPerson,
    createPerson,
    createPersonAbove,
    updatePerson,
    deletePerson
  };
}

module.exports = { createDatabase };
