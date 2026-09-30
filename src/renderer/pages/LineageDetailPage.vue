<script setup>
import { ElMessage } from "element-plus";
import { Search } from "@element-plus/icons-vue";
import { toPng } from "html-to-image";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue";
import {
  exportLineageTableWord,
  exportLineageWord,
} from "../word-lineage-export.js";

const props = defineProps({ lineage: { type: Object, required: true } });
const emit = defineEmits(["back", "updated"]);
const storage = window.electronAPI.storage;
const selectedLineage = ref({ ...props.lineage });
const detailLoading = ref(true);
const detailPersons = ref([]);
const errorMessage = ref("");
const selectedPersonId = ref(null);

const personOptionsVersion = ref(0);
const treeViewport = ref(null);
const treeStage = ref(null);
const exportingTree = ref(false);
const exportingWord = ref(false);
const exportingTable = ref(false);
const personDialogOpen = ref(false);
const expandedIds = ref(new Set());
const contextMenu = reactive({ open: false, x: 0, y: 0, person: null });
const editorMode = ref(null);
const editorOpen = ref(false);
const savingPerson = ref(false);
const editorError = ref("");
const deleteTarget = ref(null);
const zoom = ref(0.82);
// select对应Id
const detailSearchPersonId = ref(null);
const personFormParentId = ref(null);
const personForm = reactive({
  parentId: 0,
  generation: "一世",
  name: "",
  alias: "",
  birthDate: "",
  deathDate: "",
  notes: "",
  sex: "男",
  type: "宗亲",
});
const personFormRef = ref(null);
const personFormRules = {
  generation: [{ required: true, message: "请选择世系", trigger: "change" }],
  name: [
    {
      validator: (_rule, value, callback) => {
        if (String(value || "").trim()) callback();
        else callback(new Error("请输入姓名"));
      },
      trigger: ["blur", "change"],
    },
  ],
  type: [{ required: true, message: "请选择身份", trigger: "change" }],
  sex: [{ required: true, message: "请选择性别", trigger: "change" }],
};

const generationNames = [
  "零",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
  "十一",
  "十二",
  "十三",
  "十四",
  "十五",
  "十六",
  "十七",
  "十八",
  "十九",
  "二十",
];
const generationOptions = [
  { value: "上代", label: "上代" },
  { value: "本代", label: "本代" },
  ...generationNames
    .slice(1)
    .map((name) => ({ value: `${name}世`, label: `${name}世` })),
];
const generationNumber = (generation) =>
  ({
    上代: -2,
    本代: -1,
    零世: -1,
    一世: 1,
    二世: 2,
    三世: 3,
    四世: 4,
    五世: 5,
    六世: 6,
    七世: 7,
    八世: 8,
    九世: 9,
    十世: 10,
    十一世: 11,
    十二世: 12,
    十三世: 13,
    十四世: 14,
    十五世: 15,
    十六世: 16,
    十七世: 17,
    十八世: 18,
    十九世: 19,
    二十世: 20,
  }[generation] ?? 999);

function generationLabel(generation) {
  return generation === "零世" ? "本代" : generation;
}

async function loadAllPersons(lineageId) {
  const firstPage = await storage.listPersons({
    lineageId,
    page: 1,
    pageSize: 100,
  });
  const items = [...firstPage.items];
  for (let page = 2; page <= firstPage.totalPages; page += 1) {
    const result = await storage.listPersons({
      lineageId,
      page,
      pageSize: 100,
    });
    items.push(...result.items);
  }
  return items;
}

async function loadDetail() {
  detailLoading.value = true;
  errorMessage.value = "";
  try {
    detailPersons.value = await loadAllPersons(selectedLineage.value.id);
    personOptionsVersion.value += 1;
  } catch (error) {
    errorMessage.value = error.message || "读取世系人物失败";
    detailPersons.value = [];
  } finally {
    detailLoading.value = false;
  }
}

