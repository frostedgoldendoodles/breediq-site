// BreedIQ Calendar API - Derived event feed
// GET /api/litters/calendar
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const EVENT_META = {
    heat_due:   { color: 'bg-pink-500',    label: 'Heat window' },
    breed:      { color: 'bg-purple-500',  label: 'Breeding' },
    ultrasound: { color: 'bg-cyan-500',    label: 'Ultrasound' },
    xray:       { color: 'bg-indigo-500',  label: 'X-ray' },
    due:        { color: 'bg-amber-500',   label: 'Due date' },
    whelp:      { color: 'bg-red-500',     label: 'Whelp' },
    go_home:    { color: 'bg-emerald-500', label: 'Go home' },
    vet_due:    { color: 'bg-blue-500',    label: 'Vet visit due' }
};

function isoDate(d) {
    if (!d) return null;
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
}

function withinWindow(dateStr, startMs, endMs) {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    if (isNaN(t)) return false;
    return t >= startMs && t <= endMs;
}

function pushEvent(list, { id, type, date, title, dogName, dogId, litterId }) {
    if (!date) return;
    const meta = EVENT_META[type] || { color: 'bg-slate-500', label: type };
    list.push({
        id, type, date,
        title: title || meta.label,
        dogName: dogName || null,
        dogId: dogId || null,
        litterId: litterId || null,
        color: meta.color,
        label: meta.label
    });
}

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // Check for sub-breeder relationships (program owner sees all)
    const { data: relationships } = await supabase
        .from('breeder_relationships')
        .select('breeder_id')
        .eq('owner_id', userId)
        .eq('status', 'active');

    const breederIds = (relationships || []).map(r => r.breeder_id);
    const allUserIds = [userId, ...breederIds];

    try {
        const now = Date.now();
        const windowStart = now - 30 * DAY_MS;
        const windowEnd = now + 90 * DAY_MS;

        const { data: dogs, error: dogsErr } = await supabase
            .from('dogs')
            .select('id, name, call_name, last_heat_date, avg_heat_cycle_days, vet_last_visit, status')
            .in('user_id', allUserIds);

        if (dogsErr) {
            console.error('Calendar dogs error:', dogsErr);
            return res.status(500).json({ error: 'Failed to load dogs for calendar' });
        }

        const { data: litters, error: littersErr } = await supabase
            .from('litters')
            .select('id, dam_id, breed_date, ultrasound_date, xray_date, due_date, whelp_date, go_home_date, status')
            .in('user_id', allUserIds);

        if (littersErr) {
            console.error('Calendar litters error:', littersErr);
            return res.status(500).json({ error: 'Failed to load litters for calendar' });
        }

        const dogById = {};
        (dogs || []).forEach(d => { dogById[d.id] = d; });

        const events = [];

        // Heat due events
        (dogs || []).forEach(dog => {
            if (!dog.last_heat_date || !dog.avg_heat_cycle_days) return;
            const last = new Date(dog.last_heat_date).getTime();
            if (isNaN(last)) return;
            const cycleMs = dog.avg_heat_cycle_days * DAY_MS;
            let projected = last + cycleMs;
            let guard = 0;
            while (projected < windowStart && guard < 20) {
                projected += cycleMs;
                guard++;
            }
            while (projected <= windowEnd && guard < 40) {
                pushEvent(events, {
                    id: `heat-${dog.id}-${projected}`,
                    type: 'heat_due',
                    date: isoDate(new Date(projected)),
                    title: `${dog.name} heat window`,
                    dogName: dog.name,
                    dogId: dog.id
                });
                projected += cycleMs;
                guard++;
            }
        });

        // Vet visit due (>1 year since last)
        const oneYearAgo = now - 365 * DAY_MS;
        (dogs || []).forEach(dog => {
            if (!dog.vet_last_visit) return;
            const lastVisit = new Date(dog.vet_last_visit).getTime();
            if (isNaN(lastVisit) || lastVisit > oneYearAgo) return;
            pushEvent(events, {
                id: `vet-${dog.id}`,
                type: 'vet_due',
                date: isoDate(new Date(now)),
                title: `${dog.name} vet visit overdue`,
                dogName: dog.name,
                dogId: dog.id
            });
        });

        // Litter events
        (litters || []).forEach(litter => {
            const dam = dogById[litter.dam_id];
            const damName = dam ? dam.name : 'Litter';
            const litterId = litter.id;

            const fields = [
                { key: 'breed_date',      type: 'breed' },
                { key: 'ultrasound_date', type: 'ultrasound' },
                { key: 'xray_date',       type: 'xray' },
                { key: 'due_date',        type: 'due' },
                { key: 'whelp_date',      type: 'whelp' },
                { key: 'go_home_date',    type: 'go_home' }
            ];

            fields.forEach(({ key, type }) => {
                const raw = litter[key];
                const dateStr = isoDate(raw);
                if (!withinWindow(dateStr, windowStart, windowEnd)) return;
                pushEvent(events, {
                    id: `${type}-${litterId}`,
                    type,
                    date: dateStr,
                    title: `${damName} \u2014 ${EVENT_META[type].label}`,
                    dogName: damName,
                    dogId: litter.dam_id,
                    litterId
                });
            });
        });

        events.sort((a, b) => a.date.localeCompare(b.date));

        return res.status(200).json({
            events,
            count: events.length,
            window: {
                start: isoDate(new Date(windowStart)),
                end: isoDate(new Date(windowEnd))
            }
        });
    } catch (err) {
        console.error('GET calendar error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
