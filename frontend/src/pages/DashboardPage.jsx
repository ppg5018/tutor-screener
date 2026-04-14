import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCandidates, listInvites, createInvite, listHR, createHR, deleteHR, deleteCandidate } from '../api.js'
import { useAuth } from '../AuthContext.jsx'

/* ─── Config ──────────────────────────────────────────────────────── */
const REC_STYLE = {
  Pass:   { text: 'text-emerald-400', bg: 'bg-emerald-400/10',  border: 'border-emerald-400/20' },
  Review: { text: 'text-amber-400',   bg: 'bg-amber-400/10',    border: 'border-amber-400/20' },
  Reject: { text: 'text-red-400',     bg: 'bg-red-400/10',      border: 'border-red-400/20' },
}

const INVITE_STATUS_STYLE = {
  pending:   { text: 'text-blue-400',    bg: 'bg-blue-400/10',    border: 'border-blue-400/20' },
  completed: { text: 'text-emerald-400', bg: 'bg-emerald-400/10', border: 'border-emerald-400/20' },
  expired:   { text: 'text-white/25',    bg: 'bg-white/[0.04]',   border: 'border-white/[0.08]' },
}

/* ─── Helpers ─────────────────────────────────────────────────────── */
function avg(candidates, key) {
  if (!candidates.length) return 0
  const sum = candidates.reduce((s, c) => s + (c.scores?.[key] ?? 0), 0)
  return (sum / candidates.length).toFixed(1)
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function overallScore(scores) {
  if (!scores) return 0
  const vals = Object.values(scores).filter(Boolean)
  if (!vals.length) return 0
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
}

/* ─── Stat card ───────────────────────────────────────────────────── */
function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
      <p className="font-inter text-[10px] text-white/30 uppercase tracking-widest mb-1.5">{label}</p>
      <p className="font-syne font-bold text-3xl text-white leading-none">{value}</p>
      {sub && <p className="font-inter text-xs text-white/25 mt-1.5">{sub}</p>}
    </div>
  )
}

