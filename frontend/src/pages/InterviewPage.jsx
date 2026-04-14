import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom'
import { transcribeAudio, sendChat, assessInterview, verifyInviteToken, completeInviteToken } from '../api.js'

/* ─── Status machine ─────────────────────────────────────────────────── */
const STATUS = {
  IDLE:       'idle',
  COUNTDOWN:  'countdown',
  RECORDING:  'recording',
  PROCESSING: 'processing',
  THINKING:   'thinking',
  SPEAKING:   'speaking',
  PAUSING:    'pausing',
  ASSESSING:  'assessing',
}

/* ─── Browser TTS ────────────────────────────────────────────────────── */
// Voices load async on Chrome — keep a live cache updated by onvoiceschanged
let _cachedVoices = []
if (typeof window !== 'undefined' && window.speechSynthesis) {
  const _refreshVoices = () => { _cachedVoices = window.speechSynthesis.getVoices() }
  _refreshVoices()
  window.speechSynthesis.onvoiceschanged = _refreshVoices
}

const FEMALE_VOICE_NAMES = new Set([
  'Samantha', 'Karen', 'Moira', 'Veena', 'Tessa', 'Fiona', 'Victoria',
  'Google UK English Female', 'Google US English',
  'Microsoft Zira', 'Microsoft Aria', 'Microsoft Jenny',
])

function pickVoice() {
  const voices = _cachedVoices.length
    ? _cachedVoices
    : (window.speechSynthesis?.getVoices() || [])

  const tests = [
    (v) => FEMALE_VOICE_NAMES.has(v.name),
    (v) => /female|woman/i.test(v.name),
    (v) => v.lang === 'en-IN' && /female|veena/i.test(v.name),
    (v) => /^en-(GB|AU|IE)/.test(v.lang) && /female/i.test(v.name),
    (v) => v.lang.startsWith('en') && /female/i.test(v.name),
    (v) => v.lang.startsWith('en') && !/male|man|daniel|alex|rishi|fred|ralph/i.test(v.name),
    (v) => v.lang.startsWith('en'),
  ]

  for (const test of tests) {
    const match = voices.find(test)
    if (match) return match
  }
  return null
}

