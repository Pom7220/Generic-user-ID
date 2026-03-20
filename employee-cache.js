// ============================================================
// EMPLOYEE PROFILE CACHE
// PDPA/GDPR compliant: Fetches PII from SuccessFactors via 
// Edge Function at runtime. Caches in memory only.
// Never written to localStorage, sessionStorage, or database.
// Cache cleared automatically on page unload / session end.
// ============================================================

const EMP_CACHE = {
  _store: {},          // in-memory only
  _pending: {},        // pending promises to avoid duplicate fetches
  _sb: null,
  _session: null,
  _supabaseUrl: null,

  init(sb, supabaseUrl) {
    this._sb = sb;
    this._supabaseUrl = supabaseUrl;
    // Clear cache on page unload
    window.addEventListener('beforeunload', () => this.clear());
  },

  clear() {
    this._store = {};
    this._pending = {};
  },

  // Get employee profile — returns cached or fetches from SF
  async get(empCode) {
    if (!empCode) return null;
    if (this._store[empCode]) return this._store[empCode];

    // Avoid duplicate concurrent fetches for same empCode
    if (this._pending[empCode]) return this._pending[empCode];

    this._pending[empCode] = this._fetchOne(empCode);
    const result = await this._pending[empCode];
    delete this._pending[empCode];
    return result;
  },

  // Batch get — efficient for loading a full table at once
  async getBatch(empCodes) {
    const unique = [...new Set(empCodes.filter(Boolean))];
    const missing = unique.filter(c => !this._store[c]);

    if (missing.length > 0) {
      await this._fetchBatch(missing);
    }

    const result = {};
    unique.forEach(c => { result[c] = this._store[c] || null; });
    return result;
  },

  async _getSession() {
    if (this._session) return this._session;
    const { data: { session } } = await this._sb.auth.getSession();
    this._session = session;
    return session;
  },

  async _fetchOne(empCode) {
    try {
      const session = await this._getSession();
      if (!session) return this._fallback(empCode);

      const res = await fetch(`${this._supabaseUrl}/functions/v1/get-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ 
          emp_code: empCode,
          access_token: session.access_token
        })
      });

      if (!res.ok) return this._fallback(empCode);
      const data = await res.json();
      if (data.success && data.employee) {
        this._store[empCode] = data.employee;
        return data.employee;
      }
      return this._fallback(empCode);
    } catch (err) {
      console.warn('EMP_CACHE fetch error:', empCode, err);
      return this._fallback(empCode);
    }
  },

  async _fetchBatch(empCodes) {
    try {
      const session = await this._getSession();
      if (!session) {
        empCodes.forEach(c => { this._store[c] = this._fallback(c); });
        return;
      }

      const res = await fetch(`${this._supabaseUrl}/functions/v1/get-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          emp_codes: empCodes,
          access_token: session.access_token
        })
      });

      if (!res.ok) {
        empCodes.forEach(c => { this._store[c] = this._fallback(c); });
        return;
      }

      const data = await res.json();
      if (data.success && data.employees) {
        Object.assign(this._store, data.employees);
      }
      // Ensure all requested codes have at least a fallback
      empCodes.forEach(c => {
        if (!this._store[c]) this._store[c] = this._fallback(c);
      });
    } catch (err) {
      console.warn('EMP_CACHE batch error:', err);
      empCodes.forEach(c => { this._store[c] = this._fallback(c); });
    }
  },

  _fallback(empCode) {
    // Return minimal display data when SF is unavailable
    return {
      emp_code: empCode,
      full_name: empCode,
      first_name: empCode,
      initials: empCode.replace('EMP-', '').slice(0, 2),
      mobile: null,
      email: null,
      photo_url: null,
      title: null,
      source: 'fallback'
    };
  },

  // Helper: get initials for avatar display
  getInitials(empCode) {
    const emp = this._store[empCode];
    if (!emp || !emp.full_name) return empCode.slice(-2);
    return emp.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  },

  // Helper: get display name (from cache or empCode as fallback)
  getName(empCode) {
    return this._store[empCode]?.full_name || empCode;
  },

  // Helper: get mobile
  getMobile(empCode) {
    return this._store[empCode]?.mobile || null;
  }
};
