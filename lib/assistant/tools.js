// BreedIQ Assistant — tool schemas + server-side executors
// Each executor runs inside the chat route after a successful requireAuth().
// They take { user_id, supabase, input } and return { ok, result } | { ok:false, error }.

// ── Tool schemas (shape advertised to the model) ────────────
export const TOOL_SCHEMAS = [
    {
        name: 'create_dog',
        description: 'Add a dog to the breeder\'s program. Only call when the user clearly wants to add a new dog. If a dog with that name likely already exists, use update_dog instead.',
        input_schema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Primary / registered name.' },
                call_name: { type: 'string' },
                sex: { type: 'string', enum: ['female', 'male'] },
                breed: { type: 'string', description: 'Default Goldendoodle if unstated.' },
                date_of_birth: { type: 'string', description: 'YYYY-MM-DD.' },
                color: { type: 'string' },
                weight_lbs: { type: 'number' },
                role: { type: 'string', enum: ['dam', 'stud', 'prospect'] },
                is_intact: { type: 'boolean' },
                status: { type: 'string', enum: ['active', 'retired', 'guardian', 'sold', 'deceased'] },
                heat_status: { type: 'string', enum: ['none', 'in_heat', 'bred', 'pregnant', 'nursing'] },
                last_heat_date: { type: 'string', description: 'YYYY-MM-DD.' },
                embark_id: { type: 'string' },
                health_notes: { type: 'string' },
                notes: { type: 'string' }
            },
            required: ['name']
        }
    },
    {
        name: 'update_dog',
        description: 'Update fields on an existing dog. Identify by id (preferred) or name. Omit fields you do not want to change.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Dog UUID if you know it (e.g., from page_context).' },
                name_match: { type: 'string', description: 'Dog name to look up when id is unknown.' },
                name: { type: 'string' },
                call_name: { type: 'string' },
                sex: { type: 'string', enum: ['female', 'male'] },
                breed: { type: 'string' },
                date_of_birth: { type: 'string' },
                color: { type: 'string' },
                weight_lbs: { type: 'number' },
                role: { type: 'string', enum: ['dam', 'stud', 'prospect'] },
                is_intact: { type: 'boolean' },
                status: { type: 'string', enum: ['active', 'retired', 'guardian', 'sold', 'deceased'] },
                heat_status: { type: 'string', enum: ['none', 'in_heat', 'bred', 'pregnant', 'nursing'] },
                last_heat_date: { type: 'string' },
                avg_heat_cycle_days: { type: 'number' },
                embark_id: { type: 'string' },
                health_notes: { type: 'string' },
                notes: { type: 'string' }
            }
        }
    },
    {
        name: 'delete_dog',
        description: 'Permanently delete a dog. Destructive — requires confirmation. Do not call on first turn unless confirm_delete is true in context.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name_match: { type: 'string' },
                confirm_delete: { type: 'boolean', description: 'Set true only after the user has confirmed.' }
            }
        }
    },
    {
        name: 'create_litter',
        description: 'Create a litter record. Provide dam by id or name, and sire by id/name if available.',
        input_schema: {
            type: 'object',
            properties: {
                dam_id: { type: 'string' },
                dam_name: { type: 'string' },
                sire_id: { type: 'string' },
                sire_name: { type: 'string' },
                breed_date: { type: 'string' },
                due_date: { type: 'string' },
                whelp_date: { type: 'string' },
                status: { type: 'string', enum: ['planned', 'confirmed', 'born', 'available', 'placed', 'archived'] },
                puppy_count: { type: 'number' },
                males_count: { type: 'number' },
                females_count: { type: 'number' },
                ultrasound_date: { type: 'string' },
                xray_date: { type: 'string' },
                go_home_date: { type: 'string' },
                notes: { type: 'string' }
            }
        }
    },
    {
        name: 'update_litter',
        description: 'Update an existing litter — milestones, puppy counts, status. Identify by id or dam_name.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                dam_name_match: { type: 'string', description: 'Dam name to look up the litter when id is unknown. If multiple litters share the dam, identify by most recent breed_date.' },
                status: { type: 'string', enum: ['planned', 'confirmed', 'born', 'available', 'placed', 'archived'] },
                breed_date: { type: 'string' },
                due_date: { type: 'string' },
                whelp_date: { type: 'string' },
                puppy_count: { type: 'number' },
                males_count: { type: 'number' },
                females_count: { type: 'number' },
                ultrasound_date: { type: 'string' },
                xray_date: { type: 'string' },
                go_home_date: { type: 'string' },
                notes: { type: 'string' }
            }
        }
    },
    {
        name: 'delete_litter',
        description: 'Permanently delete a litter. Destructive — requires confirmation.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                dam_name_match: { type: 'string' },
                confirm_delete: { type: 'boolean' }
            }
        }
    },
    {
        name: 'create_guardian',
        description: 'Add a guardian family (home that keeps one of the breeder\'s dogs).',
        input_schema: {
            type: 'object',
            properties: {
                family_name: { type: 'string' },
                contact_name: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                address: { type: 'string' },
                city: { type: 'string' },
                state: { type: 'string' },
                zip: { type: 'string' },
                status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
                notes: { type: 'string' }
            },
            required: ['family_name']
        }
    },
    {
        name: 'update_guardian',
        description: 'Update an existing guardian family.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                family_name_match: { type: 'string' },
                family_name: { type: 'string' },
                contact_name: { type: 'string' },
                email: { type: 'string' },
                phone: { type: 'string' },
                status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
                notes: { type: 'string' }
            }
        }
    },
    {
        name: 'delete_guardian',
        description: 'Permanently delete a guardian. Destructive — requires confirmation.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                family_name_match: { type: 'string' },
                confirm_delete: { type: 'boolean' }
            }
        }
    },
    {
        name: 'link_guardian_to_dog',
        description: 'Assign an existing guardian family as the home for an existing dog.',
        input_schema: {
            type: 'object',
            properties: {
                dog_id: { type: 'string' },
                dog_name_match: { type: 'string' },
                guardian_id: { type: 'string' },
                guardian_family_match: { type: 'string' }
            }
        }
    },
    {
        name: 'log_heat',
        description: 'Record that a dam started a heat cycle on a specific date.',
        input_schema: {
            type: 'object',
            properties: {
                dog_id: { type: 'string' },
                dog_name_match: { type: 'string' },
                start_date: { type: 'string', description: 'YYYY-MM-DD when heat began.' },
                notes: { type: 'string' }
            },
            required: ['start_date']
        }
    },
    {
        name: 'create_calendar_event',
        description: 'Add a one-off event to the breeding calendar (vet visit, grooming, etc.). Prefer updating a litter milestone (due_date, ultrasound_date) when the event is part of a litter workflow.',
        input_schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                event_date: { type: 'string', description: 'YYYY-MM-DD.' },
                event_type: { type: 'string', enum: ['custom', 'vet', 'grooming', 'training', 'travel', 'other'] },
                dog_id: { type: 'string' },
                dog_name_match: { type: 'string' },
                litter_id: { type: 'string' },
                notes: { type: 'string' }
            },
            required: ['title', 'event_date']
        }
    },
    {
        name: 'search_records',
        description: 'Search dogs / litters / guardians by free-text. Use when you need to look up a record before acting.',
        input_schema: {
            type: 'object',
            properties: {
                query: { type: 'string' },
                entity_type: { type: 'string', enum: ['dog', 'litter', 'guardian', 'any'] }
            },
            required: ['query']
        }
    },
    {
        name: 'get_dog',
        description: 'Fetch a single dog\'s full record by id or exact/partial name.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                name: { type: 'string' }
            }
        }
    },
    {
        name: 'get_litter',
        description: 'Fetch a single litter\'s full record.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                dam_name: { type: 'string' }
            }
        }
    },
    {
        name: 'get_guardian',
        description: 'Fetch a single guardian\'s full record.',
        input_schema: {
            type: 'object',
            properties: {
                id: { type: 'string' },
                family_name: { type: 'string' }
            }
        }
    }
];

