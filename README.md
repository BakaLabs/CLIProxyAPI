# CLIProxyAPI

[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的 fork，仅包含以下功能改动：

- 自定义模型不再钳制思考等级：移除配置中按模型声明 `thinking` 能力的覆盖，客户端请求的思考等级原样透传到上游，不再被限制为默认的 low/medium/high。
- 思考等级跨协议转换时原样传递：OpenAI/Codex 的 effort 等级直接映射为 Claude 自适应思考强度（`xhigh`/`max` 视为 high），`auto` 则不注入思考配置、沿用上游默认行为。
- 独立的请求元数据数据库（`observability.request-db`）：基于本地 SQLite（纯 Go 驱动）按请求记录 token、模型、思考等级、服务层级、响应头、延迟等元数据，消息体默认完全不存储，blob 字段 zstd 压缩；支持保留期自动清理，并通过 `/v8/management/observability/request-db/records` 分页查询，用于后续用量统计与分析。与自带的 `request-log` 文件日志相互独立。
- 内嵌式管理仪表板（pnpm + React + shadcn/ui，编译期 `go:embed` 进二进制）：打开 `/management.html` 即用，无需运行时从 GitHub 下载。功能覆盖原版面板（供应商与凭据管理、OAuth/设备码/手动回调登录、Vertex 导入、SIWC 绑定、配额、可视化 + YAML 配置编辑、文件日志、插件与商店、模型注册表），并新增基于 request-db 的实时请求日志（SSE）与用量统计（时间范围默认 24 小时可切换、按模型/供应商/密钥/会话筛选、TPS 与延迟/TTFT 分位统计）。原 `management.panel-github-repository` / `disable-auto-update-panel` 配置项已废弃（保留解析但不生效）。

## 一键安装与升级 (Linux)

使用一键命令自动安装或平滑升级本 fork 版本：

```bash
curl -fsSL https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | bash
```

中国大陆网络可使用加速镜像：
```bash
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | GH_PROXY=https://ghfast.top/ bash
```

常用管理命令：
```bash
~/cliproxyapi/install.sh status        # 查看服务状态
~/cliproxyapi/install.sh auth          # 查看各模型供应商登录指南
~/cliproxyapi/install.sh check-config  # 校验当前配置与 API Key
~/cliproxyapi/install.sh generate-key  # 生成新的 API Key
~/cliproxyapi/install.sh uninstall     # 卸载
```

## 开发

```bash
make web            # 构建仪表板（pnpm -C web install && pnpm -C web build）
make build          # 构建仪表板 + 服务端二进制（前端嵌入 web/dist/index.html）
make test           # go test ./...
```

前端源码位于 `web/`；发布流水线会先构建前端再编译 Go，Docker 构建同理（多阶段）。

