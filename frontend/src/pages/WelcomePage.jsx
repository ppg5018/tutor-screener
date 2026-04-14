import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function WelcomePage() {
  const [name, setName]       = useState('')
  const [started, setStarted] = useState(false)
  const navigate              = useNavigate()

  const handleStart = (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setStarted(true)
    navigate(`/interview/direct`, { state: { candidateName: trimmed } })
  }

  return (
    <div className="relative min-h-screen bg-[#0a0a0f] flex items-center justify-center overflow-hidden">
      {/* Grid background */}
      <div className="absolute inset-0 grid-bg opacity-100" />

      {/* Ambient orbs */}
      <div
        className="absolute top-1/4 -left-24 w-[500px] h-[500px] rounded-full animate-float"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.12) 0%, transparent 70%)' }}
      />
      <div
        className="absolute bottom-1/4 -right-24 w-[420px] h-[420px] rounded-full animate-float-slow"
        style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)' }}
      />
      <div
        className="absolute top-2/3 left-1/3 w-[300px] h-[300px] rounded-full animate-float-slower"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.07) 0%, transparent 70%)' }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-lg mx-auto px-6 text-center">
        {/* Badge */}
        <div className="animate-fade-in inline-flex items-center gap-2 bg-[#7c3aed]/10 border border-[#7c3aed]/25 rounded-full px-4 py-1.5 mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] block" />
          <span className="font-inter text-[#a78bfa] text-xs font-medium tracking-widest uppercase">
            Cuemath · Tutor Screening
          </span>
        </div>

        {/* Heading */}
        <h1
          className="font-syne font-extrabold text-white leading-[0.9] tracking-tight mb-6 animate-fade-up"
          style={{ fontSize: 'clamp(3.5rem, 10vw, 6rem)' }}
        >
          Are you
          <br />
          <span
            style={{
              background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 50%, #a78bfa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            ready?
          </span>
        </h1>

        <p
          className="font-inter text-white/35 text-base leading-relaxed mb-10 max-w-sm mx-auto animate-fade-up"
          style={{ animationDelay: '80ms' }}
        >
          A short AI voice interview. Speak naturally, be yourself. We're
          assessing communication, warmth, and teaching instinct.
        </p>

        {/* Name + Start */}
        <form
          onSubmit={handleStart}
          className="animate-fade-up max-w-sm mx-auto space-y-3"
          style={{ animationDelay: '160ms' }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            required
            className="w-full bg-white/[0.04] border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-white/20
              font-inter text-sm outline-none transition-all duration-300
              focus:border-[#7c3aed]/50 focus:bg-white/[0.06] focus:shadow-[0_0_0_1px_rgba(124,58,237,0.2)]"
          />
          <button
            type="submit"
            disabled={!name.trim() || started}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] disabled:bg-white/[0.04] disabled:cursor-not-allowed
              text-white disabled:text-white/20 font-syne font-semibold text-base py-4 rounded-2xl
              transition-all duration-300 hover:shadow-[0_0_40px_rgba(124,58,237,0.5)] hover:scale-[1.015]
              active:scale-[0.985] flex items-center justify-center gap-2.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {started ? 'Starting…' : 'Start Interview'}
          </button>
        </form>

        {/* Render cold-start notice */}
        <div
          className="animate-fade-in mt-8 inline-flex items-center gap-2 bg-amber-500/[0.07] border border-amber-500/20 rounded-xl px-4 py-2.5"
          style={{ animationDelay: '220ms' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-70">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="font-inter text-amber-400/60 text-[11px] leading-snug">
            First load may take <span className="text-amber-400/80 font-medium">1–2 min</span> while the server wakes up.
          </p>
        </div>

        {/* Footer */}
        <p
          className="font-inter text-white/18 text-xs mt-5 animate-fade-in"
          style={{ animationDelay: '300ms', color: 'rgba(255,255,255,0.18)' }}
        >
          5–7 questions &nbsp;·&nbsp; Voice-based &nbsp;·&nbsp; ~8 minutes
          &nbsp;&nbsp;
          <Link
            to="/login"
            className="text-white/25 hover:text-white/50 underline underline-offset-2 transition-colors"
          >
            Recruiter Login
          </Link>
        </p>
      </div>
    </div>
  )
}
