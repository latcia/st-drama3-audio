import { removeUnspoken } from './lib.js';

export const QUOTES = { cn: ['“', '”'], en: ['"', '"'], jp: ['「', '」'], jpDouble: ['『', '』'] };
export const DEFAULT_CAPTURE = { cn: true, en: true, jp: true, jpDouble: true };

export function nameKey(value) {
    return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

const NAME = /^\s*(?:\*\*|__)?([\p{L}\p{N}][\p{L}\p{N} .’'_-]{0,39}?)(?:\*\*|__)?\s*[:：](?!\/\/)\s*/u;

// A displayed paragraph or <br> can split a single quoted utterance.
function scriptLines(text, capture) {
    const pairs = Object.entries(QUOTES).filter(([key]) => capture[key]).map(([, pair]) => pair);
    const result = [];
    let current = '', active = null, depth = 0;
    for (const line of text.split(/\r?\n/)) {
        // An unclosed quote must not swallow the next speaker or translation.
        if (active && NAME.test(line)) {
            result.push(current); current = ''; active = null; depth = 0;
        }
        current += (current ? ' ' : '') + line.trim();
        for (let i = 0; i < line.length; i++) {
            if (line[i - 1] === '\\') continue;
            if (!active) {
                active = pairs.find(([open]) => line[i] === open) ?? null;
                if (active) depth = 1;
            } else if (line[i] === active[1]) {
                if (--depth === 0) active = null;
            } else if (active[0] !== active[1] && line[i] === active[0]) depth++;
        }
        if (!active) { result.push(current); current = ''; }
    }
    if (current) result.push(current);
    return result;
}

export function quoteRanges(text, capture = DEFAULT_CAPTURE) {
    const pairs = Object.entries(QUOTES).filter(([key]) => capture[key]).map(([, pair]) => pair);
    const ranges = [];
    for (let index = 0; index < text.length; index++) {
        const pair = pairs.find(([open]) => text[index] === open && (index === 0 || text[index - 1] !== '\\'));
        if (!pair) continue;
        let end = index + 1;
        let depth = 1;
        for (; end < text.length; end++) {
            if (text[end - 1] === '\\') continue;
            if (pair[0] !== pair[1] && text[end] === pair[0]) depth++;
            if (text[end] === pair[1] && --depth === 0) break;
        }
        if (end === text.length || !text.slice(index + 1, end).trim()) continue;
        ranges.push({ start: index + 1, end, text: text.slice(index + 1, end).trim() });
        index = end;
    }
    return ranges;
}

export function parseCast(text, settings = {}) {
    const capture = settings.capture ?? DEFAULT_CAPTURE;
    const mode = settings.mode ?? 'all';
    const clean = removeUnspoken(text, { extraTags: ['infobox', 'status', 'stats'] });
    const segments = [];
    for (const line of scriptLines(clean, capture)) {
        if (!line.trim()) continue;
        const label = NAME.exec(line);
        const speaker = label?.[1]?.trim() ?? null;
        const narration = speaker === null || ['旁白', 'narrator'].includes(nameKey(speaker));
        const body = line.slice(label?.[0].length ?? 0).trim();
        const quotes = quoteRanges(body, capture);
        if (!body) continue;
        if (mode === 'quotes') {
            for (const quote of quotes) segments.push({ speaker, narration: false, text: quote.text, clickable: true });
        } else if (!narration || mode === 'all') {
            if (quotes.length === 1 && quotes[0].start === 1 && quotes[0].end === body.length - 1) {
                segments.push({ speaker, narration: false, text: quotes[0].text, clickable: true });
            } else if (!label && quotes.length) {
                let offset = 0;
                for (const quote of quotes) {
                    const before = body.slice(offset, quote.start - 1).trim();
                    if (before && mode === 'all') segments.push({ speaker: null, narration: true, text: before });
                    segments.push({ speaker: null, narration: false, text: quote.text, clickable: true });
                    offset = quote.end + 1;
                }
                const after = body.slice(offset).trim();
                if (after && mode === 'all') segments.push({ speaker: null, narration: true, text: after });
            } else {
                segments.push({ speaker, narration, text: body, clickable: !narration });
            }
        }
    }
    return segments;
}

export function resolveCastVoice(segment, settings, catalog, hostVoice = '') {
    const key = nameKey(segment.speaker);
    const available = id => catalog.some(item => item.id === id);
    const binding = Object.entries(settings.bindings ?? {}).find(([name]) => nameKey(name) === key)?.[1];
    if (binding === '__muted__') return { voice: null, reason: '已静音' };
    if (available(binding)) return { voice: binding, reason: '当前聊天绑定' };
    if (key && settings.voiceMap) {
        const hostBinding = Object.entries(settings.voiceMap).find(([name]) => nameKey(name) === key)?.[1];
        if (hostBinding === 'disabled') return { voice: null, reason: '酒馆静音' };
        if (available(hostBinding)) return { voice: hostBinding, reason: '酒馆角色绑定' };
    }
    const match = key && catalog.find(item => (item.aliases ?? []).some(alias => nameKey(alias) === key));
    if (match) return { voice: match.id, reason: '预设别名' };
    if (segment.narration && available(settings.narrator)) return { voice: settings.narrator, reason: '旁白音色' };
    if (!segment.speaker && !segment.narration && available(hostVoice)) return { voice: hostVoice, reason: '消息音色' };
    return { voice: available(settings.defaultVoice) ? settings.defaultVoice : catalog[0]?.id ?? null, reason: '默认音色' };
}
