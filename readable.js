// Read the host's display result, including display-only regex replacements.
const omitted = 'script,style,template,iframe,svg,canvas,audio,video,textarea,input,select,button:not(.d3-inline),pre,code,details,[hidden],[aria-hidden="true"],think,thinking,reasoning,analysis,.mes_reasoning,.mes_reasoning_details,.mes_reasoning_header,.mes_reasoning_content';
const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'BLOCKQUOTE', 'TR', 'H1', 'H2', 'H3', 'H4']);
const ownedMessages = new Map();

export function bindMessageContent(index, content) {
    const entry = { content, message: SillyTavern.getContext().chat?.[index] };
    ownedMessages.set(Number(index), entry);
    document.dispatchEvent(new Event('d3-display'));
    return () => {
        if (ownedMessages.get(Number(index)) === entry) {
            ownedMessages.delete(Number(index));
            document.dispatchEvent(new Event('d3-display'));
        }
    };
}

export function visibleText(element, live = element?.isConnected) {
    if (!element) return '';
    if (live && !displayed(element)) return '';
    const chunks = [];
    function visit(node) {
        if (node.nodeType === 3) { chunks.push(node.data); return; }
        if (node.nodeType !== 1 || node.matches(omitted)) return;
        const style = live ? getComputedStyle(node) : node.style;
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || style.opacity === '0') return;
        if (node.tagName === 'BR') { chunks.push('\n'); return; }
        const block = blocks.has(node.tagName);
        if (block) chunks.push('\n');
        for (const child of node.childNodes) visit(child);
        if (block) chunks.push('\n');
    }
    visit(element);
    return chunks.join('').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function messageText(index, content = null) {
    const context = SillyTavern.getContext();
    const message = context.chat?.[index];
    if (!message) return '';
    const owned = ownedMessages.get(Number(index));
    const managed = window.__TAURITAVERN__?.api?.chatSurface?.isManagedOwnershipRequired?.();
    const nodes = content ? [content] : owned?.message === message ? [owned.content] : managed ? []
        : [...document.querySelectorAll(`#chat .mes[mesid="${Number(index)}"] .mes_text`)];
    const node = nodes.find(element => displayed(element));
    if (node) return visibleText(node);
    // Do not reconstruct display-only regex/CSS from raw message data.
    throw new Error(`第 ${Number(index) + 1} 条回复还没有可读取的显示正文，请先在聊天中显示它。`);
}

export function displayed(element) {
    if (!element?.isConnected) return false;
    for (let node = element; node; node = node.parentElement) {
        if (node.matches(omitted)) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden' || style.opacity === '0') return false;
    }
    return true;
}

export function nativeText(text) {
    const chat = SillyTavern.getContext().chat ?? [];
    const index = chat.findLastIndex(message => message.mes === text || message.extra?.display_text === text);
    if (index >= 0) return messageText(index);
    throw new Error('宿主朗读没有提供可定位的正文，请从配音台播放当前回复。');
}

export function visibleNode(node, root) {
    if (!displayed(node.parentElement)) return false;
    for (let element = node.parentElement; element; element = element.parentElement) {
        if (element.matches(omitted)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return false;
        if (element === root) break;
    }
    return true;
}
