# 游戏架 · 工程规范（AGENTS.md）

本文件是仓库唯一的规范来源。Codex 直接读取本文件；Claude Code 通过根目录 `CLAUDE.md` 导入。
修改规则只改本文件，不要在两个文件里各写一份。

## 1. 项目定位

- 纯前端游戏合集：**零依赖、零构建**。浏览器代码只用原生 HTML/CSS/JS（ES5 语法），双击 `index.html` 就能玩。
- 根目录 `index.html` 是**唯一总入口**：所有游戏都必须能从这张页面点进去。
- 联机由零依赖 Node 服务 `server/serve.js` 和共用客户端 `shared/room.js` 提供；单人不依赖服务端。
- 面向桌面和手机浏览器，界面文案用中文。

## 2. 目录结构（固定）

```text
game/                     仓库根目录
├─ index.html             唯一总入口：游戏卡片列表
├─ games/                 所有游戏，一个游戏一个子目录
│  ├─ neon-runner/        游戏 1：霓虹疾走
│  │  └─ index.html       游戏入口（单文件，CSS/JS 全内联）
│  └─ sokoban/            游戏 2：推箱子
│     ├─ index.html       游戏入口（单文件）
│     └─ levels.js        关卡数据（游戏与校验脚本共用）
├─ shared/
│  └─ room.js             公用联机房间客户端（所有游戏共用）
├─ server/
│  └─ serve.js            静态服务 + 房间 API（运行时）
├─ tools/                 开发与自测脚本（不对外提供）
│  ├─ solver.js           推箱子求解器
│  ├─ verify-levels.js    关卡校验
│  ├─ gen-levels.js       关卡生成
│  ├─ cdp-lib.js          Chrome CDP 自测工具
│  └─ test-*.js           自测脚本
├─ serve-games.bat        一键启动内网服务
├─ README.md              面向玩家的说明
├─ AGENTS.md              本规范（Codex / 唯一规则源）
└─ CLAUDE.md              Claude Code 规范入口
```

### 2.1 目录规则

1. **所有游戏统一放在 `games/` 下，一个游戏一个子目录**，目录名小写 kebab-case（如 `neon-runner`），目录内必须有 `index.html` 作为入口。
2. 游戏目录之间不得互相引用、跳转或共享文件；共享代码只能放 `shared/`。页面用相对路径 `../../shared/room.js` 引入，兼容 `file://` 和子路径托管（联机 API 仍只在服务端可用）。
3. `server/` 是运行时服务，`tools/` 是开发脚本；两者都不得被浏览器页面引用，也不得加入服务端静态白名单。
4. 不允许出现 `node_modules/`、`dist/`、`build/`、构建配置等依赖或产物。
5. 新增 / 重命名 / 删除游戏目录时，必须同步更新：根 `index.html`、`server/serve.js` 的 `ALLOWED_DIRS` / `GAMES`、`README.md`、相关测试与截图路径。

### 2.2 入口规则

1. 根 `index.html` 是唯一导航入口；每个游戏必须在这里有且只有一张卡片。
2. 卡片包含：内联 SVG 封面、`kicker`、中文标题、简介、标签、`href="games/<game>/index.html"`。
3. 游戏 URL 统一为 `/games/<game>/`，根入口是 `/`。
4. 游戏页面可以被邀请链接直接打开（`?room=CODE`），但不得在游戏之间互相跳转；返回请用浏览器后退或回根入口。
5. 新增游戏时，根入口的数量词文案（"两款游戏"等）和 README 必须同步。

## 3. 新增游戏检查清单

- [ ] 新建 `games/<game>/index.html`，单人模式在 `file://` 下可玩
- [ ] 根 `index.html` 增加游戏卡片
- [ ] `server/serve.js` 的 `ALLOWED_DIRS` 加入 `games/<game>`；联机游戏还需加入 `GAMES`
- [ ] `README.md` 更新游戏表、操作说明、目录树
- [ ] 联机游戏复用 `shared/room.js`，不新增房间 API
- [ ] 自测脚本放 `tools/test-<game>-*.js`，且全部通过
- [ ] 截图放 `games/<game>/preview*.png`，单张 < 500 KB
- [ ] 手动冒烟：桌面宽度 + 手机宽度（约 390px）+ `file://` 直开

## 4. 浏览器端技术约束

- 只用原生 HTML/CSS/JS，**ES5 语法**（`var` + `function`，不用 `let` / `const` / 箭头函数 / 模板字符串 / `class`）。这是现有代码的实际基线。
- 不用框架、不用打包器、不用 TypeScript、不引入任何 npm 依赖。
- 不引用 CDN、外部字体、外部图片、音频文件；图片用内联 SVG 或 Canvas 现画，音效用 WebAudio 合成。
- 每个游戏优先保持单文件：HTML + CSS + JS 内联；只有被多方共用的数据 / 代码才拆出去（如 `games/sokoban/levels.js`、`shared/room.js`）。
- 引入共用联机脚本统一用相对路径 `../../shared/room.js`，不要用根绝对路径，保证 `file://` 与 GitHub Pages 子路径下也能加载。
- 单人玩法必须在 `file://` 直接双击时可用；联机脚本加载失败不得影响单人。
- 必须适配手机：`viewport` 元信息、触屏操作、Canvas 按 `devicePixelRatio` 缩放、窄屏不溢出。
- 键盘操作同时支持方向键与 WASD（按各游戏现有约定），不引入鼠标独占的操作。

