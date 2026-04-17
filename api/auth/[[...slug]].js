// BreedIQ Auth API — Combined catch-all handler
// Handles /api/auth/login, /api/auth/logout, /api/auth/me, /api/auth/signup
import { getAnonClient, getServiceClient, requireAuth } from '../../lib/supabase.js';

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

// Fields users are allowed to update via PUT /api/auth/me
const ALLOWED_PROFILE_FIELDS = ['full_name', 'kennel_name', 'phone', 'timezone', 'onboarding_completed'];

// ═══════════════════════════════════════════════════════════
// LOGIN — POST /api/auth/login
// ═══════════════════════════════════════════════════════════
async function handleLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  try {
    const supabase = getAnonClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login')) {
        return res.status(401).json({ error: 'Incorrect email or password. Please try again.' });
      }
      return res.status(401).json({ error: error.message });
    }

    const { user, session } = data;
    const serviceClient = getServiceClient();
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('plan, kennel_name, full_name, onboarding_completed')
      .eq('id', user.id)
      .single();

    const maxAge = 60 * 60 * 24 * 30;
    res.setHeader('Set-Cookie', [
      `breediq_access_token=${session.access_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`,
      `breediq_refresh_token=${session.refresh_token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
    ]);

    return res.status(200).json({
      success: true,
      user: {
        id: user.id, email: user.email,
        name: profile?.full_name || user.user_metadata?.full_name || '',
        plan: profile?.plan || 'starter',
        kennel_name: profile?.kennel_name || '',
        onboarding_completed: profile?.onboarding_completed || false
      },
      access_token: session.access_token
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// LOGOUT — POST /api/auth/logout
// ═══════════════════════════════════════════════════════════
async function handleLogout(req, res) {
  res.setHeader('Set-Cookie', 'breediq_token=; Path=/; HttpOnly; Max-Age=0; Secure');
  return res.status(200).json({ success: true });
}

// ═══════════════════════════════════════════════════════════
// ME — GET/PUT /api/auth/me
// ═══════════════════════════════════════════════════════════
async function handleMe(req, res) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res);
  if (!auth) return;

  try {
    const supabase = getServiceClient();

    // --- PUT: Update profile ---
    if (req.method === 'PUT') {
      const updates = {};
      for (const field of ALLOWED_PROFILE_FIELDS) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update. Allowed: ' + ALLOWED_PROFILE_FIELDS.join(', ') });
      }
      updates.updated_at = new Date().toISOString();

      const { data: profile, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', auth.user.id)
        .select('*')
        .single();

      if (error) {
        console.error('Profile update error:', error);
        return res.status(400).json({ error: error.message });
      }

      return res.status(200).json({
        success: true,
        user: {
          id: profile.id, email: profile.email, name: profile.full_name,
          kennel_name: profile.kennel_name, phone: profile.phone,
          timezone: profile.timezone, plan: profile.plan,
          onboarding_completed: profile.onboarding_completed,
          updated_at: profile.updated_at
        }
      });
    }

    // --- GET: Return profile + stats ---
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', auth.user.id)
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { count: dogCount } = await supabase
      .from('dogs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id);

    const { count: litterCount } = await supabase
      .from('litters')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .in('status', ['confirmed', 'born', 'available']);

    const { count: guardianCount } = await supabase
      .from('guardians')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.user.id)
      .eq('status', 'active');

    return res.status(200).json({
      user: {
        id: profile.id, email: profile.email, name: profile.full_name,
        kennel_name: profile.kennel_name, phone: profile.phone,
        timezone: profile.timezone, plan: profile.plan,
        onboarding_completed: profile.onboarding_completed,
        created_at: profile.created_at
      },
      stats: {
        dogs: dogCount || 0,
        active_litters: litterCount || 0,
        guardians: guardianCount || 0
      }
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════
// SIGNUP — POST /api/auth/signup
// ═══════════════════════════════════════════════════════════
async function handleSignup(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  try {
    const supabase = getServiceClient();

    // 1. Create user in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: name || '' }
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
      }
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    // 2. Create Stripe customer (for future billing)
    if (STRIPE_KEY) {
      try {
        const stripeResp = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${STRIPE_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            email, name: name || '',
            'metadata[supabase_user_id]': userId,
            'metadata[plan]': 'starter'
          }).toString()
        });
        const customer = await stripeResp.json();
        if (customer.id) {
          await supabase.from('profiles').update({
            stripe_customer_id: customer.id,
            full_name: name || ''
          }).eq('id', userId);
        }
      } catch (stripeErr) {
        console.error('Stripe customer creation failed:', stripeErr.message);
      }
    }

    // 3. Sign in to get session tokens
    const anonSupabase = getAnonClient();
    const { data: session, error: sessionError } = await anonSupabase.auth.signInWithPassword({
      email, password
    });

    if (sessionError) {
      return res.status(200).json({
        success: true, message: 'Account created. Please sign in.',
        user: { id: userId, email, name: name || '', plan: 'starter' }
      });
    }

    // 4. Set auth cookies
    const accessToken = session.session.access_token;
    const refreshToken = session.session.refresh_token;
    const maxAge = 60 * 60 * 24 * 30;
    res.setHeader('Set-Cookie', [
      `breediq_access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`,
      `breediq_refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
    ]);

    return res.status(200).json({
      success: true,
      user: { id: userId, email, name: name || '', plan: 'starter' },
      access_token: accessToken
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Internal server error', message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER — Route by slug
// ═══════════════════════════════════════════════════════════
export default async function handler(req, res) {
  const slug = req.query.slug;
  const route = slug && slug.length > 0 ? slug[0] : null;

  switch (route) {
    case 'login':  return handleLogin(req, res);
    case 'logout': return handleLogout(req, res);
    case 'me':     return handleMe(req, res);
    case 'signup': return handleSignup(req, res);
    default:
      return res.status(404).json({ error: 'Auth route not found' });
  }
}
