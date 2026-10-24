# CLIProxyAPI

[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的 fork，仅包含以下功能改动：

- 自定义模型不再钳制思考等级：移除配置中按模型声明 `thinking` 能力的覆盖，客户端请求的思考等级原样透传到上游，不再被限制为默认的 low/medium/high。
- 思考等级跨协议转换时原样传递：OpenAI/Codex 的 effort 等级直接映射为 Claude 自适应思考强度（`xhigh`/`max` 视为 high），`auto` 则不注入思考配置、沿用上游默认行为。
- 独立的请求元数据数据库（`observability.request-db`）：基于本地 SQLite（纯 Go 驱动）按请求记录 token、模型、思考等级、服务层级、响应头、延迟等元数据，消息体默认完全不存储，blob 字段 zstd 压缩；支持保留期自动清理，并通过 `/v8/management/observability/request-db/records` 分页查询，用于后续用量统计与分析。与自带的 `request-log` 文件日志相互独立。
