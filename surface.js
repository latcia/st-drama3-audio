import { activeProvider, mountPanel, playPoint } from './panel.js';
import { parseCast } from './parser.js';
import { messageText, visibleNode, displayed, bindMessageContent } from './readable.js';

let mounted = false;

function decorate(content, mesid) {
    if (!displayed(content)) return;
    const message = SillyTavern.getContext().chat?.[mesid];
    if (!message || message.is_system || message.is_user || typeof message.mes !== 'string') return;
    const raw = message.mes;
    const ranges = parseCast(messageText(mesid, content), activeProvider()?.settings).filter(part => part.clickable);
    const candidates = new Map();
    for (const part of ranges) {
        if (!candidates.has(part.text)) candidates.set(part.text, []);
        candidates.get(part.text).push(part);
    }
    if (!candidates.size) return;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return !visibleNode(node, content) || node.parentElement?.closest('a, button, code, pre, script, style, textarea, iframe, [hidden]')
                ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const byNode = new Map();
    for (const [needle, parts] of candidates) {
        const hits = [];
        for (const node of nodes) {
            for (let at = node.data.indexOf(needle); at >= 0; at = node.data.indexOf(needle, at + needle.length)) {
                hits.push({ node, at });
            }
        }
        // If formatting splits a quote or identical prose occurs outside the
        // quote, use the dialogue list rather than guessing its location.
        if (hits.length !== parts.length) continue;
        hits.forEach(({ node, at }, index) => {
            if (!byNode.has(node)) byNode.set(node, []);
            byNode.get(node).push({ at, needle, part: parts[index] });
        });
    }
    const created = [];
    for (const [node, matches] of byNode) {
        matches.sort((a, b) => a.at - b.at || b.needle.length - a.needle.length);
        const text = node.data;
        const fragment = document.createDocumentFragment();
        let offset = 0;
        for (const match of matches) {
            if (match.at < offset) continue;
            fragment.append(text.slice(offset, match.at));
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'd3-inline';
            button.dataset.d3Line = '';
            button.title = '只生成并播放这句';
            button.textContent = match.needle;
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (SillyTavern.getContext().chat?.[mesid] === message && message.mes === raw) playPoint(match.part, button);
            });
            fragment.append(button);
            created.push(button);
            offset = match.at + match.needle.length;
        }
        fragment.append(text.slice(offset));
        node.replaceWith(fragment);
    }
    return () => {
        for (const button of created) {
            const parent = button.parentNode;
            button.replaceWith(document.createTextNode(button.textContent));
            parent?.normalize();
        }
    };
}

export function mountSurface() {
    if (mounted) return;
    mounted = true;
    mountPanel();
    const api = window.__TAURITAVERN__?.api?.chatSurface;
    if (api?.isManagedOwnershipRequired?.()) {
        try {
            if (api.protocolVersion !== 1) return;
            const mountedContent = new Map();
            const redraw = () => {
                for (const entry of mountedContent.values()) {
                    entry.cleanup?.();
                    entry.cleanup = decorate(entry.content, entry.id);
                }
            };
            api.registerParticipant({
                id: 'drama3-cast/dialogue', protocolVersion: 1,
                didCommitContent: ({ content, mesid }) => {
                    const release = bindMessageContent(Number(mesid), content);
                    const entry = { content, id: Number(mesid), cleanup: decorate(content, Number(mesid)) };
                    mountedContent.set(content, entry);
                    return () => { entry.cleanup?.(); release(); mountedContent.delete(content); };
                },
            });
            document.addEventListener('d3-cast-provider', redraw);
            document.addEventListener('d3-cast-capture', redraw);
        } catch (error) {
            console.warn('[Drama 3 Cast] Managed decoration unavailable. Use the dialogue list.', error);
        }
        return;
    }
    const chat = document.getElementById('chat');
    if (!chat) return;
    const tracked = new WeakMap();
    function scan(element, force = false) {
        let changed = false;
        for (const message of element.matches?.('.mes') ? [element] : element.querySelectorAll?.('.mes') ?? []) {
            const content = [...message.querySelectorAll('.mes_text')].find(node => displayed(node));
            if (!content || !message.hasAttribute('mesid')) continue;
            const id = Number(message.getAttribute('mesid'));
            const raw = SillyTavern.getContext().chat?.[id]?.mes;
            const displayText = messageText(id, content);
            const old = tracked.get(content);
            if (old?.raw === raw && old.displayed === displayText && !force) continue;
            old?.cleanup?.();
            tracked.set(content, { raw, displayed: displayText, cleanup: decorate(content, id) });
            changed = true;
        }
        if (changed) document.dispatchEvent(new Event('d3-display'));
    }
    let refreshFrame;
    const observer = new MutationObserver(() => {
        if (!refreshFrame) refreshFrame = requestAnimationFrame(() => { refreshFrame = null; scan(chat); });
    });
    observer.observe(chat, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
    document.addEventListener('d3-cast-provider', () => scan(chat, true));
    document.addEventListener('d3-cast-capture', () => scan(chat, true));
    scan(chat);
    window.addEventListener('pagehide', () => { observer.disconnect(); cancelAnimationFrame(refreshFrame); }, { once: true });
}
