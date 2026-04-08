// BreedIQ Breeding IQ Score API
// GET: Calculate current score from live data
// POST: Save a score snapshot
import { requireAuth, getServiceClient } from '../../lib/supabase.js';

// ── Scoring Definitions ─────────────────────────────────────
// Three pillars totaling exactly 160 points (54 + 53 + 53)
// Raw points earned = Breeding IQ Score (no conversion)
const PILLAR_DEFINITIONS = {
    health_genetics: {
        name: 'Health & Genetics',
        maxPoints: 54,
        items: [
            { key: 'embark_testing', label: 'Embark DNA testing completed for all breeding dogs', points: 10 },
            { key: 'ofa_clearances', label: 'OFA health clearances on file', points: 10 },
            { key: 'coi_tracking', label: 'Genetic diversity score tracked (COI analysis)', points: 8 },
            { key: 'vet_current', label: 'Veterinary records current (within 12 months)', points: 8 },
            { key: 'no_hereditary', label: 'No known hereditary conditions in active pairings', points: 10 },
            { key: 'breeding_age', label: 'Breeding age guidelines followed (OFA minimums met)', points: 8 },
        ]
    },
    program_management: {
        name: 'Program Management',
        maxPoints: 53,
        items: [
            { key: 'heat_tracking', label: 'Active heat cycle tracking for all intact females', points: 10 },
            { key: 'gestation_milestones', label: 'Gestation milestones monitored (ultrasound, whelp dates)', points: 9 },
            { key: 'calendar_synced', label: 'Google Calendar synced with breeding events', points: 8 },
            { key: 'guardian_checkins', label: 'Guardian family check-ins up to date', points: 9 },
            { key: 'complete_profiles', label: 'Complete dog profiles (photos, weights, pedigrees)', points: 8 },
            { key: 'litter_records', label: 'Litter records complete with puppy data', points: 9 },
        ]
    },
    buyer_experience: {
        name: 'Buyer Experience',
        maxPoints: 53,
        items: [
            { key: 'waitlist_managed', label: 'Waitlist organized and actively managed', points: 9 },
            { key: 'buyer_response_time', label: 'Buyer communication tracked (response < 24hrs)', points: 8 },
            { key: 'puppy_contracts', label: 'Puppy contracts / purchase agreements in place', points: 8 },
            { key: 'gohome_scheduled', label: 'Go-home dates scheduled with prep checklist', points: 8 },
            { key: 'health_warranty', label: 'Certified health warranty on file', points: 12 },
            { key: 'post_placement', label: 'Post-placement follow-up system active', points: 8 },
        ]
    }
};

const TIERS = [
    { min: 0, max: 69, label: 'Needs Work' },
    { min: 70, max: 84, label: 'Below Average' },
    { min: 85, max: 99, label: 'Average' },
    { min: 100, max: 114, label: 'Above Average' },
    { min: 115, max: 129, label: 'Superior' },
    { min: 130, max: 160, label: 'Exceptional' },
];

function getTier(score) {
    return TIERS.find(t => score >= t.min && score <= t.max) || TIERS[0];
}

