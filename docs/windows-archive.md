# Windows Codex 归档

会话行的归档按钮通过本机 `codex.exe app-server --stdio` 的正式
`thread/archive` 协议归档指定聊天。成功后重新扫描 Codex 活动记录并刷新看板；
不打开 Codex、不修改数据库、不写入看板本地隐藏列表，也不自动删除短对话。
归档后的聊天可在 Codex 的已归档聊天中恢复。

实际边界：桌面已加载的聊天即使处于 idle、已经交付，也可能保持 writer。
独立 app-server 此时返回 `already has an active writer`，CCBoard 不具备释放另一个
服务的权限。本机桌面使用 stdio，未公开可供 CCBoard 连接的 owner 端点；
`app-server proxy --sock` 只能连接已有明确 socket，另起 daemon 不能接管旧 owner。
桌面内的 app-tools 插件依赖注入的私有 pipe 和执行上下文，不作为 CCBoard 公共接口。
遇到此错误，API 返回 `CODEX_WRITER_OWNED`，所有存档入口显示持续可见的恢复说明，
保留聊天、不自动跳转或重试。可在 Codex 桌面归档，或等其他任务结束后正常退出
持有聊天的 Codex 应用，再从 CCBoard 重试。仅切换聊天或 unsubscribe 不保证释放。
不会强杀用户进程、改数据库或删除锁。此版本没有解决跨 owner 直接归档能力。

`node test/codex-writer.test.mjs` 使用隔离 HOME 和两个真实 CLI 服务，验证 idle
持锁冲突、同 owner 归档及服务释放后的重试；这不等于真实桌面聊天验收。

仍在运行的会话会被拒绝（即使请求带 `force`）：请等待结束，或在原 Codex
聊天中停止后再归档。看板的运行状态来自记录，不能替代 Codex 桌面的实时状态。
找不到 CLI、服务退出、协议错误和超时都会显示错误；超时后请刷新确认实际状态。

验证：在 Windows 上运行 `node test/codex-archive.test.mjs`。需要 PATH 中的
`codex.exe`；测试只在 `D:\ChatGPT-Temp` 的独立目录生成假主目录和合成会话，
使用独立端口 14847，不归档真实用户聊天。覆盖正式协议、鉴权、错误、运行中保护、
连续归档不触发假崩溃、列表刷新及 UI 重复点击。现有 macOS 测试含 Unix 路径与
系统工具，不能直接作为 Windows 验证。

从隔离 worktree 应用到现有入口时，先核对源文件仍与修改前一致并备份，
再更新 `server.mjs`、`ui.html`、`codex-rpc.mjs`（新增），以及测试、本文和
`build.sh` 的模块打包清单。只重启已确认属于该目录的 CCBoard 服务；
`Start-CCBoard.ps1` 启动的是它所在目录的 `server.mjs`，不会自动使用 worktree。
重启不终止 Codex 聊天。浏览器现有页面需刷新一次加载新按钮处理代码。

组织图的层级卡片直接显示“存档”；放射图移到节点上或用键盘聚焦后，
同一浮层显示“存档”和“回顾进展”。存档中禁用重复点击，成功刷新节点与中央计数；
失败保留卡片并提示。运行中的聊天仍须先停止或等待结束，存档不会终止任务。
`node test/org-archive.test.mjs` 用合成 API 和真实 Chromium 验证这些交互，不操作真实聊天。
