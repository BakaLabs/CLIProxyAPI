# CLIProxyAPI

> **Linux 一键安装 / 平滑升级命令**：
> ```bash
> curl -fsSL https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | bash
> ```

本项目为 [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的功能增强与深度优化 Fork 版本（版本号标记为 `*-s*`，当前版本：`v8.0.43-s2`），专注于模型协议保真度、可观测性数据分析、存储治理以及更现代流畅的开箱即用体验。

---

## 🌟 Fork 核心特性与改进

### 1. 思考力度（Reasoning / Thinking）保真透传
- **自定义模型不钳制思考等级**：彻底移除原版中按模型声明 `thinking` 能力时对参数的强制裁剪与截断，客户端请求中指定的思考力度原样透传至上游服务。
- **高保真跨协议转换**：OpenAI / Codex 与 Claude 等跨协议请求转换时，保持思考力度精确对齐（`xhigh` / `max` 映射为 Claude 高强度，`auto` 沿用上游原生策略且不额外注入多余字段）。

### 2. 高性能独立请求数据库（`observability.request-db`）
- **本地 SQLite 驱动**：使用现代纯 Go 驱动嵌入式运行，不引入 CGO 动态依赖。
- **细粒度指标持久化**：每笔请求持久化记录 Token 明细（Prompt / Completion / Thinking / Cache 命中率）、模型调用链（请求别名 → 实际上游模型 → 响应模型）、服务层级、延迟、TTFT、HTTP 状态码及 TraceID。
- **zstd 高压缩 BLOB**：请求/响应头、错误正文与报文预览均经 zstd 二进制压缩入库，节省超过 70% 存储。
- **与传统文件日志相互解耦**：与系统原有的 `request-log` 文本文件日志完全独立，支持高并发轻量记录。

### 3. 深度可观测性监控大屏与实时日志流
- **模型成本计费引擎**：内置各主流厂商的模型定价数据库，实时计算并展示请求预估美金费用，仪表盘新增历史总开销趋势统计与模型成本分布。
- **多维度筛选与下钻**：支持多选过滤模型、供应商、API Key、会话、状态码，联动 TPS 时序图、分位延迟 (Avg / P50 / P90 / P99)、首字时间 (TTFT) 及供应商吞吐占比。
- **实时请求流 (SSE)**：高密度流水线直观展示实时请求链路、Token 分布与状态胶囊，支持实时缓冲控制（暂停/继续）与关联 Trace 追踪。

### 4. 开箱即用内嵌式管理面板 (`web/`)
- **零外部网络依赖**：编译期直接将管理面板（React 19 + Vite + Tailwind v4 + shadcn/ui）内嵌进二进制文件，打开 `/management` 或 `/management.html` 即用，彻底杜绝从 GitHub 动态拉取面板可能遭遇的卡死、网络超时或未预期版本变动风险。原 `management.panel-github-repository` / `disable-auto-update-panel` 配置项已废弃（保留解析但不生效）。
- **移动端全自适应支持**：全站响应式适配手机、平板及宽屏桌面，完善移动端抽屉导航、折叠侧栏与触控操作。
- **现代化接口调试 (Playground)**：支持多模态图片/文件上传测试、系统提示词快捷预设、流式响应随时打断、历史消息原地编辑与重新发送。
- **内置纯净 Markdown / 富文本渲染**：零臃肿依赖实现代码块语法着色、表格与排版美化，单文件体积更小、加载更迅速。

---

## 一键安装与升级 (Linux)

使用一键脚本自动安装或平滑升级本 fork 版本：

```bash
curl -fsSL https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | bash
```

中国大陆网络可使用加速镜像：
```bash
curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/juzi5201314/CLIProxyAPI/main/install.sh | GH_PROXY=https://ghfast.top/ bash
```

常用管理命令：
```bash
~/cliproxyapi/install.sh status        # 查看服务状态与运行端口
~/cliproxyapi/install.sh auth          # 查看各模型供应商登录指南
~/cliproxyapi/install.sh check-config  # 校验当前配置与 API Key
~/cliproxyapi/install.sh generate-key  # 生成新的 API Key
~/cliproxyapi/install.sh update        # 检测并升级到最新发布版本
~/cliproxyapi/install.sh uninstall     # 卸载服务
```

---

## 本地编译与构建

```bash
make web            # 构建前端仪表盘（pnpm -C web install && pnpm -C web build）
make build          # 构建仪表板 + 服务端二进制（前端嵌入 web/dist/index.html）
make test           # 运行全量单元测试
```

前端源码位于 `web/`，发布流水线会自动构建前端单文件并嵌入 Go 二进制中，Docker 镜像构建同理（多阶段构建）。
