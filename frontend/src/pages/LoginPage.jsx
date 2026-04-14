import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'

export default function LoginPage() {
  const [email, setEmail]       = useState('hr@cuemath.com')
  const [password, setPassword] = useState('cuemath123')
  const [error, setError]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const { login }               = useAuth()
  const navigate                = useNavigate()
  const location                = useLocation()

  const from = location.state?.from || '/dashboard'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    setError(null)
    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-[#0a0a0f] flex items-center justify-center overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg opacity-100" />

      {/* Ambient orbs */}
      <div
        className="absolute top-1/4 -left-24 w-[500px] h-[500px] rounded-full animate-float"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.10) 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-1/4 -right-24 w-[420px] h-[420px] rounded-full animate-float-slow"
        style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.06) 0%, transparent 70%)' }}
      />

      <div className="relative z-10 w-full max-w-sm mx-auto px-6 animate-fade-up">
        {/* Badge */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-[#7c3aed]/10 border border-[#7c3aed]/25 rounded-full px-4 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] block" />
            <span className="font-inter text-[#a78bfa] text-xs font-medium tracking-widest uppercase">
              Cuemath · Recruiter Portal
            </span>
          </div>
          <h1 className="font-syne font-extrabold text-white text-4xl tracking-tight">Sign in</h1>
          <p className="font-inter text-white/30 text-sm mt-2">Access the recruiter dashboard</p>
        </div>

        {/* Render cold-start notice */}
        <div className="mb-5 inline-flex items-center gap-2 w-full bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-4 py-2.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-70">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="font-inter text-amber-400/60 text-[11px] leading-snug">
            First load may take <span className="text-amber-400/80 font-medium">1–2 min</span> while the server wakes up.
          </p>
        </div>

        {/* Demo credentials hint */}
        <div
          className="mb-5 bg-[#7c3aed]/08 border border-[#7c3aed]/20 rounded-2xl px-5 py-4 cursor-pointer hover:bg-[#7c3aed]/12 transition-colors group"
          onClick={() => { setEmail('hr@cuemath.com'); setPassword('cuemath123') }}
          title="Click to autofill"
        >
          <p className="font-inter text-[10px] text-[#a78bfa]/60 uppercase tracking-widest mb-2">Demo credentials — click to fill</p>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="font-inter text-xs text-white/50">
                <span className="text-white/25 mr-2">email</span>hr@cuemath.com
              </p>
              <p className="font-inter text-xs text-white/50">
                <span className="text-white/25 mr-2">pass</span>cuemath123
              </p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="group-hover:stroke-[#a78bfa] transition-colors">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            autoComplete="email"
            required
            className="w-full bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-white/20
              font-inter text-sm outline-none transition-all duration-300
              focus:border-[#7c3aed]/50 focus:bg-white/[0.06] focus:shadow-[0_0_0_1px_rgba(124,58,237,0.2)]"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            className="w-full bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-white/20
              font-inter text-sm outline-none transition-all duration-300
              focus:border-[#7c3aed]/50 focus:bg-white/[0.06] focus:shadow-[0_0_0_1px_rgba(124,58,237,0.2)]"
          />

          {error && (
            <p className="font-inter text-red-400/80 text-xs px-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !email.trim() || !password}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] disabled:bg-white/[0.04] disabled:cursor-not-allowed
              text-white disabled:text-white/20 font-syne font-semibold text-base py-4 rounded-2xl
              transition-all duration-300 hover:shadow-[0_0_40px_rgba(124,58,237,0.5)] hover:scale-[1.015]
              active:scale-[0.985]"
          >
            {loading ? 'Signing in…' : 'Sign in →'}
          </button>
        </form>
      </div>
    </div>
  )
}
