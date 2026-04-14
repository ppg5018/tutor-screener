const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ── Auth ──────────────────────────────────────────────────────────────
export async function loginUser(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Login failed (${res.status}): ${detail}`)
  }
  return res.json()
}

// ── Invites ───────────────────────────────────────────────────────────
export async function createInvite(candidateName, candidateEmail, token) {
  const res = await fetch(`${BASE_URL}/invites/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ candidate_name: candidateName, candidate_email: candidateEmail || null }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to create invite (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function listInvites(token) {
  const res = await fetch(`${BASE_URL}/invites/list`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to list invites (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function verifyInviteToken(inviteToken) {
  const res = await fetch(`${BASE_URL}/invites/verify/${inviteToken}`)
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Invalid invite (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function completeInviteToken(inviteToken, candidateId) {
  const url = new URL(`${BASE_URL}/invites/complete/${inviteToken}`)
  if (candidateId != null) url.searchParams.set('candidate_id', candidateId)
  const res = await fetch(url.toString(), { method: 'POST' })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to complete invite (${res.status}): ${detail}`)
  }
  return res.json()
}

// ── Interview ─────────────────────────────────────────────────────────
export async function transcribeAudio(audioBlob) {
  const ext = audioBlob.type.includes('mp4') ? 'mp4' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm'
  const formData = new FormData()
  formData.append('audio', audioBlob, `recording.${ext}`)

  const res = await fetch(`${BASE_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Transcription failed (${res.status}): ${detail}`)
  }

  return res.json()
}

export async function sendChat(messages, candidateName) {
  const cleanMessages = messages.map(({ role, content }) => ({ role, content }))
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: cleanMessages, candidate_name: candidateName }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Chat failed (${res.status}): ${detail}`)
  }

  return res.json()
}

export async function assessInterview(messages, candidateName, fillerWords = {}, followUpCount = 0) {
  const res = await fetch(`${BASE_URL}/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      candidate_name: candidateName,
      filler_words: fillerWords,
      follow_up_count: followUpCount,
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Assessment failed (${res.status}): ${detail}`)
  }

  return res.json()
}

// ── HR management (admin only) ────────────────────────────────────────
export async function listHR(token) {
  const res = await fetch(`${BASE_URL}/hr/list`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to list HR users (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function createHR(name, email, password, token) {
  const res = await fetch(`${BASE_URL}/hr/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, email, password }),
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to create HR user (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function deleteHR(userId, token) {
  const res = await fetch(`${BASE_URL}/hr/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to delete HR user (${res.status}): ${detail}`)
  }
  return res.json()
}

// ── Dashboard (JWT-protected) ─────────────────────────────────────────
export async function getCandidates(token) {
  const res = await fetch(`${BASE_URL}/candidates`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to fetch candidates (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function getCandidate(id, token) {
  const res = await fetch(`${BASE_URL}/candidates/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Failed to fetch candidate (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function deleteCandidate(id, token) {
  const res = await fetch(`${BASE_URL}/candidates/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Delete failed (${res.status}): ${detail}`)
  }
  return res.json()
}

export async function resendReport(id, token) {
  const res = await fetch(`${BASE_URL}/resend-report/${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Resend failed (${res.status}): ${detail}`)
  }
  return res.json()
}
