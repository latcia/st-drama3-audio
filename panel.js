import { CastPlayer } from './player.js';
import { QUOTES, nameKey } from './parser.js';
import { SubmissionQueue } from './submission.js';
import { movableDock } from './dock.js';
import { messageText } from './readable.js';

let provider = null;
let root;
let player;
let submissions;
let queue = [];
let nextIndex = 0;
let savedReference;
let voiceLoad = 0;
let editorDirty = false;
let savingVoice = false;
const worldbookUrl = new URL('./drama3-worldbook.json', import.meta.url).href;
const $ = id => root?.querySelector('#d3_' + id);
const value = id => $(id).value;
const status = message => { if ($('status')) $('status').textContent = message; };
const connection = message => { $('connection_status').textContent = message; };
const button = (label, action) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.onclick = action;
    return element;
};
const safe = action => async event => {
    try { await action(event); } catch (error) { status(error.message || String(error)); }
};

export const activeProvider = () => provider;

export function connectPanel(next) {
    if (provider !== next) {
        player?.stop();
        submissions?.clear();
        queue = [];
        nextIndex = 0;
        if (root) {
            $('edit_voice').value = '';
            savedReference = null;
            editorDirty = false;
            voiceLoad++;
            for (const id of ['voice_id', 'label', 'aliases', 'transcript', 'audio']) $(id).value = '';
            $('voice_id').readOnly = false;
            renderReference();
        }
    }
    provider = next;
    if (root?.open && next) sync();
    document.dispatchEvent(new Event('d3-cast-provider'));
}

