const fs = require('node:fs');
const path = require('node:path');

const CN_NUM = new Map([
  ['一', 1], ['二', 2], ['三', 3], ['四', 4], ['五', 5],
  ['六', 6], ['七', 7], ['八', 8], ['九', 9], ['十', 10]
]);
const GENERATIONS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
const OVERVIEW_COLUMNS = {
  upper: { left: 85, right: 140 },
  current: { left: 140, right: 190 },
  next: { left: 190, right: 365 }
};
const IGNORED_CHILD_TEXT = new Set(['一人', '二人', '三人', '四人', '五人', '六人', '七人', '八人', '九人', '十人', '共五人', '无', '后']);

function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0;
  let unit = 0;
  for (const character of value) {
    const number = CN_NUM.get(character);
    if (!number) continue;
    if (number === 10) {
      total += (unit || 1) * 10;
      unit = 0;
    } else {
      unit = number;
    }
  }
  return total + unit;
}

function normalize(value) {
  return String(value || '')
    .replaceAll('庞', '')
    .replaceAll('o', '')
    .replaceAll('Ｏ', '')
    .replace(/[·、，,（）()？?\s]/g, '');
}

function cleanName(value) {
  return String(value || '').replaceAll('\ue84f', '镏');
}

function textInColumn(words, low, high, left, right) {
  const selected = words
    .filter((word) => word.top >= low && word.top < high && word.x0 >= left && word.x0 < right)
    .sort((a, b) => a.x0 - b.x0);
  return selected.map((word) => word.text).join('') || null;
}

function textLinesInColumn(words, low, high, left, right) {
  const selected = words.filter((word) =>
    word.top >= low && word.top < high && word.x0 >= left && word.x0 < right
  );
  return lineGroups(selected)
    .map((group) => group.words.sort((a, b) => a.x0 - b.x0).map((word) => word.text).join(''))
    .filter(Boolean);
}

function dateFields(words, low, high, left, right) {
  const [birthDate = null, deathDate = null] = textLinesInColumn(words, low, high, left, right);
  return { birthDate, deathDate };
}

function lineGroups(words) {
  const groups = [];
  [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0).forEach((word) => {
    const last = groups.at(-1);
    if (last && Math.abs(word.top - last.top) <= 2.5) last.words.push(word);
    else groups.push({ top: word.top, words: [word] });
  });
  return groups;
}

function generationLevel(value) {
  if (Number.isInteger(value)) return value;
  const text = String(value || '').trim();
  if (text === '上代') return -2;
  if (text === '本代' || text === '零世') return -1;
  if (text === '初代') return 1;
  const match = text.match(/^([一二三四五六七八九十]+)世?$/);
  return match ? chineseNumber(match[1]) : null;
}

function generationLabel(value) {
  if (value === -2) return '上代';
  if (value === -1) return '本代';
  return `${GENERATIONS[value] || value}世`;
}

function previousGeneration(value) {
  if (value === 1) return -1;
  if (value === -1) return -2;
  return value > 1 ? value - 1 : null;
}

function nextGeneration(value) {
  if (value === -2) return -1;
  if (value === -1) return 1;
  return value >= 1 ? value + 1 : null;
}

function generationFromHeading(text) {
  if (/^初代(?:祖)?$/.test(text)) return 1;
  const match = text.match(/^([一二三四五六七八九十百\d]+)世祖$/);
  return match ? chineseNumber(match[1]) : null;
}

function wordsInColumn(words, left, right) {
  return words
    .filter((word) => {
      const center = (word.x0 + word.x1) / 2;
      return center >= left && center < right && word.text !== 'o';
    })
    .sort((a, b) => a.x0 - b.x0);
}

function columnName(words, left, right) {
  return wordsInColumn(words, left, right).map((word) => cleanName(word.text)).join('') || null;
}

