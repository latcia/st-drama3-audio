import { initVoiceMap, saveTtsProviderSettings } from '../../tts/index.js';
import { rewriteCues, sanitizeLabel, SILENCE_URL } from './lib.js';
import { DEFAULT_CAPTURE, parseCast, resolveCastVoice } from './parser.js';
import { connectPanel, openPanel } from './panel.js';

const ENDPOINT = 'http://127.0.0.1:8036';
const credentials = new Map();
export const PROVIDER = 'Drama 3 Cast (Local)';

function endpointUrl(value) {
    const url = new URL(value.trim());
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash) {
        throw new Error('远程地址必须用 HTTPS，本机允许 HTTP。地址中只填服务 URL。');
    }
    return url.href.replace(/\/$/, '');
}

export class Drama3TtsProvider {
    settings = {};
    catalog = [];
    separator = ' ';
    controller = new AbortController();
    audioCache = new Map();

    get settingsHtml() {
        return '<button type="button" class="menu_button" id="d3_open_panel">打开 Drama 3 配音台</button>';
    }

    async loadSettings(stored = {}) {
        this.settings = {
            endpoint: stored.endpoint ?? ENDPOINT, voiceMap: stored.voiceMap ?? {},
            bindings: stored.bindings ?? {},
            defaultVoice: stored.defaultVoice ?? 'jok', narrator: stored.narrator ?? '',
            mode: stored.mode ?? (stored.narration === false ? 'labels' : 'all'),
            capture: { ...DEFAULT_CAPTURE, ...stored.capture },
            playback: stored.playback ?? 'segments', cues: stored.cues !== false,
            autoSubmit: stored.autoSubmit === true,
            submitScope: stored.submitScope === 'full' ? 'full' : 'dialogue',
            submitAutoplay: stored.submitAutoplay === true,
        };
        if (Array.isArray(stored.speakers) && !stored.bindings) {
            this.settings.legacyBindings = Object.fromEntries(stored.speakers.filter(s => s.name && s.voice).map(s => [s.name, s.voice]));
        } else if (stored.legacyBindings) this.settings.legacyBindings = stored.legacyBindings;
        connectPanel(this);
        document.getElementById('d3_open_panel')?.addEventListener('click', openPanel, { signal: this.controller.signal });
    }

    dispose() {
        this.controller.abort();
        connectPanel(null);
    }

    save() { saveTtsProviderSettings(); }
    async refreshHostMap() { await initVoiceMap(); }

    configure(address, key, admin) {
        const endpoint = endpointUrl(address);
        if (endpoint !== this.settings.endpoint) { this.catalog = []; this.audioCache.clear(); }
        credentials.set(endpoint, { key: key.trim(), admin: admin.trim() });
        this.settings.endpoint = endpoint;
        this.save();
    }

    credentials() {
        return credentials.get(this.settings.endpoint) ?? { key: '', admin: '' };
    }

    async request(path, { body, admin = false, signal } = {}) {
        const endpoint = endpointUrl(this.settings.endpoint);
        const keys = this.credentials();
        const key = admin ? keys.admin || keys.key : keys.key || keys.admin;
        const headers = {};
        if (key) headers.Authorization = 'Bearer ' + key;
        if (body) headers['Content-Type'] = 'application/json';
        const sources = [this.controller.signal, signal].filter(Boolean);
        let response;
        try {
            response = await fetch(endpoint + path, {
                method: body ? 'POST' : 'GET', headers,
                body: body ? JSON.stringify(body) : undefined,
                credentials: 'omit', redirect: 'error', signal: sources.length === 1 ? sources[0] : AbortSignal.any(sources),
            });
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            throw new Error('连接失败，请检查地址、网络及跨域配置。');
        }
        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error ?? ('Drama 3 HTTP ' + response.status));
        }
        return response;
    }

    async refresh(signal) {
        const endpoint = this.settings.endpoint;
        const data = await (await this.request('/v1/voices', { signal })).json();
        if (endpoint !== this.settings.endpoint) return this.catalog;
        this.catalog = data.voices.filter(v => /^[a-z0-9_-]{1,64}$/.test(v.id));
        return this.catalog;
    }

    async checkReady() { if (!this.catalog.length) await this.refresh(); }
    async onRefreshClick() { await this.refresh(); }
    async fetchTtsVoiceObjects() {
        await this.checkReady();
        return this.catalog.map(v => ({ name: v.id, voice_id: v.id, lang: 'zh-CN', preview_url: false,
            title: sanitizeLabel(v.label) }));
    }
    async getVoice(name) {
        const voice = (await this.fetchTtsVoiceObjects()).find(v => v.voice_id === name);
        if (!voice) throw new Error('找不到音色 ' + name);
        return voice;
    }

    bindingSettings() {
        const id = SillyTavern.getContext().chatId ?? '__current__';
        return { ...this.settings, bindings: { ...this.settings.legacyBindings, ...this.settings.bindings[id] } };
    }

    setBindings(bindings) {
        const id = SillyTavern.getContext().chatId ?? '__current__';
        this.settings.bindings[id] = bindings;
        this.save();
    }

    parse(text) { return parseCast(text, this.settings); }

    turns(segments, hostVoice = '') {
        const settings = this.bindingSettings();
        return segments.map(segment => {
            const match = resolveCastVoice(segment, settings, this.catalog, hostVoice);
            return { ...segment, ...match, text: rewriteCues(segment.text, 'drama-3', this.settings.cues) };
        });
    }

    // The native TTS host flattens line breaks after processText. Preserve the
    // script for its next generateTts call without making markers user-editable.
    async processText(text) {
        const payload = JSON.stringify(this.parse(text));
        return 'D3CAST:' + Array.from(new TextEncoder().encode(payload), b => b.toString(16).padStart(2, '0')).join('');
    }

    async generateTts(text, hostVoice) {
        await this.checkReady();
        const marker = /^D3CAST:((?:[a-f0-9]{2})+)$/i.exec(text.trim());
        const script = marker
            ? JSON.parse(new TextDecoder().decode(Uint8Array.from(marker[1].match(/../g), b => parseInt(b, 16))))
            : this.parse(text);
        const turns = this.turns(script, hostVoice).filter(turn => turn.voice && turn.text);
        if (!turns.length) return SILENCE_URL;
        return this.speech(turns);
    }

    async speech(turns, { stream = false, signal } = {}) {
        const single = !stream && turns.length === 1 ? turns[0] : null;
        const revision = single && this.catalog.find(item => item.id === single.voice)?.revision;
        const key = revision ? JSON.stringify([single.voice, revision, single.text]) : '';
        if (signal?.aborted) throw signal.reason;
        const cached = key && this.audioCache.get(key);
        if (cached) return new Response(cached, { headers: { 'Content-Type': 'audio/wav' } });
        const response = await this.request('/v1/cast/speech', {
            body: { stream, turns: turns.map(({ voice, text }) => ({ voice, text })) }, signal,
        });
        if (!key) return response;
        const audio = await response.blob();
        if (audio.size <= 2 * 1024 * 1024 && audio.type.startsWith('audio/')) {
            if (this.audioCache.size >= 8) this.audioCache.delete(this.audioCache.keys().next().value);
            this.audioCache.set(key, audio);
        }
        return new Response(audio);
    }

    async previewTtsVoice(voice) {
        const { previewVoice } = await import('./panel.js');
        return previewVoice(voice);
    }
}