// ── Auto-evaluate items from live data ──────────────────────
async function evaluateFromData(supabase, userId) {
    // Fetch all relevant data
    const [dogsResult, littersResult, guardiansResult] = await Promise.all([
        supabase.from('dogs').select('*').eq('user_id', userId),
        supabase.from('litters').select('*').eq('user_id', userId),
        supabase.from('guardians').select('*').eq('user_id', userId).eq('status', 'active'),
    ]);

    const dogs = dogsResult.data || [];
    const litters = littersResult.data || [];
    const guardians = guardiansResult.data || [];

    const breedingDogs = dogs.filter(d => d.status === 'active' && d.role && ['dam', 'stud'].includes(d.role));
    const intactFemales = dogs.filter(d => d.sex === 'female' && d.is_intact && d.status === 'active');
    const activeLitters = litters.filter(l => ['confirmed', 'born', 'available'].includes(l.status));

    const completedItems = {};
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

    // ── Health & Genetics ───────────────────────────────────
    // Embark testing: all breeding dogs have embark_id
    completedItems.embark_testing = breedingDogs.length > 0 &&
        breedingDogs.every(d => d.embark_id);

    // OFA clearances: all breeding dogs have ofa_clearances with at least one entry
    completedItems.ofa_clearances = breedingDogs.length > 0 &&
        breedingDogs.every(d => d.ofa_clearances && Object.keys(d.ofa_clearances).length > 0);

    // COI tracking: any breeding dog has coi_percentage set
    completedItems.coi_tracking = breedingDogs.some(d => d.coi_percentage != null);

    // Vet records current: all active dogs visited vet within 12 months
    completedItems.vet_current = dogs.filter(d => d.status === 'active').length > 0 &&
        dogs.filter(d => d.status === 'active').every(d =>
            d.vet_last_visit && new Date(d.vet_last_visit) >= twelveMonthsAgo
        );

    // No hereditary conditions: check health_notes for red flags (simple heuristic)
    completedItems.no_hereditary = breedingDogs.length > 0 &&
        !breedingDogs.some(d =>
            d.health_notes && /hereditary|genetic condition|carrier/i.test(d.health_notes)
        );

    // Breeding age: all breeding dogs have date_of_birth and are >= 2 years old
    completedItems.breeding_age = breedingDogs.length > 0 &&
        breedingDogs.every(d => {
            if (!d.date_of_birth) return false;
            const age = (now - new Date(d.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000);
            return age >= 2;
        });

    // ── Program Management ──────────────────────────────────
    // Heat tracking: all intact females have last_heat_date set
    completedItems.heat_tracking = intactFemales.length > 0 &&
        intactFemales.every(d => d.last_heat_date);

    // Gestation milestones: active litters have ultrasound_date or whelp_date
    completedItems.gestation_milestones = activeLitters.length === 0 ||
        activeLitters.every(l => l.ultrasound_date || l.whelp_date);

    // Calendar synced: manual override (stored in profile or check later)
    // Default to false — user confirms manually
    completedItems.calendar_synced = false;

    // Guardian check-ins: all active guardians have check-in within their frequency
    completedItems.guardian_checkins = guardians.length === 0 ||
        guardians.every(g => {
            if (!g.last_checkin) return false;
            const daysSince = (now - new Date(g.last_checkin)) / (24 * 60 * 60 * 1000);
            return daysSince <= (g.checkin_frequency_days || 30);
        });

    // Complete profiles: all active dogs have photo_url and weight_lbs
    completedItems.complete_profiles = dogs.filter(d => d.status === 'active').length > 0 &&
        dogs.filter(d => d.status === 'active').every(d => d.photo_url && d.weight_lbs);

    // Litter records: all non-planned litters have puppy_count
    const pastLitters = litters.filter(l => ['born', 'available', 'placed', 'archived'].includes(l.status));
    completedItems.litter_records = pastLitters.length === 0 ||
        pastLitters.every(l => l.puppy_count != null);

    // ── Buyer Experience ────────────────────────────────────
    // These are more manual — store overrides in breeding_iq_scores.manual_overrides
    completedItems.waitlist_managed = false;
    completedItems.buyer_response_time = false;
    completedItems.puppy_contracts = false;
    completedItems.gohome_scheduled = false;
    completedItems.health_warranty = false;
    completedItems.post_placement = false;

    return completedItems;
}

function calculateScore(completedItems) {
    let totalScore = 0;
    const pillarScores = {};

    for (const [pillarKey, pillar] of Object.entries(PILLAR_DEFINITIONS)) {
        let pillarEarned = 0;
        const itemResults = [];

        for (const item of pillar.items) {
            const completed = completedItems[item.key] || false;
            const earned = completed ? item.points : 0;
            pillarEarned += earned;
            itemResults.push({
                key: item.key,
                label: item.label,
                points: item.points,
                earned,
                completed
            });
        }

        totalScore += pillarEarned;
        pillarScores[pillarKey] = {
            name: pillar.name,
            maxPoints: pillar.maxPoints,
            earned: pillarEarned,
            percentage: Math.round((pillarEarned / pillar.maxPoints) * 100),
            items: itemResults
        };
    }

    return { totalScore, pillarScores };
}

export default async function handler(req, res) {
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const supabase = getServiceClient();
    const userId = auth.user.id;

    // ── GET: Calculate current score ────────────────────────
    if (req.method === 'GET') {
        try {
            // Auto-evaluate from database
            const autoCompleted = await evaluateFromData(supabase, userId);

            // Get any manual overrides from most recent snapshot
            const { data: latestSnapshot } = await supabase
                .from('breeding_iq_scores')
                .select('manual_overrides')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            const manualOverrides = latestSnapshot?.manual_overrides || {};

            // Merge: manual overrides take precedence
            const completedItems = { ...autoCompleted, ...manualOverrides };

            const { totalScore, pillarScores } = calculateScore(completedItems);
            const tier = getTier(totalScore);

            return res.status(200).json({
                score: totalScore,
                maxScore: 160,
                tier: tier.label,
                pillars: pillarScores,
                completedItems,
                autoEvaluated: autoCompleted,
                manualOverrides,
                definitions: PILLAR_DEFINITIONS
            });
        } catch (err) {
            console.error('GET breeding IQ error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    // ── POST: Save snapshot + manual overrides ──────────────
    if (req.method === 'POST') {
        try {
            const { manual_overrides } = req.body;

            // Recalculate with any overrides
            const autoCompleted = await evaluateFromData(supabase, userId);
            const completedItems = { ...autoCompleted, ...(manual_overrides || {}) };
            const { totalScore, pillarScores } = calculateScore(completedItems);
            const tier = getTier(totalScore);

            // Save snapshot
            const { data: snapshot, error } = await supabase
                .from('breeding_iq_scores')
                .insert({
                    user_id: userId,
                    total_score: totalScore,
                    health_genetics_score: pillarScores.health_genetics.earned,
                    program_management_score: pillarScores.program_management.earned,
                    buyer_experience_score: pillarScores.buyer_experience.earned,
                    breakdown: pillarScores,
                    manual_overrides: manual_overrides || {},
                    tier: tier.label
                })
                .select()
                .single();

            if (error) {
                console.error('Save IQ snapshot error:', error);
                return res.status(500).json({ error: 'Failed to save score', details: error.message });
            }

            return res.status(201).json({
                success: true,
                score: totalScore,
                tier: tier.label,
                pillars: pillarScores,
                snapshot_id: snapshot.id
            });
        } catch (err) {
            console.error('POST breeding IQ error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
