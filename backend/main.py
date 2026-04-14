import os
import re
import json
import uuid
import asyncio
import logging
import httpx
import datetime as dt

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, field_validator, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
import resend
import anthropic
from sqlalchemy import create_engine, Column, Integer, String, Float, Text, DateTime, text
from sqlalchemy.orm import declarative_base, Session
import bcrypt
from jose import JWTError, jwt

load_dotenv()

ANTHROPIC_API_KEY   = os.getenv("ANTHROPIC_API_KEY")
GROQ_API_KEY        = os.getenv("GROQ_API_KEY")
RESEND_API_KEY      = os.getenv("RESEND_API_KEY")
RECRUITER_EMAIL     = os.getenv("RECRUITER_EMAIL")
JWT_SECRET          = os.getenv("JWT_SECRET", "")
DEFAULT_HR_EMAIL    = os.getenv("DEFAULT_HR_EMAIL", "hr@cuemath.com")
DEFAULT_HR_PASSWORD = os.getenv("DEFAULT_HR_PASSWORD", "cuemath123")
ALLOWED_ORIGINS     = os.getenv("ALLOWED_ORIGINS", "*")

if not ANTHROPIC_API_KEY:
    raise RuntimeError("ANTHROPIC_API_KEY is not set")
if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set")
if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set — refusing to start without a secure secret")

anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Auth setup ────────────────────────────────────────────────────────
security         = HTTPBearer()
JWT_ALGO         = "HS256"
JWT_EXPIRY_HOURS = 24

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, email: str) -> str:
    expire = dt.datetime.utcnow() + dt.timedelta(hours=JWT_EXPIRY_HOURS)
    return jwt.encode({"sub": user_id, "email": email, "exp": expire}, JWT_SECRET, algorithm=JWT_ALGO)


# ── Database setup ────────────────────────────────────────────────────
Base = declarative_base()

_db_url = os.getenv("DATABASE_URL", "sqlite:///./candidates.db")
# SQLAlchemy requires 'postgresql+psycopg2://' but Neon/Render give 'postgres://'
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql+psycopg2://", 1)
elif _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

_is_sqlite = _db_url.startswith("sqlite")
engine = create_engine(
    _db_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {"connect_timeout": 10},
    # PostgreSQL pool settings — keep within Neon free tier limits
    pool_size=3 if not _is_sqlite else 5,
    max_overflow=2 if not _is_sqlite else 10,
    pool_pre_ping=True,   # verify connections before use
    pool_recycle=300,     # recycle connections every 5 min
)

class User(Base):
    __tablename__ = "users"
    id            = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email         = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    name          = Column(String, nullable=False)
    role          = Column(String, default="hr")   # admin | hr
    created_at    = Column(DateTime, default=dt.datetime.utcnow)

class InviteToken(Base):
    __tablename__ = "invite_tokens"
    id              = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    token           = Column(String, unique=True, nullable=False, index=True)
    candidate_name  = Column(String, nullable=False)
    candidate_email = Column(String, nullable=True)
    created_by      = Column(String, nullable=False)   # FK → users.id
    created_at      = Column(DateTime, default=dt.datetime.utcnow)
    expires_at      = Column(DateTime, nullable=False)
    status          = Column(String, default="pending")  # pending | completed | expired
    candidate_id    = Column(Integer, nullable=True)     # FK → candidates.id

class Candidate(Base):
    __tablename__ = "candidates"
    id                = Column(Integer, primary_key=True, index=True)
    candidate_name    = Column(String, nullable=False)
    date              = Column(DateTime, default=dt.datetime.utcnow)
    clarity           = Column(Float)
    warmth            = Column(Float)
    simplicity        = Column(Float)
    fluency           = Column(Float)
    confidence        = Column(Float)
    follow_up_count   = Column(Integer, default=0)
    recommendation    = Column(String)
    summary           = Column(Text)
    key_quotes_json   = Column(Text)   # JSON array string
    filler_words_json = Column(Text)   # JSON object string

Base.metadata.create_all(bind=engine)

# Migrate existing SQLite DB — safe to skip on Postgres (tables created fresh)
if _is_sqlite:
    with engine.connect() as _conn:
        for _sql in [
            "ALTER TABLE candidates ADD COLUMN confidence FLOAT",
            "ALTER TABLE candidates ADD COLUMN follow_up_count INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'hr'",
        ]:
            try:
                _conn.execute(text(_sql))
                _conn.commit()
            except Exception:
                pass  # Column already exists — safe to ignore

