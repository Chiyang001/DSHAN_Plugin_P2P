<p align="center"><a href="https://space.bilibili.com/404891612"><img src="assets/developer.png" width="112" height="112" alt="炽阳001" align="middle"></a><img src="assets/divider.svg" width="32" height="112" alt="分隔线" align="middle"><a href="https://github.com/Chiyang001/DSHAN_Plugin_P2P"><img src="assets/icon.png" width="112" height="112" alt="DSHAN P2P 插件 Logo" align="middle"></a></p>

<h1 align="center">DSHAN Plugin P2P</h1>
<p align="center"><strong>连接手机与电脑，让两端的工具协同工作。</strong></p>
<p align="center">DeepSeek Harness × DSHAN · 8 位配对码 · 二维码配对 · WebRTC · 加密中继</p>
<p align="center"><a href="#快速开始">快速开始</a> · <a href="#配对与使用">配对与使用</a> · <a href="#工具一览">工具一览</a> · <a href="#网络与服务器">网络配置</a></p>
<p align="center">开发者：<strong>炽阳001</strong> · <a href="https://space.bilibili.com/404891612">Bilibili</a> · <a href="https://github.com/Chiyang001?tab=repositories">GitHub</a></p>

---

## 两台设备，一个连接

在电脑上调用手机的截图、点击与输入工具，也可以在手机上调用电脑共享的文件和终端工具。两端使用同一套配对协议，在「设置 → 连接」中即可完成配对。

| 轻松配对 | 双向协作 | 自适应连接 |
| :--- | :--- | :--- |
| 扫描二维码，或输入 8 位配对码 | 调用另一端明确共享的工具 | 优先 WebRTC 直连，必要时加密中继 |
| 输入框保持单行，支持完整粘贴 | 远端操作经过本机权限检查 | 连接页显示实时状态与共享工具 |

## 快速开始