/* ─── Expanded candidate detail ───────────────────────────────────── */
function CandidateDetail({ candidate }) {
  const { scores, summary, key_quotes, filler_words, follow_up_count } = candidate
  const fillerEntries = Object.entries(filler_words || {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="px-4 pb-4 pt-2 border-t border-white/[0.05] bg-black/20">
      <div className="grid grid-cols-2 gap-3 mb-4">
        {Object.entries(scores || {}).map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span className={`font-inter text-xs capitalize ${k === 'confidence' ? 'text-blue-300/50' : 'text-white/35'}`}>{k}</span>
            <span className={`font-syne font-semibold text-sm ${k === 'confidence' ? 'text-blue-400/80' : 'text-[#a78bfa]'}`}>{v}/10</span>
          </div>
        ))}
        {follow_up_count > 0 && (
          <div className="flex items-center justify-between col-span-2 border-t border-white/[0.05] pt-2">
            <span className="font-inter text-xs text-white/25">Follow-up questions</span>
            <span className="font-syne font-semibold text-sm text-amber-400/70">{follow_up_count}</span>
          </div>
        )}
      </div>
      {summary && <p className="font-inter text-xs text-white/40 leading-relaxed mb-3">{summary}</p>}
      {key_quotes?.length > 0 && (
        <div className="space-y-2 mb-3">
          {key_quotes.map((q, i) => (
            <p key={i} className="font-inter text-xs text-white/30 italic pl-3 border-l border-[#7c3aed]/30">"{q}"</p>
          ))}
        </div>
      )}
      {fillerEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {fillerEntries.map(([word, count]) => (
            <span key={word} className="font-inter text-[10px] bg-[#7c3aed]/10 border border-[#7c3aed]/20 rounded-full px-2 py-0.5 text-[#a78bfa]/70">
              {word} {count}×
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─── Candidate row ───────────────────────────────────────────────── */
function CandidateRow({ candidate, onDelete }) {
  const [expanded, setExpanded]   = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const rec   = candidate.recommendation || 'Review'
  const style = REC_STYLE[rec] ?? REC_STYLE.Review
  const score = overallScore(candidate.scores)

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try { await onDelete(candidate.id) } catch { setDeleting(false); setConfirming(false) }
  }

  return (
    <div className="border border-white/[0.06] rounded-xl overflow-hidden mb-2.5 last:mb-0">
      <div className="flex items-center hover:bg-white/[0.02] transition-colors">
        {/* Clickable expand area */}
        <button
          className="flex-1 min-w-0 text-left px-4 py-3.5 flex items-center gap-3"
          onClick={() => { setExpanded((v) => !v); setConfirming(false) }}
        >
          <div className="flex-1 min-w-0">
            <p className="font-syne font-semibold text-sm text-white truncate">{candidate.candidate_name}</p>
            <p className="font-inter text-[11px] text-white/25 mt-0.5">{formatDate(candidate.date)}</p>
          </div>
          <div className="flex-shrink-0 text-right">
            <p className="font-syne font-bold text-lg text-white/80 leading-none">{score}</p>
            <p className="font-inter text-[9px] text-white/20 mt-0.5">avg</p>
          </div>
          <div className={`flex-shrink-0 ${style.bg} ${style.border} border rounded-full px-2.5 py-1`}>
            <span className={`font-inter text-[11px] font-medium ${style.text}`}>{rec}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="rgba(255,255,255,0.2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {/* Delete button — sibling, not nested */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className={`flex-shrink-0 mx-3 px-2.5 py-1 rounded-lg font-inter text-[11px] transition-colors ${
            confirming
              ? 'bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30'
              : 'bg-white/[0.04] border border-white/[0.08] text-white/25 hover:text-red-400/70 hover:border-red-400/20'
          }`}
        >
          {deleting ? '…' : confirming ? 'Confirm?' : 'Delete'}
        </button>
      </div>
      {expanded && <CandidateDetail candidate={candidate} />}
    </div>
  )
}

/* ─── Invite row ──────────────────────────────────────────────────── */
function InviteRow({ invite, isAdmin }) {
  const [copied, setCopied] = useState(false)
  const status = invite.status
  const style  = INVITE_STATUS_STYLE[status] ?? INVITE_STATUS_STYLE.pending
  const link   = `${window.location.origin}/interview/${invite.token}`

  const copyLink = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="border border-white/[0.06] rounded-xl px-4 py-3 mb-2.5 last:mb-0 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="font-syne font-semibold text-sm text-white truncate">{invite.candidate_name}</p>
        <p className="font-inter text-[11px] text-white/25 mt-0.5">
          {invite.candidate_email ? `${invite.candidate_email} · ` : ''}
          {formatDate(invite.created_at)}
          {isAdmin && invite.created_by_name && (
            <span className="ml-1.5 text-[#a78bfa]/50">· {invite.created_by_name}</span>
          )}
        </p>
      </div>
      <div className={`flex-shrink-0 ${style.bg} ${style.border} border rounded-full px-2.5 py-1`}>
        <span className={`font-inter text-[11px] font-medium ${style.text} capitalize`}>{status}</span>
      </div>
      {status === 'pending' && (
        <button
          onClick={copyLink}
          className="flex-shrink-0 font-inter text-[11px] px-3 py-1.5 rounded-lg bg-[#7c3aed]/15 border border-[#7c3aed]/25 text-[#a78bfa] hover:bg-[#7c3aed]/25 transition-colors"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
      )}
    </div>
  )
}

/* ─── Invite form ─────────────────────────────────────────────────── */
function InviteForm({ token, onCreated }) {
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const invite = await createInvite(name.trim(), email.trim() || null, token)
      onCreated(invite)
      setName('')
      setEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleCreate} className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-5 mb-5">
      <p className="font-inter text-[10px] text-white/30 uppercase tracking-widest mb-4">New Invite</p>
      <div className="flex flex-col sm:flex-row gap-2.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Candidate name"
          required
          className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
            font-inter text-sm text-white placeholder:text-white/20
            focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (sends invite)"
          className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
            font-inter text-sm text-white placeholder:text-white/20
            focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="px-5 py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:bg-white/[0.04] disabled:cursor-not-allowed
            text-white disabled:text-white/20 font-syne font-semibold text-sm rounded-xl
            transition-all duration-200 hover:shadow-[0_0_24px_rgba(124,58,237,0.4)] whitespace-nowrap"
        >
          {loading ? 'Creating…' : 'Create Invite'}
        </button>
      </div>
      {error && <p className="font-inter text-red-400/70 text-xs mt-2">{error}</p>}
    </form>
  )
}

/* ─── Quick-start interview modal ────────────────────────────────── */
function QuickStartModal({ token, onClose }) {
  const [name, setName]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const inputRef              = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const handleStart = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const invite = await createInvite(name.trim(), null, token)
      const link   = `${window.location.origin}/interview/${invite.token}`
      window.open(link, '_blank', 'noopener,noreferrer')
      onClose()
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-[#13111f] border border-white/[0.1] rounded-2xl p-6 animate-fade-up shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div>
            <p className="font-inter text-[10px] text-[#a78bfa] uppercase tracking-widest mb-0.5">Quick Start</p>
            <h3 className="font-syne font-bold text-white text-lg">Start Interview</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-white/10 text-white/30 hover:text-white/60 hover:border-white/20 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <form onSubmit={handleStart} className="space-y-3">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Candidate's full name"
            required
            className="w-full bg-white/[0.05] border border-white/[0.1] rounded-xl px-4 py-3
              font-inter text-sm text-white placeholder:text-white/20
              focus:outline-none focus:border-[#7c3aed]/50 focus:bg-white/[0.07] transition-colors"
          />
          {error && <p className="font-inter text-red-400/70 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] disabled:bg-white/[0.04] disabled:cursor-not-allowed
              text-white disabled:text-white/20 font-syne font-semibold text-sm py-3 rounded-xl
              transition-all duration-200 hover:shadow-[0_0_32px_rgba(124,58,237,0.5)]"
          >
            {loading ? 'Starting…' : 'Open Interview →'}
          </button>
          <p className="font-inter text-[11px] text-white/20 text-center">Opens in a new tab</p>
        </form>
      </div>
    </div>
  )
}

/* ─── HR create form ──────────────────────────────────────────────── */
function HRCreateForm({ token, onCreated }) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password) return
    setLoading(true)
    setError(null)
    try {
      const user = await createHR(name.trim(), email.trim(), password, token)
      onCreated(user)
      setName('')
      setEmail('')
      setPassword('')
    } catch (err) {
      // Extract message from JSON detail if present
      let msg = err.message
      try { msg = JSON.parse(msg.split(': ').slice(1).join(': ')).detail ?? msg } catch {}
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleCreate} className="bg-white/[0.02] border border-white/[0.07] rounded-2xl p-5 mb-5">
      <p className="font-inter text-[10px] text-white/30 uppercase tracking-widest mb-4">Add HR Member</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-2.5">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          required
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
            font-inter text-sm text-white placeholder:text-white/20
            focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          required
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
            font-inter text-sm text-white placeholder:text-white/20
            focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
            font-inter text-sm text-white placeholder:text-white/20
            focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
        />
      </div>
      <button
        type="submit"
        disabled={loading || !name.trim() || !email.trim() || !password}
        className="px-5 py-2.5 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:bg-white/[0.04] disabled:cursor-not-allowed
          text-white disabled:text-white/20 font-syne font-semibold text-sm rounded-xl
          transition-all duration-200 hover:shadow-[0_0_24px_rgba(124,58,237,0.4)]"
      >
        {loading ? 'Adding…' : 'Add Member'}
      </button>
      {error && <p className="font-inter text-red-400/70 text-xs mt-2">{error}</p>}
    </form>
  )
}

/* ─── HR member row ───────────────────────────────────────────────── */
function HRRow({ member, currentUserId, token, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading]       = useState(false)
  const isSelf    = member.id === currentUserId
  const isAdmin   = member.role === 'admin'

  const handleDelete = async () => {
    setLoading(true)
    try {
      await deleteHR(member.id, token)
      onDeleted(member.id)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoading(false)
      setConfirming(false)
    }
  }

  return (
    <div className="border border-white/[0.06] rounded-xl px-4 py-3 mb-2.5 last:mb-0 flex items-center gap-3">
      {/* Avatar initial */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#7c3aed]/20 border border-[#7c3aed]/30 flex items-center justify-center">
        <span className="font-syne font-bold text-xs text-[#a78bfa]">
          {member.name.charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-syne font-semibold text-sm text-white truncate">{member.name}</p>
          {isSelf && (
            <span className="font-inter text-[10px] text-white/30 bg-white/[0.05] rounded-full px-2 py-0.5">you</span>
          )}
        </div>
        <p className="font-inter text-[11px] text-white/30 mt-0.5">{member.email}</p>
      </div>

      {/* Role badge */}
      <div className={`flex-shrink-0 rounded-full px-2.5 py-1 ${
        isAdmin
          ? 'bg-[#7c3aed]/15 border border-[#7c3aed]/30'
          : 'bg-white/[0.04] border border-white/[0.08]'
      }`}>
        <span className={`font-inter text-[11px] font-medium capitalize ${isAdmin ? 'text-[#a78bfa]' : 'text-white/30'}`}>
          {member.role}
        </span>
      </div>

      {/* Delete */}
      {!isSelf && (
        confirming ? (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <button
              onClick={handleDelete}
              disabled={loading}
              className="font-inter text-[11px] px-2.5 py-1 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              {loading ? '…' : 'Confirm'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="font-inter text-[11px] px-2.5 py-1 rounded-lg border border-white/[0.08] text-white/25 hover:text-white/50 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex-shrink-0 font-inter text-[11px] px-2.5 py-1 rounded-lg border border-white/[0.07] text-white/20 hover:text-red-400/70 hover:border-red-500/20 transition-colors"
          >
            Remove
          </button>
        )
      )}
    </div>
  )
}

/* ─── Dashboard page ──────────────────────────────────────────────── */
export default function DashboardPage() {
  const { token, user, logout } = useAuth()
  const navigate  = useNavigate()
  const isAdmin   = user?.role === 'admin'

  const [tab, setTab]              = useState('candidates')
  const [candidates, setCandidates]= useState([])
  const [invites, setInvites]      = useState([])
  const [hrMembers, setHrMembers]  = useState([])
  const [loading, setLoading]      = useState(true)
  const [error, setError]          = useState(null)
  const [search, setSearch]        = useState('')
  const [sortKey, setSortKey]      = useState('date')
  const [sortDir, setSortDir]      = useState('desc')
  const [showQuickStart, setShowQuickStart] = useState(false)

  useEffect(() => {
    const calls = [getCandidates(token), listInvites(token)]
    if (isAdmin) calls.push(listHR(token))
    Promise.all(calls)
      .then(([c, inv, hr]) => {
        setCandidates(c)
        setInvites(inv)
        if (hr) setHrMembers(hr)
      })
      .catch((e) => {
        if (e.message?.includes('401')) {
          logout()
          navigate('/login', { replace: true })
        } else {
          setError('Failed to load data. Please refresh the page.')
        }
      })
      .finally(() => setLoading(false))
  }, [token, isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNewInvite = (invite) => {
    setInvites((prev) => [invite, ...prev])
    setTab('invites')
  }

  const handleNewHR = (member) => {
    setHrMembers((prev) => [...prev, member])
  }

  const handleDeleteHR = (id) => {
    setHrMembers((prev) => prev.filter((m) => m.id !== id))
  }

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  /* ── Stats ────────────────────────────────────────────────────── */
  const total    = candidates.length
  const passes   = candidates.filter((c) => c.recommendation === 'Pass').length
  const reviews  = candidates.filter((c) => c.recommendation === 'Review').length
  const passRate = total ? Math.round((passes / total) * 100) : 0

  /* ── Filter + sort candidates ─────────────────────────────────── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return candidates
      .filter((c) =>
        !q ||
        c.candidate_name.toLowerCase().includes(q) ||
        (c.recommendation || '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        let va, vb
        if (sortKey === 'date')       { va = a.date; vb = b.date }
        else if (sortKey === 'score') { va = overallScore(a.scores); vb = overallScore(b.scores) }
        else if (sortKey === 'name')  { va = a.candidate_name.toLowerCase(); vb = b.candidate_name.toLowerCase() }
        else if (sortKey === 'rec')   { va = a.recommendation; vb = b.recommendation }
        if (va < vb) return sortDir === 'asc' ? -1 : 1
        if (va > vb) return sortDir === 'asc' ? 1 : -1
        return 0
      })
  }, [candidates, search, sortKey, sortDir])

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const SortBtn = ({ label, k }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`font-inter text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${
        sortKey === k
          ? 'bg-[#7c3aed]/20 border-[#7c3aed]/30 text-[#a78bfa]'
          : 'border-white/[0.07] text-white/25 hover:text-white/45 hover:border-white/15'
      }`}
    >
      {label} {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : ''}
    </button>
  )

  /* ── Tabs config ──────────────────────────────────────────────── */
  const tabs = [
    { key: 'candidates', label: `Candidates (${total})` },
    { key: 'invites',    label: `Invites (${invites.length})` },
    ...(isAdmin ? [{ key: 'team', label: `Team (${hrMembers.length})` }] : []),
  ]

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#0a0a0f] py-10 px-4">
      {showQuickStart && (
        <QuickStartModal token={token} onClose={() => setShowQuickStart(false)} />
      )}
      <div className="max-w-2xl mx-auto animate-fade-up">

        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse block" />
              <span className="font-inter text-[#a78bfa] text-[10px] uppercase tracking-widest">
                {isAdmin ? 'Admin Dashboard' : 'Recruiter Dashboard'}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <h1 className="font-syne font-bold text-3xl text-white">{user?.name || 'Dashboard'}</h1>
              {isAdmin && (
                <span className="font-inter text-[10px] bg-[#7c3aed]/15 border border-[#7c3aed]/30 text-[#a78bfa] rounded-full px-2.5 py-1">
                  Admin
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="font-inter text-xs text-white/25 hover:text-white/55 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* ── Stats cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total"       value={total}    sub="candidates" />
          <StatCard label="Pass"        value={passes}   sub={`${passRate}% pass rate`} />
          <StatCard label="Review"      value={reviews}  sub="needs review" />
          <StatCard label="Avg Clarity" value={avg(candidates, 'clarity')} sub="out of 10" />
        </div>

        {/* ── Start Interview button ───────────────────────────── */}
        <button
          onClick={() => setShowQuickStart(true)}
          className="w-full flex items-center justify-center gap-2.5 mb-4 py-3.5
            bg-[#7c3aed] hover:bg-[#6d28d9] rounded-2xl
            font-syne font-semibold text-sm text-white
            transition-all duration-200 hover:shadow-[0_0_32px_rgba(124,58,237,0.45)] hover:scale-[1.01]"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Start Interview
        </button>

        {/* ── Invite form ──────────────────────────────────────── */}
        <InviteForm token={token} onCreated={handleNewInvite} />

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div className="flex gap-1 mb-5 bg-white/[0.03] border border-white/[0.07] rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 font-inter text-xs py-2 rounded-lg transition-colors ${
                tab === t.key
                  ? 'bg-[#7c3aed]/25 text-[#a78bfa] border border-[#7c3aed]/30'
                  : 'text-white/30 hover:text-white/55'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Candidates tab ───────────────────────────────────── */}
        {tab === 'candidates' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3 mb-5">
              <input
                type="text"
                placeholder="Search by name or outcome…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5
                           font-inter text-sm text-white/70 placeholder:text-white/20
                           focus:outline-none focus:border-[#7c3aed]/40 transition-colors"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-inter text-[10px] text-white/20 uppercase tracking-widest">Sort:</span>
                <SortBtn label="Date"   k="date"  />
                <SortBtn label="Score"  k="score" />
                <SortBtn label="Name"   k="name"  />
                <SortBtn label="Result" k="rec"   />
              </div>
            </div>

            {loading && <div className="text-center py-16"><p className="font-inter text-white/25 text-sm animate-pulse">Loading…</p></div>}
            {error   && <div className="text-center py-16"><p className="font-inter text-red-400/60 text-sm">{error}</p></div>}
            {!loading && !error && filtered.length === 0 && (
              <div className="text-center py-16">
                <p className="font-inter text-white/20 text-sm">
                  {candidates.length === 0 ? 'No interviews completed yet.' : 'No matches found.'}
                </p>
              </div>
            )}
            {!loading && !error && filtered.length > 0 && (
              <div>
                {filtered.map((c) => (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    onDelete={async (id) => {
                      await deleteCandidate(id, token)
                      setCandidates((prev) => prev.filter((x) => x.id !== id))
                    }}
                  />
                ))}
                <p className="font-inter text-[10px] text-white/15 text-center mt-4">
                  Showing {filtered.length} of {total} candidates
                </p>
              </div>
            )}
          </>
        )}

        {/* ── Invites tab ──────────────────────────────────────── */}
        {tab === 'invites' && (
          <>
            {invites.length === 0 ? (
              <div className="text-center py-16">
                <p className="font-inter text-white/20 text-sm">No invites yet. Create one above.</p>
              </div>
            ) : (
              invites.map((inv) => <InviteRow key={inv.id} invite={inv} isAdmin={isAdmin} />)
            )}
          </>
        )}

        {/* ── Team tab (admin only) ─────────────────────────────── */}
        {tab === 'team' && isAdmin && (
          <>
            <HRCreateForm token={token} onCreated={handleNewHR} />
            {hrMembers.length === 0 ? (
              <div className="text-center py-16">
                <p className="font-inter text-white/20 text-sm">No team members yet.</p>
              </div>
            ) : (
              hrMembers.map((m) => (
                <HRRow
                  key={m.id}
                  member={m}
                  currentUserId={user?.id}
                  token={token}
                  onDeleted={handleDeleteHR}
                />
              ))
            )}
          </>
        )}

      </div>
    </div>
  )
}