# Seed default admin account; also ensure the first user is always admin
def seed_default_hr():
    with Session(engine) as session:
        existing = session.query(User).filter(User.email == DEFAULT_HR_EMAIL).first()
        if not existing:
            user = User(
                id=str(uuid.uuid4()),
                email=DEFAULT_HR_EMAIL,
                password_hash=hash_password(DEFAULT_HR_PASSWORD),
                name="HR Admin",
                role="admin",
            )
            session.add(user)
            session.commit()
            logger.info("Default admin account created: %s", DEFAULT_HR_EMAIL)
        elif existing.role != "admin":
            existing.role = "admin"
            session.commit()

seed_default_hr()


# ── Anthropic retry helper ────────────────────────────────────────────
async def anthropic_create_with_retry(max_retries=4, **kwargs):
    """Call Anthropic with async exponential backoff on 529 overloaded errors."""
    delay = 2
    for attempt in range(max_retries):
        try:
            return anthropic_client.messages.create(**kwargs)
        except anthropic.APIStatusError as e:
            if e.status_code == 529 and attempt < max_retries - 1:
                logger.warning("Anthropic overloaded (529), retrying in %ds (attempt %d/%d)", delay, attempt + 1, max_retries)
                await asyncio.sleep(delay)
                delay *= 2
            else:
                raise
    raise HTTPException(status_code=503, detail="AI service temporarily unavailable — please try again")


# ── Auth dependencies ─────────────────────────────────────────────────
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> User:
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id: str = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user

def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


app = FastAPI(title="Tutor Screener API")

