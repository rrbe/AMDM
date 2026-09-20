# 更新日志

[English](CHANGELOG.md)

<!-- Generated from published release tags and translated commit entries. Dates follow the tagged commits. -->

## [v26.9.4](https://github.com/rrbe/AMDM/releases/tag/v26.9.4) — 2026-09-20

### 新功能

- 固定表格中的文档 ID 列，并改进预览标题（\#24）
- 通过右键菜单管理查询标签页

### 修复

- 本地安装复用已下载的 Electron，最低支持 macOS 12
- 右键菜单打开时保持对应查询标签页高亮
- 改进查询工具栏操作提示和禁用状态
- 侧边栏仅显示应用版本号

## [v26.9.3](https://github.com/rrbe/AMDM/releases/tag/v26.9.3) — 2026-09-15

### 新功能

- 调整标签页宽度，并显示结果数据大小和保留提示
- 新增界面过渡动效和资源浏览器行内搜索
- 为更新日志和 Sparkle 更新说明提供中英文版本

### 修复

- 优化资源浏览器导航过渡并保留焦点

## [v26.9.2](https://github.com/rrbe/AMDM/releases/tag/v26.9.2) — 2026-09-13

### 新功能

- 新增嵌套表格自动展示和设置预览
- 根据提交记录生成更新日志和 Sparkle 发布说明
- 新增表格分组表头和显示设置
- 在表格单元格中预览嵌套值
- 支持按查询标签页保存表格列拖拽排序
- 新增带确认的集合删除操作
- 在标签页提示中显示查询的相对时间
- 支持拖拽排序查询标签页和结果标签页

### 修复

- 保留 Sparkle 历史安装包所属版本的下载地址
- 按数据标签页隔离结果视图
- 关闭窗口前优先关闭查询标签页
- 将查询上下文开关移至顶部标签栏
- 改善玻璃效果菜单的可读性

### 其他更新

- 为中英文 README 添加 AMDM 截图

## [v26.9.1](https://github.com/rrbe/AMDM/releases/tag/v26.9.1) — 2026-09-11

### 新功能

- 支持选择 mongosh 查询运行时
- 新增跨平台增量更新

### 修复

- 明确断开连接的标签页状态并统一视图切换控件圆角

### 其他更新

- 更新 TODO
- 优化右键菜单玻璃效果

## [v26.8.17](https://github.com/rrbe/AMDM/releases/tag/v26.8.17) — 2026-08-31

### 新功能

- 扩展文档导入导出格式

### 修复

- 优化 JSON 格式菜单
- 明确结果复制菜单文案
- 支持快捷键复制当前聚焦的表格单元格

## [v26.8.16](https://github.com/rrbe/AMDM/releases/tag/v26.8.16) — 2026-08-24

### 新功能

- 显示与标签页上下文对应的快捷键
- 集中管理应用通知
- 区分连接和查询失败类型
- 支持配置导出目录
- 支持从成功通知打开导出文件

### 修复

- 将结果视图状态限定在各自的查询标签页内
- 在标签页提示中显示准确的查询上下文
- 完善自动更新检查
- 允许断开处于错误状态的连接

### 其他更新

- 更新 README 使用说明和许可证
- 采用 GPL\-3\.0\-only 许可证

## [v26.8.15](https://github.com/rrbe/AMDM/releases/tag/v26.8.15) — 2026-08-18

### 新功能

- 新增文档预览操作
- 优化提示和查询控件

### 修复

- 刷新并突出显示可用更新

### 其他更新

- 优化提示的外观和位置

## [v26.8.14](https://github.com/rrbe/AMDM/releases/tag/v26.8.14) — 2026-08-17

### 修复

- 移除复选框焦点环

### 其他更新

- 优化按钮和复选框样式
- 优化查询搜索和焦点样式
- 简化查询右键菜单

## [v26.8.13](https://github.com/rrbe/AMDM/releases/tag/v26.8.13) — 2026-08-15

