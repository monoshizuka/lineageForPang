import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  Packer,
  PageOrientation,
  Paragraph,
  SectionType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
} from "docx";

const GENERATION_NAMES = [
  "零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
];
const RANGES = [
  { start: 1, end: 5, label: "一世至五世" },
  { start: 4, end: 10, label: "四世至十世" },
  { start: 9, end: 15, label: "九世至十五世" },
];
const LEAVES_PER_PAGE = 15;
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 420;
const TABLE_WIDTH = PAGE_HEIGHT - PAGE_MARGIN * 2;

function generationNumber(generation) {
  if (typeof generation === "number") return generation;
  if (generation === "上代") return -2;
  if (generation === "本代" || generation === "零世") return -1;
  const name = String(generation || "").replace(/世$/, "");
  const index = GENERATION_NAMES.indexOf(name);
  return index > 0 ? index : 999;
}

function personOrder(a, b) {
  return generationNumber(a.generation) - generationNumber(b.generation) ||
    String(a.id).localeCompare(String(b.id), "zh-CN", { numeric: true });
}

function buildRangeTree(persons, range) {
  const allById = new Map(persons.map((person) => [person.id, person]));
  const nodes = persons
    .filter((person) => {
      const generation = generationNumber(person.generation);
      return person.type === "宗亲" && generation >= range.start && generation <= range.end;
    })
    .sort(personOrder);
  const includedIds = new Set(nodes.map((person) => person.id));
  const parentById = new Map();

  nodes.forEach((person) => {
    let parentId = person.parentId;
    const visited = new Set([person.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = allById.get(parentId);
      if (!parent) break;
      if (parent.type === "宗亲") {
        if (includedIds.has(parent.id)) parentById.set(person.id, parent.id);
        break;
      }
      parentId = parent.parentId;
    }
  });

  const childrenById = new Map(nodes.map((person) => [person.id, []]));
  nodes.forEach((person) => {
    const parentId = parentById.get(person.id);
    if (parentId !== undefined) childrenById.get(parentId)?.push(person);
  });
  childrenById.forEach((children) => children.sort(personOrder));
  const roots = nodes.filter((person) => !parentById.has(person.id)).sort(personOrder);
  return {
    nodes,
    roots,
    parentById,
    childrenById,
    byId: new Map(nodes.map((node) => [node.id, node])),
  };
}

function orderedLeaves(tree) {
  const leaves = [];
  const visited = new Set();
  function walk(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const children = tree.childrenById.get(node.id) || [];
    if (!children.length) leaves.push(node);
    else children.forEach(walk);
  }
  tree.roots.forEach(walk);
  tree.nodes.forEach((node) => {
    if (!visited.has(node.id)) walk(node);
  });
  return leaves;
}

function buildPath(tree, leaf, range) {
  const path = Array(range.end - range.start + 1).fill(null);
  let current = leaf;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const generation = generationNumber(current.generation);
    if (generation >= range.start && generation <= range.end) {
      path[generation - range.start] = current;
    }
    current = tree.byId.get(tree.parentById.get(current.id));
  }
  return path;
}

function mergeKey(path, columnIndex) {
  const person = path[columnIndex];
  if (!person) return null;
  return path
    .slice(0, columnIndex + 1)
    .map((ancestor) => (ancestor ? String(ancestor.id) : ""))
    .join("/");
}

function rowSpanAt(paths, rowIndex, columnIndex) {
  const key = mergeKey(paths[rowIndex], columnIndex);
  if (!key) return 1;
  if (rowIndex > 0 && mergeKey(paths[rowIndex - 1], columnIndex) === key) return 0;
  let span = 1;
  while (
    rowIndex + span < paths.length &&
    mergeKey(paths[rowIndex + span], columnIndex) === key
  ) {
    span += 1;
  }
  return span;
}

