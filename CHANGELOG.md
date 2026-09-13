# Changelog

<!-- Generated from published release tags and Git commits. Dates follow the tagged commits. -->

## [v26.9.2](https://github.com/rrbe/AMDM/releases/tag/v26.9.2) — 2026-09-13

### 新功能

- add automatic nested table display and settings preview
- generate commit\-based changelog and Sparkle release notes
- add grouped table headers and display setting
- preview nested values in table cells
- support table column drag sorting per query tab
- add confirmed collection deletion
- show relative query times in tab tooltips
- support drag sorting for query and result tabs

### 修复

- preserve historical Sparkle archive release URLs
- isolate result view per data tab
- close query tab before closing window
- move context toggle to top tab bar
- improve glass menu readability

### 其他更新

- add AMDM screenshots to bilingual readmes

## [v26.9.1](https://github.com/rrbe/AMDM/releases/tag/v26.9.1) — 2026-09-11

### 新功能

- add selectable mongosh query runtime
- add cross\-platform differential updates

### 修复

- clarify disconnected tabs and align view switch corners

### 其他更新

- update TODO
- refine context menu glass effect

## [v26.8.17](https://github.com/rrbe/AMDM/releases/tag/v26.8.17) — 2026-08-31

### 新功能

- expand document transfer formats

### 修复

- refine JSON format menus
- clarify result copy menu
- copy focused table cell with shortcut

## [v26.8.16](https://github.com/rrbe/AMDM/releases/tag/v26.8.16) — 2026-08-24

### 新功能

- reveal contextual tab shortcuts
- centralize app notifications
- classify connection and query failures
- configure export destination
- open exported files from success notice

### 修复

- keep result views scoped to query tabs
- show exact query context in tab tooltips
- improve automatic update checks
- allow disconnecting errored connections

### 其他更新

- update readme usage and license
- adopt gpl\-3\.0\-only license

## [v26.8.15](https://github.com/rrbe/AMDM/releases/tag/v26.8.15) — 2026-08-18

### 新功能

- add document preview actions
- refine tooltips and query controls

### 修复

- refresh and highlight available updates

### 其他更新

- refine tooltip appearance and placement

## [v26.8.14](https://github.com/rrbe/AMDM/releases/tag/v26.8.14) — 2026-08-17

### 修复

- remove checkbox focus rings

### 其他更新

- refine button and checkbox treatments
- refine query search and focus styles
- simplify query context menu

## [v26.8.13](https://github.com/rrbe/AMDM/releases/tag/v26.8.13) — 2026-08-15

### 新功能

