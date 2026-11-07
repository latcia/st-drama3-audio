// Read the host's display result, including display-only regex replacements.
const omitted = 'script,style,template,iframe,svg,canvas,audio,video,textarea,input,select,button:not(.d3-inline),pre,code,[hidden],[aria-hidden="true"],.mes_reasoning,.mes_reasoning_details';
const blocks = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'BLOCKQUOTE', 'TR', 'H1', 'H2', 'H3', 'H4']);

export function visibleText(element, live = element?.isConnected) {
    if (!element) return '';
    const chunks = [];
    function visit(node) {
        if (node.nodeType === 3) { chunks.push(node.data); return; }
        if (node.nodeType !== 1 || node.matches(omitted)) return;
        const style = live ? getComputedStyle(node) : node.style;
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return;
        if (node.tagName === 'BR') { chunks.push('\n'); return; }
        if (node.tagName === 'DETAILS' && !node.open) { const summary = node.querySelector('summary'); if (summary) visit(summary); return; }
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
    const node = content ?? document.querySelector(`#chat .mes[mesid="${Number(index)}"] .mes_text`);
    if (node) return visibleText(node);
    // Unmounted/virtualized messages still pass through the host display pipeline.
    return formattedText(message.extra?.display_text ?? message.mes, message, index);
}

export function formattedText(text, message = {}, index = -1) {
    const format = SillyTavern.getContext().messageFormatting;
    if (typeof format !== 'function') throw new Error('正文尚未显示，请稍后重试。');
    const html = format(text, message.name ?? '', !!message.is_system, !!message.is_user, index);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return visibleText(parsed.body, false);
}

export function nativeText(text) {
    const chat = SillyTavern.getContext().chat ?? [];
    const index = chat.findLastIndex(message => message.mes === text || message.extra?.display_text === text);
    return index >= 0 ? messageText(index) : formattedText(text);
}

export function visibleNode(node, root) {
    for (let element = node.parentElement; element; element = element.parentElement) {
        if (element.matches(omitted)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.contentVisibility === 'hidden') return false;
        if (element === root) break;
    }
    return true;
}
