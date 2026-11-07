# 客户端兼容性

当前版本 0.6.4，最低 SillyTavern 版本 1.18.0。

2026-11-07 核对官方 1.18.0 标签源码。此前 1.19.0 的最低版本声明过严，导致 1.18.0 在加载 JavaScript 前拒绝扩展。所需接口在 1.18.0 已提供，无需更换 TTS 实现。

- `registerTtsProvider(name, provider)`、`saveTtsProviderSettings()`、`initVoiceMap(unrestricted = false)` 由宿主 TTS 模块提供。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions/tts/index.js)
- `hooks.activate` 和 `minimum_client_version` 由宿主扩展加载器支持。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/extensions.js)
- `SillyTavern.getContext()` 提供聊天数据、聊天 ID、事件源和事件类型。[1.18.0 源码](https://github.com/SillyTavern/SillyTavern/blob/1.18.0/public/scripts/st-context.js)
- TauriTavern 的 managed ChatSurface 属于可选宿主能力。现有分支在该宿主要求受管挂载时使用其接口，其他环境保留标准酒馆路径。

静态接口检查和浏览器模拟不能证明用户手机上修改过的宿主与官方源码完全一致。真机需确认扩展不再出现最低版本错误、悬浮球可打开、连接测试能加载音色、点击台词能生成并播放。API 地址、密钥和服务端保持现有配置。

更新时替换 `st-drama3-audio` 中的前端文件，然后完整重载酒馆。保留原扩展 ID 和设置名称，无需删除用户设置或音色预设。
