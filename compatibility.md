# 客户端兼容性

当前版本 0.7.0，最低 SillyTavern 版本 1.18.0。

0.7.0 的正文提取通过宿主已渲染的 `.mes_text` 或 `getContext().messageFormatting(mes, ch_name, isSystem, isUser, messageId)` 获取显示正则处理后的文本。该签名已按官方 1.18.0 `public/script.js` 核对。自动提交优先使用 `CHARACTER_MESSAGE_RENDERED`，旧宿主缺少该事件时使用 `MESSAGE_RECEIVED` 并调用宿主格式化接口。显示节点里的隐藏元素、代码及未打开的折叠内容不会进入列表。虚拟化消息的离线格式化可识别隐藏属性和行内样式；依赖页面 CSS 的可见性以实际挂载正文为准。

预设保存要求桥接支持 `preset_versioning: 1`，并回传 `metadata_version`。修改预设必须携带读取时的 `expected_version`；冲突返回 HTTP 409，前端保留编辑内容。旧桥接仍可查询音色和合成，但前端会提示升级后才能安全保存。旧前端在新版桥接上更新已有预设时会被要求刷新版本，避免绕过并发保护。

2026-11-07 核对官方 1.18.0 标签源码。此前 1.19.0 的最低版本声明过严，导致 1.18.0 在加载 JavaScript 前拒绝扩展。所需接口在 1.18.0 已提供，无需更换 TTS 实现。

- `registerTtsProvider(name, provider)`、`saveTtsProviderSettings()`、`initVoiceMap(unrestricted = false)` 由宿主 TTS 模块提供。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions/tts/index.js)
- `hooks.activate` 和 `minimum_client_version` 由宿主扩展加载器支持。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)
- `SillyTavern.getContext()` 提供聊天数据、聊天 ID、事件源和事件类型。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- TauriTavern 的 managed ChatSurface 属于可选宿主能力。现有分支在该宿主要求受管挂载时使用其接口，其他环境保留标准酒馆路径。

静态接口检查和浏览器模拟不能证明用户手机上修改过的宿主与官方源码完全一致。真机需确认扩展不再出现最低版本错误、悬浮球可打开、连接测试能加载音色、点击台词能生成并播放。API 地址、密钥和服务端保持现有配置。

更新时替换 `st-drama3-audio` 中的前端文件，然后完整重载酒馆。保留原扩展 ID 和设置名称，无需删除用户设置或音色预设。