## 5. 联机规范

- 房间规则全项目统一，实现在 `server/serve.js` + `shared/room.js`，禁止游戏各写一套。
- 每房间最多 2 人；先到者为房主，其他人准备，房主开局；服务端统一下发约 3 秒倒计时和同一随机种子。
- 结果由服务端裁定并广播；客户端通过 `room.report()` 上报状态，不自行宣布胜负。
- 游戏 id 必须与目录名一致（如 `neon-runner`），并注册到 `GAMES`。
- 断线 / 退出按弃权处理；重连宽限由服务端统一控制，游戏侧不要另做一套。
- 联机界面由 `room.js` 提供，游戏只实现 `onStart` / `onSnapshot` / `onEnd` 等回调。

## 6. 推箱子关卡规范

- 关卡唯一数据源是 `games/sokoban/levels.js`，同时供浏览器和 Node 使用（`window.SOKOBAN_LEVELS` + `module.exports`）。
- 每次改关卡必须跑 `node tools/verify-levels.js`；`par` 必须等于求解器算出的最优推数，禁止手填。
- 新关卡先用 `node tools/gen-levels.js` 生成候选或手工设计，再由求解器证明可解。
- 求解器的剪枝（角落、贴墙、2×2 死锁）不得为了性能随意放宽，否则会漏解或算错 `par`。
- 关卡数变化时，同步更新根入口文案、README 表格与"最优推数"列表。

## 7. 代码风格

- 浏览器代码：IIFE + `'use strict'`；2 空格缩进；单引号；语句结尾分号；变量声明用 `var`。
- Node 脚本：CommonJS `require`，可用现代语法（`const` / `let` / 箭头函数），仍保持零依赖。
- 命名：变量 / 函数 camelCase，常量 UPPER_SNAKE_CASE，CSS 类名小写连字符。
- 注释写中文，解释"为什么"而不是复述代码；公开接口在文件头写用法示例。
- `localStorage` 键统一为 `<game>.<用途>.v<版本>`（如 `neonrun.best.v2`、`sokoban.records.v1`），读取时做容错。
- 全局变量只允许约定的入口（`window.GameRoom`、`window.SOKOBAN_LEVELS`）；调试钩子用 `window.__<game>*` 前缀，且不得参与正式逻辑。
- 动画用 `requestAnimationFrame`；热路径避免每帧分配对象；尺寸变化时重算布局。

## 8. 测试与验收

| 改动 | 必须运行 |
|---|---|
| 推箱子关卡 | `node tools/verify-levels.js` |
| 房间 / 服务端 | `node tools/test-room.js` |
| 跑酷联机 | `node tools/test-net.js` |
| 推箱子联机 | `node tools/test-sokoban-net.js` |
| 任何浏览器页面 | 手动双击 `index.html` 冒烟：入口 → 游戏 → 操作 |

- 联机自测依赖本机 Chrome（默认 `C:/Program Files/Google/Chrome/Application/chrome.exe`，可用 `CHROME` 环境变量覆盖）。测试会生成 `preview*.png`，属于预期产物。
- 推送前所有相关测试必须通过；失败要在回复里如实说明，不得跳过或伪造结果。
- 新增 / 修改功能后，`file://` 单人、内网 `serve-games.bat`、移动端宽度三种场景都要过一遍。

## 9. 文档同步

- `README.md` 是玩家侧唯一说明：游戏列表、操作、关卡数、启动方式、目录树必须与实际一致。
- 根 `index.html` 的文案与 README 必须一致（数量词、标签、玩法描述）。
- 截图必须由真实运行产生（自测脚本或实际截图），不要手绘冒充实机画面。
- 新规则或约束变更只改本文件（`AGENTS.md`）。

## 10. Git 与推送

- 提交信息格式：`<type>: <中文简述>`，type 取 `feat` / `fix` / `docs` / `test` / `refactor` / `chore`。
- 本仓库是个人项目，允许直接提交并推送到 `main`；推送前必须确认相关测试通过。
- 不提交：`node_modules/`、临时文件、日志、密钥、超过 500 KB 的二进制资源（截图除外）。
- 一次提交只做一件事；重构与功能改动分开提交。

## 11. 明令禁止

- 引入框架、打包器、npm 依赖、CDN 资源或构建步骤。
- 破坏 `file://` 单人玩法。
- 在游戏目录之间复制 / 引用代码，或绕过 `shared/room.js` 另写房间协议。
- 手改 `par`、提交未经求解器验证的关卡。
- 把 `tools/` 或白名单外目录暴露给浏览器。
- 新增游戏但不加根入口卡片，或多个游戏挤在一个目录。
- 泄露密钥、令牌，或提交大体积二进制文件。
