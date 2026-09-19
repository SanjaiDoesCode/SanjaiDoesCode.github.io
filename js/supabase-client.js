// ===========================================================
// Supabase wrapper: auth + workout_sessions persistence.
// Falls back gracefully (guest mode) if config.js hasn't
// been filled in with a real project yet.
// ===========================================================
const FormFitDB = (() => {
  let client = null;
  let configured = false;

  try {
    if (
      window.supabase &&
      FORMFIT_CONFIG.SUPABASE_URL &&
      !FORMFIT_CONFIG.SUPABASE_URL.includes("YOUR-PROJECT")
    ) {
      client = window.supabase.createClient(
        FORMFIT_CONFIG.SUPABASE_URL,
        FORMFIT_CONFIG.SUPABASE_ANON_KEY
      );
      configured = true;
    }
  } catch (e) {
    console.warn("Supabase not configured:", e);
  }

  function isConfigured() {
    return configured;
  }

  async function getSession() {
    if (!configured) return null;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  async function signUp(email, password) {
    if (!configured) throw new Error("Backend not configured yet.");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!configured) throw new Error("Backend not configured yet.");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (!configured) return;
    await client.auth.signOut();
  }

  function onAuthChange(cb) {
    if (!configured) return;
    client.auth.onAuthStateChange((_event, session) => cb(session));
  }

  async function saveSession({ exercise, reps, durationSeconds, avgFormScore }) {
    if (!configured) return { savedLocally: true };
    const session = await getSession();
    if (!session) throw new Error("Not signed in.");
    const { error } = await client.from("workout_sessions").insert({
      user_id: session.user.id,
      exercise,
      reps,
      duration_seconds: durationSeconds,
      avg_form_score: avgFormScore,
    });
    if (error) throw error;
    return { savedLocally: false };
  }

  async function getHistory(limit = 20) {
    if (!configured) return [];
    const session = await getSession();
    if (!session) return [];
    const { data, error } = await client
      .from("workout_sessions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  return {
    isConfigured,
    getSession,
    signUp,
    signIn,
    signOut,
    onAuthChange,
    saveSession,
    getHistory,
  };
})();