// List of tool names that require explicit confirm_delete before executing.
export const DESTRUCTIVE_TOOLS = new Set(['delete_dog', 'delete_litter', 'delete_guardian']);

// ── Helpers ────────────────────────────────────────────────
function ok(result) { return { ok: true, result }; }
function err(message, extra) { return { ok: false, error: message, ...(extra || {}) }; }

function cleanUpdates(obj, allowed) {
    const out = {};
    for (const k of allowed) {
        if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = obj[k];
    }
    return out;
}

async function findDogByName(supabase, userId, name) {
    if (!name) return null;
    const { data } = await supabase
        .from('dogs')
        .select('id, name, call_name, sex, status, role, heat_status')
        .eq('user_id', userId)
        .or(`name.ilike.${name},call_name.ilike.${name}`)
        .limit(5);
    if (!data || data.length === 0) return null;
    if (data.length > 1) {
        // Prefer exact case-insensitive name match
        const exact = data.find(d => d.name?.toLowerCase() === name.toLowerCase() || d.call_name?.toLowerCase() === name.toLowerCase());
        if (exact) return exact;
    }
    return data[0];
}

async function findLitter(supabase, userId, { id, damNameMatch }) {
    if (id) {
        const { data } = await supabase
            .from('litters')
            .select('*, dam:dogs!litters_dam_id_fkey(id, name)')
            .eq('user_id', userId)
            .eq('id', id)
            .maybeSingle();
        return data || null;
    }
    if (damNameMatch) {
        const dam = await findDogByName(supabase, userId, damNameMatch);
        if (!dam) return null;
        const { data } = await supabase
            .from('litters')
            .select('*, dam:dogs!litters_dam_id_fkey(id, name)')
            .eq('user_id', userId)
            .eq('dam_id', dam.id)
            .order('breed_date', { ascending: false, nullsFirst: false })
            .limit(1);
        return data?.[0] || null;
    }
    return null;
}