function chunkText(text) {
  const s = text.replace(/\.{3}/g, '…').replace(/ ?-- ?/g, ' — ')
  const parts = s
    .split(/(?<=[.!?])\s+(?=[A-Z"'(])|(?<=[—…])\s*/)
    .map((c) => c.trim())
    .filter(Boolean)
  return parts.length ? parts : [text.trim()]
}

function getPause(chunk) {
  const last = chunk.trimEnd().slice(-1)
  if (last === '?' || last === '!') return 400
  if (last === '—' || last === '…') return 180
  return 250
}

function speakChunked(text, { onStart, onPause, onEnd }) {
  if (!window.speechSynthesis) { onEnd(); return }
  window.speechSynthesis.cancel()

  const chunks = chunkText(text)
  const voice  = pickVoice()
  let index    = 0

  function speakNext() {
    if (index >= chunks.length) { onEnd(); return }

    const chunk = chunks[index]
    const utter = new SpeechSynthesisUtterance(chunk)
    if (voice) utter.voice = voice
    utter.rate   = 0.83
    utter.pitch  = 1.3
    utter.volume = 1

    utter.onstart = () => onStart()

    utter.onend = () => {
      index++
      if (index < chunks.length) {
        onPause()
        setTimeout(speakNext, getPause(chunk))
      } else {
        onEnd()
      }
    }

    utter.onerror = () => {
      index++
      setTimeout(speakNext, 100)
    }

    window.speechSynthesis.speak(utter)
  }

  setTimeout(speakNext, 300)
}

/* ─── Filler detection ───────────────────────────────────────────────── */
const FILLERS = ['you know', 'kind of', 'sort of', 'um', 'uh', 'like', 'basically', 'literally', 'actually']

function countFillers(text) {
  const lower = text.toLowerCase()
  const result = {}
  for (const filler of FILLERS) {
    const pattern = filler.includes(' ')
      ? new RegExp(filler.replace(/\s+/g, '\\s+'), 'gi')
      : new RegExp(`\\b${filler}\\b`, 'gi')
    const matches = lower.match(pattern)
    if (matches?.length) result[filler] = matches.length
  }
  return result
}

function mergeFillers(existing, incoming) {
  const merged = { ...existing }
  for (const [k, v] of Object.entries(incoming)) merged[k] = (merged[k] || 0) + v
  return merged
}

function formatTime(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/* ─── Avatar CSS keyframes ───────────────────────────────────────────── */
const AVATAR_STYLE = `
@keyframes mouth-open {
  0%, 100% { d: path("M 43 78 Q 50 80 57 78"); }
  50%       { d: path("M 43 78 Q 50 84 57 78"); }
}
@keyframes mouth-speak {
  0%, 100% { ry: 0.5px; }
  50%       { ry: 3.5px; }
}
@keyframes eye-think {
  0%, 100% { transform: translateX(0) scaleY(1); }
  50%       { transform: translateX(1px) scaleY(0.92); }
}
@keyframes blink {
  0%, 88%, 100% { transform: scaleY(1); }
  93%            { transform: scaleY(0.06); }
}
@keyframes hair-shimmer {
  0%, 100% { opacity: 0.18; }
  50%       { opacity: 0.28; }
}
`

/* ─── Female Avatar — Anika ──────────────────────────────────────────── */
function AnikaAvatar({ speaking, thinking }) {
  return (
    <div className="relative flex items-center justify-center select-none">
      {/* Outer glow rings when speaking */}
      <div
        className={`absolute rounded-full transition-all duration-700 ${speaking ? 'animate-pulse-ring opacity-100' : 'opacity-0'}`}
        style={{ width: 212, height: 212, background: 'rgba(180,100,240,0.16)' }}
      />
      <div
        className={`absolute rounded-full transition-all duration-700 ${speaking ? 'animate-pulse-ring-slow opacity-100' : 'opacity-0'}`}
        style={{ width: 212, height: 212, background: 'rgba(180,100,240,0.09)' }}
      />

      <div
        className={`relative rounded-full overflow-hidden transition-all duration-500 ${speaking ? 'animate-bob' : 'animate-breathe'}`}
        style={{
          width: 188, height: 188,
          boxShadow: speaking
            ? '0 0 0 2.5px #b464f0, 0 0 48px rgba(180,100,240,0.55), 0 0 80px rgba(180,100,240,0.22)'
            : thinking
              ? '0 0 0 2px rgba(180,100,240,0.45), 0 0 28px rgba(180,100,240,0.28)'
              : '0 0 0 1.5px rgba(167,139,250,0.35), 0 0 18px rgba(167,139,250,0.14)',
          background: 'radial-gradient(circle at 42% 28%, #1e0a38 0%, #0e0520 55%, #080314 100%)',
        }}
      >
        <svg viewBox="0 0 100 112" width="188" height="188" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
          <defs>
            {/* Background */}
            <radialGradient id="fBg" cx="50%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#220c42" />
              <stop offset="100%" stopColor="#08021a" />
            </radialGradient>
            {/* Skin — warm honey tone */}
            <radialGradient id="fSkin" cx="42%" cy="32%" r="62%">
              <stop offset="0%"   stopColor="#f2c08a" />
              <stop offset="55%"  stopColor="#dda060" />
              <stop offset="100%" stopColor="#c07838" />
            </radialGradient>
            {/* Skin highlight */}
            <radialGradient id="fSkinH" cx="38%" cy="28%" r="40%">
              <stop offset="0%"   stopColor="#ffd8a8" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ffd8a8" stopOpacity="0" />
            </radialGradient>
            {/* Hair — deep espresso */}
            <linearGradient id="fHair" x1="25%" y1="0%" x2="75%" y2="100%">
              <stop offset="0%"   stopColor="#2e1510" />
              <stop offset="40%"  stopColor="#1c0c08" />
              <stop offset="100%" stopColor="#0e0604" />
            </linearGradient>
            {/* Hair sheen */}
            <linearGradient id="fHairSheen" x1="20%" y1="0%" x2="80%" y2="60%">
              <stop offset="0%"   stopColor="#6b3020" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#6b3020" stopOpacity="0" />
            </linearGradient>
            {/* Blush */}
            <radialGradient id="fBlush" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#e88068" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#e88068" stopOpacity="0" />
            </radialGradient>
            {/* Lip */}
            <linearGradient id="fLipT" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor="#d96868" />
              <stop offset="100%" stopColor="#b84848" />
            </linearGradient>
            <linearGradient id="fLipB" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%"   stopColor="#e07070" />
              <stop offset="100%" stopColor="#c05252" />
            </linearGradient>
            {/* Eye iris */}
            <radialGradient id="fIris" cx="38%" cy="35%" r="60%">
              <stop offset="0%"   stopColor="#7a4820" />
              <stop offset="60%"  stopColor="#4a2c10" />
              <stop offset="100%" stopColor="#2a1808" />
            </radialGradient>
            {/* Outfit */}
            <linearGradient id="fOutfit" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="#2d1a52" />
              <stop offset="100%" stopColor="#1a0f38" />
            </linearGradient>
          </defs>

          {/* ── Background ── */}
          <rect width="100" height="112" fill="url(#fBg)" />

          {/* ── Hair — back bulk ── */}
          <ellipse cx="50" cy="46" rx="27" ry="30" fill="url(#fHair)" />
          {/* Long flowing sides */}
          <path d="M 23 54 Q 18 68 20 84 Q 22 92 26 98 Q 28 90 27 78 Q 27 64 30 54 Z"
            fill="url(#fHair)" />
          <path d="M 77 54 Q 82 68 80 84 Q 78 92 74 98 Q 72 90 73 78 Q 73 64 70 54 Z"
            fill="url(#fHair)" />
          {/* Top bun / volume */}
          <ellipse cx="50" cy="21" rx="17" ry="13" fill="url(#fHair)" />
          {/* Bun highlight sheen */}
          <ellipse cx="44" cy="17" rx="8" ry="5" fill="url(#fHairSheen)"
            style={{ animation: 'hair-shimmer 3.5s ease-in-out infinite' }} />

          {/* ── Neck ── */}
          <path d="M 44 85 Q 43 96 42 102 L 58 102 Q 57 96 56 85 Z"
            fill="url(#fSkin)" />

          {/* ── Outfit — professional top with V-collar ── */}
          <path d="M 15 112 Q 26 100 42 102 L 50 108 L 58 102 Q 74 100 85 112 Z"
            fill="url(#fOutfit)" />
          {/* V-collar lines */}
          <path d="M 42 102 L 50 109 L 58 102" stroke="#5a3a8a" strokeWidth="0.9" fill="none" opacity="0.7" />
          <path d="M 50 109 L 50 112" stroke="#5a3a8a" strokeWidth="0.7" fill="none" opacity="0.45" />
          {/* Collar accent */}
          <path d="M 38 104 Q 44 101 50 103 Q 56 101 62 104"
            stroke="#7c5ab8" strokeWidth="0.6" fill="none" strokeLinecap="round" opacity="0.5" />

          {/* ── Face ── */}
          <ellipse cx="50" cy="62" rx="24" ry="27" fill="url(#fSkin)" />
          {/* Skin highlight on forehead/cheek */}
          <ellipse cx="50" cy="55" rx="18" ry="14" fill="url(#fSkinH)" />

          {/* ── Hair overlapping face sides ── */}
          <path d="M 26 50 Q 23 40 27 31 Q 34 24 44 27 Q 38 31 36 42 Q 31 47 26 50 Z"
            fill="url(#fHair)" />
          <path d="M 74 50 Q 77 40 73 31 Q 66 24 56 27 Q 62 31 64 42 Q 69 47 74 50 Z"
            fill="url(#fHair)" />
          {/* Hair part / fringe */}
          <path d="M 34 33 Q 42 28 50 29 Q 58 28 66 33 Q 59 30 50 31 Q 41 30 34 33 Z"
            fill="url(#fHair)" />

          {/* ── Blush ── */}
          <ellipse cx="33" cy="68" rx="7.5" ry="5" fill="url(#fBlush)" />
          <ellipse cx="67" cy="68" rx="7.5" ry="5" fill="url(#fBlush)" />

          {/* ── Earrings (gold drops) ── */}
          <circle cx="26" cy="66" r="2"   fill="#d4af37" opacity="0.9" />
          <ellipse cx="26" cy="70" rx="1.2" ry="2" fill="#d4af37" opacity="0.75" />
          <circle cx="74" cy="66" r="2"   fill="#d4af37" opacity="0.9" />
          <ellipse cx="74" cy="70" rx="1.2" ry="2" fill="#d4af37" opacity="0.75" />

          {/* ── Eyebrows — defined feminine arch ── */}
          <path d="M 35.5 52 Q 40 48.5 45.5 50" stroke="#3a1a06" strokeWidth="1.8"
            fill="none" strokeLinecap="round" />
          <path d="M 54.5 50 Q 60 48.5 64.5 52" stroke="#3a1a06" strokeWidth="1.8"
            fill="none" strokeLinecap="round" />
          {/* Brow fill softener */}
          <path d="M 35.5 52 Q 40 49 45.5 50.5" stroke="#5a2a0a" strokeWidth="0.8"
            fill="none" strokeLinecap="round" opacity="0.5" />
          <path d="M 54.5 50.5 Q 60 49 64.5 52" stroke="#5a2a0a" strokeWidth="0.8"
            fill="none" strokeLinecap="round" opacity="0.5" />

          {/* ── Left eye ── */}
          <g style={{
            transformOrigin: '41px 58px',
            animation: speaking
              ? 'blink 2.6s ease-in-out infinite 0.2s'
              : thinking
                ? 'blink 5s ease-in-out infinite, eye-think 1.9s ease-in-out infinite'
                : 'blink 4.2s ease-in-out infinite',
          }}>
            {/* Eye white */}
            <ellipse cx="41" cy="58" rx="6.5" ry="4.5" fill="#faf6f0" />
            {/* Iris */}
            <ellipse cx="41" cy="58" rx="4.5" ry="4.2" fill="url(#fIris)" />
            {/* Pupil */}
            <circle cx="41" cy="58" r="2.6" fill="#0c0508" />
            {/* Catchlight */}
            <circle cx="42.6" cy="56.4" r="0.95" fill="white" opacity="0.92" />
            <circle cx="40.2" cy="59.8" r="0.45" fill="white" opacity="0.45" />
            {/* Upper lash line */}
            <path d="M 34.5 55.2 Q 41 53 47.5 55.2" stroke="#150608" strokeWidth="1.6"
              fill="none" strokeLinecap="round" />
            {/* Lower lash hint */}
            <path d="M 35.5 60.5 Q 41 62 46.5 60.5" stroke="#2a1010" strokeWidth="0.6"
              fill="none" strokeLinecap="round" opacity="0.4" />
          </g>

          {/* ── Right eye ── */}
          <g style={{
            transformOrigin: '59px 58px',
            animation: speaking
              ? 'blink 2.6s ease-in-out infinite 1.0s'
              : thinking
                ? 'blink 5s ease-in-out infinite 0.6s, eye-think 1.9s ease-in-out infinite'
                : 'blink 4.2s ease-in-out infinite 1.9s',
          }}>
            <ellipse cx="59" cy="58" rx="6.5" ry="4.5" fill="#faf6f0" />
            <ellipse cx="59" cy="58" rx="4.5" ry="4.2" fill="url(#fIris)" />
            <circle cx="59" cy="58" r="2.6" fill="#0c0508" />
            <circle cx="60.6" cy="56.4" r="0.95" fill="white" opacity="0.92" />
            <circle cx="58.2" cy="59.8" r="0.45" fill="white" opacity="0.45" />
            <path d="M 52.5 55.2 Q 59 53 65.5 55.2" stroke="#150608" strokeWidth="1.6"
              fill="none" strokeLinecap="round" />
            <path d="M 53.5 60.5 Q 59 62 64.5 60.5" stroke="#2a1010" strokeWidth="0.6"
              fill="none" strokeLinecap="round" opacity="0.4" />
          </g>

          {/* Thinking half-close overlay */}
          {thinking && !speaking && (
            <>
              <ellipse cx="41" cy="56.5" rx="6.5" ry="2.2" fill="url(#fSkin)" opacity="0.72" />
              <ellipse cx="59" cy="56.5" rx="6.5" ry="2.2" fill="url(#fSkin)" opacity="0.72" />
            </>
          )}

          {/* ── Nose ── */}
          <path d="M 48.5 66 Q 47 71 48.5 73.5 Q 50 74.8 51.5 73.5 Q 53 71 51.5 66"
            stroke="#b87840" strokeWidth="0.8" fill="none" strokeLinecap="round" opacity="0.55" />
          <path d="M 46.5 73 Q 50 75.2 53.5 73"
            stroke="#b87840" strokeWidth="0.75" fill="none" strokeLinecap="round" opacity="0.45" />

          {/* ── Lips ── */}
          {/* Upper lip — cupid's bow */}
          <path d="M 42.5 77.5 Q 45.5 74 48.5 75.5 Q 50 74.5 51.5 75.5 Q 54.5 74 57.5 77.5
                   Q 54 75.5 50 76.2 Q 46 75.5 42.5 77.5 Z"
            fill="url(#fLipT)" />
          {/* Lower lip */}
          <path d="M 42.5 77.5 Q 46.5 82.5 50 83 Q 53.5 82.5 57.5 77.5
                   Q 54 80.5 50 81 Q 46 80.5 42.5 77.5 Z"
            fill="url(#fLipB)" />
          {/* Lip centre line */}
          <path d="M 42.5 77.5 Q 50 79 57.5 77.5"
            stroke="#a84848" strokeWidth="0.55" fill="none" opacity="0.5" />
          {/* Speaking mouth open */}
          {speaking && (
            <>
              <ellipse cx="50" cy="79.5" rx="5.5" ry="0.5" fill="#1a0808"
                style={{ animation: 'mouth-speak 0.38s ease-in-out infinite' }} />
            </>
          )}
          {/* Lip gloss highlight */}
          <ellipse cx="50" cy="80.5" rx="3.5" ry="1" fill="white" opacity="0.09" />

          {/* ── Thinking dots ── */}
          {thinking && !speaking && (
            <g>
              {[0, 200, 400].map((d, i) => (
                <circle
                  key={i}
                  cx={46 + i * 4} cy={95}
                  r="1.3"
                  fill="#a78bfa"
                  opacity="0.7"
                  style={{ animation: `bounce 0.8s ease-in-out ${d}ms infinite` }}
                />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  )
}

/* ─── Wave bars ──────────────────────────────────────────────────────── */
function WaveBars({ active, count = 5, color = '#a78bfa', height = '20px' }) {
  const delays = Array.from({ length: count }, (_, i) => i * (0.72 / (count - 1)))
  return (
    <div className="flex items-center gap-[3px]" style={{ height }}>
      {delays.map((d, i) => (
        <div key={i} className={`w-[3px] rounded-full origin-center ${active ? 'animate-wave' : ''}`}
          style={{
            height: active ? '100%' : '28%',
            background: color,
            opacity: active ? 0.85 : 0.22,
            animationDelay: `${d}s`,
            transition: 'height 0.3s ease, opacity 0.3s ease',
          }} />
      ))}
    </div>
  )
}

/* ─── Typing dots ────────────────────────────────────────────────────── */
function TypingDots() {
  return (
    <div className="flex gap-1.5 items-center py-0.5">
      {[0, 150, 300].map((d) => (
        <div key={d} className="w-1.5 h-1.5 bg-[#a78bfa]/60 rounded-full animate-bounce"
          style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  )
}

/* ─── Chat bubble ────────────────────────────────────────────────────── */
function Bubble({ role, content, isFollowUp }) {
  const isBot = role === 'assistant'
  return (
    <div className={isBot ? 'flex gap-2.5 animate-slide-in' : 'flex gap-2.5 flex-row-reverse animate-slide-in-right'}>
      {isBot && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7c3aed]/20 border border-[#7c3aed]/30 flex items-center justify-center mt-0.5">
          <span className="font-syne font-bold text-[#a78bfa] text-[9px]">A</span>
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-[80%]">
        {isFollowUp && (
          <span className="self-end font-inter text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400/70 animate-fade-in">
            follow-up
          </span>
        )}
        <div className={`rounded-2xl px-3.5 py-2 font-inter text-xs leading-relaxed ${
          isBot
            ? 'bg-white/[0.05] border border-white/[0.07] text-white/80 rounded-tl-sm'
            : 'bg-[#7c3aed]/20 border border-[#7c3aed]/30 text-white/85 rounded-tr-sm'
        }`}>
          {content}
        </div>
      </div>
    </div>
  )
}

/* ─── Filler widget ──────────────────────────────────────────────────── */
function FillerWidget({ counts }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return null
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  return (
    <div className="absolute bottom-4 left-0 animate-fade-in z-10 pointer-events-none">
      <div className="bg-black/70 backdrop-blur-sm border border-white/[0.08] rounded-xl px-3 py-2.5 min-w-[110px]">
        <p className="font-inter text-[9px] text-white/30 uppercase tracking-widest mb-2">Fillers</p>
        {top.map(([word, count]) => (
          <div key={word} className="flex items-center justify-between gap-3 mb-1 last:mb-0">
            <span className="font-inter text-[11px] text-white/45">{word}</span>
            <span className="font-syne font-semibold text-[11px] text-[#a78bfa]">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Main page ──────────────────────────────────────────────────────── */
export default function InterviewPage() {
  const navigate            = useNavigate()
  const { token: inviteToken } = useParams()
  const location            = useLocation()

  const [tokenState, setTokenState]   = useState('verifying') // verifying | valid | invalid
  const [tokenError, setTokenError]   = useState(null)
  const [candidateName, setCandidateName] = useState('Candidate')

  const [status, setStatus]                       = useState(STATUS.THINKING)
  const [messages, setMessages]                   = useState([])
  const [exchanges, setExchanges]                 = useState(0)
  const [error, setError]                         = useState(null)
  const [complete, setComplete]                   = useState(false)
  const [hasCam, setHasCam]                       = useState(false)
  const [fillerCounts, setFillerCounts]           = useState({})
  const [followUpCount, setFollowUpCount]         = useState(0)
  const [recordingSeconds, setRecordingSeconds]   = useState(0)
  const [countdown, setCountdown]                 = useState(10)

  const recorderRef    = useRef(null)
  const chunksRef      = useRef([])
  const chatEndRef     = useRef(null)
  const pipVideoRef    = useRef(null)
  const camStreamRef   = useRef(null)
  const messagesRef    = useRef([])
  const audioCtxRef    = useRef(null)
  const analyserRef    = useRef(null)
  const animFrameRef   = useRef(null)
  const recordStartRef = useRef(null)
  const autoStopRef    = useRef(null)
  const recTimerRef    = useRef(null)
  const micBarRef      = useRef(null)
  const countdownRef   = useRef(null)

  useEffect(() => { messagesRef.current = messages }, [messages])

  /* ── Token verification ─────────────────────────────────────────── */
  useEffect(() => {
    if (!inviteToken) {
      setTokenState('invalid')
      setTokenError('No invite token in URL. Please use the link sent by your recruiter.')
      return
    }
    // Direct start from welcome page — no invite token needed
    if (inviteToken === 'direct') {
      const nameFromState = location.state?.candidateName
      if (!nameFromState) {
        // User navigated directly to /interview/direct without entering their name
        navigate('/', { replace: true })
        return
      }
      setCandidateName(nameFromState)
      setTokenState('valid')
      return
    }
    verifyInviteToken(inviteToken)
      .then((data) => {
        setCandidateName(data.candidate_name || 'Candidate')
        setTokenState('valid')
      })
      .catch((err) => {
        setTokenState('invalid')
        setTokenError(err.message || 'Invalid or expired invite link.')
      })
  }, [inviteToken]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Camera PIP ─────────────────────────────────────────────────── */
  useEffect(() => {
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        camStreamRef.current = stream
        setHasCam(true)
      } catch { setHasCam(false) }
    })()
    return () => camStreamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  useEffect(() => {
    if (hasCam && pipVideoRef.current && camStreamRef.current) {
      pipVideoRef.current.srcObject = camStreamRef.current
    }
  }, [hasCam])

  /* ── Auto-scroll ────────────────────────────────────────────────── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, status])

  /* ── Cleanup on unmount ─────────────────────────────────────────── */
  useEffect(() => () => {
    window.speechSynthesis?.cancel()
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    audioCtxRef.current?.close()
    clearInterval(recTimerRef.current)
    clearTimeout(autoStopRef.current)
    clearInterval(countdownRef.current)
  }, [])

  /* ── 10-second think countdown ─────────────────────────────────── */
  function startCountdown() {
    setCountdown(10)
    setStatus(STATUS.COUNTDOWN)
    clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current)
          startRecording()
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  /* ── Speak a reply ──────────────────────────────────────────────── */
  function speakReply(text) {
    setStatus(STATUS.SPEAKING)
    speakChunked(text, {
      onStart: () => setStatus(STATUS.SPEAKING),
      onPause: () => setStatus(STATUS.PAUSING),
      onEnd:   () => startCountdown(),
    })
  }

  /* ── Initial greeting ───────────────────────────────────────────── */
  useEffect(() => {
    if (tokenState !== 'valid') return
    const go = async () => {
      try {
        const { reply } = await sendChat([], candidateName)
        setMessages([{ role: 'assistant', content: reply }])
        speakReply(reply)
      } catch {
        setError('Unable to connect. Please check your internet connection and try again.')
        setStatus(STATUS.IDLE)
      }
    }
    const t = setTimeout(go, 200)
    return () => clearTimeout(t)
  }, [tokenState]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Audio level monitor ─────────────────────────────────────────── */
  function startLevelMonitor(stream) {
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      audioCtxRef.current  = ctx
      analyserRef.current  = analyser
      const data = new Uint8Array(analyser.frequencyBinCount)
      function tick() {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(data)
        const avg = data.reduce((a, b) => a + b, 0) / data.length
        const pct = Math.min(100, (avg / 80) * 100)
        if (micBarRef.current) micBarRef.current.style.width = pct + '%'
        animFrameRef.current = requestAnimationFrame(tick)
      }
      animFrameRef.current = requestAnimationFrame(tick)
    } catch { /* AudioContext not available — fail silently */ }
  }

  function stopLevelMonitor() {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
    if (audioCtxRef.current)  { audioCtxRef.current.close();               audioCtxRef.current  = null }
    analyserRef.current = null
    if (micBarRef.current) micBarRef.current.style.width = '0%'
  }

  /* ── Recording ──────────────────────────────────────────────────── */
  const startRecording = async () => {
    setError(null)
    window.speechSynthesis?.cancel()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount:    1,
          sampleRate:      16000,
          sampleSize:      16,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl:  true,
        },
      })

      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm' :
        'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        stopLevelMonitor()
        clearInterval(recTimerRef.current)
        clearTimeout(autoStopRef.current)

        const elapsed = Date.now() - recordStartRef.current
        if (elapsed < 1000) {
          setError('Please speak a bit longer.')
          setStatus(STATUS.IDLE)
          return
        }
        processRecording(new Blob(chunksRef.current, { type: recorder.mimeType }))
      }

      recorder.start(250)
      recorderRef.current  = recorder
      recordStartRef.current = Date.now()
      setRecordingSeconds(0)
      setStatus(STATUS.RECORDING)

      startLevelMonitor(stream)

      recTimerRef.current = setInterval(
        () => setRecordingSeconds((s) => s + 1),
        1000,
      )

      // Auto-stop after 60 s
      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop()
          setStatus(STATUS.PROCESSING)
        }
      }, 60_000)

    } catch {
      setError('Microphone access denied. Please allow mic access and try again.')
    }
  }

  const stopRecording = () => {
    clearInterval(recTimerRef.current)
    clearTimeout(autoStopRef.current)
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      setStatus(STATUS.PROCESSING)
    }
  }

  const toggleMic = () => {
    if (status === STATUS.COUNTDOWN) {
      clearInterval(countdownRef.current)
      startRecording()
    } else if (status === STATUS.IDLE) {
      startRecording()
    } else if (status === STATUS.RECORDING) {
      stopRecording()
    }
  }

  /* ── Transcribe → Chat → Speak ──────────────────────────────────── */
  const processRecording = async (blob) => {
    const currentMessages = messagesRef.current
    try {
      setStatus(STATUS.PROCESSING)
      const { transcript } = await transcribeAudio(blob)
      if (!transcript.trim() || transcript.trim().split(/\s+/).length < 3) {
        setError("Didn't catch that — could you speak again?")
        setStatus(STATUS.IDLE)
        return
      }

      setFillerCounts((prev) => mergeFillers(prev, countFillers(transcript)))

      const userMsg  = { role: 'user', content: transcript }
      const withUser = [...currentMessages, userMsg]
      setMessages(withUser)

      setStatus(STATUS.THINKING)
      const { reply, is_complete, is_followup } = await sendChat(withUser, candidateName)

      if (is_followup) setFollowUpCount((n) => n + 1)
      const updatedMessages = [...withUser, { role: 'assistant', content: reply, isFollowUp: is_followup }]
      setMessages(updatedMessages)

      const newExchanges = is_followup ? exchanges : exchanges + 1
      if (!is_followup) setExchanges(newExchanges)
      if (is_complete) setComplete(true)

      // Auto-trigger assessment when complete or hard limit reached
      const shouldEnd = is_complete || newExchanges >= 5
      const latestFollowUpCount = followUpCount + (is_followup ? 1 : 0)
      if (shouldEnd) {
        setStatus(STATUS.SPEAKING)
        speakChunked(reply, {
          onStart: () => setStatus(STATUS.SPEAKING),
          onPause: () => setStatus(STATUS.PAUSING),
          onEnd: () => {
            setTimeout(() => endInterview(updatedMessages, latestFollowUpCount), 800)
          },
        })
      } else {
        speakReply(reply)
      }
    } catch (err) {
      console.error('processRecording error:', err)
      setError('Something went wrong. Please try again.')
      setStatus(STATUS.IDLE)
    }
  }

  /* ── End interview ──────────────────────────────────────────────── */
  const endInterview = async (latestMessages, latestFollowUpCount) => {
    window.speechSynthesis?.cancel()
    setStatus(STATUS.ASSESSING)
    setError(null)
    const msgs   = latestMessages   ?? messagesRef.current
    const fuCount = latestFollowUpCount ?? followUpCount
    try {
      const assessment = await assessInterview(msgs, candidateName, fillerCounts, fuCount)
      sessionStorage.setItem('assessment',  JSON.stringify(assessment))
      sessionStorage.setItem('fillerWords', JSON.stringify(fillerCounts))
      sessionStorage.setItem('candidateId', String(assessment.id))
      if (inviteToken && inviteToken !== 'direct') {
        completeInviteToken(inviteToken, assessment.id).catch(() => {})
      }
      navigate('/report')
    } catch (err) {
      console.error('endInterview error:', err)
      setError('Failed to generate report. Please try ending the interview again.')
      setStatus(STATUS.IDLE)
    }
  }

  /* ── Derived ────────────────────────────────────────────────────── */
  const isSpeaking    = status === STATUS.SPEAKING
  const isPausing     = status === STATUS.PAUSING
  const isRecording   = status === STATUS.RECORDING
  const isThinking    = status === STATUS.THINKING || status === STATUS.ASSESSING
  const isCountdown   = status === STATUS.COUNTDOWN
  const canRecord     = status === STATUS.IDLE || status === STATUS.COUNTDOWN
  const showEnd       = (exchanges >= 4 || complete) && status !== STATUS.ASSESSING

  const statusText = {
    [STATUS.IDLE]:       'Tap to speak',
    [STATUS.COUNTDOWN]:  'Recording starts automatically…',
    [STATUS.RECORDING]:  'Recording…',
    [STATUS.PROCESSING]: 'Transcribing…',
    [STATUS.THINKING]:   'Anika is thinking…',
    [STATUS.SPEAKING]:   'Anika is speaking…',
    [STATUS.PAUSING]:    '…',
    [STATUS.ASSESSING]:  'Generating your report…',
  }[status]

  /* ── Token error / loading screens ──────────────────────────────── */
  if (tokenState === 'verifying') {
    return (
      <div className="h-screen bg-[#0a0a0f] flex items-center justify-center">
        <p className="font-inter text-white/30 text-sm animate-pulse">Verifying invite…</p>
      </div>
    )
  }

  if (tokenState === 'invalid') {
    return (
      <div className="h-screen bg-[#0a0a0f] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="font-syne font-bold text-white text-xl mb-2">Invalid Invite</h2>
          <p className="font-inter text-white/35 text-sm leading-relaxed">{tokenError}</p>
        </div>
      </div>
    )
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <>
      <style>{AVATAR_STYLE}</style>

      <div className="h-screen bg-[#0a0a0f] flex flex-col overflow-hidden">

        {/* ── Header ────────────────────────────────────────────── */}
        <header className="flex-shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-white/[0.05]">
          <div className="flex items-center gap-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse block" />
            <span className="font-syne font-semibold text-white/55 text-sm tracking-wide">Cuemath Screener</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/dashboard" className="font-inter text-white/20 text-xs hover:text-white/50 transition-colors">
              Dashboard
            </Link>
            <span className="font-inter text-white/20 text-sm">{candidateName}</span>
          </div>
        </header>

        {/* ── Avatar + name tag ─────────────────────────────────── */}
        <div className="flex-shrink-0 flex flex-col items-center pt-5 pb-1 relative">
          <AnikaAvatar speaking={isSpeaking} thinking={isThinking} />

          <div className="mt-3 flex items-center gap-2">
            <span className="font-syne font-semibold text-white/80 text-sm">Anika</span>
            <span className="w-1 h-1 rounded-full bg-white/20 block" />
            <span className="font-inter text-white/30 text-xs">Cuemath Interviewer</span>
            {isSpeaking && (
              <span className="ml-1 flex items-center gap-1 animate-fade-in">
                <WaveBars active height="12px" count={4} color="#a78bfa" />
              </span>
            )}
          </div>

          {/* Candidate PIP */}
          {hasCam && (
            <div className="absolute top-2 right-4 w-[68px] aspect-video rounded-xl overflow-hidden ring-1 ring-white/15 shadow-lg bg-black">
              <video ref={pipVideoRef} autoPlay muted playsInline className="w-full h-full object-cover scale-x-[-1]" />
            </div>
          )}
        </div>

        {/* ── Chat transcript ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-1 space-y-2.5 min-h-0 relative">
          <FillerWidget counts={fillerCounts} />

          {messages.length === 0 && status === STATUS.THINKING && (
            <div className="flex gap-2.5 animate-slide-in">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7c3aed]/20 border border-[#7c3aed]/30 flex items-center justify-center mt-0.5">
                <span className="font-syne font-bold text-[#a78bfa] text-[9px]">A</span>
              </div>
              <div className="bg-white/[0.05] border border-white/[0.07] rounded-2xl rounded-tl-sm px-3.5 py-2">
                <TypingDots />
              </div>
            </div>
          )}

          {messages.map((msg, i) => <Bubble key={i} role={msg.role} content={msg.content} isFollowUp={msg.isFollowUp} />)}

          {isThinking && messages.length > 0 && (
            <div className="flex gap-2.5 animate-slide-in">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-[#7c3aed]/20 border border-[#7c3aed]/30 flex items-center justify-center mt-0.5">
                <span className="font-syne font-bold text-[#a78bfa] text-[9px]">A</span>
              </div>
              <div className="bg-white/[0.05] border border-white/[0.07] rounded-2xl rounded-tl-sm px-3.5 py-2">
                <TypingDots />
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* ── Controls ──────────────────────────────────────────── */}
        <div className="flex-shrink-0 border-t border-white/[0.05] px-5 py-4">
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-4">

              {/* Mic button */}
              <div className="relative flex-shrink-0">
                {isRecording && (
                  <>
                    <span className="absolute inset-0 w-14 h-14 rounded-full bg-[#7c3aed]/30 animate-pulse-ring" />
                    <span className="absolute inset-0 w-14 h-14 rounded-full bg-[#7c3aed]/15 animate-pulse-ring-slow" />
                  </>
                )}

                {/* Countdown ring */}
                {isCountdown && (
                  <svg className="absolute -inset-2 w-[72px] h-[72px] -rotate-90" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(167,139,250,0.15)" strokeWidth="3" />
                    <circle
                      cx="36" cy="36" r="32" fill="none"
                      stroke="#a78bfa" strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 32}`}
                      strokeDashoffset={`${2 * Math.PI * 32 * (1 - countdown / 10)}`}
                      style={{ transition: 'stroke-dashoffset 0.9s linear' }}
                    />
                  </svg>
                )}

                {/* Countdown number badge */}
                {isCountdown && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-syne font-bold text-[#a78bfa] text-sm tabular-nums leading-none animate-fade-in">
                    {countdown}
                  </span>
                )}

                <button
                  onClick={toggleMic}
                  disabled={!canRecord && !isRecording}
                  aria-label={isRecording ? 'Stop recording' : isCountdown ? 'Start now' : 'Start recording'}
                  className={`relative z-10 w-14 h-14 rounded-full flex items-center justify-center border transition-all duration-300
                    ${isRecording
                      ? 'bg-[#7c3aed] border-[#7c3aed]/60 shadow-[0_0_40px_rgba(124,58,237,0.5)] scale-110'
                      : isCountdown
                        ? 'bg-[#7c3aed]/20 border-[#a78bfa]/50 hover:bg-[#7c3aed]/35 cursor-pointer animate-pulse'
                        : canRecord
                          ? 'bg-white/[0.06] border-white/[0.10] hover:bg-white/[0.10] hover:border-[#7c3aed]/40 hover:shadow-[0_0_24px_rgba(124,58,237,0.3)] hover:scale-105 cursor-pointer'
                          : 'bg-white/[0.03] border-white/[0.07] cursor-not-allowed'
                    }`}
                >
                  {isRecording ? (
                    <span className="w-5 h-5 bg-white rounded-sm" />
                  ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
                      stroke={isCountdown ? '#a78bfa' : canRecord ? 'white' : 'rgba(255,255,255,0.18)'}
                      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="1" width="6" height="11" rx="3" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="23" />
                      <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Status */}
              <div className="flex flex-col gap-1.5 min-w-0">
                {isRecording && (
                  <div className="flex items-center gap-2.5">
                    <WaveBars active height="20px" count={5} />
                    <span className="font-mono text-[11px] text-[#a78bfa]/70 tabular-nums">
                      {formatTime(recordingSeconds)} / 1:00
                    </span>
                  </div>
                )}
                {isRecording && (
                  <div className="w-36 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      ref={micBarRef}
                      className="h-full bg-[#a78bfa] rounded-full"
                      style={{ width: '0%', transition: 'width 80ms ease' }}
                    />
                  </div>
                )}
                <p className={`font-inter text-sm transition-colors duration-300 ${
                  isRecording   ? 'text-[#a78bfa]'
                  : isCountdown ? 'text-amber-400/70'
                  : isSpeaking  ? 'text-white/40'
                  : isThinking  ? 'text-white/25'
                  : 'text-white/45'
                }`}>
                  {statusText}
                </p>
              </div>

              {showEnd && (
                <button
                  onClick={() => endInterview(messagesRef.current, followUpCount)}
                  className="ml-auto px-3.5 py-1.5 border border-white/[0.12] text-white/35
                             hover:text-white hover:border-white/25 font-inter text-[11px]
                             rounded-lg transition-all duration-300 flex-shrink-0 animate-fade-in"
                >
                  End &amp; Report
                </button>
              )}
            </div>

            {error && (
              <p className="font-inter text-red-400/75 text-[11px] text-center max-w-xs animate-fade-in leading-relaxed">
                {error}
              </p>
            )}

            <p className="font-inter text-[10px]" style={{ color: 'rgba(255,255,255,0.15)' }}>
              {exchanges === 0 ? 'Interview in progress' : `${exchanges} of 6 exchanges`}
              {complete ? ' · Complete' : ''}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
