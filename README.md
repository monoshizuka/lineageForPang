# Lineage for Pang

一个使用 Electron + Vue 3 + Vite 创建的桌面应用起始项目。

## 开始使用

```bash
npm install
npm start
```

开发时可以使用 `npm run dev`，同时启动 Vite 热更新服务和 Electron。

## 构建安装包

```bash
npm run dist
```

构建产物会输出到 `release/`。当前 `build` 配置使用 `electron-builder`，可按目标平台继续补充图标和发布设置。

## 目录结构

- `src/main.js`：Electron 主进程，负责创建窗口
- `src/preload.js`：向渲染进程暴露经过限制的 API
- `src/renderer/App.vue`：Vue 3 根组件
- `src/renderer/main.js`：Vue 应用入口
- `src/renderer/styles.css`：全局样式
- `src/types/Person.ts`：项目人员相关类型定义
- `src/data/0009世系表（三甲）.json`：从同名世系表 PDF 整理的一世至十五世人员数据
- `scripts/generate-person-tree.py`：从 PDF 重新生成同名 JSON 的提取脚本
- `vite.config.js`：Vite 和 Vue 插件配置

应用使用本地优先的数据架构：Electron 主进程将 `src/data/*.json` 作为内置种子数据，在首次启动时导入 SQLite。Vue 页面通过受限 IPC 接口读取数据库，不直接访问文件系统或数据库。

直接运行项目（`npm run dev` 或 `npm start`）时，数据库保存在项目根目录的 `data/lineage.sqlite3`，因此复制整个项目目录即可携带编辑后的数据。首次切换到项目内存储时，如果发现旧的 Electron `userData/lineage.sqlite3`，应用会自动复制一份到项目目录，不会删除旧文件。

打包后的普通安装版通常不能写入 `app.asar`，因此会继续使用 Electron 的 `userData` 目录。若制作便携版，可设置 `PORTABLE_EXECUTABLE_DIR`，数据库就会保存到可执行文件旁边的 `data/lineage.sqlite3`。也可以通过 `LINEAGE_DATA_DIR` 显式指定数据库目录。应用升级不会覆盖数据库。当前存储层已经提供：

- 世系列表和 JSON 导入
- 人物分页、关键词搜索和条件筛选
- 人物详情读取
- 新增、编辑和删除人物
- 世系详情组织结构图，支持缩放、节点详情查看、完整节点渲染，以及新增/编辑时选择上代、本代和一世以上世系，其中一世的父亲级为本代，本代的父亲级为上代
- 外键、同世系父子关系、事务和常用查询索引
- WAL 日志模式，提升读写可靠性和并发读取能力

`src/data` 中的同名种子文件只会自动导入一次，不会在重启时覆盖用户已经编辑的数据。需要手动导入其他世系时，可在首页点击“导入 PDF”。应用使用 PDF.js 解析与 `sourceData` 中版式相同的世系表，生成的同名 JSON 保存在可迁移数据库目录的 `imports/` 中，然后事务导入 SQLite。

重新生成完整世系数据：

```bash
python3 scripts/generate-person-tree.py
```