async function findGuardian(supabase, userId, { id, familyNameMatch }) {
    if (id) {
        const { data } = await supabase.from('guardians').select('*').eq('user_id', userId).eq('id', id).maybeSingle();
        return data || null;
    }
    if (familyNameMatch) {
        const { data } = await supabase
            .from('guardians')
            .select('*')
            .eq('user_id', userId)
            .ilike('family_name', `%${familyNameMatch}%`)
            .limit(1);
        return data?.[0] || null;
    }
    return null;
}

// ── Executors ──────────────────────────────────────────────
export async function executeTool(name, { user_id, supabase, input, confirm_delete }) {
    try {
        switch (name) {
            case 'create_dog': return await createDog({ user_id, supabase, input });
            case 'update_dog': return await updateDog({ user_id, supabase, input });
            case 'delete_dog': return await deleteDog({ user_id, supabase, input, confirm_delete });
            case 'create_litter': return await createLitter({ user_id, supabase, input });
            case 'update_litter': return await updateLitter({ user_id, supabase, input });
            case 'delete_litter': return await deleteLitter({ user_id, supabase, input, confirm_delete });
            case 'create_guardian': return await createGuardian({ user_id, supabase, input });
            case 'update_guardian': return await updateGuardian({ user_id, supabase, input });
            case 'delete_guardian': return await deleteGuardian({ user_id, supabase, input, confirm_delete });
            case 'link_guardian_to_dog': return await linkGuardianToDog({ user_id, supabase, input });
            case 'log_heat': return await logHeat({ user_id, supabase, input });
            case 'create_calendar_event': return await createCalendarEvent({ user_id, supabase, input });
            case 'search_records': return await searchRecords({ user_id, supabase, input });
            case 'get_dog': return await getDog({ user_id, supabase, input });
            case 'get_litter': return await getLitter({ user_id, supabase, input });
            case 'get_guardian': return await getGuardian({ user_id, supabase, input });
            default: return err(`Unknown tool: ${name}`);
        }
    } catch (e) {
        console.error(`[assistant] tool ${name} failed`, e);
        return err(e.message || 'Tool execution failed');
    }
}