### 新功能

- 新增表格结果排序（\#21）
- 为已保存查询的预览添加语法高亮（\#20）
- 新增按上下文运行查询的编辑器侧栏（\#19）
- 新增索引刷新操作

### 修复

- 避免目录加载时闪烁

## [v26.8.12](https://github.com/rrbe/AMDM/releases/tag/v26.8.12) — 2026-08-14

### 新功能

- 统一集合和结果导出
- 支持自定义键盘快捷键

### 修复

- 升级 Electron 和安全相关依赖

### 其他更新

- 升级应用依赖
- 重新组织工程文档

## [v26.8.11](https://github.com/rrbe/AMDM/releases/tag/v26.8.11) — 2026-08-13

### 新功能

- 新增温和的更新提醒

### 修复

- 显示定时检查发现的更新提示

## [v26.8.10](https://github.com/rrbe/AMDM/releases/tag/v26.8.10) — 2026-08-13

### 新功能

- 支持查看和复制集合索引
- 刷新集合元数据
- 显示查询时间戳

### 修复

- 连接断开后保留查询标签页

## [v26.8.9](https://github.com/rrbe/AMDM/releases/tag/v26.8.9) — 2026-08-11

### 新功能

- 新增数据字号设置
- 支持自定义编辑器配色

### 修复

- 将设置窗口置于前台

## [v26.8.8](https://github.com/rrbe/AMDM/releases/tag/v26.8.8) — 2026-08-10

### 新功能

- 新增 Schema 分析和建模
- 新增嵌套结果右键菜单

### 修复

- 允许复制反馈文本
- 开发时监听 Electron 进程变化

## [v26.8.7](https://github.com/rrbe/AMDM/releases/tag/v26.8.7) — 2026-08-09

### 新功能

- 增强 Shell 编辑器补全
- 优化资源管理器和历史记录设置
- 新增查询超时设置并改善停止执行的可靠性
- 显示目录统计信息

### 修复

- 禁用选中文本的匹配高亮
- 在 macOS 安装前停止应用

## [v26.8.6](https://github.com/rrbe/AMDM/releases/tag/v26.8.6) — 2026-08-07

### 新功能

- 持久化连接排序

### 修复

- 移除弹窗背景模糊
- 通过右键菜单进入单元格编辑
- 将用户列表移至集合列表之后

### 其他更新

- 复用可调整尺寸的弹窗
- 精简打包脚本

## [v26.8.5](https://github.com/rrbe/AMDM/releases/tag/v26.8.5) — 2026-08-07

### 新功能

- 改善结果字段浏览
- 按连接为标签页着色
- 应用中性 UI 设计系统
- 完善连接选项
- 优化连接设置表单交互
- 重构设置窗口并优化版本标识

### 修复

- 优化资源管理器操作
- 完善连接反馈和目录刷新
- 支持多成员 MongoDB 连接地址

### 其他更新

- 确定中性 UI 设计方向
- 修复打包问题
- 精简项目文档

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
- 将 UI 改为以浅色优先的 Pine 设计，并支持深色模式
- 将连接与目录合并为统一的资源管理器树
- 首个 MVP：轻量 MongoDB Shell 图形界面

### 修复

- 完善 Sparkle ad\-hoc 发布链路
- 调整结果复制格式文案
- 修复结果复制行为
- 优化窗口拖拽和提示行为
- 固定用户目录英文标签
- 支持取消正在建立的连接
- 修复 shell 选区执行
- 将标签页绑定到连接（\#18）
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

- 将 BSON → EJSON 序列化和字段采样移至 Worker

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
- 清理构建和仓库文件
- 升级版本至 0\.4\.0（\#13）
- 样式拆分 \+ 引入 CSS Module 范本 \+ 文档整理 \(\#11\)
- 升级 electron\-vite 至 v5、Vite 至 v7、Vitest 至 v4（\#6）
- 升级版本至 0\.3\.1（\#3）
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