const treeLayout = computed(() => {
  const nodes = detailPersons.value;
  if (!nodes.length) return { nodes: [], edges: [], width: 0, height: 0 };
  const nodeWidth = 178;
  const nodeHeight = 88;
  const horizontalGap = 28;
  const rootGap = 72;
  const levelGap = 112;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map();
  const roots = [];
  nodes.forEach((node) => {
    if (node.parentId && byId.has(node.parentId)) {
      if (!children.has(node.parentId)) children.set(node.parentId, []);
      children.get(node.parentId).push(node);
    } else roots.push(node);
  });
  const order = (a, b) =>
    generationNumber(a.generation) - generationNumber(b.generation) ||
    a.id - b.id;
  roots.sort(order);
  children.forEach((list) => list.sort(order));
  const childList = (node) =>
    expandedIds.value.has(node.id) ? children.get(node.id) || [] : [];
  const widths = new Map();
  const depths = new Map();
  function measure(node) {
    const list = childList(node);
    if (!list.length) {
      widths.set(node.id, nodeWidth);
      depths.set(node.id, 0);
      return nodeWidth;
    }
    const childWidth = list.reduce(
      (sum, child, index) => sum + measure(child) + (index ? horizontalGap : 0),
      0
    );
    widths.set(node.id, Math.max(nodeWidth, childWidth));
    depths.set(
      node.id,
      Math.max(...list.map((child) => depths.get(child.id) + 1))
    );
    return widths.get(node.id);
  }
  roots.forEach(measure);
  const positioned = [];
  const edges = [];
  let cursor = 24;
  function place(node, left, depth) {
    const width = widths.get(node.id) || nodeWidth;
    const list = childList(node);
    const childWidth = list.reduce(
      (sum, child, index) =>
        sum + widths.get(child.id) + (index ? horizontalGap : 0),
      0
    );
    const x = left + (width - nodeWidth) / 2;
    const y = 24 + depth * (nodeHeight + levelGap);
    positioned.push({
      ...node,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
      depth,
    });
    let childLeft = left + (width - childWidth) / 2;
    list.forEach((child) => {
      place(child, childLeft, depth + 1);
      edges.push({ parentId: node.id, childId: child.id });
      childLeft += widths.get(child.id) + horizontalGap;
    });
  }
  roots.forEach((root) => {
    place(root, cursor, 0);
    cursor += widths.get(root.id) + rootGap;
  });
  const maxDepth = positioned.reduce(
    (max, node) => Math.max(max, node.depth),
    0
  );
  return {
    nodes: positioned,
    edges,
    width: Math.max(cursor + 24, 600),
    height: 48 + (maxDepth + 1) * (nodeHeight + levelGap),
  };
});

const nodeById = computed(
  () => new Map(treeLayout.value.nodes.map((node) => [node.id, node]))
);
const selectedPerson = computed(
  () =>
    detailPersons.value.find(
      (person) => person.id === selectedPersonId.value
    ) || null
);
const editorPerson = computed(() =>
  editorMode.value === "edit"
    ? detailPersons.value.find(
        (person) => person.id === selectedPersonId.value
      ) || null
    : contextMenu.person
);

function descendantIds(personId) {
  const result = new Set([personId]);
  let changed = true;
  while (changed) {
    changed = false;
    detailPersons.value.forEach((person) => {
      if (
        person.parentId &&
        result.has(person.parentId) &&
        !result.has(person.id)
      ) {
        result.add(person.id);
        changed = true;
      }
    });
  }
  return result;
}