_origins = [o.strip() for o in ALLOWED_ORIGINS.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

INTERVIEWER_SYSTEM_PROMPT = """You are Anika, a warm and sharp interviewer at Cuemath, screening candidates who want to teach math to children aged 6-14. You have been doing this for years and you are excellent at reading people.

Your goal is a SHORT, focused conversation — 5 exchanges maximum — that reveals whether this person has the right qualities to be a great tutor.

HARD LIMITS — NEVER BREAK THESE:

LIMIT 1 — FOLLOW-UP CAP
- You may ask AT MOST 1 follow-up in the entire interview — not per question, for the whole conversation
- Once you have asked one follow-up anywhere, never ask another one, no matter what
- After getting any follow-up answer, move on immediately to a new topic

LIMIT 2 — QUESTION COUNT
- Maximum 5 questions total (including any follow-up)
- Count every question you ask — after the 5th, wrap up immediately
- At exchanges 4 and 5, be actively looking to wrap up

LIMIT 3 — WHEN TO ACCEPT AND MOVE ON
- If the answer is 2+ sentences and makes any sense — accept it and move on, no follow-up
- Only use your one allowed follow-up if the answer is literally one word or a single content-free sentence like "I would help them" or "I would be patient"
- Any answer that shows real thought — even briefly — is enough. Move on.

LIMIT 4 — HARD STOP AT 5 EXCHANGES
- After the candidate's 5th answer, you MUST wrap up immediately
- Say warmly: "This has been really helpful — I've got a great sense of who you are. We'll be in touch soon!"
- End that message with exactly this token on its own line: [INTERVIEW_COMPLETE]
- Do not ask another question, do not invite further discussion

PACING RULE
- After every 2 questions, check: have I covered enough ground to assess this person? If yes, wrap up now
- Prioritise breadth (covering different topics) over depth (digging into one topic)
- A real screening interview has a time limit — move with purpose

HOW YOU CONDUCT THE INTERVIEW:

1. REACT first, then transition
   - Always acknowledge what they said with one short reaction sentence before your next question
   - React like a human: "Oh that's great", "I love that", "Makes sense"
   - Keep reactions to one sentence max

2. NATURAL TRANSITIONS
   - Move between topics fluidly: "That makes sense. Let me ask you something different — ..."
   - Never say "Next question" or "Moving on to question 3"

3. TOPICS TO COVER (pick 4-5 across the conversation — don't try to hit all of them):
   - Why they want to teach and what draws them to kids
   - How they explain a difficult concept simply
   - How they handle a struggling or frustrated student
   - How they keep a disengaged student interested
   - Their confidence and energy in a real session

4. OPTIONAL SCENARIO (use at most 1, only if conversation allows):
   - "A student has been stuck on the same problem for 10 minutes and is getting upset. What do you do?"
   - "You're explaining fractions and nothing is working. Walk me through your next move."

5. WRAPPING UP
   - When you decide to wrap up (by exchange 4-5), say it warmly and end with [INTERVIEW_COMPLETE]
   - Wrap-up line: "This has been really helpful — I've got a great sense of who you are. We'll be in touch soon!"

TONE AND STYLE:
- Sound like a real person, not an HR bot
- Use contractions: "you're", "I'm", "that's", "don't"
- Keep every response to 2 sentences maximum — reaction + question, that's it
- BAD: "Oh that's really interesting and I love that approach — so tell me, how do you handle it when a student just refuses to engage no matter what you try?"
- GOOD: "Oh I love that. When a student completely shuts down — what do you do first?"
- Never use bullet points or numbered lists
- Never say "Great question"

WHAT YOU ARE EVALUATING (never say this out loud):
- Clarity: can they explain things simply and precisely?
- Warmth: do they genuinely care about kids?
- Patience: how do they talk about difficult students?
- Confidence: do they sound sure of themselves?
- Fluency: are they comfortable and articulate in English?

START THE INTERVIEW:
Begin warm and human. Example:
"Hey, really glad you could make it! Before we get into anything formal — what made you want to get into teaching?"

REMEMBER: 5 questions maximum, 1 follow-up maximum, wrap up by exchange 5 without fail."""

ASSESSMENT_SYSTEM_PROMPT = """You are a senior talent evaluator at Cuemath. You have just observed a screening interview of a tutor candidate. Your job is to produce a structured, honest assessment.

Evaluate the candidate on FIVE dimensions, each scored 1-10:
- clarity: How clearly and precisely do they communicate?
- warmth: Do they show genuine care and empathy for children?
- simplicity: Can they break down ideas without jargon or over-complication?
- fluency: How confident, articulate, and fluent is their English?
- confidence: Do they sound sure of themselves? Do they hedge excessively ("I think maybe...", "I'm not sure but...")? Do they give direct answers or trail off? Do they self-correct frequently?
  Confidence scoring guide:
  1-3: Heavily hedged throughout, lots of "um I think maybe", trails off, no conviction
  4-6: Some confidence but inconsistent, hedges on harder questions
  7-9: Clear and direct, sounds like they believe what they're saying
  10: Commanding presence, zero unnecessary hedging, every answer lands

RECOMMENDATION LOGIC — use holistic judgment with these nudges:
- If confidence < 4 AND follow_up_count > 3: lean toward Reject
- If confidence > 7: this is a meaningful boost toward Pass even if other scores are mid
- Otherwise weigh all five scores equally

Then give an overall recommendation:
- "Pass" — strong candidate, move to next round
- "Review" — borderline, needs human review
- "Reject" — does not meet the bar

Also write a concise one-paragraph summary of the candidate's performance.

Select 3-4 key quotes directly from the candidate's responses (exact words) that best support your assessment — both strengths and weaknesses.

Write one sentence explaining the confidence score specifically (what you observed that led to that score).

You MUST respond with valid JSON only, in exactly this structure:
{
  "scores": {
    "clarity": <int 1-10>,
    "warmth": <int 1-10>,
    "simplicity": <int 1-10>,
    "fluency": <int 1-10>,
    "confidence": <int 1-10>
  },
  "recommendation": "<Pass|Review|Reject>",
  "summary": "<one paragraph>",
  "key_quotes": [
    "<exact quote 1>",
    "<exact quote 2>",
    "<exact quote 3>",
    "<exact quote 4 optional>"
  ],
  "confidence_notes": "<one sentence explaining the confidence score>"
}

Be rigorous and fair. Do not inflate scores. A score of 7+ should mean genuinely impressive performance."""


# ── Pydantic models ───────────────────────────────────────────────────
class ChatRequest(BaseModel):
    messages:       list[dict] = Field(default_factory=list)
    candidate_name: str        = Field(default="Candidate", min_length=1, max_length=100)

    @field_validator("messages")
    @classmethod
    def validate_messages(cls, v):
        if len(v) > 20:
            raise ValueError("Too many messages")
        for m in v:
            if not isinstance(m.get("role"), str) or not isinstance(m.get("content"), str):
                raise ValueError("Each message must have 'role' and 'content' strings")
            if m["role"] not in ("user", "assistant"):
                raise ValueError("Message role must be 'user' or 'assistant'")
            if len(m["content"]) > 4000:
                raise ValueError("Message content too long")
        return v

class AssessRequest(BaseModel):
    messages:        list[dict] = Field(default_factory=list)
    candidate_name:  str        = Field(default="Candidate", min_length=1, max_length=100)
    filler_words:    dict       = Field(default_factory=dict)
    follow_up_count: int        = Field(default=0, ge=0, le=20)

class LoginRequest(BaseModel):
    email:    str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v):
        return v.lower().strip()