function buildExportPages(persons) {
  const pages = [];
  RANGES.forEach((range) => {
    const tree = buildRangeTree(persons, range);
    if (!tree.nodes.length) return;
    const leaves = orderedLeaves(tree);
    const rangePages = Math.ceil(leaves.length / LEAVES_PER_PAGE);
    for (let index = 0; index < rangePages; index += 1) {
      const leavesOnPage = leaves.slice(index * LEAVES_PER_PAGE, (index + 1) * LEAVES_PER_PAGE);
      pages.push({
        range,
        rangePage: index + 1,
        rangePages,
        paths: leavesOnPage.map((leaf) => buildPath(tree, leaf, range)),
      });
    }
  });
  return pages;
}

const TABLE_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function branchPrefix(paths, rowIndex, columnIndex) {
  if (columnIndex === 0 || !paths[rowIndex][columnIndex]) return "";
  const parentId = paths[rowIndex][columnIndex - 1]?.id;
  if (parentId === undefined) return "";
  const siblingIds = [];
  paths.forEach((path) => {
    if (path[columnIndex - 1]?.id !== parentId || !path[columnIndex]) return;
    if (!siblingIds.includes(path[columnIndex].id)) siblingIds.push(path[columnIndex].id);
  });
  if (siblingIds.length <= 1) return "── ";
  const index = siblingIds.indexOf(paths[rowIndex][columnIndex].id);
  if (index === 0) return "┌─ ";
  if (index === siblingIds.length - 1) return "└─ ";
  return "├─ ";
}

function cellParagraph(text, { bold = false, color = "252B24", size = 20, center = false } = {}) {
  return new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({
      text: String(text ?? ""), bold, color, size,
      font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" },
    })],
  });
}

function buildTable(exportPage) {
  const columnCount = exportPage.range.end - exportPage.range.start + 1;
  const baseWidth = Math.floor(TABLE_WIDTH / columnCount);
  const columnWidths = Array(columnCount).fill(baseWidth);
  columnWidths[columnCount - 1] += TABLE_WIDTH - baseWidth * columnCount;

  const headerCells = columnWidths.map((width, index) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      margins: { top: 90, bottom: 90, left: 80, right: 80 },
      borders: {
        bottom: { style: BorderStyle.SINGLE, size: 8, color: "B9A98F" },
      },
      children: [
        cellParagraph(`${GENERATION_NAMES[exportPage.range.start + index]}世`, {
          bold: true,
          color: "6F5834",
          size: 21,
          center: true,
        }),
      ],
    })
  );
  const rows = [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      height: { value: 450, rule: HeightRule.ATLEAST },
      children: headerCells,
    }),
  ];

  exportPage.paths.forEach((path, rowIndex) => {
    const cells = [];
    path.forEach((person, columnIndex) => {
      const rowSpan = rowSpanAt(exportPage.paths, rowIndex, columnIndex);
      if (rowSpan === 0) return;
      cells.push(
        new TableCell({
          width: { size: columnWidths[columnIndex], type: WidthType.DXA },
          rowSpan,
          verticalAlign: VerticalAlignTable.CENTER,
          margins: { top: 85, bottom: 85, left: 80, right: 80 },
          children: [
            cellParagraph(
              person
                ? `${branchPrefix(exportPage.paths, rowIndex, columnIndex)}${person.name || "未命名"}`
                : ""
            ),
          ],
        })
      );
    });
    rows.push(
      new TableRow({
        cantSplit: true,
        height: { value: 480, rule: HeightRule.ATLEAST },
        children: cells,
      })
    );
  });

  return new Table({
    rows,
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: TABLE_BORDERS,
  });
}

function titleParagraph(lineageName) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({
        text: `${lineageName || "世系"}世系图`,
        bold: true,
        size: 32,
        color: "252B24",
        font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" },
      }),
    ],
  });
}

function subtitleParagraph(exportPage, pageNumber, totalPages) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 140 },
    children: [
      new TextRun({
        text: `${exportPage.range.label} · 本区间第 ${exportPage.rangePage}/${exportPage.rangePages} 页 · 总第 ${pageNumber}/${totalPages} 页`,
        size: 19,
        color: "76664E",
        font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" },
      }),
    ],
  });
}

