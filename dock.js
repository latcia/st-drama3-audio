const storageKey = 'drama3-cast-dock-position';

export function movableDock(dock, handle, open) {
    const controller = new AbortController();
    const { signal } = controller;
    let position, drag, suppressClick = false;
    try { position = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Storage may be unavailable. */ }
    const viewport = () => {
        const view = window.visualViewport;
        return { x: view?.offsetLeft ?? 0, y: view?.offsetTop ?? 0, width: view?.width ?? innerWidth, height: view?.height ?? innerHeight };
    };
    function place(x, y, save = false) {
        const view = viewport();
        const size = handle.offsetWidth;
        const left = Math.max(view.x + 10, Math.min(x, view.x + view.width - size - 10));
        const top = Math.max(view.y + 10, Math.min(y, view.y + view.height - size - 10));
        dock.style.left = left + 'px'; dock.style.top = top + 'px';
        dock.style.right = 'auto'; dock.style.bottom = 'auto';
        dock.dataset.side = left < view.x + view.width / 2 ? 'left' : 'right';
        const available = dock.dataset.side === 'left' ? view.x + view.width - left - size - 20 : left - view.x - 20;
        dock.style.setProperty('--d3-status-width', Math.max(40, available) + 'px');
        if (save) {
            position = { x: (left - view.x) / Math.max(1, view.width - size), y: (top - view.y) / Math.max(1, view.height - size) };
            try { localStorage.setItem(storageKey, JSON.stringify(position)); } catch { /* Local preference only. */ }
        }
    }
    function restore() {
        if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
            const view = viewport(), size = handle.offsetWidth;
            place(view.x + position.x * (view.width - size), view.y + position.y * (view.height - size));
        } else {
            const rect = handle.getBoundingClientRect(); place(rect.left, rect.top);
        }
    }
    handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const rect = handle.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
        suppressClick = false;
        handle.setPointerCapture(event.pointerId);
    }, { signal });
    handle.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 7) return;
        drag.moved = true; dock.dataset.dragging = '';
        place(drag.left + dx, drag.top + dy);
    }, { signal });
    const end = event => {
        if (!drag || event.pointerId !== drag.id) return;
        const touchTap = event.type === 'pointerup' && event.pointerType === 'touch' && !drag.moved;
        suppressClick = drag.moved;
        if (drag.moved) { const rect = dock.getBoundingClientRect(); place(rect.left, rect.top, true); }
        drag = null; delete dock.dataset.dragging;
        // WebViews may omit the compatibility click after pointer capture.
        // Defer opening until after this gesture, and consume its optional click.
        if (touchTap) { suppressClick = true; requestAnimationFrame(open); }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) handle.addEventListener(type, end, { signal });
    handle.addEventListener('click', event => {
        if (suppressClick && event.detail !== 0) { suppressClick = false; event.preventDefault(); return; }
        open();
    }, { signal });
    window.addEventListener('resize', restore, { signal });
    window.visualViewport?.addEventListener('resize', restore, { signal });
    window.visualViewport?.addEventListener('scroll', restore, { signal });
    requestAnimationFrame(restore);
    return () => controller.abort();
}
