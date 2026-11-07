/** A single playback owner for point reads, queues and live PCM. */
export class CastPlayer {
    job = null;

    constructor(onState) {
        this.onState = onState;
    }

    stop() {
        const job = this.job;
        if (!job) return;
        this.job = null;
        job.controller.abort();
        for (const source of job.sources) { try { source.stop(); } catch {} }
        job.context.close().catch(() => {});
        this.onState('stopped', '已停止');
    }

    async togglePause() {
        const job = this.job;
        if (!job || job.phase === 'waiting' || job.changingPause) return;
        job.changingPause = true;
        try {
            if (job.phase === 'paused') {
                await job.context.resume();
                job.update(job.sources.size ? 'playing' : 'waiting');
            } else {
                await job.context.suspend();
                job.update('paused');
            }
        } catch {} finally { job.changingPause = false; }
    }

    async play(load, mode, { detail = '', waiting = '正在生成…', trigger = null } = {}) {
        this.stop();
        let context;
        try { context = new AudioContext(); }
        catch (error) { this.onState('error', error.message || '无法启动音频'); return; }
        const job = { context, controller: new AbortController(), sources: new Set(), next: 0,
            last: Promise.resolve(), phase: 'waiting', trigger };
        this.job = job;
        const signal = job.controller.signal;
        job.update = (phase, text) => {
            if (this.job !== job || signal.aborted) return;
            const message = text ?? { waiting, playing: '播放中', paused: '已暂停' }[phase];
            if (job.phase === phase && job.message === message && job.detail === detail) return;
            job.phase = phase;
            job.message = message;
            job.detail = detail;
            this.onState(phase, message, detail, trigger);
        };
        job.update('waiting');
        const enqueue = (buffer, onComplete) => {
            if (signal.aborted) return;
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            const start = Math.max(job.next, context.currentTime + (job.next ? .035 : .16));
            job.next = start + buffer.duration;
            job.sources.add(source);
            job.last = new Promise(resolve => {
                const abort = () => resolve();
                source.onended = () => {
                    signal.removeEventListener('abort', abort);
                    job.sources.delete(source);
                    if (!signal.aborted) {
                        onComplete?.();
                        if (!job.sources.size && !job.loaded && job.phase !== 'paused') job.update('waiting');
                    }
                    resolve();
                };
                signal.addEventListener('abort', abort, { once: true });
            });
            source.start(start);
            if (job.phase !== 'paused') job.update('playing');
        };
        try {
            await context.resume();
            for await (const item of load(signal, label => {
                detail = label;
                job.update(job.phase);
            })) {
                if (signal.aborted) break;
                const response = item.response ?? item;
                if (mode === 'stream') await this.stream(response, context, enqueue, signal);
                else enqueue(await context.decodeAudioData(await response.arrayBuffer()), item.complete);
                if (job.next > context.currentTime + 10) await job.last;
            }
            job.loaded = true;
            await job.last;
            job.update('complete', '播放完成');
        } catch (error) {
            job.update('error', error.message || '播放失败');
        } finally {
            if (this.job === job) {
                this.job = null;
                job.controller.abort();
                await context.close().catch(() => {});
            }
        }
    }

    async stream(response, context, enqueue, signal) {
        if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) {
            throw new Error('服务没有返回实时音频流，可切换分段模式。');
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';
        let frames = [];
        let count = 0;
        let done = false;
        const flush = () => {
            if (!count) return;
            const audio = context.createBuffer(1, count, 44100);
            const channel = audio.getChannelData(0);
            let offset = 0;
            for (const frame of frames) { channel.set(frame, offset); offset += frame.length; }
            frames = [];
            count = 0;
            enqueue(audio);
        };
        const handle = line => {
            if (!line.startsWith('data:')) return;
            const value = line.slice(5).trim();
            if (value === '[DONE]') { done = true; return; }
            const item = JSON.parse(value);
            if (item.type === 'error') throw new Error(item.error?.message ?? '流式合成失败');
            if (item.type !== 'speech.audio.delta' || !item.audio) return;
            const bytes = atob(item.audio);
            const frame = new Float32Array(bytes.length >>> 1);
            for (let i = 0; i < frame.length; i++) {
                const raw = bytes.charCodeAt(i * 2) | bytes.charCodeAt(i * 2 + 1) << 8;
                frame[i] = (raw >= 32768 ? raw - 65536 : raw) / 32768;
            }
            count += frame.length;
            frames.push(frame);
            if (count >= 11025) flush();
        };
        try {
            while (!done && !signal.aborted) {
                const chunk = await reader.read();
                if (chunk.done) break;
                pending += decoder.decode(chunk.value, { stream: true });
                let lineEnd;
                while ((lineEnd = pending.indexOf('\n')) >= 0) {
                    handle(pending.slice(0, lineEnd));
                    pending = pending.slice(lineEnd + 1);
                }
            }
            if (pending) handle(pending);
            flush();
            if (!done && !signal.aborted) throw new Error('音频流中途断开，请改用分段续播。');
        } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
}