export function mountPanel() {
    if (root) return;
    const dock = document.createElement('div');
    dock.className = 'd3-dock';
    dock.innerHTML = `
      <div class="d3-float-status" role="status" aria-atomic="true">
        <strong></strong><small></small>
      </div>
      <button type="button" class="d3-float" aria-label="打开 Drama 3 配音台" aria-haspopup="dialog">
        <span class="d3-float-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      </button>`;
    const float = dock.querySelector('button');
    const floatStatus = dock.querySelector('.d3-float-status');
    float.title = '点击打开，拖动调整位置';
    root = document.createElement('dialog');
    root.className = 'd3-console';
    root.setAttribute('aria-labelledby', 'd3_title');
    root.innerHTML = `
      <header class="d3-header">
        <div class="d3-brand"><span class="d3-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <div><small>DRAMA 3 CAST</small><h2 id="d3_title">多角色配音台</h2></div></div>
        <div class="d3-header-actions"><p id="d3_status" role="status" class="d3-status">等待操作</p>
          <button type="button" id="d3_close" aria-label="关闭">×</button></div>
      </header>
      <div class="d3-body">
      <nav aria-label="配音设置" class="d3-tabs">
        <button data-tab="play"><span aria-hidden="true">01</span>播放</button>
        <button data-tab="voices"><span aria-hidden="true">02</span>角色与音色</button>
        <button data-tab="capture"><span aria-hidden="true">03</span>台词识别</button>
        <button data-tab="connection"><span aria-hidden="true">04</span>连接测试</button>
      </nav>
      <div class="d3-content">
      <section data-page="play">
        <div class="d3-page-heading"><h3>本轮配音</h3><p>播放整场，或从下方挑一句单独听。</p></div>
        <div class="d3-card">
        <label>整轮播放方式<select id="d3_playback"><option value="segments">分段队列</option><option value="stream">整场流式</option></select></label>
        <div class="d3-actions"><button id="d3_play">播放本轮</button><button id="d3_continue">分段续播 / 重播</button>
        <button id="d3_pause" disabled>暂停</button><button id="d3_stop" disabled>停止</button></div>
        </div>
        <div class="d3-section-heading"><h4>分段提交</h4><small><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd></small></div>
        <div class="d3-card d3-submit-card">
          <div class="d3-submit-options">
            <label class="d3-check"><input id="d3_autoSubmit" type="checkbox">正文生成后自动提交</label>
            <label class="d3-check"><input id="d3_submitAutoplay" type="checkbox">返回后自动播放</label>
          </div>
          <label>提交范围<select id="d3_submitScope"><option value="dialogue">仅台词（按已选引号）</option><option value="full">全文（旁白与台词）</option></select></label>
          <div class="d3-actions"><button type="button" id="d3_submit" aria-keyshortcuts="Alt+Shift+D">提交最新回复</button><button type="button" id="d3_submit_stop">停止提交</button></div>
          <p class="d3-help">逐段生成，返回一段就可以听一段。自动播放关闭时，可从下方手动试听。</p>
          <div id="d3_results" class="d3-results"></div>
        </div>
        <div class="d3-section-heading"><h4>台词列表</h4><small>也可点正文里的下划线</small></div>
        <p id="d3_source_status" class="d3-help" role="status"></p>
        <div id="d3_lines" class="d3-lines"></div>
      </section>
      <section data-page="voices" hidden>
        <div class="d3-page-heading"><h3>角色与音色</h3><p>设置默认音色、聊天分配和音色预设。</p></div>
        <div class="d3-voice-layout">
        <div class="d3-card d3-preset-card">
        <h4>音色预设</h4>
        <div class="d3-actions"><button type="button" id="d3_refresh_voices">刷新音色库</button><button type="button" id="d3_reload_voice">重新载入所选</button></div>
        <p id="d3_sync_status" class="d3-help" role="status">连接后同步服务端预设。编辑中的内容不会被自动覆盖。</p>
        <label>选择预设<select id="d3_edit_voice"></select></label>
        <div class="d3-grid"><label>音色 ID<input id="d3_voice_id" maxlength="64" placeholder="cantarella"></label>
        <label>显示名<input id="d3_label" maxlength="80" placeholder="坎特蕾拉"></label></div>
        <label>捕获角色名<input id="d3_aliases" placeholder="坎特蕾拉，Cantarella"></label>
        <div class="d3-reference">
          <div class="d3-reference-info">
            <span class="d3-reference-tag" id="d3_reference_tag">参考音频</span>
            <strong id="d3_filename">尚未选择音频</strong>
          </div>
          <div class="d3-reference-actions">
            <input id="d3_audio" type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" hidden>
            <button type="button" id="d3_pick_audio">选择文件</button>
            <button type="button" id="d3_preview_reference" disabled>试听原声</button>
          </div>
        </div>
        <label>参考音频对应文字<textarea id="d3_transcript" rows="3" placeholder="填入参考音频里实际说的话"></textarea></label>
        <div class="d3-actions d3-preset-actions"><button id="d3_save_voice">保存预设</button><button id="d3_preview_voice">试听合成效果</button></div>
        </div>
        <div class="d3-card d3-assign-card">
        <h4>角色分配</h4>
        <label>全局默认音色<select id="d3_defaultVoice"></select></label>
        <label>旁白音色<select id="d3_narrator"></select></label>
        <label>当前聊天手动绑定 <small>每行填写 角色名 = 音色ID。填写 muted 可静音。</small>
          <textarea id="d3_bindings" rows="3" placeholder="乔克 = jok"></textarea></label>
        <button id="d3_save_bindings">保存分配</button>
        </div></div>
      </section>
      <section data-page="capture" hidden>
        <div class="d3-page-heading"><h3>台词识别</h3><p>选择朗读范围和可识别的引号。</p></div>
        <div class="d3-card">
        <label>识别范围<select id="d3_mode"><option value="all">角色台词和旁白</option><option value="labels">只读角色标签行</option><option value="quotes">只读选定引号内</option></select></label>
        <div id="d3_quotes" class="d3-actions"></div>
        <label class="d3-check"><input id="d3_cues" type="checkbox">保留 Drama 3 表演提示</label>
        </div>
        <div class="d3-section-heading"><h4>配音世界书</h4></div>
        <div class="d3-card">
        <p class="d3-help">世界书含独立的中文、日文配音条目。中文默认启用。切换到日文时，关闭中文条目并开启日文条目；台词识别选仅引号，保留「」。</p>
        <a id="d3_worldbook" download="Drama 3 台词与表演.json">下载世界书</a>
        </div>
      </section>
      <section data-page="connection" hidden>
        <div class="d3-page-heading"><h3>连接测试</h3><p>配置合成服务，再试听一句验证播放。</p></div>
        <div class="d3-card">
        <label>API 基础地址<input id="d3_endpoint" type="url" placeholder="http://127.0.0.1:8036"></label>
        <div class="d3-grid"><label>合成密钥<input id="d3_key" type="password" autocomplete="off"></label>
        <label>音色管理密钥<input id="d3_admin" type="password" autocomplete="off"></label></div>
        <p class="d3-help">密钥按 API 地址保存在本机，重启后自动恢复。远程地址用 HTTPS。</p>
        <div class="d3-actions"><button id="d3_connect">保存并测试连接</button><button id="d3_test">试听一句</button><button type="button" id="d3_clear_keys">清除此地址的密钥</button></div>
        <p id="d3_connection_status" role="status"></p>
        </div>
      </section>
      </div></div>`;
    document.body.append(dock, root);
    const cleanupDock = movableDock(dock, float, openPanel);
    let activeTrigger;
    let hideStatus;
    const showPlaybackState = (phase, text, detail = '') => {
        status(text);
        root.dataset.phase = phase;
        dock.dataset.phase = phase;
        floatStatus.querySelector('strong').textContent = phase === 'error' ? '配音失败' : text;
        floatStatus.querySelector('small').textContent = phase === 'error' ? text : detail;
        float.title = text;
        clearTimeout(hideStatus);
        if (!['waiting', 'playing', 'paused'].includes(phase)) {
            hideStatus = setTimeout(() => { delete dock.dataset.phase; }, phase === 'error' ? 6500 : 2200);
        }
    };
    player = new CastPlayer((phase, text, detail, trigger) => {
        if (phase === 'waiting') submissions.pauseAudio();
        const busy = ['waiting', 'playing', 'paused'].includes(phase);
        if (activeTrigger && (activeTrigger !== trigger || !busy)) {
            delete activeTrigger.dataset.d3State;
            activeTrigger.removeAttribute('aria-busy');
        }
        activeTrigger = busy ? trigger : null;
        if (activeTrigger) {
            activeTrigger.dataset.d3State = phase;
            activeTrigger.setAttribute('aria-busy', String(phase === 'waiting'));
        }
        $('preview_reference').textContent = activeTrigger === $('preview_reference') ? '停止原声' : '试听原声';
        $('pause').disabled = phase !== 'playing' && phase !== 'paused';
        $('pause').textContent = phase === 'paused' ? '继续' : '暂停';
        $('stop').disabled = !busy;
        showPlaybackState(phase, text, detail);
    });
    submissions = new SubmissionQueue($('results'), (phase, text, detail) => {
        if (!player.job) showPlaybackState(phase, text, detail);
    }, () => player.stop(), () => !player.job);
    $('worldbook').href = worldbookUrl;
    $('close').onclick = () => root.close();
    root.addEventListener('click', event => {
        if (event.target === root) {
            const box = root.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) root.close();
        }
    });
    for (const tab of root.querySelectorAll('[data-tab]')) tab.onclick = () => show(tab.dataset.tab);
    for (const [key, pair] of Object.entries(QUOTES)) {
        const label = document.createElement('label');
        label.className = 'd3-check';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.quote = key;
        checkbox.onchange = () => { if (provider) { provider.settings.capture[key] = checkbox.checked; changed(); } };
        label.append(checkbox, pair.join('…'));
        $('quotes').append(label);
    }
    for (const id of ['mode', 'playback', 'defaultVoice', 'narrator', 'cues', 'autoSubmit', 'submitScope', 'submitAutoplay']) {
        $(id).onchange = () => {
            if (!provider) return;
            provider.settings[id] = $(id).type === 'checkbox' ? $(id).checked : value(id);
            if (id === 'autoSubmit' || id.startsWith('submit')) provider.save();
            else changed();
        };
    }
    $('connect').onclick = safe(async () => {
        provider.configure(value('endpoint'), value('key'), value('admin'));
        const started = performance.now();
        connection('正在检查连接…');
        try {
            await provider.refresh();
            await provider.refreshHostMap();
            renderVoices();
            renderLines();
            connection('连接正常 · ' + provider.catalog.length + ' 个音色 · ' + Math.round(performance.now() - started) + ' ms');
        } catch (error) { connection(error.message); }
    });
    $('endpoint').oninput = () => {
        let keys = { key: '', admin: '' };
        try { keys = provider.credentials(value('endpoint')); } catch { /* Address may be incomplete while typing. */ }
        $('key').value = keys.key; $('admin').value = keys.admin;
    };
    $('clear_keys').onclick = safe(() => {
        provider.clearCredentials(value('endpoint'));
        $('key').value = ''; $('admin').value = '';
        player.stop(); submissions.stop();
        connection('已清除此地址保存在本机的两把密钥。');
    });
    $('edit_voice').onchange = safe(loadVoice);
    $('reload_voice').onclick = safe(loadVoice);
    $('refresh_voices').onclick = safe(async () => {
        await provider.refresh(); renderVoices(); renderLines();
        $('sync_status').textContent = '已刷新服务端音色库。若要放弃当前编辑并读取最新内容，点「重新载入所选」。';
    });
    for (const id of ['voice_id', 'label', 'aliases', 'transcript', 'audio']) {
        $(id).addEventListener('input', () => { editorDirty = true; });
    }
    const catalogChanged = event => {
        if (event.detail.provider !== provider) return;
        renderVoices();
        if (root.open) renderLines();
        const selected = provider.catalog.find(item => item.id === value('edit_voice'));
        const stale = savedReference && selected && savedReference.metadata_version !== selected.metadata_version;
        $('sync_status').textContent = stale
            ? '另一端更新了当前预设。你的编辑已保留，请重新载入后合并修改。'
            : '音色库已同步 · ' + provider.catalog.length + ' 个音色';
    };
    document.addEventListener('d3-catalog', catalogChanged);
    const displayChanged = () => { if (root.open && provider) renderLines(); };
    document.addEventListener('d3-display', displayChanged);
    $('pick_audio').onclick = () => $('audio').click();
    $('audio').onchange = () => {
        stopReference();
        renderReference();
    };
    $('preview_reference').onclick = safe(previewReference);
    root.addEventListener('close', stopReference);
    $('save_voice').onclick = safe(saveVoice);
    $('save_bindings').onclick = safe(saveBindings);
    $('preview_voice').onclick = safe(() => previewVoice(value('edit_voice')));
    $('test').onclick = safe(async () => {
        await previewVoice(provider.settings.defaultVoice);
    });
    $('play').onclick = safe(() => playText());
    $('submit').onclick = submitLatest;
    $('submit_stop').onclick = () => submissions.stop();
    $('continue').onclick = safe(async () => {
        if (nextIndex >= queue.length) return status('暂无可续播的台词。');
        return playQueue(queue, 'segments', nextIndex);
    });
    $('pause').onclick = () => player.togglePause();
    $('stop').onclick = () => player.stop();
    const { eventSource, eventTypes } = SillyTavern.getContext();
    const invalidate = () => { player.stop(); queue = []; nextIndex = 0; if (root.open) syncIfReady(); };
    const events = ['CHAT_CHANGED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED']
        .map(name => eventTypes?.[name]).filter(Boolean);
    const handlers = events.map(event => [event, invalidate]);
    for (const event of [eventTypes?.CHAT_CHANGED, eventTypes?.MESSAGE_DELETED]) {
        if (event) handlers.push([event, () => submissions.clear()]);
    }
    const receivedEvent = eventTypes?.CHARACTER_MESSAGE_RENDERED ?? eventTypes?.MESSAGE_RECEIVED;
    if (receivedEvent) {
        let generationStopped = false;
        if (eventTypes.GENERATION_STARTED) handlers.push([eventTypes.GENERATION_STARTED, (_type, _options, dryRun) => {
            if (!dryRun) generationStopped = false;
        }]);
        if (eventTypes.GENERATION_STOPPED) handlers.push([eventTypes.GENERATION_STOPPED, () => {
            generationStopped = true;
        }]);
        handlers.push([receivedEvent, (index, type) => {
            if (generationStopped || !provider?.settings.autoSubmit ||
                !['normal', 'regenerate', 'swipe', 'continue', 'append', 'appendFinal'].includes(type)) return;
            const message = SillyTavern.getContext().chat?.[index];
            if (root.open) renderLines();
            if (isReply(message)) {
                try { submissions.submit(provider, message, Number(index), true); }
                catch (error) { status(error.message); }
            }
        }]);
    } else {
        $('autoSubmit').disabled = true;
        $('autoSubmit').parentElement.title = '当前酒馆没有提供回复生成完成事件';
    }
    for (const [event, handler] of handlers) eventSource?.on(event, handler);
    const shortcut = event => {
        if (!provider || event.defaultPrevented || event.repeat || event.isComposing || event.code !== 'KeyD' ||
            !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
            event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable=false])')) return;
        event.preventDefault();
        submitLatest();
    };
    document.addEventListener('keydown', shortcut);
    window.addEventListener('pagehide', () => {
        for (const [event, handler] of handlers) eventSource?.removeListener(event, handler);
        document.removeEventListener('keydown', shortcut);
        submissions.clear();
        player.stop();
        clearTimeout(hideStatus);
        cleanupDock();
        document.removeEventListener('d3-catalog', catalogChanged);
        document.removeEventListener('d3-display', displayChanged);
    }, { once: true });
}

