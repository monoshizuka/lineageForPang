<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

const emit = defineEmits(["open"]);
const storage = window.electronAPI.storage;
const keyword = ref("");
const lineageFiles = ref([]);
const loading = ref(true);
const importing = ref(false);
const errorMessage = ref("");
const lineageContextMenu = reactive({ open: false, x: 0, y: 0, lineage: null });
const lineageEditorOpen = ref(false);
const lineageEditorTarget = ref(null);
const lineageEditorName = ref("");
const lineageSaving = ref(false);
const lineageError = ref("");
const lineageDeleteTarget = ref(null);
const lineageCreateOpen = ref(false);
const lineageCreateName = ref("");

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

function generationText(file) {
  if (
    file.generationStart === null ||
    file.generationStart === undefined ||
    file.generationEnd === null ||
    file.generationEnd === undefined
  )
    return "暂无数据";
  const label = (value) =>
    Number(value) === -2
      ? "上代"
      : Number(value) === -1 || Number(value) === 0
      ? "本代"
      : `${generationNames[value] ?? value}世`;
  return `${label(file.generationStart)}~${label(file.generationEnd)}`;
}

async function loadLineages() {
  loading.value = true;
  errorMessage.value = "";
  try {
    lineageFiles.value = await storage.listLineages();
  } catch (error) {
    errorMessage.value = error.message || "读取本地数据库失败";
  } finally {
    loading.value = false;
  }
}

async function importPdfs() {
  importing.value = true;
  errorMessage.value = "";
  try {
    await storage.importPdfs();
    await loadLineages();
  } catch (error) {
    errorMessage.value = error.message || "导入 PDF 世系表失败";
  } finally {
    importing.value = false;
  }
}

const filteredFiles = computed(() => {
  const query = keyword.value.trim().toLowerCase();
  if (!query) return lineageFiles.value;
  return lineageFiles.value.filter((file) =>
    [file.fileName, file.name, generationText(file)].some((value) =>
      value?.toLowerCase().includes(query)
    )
  );
});
const totalPeople = computed(() =>
  lineageFiles.value.reduce((total, file) => total + file.total, 0)
);

function openLineage(file) {
  emit("open", file);
}

function openLineageContextMenu(event, lineage) {
  lineageContextMenu.lineage = lineage;
  lineageContextMenu.x = Math.max(
    8,
    Math.min(event.clientX, window.innerWidth - 176)
  );
  lineageContextMenu.y = Math.max(
    8,
    Math.min(event.clientY, window.innerHeight - 150)
  );
  lineageContextMenu.open = true;
}
function openLineageCreator() {
  lineageCreateName.value = "";
  lineageError.value = "";
  lineageCreateOpen.value = true;
}
function closeLineageCreator() {
  if (lineageSaving.value) return;
  lineageCreateOpen.value = false;
  lineageCreateName.value = "";
  lineageError.value = "";
}
async function saveNewLineage() {
  const name = lineageCreateName.value.trim();
  if (!name) return;
  lineageSaving.value = true;
  lineageError.value = "";
  try {
    await storage.createLineage({ name });
    await loadLineages();
    lineageCreateOpen.value = false;
    lineageCreateName.value = "";
  } catch (error) {
    lineageError.value = error.message || "新增世系失败";
  } finally {
    lineageSaving.value = false;
  }
}
function closeLineageContextMenu() {
  lineageContextMenu.open = false;
}
function openLineageEditor() {
  if (!lineageContextMenu.lineage) return;
  lineageEditorTarget.value = lineageContextMenu.lineage;
  lineageEditorName.value = lineageContextMenu.lineage.name;
  lineageError.value = "";
  lineageEditorOpen.value = true;
  closeLineageContextMenu();
}
function closeLineageEditor() {
  if (lineageSaving.value) return;
  lineageEditorOpen.value = false;
  lineageEditorTarget.value = null;
  lineageEditorName.value = "";
  lineageError.value = "";
}
async function saveLineage() {
  const name = lineageEditorName.value.trim();
  if (!name) return;
  lineageSaving.value = true;
  lineageError.value = "";
  try {
    const updated = await storage.updateLineage(lineageEditorTarget.value.id, {
      name,
    });
    lineageFiles.value = lineageFiles.value.map((lineage) =>
      lineage.id === updated.id ? updated : lineage
    );
    lineageEditorOpen.value = false;
    lineageEditorTarget.value = null;
    lineageEditorName.value = "";
  } catch (error) {
    lineageError.value = error.message || "修改世系名称失败";
  } finally {
    lineageSaving.value = false;
  }
}
function requestLineageDelete() {
  if (!lineageContextMenu.lineage) return;
  lineageDeleteTarget.value = lineageContextMenu.lineage;
  lineageError.value = "";
  closeLineageContextMenu();
}
async function confirmLineageDelete() {
  if (!lineageDeleteTarget.value) return;
  lineageSaving.value = true;
  lineageError.value = "";
  try {
    await storage.deleteLineage(lineageDeleteTarget.value.id);
    lineageFiles.value = lineageFiles.value.filter(
      (lineage) => lineage.id !== lineageDeleteTarget.value.id
    );
    lineageDeleteTarget.value = null;
  } catch (error) {
    lineageError.value = error.message || "删除世系失败";
  } finally {
    lineageSaving.value = false;
  }
}

