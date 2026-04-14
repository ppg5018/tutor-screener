# AI Tutor Screener

## What we're building
An AI-powered voice interviewer that screens tutor candidates for Cuemath.
A candidate visits the web app, clicks a mic button, speaks their answers,
and gets assessed on communication clarity, warmth, simplicity, and fluency.

## Tech Stack
- Frontend: React + Vite + Tailwind CSS (deployed on Vercel)
- Backend: FastAPI Python (deployed on Render)
- Transcription: Groq Whisper API
- AI Interviewer + Assessor: Anthropic Claude API (claude-sonnet-4-20250514)

## API Keys needed
- ANTHROPIC_API_KEY (we have this)
- GROQ_API_KEY (we have this — used for Whisper transcription)

## Project Structure
tutor-screener/
  backend/         FastAPI Python app
  frontend/        React + Vite app

## Backend routes
- POST /transcribe  — receives audio blob, sends to Groq Whisper, returns transcript
- POST /chat        — receives conversation history, returns Claude's next question
- POST /assess      — receives full transcript, returns structured assessment report

## Frontend pages
- Interview page: mic button, pulsing animation when recording, chat transcript display
- Report page: beautiful structured assessment card with scores and recommendation

## Design aesthetic
Dark theme. Professional, clean, minimal. Think mission control meets interview room.
Deep dark background (#0a0a0f), sharp white typography, subtle purple/violet accent color.
Smooth animations. Pulsing mic indicator when recording. Not generic, not boring.

## Interview flow
1. Candidate lands on page, sees welcome screen
2. Clicks mic, speaks answer
3. Audio sent to /transcribe, transcript shown
4. Transcript sent to /chat, Claude responds with next question
5. Repeat for 5-7 exchanges
6. After interview ends, full transcript sent to /assess
7. Beautiful report card shown with scores

## Assessment dimensions
- Clarity (1-10)
- Warmth (1-10)
- Simplicity (1-10)
- Fluency (1-10)
- Overall recommendation: Pass / Review / Reject
- Key quotes from the conversation as evidence
