import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { resendReport } from '../api.js'

/* ─── Score bar with animated fill ─────────────────────────────────── */
function ScoreBar({ label, value, delay = 0, variant = 'default', note }) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setWidth(value * 10), delay)
    return () => clearTimeout(t)
  }, [value, delay])

  const gradient = variant === 'confidence'
    ? (value >= 8 ? 'from-[#60a5fa] to-[#2563eb]'
      : value >= 6 ? 'from-[#3b82f6] to-[#1d4ed8]'
      : value >= 4 ? 'from-[#1d4ed8] to-[#1e40af]'
      : 'from-red-700 to-red-600')
    : (value >= 8 ? 'from-[#a78bfa] to-[#7c3aed]'
      : value >= 6 ? 'from-[#7c3aed] to-[#6d28d9]'
      : value >= 4 ? 'from-[#6d28d9] to-[#5b21b6]'
      : 'from-red-700 to-red-600')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={`font-inter text-sm ${variant === 'confidence' ? 'text-blue-300/70' : 'text-white/55'}`}>{label}</span>
        <span className="font-syne font-semibold text-white text-sm">
          {value}
          <span className="font-inter font-normal text-white/30 text-xs">/10</span>
        </span>
      </div>
      <div className="h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className={`h-full bg-gradient-to-r ${gradient} rounded-full transition-all duration-[1100ms] ease-out`}
          style={{ width: `${width}%` }}
        />
      </div>
      {note && (
        <p className="font-inter text-[11px] text-blue-300/50 italic leading-relaxed">{note}</p>
      )}
    </div>
  )
}

/* ─── Config ────────────────────────────────────────────────────────── */
const SCORES_ORDER = ['clarity', 'warmth', 'simplicity', 'fluency', 'confidence']
const SCORE_LABELS  = { clarity: 'Clarity', warmth: 'Warmth', simplicity: 'Simplicity', fluency: 'Fluency', confidence: 'Confidence' }

const REC_STYLE = {
  Pass:   { text: 'text-emerald-400', bg: 'bg-emerald-400/[0.08]', border: 'border-emerald-400/25', glow: '0 0 40px rgba(52,211,153,0.18)' },
  Review: { text: 'text-amber-400',   bg: 'bg-amber-400/[0.08]',   border: 'border-amber-400/25',   glow: '0 0 40px rgba(251,191,36,0.18)' },
  Reject: { text: 'text-red-400',     bg: 'bg-red-400/[0.08]',     border: 'border-red-400/25',     glow: '0 0 40px rgba(248,113,113,0.18)' },
}

