// BreedIQ — "Ask BreedIQ" floating assistant
// Dropped into authenticated pages via <script src="/ask-breediq.js" defer></script>.
// Vanilla JS + Tailwind classes — no React dependency.
//
// Public API:
//   window.AskBreedIQ.setContext({ page, entity_id?, entity_snapshot? })
//   window.AskBreedIQ.open()
//   window.AskBreedIQ.close()
//   window.AskBreedIQ.toggle()
//
// Host pages should call setContext() after their data loads. If nothing is
// registered, context defaults to { page: location.pathname }.

(function () {
    'use strict';
    if (window.AskBreedIQ && window.AskBreedIQ._installed) return;

    const LS_OPEN_KEY = 'breediq_assistant_open';
    const LS_DRAFT_KEY = 'breediq_assistant_draft';
    const LS_HISTORY_KEY = 'breediq_assistant_history';
    const MAX_HISTORY_CHARS = 40000; // stash the last ~40KB of history locally

    let state = {
        open: false,
        context: { page: location.pathname },
        messages: [],           // { role: 'user'|'assistant', text, toolCalls?, toolResults?, pending?, requiresConfirmation? }
        sending: false,
        draft: '',
        confirmations: []       // pending destructive tool confirmations to resend
    };

    // ── Persistence ────────────────────────────────────────
    try {
        state.open = localStorage.getItem(LS_OPEN_KEY) === '1';
        state.draft = localStorage.getItem(LS_DRAFT_KEY) || '';
        const h = localStorage.getItem(LS_HISTORY_KEY);
        if (h) {
            const parsed = JSON.parse(h);
            if (Array.isArray(parsed)) state.messages = parsed.slice(-40);
        }
    } catch (e) { /* ignore */ }

    function persistHistory() {
        try {
            const serialized = JSON.stringify(state.messages.slice(-40));
            if (serialized.length < MAX_HISTORY_CHARS) localStorage.setItem(LS_HISTORY_KEY, serialized);
        } catch (e) { /* ignore */ }
    }

    // ── DOM construction ──────────────────────────────────
    let root;       // container element
    let btnEl;
    let panelEl;
    let messagesEl;
    let contextPillEl;
    let textareaEl;
    let sendBtnEl;
    let clearBtnEl;

    function h(tag, attrs, children) {
        const el = document.createElement(tag);
        if (attrs) {
            for (const k in attrs) {
                if (k === 'class') el.className = attrs[k];
                else if (k === 'html') el.innerHTML = attrs[k];
                else if (k.startsWith('on') && typeof attrs[k] === 'function') el.addEventListener(k.slice(2), attrs[k]);
                else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(el.style, attrs[k]);
                else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
            }
        }
        (children || []).forEach(c => {
            if (c === null || c === undefined) return;
            if (typeof c === 'string') el.appendChild(document.createTextNode(c));
            else el.appendChild(c);
        });
        return el;
    }

    function build() {
        if (root) return;

        root = h('div', { id: 'askbreediq-root', 'aria-live': 'polite' });

        // ── Floating button ──
        btnEl = h('button', {
            id: 'askbreediq-btn',
            'aria-label': 'Ask BreedIQ',
            title: 'Ask BreedIQ  (Ctrl / Cmd + K)',
            class: 'askbreediq-btn',
            onclick: () => toggle()
        }, [
            // inline svg sparkle
            h('span', { class: 'askbreediq-btn-icon', html: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2zm6 12l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>` }),
            h('span', { class: 'askbreediq-btn-label' }, ['Ask BreedIQ'])
        ]);

        // ── Sidebar panel ──
        const header = h('div', { class: 'askbreediq-header' }, [
            h('div', { class: 'askbreediq-title' }, [
                h('span', { class: 'askbreediq-title-icon', html: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 2l1.8 5.4L19 9l-5.2 1.6L12 16l-1.8-5.4L5 9l5.2-1.6L12 2z"/></svg>` }),
                h('span', null, ['Ask BreedIQ'])
            ]),
            h('div', { class: 'askbreediq-header-actions' }, [
                (clearBtnEl = h('button', {
                    class: 'askbreediq-icon-btn',
                    'aria-label': 'Clear conversation',
                    title: 'Clear conversation',
                    onclick: () => clearHistory()
                }, [h('span', { html: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-3h6l1 2h4v2H2V6h4l1-2z"/></svg>` })]) ),
                h('button', {
                    class: 'askbreediq-icon-btn',
                    'aria-label': 'Close assistant',
                    title: 'Close (Esc)',
                    onclick: () => close()
                }, [h('span', { html: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3 10.6 10.6 16.9 4.3z"/></svg>` })])
            ])
        ]);

        contextPillEl = h('div', { class: 'askbreediq-context-pill' });

        messagesEl = h('div', {
            id: 'askbreediq-messages',
            class: 'askbreediq-messages',
            role: 'log',
            'aria-live': 'polite'
        });

        const composer = h('div', { class: 'askbreediq-composer' }, [
            (textareaEl = h('textarea', {
                id: 'askbreediq-textarea',
                class: 'askbreediq-textarea',
                placeholder: 'Ask anything, or update your records: "Add a new dog named Luna…"',
                rows: '3',
                'aria-label': 'Your message',
                onkeydown: onComposerKeyDown,
                oninput: () => {
                    state.draft = textareaEl.value;
                    try { localStorage.setItem(LS_DRAFT_KEY, state.draft); } catch (e) { }
                }
            })),
            h('div', { class: 'askbreediq-composer-row' }, [
                h('span', { class: 'askbreediq-hint' }, ['Enter to send  ·  Shift+Enter for newline']),
                (sendBtnEl = h('button', {
                    class: 'askbreediq-send-btn',
                    onclick: () => sendMessage(),
                    'aria-label': 'Send message'
                }, ['Send']))
            ])
        ]);

        panelEl = h('aside', {
            id: 'askbreediq-panel',
            class: 'askbreediq-panel',
            role: 'dialog',
            'aria-label': 'BreedIQ assistant',
            'aria-hidden': 'true'
        }, [header, contextPillEl, messagesEl, composer]);

        root.appendChild(btnEl);
        root.appendChild(panelEl);
        document.body.appendChild(root);

        injectStyles();

        // Restore draft
        if (state.draft) textareaEl.value = state.draft;
        if (state.open) open();
        renderMessages();
        renderContext();

        // Keybindings (Cmd/Ctrl+K opens, Esc closes when open)
        document.addEventListener('keydown', (e) => {
            const metaK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
            if (metaK) {
                e.preventDefault();
                toggle();
            } else if (e.key === 'Escape' && state.open) {
                close();
            }
        });

        // Focus trap — basic: trap Tab inside panelEl when open
        panelEl.addEventListener('keydown', (e) => {
            if (!state.open || e.key !== 'Tab') return;
            const focusable = panelEl.querySelectorAll('button, textarea, [tabindex]:not([tabindex="-1"])');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault(); last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault(); first.focus();
            }
        });
    }

    function injectStyles() {
        if (document.getElementById('askbreediq-styles')) return;
        const styles = `
          #askbreediq-root, #askbreediq-root * { box-sizing: border-box; }
          .askbreediq-btn {
            position: fixed; bottom: 24px; right: 24px; z-index: 2147483000;
            display: inline-flex; align-items: center; gap: 8px;
            padding: 14px 16px; border-radius: 9999px;
            background: #059669; color: #fff; border: none;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 14px; font-weight: 600;
            cursor: pointer; box-shadow: 0 8px 24px rgba(5, 150, 105, 0.35), 0 4px 8px rgba(0,0,0,0.25);
            transition: transform 120ms ease, background 120ms ease;
          }
          .askbreediq-btn:hover { background: #047857; transform: translateY(-1px); }
          .askbreediq-btn-icon { display: inline-flex; }
          .askbreediq-btn-label { white-space: nowrap; }
          @media (max-width: 640px) {
            .askbreediq-btn { padding: 12px; }
            .askbreediq-btn-label { display: none; }
          }
          .askbreediq-panel {
            position: fixed; top: 0; right: 0; height: 100dvh;
            width: min(420px, 100vw);
            background: #0f172a; color: #f1f5f9;
            border-left: 1px solid #1e293b;
            box-shadow: -16px 0 40px rgba(0,0,0,0.4);
            transform: translateX(100%);
            transition: transform 220ms ease;
            display: flex; flex-direction: column;
            z-index: 2147483001;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .askbreediq-panel[data-open="true"] { transform: translateX(0); }
          .askbreediq-panel[aria-hidden="false"] { pointer-events: auto; }
          @media (max-width: 640px) {
            .askbreediq-panel { width: 100vw; border-left: none; }
          }
          .askbreediq-header {
            display: flex; justify-content: space-between; align-items: center;
            padding: 14px 16px;
            border-bottom: 1px solid #1e293b;
            background: linear-gradient(90deg, #064e3b 0%, #0f172a 100%);
          }
          .askbreediq-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
          .askbreediq-title-icon { color: #34d399; display: inline-flex; }
          .askbreediq-header-actions { display: flex; gap: 4px; }
          .askbreediq-icon-btn {
            background: transparent; border: none; color: #94a3b8;
            padding: 6px 8px; cursor: pointer; border-radius: 6px;
            display: inline-flex; align-items: center; justify-content: center;
          }
          .askbreediq-icon-btn:hover { background: #1e293b; color: #f1f5f9; }
          .askbreediq-context-pill {
            margin: 10px 16px; padding: 6px 10px; font-size: 12px;
            color: #a7f3d0; background: #064e3b; border: 1px solid #065f46;
            border-radius: 9999px; display: inline-flex; width: fit-content;
          }
          .askbreediq-messages {
            flex: 1; overflow-y: auto; padding: 12px 16px;
            display: flex; flex-direction: column; gap: 10px;
          }
          .askbreediq-messages::-webkit-scrollbar { width: 6px; }
          .askbreediq-messages::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 6px; }
          .askbreediq-msg { max-width: 100%; word-wrap: break-word; white-space: pre-wrap; }
          .askbreediq-msg-user {
            align-self: flex-end; background: #064e3b; color: #d1fae5;
            padding: 8px 12px; border-radius: 14px 14px 2px 14px;
            font-size: 14px; line-height: 1.45; max-width: 85%;
          }
          .askbreediq-msg-assistant {
            align-self: flex-start; background: #1e293b; color: #e2e8f0;
            padding: 8px 12px; border-radius: 14px 14px 14px 2px;
            font-size: 14px; line-height: 1.45; max-width: 85%;
          }
          .askbreediq-msg-assistant.pending { opacity: 0.85; }
          .askbreediq-msg-assistant a { color: #6ee7b7; text-decoration: underline; }
          .askbreediq-tool-chip {
            align-self: flex-start; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            background: #0b1220; color: #cbd5e1;
            border: 1px solid #1e293b; border-radius: 8px;
            padding: 6px 10px; max-width: 85%;
          }
          .askbreediq-tool-chip.ok { border-color: #065f46; color: #6ee7b7; }
          .askbreediq-tool-chip.err { border-color: #7f1d1d; color: #fca5a5; }
          .askbreediq-tool-chip.confirm { border-color: #92400e; color: #fcd34d; }
          .askbreediq-confirm-actions { display: flex; gap: 8px; margin-top: 8px; }
          .askbreediq-confirm-btn {
            padding: 4px 10px; font-size: 12px; border-radius: 6px; border: none; cursor: pointer;
          }
          .askbreediq-confirm-btn.danger { background: #b91c1c; color: #fff; }
          .askbreediq-confirm-btn.cancel { background: #1e293b; color: #cbd5e1; }
          .askbreediq-composer {
            border-top: 1px solid #1e293b; padding: 10px 12px; background: #0b1220;
          }
          .askbreediq-textarea {
            width: 100%; padding: 10px 12px; font-size: 14px; line-height: 1.4;
            background: #020617; color: #f1f5f9; border: 1px solid #1e293b; border-radius: 8px;
            resize: none; font-family: inherit; outline: none;
          }
          .askbreediq-textarea:focus { border-color: #10b981; }
          .askbreediq-composer-row {
            display: flex; align-items: center; justify-content: space-between; margin-top: 8px;
          }
          .askbreediq-hint { color: #64748b; font-size: 11px; }
          .askbreediq-send-btn {
            padding: 6px 16px; font-size: 13px; font-weight: 600;
            background: #059669; color: #fff; border: none; border-radius: 8px; cursor: pointer;
          }
          .askbreediq-send-btn:hover { background: #047857; }
          .askbreediq-send-btn:disabled { background: #334155; color: #94a3b8; cursor: not-allowed; }
          .askbreediq-typing { display: inline-flex; gap: 3px; padding-left: 4px; align-items: center; }
          .askbreediq-typing span { width: 4px; height: 4px; border-radius: 9999px; background: #64748b; animation: askbreediq-blink 1.2s infinite; }
          .askbreediq-typing span:nth-child(2) { animation-delay: 0.2s; }
          .askbreediq-typing span:nth-child(3) { animation-delay: 0.4s; }
          @keyframes askbreediq-blink { 0%, 80%, 100% { opacity: 0.3; } 40% { opacity: 1; } }
        `;
        const styleEl = h('style', { id: 'askbreediq-styles' });
        styleEl.textContent = styles;
        document.head.appendChild(styleEl);
    }

    // ── UI helpers ───────────────────────────────────────
    function renderContext() {
        if (!contextPillEl) return;
        const ctx = state.context || {};
        let label = 'Viewing: ' + (ctx.page || 'unknown');
        if (ctx.entity_snapshot?.name) label = `Viewing: ${ctx.entity_snapshot.name}`;
        else if (ctx.entity_snapshot?.title) label = `Viewing: ${ctx.entity_snapshot.title}`;
        contextPillEl.textContent = label;
    }

    function renderMessages() {
        if (!messagesEl) return;
        messagesEl.innerHTML = '';

        if (state.messages.length === 0) {
            const intro = h('div', { class: 'askbreediq-msg-assistant' }, [
                'Hi — I\'m your BreedIQ copilot. Ask me anything about your program, or tell me what changed and I\'ll update your records. Try:',
                h('br'),
                h('br'),
                h('em', null, ['"How many active dams do I have?"']),
                h('br'),
                h('em', null, ['"Add a new dog named Luna, female goldendoodle, DOB 2024-06-01"']),
                h('br'),
                h('em', null, ['"Poppy\'s litter was born today with 7 pups, 3M/4F"'])
            ]);
            messagesEl.appendChild(intro);
        }

        for (const msg of state.messages) {
            if (msg.role === 'user') {
                messagesEl.appendChild(h('div', { class: 'askbreediq-msg askbreediq-msg-user' }, [msg.text || '']));
            } else if (msg.role === 'assistant') {
                const wrap = h('div', { class: 'askbreediq-msg askbreediq-msg-assistant' + (msg.pending ? ' pending' : '') });
                const bodyText = msg.text || (msg.pending ? '' : '');
                if (bodyText) wrap.appendChild(document.createTextNode(bodyText));
                if (msg.pending) {
                    wrap.appendChild(h('span', { class: 'askbreediq-typing' }, [h('span'), h('span'), h('span')]));
                }
                messagesEl.appendChild(wrap);

                // Render any tool calls / results under the assistant turn
                if (Array.isArray(msg.toolEvents)) {
                    for (const te of msg.toolEvents) {
                        messagesEl.appendChild(renderToolEvent(te));
                    }
                }
            }
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderToolEvent(te) {
        if (te.kind === 'tool_use') {
            return h('div', { class: 'askbreediq-tool-chip' }, [
                h('strong', null, [te.tool_name]),
                h('span', null, [' ' + formatToolArgs(te.input)])
            ]);
        }
        if (te.kind === 'tool_result') {
            const cls = te.ok ? 'ok' : (te.requiresConfirmation ? 'confirm' : 'err');
            const children = [h('strong', null, [te.tool_name]), h('span', null, [te.ok ? ' ✓' : (te.requiresConfirmation ? ' – needs confirmation' : ' ✕')])];
            if (te.message) {
                children.push(h('br'));
                children.push(document.createTextNode(te.message));
            }
            if (te.requiresConfirmation) {
                const actions = h('div', { class: 'askbreediq-confirm-actions' }, [
                    h('button', {
                        class: 'askbreediq-confirm-btn danger',
                        onclick: () => confirmDestructive(te)
                    }, ['Confirm delete']),
                    h('button', {
                        class: 'askbreediq-confirm-btn cancel',
                        onclick: () => cancelDestructive(te)
                    }, ['Cancel'])
                ]);
                children.push(actions);
            }
            return h('div', { class: 'askbreediq-tool-chip ' + cls }, children);
        }
        return h('div');
    }

    function formatToolArgs(input) {
        if (!input || typeof input !== 'object') return '';
        const entries = Object.entries(input).filter(([k, v]) => v !== null && v !== undefined && v !== '');
        if (entries.length === 0) return '';
        const short = entries.slice(0, 4).map(([k, v]) => `${k}=${truncateVal(v)}`).join(', ');
        return '(' + short + (entries.length > 4 ? ', …' : '') + ')';
    }
    function truncateVal(v) {
        if (typeof v === 'string') return v.length > 30 ? (v.slice(0, 30) + '…') : v;
        if (typeof v === 'boolean' || typeof v === 'number') return String(v);
        return typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v);
    }

    // ── Networking ────────────────────────────────────────
    async function sendMessage(extraUserBlocks) {
        if (state.sending) return;
        const text = (textareaEl?.value || '').trim();
        if (!text && !extraUserBlocks) return;

        state.sending = true;
        if (sendBtnEl) { sendBtnEl.disabled = true; sendBtnEl.textContent = 'Sending…'; }

        let userBlocks;
        if (extraUserBlocks) {
            userBlocks = extraUserBlocks;
        } else {
            userBlocks = [{ type: 'text', text }];
            state.messages.push({ role: 'user', text });
            textareaEl.value = '';
            state.draft = '';
            try { localStorage.removeItem(LS_DRAFT_KEY); } catch (e) { }
        }

        const assistantMsg = { role: 'assistant', text: '', pending: true, toolEvents: [] };
        state.messages.push(assistantMsg);
        renderMessages();

        // Build messages array for API — translate our local shape into Anthropic content blocks
        const apiMessages = [];
        for (const m of state.messages) {
            if (m === assistantMsg) break;
            if (m.role === 'user') {
                // Re-send as plain text — tool_result follow-ups flow through extraUserBlocks only
                apiMessages.push({ role: 'user', content: m.text || '' });
            } else if (m.role === 'assistant' && !m.pending) {
                // Keep it simple — send as plain text of the model's reply. We don't replay tool history
                // because the server rebuilds it per-turn within the agent loop. For multi-turn memory
                // beyond the loop we rely on the model re-reading current state via tools.
                if (m.text) apiMessages.push({ role: 'assistant', content: m.text });
            }
        }
        if (extraUserBlocks) apiMessages.push({ role: 'user', content: extraUserBlocks });

        try {
            const resp = await fetch('/api/assistant/chat', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: apiMessages,
                    page_context: state.context || { page: location.pathname }
                })
            });
            if (!resp.ok) {
                const errText = await resp.text().catch(() => '');
                assistantMsg.pending = false;
                assistantMsg.text = `I couldn\'t reach the server (${resp.status}). ${errText.slice(0, 200)}`;
                renderMessages();
                return;
            }
            await consumeNdjsonStream(resp, assistantMsg);
        } catch (err) {
            assistantMsg.pending = false;
            assistantMsg.text = (assistantMsg.text || '') + '\n\nSomething went wrong: ' + (err.message || String(err));
            renderMessages();
        } finally {
            state.sending = false;
            if (sendBtnEl) { sendBtnEl.disabled = false; sendBtnEl.textContent = 'Send'; }
            persistHistory();
        }
    }

    async function consumeNdjsonStream(resp, assistantMsg) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newlineIdx;
            while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIdx).trim();
                buffer = buffer.slice(newlineIdx + 1);
                if (!line) continue;
                try {
                    const evt = JSON.parse(line);
                    handleStreamEvent(evt, assistantMsg);
                } catch (e) {
                    console.warn('[askbreediq] bad NDJSON line', line);
                }
            }
        }
        assistantMsg.pending = false;
        renderMessages();
    }

    function handleStreamEvent(evt, assistantMsg) {
        switch (evt.type) {
            case 'start':
                assistantMsg.text = '';
                renderMessages();
                break;
            case 'text_delta':
                assistantMsg.text = (assistantMsg.text || '') + (evt.text || '');
                renderMessages();
                break;
            case 'tool_use':
                assistantMsg.toolEvents = assistantMsg.toolEvents || [];
                assistantMsg.toolEvents.push({
                    kind: 'tool_use',
                    tool_use_id: evt.tool_use_id,
                    tool_name: evt.tool_name,
                    input: evt.input
                });
                renderMessages();
                break;
            case 'tool_result': {
                assistantMsg.toolEvents = assistantMsg.toolEvents || [];
                let message = '';
                if (evt.ok) {
                    message = summarizeResult(evt.tool_name, evt.result);
                } else if (evt.requires_confirmation) {
                    message = describeDestructive(evt.tool_name, evt.target);
                } else if (evt.error) {
                    message = evt.error;
                }
                assistantMsg.toolEvents.push({
                    kind: 'tool_result',
                    tool_use_id: evt.tool_use_id,
                    tool_name: evt.tool_name,
                    ok: !!evt.ok,
                    requiresConfirmation: !!evt.requires_confirmation,
                    target: evt.target,
                    message,
                    destructive: !!evt.destructive
                });
                renderMessages();
                break;
            }
            case 'done':
                assistantMsg.pending = false;
                assistantMsg.usage = evt.usage;
                renderMessages();
                break;
            case 'error':
                assistantMsg.pending = false;
                assistantMsg.text = (assistantMsg.text || '') + '\n\n' + (evt.error || 'Unknown error');
                renderMessages();
                break;
            default:
                break;
        }
    }

    function summarizeResult(toolName, result) {
        if (!result) return '';
        if (result.dog?.name) return `${result.dog.name}`;
        if (result.litter?.id) return `Litter ${result.litter.status || ''} (${result.litter.breed_date || result.litter.whelp_date || result.litter.id.slice(0, 6)})`;
        if (result.guardian?.family_name) return `${result.guardian.family_name}`;
        if (result.event?.title) return `${result.event.title} on ${result.event.event_date}`;
        if (typeof result.summary === 'string') return result.summary;
        if (result.deleted) return 'Deleted';
        return '';
    }

    function describeDestructive(toolName, target) {
        if (!target) return 'Confirm deletion to proceed.';
        if (toolName === 'delete_dog') return `Delete dog "${target.name || target.id}"? This is permanent.`;
        if (toolName === 'delete_litter') return `Delete litter (dam: ${target.dam || '?'}, status: ${target.status || '?'})? This is permanent.`;
        if (toolName === 'delete_guardian') return `Delete guardian "${target.family_name || target.id}"? This is permanent.`;
        return 'Confirm deletion to proceed.';
    }

    function confirmDestructive(te) {
        // Resubmit with an explicit confirm message so the model will call the tool again with confirm_delete
        const hint = `Yes, confirm — proceed with ${te.tool_name}${te.target?.id ? ' for id ' + te.target.id : ''} (confirm_delete:true).`;
        if (textareaEl) { textareaEl.value = ''; }
        state.messages.push({ role: 'user', text: hint });
        sendMessage([{ type: 'text', text: hint }]);
    }

    function cancelDestructive(te) {
        state.messages.push({ role: 'user', text: `Cancel — do not delete.` });
        renderMessages();
        persistHistory();
    }

    function onComposerKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    // ── Public API ────────────────────────────────────────
    function open() {
        state.open = true;
        if (panelEl) {
            panelEl.setAttribute('data-open', 'true');
            panelEl.setAttribute('aria-hidden', 'false');
            setTimeout(() => textareaEl?.focus(), 120);
        }
        try { localStorage.setItem(LS_OPEN_KEY, '1'); } catch (e) { }
    }
    function close() {
        state.open = false;
        if (panelEl) {
            panelEl.setAttribute('data-open', 'false');
            panelEl.setAttribute('aria-hidden', 'true');
        }
        try { localStorage.setItem(LS_OPEN_KEY, '0'); } catch (e) { }
    }
    function toggle() { state.open ? close() : open(); }
    function setContext(ctx) {
        if (!ctx || typeof ctx !== 'object') return;
        state.context = Object.assign({ page: location.pathname }, ctx);
        renderContext();
    }
    function clearHistory() {
        state.messages = [];
        try { localStorage.removeItem(LS_HISTORY_KEY); } catch (e) { }
        renderMessages();
    }

    window.AskBreedIQ = {
        _installed: true,
        open, close, toggle, setContext, clearHistory,
        get state() { return { ...state, messages: state.messages.slice() }; }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build, { once: true });
    } else {
        build();
    }
})();