- add table result sorting \(\#21\)
- highlight saved query previews \(\#20\)
- add contextual query run gutter \(\#19\)
- add indexes refresh action

### 修复

- avoid catalog loading flicker

## [v26.8.12](https://github.com/rrbe/AMDM/releases/tag/v26.8.12) — 2026-08-14

### 新功能

- add unified collection and result exports
- add configurable keyboard shortcuts

### 修复

- upgrade electron and security dependencies

### 其他更新

- upgrade application dependencies
- reorganize engineering documentation

## [v26.8.11](https://github.com/rrbe/AMDM/releases/tag/v26.8.11) — 2026-08-13

### 新功能

- add gentle update reminders

### 修复

- show scheduled update prompt

## [v26.8.10](https://github.com/rrbe/AMDM/releases/tag/v26.8.10) — 2026-08-13

### 新功能

- inspect and copy collection indexes
- refresh collection metadata
- show query timestamps

### 修复

- preserve query tabs across connection loss

## [v26.8.9](https://github.com/rrbe/AMDM/releases/tag/v26.8.9) — 2026-08-11

### 新功能

- add data font size setting
- add customizable editor color schemes

### 修复

- bring settings window to front

## [v26.8.8](https://github.com/rrbe/AMDM/releases/tag/v26.8.8) — 2026-08-10

### 新功能

- add schema analysis and modeling
- add nested result context menus

### 修复

- make feedback text copyable
- watch electron process during development

## [v26.8.7](https://github.com/rrbe/AMDM/releases/tag/v26.8.7) — 2026-08-09

### 新功能

- enhance shell editor completion
- refine explorer and history settings
- add query timeout and reliable stopping
- show catalog statistics

### 修复

- disable selection match highlighting
- stop app before mac install

## [v26.8.6](https://github.com/rrbe/AMDM/releases/tag/v26.8.6) — 2026-08-07

### 新功能

- persist connection ordering

### 修复

- remove modal backdrop blur
- require context menu for cell editing
- move users after collections

### 其他更新

- reuse resizable modal
- streamline package scripts

## [v26.8.5](https://github.com/rrbe/AMDM/releases/tag/v26.8.5) — 2026-08-07

### 新功能

- improve result field browsing
- color tabs by connection
- apply neutral ui design system
- improve connection options
- 优化连接设置表单交互
- 重构设置窗口并优化版本标识

### 修复

- refine explorer actions
- 完善连接反馈和目录刷新
- 支持多成员 MongoDB 连接地址

### 其他更新

- define neutral ui design direction
- fix pack bug
- simplify project documentation

## [v26.8.4](https://github.com/rrbe/AMDM/releases/tag/v26.8.4) — 2026-08-03

### 新功能

- 加入 Sparkle 自动更新机制
- 优化结果工具栏交互
- 重做侧栏导航和查询跳转
- 首次打开集合自动执行默认查询
- 添加查询标签执行状态指示
- 调整构建版本号格式
- 重做应用三栏视觉
- 缩小默认编辑区高度
- 突出查询运行状态
- 显示构建号
- UI 重做迁移到 Tailwind v4 \+ shadcn\(zinc\+蓝\) \(\#17\)
- SSH 隧道 — 主机密钥校验 \+ 跳板机\(ProxyJump\) \+ 逐跳连通性检测 \+ 健壮性
- 记忆并恢复原生全屏态 \(\#16\)
- 记住并恢复上次的窗口大小/位置 \(\#15\)
- mongo shell 补全增强 — 类型感知 / REPL / 排序 / snippet \(\#12\)
- 侧边栏精修 — sticky 滚动、连接行右键菜单、查询与历史拆分 \(\#10\)
- 聚合管道可视化构建器 \(\#9\)
- explain 阶段树改为图形化连线盒子树 \(\#8\)
- BSON 导入导出改为进程内原生处理,移除 mongodump/mongorestore 依赖 \(\#7\)
- 浏览集合落到独立 query tab,不再覆盖用户编辑的代码 \(\#5\)
- 隐式 await——mongosh 多步脚本原样粘贴可跑\(async\-rewriter2\)
- 捕获 shell print 输出并新增 Console 结果视图
- 结果区多 tab——每次运行落入新 result tab，可切换/关闭
- 新增 components/ui 封装层（基于 @base\-ui/react）
- 接入 @base\-ui/react 并加 isolation 基线
- 统一全宽顶部标题栏并补全结果区 ⌘C 复制
- 整体改为 Slate 中性专业配色,弃用 Compass 绿调水泥灰
- 连接编辑拆分 From URL / To URL 为两个单向小弹窗
- 多语言\(zh\-CN/en/zh\-TW\)\+集中式设置界面
- 运行时窗口与 macOS dock 图标
- 添加应用图标\(\{ ⋯ \} BSON 文档\)
- 多查询标签页\(每 tab 独立 code/result/运行\)
- 连接配置导出/备份\(密钥不导出\)
- 保存查询支持文件夹/两级组织
- 统一样式化 tooltip,替换原生 title=
- 编辑器偏好\(字号/自动换行/Tab 宽度\)
- 停止执行 / Stop Script\(driver AbortSignal 取消\)
- 结果区补齐应用级多选/选行，替代被禁用的原生选区
- 结果翻页 \+ 每页条数可配置
- 按钮宽度跨状态恒定，移除运行提示文案
- 编辑器区域右键菜单，对齐 NoSQLBooster
- Tree 类型列按类型上色，与值同色
- Tree view 第三列 Type，显示每行值的 BSON 类型
- 行内编辑校验失败时透出原因（红框 \+ 悬停提示）
- 结果视图双击行内编辑，编辑/删除入口改右键菜单
- 复制格式对齐 NoSQLBooster（去重），新增 CSV/TSV 表格导出
- 结果视图复制能力（Tree/JSON/Table，三种格式）
- 数据库列表对齐 Compass，补全授权但为空的库
- 侧栏与编辑器可拖动调整尺寸，修复 header 底边错位
- shell 引擎补全 mongosh 语法并加真实 MongoDB 集成测试
- 侧栏内置 Saved Queries 抽屉，移除顶部 Library 按钮
- 编辑器格式化快捷键 \+ 主题跟随系统修复
- 主题支持跟随系统（三态循环），侧栏标题改为 Mongo Shell GUI
- 配色与字体对齐 MongoDB Compass（LeafyGreen）
- Table 结果视图列宽可拖拽，改用虚线网格、行号从 1 起
- 结果视图支持 ⌘1/2/3 快捷切换 Tree/JSON/Table
- JSON 结果视图语法高亮
- Tree 结果视图改为两列 key/value 布局
- explorer 图标改用 lucide，导入导出改右键菜单
- retheme UI to light\-first Pine design with dark mode
- merge connections \+ catalog into one explorer tree
- initial MVP — lean MongoDB shell GUI

### 修复

- 完善 Sparkle ad\-hoc 发布链路
- 调整结果复制格式文案
- 修复结果复制行为
- 优化窗口拖拽和提示行为
- 固定用户目录英文标签
- 支持取消正在建立的连接
- 修复 shell 选区执行
- bind tabs to connections \(\#18\)
- driver 超时放宽到 30s,避免慢查询被心跳超时误杀 \(\#4\)
- sort 异步比较器响亮报错,并清理评审遗留小项 \(\#2\)
- 驱动返回的数组支持异步回调的 forEach/map 等迭代方法 \(\#1\)
- 安装 @babel/preset\-typescript 供 rollup 内联,修复打包后启动崩溃
- 内联 @mongosh/async\-rewriter2 修复打包后启动崩溃
- 结果网格点击后 ⌘C 因编辑器残留选区而失效
- 同步 pnpm\-lock 中 @base\-ui/react 的 specifier
- 打包后启动崩溃,改为内联打包 exceljs
- 构建支持 Intel x64,修正 ADR 中 arm64\-only 误读与无据断言
- release workflow 直接调 electron\-builder,修复 \-\-publish never 失效
- 修复 CI pnpm 版本冲突\(改由 packageManager 字段决定\)
- 关闭编辑器内容区的 macOS 自动更正/拼写检查
- 抽离 docOps/catalog 内核并修复 \_id 与数值类型保真
- 统一 ejson 扩展类型判定并修复空容器渲染
- 网格点击夺取焦点，修复多选后 ⌘C 不复制
- 结果网格禁用原生文本选区，交回应用选择模型
- toast 改不透明并支持多语义，去掉透明度透字 bug
- 空库占位提示改为灰斜体且不可点，两条 admin 命令并行
- shell 支持无 new 的 ObjectId\(\) 构造器与 cursor\.projection\(\)

### 性能优化

- offload BSON→EJSON serialization and field sampling to a worker

### 其他更新

- 调整版本号和构建标识
- 升级 typescript 和 vite
- 精简连接与查询工作区
- 升级版本至 0\.5\.0
- 收口暗黑模式视觉
- 固定连接目录英文术语
- 延迟并右置 tooltip
- 简化界面排版与阴影
- 移除独立窗口标题栏
- clean up build and repository files
- bump version to 0\.4\.0 \(\#13\)
- 样式拆分 \+ 引入 CSS Module 范本 \+ 文档整理 \(\#11\)
- upgrade electron\-vite to v5, vite to v7, vitest to v4 \(\#6\)
- bump version to 0\.3\.1 \(\#3\)
- dist:dir 跳过证书签名,本地打包用 ad\-hoc 提速
- CLAUDE\.md 记录主进程新依赖须内联以绕开 electron\-builder 收集器丢包
- dev 模式把 store 暴露为 window\.\_\_appStore 便于调试复现
- 强化 result tab 激活态——accent 顶条\+加粗,未激活降噪
- Base UI 迁移收尾——删死 CSS 并补 DESIGN\.md 文档
- 连接表单整体迁移到 Base UI（Tabs/Field/Input/Select/Checkbox/Dialog）
- 右键菜单统一到 Base UI Menu（ContextMenu 内部重写,API 不变）
- 设置/保存查询表单迁移到 Base UI Field/Input/Select/Checkbox
- 工作区选库迁移到 ui/Select
- 弹窗统一到 Base UI Dialog（Modal 内部重写,API 不变）
- 发布 v0\.2\.1
- 新增 Base UI 迁移计划\(可直接开工的执行文档\)
- 升级 GitHub Actions 至最新主版本并切到 Node 22
- 新增 release workflow,打 tag 触发跨平台打包 \+ 创建 Release
- 精简 README 并新增中文版 README\_CN
- 移除 UI 文案的强制大写，标题/列头改 Title Case
- 发布准备\(LICENSE \+ README 刷新 \+ 商标免责声明\)
- 项目更名为 AMDM \(Another Mongo Desktop Manager\)
- 添加 electron\-builder 打包配置
- 补齐契约/单元/集成测试覆盖
- 抽离选择逻辑为纯函数 computeSelection
- 搭建测试框架与 CI\(分层/脚本/覆盖率/约定\)
- 新增 TODO\.md 路线图（经代码核对的 backlog，纠正 SPEC §4 过时项）
- 文字动作按钮收口到 &lt;Button&gt; 组件
- 移除复制的「已复制」toast 与 JSON 全选提示条
- 重构 side panel 间距、排版与连接字体
- 新增 DESIGN\.md（Pine 设计系统文档）
- 新增 CLAUDE\.md，记录架构、命令与项目协作规则