// create_dog
async function createDog({ user_id, supabase, input }) {
    if (!input.name) return err('name is required');
    const { data, error } = await supabase.from('dogs').insert({
        user_id,
        name: input.name,
        call_name: input.call_name || null,
        breed: input.breed || 'Goldendoodle',
        sex: input.sex || null,
        color: input.color || null,
        weight_lbs: input.weight_lbs || null,
        date_of_birth: input.date_of_birth || null,
        status: input.status || 'active',
        role: input.role || null,
        is_intact: input.is_intact !== false,
        heat_status: input.heat_status || 'none',
        last_heat_date: input.last_heat_date || null,
        embark_id: input.embark_id || null,
        health_notes: input.health_notes || null,
        notes: input.notes || null,
        source: 'ai_onboarding'
    }).select('id, name, sex, breed, status').single();
    if (error) return err(error.message);
    return ok({ dog: data });
}

// update_dog
async function updateDog({ user_id, supabase, input }) {
    let dogId = input.id;
    if (!dogId && input.name_match) {
        const hit = await findDogByName(supabase, user_id, input.name_match);
        if (!hit) return err(`No dog found matching "${input.name_match}"`);
        dogId = hit.id;
    }
    if (!dogId) return err('Provide id or name_match');

    const allowed = ['name', 'call_name', 'sex', 'breed', 'date_of_birth', 'color', 'weight_lbs',
        'role', 'is_intact', 'status', 'heat_status', 'last_heat_date', 'avg_heat_cycle_days',
        'embark_id', 'health_notes', 'notes'];
    const updates = cleanUpdates(input, allowed);
    if (Object.keys(updates).length === 0) return err('No fields to update');
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('dogs')
        .update(updates)
        .eq('id', dogId)
        .eq('user_id', user_id)
        .select('id, name, sex, status, heat_status')
        .single();
    if (error) return err(error.message);
    if (!data) return err('Dog not found or not yours');
    return ok({ dog: data, fields_updated: Object.keys(updates).filter(k => k !== 'updated_at') });
}

// delete_dog
async function deleteDog({ user_id, supabase, input, confirm_delete }) {
    const confirmed = confirm_delete === true || input.confirm_delete === true;
    let dogId = input.id;
    if (!dogId && input.name_match) {
        const hit = await findDogByName(supabase, user_id, input.name_match);
        if (!hit) return err(`No dog found matching "${input.name_match}"`);
        dogId = hit.id;
    }
    if (!dogId) return err('Provide id or name_match');

    if (!confirmed) {
        // Surface as a proposal — frontend will ask user to confirm
        const { data } = await supabase.from('dogs').select('id, name, sex, status').eq('id', dogId).eq('user_id', user_id).single();
        return { ok: false, requires_confirmation: true, action: 'delete_dog', target: data };
    }
    const { error } = await supabase.from('dogs').delete().eq('id', dogId).eq('user_id', user_id);
    if (error) return err(error.message);
    return ok({ deleted: true, id: dogId });
}

// create_litter
async function createLitter({ user_id, supabase, input }) {
    let damId = input.dam_id;
    if (!damId && input.dam_name) {
        const dam = await findDogByName(supabase, user_id, input.dam_name);
        if (!dam) return err(`Dam "${input.dam_name}" not found`);
        damId = dam.id;
    }
    let sireId = input.sire_id;
    if (!sireId && input.sire_name) {
        const sire = await findDogByName(supabase, user_id, input.sire_name);
        if (sire) sireId = sire.id; // sire may be an outside stud; it's ok to leave null
    }

    let due = input.due_date;
    if (input.breed_date && !due) {
        const bd = new Date(input.breed_date);
        bd.setDate(bd.getDate() + 61);
        due = bd.toISOString().split('T')[0];
    }

    const { data, error } = await supabase.from('litters').insert({
        user_id,
        dam_id: damId || null,
        sire_id: sireId || null,
        breed_date: input.breed_date || null,
        due_date: due || null,
        whelp_date: input.whelp_date || null,
        status: input.status || (input.whelp_date ? 'born' : input.due_date || due ? 'confirmed' : 'planned'),
        puppy_count: input.puppy_count ?? null,
        males_count: input.males_count ?? null,
        females_count: input.females_count ?? null,
        ultrasound_date: input.ultrasound_date || null,
        xray_date: input.xray_date || null,
        go_home_date: input.go_home_date || null,
        notes: input.notes || null
    }).select('id, status, dam_id, sire_id, breed_date, due_date, whelp_date, puppy_count').single();
    if (error) return err(error.message);

    // Update dam heat_status if newly bred
    if (damId && input.breed_date) {
        await supabase.from('dogs').update({
            heat_status: 'bred',
            last_heat_date: input.breed_date,
            updated_at: new Date().toISOString()
        }).eq('id', damId).eq('user_id', user_id);
    }

    return ok({ litter: data });
}

