import { splitIntoChunks } from './lib.js';
import { parseCast } from './parser.js';

export function submissionTurns(provider, text, scope) {
    const segments = parseCast(text, { ...provider.settings, mode: scope === 'full' ? 'all' : 'quotes' });
    return provider.turns(segments).filter(turn => turn.voice && turn.text).flatMap(turn => {
        const parts = splitIntoChunks(turn.text, { first: 260, max: 260 });
        // Keep even an unpunctuated run under the bridge request limit.
        return parts.flatMap(part => part.match(/[\s\S]{1,1000}/gu))
            .map(text => text.trim()).filter(Boolean).map(text => ({ ...turn, text }));
    });
}

export class SubmissionQueue {
    pending = [];
    history = [];
    seen = new WeakMap();
    playback = [];

    constructor(container, report, beforeAudio, canAutoplay) {
        this.container = container;
        this.report = report;
        this.beforeAudio = beforeAudio;
        this.canAutoplay = canAutoplay;
    }

    submit(provider, message, index, automatic) {
        const text = message.mes;
        const previous = this.seen.get(message);
        if (previous?.text === text && (automatic || !previous.finished)) return;
        const record = { text, finished: false };
        const job = { provider, message, index, text, record, scope: provider.settings.submitScope,
            autoplay: provider.settings.submitAutoplay, clips: [] };
        this.seen.set(message, record);
        this.pending.push(job);
        if (!this.worker) void this.run();
    }

    async run() {
        const worker = new AbortController();
        this.worker = worker;
        const { signal } = worker;
        while (this.pending.length && !signal.aborted) {
            const job = this.pending.shift();
            this.current = job;
            this.addResult(job);
            const report = (phase, label, detail) => {
                job.label.textContent = detail ? label + ' · ' + detail : label;
                this.report(phase, label, detail);
            };
            let returned = 0;
            try {
                report('waiting', '正在准备分段…');
                if (!job.provider.catalog.length) await job.provider.refresh(signal);
                if (signal.aborted) break;
                const turns = submissionTurns(job.provider, job.text, job.scope);
                if (!turns.length) throw new Error('这条回复没有可提交的内容。');
                for (const turn of turns) {
                    report('waiting', '正在分段提交…', `已返回 ${returned} / ${turns.length} 段`);
                    const response = await job.provider.speech([turn], { signal });
                    const audio = await response.blob();
                    if (signal.aborted) break;
                    if (!audio.size || !audio.type.startsWith('audio/')) throw new Error('服务未返回有效音频。');
                    this.appendClip(job, turn, audio, ++returned);
                }
                if (!signal.aborted) report('complete', '分段提交完成', `已返回 ${returned} 段`);
            } catch (error) {
                if (!signal.aborted) {
                    this.forget(job);
                    report('error', error.message || '分段提交失败', `已返回 ${returned} 段`);
                }
            } finally {
                job.record.finished = true;
            }
        }
        if (this.worker === worker) {
            this.current = null;
            this.worker = null;
        }
    }

    addResult(job) {
        const result = document.createElement('section');
        result.className = 'd3-result';
        const title = document.createElement('h5');
        title.textContent = `第 ${job.index + 1} 条消息`;
        job.label = document.createElement('p');
        job.label.setAttribute('role', 'status');
        result.append(title, job.label);
        job.result = result;
        this.container.append(result);
        this.history.push(job);
        if (this.history.length > 5) this.release(this.history.shift());
    }

    appendClip(job, turn, blob, index) {
        const row = document.createElement('div');
        row.className = 'd3-result-clip';
        const label = document.createElement('span');
        label.textContent = `${index}. ${turn.speaker ?? (turn.narration ? '旁白' : '对白')} · ${turn.text}`;
        const audio = document.createElement('audio');
        const url = URL.createObjectURL(blob);
        audio.controls = true;
        audio.preload = 'none';
        audio.src = url;
        audio.setAttribute('aria-label', '播放第 ' + index + ' 段');
        audio.addEventListener('play', () => {
            if (this.audio !== audio) {
                this.audio?.pause();
                this.playback.length = 0;
                this.audio = audio;
            }
            this.beforeAudio();
        });
        audio.addEventListener('ended', () => {
            if (this.audio !== audio) return;
            this.audio = null;
            this.playNext();
        });
        row.append(label, audio);
        job.result.append(row);
        job.clips.push({ audio, url });
        if (job.autoplay) {
            this.playback.push({ job, audio });
            this.playNext();
        }
    }

    playNext() {
        if (this.audio || !this.playback.length) return;
        if (!this.canAutoplay()) { this.playback.length = 0; return; }
        const { job, audio } = this.playback.shift();
        this.audio = audio;
        audio.play().catch(() => {
            if (this.audio !== audio) return;
            this.audio = null;
            job.autoplay = false;
            this.playback = this.playback.filter(clip => clip.job !== job);
            const hint = document.createElement('p');
            hint.textContent = '自动播放未能开始，可以点下方音频手动播放。';
            job.label.after(hint);
            this.playNext();
        });
    }

    pauseAudio() {
        if (this.current) this.current.autoplay = false;
        this.playback.length = 0;
        this.audio?.pause();
        this.audio = null;
    }

    forget(job) {
        if (this.seen.get(job.message) === job.record) this.seen.delete(job.message);
    }

    stop() {
        if (!this.worker && !this.audio) return;
        const current = this.current;
        if (current) {
            current.label.textContent = '已停止提交';
            this.forget(current);
        }
        for (const job of this.pending) this.forget(job);
        this.pending.length = 0;
        this.worker?.abort();
        this.worker = null;
        this.pauseAudio();
        this.current = null;
        this.report('stopped', '已停止提交');
    }

    release(job) {
        this.playback = this.playback.filter(clip => clip.job !== job);
        for (const { audio, url } of job.clips) {
            if (this.audio === audio) this.audio = null;
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(url);
        }
        job.result.remove();
        this.playNext();
    }

    clear() {
        if (this.worker || this.audio) this.stop();
        for (const job of this.history) this.release(job);
        this.history.length = 0;
        this.seen = new WeakMap();
    }
}
