# DSHAN Plugin P2P

DeepSeek Harness 桌面端与 DSHAN 手机之间的双向工具配对插件。开发者：**炽阳001** · [Bilibili](https://space.bilibili.com/404891612) · [GitHub](https://github.com/Chiyang001?tab=repositories)

支持 8 位配对码、二维码、WebRTC 直连和端到端加密 WebSocket 中继。桌面端「设置 → 连接」可创建配对码；手机可扫码或输入配对码自动连接，也可以由手机创建配对码。

## 安装

需要 Node.js 22 或更新版本与 DeepSeek Harness，已验证 Harness 0.1.7-rc.2、0.2.0-rc.2。手机使用 [DSHAN](https://github.com/Chiyang001/DSHAN) 内置插件。

在电脑的 Harness 插件管理页面安装 GitHub 仓库：

```text
https://github.com/Chiyang001/DSHAN_Plugin_P2P
```

启用插件后，在配置中填写配对服务器地址。服务器独立部署，电脑和手机无需运行 FRP。两端需要使用同一个服务器。

```yaml
- id: dsh-peer
  config:
    signalingServer: 'wss://your-domain/peer'
    connectionMode: auto
```

配置文件是 Harness profile 的 `cordis.patch.yml`，Windows 通常位于 `%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml`。已有配置时修改同一组件，避免重复插入。

也可以手动安装：

```sh
git clone https://github.com/Chiyang001/DSHAN_Plugin_P2P.git
cd DSHAN_Plugin_P2P
npm ci --omit=dev --ignore-scripts
```

通过 Harness 配置添加本地 `index.js` 路径并设置 `signalingServer`。使用 native 或 both 工具模式。

## 使用

1. 两端各打开一个会话。
2. 在「设置 → 连接」创建配对码，另一端扫码或输入 8 位码。配对码两分钟内有效；输入框保持单行，支持完整粘贴。
3. 连接成功后即可调用对方共享的工具。当前会话的可用工具默认共享，关闭会话或断开连接会撤销共享。
4. 手机工具依赖 DSHAN 内置的 ADB/Shizuku 桥接和相应控制权限，电脑不用另外安装 ADB。

连接页会根据手机或桌面显示对应文案，提供状态、二维码、连接方式和共享工具信息。

## 工具

- `peer_host`：生成配对码和二维码。
- `peer_join`：使用配对码加入。
- `peer_status`：查看状态。
- `peer_tools`：列出对方共享的工具。
- `peer_call`：调用对方工具。
- `peer_disconnect`：断开并撤销共享。

`tools` 是逗号分隔的工具名称；空字符串表示不接受远端工具调用。禁止共享 `peer_*`、通配符和 `run_code`，远端调用仍经过本机权限检查。

## 网络与服务器

`connectionMode` 支持 `auto`（默认，直连优先后回退加密中继）、`relay` 和 `p2p`。可另外配置 STUN/TURN。已有连接中的操作失败不会自动切换通道重试，避免重复执行。

默认使用域名解析，不要将特定网络下的 IP 写为通用默认值。`signalingAddress` 可用于明确需要的固定 IP 场景，保留域名 Host 和 HTTPS 证书验证。HTTP 注册和查询也支持该配置。

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

测试覆盖配对码注册、插件加载、权限、真实 WebRTC、加密中继、连接撤销和设置页。Android 真机验收：连续创建配对码 5 次成功，二维码与信令检查通过。