class CreateInviteRequest(BaseModel):
    candidate_name:  str       = Field(min_length=1, max_length=100)
    candidate_email: str | None = Field(default=None, max_length=254)

    @field_validator("candidate_name")
    @classmethod
    def strip_name(cls, v):
        return v.strip()

class CreateHRRequest(BaseModel):
    name:     str = Field(min_length=1,  max_length=100)
    email:    str = Field(min_length=3,  max_length=254)
    password: str = Field(min_length=8,  max_length=128)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, v):
        return v.lower().strip()

    @field_validator("name")
    @classmethod
    def strip_name(cls, v):
        return v.strip()


# ── Helpers ───────────────────────────────────────────────────────────
def candidate_to_dict(c: Candidate) -> dict:
    return {
        "id":              c.id,
        "candidate_name":  c.candidate_name,
        "date":            c.date.isoformat() if c.date else None,
        "scores": {
            "clarity":    c.clarity,
            "warmth":     c.warmth,
            "simplicity": c.simplicity,
            "fluency":    c.fluency,
            "confidence": c.confidence,
        },
        "follow_up_count": c.follow_up_count or 0,
        "recommendation":  c.recommendation,
        "summary":         c.summary,
        "key_quotes":      json.loads(c.key_quotes_json)   if c.key_quotes_json   else [],
        "filler_words":    json.loads(c.filler_words_json) if c.filler_words_json else {},
    }

def invite_to_dict(t: InviteToken, creator_name: str | None = None) -> dict:
    now = dt.datetime.utcnow()
    status = t.status
    if status == "pending" and t.expires_at < now:
        status = "expired"
    return {
        "id":               t.id,
        "token":            t.token,
        "candidate_name":   t.candidate_name,
        "candidate_email":  t.candidate_email,
        "created_by":       t.created_by,
        "created_by_name":  creator_name,
        "created_at":       t.created_at.isoformat() if t.created_at else None,
        "expires_at":       t.expires_at.isoformat() if t.expires_at else None,
        "status":           status,
        "candidate_id":     t.candidate_id,
    }