function parseAncestorOverview(words, highBoundary) {
  const groups = lineGroups(words);
  const header = groups.find((group) => {
    const text = group.words.map((word) => word.text).join('');
    return text.includes('上代') && text.includes('本代') &&
      (text.includes('下代') || text.includes('初代'));
  });
  if (!header) return [];

  const rows = groups
    .filter((group) => group.top > header.top + 18 && group.top < highBoundary)
    .map((group) => ({
      top: group.top,
      upperName: columnName(group.words, OVERVIEW_COLUMNS.upper.left, OVERVIEW_COLUMNS.upper.right),
      currentName: columnName(group.words, OVERVIEW_COLUMNS.current.left, OVERVIEW_COLUMNS.current.right),
      nextNames: wordsInColumn(group.words, OVERVIEW_COLUMNS.next.left, OVERVIEW_COLUMNS.next.right)
        .map((word) => cleanName(word.text))
        .filter(Boolean)
    }))
    .filter((row) => row.upperName || row.currentName || row.nextNames.length);

  const upperRows = rows.filter((row) => row.upperName);
  const currentRows = rows.filter((row) => row.currentName);
  const records = upperRows.map((row) => ({
    generation: -2,
    name: row.upperName,
    parentLabel: null,
    alias: null,
    birthDate: null,
    spouse: null,
    spouseDate: null,
    children: [],
    notes: null,
    page: 1,
    overview: true
  }));

  currentRows.forEach((row) => {
    const parent = upperRows
      .slice()
      .sort((left, right) => Math.abs(left.top - row.top) - Math.abs(right.top - row.top))[0];
    records.push({
      generation: -1,
      name: row.currentName,
      parentLabel: parent?.upperName || null,
      alias: null,
      birthDate: null,
      spouse: null,
      spouseDate: null,
      children: [],
      notes: null,
      page: 1,
      overview: true
    });
  });

  rows
    .filter((row) => row.nextNames.length)
    .forEach((row) => {
      const parent = currentRows
        .slice()
        .sort((left, right) => Math.abs(left.top - row.top) - Math.abs(right.top - row.top))[0];
      row.nextNames.forEach((name) => records.push({
        generation: 1,
        name,
        parentLabel: parent?.currentName || null,
        alias: null,
        birthDate: null,
        spouse: null,
        spouseDate: null,
        children: [],
        notes: null,
        page: 1,
        overview: true
      }));
    });

  return records;
}

function extractChildren(words) {
  const names = [];
  for (const group of lineGroups(words)) {
    for (const word of group.words.sort((a, b) => a.x0 - b.x0)) {
      const text = word.text;
      if (text === 'o') {
        if (names.length) names[names.length - 1] += 'o';
        continue;
      }
      if (IGNORED_CHILD_TEXT.has(text) || text.startsWith('下落')) continue;
      if (/葬于|迁普|访问祖籍|派者|文林郎|岁贡|地棺|坐东向/.test(text)) continue;
      names.push(text);
    }
  }
  return names;
}

function mergeAnchors(words) {
  const anchors = [];
  [...words].sort((a, b) => a.top - b.top || a.x0 - b.x0).forEach((word) => {
    const last = anchors.at(-1);
    if (last && Math.abs(word.top - last.top) <= 2.5) last.name += word.text;
    else anchors.push({ name: word.text, top: word.top });
  });
  return anchors.filter((anchor) => !IGNORED_CHILD_TEXT.has(anchor.name));
}

function parseStandardSection(words, generation, lowBoundary, highBoundary, carriedParent) {
  const currentWords = words.filter((word) =>
    word.top > lowBoundary && word.top < highBoundary &&
    (word.x0 + word.x1) / 2 >= 140 && (word.x0 + word.x1) / 2 < 190 && word.text !== 'o'
  );
  const anchors = mergeAnchors(currentWords);
  const parentWords = words
    .filter((word) => word.top > lowBoundary && word.top < highBoundary && (word.x0 + word.x1) / 2 >= 90 && (word.x0 + word.x1) / 2 < 135 && word.text !== 'o')
    .sort((a, b) => a.top - b.top);

  return anchors.map((anchor, index) => {
    const marked = words.some((word) => word.text === 'o' && Math.abs(word.top - anchor.top) <= 2.5 && (word.x0 + word.x1) / 2 >= 140 && (word.x0 + word.x1) / 2 < 200);
    const parentWord = parentWords.length
      ? parentWords.reduce((nearest, word) => Math.abs(word.top - anchor.top) < Math.abs(nearest.top - anchor.top) ? word : nearest)
      : null;
    const low = index === 0 ? lowBoundary : (anchors[index - 1].top + anchor.top) / 2;
    const high = index === anchors.length - 1 ? highBoundary : (anchor.top + anchors[index + 1].top) / 2;
    const personDates = dateFields(words, low, high, 235, 380);
    const spouseDates = dateFields(words, low, high, 490, 575);
    return {
      generation,
      name: anchor.name + (marked ? 'o' : ''),
      parentLabel: parentWord?.text || carriedParent || null,
      alias: textInColumn(words, low, high, 195, 250),
      birthDate: personDates.birthDate,
      deathDate: personDates.deathDate,
      spouse: textInColumn(words, low, high, 390, 465),
      spouseDate: spouseDates.birthDate,
      spouseDeathDate: spouseDates.deathDate,
      children: extractChildren(words.filter((word) => word.top >= low && word.top < high && word.x0 >= 590 && word.x0 < 735)),
      notes: textInColumn(words, low, high, 735, 800)
    };
  });
}

