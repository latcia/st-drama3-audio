# 客户端兼容性

当前版本 0.7.2，最低 SillyTavern 版本 1.18.0。

0.7.1 的合成和管理密钥按 API 地址保存在当前浏览器/App 的 localStorage，不进入宿主 TTS 设置。保存后重启页面自动读取；切换其他 API 地址隔离凭据，连接页可清除对应地址的两把密钥。本地存储不可写时保存会明确报错。

正文提取只使用宿主已渲染的 `.mes_text`，检查该节点及其上层容器的隐藏状态；存在同消息隐藏副本时优先读取实际显示的节点。隐藏元素、代码、思考区域和附属 `details` 折叠区不进入列表。不存在已挂载的显示正文时，提示先在聊天中显示该消息，不回退原文格式化。自动提交优先使用 `CHARACTER_MESSAGE_RENDERED`，旧宿主缺少该事件时使用 `MESSAGE_RECEIVED`；后者若尚未挂载正文也会提示，不读取原文。宿主原生 TTS 仅在能把文本定位到消息时读取该消息的显示正文；宿主预处理使文本无法定位时提示改用配音台，避免误读其他内容。

TauriTavern 要求 managed ChatSurface 时，`didCommitContent` 提供的 `content` 为该消息的权威显示正文。面板、整轮播放、提交和正文点读共用此来源，不再从旧 `.mes_text` 或原文回退。挂载解绑时删除对应来源，且按当前消息对象校验，避免跨聊天复用。该接口沿用现有 protocolVersion 1 集成，本次浏览器模拟验证注册、读取、解绑；用户手机上的实际挂载仍待验收。

识别支持同一对引号内跨行。仍未闭合的引号遇到下一位角色或译文标签时会终止，不吞并下一条台词。富文本跨节点的正文点读仍以安全定位为前提，无法装饰时可使用台词列表。

预设保存要求桥接支持 `preset_versioning: 1`，并回传 `metadata_version`。修改预设必须携带读取时的 `expected_version`；冲突返回 HTTP 409，前端保留编辑内容。旧桥接仍可查询音色和合成，但前端会提示升级后才能安全保存。旧前端在新版桥接上更新已有预设时会被要求刷新版本，避免绕过并发保护。

2026-11-07 核对官方 1.18.0 标签源码。此前 1.19.0 的最低版本声明过严，导致 1.18.0 在加载 JavaScript 前拒绝扩展。所需接口在 1.18.0 已提供，无需更换 TTS 实现。

- `registerTtsProvider(name, provider)`、`saveTtsProviderSettings()`、`initVoiceMap(unrestricted = false)` 由宿主 TTS 模块提供。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions/tts/index.js)
- `hooks.activate` 和 `minimum_client_version` 由宿主扩展加载器支持。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)
- `SillyTavern.getContext()` 提供聊天数据、聊天 ID、事件源和事件类型。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- TauriTavern 的 managed ChatSurface 属于可选宿主能力。现有分支在该宿主要求受管挂载时使用其接口，其他环境保留标准酒馆路径。

静态接口检查和浏览器模拟不能证明用户手机上修改过的宿主与官方源码完全一致。真机需确认扩展不再出现最低版本错误、悬浮球可打开、连接测试能加载音色、点击台词能生成并播放。API 地址、密钥和服务端保持现有配置。

更新时替换 `st-drama3-audio` 中的前端文件，然后完整重载酒馆。保留原扩展 ID 和设置名称，无需删除用户设置或音色预设。