// update_litter
async function updateLitter({ user_id, supabase, input }) {
    const litter = await findLitter(supabase, user_id, { id: input.id, damNameMatch: input.dam_name_match });
    if (!litter) return err('Litter not found');

    const allowed = ['status', 'breed_date', 'due_date', 'whelp_date', 'puppy_count',
        'males_count', 'females_count', 'ultrasound_date', 'xray_date', 'go_home_date', 'notes'];
    const updates = cleanUpdates(input, allowed);
    if (Object.keys(updates).length === 0) return err('No fields to update');
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('litters')
        .update(updates)
        .eq('id', litter.id)
        .eq('user_id', user_id)
        .select('id, status, breed_date, due_date, whelp_date, puppy_count')
        .single();
    if (error) return err(error.message);

    // Mirror heat_status to dam on status transitions
    if (updates.status && litter.dam_id) {
        const heatStatusMap = { confirmed: 'pregnant', born: 'nursing', placed: 'none', archived: 'none' };
        const mapped = heatStatusMap[updates.status];
        if (mapped) {
            await supabase.from('dogs').update({
                heat_status: mapped,
                updated_at: new Date().toISOString()
            }).eq('id', litter.dam_id).eq('user_id', user_id);
        }
    }

    return ok({ litter: data, fields_updated: Object.keys(updates).filter(k => k !== 'updated_at') });
}

// delete_litter
async function deleteLitter({ user_id, supabase, input, confirm_delete }) {
    const confirmed = confirm_delete === true || input.confirm_delete === true;
    const litter = await findLitter(supabase, user_id, { id: input.id, damNameMatch: input.dam_name_match });
    if (!litter) return err('Litter not found');
    if (!confirmed) {
        return { ok: false, requires_confirmation: true, action: 'delete_litter', target: { id: litter.id, dam: litter.dam?.name, status: litter.status } };
    }
    const { error } = await supabase.from('litters').delete().eq('id', litter.id).eq('user_id', user_id);
    if (error) return err(error.message);
    return ok({ deleted: true, id: litter.id });
}

// create_guardian
async function createGuardian({ user_id, supabase, input }) {
    if (!input.family_name) return err('family_name is required');
    const { data, error } = await supabase.from('guardians').insert({
        user_id,
        family_name: input.family_name,
        contact_name: input.contact_name || null,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        city: input.city || null,
        state: input.state || null,
        zip: input.zip || null,
        status: input.status || 'active',
        notes: input.notes || null
    }).select('id, family_name, contact_name, status').single();
    if (error) return err(error.message);
    return ok({ guardian: data });
}

// update_guardian
async function updateGuardian({ user_id, supabase, input }) {
    let guardian;
    if (input.id) guardian = await findGuardian(supabase, user_id, { id: input.id });
    else if (input.family_name_match) guardian = await findGuardian(supabase, user_id, { familyNameMatch: input.family_name_match });
    if (!guardian) return err('Guardian not found');

    const allowed = ['family_name', 'contact_name', 'email', 'phone', 'address', 'city', 'state', 'zip', 'status', 'notes'];
    const updates = cleanUpdates(input, allowed);
    if (Object.keys(updates).length === 0) return err('No fields to update');
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('guardians')
        .update(updates)
        .eq('id', guardian.id)
        .eq('user_id', user_id)
        .select('id, family_name, contact_name, status')
        .single();
    if (error) return err(error.message);
    return ok({ guardian: data, fields_updated: Object.keys(updates).filter(k => k !== 'updated_at') });
}