function handleKeydown(event) {
  if (event.key !== "Escape") return;
  if (lineageContextMenu.open) closeLineageContextMenu();
  else if (lineageDeleteTarget.value) lineageDeleteTarget.value = null;
  else if (lineageCreateOpen.value) closeLineageCreator();
  else if (lineageEditorOpen.value) closeLineageEditor();
}

onMounted(() => {
  loadLineages();
  window.addEventListener("click", closeLineageContextMenu);
  window.addEventListener("keydown", handleKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("click", closeLineageContextMenu);
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <main class="page-shell">
    <header class="page-header">
      <div>
        <p class="eyebrow">贵州庞氏族谱</p>
        <h1>世系数据</h1>
      </div>
      <div class="header-actions">
        <div class="summary" aria-label="数据概览">
          <div class="summary-item">
            <span>世系文件</span><strong>{{ lineageFiles.length }}</strong>
          </div>
          <div class="summary-item">
            <span>人物记录</span
            ><strong>{{ totalPeople.toLocaleString() }}</strong>
          </div>
        </div>
        <button
          class="primary-button"
          type="button"
          :disabled="importing"
          @click="importPdfs"
        >
          {{ importing ? "正在解析 PDF…" : "导入世系表PDF" }}
        </button>
      </div>
    </header>

    <p v-if="errorMessage" class="error-message" role="alert">
      {{ errorMessage }}
    </p>

    <section class="panel toolbar" aria-label="文件筛选">
      <div class="lineage-list-actions">
        <label class="search-field">
          <span class="sr-only">搜索世系文件</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="m21 21-4.35-4.35m2.35-5.15a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"
            />
          </svg>
          <input
            v-model="keyword"
            type="search"
            placeholder="搜索世系名称或文件名"
          />
        </label>
        <button
          class="add-lineage-button"
          type="button"
          @click="openLineageCreator"
        >
          <span aria-hidden="true">＋</span>新增世系
        </button>
      </div>
      <span class="result-count">{{ filteredFiles.length }} 个世系</span>
    </section>

    <section v-if="loading" class="panel empty-state">
      <div class="loading-spinner" aria-hidden="true"></div>
      <strong>正在读取本地数据库</strong
      ><span>首次启动会自动导入内置世系数据。</span>
    </section>
    <section
      v-else-if="filteredFiles.length"
      class="file-grid"
      aria-label="世系文件列表"
    >
      <article
        v-for="file in filteredFiles"
        :key="file.id"
        class="file-card file-card-clickable"
        role="button"
        tabindex="0"
        @click="openLineage(file)"
        @contextmenu.prevent.stop="openLineageContextMenu($event, file)"
        @keydown.enter="openLineage(file)"
        @keydown.space.prevent="openLineage(file)"
      >
        <div class="file-content">
          <h2>{{ file.name }}</h2>
          <!-- <p class="file-name">{{ file.fileName || "本地新建世系" }}</p> -->
        </div>
        <dl class="file-stats">
          <div>
            <dt>世代范围</dt>
            <dd>{{ generationText(file) }}</dd>
          </div>
          <div>
            <dt>全部人物</dt>
            <dd>{{ file.total.toLocaleString() }}</dd>
          </div>
          <div>
            <dt>宗亲</dt>
            <dd>{{ file.relatives.toLocaleString() }}</dd>
          </div>
          <div>
            <dt>配偶</dt>
            <dd>{{ file.spouses.toLocaleString() }}</dd>
          </div>
        </dl>
        <span class="file-card-hint">查看组织结构图 →</span>
      </article>
    </section>
    <section v-else class="panel empty-state">
      <div class="empty-icon">空</div>
      <strong>没有找到世系数据</strong
      ><span>请更换搜索关键词，或点击“导入 PDF”添加世系。</span>
    </section>

    <div
      v-show="lineageCreateOpen"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="closeLineageCreator"
    >
      <form
        class="person-dialog lineage-editor"
        @submit.prevent="saveNewLineage"
      >
        <button
          class="dialog-close"
          type="button"
          aria-label="关闭新增世系"
          @click="closeLineageCreator"
        >
          ×
        </button>
        <p class="inspector-kicker">新增世系</p>
        <h2>创建世系列表项</h2>
        <p v-if="lineageError" class="form-error" role="alert">
          {{ lineageError }}
        </p>
        <label class="form-field">
          <span>名称</span>
          <input
            v-model="lineageCreateName"
            maxlength="200"
            placeholder="请输入世系名称"
            required
            autofocus
          />
        </label>
        <div class="dialog-actions">
          <button
            type="button"
            :disabled="lineageSaving"
            @click="closeLineageCreator"
          >
            取消
          </button>
          <button class="submit-button" type="submit" :disabled="lineageSaving">
            {{ lineageSaving ? "创建中…" : "创建" }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="lineageContextMenu.open && lineageContextMenu.lineage"
      class="context-menu lineage-context-menu"
      :style="{
        left: `${lineageContextMenu.x}px`,
        top: `${lineageContextMenu.y}px`,
      }"
      role="menu"
      @click.stop
    >
      <p>{{ lineageContextMenu.lineage.name }}</p>
      <button type="button" role="menuitem" @click="openLineageEditor">
        <span>✎</span>编辑名称
      </button>
      <button
        class="danger-menu-item"
        type="button"
        role="menuitem"
        @click="requestLineageDelete"
      >
        <span>×</span>删除世系
      </button>
    </div>

    <div
      v-show="lineageEditorOpen"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="closeLineageEditor"
    >
      <form class="person-dialog lineage-editor" @submit.prevent="saveLineage">
        <button
          class="dialog-close"
          type="button"
          aria-label="关闭编辑世系"
          @click="closeLineageEditor"
        >
          ×
        </button>
        <p class="inspector-kicker">编辑世系</p>
        <h2>修改世系名称</h2>
        <p v-if="lineageError" class="form-error" role="alert">
          {{ lineageError }}
        </p>
        <label class="form-field">
          <span>名称</span>
          <input
            v-model="lineageEditorName"
            maxlength="200"
            required
            autofocus
          />
        </label>
        <div class="dialog-actions">
          <button
            type="button"
            :disabled="lineageSaving"
            @click="closeLineageEditor"
          >
            取消
          </button>
          <button class="submit-button" type="submit" :disabled="lineageSaving">
            {{ lineageSaving ? "保存中…" : "保存" }}
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="lineageDeleteTarget"
      class="person-dialog-backdrop"
      role="presentation"
      @click.self="lineageDeleteTarget = null"
    >
      <section
        class="person-dialog delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="删除世系确认"
      >
        <p class="inspector-kicker">删除确认</p>
        <h2>删除 {{ lineageDeleteTarget.name }}？</h2>
        <p>
          该操作会同时删除此世系及其全部人物，共
          {{ lineageDeleteTarget.total.toLocaleString() }}
          条人物记录，删除后无法撤销。
        </p>
        <p v-if="lineageError" class="form-error" role="alert">
          {{ lineageError }}
        </p>
        <div class="dialog-actions">
          <button
            type="button"
            :disabled="lineageSaving"
            @click="lineageDeleteTarget = null"
          >
            取消
          </button>
          <button
            class="delete-button"
            type="button"
            :disabled="lineageSaving"
            @click="confirmLineageDelete"
          >
            {{ lineageSaving ? "删除中…" : "确认删除" }}
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
