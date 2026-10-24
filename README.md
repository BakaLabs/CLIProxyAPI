# CLIProxyAPI

[router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) 的 fork，仅包含以下功能改动：

- 自定义模型不再钳制思考等级：移除配置中按模型声明 `thinking` 能力的覆盖，客户端请求的思考等级原样透传到上游，不再被限制为默认的 low/medium/high。
- 思考等级跨协议转换时原样传递：OpenAI/Codex 的 effort 等级直接映射为 Claude 自适应思考强度（`xhigh`/`max` 视为 high），`auto` 则不注入思考配置、沿用上游默认行为。