需要 Node.js 22 或更新版本与 DeepSeek Harness，当前开发测试使用 Harness 0.2.0-rc.2。手机使用 [DSHAN](https://github.com/Chiyang001/DSHAN) 1.2.8 内置插件。

在电脑的 Harness 插件管理页面安装 GitHub 仓库：

```text
https://github.com/Chiyang001/DSHAN_Plugin_P2P
```

启用后默认使用 DSHAN 配对服务器，无需手动填写地址。切换 profile 或配置为空时仍会使用默认地址；自定义服务器配置优先。电脑和手机需要使用同一个服务器。下面的配置仅用于自定义部署。

```yaml
- id: dsh-peer
  config:
    signalingServer: 'wss://your-domain/peer'
    connectionMode: auto
```

配置文件是 Harness profile 的 `cordis.patch.yml`，Windows 通常位于 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`。已有配置时修改同一组件，避免重复插入。

<details>
<summary><strong>手动安装方式</strong></summary>

```sh
git clone https://github.com/Chiyang001/DSHAN_Plugin_P2P.git
cd DSHAN_Plugin_P2P
npm ci --omit=dev --ignore-scripts
```

通过 Harness 配置添加本地 `index.js` 路径并设置 `signalingServer`。使用 native 或 both 工具模式。

</details>

## 配对与使用

1. 两端打开应用，在「设置 → 连接」配对；配对不要求先创建会话。
2. 在「设置 → 连接」创建配对码，另一端扫码或输入 8 位码。配对码两分钟内有效；输入框保持单行，支持完整粘贴。
3. 连接成功后即可调用对方共享的工具。设备连接独立于会话：删除、关闭或切换会话不会断开连接。设备当前可用工具默认共享，断开连接会撤销共享。
4. 手机工具依赖 DSHAN 内置的 ADB/Shizuku 桥接和相应控制权限，电脑不用另外安装 ADB。

连接页会根据手机或桌面显示对应文案，提供状态、二维码、连接方式和共享工具信息。

## 0.1.21 更新

- 同步 DSHAN 1.2.8 内置的连接插件，支持连接断开后的自动恢复和已认证设备接替旧连接。
- 消息历史中提供“联动消息”分类，两端可在原生对话界面继续同一段共享对话，同步流式回复、工具结果和历史记录。
- 联动对话支持置顶、重命名、归档及确认删除；离线操作保存在本机，重连后继续同步，发送结果不明时先核对而不重复执行。
- 联动对话自动准备执行工作区并使用完整工具权限；手机仍需满足 Android 系统授权。普通私人对话不会自动共享，远端调用仍经过本机权限流程。
- 复用原生输入框、附件、模型和思考强度控件，修复联动对话正文与工具记录补齐，并统一手机与电脑上的会话菜单。

升级后重新加载插件或重启 Harness。电脑插件和手机内置插件应一并升级；自动重连还需要支持恢复令牌的新版配对服务器。0.1.7 用户可以通过同一个 GitHub 安装地址更新。

## 工具一览

| 工具 | 用途 |
| :--- | :--- |
| `peer_host` | 创建配对码和二维码 |
| `peer_join` | 输入配对码加入连接 |
| `peer_status` | 查看连接状态 |
| `peer_tools` | 列出对方共享的工具 |
| `peer_call` | 调用对方工具 |
| `peer_disconnect` | 断开连接并撤销共享 |

`tools` 是逗号分隔的工具名称；空字符串表示不接受远端工具调用。禁止共享 `peer_*`、通配符和 `run_code`，远端调用仍经过本机权限检查。

## 网络与服务器

| 连接模式 | 行为 |
| :--- | :--- |
| `auto` · 默认 | 优先直连，未成功时回退到加密中继 |
| `relay` | 使用加密 WebSocket 中继 |
| `p2p` | 仅使用 WebRTC 直连 |

可另外配置 STUN/TURN。已有连接中的操作失败不会自动切换通道重试，避免重复执行。

默认使用域名解析，不要将特定网络下的 IP 写为通用默认值。已有安装若配置过 `signalingAddress`，请确认该 IP 在当前网络中可用；域名正常但固定 IP 连接重置或超时时，移除这一项并重启 Harness。`signalingAddress` 可用于明确需要的固定 IP 场景，保留域名 Host 和 HTTPS 证书验证。HTTP 注册和查询也支持该配置。

公网推荐 `wss://`；用户明确使用 HTTP/FRP 时可配置 `ws://`，工具调用需显式设置 `allow_http_signaling: true`。信令可见连接元数据，工具数据使用端到端加密。

服务端部署见 [DSHAN Server](https://github.com/Chiyang001/DSHAN/tree/main/Server)。本仓库的 `signal-server.js` 用于本地开发和协议测试：

```sh
npm run signal
```

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
```

0.1.21 的 71 项自动测试通过，覆盖插件加载、原生会话界面、联动消息、会话管理、真实 WebRTC、加密中继、断线重连、连接撤销及权限检查。此前 Android 真机验收中，连续创建配对码 5 次成功，二维码与信令检查通过；这条历史记录不代表本次完整真机复验。

---

<p align="center">由 <a href="https://space.bilibili.com/404891612">炽阳001</a> 开发 · 与 <a href="https://github.com/Chiyang001/DSHAN">DSHAN Android</a> 配合使用</p>

### 设备级连接（0.1.5）

配对、保持连接、列出远端工具与调用远端工具不再绑定某一个会话。删除全部会话时设备连接仍保持；没有可用执行上下文的工具暂时不可用。打开启用了工具的会话后可自动恢复，无需重新配对。每次执行仍使用当前有效上下文的本机权限流程；显式工具白名单仍生效，失败的操作不会自动重试。

### 默认配对服务器（0.1.6）

安装包与运行时均提供默认服务器 `ws://dshanp2p.chiyang001.top/peer`。未填写地址或地址为空白时自动使用默认值，显式工具参数和自定义 profile 地址优先。创建配对、加入配对与状态页使用一致的地址选择规则。

### 自动重连与网络恢复（0.1.7）

切换 Wi-Fi、移动流量或临时断网后，两端应用保持运行即可自动恢复，无需重新扫码。连接页显示“正在重连”；心跳每 15 秒检查信令和端到端通信，重试采用约 1、2、4、8、16、30 秒的退避并加入随机抖动。

每轮重建会刷新手机当前网络地址，重新协商 WebRTC 或端到端加密中继，并验证双方新的随机数。服务端为已配对设备保留最长 24 小时的离线恢复资格，恢复需要各端原有的独立随机令牌。8 位配对码仍为两分钟有效。

断线中的工具调用会报错，不会自动重放，避免重复点击或执行命令。手动断开会撤销共享并通知对端停止重连；客户端进程退出后需要重新配对。首次连接的自动重试等待期限为两分钟。

升级时需同时更新电脑插件、手机内置插件和 [DSHAN Server](https://github.com/Chiyang001/DSHAN/tree/main/Server)，并重启 Python 服务加载新协议。

2026-10-21 已使用 OPPO PKQ110、Android 16 的正式 Release APK 与真实电脑 Harness，通过公网完成 auto/relay 两轮切网验收。Wi-Fi 与移动流量切换、完全断网 45 秒后的自动恢复、双向工具调用及手动断开停止重连均通过。完全断线后恢复 Wi-Fi，本次约 21–30 秒恢复，包含轮询及双向调用校验；不同网络耗时会变化。