const personSelectOptions = computed(() => {
  const byId = new Map(
    detailPersons.value.map((person) => [person.id, person])
  );

  function nearestRelative(person) {
    const visited = new Set([person.id]);
    let parent = byId.get(person.parentId);
    while (parent && !visited.has(parent.id)) {
      visited.add(parent.id);
      if (parent.type === "宗亲") return parent;
      parent = byId.get(parent.parentId);
    }
    return null;
  }

  return detailPersons.value
    .slice()
    .sort(
      (a, b) =>
        generationNumber(a.generation) - generationNumber(b.generation) ||
        a.name.localeCompare(b.name, "zh-CN") ||
        a.id - b.id
    )
    .map((person) => {
      const alias = person.alias ? `（${person.alias}）` : "";
      const relative = person.type === "配偶" ? nearestRelative(person) : null;
      const relativeAlias = relative?.alias ? `（${relative.alias}）` : "";
      const identity = relative
        ? `${relative.name}${relativeAlias} · ${person.name}${alias}（配偶）`
        : `${person.name}${alias}`;
      return {
        value: person.id,
        label: `${generationLabel(person.generation)} · ${identity}`,
        person,
      };
    });
});

const parentSelectOptions = computed(() => {
  const currentGenerationNumber = editorPerson.value?.generationNumber;
  const availableOptions =
    editorMode.value === "edit" && Number.isFinite(currentGenerationNumber)
      ? personSelectOptions.value.filter(
          (option) =>
            Number.isFinite(option.person.generationNumber) &&
            option.person.generationNumber < currentGenerationNumber
        )
      : personSelectOptions.value;

  return [
    {
      value: 0,
      label:
        editorMode.value === "create" &&
        isAncestorGeneration(personForm.generation, contextMenu.person)
          ? "当前节点上方（自动连接）"
          : "无上级（根节点）",
    },
    ...availableOptions,
  ];
});
const detailSearchOptions = personSelectOptions;

const deleteCount = computed(() =>
  deleteTarget.value ? descendantIds(deleteTarget.value.id).size : 0
);
const exporting = computed(
  () => exportingTree.value || exportingWord.value || exportingTable.value
);
const exportLabel = computed(() => {
  if (exportingTree.value) return "正在导出…";
  if (exportingWord.value || exportingTable.value) return "正在生成…";
  return "导出";
});