function parseFirstGeneration(words, headingTop, highBoundary) {
  const anchors = mergeAnchors(words.filter((word) => word.top > headingTop + 42 && word.top < highBoundary && (word.x0 + word.x1) / 2 >= 140 && (word.x0 + word.x1) / 2 < 190 && word.text !== 'o'));
  return anchors.slice(0, 1).map((anchor) => {
    const low = anchor.top - 14;
    const high = Math.min(highBoundary, anchor.top + 25);
    return {
      generation: 1,
      name: anchor.name,
      parentLabel: textInColumn(words, low, high, 90, 135),
      alias: null,
      birthDate: null,
      deathDate: null,
      spouse: textInColumn(words, low, high, 195, 250),
      spouseDate: null,
      spouseDeathDate: null,
      children: extractChildren(words.filter((word) => word.top >= low && word.top < high && word.x0 >= 250 && word.x0 < 390)),
      notes: textInColumn(words, low, high, 440, 800)
    };
  });
}

async function extractPages(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const words = content.items
      .filter((item) => item.str?.trim())
      .map((item) => {
        const transform = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.abs(transform[3]) || item.height || 0;
        return { text: item.str.trim(), x0: transform[4], x1: transform[4] + item.width, top: transform[5] - height };
      });
    pages.push({ height: viewport.height, words });
  }
  return pages;
}

async function parseRecords(pdfPath) {
  const records = [];
  const carried = new Map();
  const pages = await extractPages(pdfPath);
  pages.forEach((page, pageIndex) => {
    const headings = page.words
      .map((word) => ({ top: word.top, generation: generationFromHeading(word.text) }))
      .filter((heading) => heading.generation > 0)
      .sort((a, b) => a.top - b.top);
    if (pageIndex === 0 && headings[0]) {
      records.push(...parseAncestorOverview(page.words, headings[0].top - 12));
    }
    headings.forEach((heading, index) => {
      const high = headings[index + 1]?.top ?? page.height - 38;
      const bodyLow = heading.top + 48;
      const section = heading.generation === 1
        ? parseFirstGeneration(page.words, heading.top, high)
        : parseStandardSection(page.words, heading.generation, bodyLow, high, carried.get(heading.generation));
      section.forEach((record) => { record.page = pageIndex + 1; });
      records.push(...section);
      const parents = page.words.filter((word) => word.top > bodyLow && word.top < high && (word.x0 + word.x1) / 2 >= 90 && (word.x0 + word.x1) / 2 < 135 && word.text !== 'o');
      if (parents.length) carried.set(heading.generation, parents.at(-1).text);
    });
  });
  if (!records.length) throw new Error('未识别到“世祖”表格，请确认 PDF 与 sourceData 中的世系表版式一致');
  return records;
}

function mergeOverviewRecords(records) {
  const detailedByIdentity = new Map();
  records
    .filter((record) => !record.overview)
    .forEach((record) => {
      const key = `${generationLevel(record.generation)}:${normalize(cleanName(record.name))}`;
      if (!detailedByIdentity.has(key)) detailedByIdentity.set(key, record);
    });

  records.filter((record) => record.overview).forEach((overview) => {
    const key = `${generationLevel(overview.generation)}:${normalize(cleanName(overview.name))}`;
    const detailed = detailedByIdentity.get(key);
    if (!detailed) return;
    detailed.parentLabel ||= overview.parentLabel;
    detailed.children = [...new Set([...(overview.children || []), ...(detailed.children || [])])];
    for (const field of ['alias', 'birthDate', 'deathDate', 'spouse', 'spouseDate', 'spouseDeathDate', 'notes']) {
      if (!detailed[field] && overview[field]) detailed[field] = overview[field];
    }
  });

  return records.filter((record) => {
    if (!record.overview) return true;
    const key = `${generationLevel(record.generation)}:${normalize(cleanName(record.name))}`;
    return !detailedByIdentity.has(key);
  });
}