function buildDocument(lineageName, exportPages) {
  const totalPages = exportPages.length;
  const sections = exportPages.map((exportPage, index) => ({
    properties: {
      type: SectionType.NEXT_PAGE,
      page: {
        size: { width: PAGE_WIDTH, height: PAGE_HEIGHT, orientation: PageOrientation.LANDSCAPE },
        margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN },
      },
    },
    children: [
      titleParagraph(lineageName),
      subtitleParagraph(exportPage, index + 1, totalPages),
      buildTable(exportPage),
    ],
  }));

  return new Document({
    title: `${lineageName || "世系"}世系图`,
    creator: "Lineage for Pang",
    sections,
  });
}

export async function exportLineageWord({ lineageName, persons }) {
  const exportPages = buildExportPages(Array.isArray(persons) ? persons : []);
  if (!exportPages.length) {
    throw new Error("当前世系没有一世至十五世可导出的宗亲人物");
  }

  const doc = buildDocument(lineageName, exportPages);
  const blob = await Packer.toBlob(doc);
  const safeName =
    String(lineageName || "世系")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "世系";
  const downloadUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${safeName}-世系图.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(downloadUrl);
  }
}

const LINEAGE_TABLE_WIDTHS = [1700, 1700, 1500, 2000, 1900, 2000, 3100, 1978];
const LINEAGE_TABLE_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 8, color: "7F7F7F" },
  bottom: { style: BorderStyle.SINGLE, size: 8, color: "7F7F7F" },
  left: { style: BorderStyle.SINGLE, size: 8, color: "7F7F7F" },
  right: { style: BorderStyle.SINGLE, size: 8, color: "7F7F7F" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "A6A6A6" },
  insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "A6A6A6" },
};

function dateRange(person) {
  if (!person) return "";
  const birth = person.birthDate || "";
  const death = person.deathDate || "";
  if (!birth && !death) return "";
  if (!birth) return death;
  if (!death) return birth;
  return `${birth}\n${death}`;
}

function personName(person, markFemale = false) {
  if (!person) return "";
  return `${person.name || "未命名"}${markFemale && person.sex === "女" ? "（女）" : ""}`;
}

function generationLabelForNumber(value) {
  if (value === -2) return "上代";
  if (value === -1 || value === 0) return "本代";
  return GENERATION_NAMES[value] ? `${GENERATION_NAMES[value]}世` : "";
}

function groupGenerationLabel(generation, offset = 0) {
  const number = generationNumber(generation);
  if (number === 999) return offset === 0 ? String(generation || "") : "";
  return generationLabelForNumber(number + offset);
}

function buildLineageTableGroups(persons) {
  const allPersons = Array.isArray(persons) ? persons : [];
  const byId = new Map(allPersons.map((person) => [person.id, person]));
  const childrenByParent = new Map();
  allPersons.forEach((person) => {
    if (!person.parentId) return;
    if (!childrenByParent.has(person.parentId)) childrenByParent.set(person.parentId, []);
    childrenByParent.get(person.parentId).push(person);
  });

  function nearestRelativeParent(person) {
    const visited = new Set([person.id]);
    let parent = byId.get(person.parentId);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (parent.type === "宗亲") return parent;
      parent = byId.get(parent.parentId);
    }
    return null;
  }

  function spousesOf(person) {
    return (childrenByParent.get(person.id) || []).filter((item) => item.type === "配偶");
  }

  function relativesOf(parent) {
    return (childrenByParent.get(parent.id) || []).filter((item) => item.type === "宗亲");
  }

  function tableRowsForPerson(person) {
    const spouses = spousesOf(person);
    const directChildren = relativesOf(person);
    const rows = spouses.map((spouse) => ({
      spouse,
      children: relativesOf(spouse),
    }));
    if (directChildren.length || !rows.length) {
      rows.push({ spouse: null, children: directChildren });
    }
    return rows;
  }

  const groups = new Map();
  allPersons
    .filter((person) => person.type === "宗亲")
    .forEach((person) => {
      const key = generationNumber(person.generation);
      if (!groups.has(key)) {
        groups.set(key, {
          generation: person.generation,
          generationNumber: key,
          rows: [],
        });
      }
      const group = groups.get(key);
      tableRowsForPerson(person).forEach(({ spouse, children }) => {
        group.rows.push([
          personName(nearestRelativeParent(person)),
          personName(person),
          person.alias || "",
          dateRange(person),
          personName(spouse),
          dateRange(spouse),
          children.map((child) => personName(child, true)).join("，"),
          person.notes || "",
        ]);
      });
    });

  return [...groups.values()].sort(
    (left, right) => left.generationNumber - right.generationNumber
  );
}