function changeZoom(delta) {
  zoom.value = Math.min(
    1.35,
    Math.max(0.45, Number((zoom.value + delta).toFixed(2)))
  );
}
async function resetDetailView() {
  zoom.value = 0.82;
  detailSearchPersonId.value = null;
  selectedPersonId.value = null;
  expandedIds.value = new Set();
  closeContextMenu();
  await nextTick();
  requestAnimationFrame(() =>
    treeViewport.value?.scrollTo({ left: 0, top: 0, behavior: "auto" })
  );
}
async function exportTreeImage() {
  if (exporting.value || !treeStage.value || !treeLayout.value.nodes.length)
    return;
  exportingTree.value = true;
  try {
    await nextTick();
    await document.fonts?.ready;
    const dataUrl = await toPng(treeStage.value, {
      width: treeLayout.value.width,
      height: treeLayout.value.height,
      pixelRatio: 2,
      backgroundColor: "#fbfaf7",
      cacheBust: true,
      style: { transform: "none" },
    });
    const fileName = (selectedLineage.value.name || "世系").replace(
      /[\\/:*?"<>|]/g,
      "_"
    );
    const link = document.createElement("a");
    link.download = `${fileName}-结构图.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
    ElMessage.success("树状图已导出");
  } catch (error) {
    console.error("导出树状图失败", error);
    ElMessage.error(error.message || "导出树状图失败");
  } finally {
    exportingTree.value = false;
  }
}
function handleExportCommand(command) {
  if (command === "image") return exportTreeImage();
  if (command === "word") return exportLineageWordDocument();
  if (command === "table") return exportLineageTableDocument();
}
async function exportLineageWordDocument() {
  if (exporting.value || !detailPersons.value.length) return;
  exportingWord.value = true;
  try {
    await exportLineageWord({
      lineageName: selectedLineage.value.name || "世系",
      persons: detailPersons.value,
    });
    ElMessage.success("世系图 Word 已导出");
  } catch (error) {
    console.error("导出世系图 Word 失败", error);
    ElMessage.error(error.message || "导出世系图 Word 失败");
  } finally {
    exportingWord.value = false;
  }
}
async function exportLineageTableDocument() {
  if (exporting.value || !detailPersons.value.length) return;
  exportingTable.value = true;
  try {
    await exportLineageTableWord({
      lineageName: selectedLineage.value.name || "当前世系",
      persons: detailPersons.value,
    });
    ElMessage.success("世系表 Word 已导出");
  } catch (error) {
    console.error("导出世系表 Word 失败", error);
    ElMessage.error(error.message || "导出世系表 Word 失败");
  } finally {
    exportingTable.value = false;
  }
}

function selectPerson(person) {
  selectedPersonId.value = person.id;
  detailSearchPersonId.value = person.id;
  personDialogOpen.value = true;
}
function closePersonDialog() {
  personDialogOpen.value = false;
}
function openContextMenu(event, person) {
  selectedPersonId.value = person.id;
  contextMenu.person = person;
  contextMenu.x = Math.max(8, Math.min(event.clientX, window.innerWidth - 176));
  contextMenu.y = Math.max(
    8,
    Math.min(event.clientY, window.innerHeight - 188)
  );
  contextMenu.open = true;
}
function closeContextMenu() {
  contextMenu.open = false;
}
function nextGeneration(generation) {
  const levels = [
    "上代",
    "本代",
    ...generationNames.slice(1).map((name) => `${name}世`),
  ];
  const index = levels.indexOf(generationLabel(generation));
  return index >= 0 && index < levels.length - 1 ? levels[index + 1] : "一世";
}
function isAncestorGeneration(generation, person) {
  return (
    Boolean(person) &&
    generationNumber(generation) < generationNumber(person.generation)
  );
}
function handleGenerationChange(generation) {
  if (editorMode.value !== "create" || !contextMenu.person) return;
  personForm.parentId = isAncestorGeneration(generation, contextMenu.person)
    ? 0
    : contextMenu.person.id;
  personFormParentId.value = personForm.parentId;
}
function handleParentChange(parentId) {
  personForm.parentId =
    parentId === null || parentId === undefined || parentId === ""
      ? 0
      : Number(parentId);
  personFormParentId.value = personForm.parentId;
  console.log("handleParentChange", parentId);
}

async function scrollToPerson(personId) {
  await nextTick();
  requestAnimationFrame(() => {
    const person = treeLayout.value.nodes.find((node) => node.id === personId);
    const viewport = treeViewport.value;
    if (!person || !viewport) return;
    const left =
      person.x * zoom.value +
      (person.width * zoom.value) / 2 -
      viewport.clientWidth / 2;
    const top =
      person.y * zoom.value +
      (person.height * zoom.value) / 2 -
      viewport.clientHeight / 2;
    viewport.scrollTo({
      left: Math.min(
        Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        Math.max(0, left)
      ),
      top: Math.min(
        Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        Math.max(0, top)
      ),
      behavior: "smooth",
    });
  });
}
async function focusSearchPerson(personId) {
  const id =
    personId === null || personId === undefined || personId === ""
      ? null
      : Number(personId);
  detailSearchPersonId.value = id;
  if (!id) {
    selectedPersonId.value = null;
    return;
  }
  const personById = new Map(
    detailPersons.value.map((person) => [person.id, person])
  );
  const person = personById.get(id);
  if (!person) return;
  selectedPersonId.value = id;
  const nextExpandedIds = new Set(expandedIds.value);
  let ancestor = personById.get(person.parentId);
  while (ancestor) {
    nextExpandedIds.add(ancestor.id);
    ancestor = personById.get(ancestor.parentId);
  }
  expandedIds.value = nextExpandedIds;
  await scrollToPerson(id);

  console.log("focusSearchPerson", personId, detailSearchOptions);
}

function setForm(person, mode) {
  const creating = mode === "create" || mode === "create-root";
  personForm.parentId =
    mode === "create-root" ? 0 : creating ? person.id : person.parentId || 0;
  personFormParentId.value = personForm.parentId;
  personForm.generation =
    mode === "create-root"
      ? "一世"
      : creating
      ? nextGeneration(person.generation)
      : generationLabel(person.generation);
  personForm.name = creating ? "" : person.name;
  personForm.alias = creating ? "" : person.alias || "";
  personForm.birthDate = creating ? "" : person.birthDate || "";
  personForm.deathDate = creating ? "" : person.deathDate || "";
  personForm.notes = creating ? "" : person.notes || "";
  personForm.sex = creating ? "男" : person.sex;
  personForm.type = creating ? "宗亲" : person.type;
}
function openEditor(mode) {
  const person = contextMenu.person;
  if (!person) return;
  editorMode.value = mode;
  editorError.value = "";
  setForm(person, mode);
  editorOpen.value = true;
  closeContextMenu();
  nextTick(() => personFormRef.value?.clearValidate());
}
function openRootEditor() {
  editorMode.value = "create-root";
  editorError.value = "";
  setForm(null, "create-root");
  editorOpen.value = true;
  nextTick(() => personFormRef.value?.clearValidate());
}
function closeEditor() {
  if (savingPerson.value) return;
  editorOpen.value = false;
  editorError.value = "";
  personFormRef.value?.clearValidate();
}
async function refreshCurrentLineage() {
  detailPersons.value = await loadAllPersons(selectedLineage.value.id);
  personOptionsVersion.value += 1;
  const updated = (await storage.listLineages()).find(
    (lineage) => lineage.id === selectedLineage.value.id
  );
  if (updated) {
    selectedLineage.value = updated;
    emit("updated", updated);
  }
}
async function savePerson() {
  if (!personFormRef.value) return;
  try {
    await personFormRef.value.validate();
  } catch {
    return;
  }
  savingPerson.value = true;
  editorError.value = "";
  const input = {
    parentId: personForm.parentId === 0 ? null : personForm.parentId,
    generation: personForm.generation,
    name: personForm.name.trim(),
    alias: personForm.alias || null,
    birthDate: personForm.birthDate || null,
    deathDate: personForm.deathDate || null,
    notes: personForm.notes || null,
    sex: personForm.sex,
    type: personForm.type,
  };
  try {
    if (editorMode.value === "create" || editorMode.value === "create-root") {
      if (
        editorMode.value === "create" &&
        isAncestorGeneration(input.generation, contextMenu.person)
      ) {
        const inserted = await storage.createPersonAbove({
          lineageId: selectedLineage.value.id,
          childId: contextMenu.person.id,
          ...input,
        });
        expandedIds.value = new Set(expandedIds.value).add(inserted.id);
      } else {
        await storage.createPerson({
          lineageId: selectedLineage.value.id,
          ...input,
        });
        if (input.parentId)
          expandedIds.value = new Set(expandedIds.value).add(input.parentId);
      }
    } else {
      await storage.updatePerson(editorPerson.value.id, input);
    }
    editorOpen.value = false;
    await refreshCurrentLineage();
  } catch (error) {
    editorError.value = error.message || "保存人物失败";
  } finally {
    savingPerson.value = false;
  }
}
function requestDelete() {
  editorError.value = "";
  deleteTarget.value = contextMenu.person;
  closeContextMenu();
}
async function confirmDelete() {
  if (!deleteTarget.value) return;
  savingPerson.value = true;
  editorError.value = "";
  try {
    await storage.deletePerson(deleteTarget.value.id);
    selectedPersonId.value = null;
    personDialogOpen.value = false;
    deleteTarget.value = null;
    await refreshCurrentLineage();
  } catch (error) {
    editorError.value = error.message || "删除人物失败";
  } finally {
    savingPerson.value = false;
  }
}

function hasChildren(personId) {
  return detailPersons.value.some((person) => person.parentId === personId);
}
function toggleExpanded(personId) {
  const next = new Set(expandedIds.value);
  if (next.has(personId)) next.delete(personId);
  else next.add(personId);
  expandedIds.value = next;
}
async function expandAll() {
  expandedIds.value = new Set(
    detailPersons.value
      .filter((person) => hasChildren(person.id))
      .map((person) => person.id)
  );
  await nextTick();
  const root = treeLayout.value.nodes.find((person) => person.depth === 0);
  if (root) await scrollToPerson(root.id);
}
function handleKeydown(event) {
  if (event.key !== "Escape") return;
  if (contextMenu.open) closeContextMenu();
  else if (deleteTarget.value) deleteTarget.value = null;
  else if (editorOpen.value) closeEditor();
  else if (personDialogOpen.value) closePersonDialog();
}

onMounted(() => {
  loadDetail();
  window.addEventListener("click", closeContextMenu);
  window.addEventListener("keydown", handleKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("click", closeContextMenu);
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="page-shell">
    <header class="detail-header">
      <button class="back-button" type="button" @click="emit('back')">
        ← 返回世系列表
      </button>
      <div class="detail-heading">
        <p class="eyebrow">世系结构图</p>
        <h1>{{ selectedLineage.name }}</h1>
        <p class="subtitle">
          {{ selectedLineage.fileName || "本地新建世系" }} ·
          {{ selectedLineage.total.toLocaleString() }} 人
        </p>
      </div>
      <div class="tree-tools" aria-label="结构图工具">
        <button class="expand-all-button" type="button" @click="expandAll">
          全部展开
        </button>
        <button class="add-root-button" type="button" @click="openRootEditor">
          新增根节点
        </button>
        <button type="button" aria-label="缩小" @click="changeZoom(-0.1)">
          −
        </button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <button type="button" aria-label="放大" @click="changeZoom(0.1)">
          +
        </button>
        <button class="reset-button" type="button" @click="resetDetailView">
          重置视图
        </button>
        <el-dropdown
          class="export-dropdown"
          trigger="click"
          :disabled="exporting"
          @command="handleExportCommand"
        >
          <button class="export-button" type="button" :disabled="exporting">
            {{ exportLabel }}
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                command="image"
                :disabled="!treeLayout.nodes.length"
                >导出图片</el-dropdown-item
              >
              <el-dropdown-item command="word" :disabled="!detailPersons.length"
                >导出世系图</el-dropdown-item
              >
              <el-dropdown-item
                command="table"
                :disabled="!detailPersons.length"
                >导出世系表</el-dropdown-item
              >
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <p v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </p>
    <section v-else class="detail-layout">
      <div class="panel tree-panel">
        <div class="tree-panel-bar">
          <span>{{ detailLoading ? "正在读取组织结构图" : "组织结构图" }}</span>
          <div class="tree-panel-actions">
            <label class="detail-search-field">
              <span class="sr-only">搜索人物</span>
              <Search />
              <el-select
                :key="`person-search-${personOptionsVersion}`"
                v-model="detailSearchPersonId"
                class="detail-person-search"
                filterable
                clearable
                placeholder="搜索人物"
                no-data-text="没有匹配人物"
                @change="focusSearchPerson"
              >
                <el-option
                  v-for="option in detailSearchOptions"
                  :key="option.value"
                  :value="option.value"
                  :label="option.label"
                />
              </el-select>
            </label>
            <span class="tree-status"
              >已显示 {{ treeLayout.nodes.length }} 个节点</span
            >
          </div>
        </div>
        <div
          ref="treeViewport"
          class="tree-viewport"
          @contextmenu.prevent="closeContextMenu"
        >
          <div
            class="tree-scroll-content"
            :style="{
              width: `${treeLayout.width * zoom}px`,
              height: `${treeLayout.height * zoom}px`,
            }"
          >
            <div
              ref="treeStage"
              class="tree-stage"
              :style="{
                width: `${treeLayout.width}px`,
                height: `${treeLayout.height}px`,
                transform: `scale(${zoom})`,
              }"
            >
              <svg
                class="tree-lines"
                :width="treeLayout.width"
                :height="treeLayout.height"
                aria-hidden="true"
              >
                <path
                  v-for="edge in treeLayout.edges"
                  :key="`${edge.parentId}-${edge.childId}`"
                  fill="none"
                  stroke="#c9bda8"
                  stroke-width="1.5"
                  vector-effect="non-scaling-stroke"
                  :d="`M ${nodeById.get(edge.parentId)?.x + 89} ${
                    nodeById.get(edge.parentId)?.y + 88
                  } V ${nodeById.get(edge.parentId)?.y + 112} H ${
                    nodeById.get(edge.childId)?.x + 89
                  } V ${nodeById.get(edge.childId)?.y}`"
                />
              </svg>
              <div
                v-for="person in treeLayout.nodes"
                :key="person.id"
                class="person-node-wrap"
                :data-person-id="person.id"
                :style="{ left: `${person.x}px`, top: `${person.y}px` }"
                @contextmenu.prevent.stop="openContextMenu($event, person)"
              >
                <button
                  class="person-node"
                  :class="{
                    selected: selectedPersonId === person.id,
                    spouse: person.type === '配偶',
                  }"
                  type="button"
                  @click="selectPerson(person)"
                >
                  <span class="node-generation">{{
                    generationLabel(person.generation)
                  }}</span>
                  <strong>{{ person.name }}</strong>
                  <span class="node-meta"
                    >{{ person.type }} · {{ person.sex }}</span
                  >
                </button>
                <button
                  v-if="hasChildren(person.id)"
                  class="node-expand"
                  type="button"
                  :aria-label="
                    expandedIds.has(person.id) ? '收起子代' : '展开子代'
                  "
                  @click.stop="toggleExpanded(person.id)"
                >
                  {{ expandedIds.has(person.id) ? "−" : "+" }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="contextMenu.open && contextMenu.person"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      role="menu"
      @click.stop
    >
      <p>{{ contextMenu.person.name }}</p>
      <button type="button" role="menuitem" @click="openEditor('create')">
        <span>＋</span>新增人物
      </button>
      <button type="button" role="menuitem" @click="openEditor('edit')">
        <span>✎</span>编辑人物
      </button>
      <button
        class="danger-menu-item"
        type="button"
        role="menuitem"
        @click="requestDelete"
      >
        <span>×</span>删除人物
      </button>
    </div>

    <div
      v-show="editorOpen"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="closeEditor"
    >
      <el-form
        ref="personFormRef"
        class="person-dialog person-editor"
        :model="personForm"
        :rules="personFormRules"
        label-position="top"
        @submit.prevent="savePerson"
      >
        <button
          class="dialog-close"
          type="button"
          aria-label="关闭"
          @click="closeEditor"
        >
          ×
        </button>
        <p class="inspector-kicker">
          {{ editorMode === "edit" ? "编辑人物" : "新增人物" }}
        </p>
        <h2>
          {{
            editorMode === "create-root"
              ? "新增根节点"
              : editorMode === "create"
              ? `添加到 ${contextMenu.person?.name}`
              : editorPerson?.name
          }}
        </h2>
        <p v-show="editorError" class="form-error" role="alert">
          {{ editorError }}
        </p>
        <div class="person-form-grid">
          <el-form-item class="form-field-wide" label="上级人物">
            <el-select
              :key="`person-parent-${personOptionsVersion}`"
              v-model="personFormParentId"
              filterable
              clearable
              placeholder="按姓名、别号或世系筛选"
              no-data-text="没有匹配人物"
              @change="handleParentChange"
            >
              <el-option
                v-for="option in parentSelectOptions"
                :key="option.label"
                :value="option.value"
                :label="option.label"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="世系" prop="generation">
            <el-select
              v-model="personForm.generation"
              placeholder="请选择世系"
              @change="handleGenerationChange"
            >
              <el-option
                v-for="option in generationOptions"
                :key="option.value"
                :value="option.value"
                :label="option.label"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="姓名" prop="name">
            <el-input v-model="personForm.name" maxlength="100" />
          </el-form-item>
          <el-form-item label="身份" prop="type">
            <el-select v-model="personForm.type" placeholder="请选择身份">
              <el-option label="宗亲" value="宗亲" />
              <el-option label="配偶" value="配偶" />
            </el-select>
          </el-form-item>
          <el-form-item label="性别" prop="sex">
            <el-select v-model="personForm.sex" placeholder="请选择性别">
              <el-option label="男" value="男" />
              <el-option label="女" value="女" />
            </el-select>
          </el-form-item>
          <el-form-item class="form-field-wide" label="别号">
            <el-input v-model="personForm.alias" maxlength="200" />
          </el-form-item>
          <el-form-item label="生日">
            <el-input v-model="personForm.birthDate" maxlength="100" />
          </el-form-item>
          <el-form-item label="卒日">
            <el-input v-model="personForm.deathDate" maxlength="100" />
          </el-form-item>
          <el-form-item class="form-field-wide" label="备注">
            <el-input v-model="personForm.notes" type="textarea" :rows="3" />
          </el-form-item>
        </div>
        <div class="dialog-actions">
          <button type="button" @click="closeEditor">取消</button>
          <button class="submit-button" type="submit" :disabled="savingPerson">
            {{ savingPerson ? "保存中…" : "保存" }}
          </button>
        </div>
      </el-form>
    </div>

    <div
      v-if="deleteTarget"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="deleteTarget = null"
    >
      <section
        class="person-dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除人物确认"
      >
        <p class="inspector-kicker">删除确认</p>
        <h2>删除 {{ deleteTarget.name }}？</h2>
        <p>
          该操作会同时删除此人物及其全部后代，共
          {{ deleteCount }} 条人物记录，删除后无法撤销。
        </p>
        <p v-if="editorError" class="form-error" role="alert">
          {{ editorError }}
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            :disabled="savingPerson"
            @click="deleteTarget = null"
          >
            取消
          </button>
          <button
            class="delete-button"
            type="button"
            :disabled="savingPerson"
            @click="confirmDelete"
          >
            {{ savingPerson ? "删除中…" : "确认删除" }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="personDialogOpen && selectedPerson"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="closePersonDialog"
    >
      <section
        class="person-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="`${selectedPerson.name}人物详情`"
      >
        <button
          class="dialog-close"
          type="button"
          aria-label="关闭人物详情"
          @click="closePersonDialog"
        >
          ×
        </button>
        <p class="inspector-kicker">人物详情</p>
        <h2>{{ selectedPerson.name }}</h2>
        <dl>
          <div>
            <dt>世系</dt>
            <dd>{{ generationLabel(selectedPerson.generation) }}</dd>
          </div>
          <div>
            <dt>身份</dt>
            <dd>{{ selectedPerson.type }}</dd>
          </div>
          <div>
            <dt>性别</dt>
            <dd>{{ selectedPerson.sex }}</dd>
          </div>
          <div>
            <dt>别号</dt>
            <dd>{{ selectedPerson.alias || "—" }}</dd>
          </div>
          <div>
            <dt>生日</dt>
            <dd>{{ selectedPerson.birthDate || "—" }}</dd>
          </div>
          <div>
            <dt>卒日</dt>
            <dd>{{ selectedPerson.deathDate || "—" }}</dd>
          </div>
          <div>
            <dt>备注</dt>
            <dd>{{ selectedPerson.notes || "—" }}</dd>
          </div>
        </dl>
      </section>
    </div>
  </main>
</template>