def build_email_html(candidate_name: str, date_str: str, assessment: dict, filler_words: dict, follow_up_count: int = 0) -> str:
    rec = assessment.get("recommendation", "Review")
    rec_colors = {"Pass": "#34d399", "Review": "#fbbf24", "Reject": "#f87171"}
    rec_color  = rec_colors.get(rec, "#a78bfa")
    scores     = assessment.get("scores", {})
    summary    = assessment.get("summary", "")
    quotes     = assessment.get("key_quotes", [])

    scores_html = "".join(
        f'<tr><td style="padding:6px 0;color:#94a3b8;font-size:14px;">{k.capitalize()}</td>'
        f'<td style="padding:6px 0;color:#e2e8f0;font-size:14px;font-weight:600;text-align:right;">{v}/10</td></tr>'
        for k, v in scores.items()
    )

    quotes_html = "".join(
        f'<p style="margin:8px 0;padding:10px 14px;background:#1e1b4b;border-left:3px solid #7c3aed;'
        f'color:#cbd5e1;font-size:13px;font-style:italic;border-radius:0 6px 6px 0;">"{q}"</p>'
        for q in quotes
    )

    confidence_notes = assessment.get("confidence_notes", "")
    confidence_html = ""
    if confidence_notes:
        confidence_html = f"""
        <div style="margin-top:16px;padding:10px 14px;background:#0c1a36;border-left:3px solid #3b82f6;border-radius:0 6px 6px 0;">
          <p style="margin:0;color:#93c5fd;font-size:13px;font-style:italic;">{confidence_notes}</p>
        </div>"""

    followup_html = ""
    if follow_up_count:
        followup_html = f"""
        <div style="margin-top:16px;padding:10px 14px;background:#1c1917;border-radius:8px;">
          <p style="margin:0;color:#94a3b8;font-size:13px;">Follow-up questions needed: <strong style="color:#fbbf24;">{follow_up_count}</strong></p>
        </div>"""

    fillers_html = ""
    if filler_words:
        items = "".join(
            f'<span style="display:inline-block;margin:3px;padding:4px 10px;background:#312e81;'
            f'color:#a5b4fc;border-radius:20px;font-size:12px;">{k}: {v}</span>'
            for k, v in sorted(filler_words.items(), key=lambda x: -x[1])
        )
        fillers_html = f"""
        <div style="margin-top:24px;">
          <h3 style="color:#94a3b8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Filler Words</h3>
          <div>{items}</div>
        </div>"""

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
    <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:32px 32px 24px;">
      <p style="margin:0 0 4px;color:#ddd6fe;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Cuemath AI Screener</p>
      <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">{candidate_name}</h1>
      <p style="margin:6px 0 0;color:#c4b5fd;font-size:13px;">{date_str}</p>
    </div>
    <div style="padding:28px 32px;">
      <div style="text-align:center;padding:20px;background:#0f172a;border-radius:12px;margin-bottom:24px;">
        <p style="margin:0 0 4px;color:#64748b;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">Recommendation</p>
        <p style="margin:0;color:{rec_color};font-size:40px;font-weight:800;">{rec}</p>
      </div>
      <h3 style="color:#94a3b8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Scores</h3>
      <table style="width:100%;border-collapse:collapse;">{scores_html}</table>
      <div style="margin-top:24px;">
        <h3 style="color:#94a3b8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Summary</h3>
        <p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.6;">{summary}</p>
      </div>
      {confidence_html}
      {followup_html}
      {f'<div style="margin-top:24px;"><h3 style="color:#94a3b8;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Key Quotes</h3>{quotes_html}</div>' if quotes else ''}
      {fillers_html}
    </div>
    <div style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
      <p style="margin:0;color:#475569;font-size:12px;">Cuemath AI Tutor Screener · Automated Report</p>
    </div>
  </div>
</body></html>"""


def send_report_email(candidate_name: str, date_str: str, assessment: dict, filler_words: dict, follow_up_count: int = 0):
    """Fire-and-forget email via Resend (runs in BackgroundTasks thread pool)."""
    if not RESEND_API_KEY or not RECRUITER_EMAIL:
        return
    html = build_email_html(candidate_name, date_str, assessment, filler_words, follow_up_count)
    try:
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": "Cuemath AI Screener <onboarding@resend.dev>",
            "to": RECRUITER_EMAIL,
            "subject": f"Interview Report — {candidate_name} — {date_str}",
            "html": html,
        })
    except Exception:
        pass  # Email failure must never crash the API


# ── Routes ────────────────────────────────────────────────────────────
@app.get("/")
def health_check():
    return {"status": "ok", "service": "tutor-screener-api"}


# ── Auth routes ───────────────────────────────────────────────────────
@app.post("/auth/login")
def login(req: LoginRequest):
    with Session(engine) as session:
        user = session.query(User).filter(User.email == req.email).first()
        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        token = create_access_token(user.id, user.email)
        return {
            "access_token": token,
            "token_type": "bearer",
            "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role},
        }


@app.get("/auth/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email, "name": current_user.name, "role": current_user.role}


# ── Invite routes ─────────────────────────────────────────────────────
def send_invite_email(candidate_name: str, candidate_email: str, invite_link: str, expires_at: dt.datetime):
    """Send the invite link to the candidate via Resend."""
    if not RESEND_API_KEY or not candidate_email:
        return
    expires_str = expires_at.strftime("%B %d, %Y at %I:%M %p UTC")
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:'Inter',Arial,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:#1e293b;border-radius:16px;overflow:hidden;border:1px solid #334155;">
    <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:32px 32px 24px;">
      <p style="margin:0 0 4px;color:#ddd6fe;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;">Cuemath · Tutor Screening</p>
      <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">You're invited, {candidate_name.split()[0]}!</h1>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#cbd5e1;font-size:15px;line-height:1.6;">
        You've been invited to complete a short AI voice interview for a tutor position at <strong style="color:#a78bfa;">Cuemath</strong>.
      </p>
      <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;">
        The interview is about 8 minutes long. Speak naturally — we're assessing communication, warmth, and teaching instinct.
      </p>
      <div style="margin:28px 0;text-align:center;">
        <a href="{invite_link}"
           style="display:inline-block;background:#7c3aed;color:#ffffff;font-size:15px;font-weight:600;
                  padding:14px 36px;border-radius:12px;text-decoration:none;
                  box-shadow:0 0 32px rgba(124,58,237,0.45);">
          Start Interview →
        </a>
      </div>
      <p style="margin:0;color:#475569;font-size:12px;text-align:center;">
        Link expires {expires_str}. It can only be used once.
      </p>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #334155;text-align:center;">
      <p style="margin:0;color:#475569;font-size:12px;">Cuemath AI Tutor Screener · Automated Invite</p>
    </div>
  </div>
</body></html>"""
    try:
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": "Cuemath AI Screener <onboarding@resend.dev>",
            "to": candidate_email,
            "subject": f"Your Cuemath interview invite, {candidate_name.split()[0]}",
            "html": html,
        })
    except Exception:
        pass  # Email failure must never crash the API


FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:5175")


@app.post("/invites/create")
def create_invite(req: CreateInviteRequest, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    token_value = str(uuid.uuid4())
    expires_at  = dt.datetime.utcnow() + dt.timedelta(hours=48)
    invite = InviteToken(
        id=str(uuid.uuid4()),
        token=token_value,
        candidate_name=req.candidate_name.strip(),
        candidate_email=req.candidate_email,
        created_by=current_user.id,
        expires_at=expires_at,
        status="pending",
    )
    with Session(engine) as session:
        session.add(invite)
        session.commit()
        session.refresh(invite)
        result = invite_to_dict(invite)

    if req.candidate_email:
        invite_link = f"{FRONTEND_BASE_URL}/interview/{token_value}"
        background_tasks.add_task(
            send_invite_email,
            req.candidate_name.strip(),
            req.candidate_email,
            invite_link,
            expires_at,
        )

    return result


@app.get("/invites/list")
def list_invites(current_user: User = Depends(get_current_user)):
    now = dt.datetime.utcnow()
    with Session(engine) as session:
        # Admins see all; regular HR see only their own
        query = session.query(InviteToken).order_by(InviteToken.created_at.desc())
        if current_user.role != "admin":
            query = query.filter(InviteToken.created_by == current_user.id)
        invites = query.all()

        # Build creator name lookup
        creator_ids = {inv.created_by for inv in invites}
        creators = {u.id: u.name for u in session.query(User).filter(User.id.in_(creator_ids)).all()}

        # Auto-mark expired tokens
        for inv in invites:
            if inv.status == "pending" and inv.expires_at < now:
                inv.status = "expired"
        session.commit()
        return [invite_to_dict(inv, creators.get(inv.created_by)) for inv in invites]


# ── HR management routes (admin only) ─────────────────────────────────
@app.get("/hr/list")
def list_hr(current_user: User = Depends(get_current_admin)):
    with Session(engine) as session:
        users = session.query(User).order_by(User.created_at).all()
        return [
            {
                "id":         u.id,
                "name":       u.name,
                "email":      u.email,
                "role":       u.role,
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in users
        ]


@app.post("/hr/create")
def create_hr(req: CreateHRRequest, current_user: User = Depends(get_current_admin)):
    email = req.email.lower().strip()
    with Session(engine) as session:
        if session.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            password_hash=hash_password(req.password),
            name=req.name.strip(),
            role="hr",
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return {"id": user.id, "name": user.name, "email": user.email, "role": user.role,
                "created_at": user.created_at.isoformat() if user.created_at else None}


@app.delete("/hr/{user_id}")
def delete_hr(user_id: str, current_user: User = Depends(get_current_admin)):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        session.delete(user)
        session.commit()
    return {"status": "deleted"}


@app.get("/invites/verify/{token}")
def verify_invite(token: str):
    """Public — called by candidate to check token validity before interview starts."""
    now = dt.datetime.utcnow()
    with Session(engine) as session:
        inv = session.query(InviteToken).filter(InviteToken.token == token).first()
        if not inv:
            raise HTTPException(status_code=404, detail="Invite not found")
        if inv.status == "completed":
            raise HTTPException(status_code=410, detail="This invite has already been used")
        if inv.status == "expired" or inv.expires_at < now:
            if inv.status != "expired":
                inv.status = "expired"
                session.commit()
            raise HTTPException(status_code=410, detail="This invite link has expired")
        return {"valid": True, "candidate_name": inv.candidate_name}


@app.post("/invites/complete/{token}")
def complete_invite(token: str, candidate_id: int | None = None):
    """Public — called after interview finishes to mark token as used."""
    now = dt.datetime.utcnow()
    with Session(engine) as session:
        inv = session.query(InviteToken).filter(InviteToken.token == token).first()
        if not inv:
            raise HTTPException(status_code=404, detail="Invite not found")
        if inv.expires_at < now:
            inv.status = "expired"
            session.commit()
            raise HTTPException(status_code=410, detail="Invite expired")
        inv.status = "completed"
        if candidate_id is not None:
            inv.candidate_id = candidate_id
        session.commit()
        return {"status": "completed"}




# ── Transcription ─────────────────────────────────────────────────────
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB

@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """Receive an audio file, transcribe it via Groq Whisper, return transcript."""
    audio_bytes = await audio.read()
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio file too large (max 10 MB)")
    filename    = audio.filename or "audio.webm"

    content_type = (audio.content_type or "audio/webm").split(";")[0]

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {GROQ_API_KEY}"},
            files={"file": (filename, audio_bytes, content_type)},
            data={
                "model":           "whisper-large-v3",
                "language":        "en",
                "response_format": "verbose_json",
                "temperature":     "0",
                "prompt":          "Cuemath tutor interview. Spoken English.",
            },
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Groq transcription failed: {response.text}",
        )

    result     = response.json()
    transcript = result.get("text", "").strip()

    # Strip Whisper prompt hallucinations — Whisper sometimes copies the prompt
    # verbatim into the transcript when audio is unclear or silent
    _hallucination_patterns = [
        r"(?i)cuemath tutor interview[\.,]?\s*spoken english[\.,]?\s*",
        r"(?i)this is a job interview for a math tutoring position at cuemath[\.,]?\s*",
        r"(?i)the candidate is answering questions about teaching children aged 6 to 14[\.,]?\s*",
    ]
    for _pat in _hallucination_patterns:
        transcript = re.sub(_pat, "", transcript).strip()
    return {"transcript": transcript}


MAX_EXCHANGES = 5

@app.post("/chat")
async def chat(req: ChatRequest):
    # Count how many user turns have happened (= number of candidate answers so far)
    user_turns = sum(1 for m in req.messages if m["role"] == "user")

    # Hard limit: if the candidate has already answered 5 times, end immediately
    if user_turns >= MAX_EXCHANGES:
        wrap_up = "This has been really helpful — I've got a great sense of who you are. We'll be in touch soon!"
        return {"reply": wrap_up, "is_complete": True, "is_followup": False}

    system_prompt = (
        INTERVIEWER_SYSTEM_PROMPT
        + f"\n\nThe candidate's name is {req.candidate_name}."
        + f"\n\nCURRENT EXCHANGE COUNT: The candidate has answered {user_turns} question(s) so far. "
        + f"You have {MAX_EXCHANGES - user_turns} exchange(s) remaining before the interview must end. "
        + ("WRAP UP NOW — this is the last exchange." if user_turns == MAX_EXCHANGES - 1 else "")
    )

    raw = req.messages if req.messages else [
        {"role": "user", "content": "Please begin the interview with a warm, personalised greeting."}
    ]
    messages = [{"role": m["role"], "content": m["content"]} for m in raw]

    response = await anthropic_create_with_retry(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        system=system_prompt,
        messages=messages,
    )

    reply_text  = response.content[0].text
    is_complete = "[INTERVIEW_COMPLETE]" in reply_text
    is_followup = "[FOLLOW_UP]" in reply_text
    clean_reply = reply_text.replace("[INTERVIEW_COMPLETE]", "").replace("[FOLLOW_UP]", "").strip()

    # Safety net: if on the last exchange and Claude forgot to end, force completion
    if user_turns == MAX_EXCHANGES - 1 and not is_complete:
        is_complete = True

    return {"reply": clean_reply, "is_complete": is_complete, "is_followup": is_followup}


@app.post("/assess")
async def assess(req: AssessRequest, background_tasks: BackgroundTasks):
    conversation_text = "\n".join(
        f"{'Interviewer' if m['role'] == 'assistant' else req.candidate_name}: {m['content']}"
        for m in req.messages
    )

    context_notes = []
    if req.filler_words:
        filler_list = ", ".join(f'"{k}" ({v}x)' for k, v in req.filler_words.items())
        context_notes.append(f"Filler word counts: {filler_list}. Factor this into the fluency score.")
    if req.follow_up_count:
        context_notes.append(
            f"The interviewer had to ask {req.follow_up_count} follow-up question(s) to get adequate answers "
            f"(candidate gave vague or very short initial responses). Factor this into your holistic assessment."
        )

    extra = ("\n\n" + "\n".join(context_notes)) if context_notes else ""

    user_prompt = (
        f"Please assess the following tutor screening interview for candidate: {req.candidate_name}\n\n"
        f"---\n{conversation_text}\n---"
        f"{extra}\n\n"
        "Provide your structured JSON assessment now."
    )

    response = await anthropic_create_with_retry(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=ASSESSMENT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = response.content[0].text.strip()

    match = re.search(r'\{[\s\S]*\}', raw)
    if not match:
        raise HTTPException(
            status_code=502,
            detail=f"Claude returned no JSON object: {raw[:200]}",
        )
    json_str = match.group(0)

    try:
        assessment = json.loads(json_str)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=502,
            detail=f"Claude returned malformed JSON: {json_str[:200]}",
        )

    # Save to database
    now = dt.datetime.utcnow()
    scores = assessment.get("scores", {})
    with Session(engine) as session:
        candidate = Candidate(
            candidate_name    = req.candidate_name,
            date              = now,
            clarity           = scores.get("clarity"),
            warmth            = scores.get("warmth"),
            simplicity        = scores.get("simplicity"),
            fluency           = scores.get("fluency"),
            confidence        = scores.get("confidence"),
            follow_up_count   = req.follow_up_count,
            recommendation    = assessment.get("recommendation"),
            summary           = assessment.get("summary"),
            key_quotes_json   = json.dumps(assessment.get("key_quotes", [])),
            filler_words_json = json.dumps(req.filler_words),
        )
        session.add(candidate)
        session.commit()
        session.refresh(candidate)
        candidate_id = candidate.id

    date_str = now.strftime("%B %d, %Y")
    background_tasks.add_task(
        send_report_email, req.candidate_name, date_str, assessment, req.filler_words, req.follow_up_count
    )

    return {**assessment, "id": candidate_id, "follow_up_count": req.follow_up_count}


@app.get("/candidates")
def get_candidates(current_user: User = Depends(get_current_user)):
    """Return all candidates sorted by date descending. Requires JWT."""
    with Session(engine) as session:
        rows = session.query(Candidate).order_by(Candidate.date.desc()).all()
        return [candidate_to_dict(c) for c in rows]


@app.get("/candidates/{candidate_id}")
def get_candidate(candidate_id: int, current_user: User = Depends(get_current_user)):
    """Return a single candidate by ID. Requires JWT."""
    with Session(engine) as session:
        c = session.get(Candidate, candidate_id)
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        return candidate_to_dict(c)


@app.delete("/candidates/{candidate_id}")
def delete_candidate(candidate_id: int, current_user: User = Depends(get_current_user)):
    """Delete a candidate record. Requires JWT."""
    with Session(engine) as session:
        c = session.get(Candidate, candidate_id)
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        # Also unlink any invite token pointing to this candidate
        invite = session.query(InviteToken).filter(InviteToken.candidate_id == candidate_id).first()
        if invite:
            invite.candidate_id = None
        session.delete(c)
        session.commit()
    return {"status": "deleted"}


@app.post("/resend-report/{candidate_id}")
def resend_report(candidate_id: int, background_tasks: BackgroundTasks, current_user: User = Depends(get_current_user)):
    """Re-send the email report for an existing candidate. Requires JWT."""
    with Session(engine) as session:
        c = session.get(Candidate, candidate_id)
        if not c:
            raise HTTPException(status_code=404, detail="Candidate not found")
        assessment = {
            "scores": {
                "clarity":    c.clarity,
                "warmth":     c.warmth,
                "simplicity": c.simplicity,
                "fluency":    c.fluency,
                "confidence": c.confidence,
            },
            "recommendation":   c.recommendation,
            "summary":          c.summary,
            "key_quotes":       json.loads(c.key_quotes_json) if c.key_quotes_json else [],
            "confidence_notes": None,
        }
        filler_words    = json.loads(c.filler_words_json) if c.filler_words_json else {}
        follow_up_count = c.follow_up_count or 0
        date_str = c.date.strftime("%B %d, %Y") if c.date else "N/A"
        name     = c.candidate_name

    background_tasks.add_task(send_report_email, name, date_str, assessment, filler_words, follow_up_count)
    return {"status": "queued"}