// delete_guardian
async function deleteGuardian({ user_id, supabase, input, confirm_delete }) {
    const confirmed = confirm_delete === true || input.confirm_delete === true;
    let guardian;
    if (input.id) guardian = await findGuardian(supabase, user_id, { id: input.id });
    else if (input.family_name_match) guardian = await findGuardian(supabase, user_id, { familyNameMatch: input.family_name_match });
    if (!guardian) return err('Guardian not found');
    if (!confirmed) {
        return { ok: false, requires_confirmation: true, action: 'delete_guardian', target: { id: guardian.id, family_name: guardian.family_name } };
    }
    const { error } = await supabase.from('guardians').delete().eq('id', guardian.id).eq('user_id', user_id);
    if (error) return err(error.message);
    return ok({ deleted: true, id: guardian.id });
}

// link_guardian_to_dog
async function linkGuardianToDog({ user_id, supabase, input }) {
    let dogId = input.dog_id;
    if (!dogId && input.dog_name_match) {
        const dog = await findDogByName(supabase, user_id, input.dog_name_match);
        if (!dog) return err(`Dog "${input.dog_name_match}" not found`);
        dogId = dog.id;
    }
    let guardianId = input.guardian_id;
    if (!guardianId && input.guardian_family_match) {
        const g = await findGuardian(supabase, user_id, { familyNameMatch: input.guardian_family_match });
        if (!g) return err(`Guardian "${input.guardian_family_match}" not found`);
        guardianId = g.id;
    }
    if (!dogId || !guardianId) return err('Need both a dog and a guardian to link');

    const { data, error } = await supabase
        .from('dogs')
        .update({ guardian_id: guardianId, status: 'guardian', updated_at: new Date().toISOString() })
        .eq('id', dogId)
        .eq('user_id', user_id)
        .select('id, name, guardian_id')
        .single();
    if (error) return err(error.message);
    return ok({ dog: data });
}

// log_heat
async function logHeat({ user_id, supabase, input }) {
    let dogId = input.dog_id;
    if (!dogId && input.dog_name_match) {
        const dog = await findDogByName(supabase, user_id, input.dog_name_match);
        if (!dog) return err(`Dog "${input.dog_name_match}" not found`);
        dogId = dog.id;
    }
    if (!dogId) return err('Provide dog_id or dog_name_match');
    if (!input.start_date) return err('start_date is required');

    // Compute avg_heat_cycle_days from previous last_heat_date if we have one
    const { data: existing } = await supabase
        .from('dogs')
        .select('last_heat_date, avg_heat_cycle_days, notes')
        .eq('id', dogId)
        .eq('user_id', user_id)
        .single();

    const updates = {
        heat_status: 'in_heat',
        last_heat_date: input.start_date,
        updated_at: new Date().toISOString()
    };
    if (existing?.last_heat_date) {
        const prev = new Date(existing.last_heat_date);
        const next = new Date(input.start_date);
        const diff = Math.round((next - prev) / (1000 * 60 * 60 * 24));
        if (diff > 90 && diff < 400) updates.avg_heat_cycle_days = diff;
    }
    if (input.notes) {
        const tagged = `[heat ${input.start_date}] ${input.notes}`;
        updates.notes = existing?.notes ? `${existing.notes}\n${tagged}` : tagged;
    }

    const { data, error } = await supabase
        .from('dogs')
        .update(updates)
        .eq('id', dogId)
        .eq('user_id', user_id)
        .select('id, name, heat_status, last_heat_date, avg_heat_cycle_days')
        .single();
    if (error) return err(error.message);
    return ok({ dog: data });
}

