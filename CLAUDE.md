# CLAUDE.md

本仓库的通用规范以 `AGENTS.md` 为唯一来源，下面是完整导入。规则有变更时只改 `AGENTS.md`，不要在这里重复维护。

@AGENTS.md

## Claude Code 专属约定

- 回复、文档、提交信息使用中文（代码标识符用英文）。
- 提交信息结尾保留：

  ```text
  Co-Authored-By: Claude Code <noreply@anthropic.com>
  ```

- 改完代码后按 `AGENTS.md` 第 8 节运行相关测试，并在最终回复里说明跑了哪些、结果如何；测试失败必须如实报告。
- 本仓库允许直接提交并推送 `main`（个人项目）。只有用户明确要求时才新建分支或开 PR。
- 未经用户确认，不要开启 GitHub Pages、修改仓库设置、改写 git 历史或强制推送。