function makeTree(records) {
  records = mergeOverviewRecords(records);
  const byIdentity = new Map();
  records.forEach((record, index) => {
    record.recordId = index;
    record.generation = generationLevel(record.generation);
    if (record.generation === null) throw new Error(`无法识别世系：${record.name}`);
    record.name = cleanName(record.name);
    record.children = (record.children || []).map(cleanName);
    record.normalizedName = normalize(record.name);
    record.normalizedAlias = normalize(record.alias);
    record.normalizedParent = normalize(record.parentLabel);
    for (const identity of new Set([record.normalizedName, record.normalizedAlias].filter(Boolean))) {
      const key = `${record.generation}:${identity}`;
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(record);
    }
  });

  const parentOf = new Map();
  const childrenOf = new Map();
  const attach = (parent, child) => {
    parentOf.set(child.recordId, parent.recordId);
    if (!childrenOf.has(parent.recordId)) childrenOf.set(parent.recordId, []);
    childrenOf.get(parent.recordId).push(child);
  };
  records.forEach((record) => {
    const parentGeneration = previousGeneration(record.generation);
    if (parentGeneration === null || !record.normalizedParent) return;
    const candidates = records.filter((candidate) => candidate.generation === parentGeneration && (candidate.normalizedName === record.normalizedParent || normalize(candidate.alias) === record.normalizedParent));
    candidates.sort((a, b) => Math.abs(a.recordId - record.recordId) - Math.abs(b.recordId - record.recordId));
    if (candidates[0]) attach(candidates[0], record);
  });
  records.forEach((record) => {
    record.children.forEach((childName) => {
      const normalized = normalize(childName);
      const childGeneration = nextGeneration(record.generation);
      if (childGeneration === null) return;
      let candidates = (byIdentity.get(`${childGeneration}:${normalized}`) || []).filter((candidate) => !parentOf.has(candidate.recordId));
      if (!candidates.length) candidates = records.filter((candidate) =>
        candidate.generation === childGeneration &&
        !parentOf.has(candidate.recordId) &&
        (candidate.normalizedName.endsWith(normalized) || candidate.normalizedAlias.endsWith(normalized))
      );
      candidates.sort((a, b) => Math.abs(a.recordId - record.recordId) - Math.abs(b.recordId - record.recordId));
      if (candidates[0]) attach(record, candidates[0]);
    });
  });

  const personIds = new Map(records.map((record, index) => [record.recordId, index + 1]));
  const spouseRecords = records.filter((record) => record.spouse);
  const spouseIds = new Map(spouseRecords.map((record, index) => [record.recordId, records.length + index + 1]));
  const visiting = new Set();
  function item(record, parentId = null) {
    if (visiting.has(record.recordId)) return null;
    visiting.add(record.recordId);
    const personId = personIds.get(record.recordId);
    const rawName = cleanName(record.name);
    const markedFemale = /[oＯ]$/.test(rawName);
    let childItems = (childrenOf.get(record.recordId) || []).map((child) => item(child, personId)).filter(Boolean);
    if (record.spouse) {
      const spouseName = cleanName(record.spouse).replace(/[oＯ]$/, '');
      childItems = [{
        id: spouseIds.get(record.recordId), pId: personId, generation: generationLabel(record.generation),
        name: spouseName, alias: null, birthDate: record.spouseDate || null,
        deathDate: record.spouseDeathDate || null, notes: null,
        sex: markedFemale ? '男' : '女', type: '配偶', chirdrensList: childItems.length ? childItems : null
      }];
    }
    visiting.delete(record.recordId);
    return {
      id: personId, pId: parentId, generation: generationLabel(record.generation),
      name: rawName.replace(/[oＯ]$/, ''), alias: record.alias || null, birthDate: record.birthDate || null,
      deathDate: record.deathDate || null, notes: record.notes || null, sex: markedFemale ? '女' : '男', type: '宗亲',
      chirdrensList: childItems.length ? childItems : null
    };
  }
  return records.filter((record) => !parentOf.has(record.recordId)).map((record) => item(record)).filter(Boolean);
}

async function convertPdfToJson(pdfPath, outputDirectory) {
  if (path.extname(pdfPath).toLowerCase() !== '.pdf') throw new TypeError('只能导入 PDF 文件');
  const records = await parseRecords(pdfPath);
  const tree = makeTree(records);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, `${path.basename(pdfPath, path.extname(pdfPath))}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
  return { outputPath, rootCount: tree.length, recordCount: records.length };
}

module.exports = { convertPdfToJson };