// create_calendar_event
async function createCalendarEvent({ user_id, supabase, input }) {
    if (!input.title || !input.event_date) return err('title and event_date are required');
    let dogId = input.dog_id || null;
    if (!dogId && input.dog_name_match) {
        const dog = await findDogByName(supabase, user_id, input.dog_name_match);
        if (dog) dogId = dog.id;
    }
    const { data, error } = await supabase.from('calendar_events').insert({
        user_id,
        title: input.title,
        event_date: input.event_date,
        event_type: input.event_type || 'custom',
        dog_id: dogId,
        litter_id: input.litter_id || null,
        notes: input.notes || null,
        source: 'ai_assistant'
    }).select('id, title, event_date, event_type, dog_id, litter_id').single();
    if (error) return err(error.message);
    return ok({ event: data });
}

// search_records
async function searchRecords({ user_id, supabase, input }) {
    const q = (input.query || '').trim();
    if (!q) return err('query is required');
    const type = input.entity_type || 'any';
    const pattern = `%${q}%`;
    const results = { dogs: [], litters: [], guardians: [] };

    if (type === 'dog' || type === 'any') {
        const { data } = await supabase
            .from('dogs')
            .select('id, name, call_name, sex, status, role, heat_status, breed')
            .eq('user_id', user_id)
            .or(`name.ilike.${pattern},call_name.ilike.${pattern},notes.ilike.${pattern}`)
            .limit(10);
        results.dogs = data || [];
    }
    if (type === 'guardian' || type === 'any') {
        const { data } = await supabase
            .from('guardians')
            .select('id, family_name, contact_name, email, status')
            .eq('user_id', user_id)
            .or(`family_name.ilike.${pattern},contact_name.ilike.${pattern},notes.ilike.${pattern}`)
            .limit(10);
        results.guardians = data || [];
    }
    if (type === 'litter' || type === 'any') {
        // Litters don't have names — search by dam name or notes
        const { data: damHits } = await supabase
            .from('dogs')
            .select('id')
            .eq('user_id', user_id)
            .ilike('name', pattern)
            .limit(5);
        const damIds = (damHits || []).map(d => d.id);
        let litterQuery = supabase
            .from('litters')
            .select('id, status, breed_date, whelp_date, puppy_count, dam:dogs!litters_dam_id_fkey(id, name), sire:dogs!litters_sire_id_fkey(id, name)')
            .eq('user_id', user_id)
            .limit(10);
        if (damIds.length > 0) {
            litterQuery = litterQuery.or(`dam_id.in.(${damIds.join(',')}),notes.ilike.${pattern}`);
        } else {
            litterQuery = litterQuery.ilike('notes', pattern);
        }
        const { data } = await litterQuery;
        results.litters = data || [];
    }

    return ok({ query: q, ...results,
        summary: `Found ${results.dogs.length} dog(s), ${results.litters.length} litter(s), ${results.guardians.length} guardian(s).` });
}

// get_dog
async function getDog({ user_id, supabase, input }) {
    if (input.id) {
        const { data, error } = await supabase.from('dogs').select('*').eq('id', input.id).eq('user_id', user_id).maybeSingle();
        if (error) return err(error.message);
        if (!data) return err('Dog not found');
        return ok({ dog: data });
    }
    if (input.name) {
        const dog = await findDogByName(supabase, user_id, input.name);
        if (!dog) return err(`No dog matching "${input.name}"`);
        const { data } = await supabase.from('dogs').select('*').eq('id', dog.id).eq('user_id', user_id).single();
        return ok({ dog: data });
    }
    return err('Provide id or name');
}

// get_litter
async function getLitter({ user_id, supabase, input }) {
    const litter = await findLitter(supabase, user_id, { id: input.id, damNameMatch: input.dam_name });
    if (!litter) return err('Litter not found');
    return ok({ litter });
}

// get_guardian
async function getGuardian({ user_id, supabase, input }) {
    const guardian = await findGuardian(supabase, user_id, { id: input.id, familyNameMatch: input.family_name });
    if (!guardian) return err('Guardian not found');
    return ok({ guardian });
}
