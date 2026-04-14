import { createContext, useContext, useState } from 'react'
import { loginUser } from './api.js'

const AUTH_KEY = 'cuemath_auth'
const AuthContext = createContext(null)

function loadStored() {
  try {
    const raw = localStorage.getItem(AUTH_KEY)
    if (!raw) return { token: null, user: null }
    return JSON.parse(raw)
  } catch {
    return { token: null, user: null }
  }
}

export function AuthProvider({ children }) {
  const stored = loadStored()
  const [token, setToken] = useState(stored.token)
  const [user, setUser]   = useState(stored.user)

  const login = async (email, password) => {
    const data = await loginUser(email, password)
    setToken(data.access_token)
    setUser(data.user)
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token: data.access_token, user: data.user }))
    return data
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem(AUTH_KEY)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