function lineageTableCell(text, { header = false } = {}) {
  const lines = String(text ?? "").split("\n");
  const children = [];
  lines.forEach((line, index) => {
    if (index) children.push(new TextRun({ break: 1 }));
    children.push(new TextRun({
      text: line,
      bold: header,
      size: header ? 17 : 16,
      color: "222222",
      font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" },
    }));
  });
  return new Paragraph({
    alignment: header ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: 240 },
    children,
  });
}

function buildLineageTable(group) {
  const headers = [
    groupGenerationLabel(group.generation, -1),
    groupGenerationLabel(group.generation),
    "别号",
    "生卒时间",
    "配偶",
    "配偶生卒时间",
    groupGenerationLabel(group.generation, 1),
    "备注",
  ];
  const header = new TableRow({
    tableHeader: true,
    cantSplit: true,
    height: { value: 620, rule: HeightRule.ATLEAST },
    children: headers.map((label, index) => new TableCell({
      width: { size: LINEAGE_TABLE_WIDTHS[index], type: WidthType.DXA },
      verticalAlign: VerticalAlignTable.CENTER,
      shading: { fill: "F0ECE4" },
      margins: { top: 100, bottom: 100, left: 80, right: 80 },
      children: [lineageTableCell(label, { header: true })],
    })),
  });
  const rows = [header];
  group.rows.forEach((values) => {
    rows.push(new TableRow({
      cantSplit: true,
      height: { value: 620, rule: HeightRule.ATLEAST },
      children: values.map((value, index) => new TableCell({
        width: { size: LINEAGE_TABLE_WIDTHS[index], type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.CENTER,
        margins: { top: 90, bottom: 90, left: 80, right: 80 },
        children: [lineageTableCell(value)],
      })),
    }));
  });
  return new Table({
    rows,
    width: { size: LINEAGE_TABLE_WIDTHS.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
    columnWidths: LINEAGE_TABLE_WIDTHS,
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
    borders: LINEAGE_TABLE_BORDERS,
  });
}

function lineageTableTitle(generation, index) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    pageBreakBefore: index > 0,
    spacing: { before: 0, after: 180 },
    children: [new TextRun({
      text: `${groupGenerationLabel(generation)}祖`,
      bold: true,
      size: 30,
      color: "222222",
      font: { ascii: "SimSun", hAnsi: "SimSun", eastAsia: "宋体" },
    })],
  });
}

function buildLineageTableDocument(lineageName, groups) {
  return new Document({
    title: lineageName || "当前世系",
    creator: "Lineage for Pang",
    sections: [{
      properties: {
        page: {
          size: { width: 16838, height: 11906, orientation: PageOrientation.LANDSCAPE },
          margin: { top: 480, right: 480, bottom: 480, left: 480 },
        },
      },
      children: groups.flatMap((group, index) => [
        lineageTableTitle(group.generation, index),
        buildLineageTable(group),
      ]),
    }],
  });
}

export async function exportLineageTableWord({ lineageName, persons }) {
  const groups = buildLineageTableGroups(Array.isArray(persons) ? persons : []);
  if (!groups.length) throw new Error("当前世系没有可导出的宗亲人物");

  const doc = buildLineageTableDocument(lineageName, groups);
  const blob = await Packer.toBlob(doc);
  const safeName = String(lineageName || "当前世系")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "当前世系";
  const downloadUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `${safeName}-世系表.docx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(downloadUrl);
  }
}