function syncIfReady() { if (provider) sync(); }

function show(page) {
    if (page !== 'voices') stopReference();
    for (const section of root.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== page;
    for (const tab of root.querySelectorAll('[data-tab]')) tab.setAttribute('aria-pressed', String(tab.dataset.tab === page));
    root.querySelector('.d3-content').scrollTop = 0;
    if (page === 'play') renderLines();
}

function ensureProvider() {
    if (provider) return true;
    const select = document.getElementById('tts_provider');
    if (select && [...select.options].some(option => option.value === 'Drama 3 Cast (Local)')) {
        select.value = 'Drama 3 Cast (Local)';
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!provider) status('请先在酒馆 TTS 设置中选择 Drama 3 Cast (Local)。');
    return !!provider;
}

export function openPanel() {
    mountPanel();
    if (!root.open) root.showModal();
    if (!ensureProvider()) return;
    sync();
    if (!provider.catalog.length) {
        show('connection');
        provider.checkReady().then(() => { renderVoices(); connection('连接正常'); }).catch(error => connection(error.message));
    } else {
        show('play');
        provider.refresh().catch(error => { $('sync_status').textContent = error.message; });
    }
}

function sync() {
    const settings = provider.settings;
    for (const id of ['endpoint', 'mode', 'playback', 'submitScope']) $(id).value = settings[id];
    const keys = provider.credentials();
    $('key').value = keys.key;
    $('admin').value = keys.admin;
    for (const id of ['cues', 'autoSubmit', 'submitAutoplay']) $(id).checked = settings[id];
    for (const checkbox of root.querySelectorAll('[data-quote]')) checkbox.checked = settings.capture[checkbox.dataset.quote];
    $('bindings').value = Object.entries(provider.bindingSettings().bindings).map(([name, id]) => name + ' = ' + (id === '__muted__' ? 'muted' : id)).join('\n');
    renderVoices();
    renderLines();
}

function renderVoices() {
    if (!provider) return;
    for (const id of ['defaultVoice', 'narrator', 'edit_voice']) {
        const select = $(id);
        const old = id === 'edit_voice' ? select.value : provider.settings[id];
        select.replaceChildren();
        if (id !== 'defaultVoice') select.append(new Option(id === 'narrator' ? '跟随默认音色' : '新建预设', ''));
        for (const voice of provider.catalog) select.append(new Option(voice.label + ' · ' + voice.id, voice.id));
        if ([...select.options].some(option => option.value === old)) select.value = old;
    }
}

function stopReference() {
    if (player?.job?.trigger === $('preview_reference')) player.stop();
}

function renderReference() {
    const file = $('audio').files[0];
    const filename = file?.name ?? savedReference?.filename;
    $('filename').textContent = filename || (savedReference ? '已保存的参考音频' : '尚未选择音频');
    $('filename').title = filename ?? '';
    $('reference_tag').textContent = file ? '待保存 · 参考音频' : savedReference ? '已保存 · 参考音频' : '参考音频';
    $('pick_audio').textContent = file || savedReference ? '更换文件' : '选择文件';
    $('preview_reference').disabled = !file && !savedReference;
}

async function loadVoice() {
    const load = ++voiceLoad;
    stopReference();
    savedReference = null;
    const id = value('edit_voice');
    const owner = provider;
    editorDirty = false;
    $('voice_id').value = id;
    $('voice_id').readOnly = !!id;
    $('audio').value = '';
    $('transcript').value = '';
    const voice = provider.catalog.find(item => item.id === id);
    $('label').value = voice?.label ?? '';
    $('aliases').value = (voice?.aliases ?? []).join('，');
    renderReference();
    if (id) {
        const result = await (await owner.request('/v1/voice-presets', { admin: true })).json();
        if (load !== voiceLoad || provider !== owner || id !== value('edit_voice')) return;
        savedReference = result.voices.find(item => item.id === id);
        if (!editorDirty) {
            $('transcript').value = savedReference?.text ?? '';
            $('label').value = savedReference?.label ?? voice?.label ?? '';
            $('aliases').value = (savedReference?.aliases ?? voice?.aliases ?? []).join('，');
        }
        renderReference();
    }
}

async function previewReference() {
    const trigger = $('preview_reference');
    if (player.job?.trigger === trigger) return player.stop();
    const file = $('audio').files[0];
    const preset = savedReference;
    const owner = provider;
    if (!file && !preset) return;
    await player.play(async function* (signal) {
        if (file) yield file;
        else yield await owner.request('/v1/voice-presets?audio=' + encodeURIComponent(preset.id), { admin: true, signal });
    }, 'wav', { waiting: '正在读取参考音频…', detail: file?.name ?? preset?.filename, trigger });
}

async function saveVoice() {
    if (savingVoice) return;
    const owner = provider;
    const generation = owner.connectionGeneration;
    if (!owner.presetVersioning) throw new Error('服务端需升级后才能安全保存多端预设，请先更新并重启桥接。');
    if (value('edit_voice') && !savedReference?.metadata_version) throw new Error('请先重新载入所选预设，再保存修改。');
    const body = { id: value('voice_id').trim(), label: value('label').trim(), text: value('transcript').trim(),
        aliases: value('aliases'), expected_version: savedReference?.metadata_version ?? null };
    const file = $('audio').files[0];
    savingVoice = true;
    const editorControls = ['save_voice', 'edit_voice', 'voice_id', 'label', 'aliases', 'transcript', 'audio', 'pick_audio', 'reload_voice'];
    for (const id of editorControls) $(id).disabled = true;
    try {
    let audio;
    if (file) {
        if (file.size > 8 * 1024 * 1024) throw new Error('参考音频最多 8 MiB。');
        const url = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
        audio = url.slice(url.indexOf(',') + 1);
    }
    if (owner !== provider || generation !== owner.connectionGeneration) throw new Error('连接已切换，请重新保存。');
    Object.assign(body, { audio, filename: file?.name });
    await owner.request('/v1/voice-presets', { admin: true, body });
    await owner.refresh();
    if (owner !== provider || generation !== owner.connectionGeneration) return;
    renderVoices();
    $('edit_voice').value = body.id;
    await loadVoice();
    status('音色预设已保存');
    } catch (error) {
        if (error.status === 409) {
            $('sync_status').textContent = error.message;
            owner.refresh().catch(() => {});
        }
        throw error;
    } finally {
        savingVoice = false;
        for (const id of editorControls) $(id).disabled = false;
    }
}

function saveBindings() {
    const bindings = Object.create(null);
    for (const line of value('bindings').split(/\n/)) {
        if (!line.trim()) continue;
        const [name, id, ...rest] = line.split('=').map(part => part.trim());
        if (!name || !id || rest.length || (id !== 'muted' && !provider.catalog.some(item => item.id === id))) {
            throw new Error('绑定格式应为 角色名 = 音色ID（或 muted）');
        }
        bindings[nameKey(name)] = id === 'muted' ? '__muted__' : id;
    }
    provider.setBindings(bindings);
    status('当前聊天的角色分配已保存');
    renderLines();
}

function changed() {
    provider.save();
    renderLines();
    document.dispatchEvent(new Event('d3-cast-capture'));
}

function isReply(message) {
    return message && !message.is_system && !message.is_user && typeof message.mes === 'string' && message.mes.trim();
}

function lastText() {
    const index = (SillyTavern.getContext().chat ?? []).findLastIndex(isReply);
    return index >= 0 ? messageText(index) : '';
}

function submitLatest() {
    if (!ensureProvider()) return;
    const chat = SillyTavern.getContext().chat ?? [];
    const index = chat.findLastIndex(isReply);
    if (index < 0) return status('当前聊天还没有可提交的回复。');
    try { submissions.submit(provider, chat[index], index, false); }
    catch (error) { status(error.message); }
}

function renderLines() {
    if (!root) return;
    const box = $('lines');
    box.replaceChildren();
    if (!provider) return;
    let text;
    try { text = lastText(); }
    catch (error) { $('source_status').textContent = error.message; return; }
    const index = (SillyTavern.getContext().chat ?? []).findLastIndex(isReply);
    const segments = provider.turns(provider.parse(text));
    $('source_status').textContent = index < 0 ? '当前没有可读取的回复。'
        : `读取第 ${index + 1} 条回复的显示正文 · ${text.length} 字 · ${segments.length} 段`;
    if (!segments.length && text.includes('「') && !provider.settings.capture.jp) {
        $('source_status').textContent += '。正文含「」，请在台词识别中启用「」。';
    }
    for (const segment of segments) {
        const line = button((segment.speaker ?? (segment.narration ? '旁白' : '对白')) + ' · ' + segment.text,
            safe(event => playPoint(segment, event.currentTarget)));
        line.disabled = !segment.voice;
        const row = document.createElement('div');
        const label = document.createElement('small');
        label.textContent = (segment.voice ?? '静音') + ' · ' + segment.reason;
        row.append(line, label);
        box.append(row);
    }
}

async function playQueue(turns, mode, start = 0, options = {}) {
    const owner = provider;
    queue = turns;
    nextIndex = start;
    if (mode === 'stream') {
        await player.play(async function* (signal) {
            yield await owner.speech(turns.slice(start), { stream: true, signal });
        }, 'stream', { detail: '整轮流式 · ' + turns.length + ' 段', ...options });
    } else {
        await player.play(async function* (signal, setDetail) {
            for (let index = start; index < turns.length; index++) {
                if (signal.aborted) return;
                if (turns.length > 1) setDetail('分段合成 ' + (index + 1) + ' / ' + turns.length);
                yield { response: await owner.speech([turns[index]], { signal }),
                    complete: () => { nextIndex = index + 1; } };
            }
        }, 'wav', options);
    }
}

export async function playText(text) {
    if (!ensureProvider()) return;
    text ??= lastText();
    if (!provider.catalog.length) return status('请先到连接测试页刷新音色。');
    const turns = provider.turns(provider.parse(text)).filter(turn => turn.voice && turn.text);
    if (!turns.length) return status('这条消息没有可朗读台词。');
    await playQueue(turns, provider.settings.playback);
}

export async function playPoint(segment, trigger = null) {
    mountPanel();
    if (trigger && player.job?.trigger === trigger) return;
    if (!ensureProvider()) { openPanel(); return; }
    try {
        if (!provider.catalog.length) { openPanel(); return; }
        const [turn] = provider.turns([segment]);
        if (!turn.voice || !turn.text) return status('此段已静音。');
        const voice = provider.catalog.find(item => item.id === turn.voice);
        await playQueue([turn], 'segments', 0, { trigger, detail: (segment.speaker ?? voice?.label ?? '对白') + ' · 单句' });
    } catch (error) { status(error.message); }
}

export async function previewVoice(id) {
    mountPanel();
    if (!ensureProvider()) return;
    const voice = provider.catalog.find(item => item.id === id) ?? provider.catalog[0];
    if (!voice) throw new Error('请先连接服务并选择音色。');
    await playQueue([{ voice: voice.id, text: '你好。你听见海浪的声音了吗？' }], 'segments');
}