/* ─── Page ──────────────────────────────────────────────────────────── */
export default function ReportPage() {
  const navigate      = useNavigate()
  const candidateName = sessionStorage.getItem('candidateName') || 'Candidate'
  const candidateId   = sessionStorage.getItem('candidateId')
  const raw           = sessionStorage.getItem('assessment')
  const rawFillers    = sessionStorage.getItem('fillerWords')
  const assessment    = raw ? JSON.parse(raw) : null
  const fillerWords   = rawFillers ? JSON.parse(rawFillers) : {}

  const [resendStatus, setResendStatus] = useState(null) // null | 'sending' | 'sent' | 'error'

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const handleReset = () => {
    sessionStorage.clear()
    navigate('/')
  }

  const handleResend = async () => {
    if (!candidateId || resendStatus === 'sending') return
    setResendStatus('sending')
    try {
      await resendReport(Number(candidateId))
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
  }

  if (!assessment) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="font-inter text-white/35">No assessment data found.</p>
          <button onClick={handleReset} className="font-inter text-[#a78bfa] text-sm hover:text-white transition-colors">
            ← Start over
          </button>
        </div>
      </div>
    )
  }

  const rec            = assessment.recommendation || 'Review'
  const style          = REC_STYLE[rec] ?? REC_STYLE.Review
  const fillerEntries  = Object.entries(fillerWords).sort((a, b) => b[1] - a[1])
  const totalFillers   = fillerEntries.reduce((s, [, v]) => s + v, 0)
  const followUpCount  = assessment.follow_up_count ?? 0
  const confidenceNotes = assessment.confidence_notes || null

  return (
    <div className="min-h-screen bg-[#0a0a0f] py-12 px-4">
      <div className="max-w-xl mx-auto animate-fade-up">

        {/* ── Top badge ──────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-4 mb-5">
            <div className="inline-flex items-center gap-2 bg-[#7c3aed]/10 border border-[#7c3aed]/20 rounded-full px-4 py-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] block" />
              <span className="font-inter text-[#a78bfa] text-xs tracking-widest uppercase">Interview Complete</span>
            </div>
            <Link
              to="/dashboard"
              className="font-inter text-white/25 text-xs hover:text-white/55 transition-colors"
            >
              Dashboard →
            </Link>
          </div>
          <h1 className="font-syne font-bold text-4xl text-white mb-1.5">{candidateName}</h1>
          <p className="font-inter text-white/25 text-sm">{today}</p>
        </div>

        {/* ── Recommendation ─────────────────────────────────────── */}
        <div
          className={`${style.bg} ${style.border} border rounded-2xl p-7 mb-5 text-center`}
          style={{ boxShadow: style.glow }}
        >
          <p className="font-inter text-white/35 text-[10px] uppercase tracking-[0.18em] mb-2">Recommendation</p>
          <p className={`font-syne font-extrabold text-6xl ${style.text} leading-none`}>{rec}</p>
        </div>

        {/* ── Scores ─────────────────────────────────────────────── */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 mb-5 space-y-5">
          <h2 className="font-syne font-semibold text-white/50 text-[10px] uppercase tracking-[0.18em]">
            Performance Scores
          </h2>
          {SCORES_ORDER.map((key, i) => (
            <ScoreBar
              key={key}
              label={SCORE_LABELS[key]}
              value={assessment.scores?.[key] ?? 0}
              delay={200 + i * 120}
              variant={key === 'confidence' ? 'confidence' : 'default'}
              note={key === 'confidence' ? confidenceNotes : undefined}
            />
          ))}
          {followUpCount > 0 && (
            <div className="pt-2 border-t border-white/[0.05] flex items-center justify-between">
              <span className="font-inter text-[11px] text-white/30">Follow-up questions needed</span>
              <span className="font-syne font-semibold text-amber-400/80 text-sm">{followUpCount}</span>
            </div>
          )}
        </div>

        {/* ── Filler words ───────────────────────────────────────── */}
        {fillerEntries.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 mb-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-syne font-semibold text-white/50 text-[10px] uppercase tracking-[0.18em]">
                Filler Words
              </h2>
              <span className="font-inter text-white/25 text-[11px]">{totalFillers} total</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {fillerEntries.map(([word, count]) => (
                <div
                  key={word}
                  className="flex items-center gap-1.5 bg-[#7c3aed]/10 border border-[#7c3aed]/20 rounded-full px-3 py-1"
                >
                  <span className="font-inter text-white/50 text-xs">{word}</span>
                  <span className="font-syne font-semibold text-[#a78bfa] text-xs">{count}×</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Summary ────────────────────────────────────────────── */}
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 mb-5">
          <h2 className="font-syne font-semibold text-white/50 text-[10px] uppercase tracking-[0.18em] mb-4">
            Summary
          </h2>
          <p className="font-inter text-white/55 text-sm leading-relaxed">{assessment.summary}</p>
        </div>

        {/* ── Key quotes ─────────────────────────────────────────── */}
        {assessment.key_quotes?.length > 0 && (
          <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 mb-8">
            <h2 className="font-syne font-semibold text-white/50 text-[10px] uppercase tracking-[0.18em] mb-5">
              Key Quotes
            </h2>
            <div className="space-y-4">
              {assessment.key_quotes.map((q, i) => (
                <div
                  key={i}
                  className="relative pl-5 py-1 animate-fade-in"
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  <span
                    className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full bg-gradient-to-b from-[#7c3aed]/60 to-[#7c3aed]/10"
                  />
                  <p className="font-inter text-white/45 text-sm italic leading-relaxed">"{q}"</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CTA ────────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleReset}
            className="px-8 py-3 bg-[#7c3aed] hover:bg-[#6d28d9] text-white font-syne font-semibold text-sm rounded-xl
              transition-all duration-300 hover:shadow-[0_0_40px_rgba(124,58,237,0.5)] hover:scale-[1.02] active:scale-[0.98]"
          >
            Start New Interview
          </button>

          {candidateId && (
            <button
              onClick={handleResend}
              disabled={resendStatus === 'sending' || resendStatus === 'sent'}
              className={`px-6 py-2 border rounded-xl font-inter text-xs transition-all duration-300
                ${resendStatus === 'sent'
                  ? 'border-emerald-500/30 text-emerald-400/60 cursor-default'
                  : resendStatus === 'error'
                    ? 'border-red-500/30 text-red-400/60 cursor-default'
                    : resendStatus === 'sending'
                      ? 'border-white/[0.08] text-white/20 cursor-not-allowed'
                      : 'border-white/[0.10] text-white/30 hover:border-white/20 hover:text-white/55 cursor-pointer'
                }`}
            >
              {resendStatus === 'sent'   ? '✓ Report sent'
               : resendStatus === 'error'   ? 'Send failed — try again'
               : resendStatus === 'sending' ? 'Sending…'
               : 'Resend Email Report'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
