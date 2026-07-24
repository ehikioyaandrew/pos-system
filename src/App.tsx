import React, { useState, useEffect } from 'react'
import toast, { Toaster } from 'react-hot-toast'
import {
  authenticateWebUser,
  changeWebPassword,
  invoke,
  resetWebPassword,
  verifyPasswordResetIdentity,
} from './api'
import { checkForUpdates, installUpdate } from './updateApi'
import {
  StaffPOSInterface,
  StaffInventoryCheck,
  SalesLogDashboard,
  DebtManagementDashboard,
} from './floorViews'
import * as XLSX from 'xlsx'

const SESSION_KEY = 'pos_web_user'

// Helper component to display product images (web: use URL / path directly)
function ProductImage({ imagePath, alt }: { imagePath: string, alt: string }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!imagePath) {
      setLoading(false)
      return
    }

    setImageSrc(imagePath)
    setLoading(false)
  }, [imagePath])

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!imageSrc) {
    return null
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className="w-full h-full object-cover"
      onError={() => setImageSrc(null)}
    />
  )
}

function App() {
  const [currentView, setCurrentView] = useState<'login' | 'dashboard' | 'customer'>('login')
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [showPasswordChange, setShowPasswordChange] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY)
      if (saved) {
        const user = JSON.parse(saved)
        setCurrentUser(user)
        if (user?.has_temporary_password) {
          setShowPasswordChange(true)
        } else {
          setCurrentView('dashboard')
        }
      }
    } catch (error) {
      console.error('Failed to restore session:', error)
      localStorage.removeItem(SESSION_KEY)
    } finally {
      setLoading(false)
    }
  }, [])

  const persistUser = (user: any | null) => {
    setCurrentUser(user)
    if (user) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user))
    } else {
      localStorage.removeItem(SESSION_KEY)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading POS System...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-mist-50">
      {showPasswordChange && currentUser ? (
        <PasswordChangeModal
          currentUser={currentUser}
          onPasswordChanged={() => {
            const updated = { ...currentUser, has_temporary_password: false, temporary_password: null }
            persistUser(updated)
            setShowPasswordChange(false)
            setCurrentView('dashboard')
          }}
          onCancel={() => {
            setShowPasswordChange(false)
            persistUser(null)
            setCurrentView('login')
          }}
        />
      ) : currentView === 'customer' ? (
        <CustomerOrderView onBack={() => setCurrentView('login')} />
      ) : currentView === 'login' ? (
        <LoginView
          onLogin={() => setCurrentView('dashboard')}
          onUserAuthenticated={(user) => {
            persistUser(user)
            if ((user as any)?.has_temporary_password) {
              setShowPasswordChange(true)
            } else {
              setCurrentView('dashboard')
            }
          }}
          onShowPasswordChange={(user) => {
            persistUser(user)
            setShowPasswordChange(true)
          }}
          onCustomerPOS={() => setCurrentView('customer')}
        />
      ) : (
        <DashboardView
          onLogout={() => {
            persistUser(null)
            setCurrentView('login')
          }}
          currentUser={currentUser}
        />
      )}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            duration: 3000,
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
          },
          error: {
            duration: 5000,
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
            },
          },
        }}
      />
    </div>
  )
}

type AuthPanel =
  | 'signin'
  | 'forgot-identify'
  | 'forgot-reset'
  | 'forgot-done'

const loginFieldClass =
  'w-full px-4 py-3.5 text-base bg-white border border-mist-200 rounded-md text-ink-900 placeholder:text-ink-700/35 focus:outline-none focus:border-copper-500 focus:ring-2 focus:ring-copper-500/20 transition-colors'

function LoginView({ onLogin, onUserAuthenticated, onShowPasswordChange, onCustomerPOS }: {
  onLogin: () => void
  onUserAuthenticated: (user: any) => void
  onShowPasswordChange?: (user: any) => void
  onCustomerPOS?: () => void
}) {
  const [panel, setPanel] = useState<AuthPanel>('signin')
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  })
  const [resetForm, setResetForm] = useState({
    username: '',
    email: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [resetUser, setResetUser] = useState<{ userId: number; username: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const goToSignIn = () => {
    setPanel('signin')
    setError('')
    setResetUser(null)
    setResetForm({ username: '', email: '', newPassword: '', confirmPassword: '' })
  }

  const openForgot = () => {
    setError('')
    setResetForm((prev) => ({
      ...prev,
      username: formData.username,
      newPassword: '',
      confirmPassword: '',
    }))
    setResetUser(null)
    setPanel('forgot-identify')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await authenticateWebUser(formData.username, formData.password)

      if ('error' in result) {
        setError(result.error)
        return
      }

      const user = result.user

      if (user.has_temporary_password) {
        onUserAuthenticated(user)
        onShowPasswordChange?.(user)
        return
      }

      onUserAuthenticated(user)
      onLogin()
      toast.success(`Welcome back, ${user.name || user.username}!`, { duration: 3000 })
    } catch (err) {
      console.error('Login error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await verifyPasswordResetIdentity(resetForm.username, resetForm.email)
      if ('error' in result) {
        setError(result.error)
        return
      }
      setResetUser(result)
      setPanel('forgot-reset')
    } catch (err) {
      console.error('Reset verify error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (resetForm.newPassword.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!resetUser) {
      setError('Session expired. Please verify your account again.')
      setPanel('forgot-identify')
      return
    }

    setLoading(true)
    try {
      const result = await resetWebPassword(resetUser.userId, resetForm.newPassword)
      if (result.error) {
        setError(result.error)
        return
      }
      setFormData((prev) => ({ ...prev, username: resetUser.username, password: '' }))
      setPanel('forgot-done')
      toast.success('Password updated. You can sign in now.')
    } catch (err) {
      console.error('Reset password error:', err)
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const brandCopy =
    panel === 'signin'
      ? {
          title: (
            <>
              Run the counter
              <span className="block text-copper-400">from anywhere.</span>
            </>
          ),
          body: 'Admin and staff sign-in for sales, inventory, and floor operations.',
        }
      : {
          title: (
            <>
              Reset access
              <span className="block text-copper-400">in a few steps.</span>
            </>
          ),
          body: 'Confirm your account details, then choose a new password to get back on the floor.',
        }

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2">
      <section className="login-brand-panel relative hidden lg:flex min-h-screen flex-col justify-between overflow-hidden px-12 xl:px-16 py-12 text-white">
        <p className="relative z-10 font-display text-sm font-semibold tracking-[0.22em] uppercase text-copper-400 animate-fade-in">
          POS System
        </p>

        <div className="relative z-10 max-w-xl animate-fade-up" style={{ animationDelay: '120ms' }}>
          <h1 className="font-display text-5xl xl:text-6xl font-extrabold leading-[1.05] tracking-tight">
            {brandCopy.title}
          </h1>
          <p className="mt-6 text-lg text-white/70 leading-relaxed max-w-md">{brandCopy.body}</p>
        </div>

        <p className="relative z-10 text-sm text-white/40 animate-fade-in" style={{ animationDelay: '280ms' }}>
          Web Version
        </p>
      </section>

      <section className="min-h-screen w-full flex flex-col justify-center bg-mist-50 px-6 sm:px-10 xl:px-20 py-12 animate-panel-in">
        <div className="w-full max-w-lg mx-auto lg:mx-0 lg:max-w-md xl:max-w-lg">
          {panel === 'signin' && (
            <>
              <div className="lg:hidden mb-10">
                <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-copper-500 mb-2">
                  POS System
                </p>
                <h1 className="font-display text-3xl font-bold text-ink-900 tracking-tight">
                  Staff sign in
                </h1>
              </div>

              <div className="hidden lg:block mb-10">
                <h2 className="font-display text-3xl xl:text-4xl font-bold text-ink-900 tracking-tight">
                  Sign in
                </h2>
                <p className="mt-2 text-ink-700/70 text-base">
                  Use your admin or staff credentials to continue.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="username" className="block text-sm font-semibold text-ink-800 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    id="username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className={loginFieldClass}
                    placeholder="Enter your username"
                    required
                    disabled={loading}
                    autoComplete="username"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="password" className="block text-sm font-semibold text-ink-800">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={openForgot}
                      className="text-sm font-semibold text-copper-600 hover:text-copper-500 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    type="password"
                    id="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className={loginFieldClass}
                    placeholder="Enter your password"
                    required
                    disabled={loading}
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-md">
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-[#121c19] hover:bg-[#1a2924] disabled:bg-[#121c19]/40 text-white py-3.5 px-6 rounded-md font-semibold text-base tracking-wide transition-colors disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="inline-flex items-center justify-center gap-3">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                      Signing in…
                    </span>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </form>

              <div className="mt-10 pt-8 border-t border-mist-200">
                <p className="text-sm text-ink-700/60 mb-3">Ordering for yourself?</p>
                <button
                  type="button"
                  onClick={onCustomerPOS}
                  className="w-full border border-ink-900/15 hover:border-ink-900/40 hover:bg-white text-ink-900 py-3.5 px-4 rounded-md font-semibold transition-colors"
                >
                  Continue as customer
                </button>
                <p className="mt-3 text-sm text-ink-700/45">
                  Skip staff login and place an order.
                </p>
              </div>
            </>
          )}

          {panel === 'forgot-identify' && (
            <>
              <button
                type="button"
                onClick={goToSignIn}
                className="mb-8 text-sm font-semibold text-ink-700/70 hover:text-ink-900 transition-colors"
              >
                ← Back to sign in
              </button>

              <div className="mb-8">
                <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-copper-500 mb-2">
                  Password recovery
                </p>
                <h2 className="font-display text-3xl xl:text-4xl font-bold text-ink-900 tracking-tight">
                  Verify your account
                </h2>
                <p className="mt-2 text-ink-700/70 text-base">
                  Enter the username and email on your staff profile.
                </p>
              </div>

              <form onSubmit={handleVerifyReset} className="space-y-5">
                <div>
                  <label htmlFor="reset-username" className="block text-sm font-semibold text-ink-800 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    id="reset-username"
                    value={resetForm.username}
                    onChange={(e) => setResetForm({ ...resetForm, username: e.target.value })}
                    className={loginFieldClass}
                    placeholder="Your username"
                    required
                    disabled={loading}
                    autoComplete="username"
                  />
                </div>

                <div>
                  <label htmlFor="reset-email" className="block text-sm font-semibold text-ink-800 mb-2">
                    Email on file
                  </label>
                  <input
                    type="email"
                    id="reset-email"
                    value={resetForm.email}
                    onChange={(e) => setResetForm({ ...resetForm, email: e.target.value })}
                    className={loginFieldClass}
                    placeholder="name@business.com"
                    required
                    disabled={loading}
                    autoComplete="email"
                  />
                </div>

                {error && (
                  <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-md">
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-[#121c19] hover:bg-[#1a2924] disabled:bg-[#121c19]/40 text-white py-3.5 px-6 rounded-md font-semibold text-base tracking-wide transition-colors disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="inline-flex items-center justify-center gap-3">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                      Checking…
                    </span>
                  ) : (
                    'Continue'
                  )}
                </button>
              </form>
            </>
          )}

          {panel === 'forgot-reset' && resetUser && (
            <>
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setPanel('forgot-identify')
                }}
                className="mb-8 text-sm font-semibold text-ink-700/70 hover:text-ink-900 transition-colors"
              >
                ← Back
              </button>

              <div className="mb-8">
                <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-copper-500 mb-2">
                  Password recovery
                </p>
                <h2 className="font-display text-3xl xl:text-4xl font-bold text-ink-900 tracking-tight">
                  Choose a new password
                </h2>
                <p className="mt-2 text-ink-700/70 text-base">
                  Updating password for <span className="font-semibold text-ink-900">{resetUser.username}</span>.
                </p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-5">
                <div>
                  <label htmlFor="new-password" className="block text-sm font-semibold text-ink-800 mb-2">
                    New password
                  </label>
                  <input
                    type="password"
                    id="new-password"
                    value={resetForm.newPassword}
                    onChange={(e) => setResetForm({ ...resetForm, newPassword: e.target.value })}
                    className={loginFieldClass}
                    placeholder="At least 6 characters"
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="block text-sm font-semibold text-ink-800 mb-2">
                    Confirm password
                  </label>
                  <input
                    type="password"
                    id="confirm-password"
                    value={resetForm.confirmPassword}
                    onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
                    className={loginFieldClass}
                    placeholder="Re-enter new password"
                    required
                    minLength={6}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>

                {error && (
                  <div className="border border-red-200 bg-red-50 px-4 py-3 rounded-md">
                    <p className="text-red-700 text-sm font-medium">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 bg-[#121c19] hover:bg-[#1a2924] disabled:bg-[#121c19]/40 text-white py-3.5 px-6 rounded-md font-semibold text-base tracking-wide transition-colors disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <span className="inline-flex items-center justify-center gap-3">
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                      Saving…
                    </span>
                  ) : (
                    'Update password'
                  )}
                </button>
              </form>
            </>
          )}

          {panel === 'forgot-done' && (
            <>
              <div className="mb-8">
                <p className="font-display text-xs font-semibold tracking-[0.2em] uppercase text-copper-500 mb-2">
                  Password recovery
                </p>
                <h2 className="font-display text-3xl xl:text-4xl font-bold text-ink-900 tracking-tight">
                  Password updated
                </h2>
                <p className="mt-2 text-ink-700/70 text-base">
                  Your new password is ready. Sign in with it to continue.
                </p>
              </div>

              <button
                type="button"
                onClick={goToSignIn}
                className="w-full bg-[#121c19] hover:bg-[#1a2924] text-white py-3.5 px-6 rounded-md font-semibold text-base tracking-wide transition-colors"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function CustomerOrderView({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2">
      <section className="login-brand-panel relative hidden lg:flex min-h-screen flex-col justify-between overflow-hidden px-12 xl:px-16 py-12 text-white">
        <p className="relative z-10 font-display text-sm font-semibold tracking-[0.22em] uppercase text-copper-400">
          POS System
        </p>
        <div className="relative z-10 max-w-xl">
          <h1 className="font-display text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight">
            Order at your
            <span className="block text-copper-400">own pace.</span>
          </h1>
          <p className="mt-6 text-lg text-white/70 leading-relaxed max-w-md">
            Customer self-order is being restored for the web build.
          </p>
        </div>
        <p className="relative z-10 text-sm text-white/40">Web Version</p>
      </section>

      <section className="min-h-screen w-full flex flex-col justify-center bg-mist-50 px-6 sm:px-10 xl:px-20 py-12">
        <div className="w-full max-w-lg mx-auto lg:mx-0">
          <h2 className="font-display text-3xl font-bold text-ink-900 tracking-tight mb-3">
            Customer ordering
          </h2>
          <p className="text-ink-700/70 mb-8 max-w-md leading-relaxed">
            Self-order is coming back soon. Please use staff login for now, or return to the sign-in page.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="bg-[#121c19] hover:bg-[#1a2924] text-white py-3.5 px-8 rounded-md font-semibold transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </section>
    </div>
  )
}

// Password Change Modal for users with temporary passwords
function PasswordChangeModal({ currentUser, onPasswordChanged, onCancel }: {
  currentUser: any
  onPasswordChanged: () => void
  onCancel: () => void
}) {
  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (formData.newPassword.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      const result = await changeWebPassword(currentUser.id, formData.newPassword)
      if (result.error) {
        setError(`Failed to change password: ${result.error}`)
        return
      }

      toast.success('Password changed successfully! You can now access the system.')
      onPasswordChanged()
    } catch (error: any) {
      console.error('Failed to change password:', error)
      setError(`Failed to change password: ${error}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Change Your Password</h2>
          <p className="text-slate-600">
            You're using a temporary password. Please set a new password to continue.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 mb-2 font-medium">New Password</label>
            <input
              type="password"
              required
              value={formData.newPassword}
              onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter new password (min. 6 characters)"
              minLength={6}
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-700 mb-2 font-medium">Confirm Password</label>
            <input
              type="password"
              required
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Confirm new password"
              minLength={6}
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Changing Password...' : 'Change Password'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>

        <div className="mt-4 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Security Tip:</strong> Choose a strong password that you haven't used elsewhere.
          </p>
        </div>
      </div>
    </div>
  )
}

// NavButton Component for consistent navigation styling
function NavButton({ active, onClick, label }: {
  active: boolean
  onClick: () => void
  icon?: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 py-2.5 px-3 rounded-md text-left text-sm font-medium transition-colors ${
        active
          ? 'bg-white/10 text-white'
          : 'text-white/55 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          active ? 'bg-[#e0a06a]' : 'bg-white/25'
        }`}
      />
      <span>{label}</span>
    </button>
  )
}

function MetricCard({ title, value, hint, accent, color = 'blue' }: {
  title: string
  value: string
  icon?: string
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red'
  hint?: string
  accent?: 'ink' | 'copper' | 'teal' | 'rose'
}) {
  const colorToAccent: Record<string, 'ink' | 'copper' | 'teal' | 'rose'> = {
    blue: 'ink',
    green: 'teal',
    purple: 'copper',
    orange: 'copper',
    red: 'rose',
  }
  const resolved = accent || colorToAccent[color] || 'ink'
  const accentClass = {
    ink: 'bg-[#121c19]',
    copper: 'bg-[#c4783a]',
    teal: 'bg-teal-600',
    rose: 'bg-rose-500',
  }[resolved]

  return (
    <div className="relative overflow-hidden rounded-xl border border-[#d4dcd8] bg-white p-6 min-h-[140px] flex flex-col justify-between">
      <div className={`absolute left-0 top-0 h-full w-1 ${accentClass}`} />
      <p className="text-sm font-medium text-[#2a3d36]/60 pl-2">{title}</p>
      <div className="pl-2 mt-4">
        <p className="font-display text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">{value}</p>
        {hint && <p className="mt-1 text-xs text-[#2a3d36]/45">{hint}</p>}
      </div>
    </div>
  )
}

function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center py-24 px-6">
      <div className="text-center animate-fade-in">
        <div className="relative mx-auto mb-5 h-12 w-12">
          <div className="absolute inset-0 rounded-full border-2 border-[#121c19]/10" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#c4783a] animate-spin" />
        </div>
        <p className="font-display text-lg font-semibold text-[#121c19]">{label}</p>
        <p className="mt-1 text-sm text-[#2a3d36]/50">Please wait a moment</p>
      </div>
    </div>
  )
}

/** Accepts JSON arrays or comma-separated values like "BAR,KITCHEN". */
function parseBusinessModules(
  raw: unknown,
  fallback: string[] = ['BAR', 'KITCHEN', 'ROOM']
): string[] {
  if (Array.isArray(raw)) {
    const modules = raw.map(String).map((m) => m.trim()).filter(Boolean)
    return modules.length ? modules : fallback
  }
  if (typeof raw !== 'string') return fallback

  const trimmed = raw.trim()
  if (!trimmed) return fallback

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const modules = parsed.map(String).map((m) => m.trim()).filter(Boolean)
        return modules.length ? modules : fallback
      }
    } catch {
      // fall through to comma-separated parsing
    }
  }

  const modules = trimmed
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

  return modules.length ? modules : fallback
}

function DashboardView({ onLogout, currentUser }: { onLogout: () => void, currentUser: any }) {
  const initialRole = String(currentUser?.role || 'Staff')
  const isFloorStaffRole = ['Staff', 'BarStaff', 'KitchenStaff'].includes(initialRole)
  const [userRole, setUserRole] = useState<string>(initialRole)
  const [currentSection, setCurrentSection] = useState(isFloorStaffRole ? 'pos' : 'dashboard')
  const [businessInfo, setBusinessInfo] = useState<any>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const goToSection = (section: string) => {
    setCurrentSection(section)
    setMobileNavOpen(false)
  }

  useEffect(() => {
    setMobileNavOpen(false)
  }, [currentSection])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [mobileNavOpen])

  useEffect(() => {
    // Get current user info to determine role
    if (currentUser && currentUser.role) {
      setUserRole(currentUser.role)
      const floor = ['Staff', 'BarStaff', 'KitchenStaff'].includes(String(currentUser.role))
      setCurrentSection((prev) => {
        if (floor && (prev === 'dashboard' || !prev)) return 'pos'
        return prev
      })

      // Get business information if user has a business_id
      if (currentUser.business_id) {
        loadBusinessInfo(currentUser.business_id)
      }
    } else {
      setUserRole('Staff')
    }
  }, [currentUser])

  const loadBusinessInfo = async (businessId: number) => {
    try {
      // Backend accepts serde_json::Value which can be a number or object
      const business = await invoke('get_business_by_id', businessId as any) as any
      if (business) {
        setBusinessInfo(business)
      } else {
      }
    } catch (error) {
      console.error('Failed to load business info:', error)
      // Fallback: try getting all businesses
      try {
        const businesses = await invoke('get_businesses') as any[]
        const business = businesses.find((b: any) => b.id === businessId)
        if (business) {
          setBusinessInfo(business)
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError)
      }
    }
  }

  const roleLabel =
    userRole === 'SuperSuperAdmin' ? 'Super Super Admin' :
    userRole === 'SuperAdmin' ? 'Business Admin' :
    userRole === 'Manager' ? 'Manager' :
    userRole === 'Secretary' ? 'Secretary' :
    userRole === 'BarStaff' ? 'Bar Staff' :
    userRole === 'KitchenStaff' ? 'Kitchen Staff' : 'Staff'

  const roleSubtitle =
    userRole === 'SuperSuperAdmin' ? 'Software management' :
    businessInfo?.address ? businessInfo.address :
    userRole === 'SuperAdmin' ? 'Full business control' :
    userRole === 'Manager' ? 'Operations' :
    userRole === 'Secretary' ? 'Administrative support' : 'Sales operations'

  const displayName = businessInfo?.name || roleLabel
  const initials = String(currentUser?.name || currentUser?.username || roleLabel)
    .split(/\s+/)
    .slice(0, 2)
    .map((p: string) => p[0]?.toUpperCase() || '')
    .join('') || 'U'

  const renderSidebar = () => {
    const isSuperSuperAdmin = userRole === 'SuperSuperAdmin'
    const isSuperAdmin = userRole === 'SuperAdmin'
    const isManager = userRole === 'Manager'
    const isSecretary = userRole === 'Secretary'

    return (
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[min(18rem,85vw)] bg-[#0b1210] text-white flex flex-col border-r border-white/5 transform transition-transform duration-200 ease-out md:static md:z-auto md:w-64 xl:w-72 md:max-w-none ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3 mb-5">
            <p className="font-display text-[11px] font-semibold tracking-[0.22em] uppercase text-[#e0a06a]">
              POS System
            </p>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="md:hidden -mt-1 -mr-1 h-9 w-9 rounded-md text-white/60 hover:text-white hover:bg-white/10 text-xl leading-none"
              aria-label="Close menu"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-[#1a2924] border border-white/10 flex items-center justify-center font-display font-bold text-[#e0a06a]">
              {initials}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-white truncate">{displayName}</h2>
              <p className="text-xs text-white/45 truncate">{roleSubtitle}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pb-4">
          <p className="px-3 pt-2 pb-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-white/30">
            Menu
          </p>
          {isSuperSuperAdmin ? (
            <>
              <NavButton active={currentSection === 'dashboard'} onClick={() => goToSection('dashboard')} label="Dashboard" />
              <NavButton active={currentSection === 'clients'} onClick={() => goToSection('clients')} label="Client Businesses" />
              <NavButton active={currentSection === 'onboarding'} onClick={() => goToSection('onboarding')} label="Onboard Client" />
              <NavButton active={currentSection === 'reports'} onClick={() => goToSection('reports')} label="System Reports" />
            </>
          ) : isSuperAdmin ? (
            <>
              <NavButton active={currentSection === 'dashboard'} onClick={() => goToSection('dashboard')} label="Dashboard" />
              <NavButton active={currentSection === 'products'} onClick={() => goToSection('products')} label="Products" />
              <NavButton active={currentSection === 'inventory'} onClick={() => goToSection('inventory')} label="Inventory" />
              <NavButton active={currentSection === 'staff'} onClick={() => goToSection('staff')} label="Staff Management" />
              <NavButton active={currentSection === 'sales-log'} onClick={() => goToSection('sales-log')} label="Sales Log" />
              <NavButton active={currentSection === 'debt'} onClick={() => goToSection('debt')} label="Debt" />
              <NavButton active={currentSection === 'reports'} onClick={() => goToSection('reports')} label="Reports" />
              <NavButton active={currentSection === 'settings'} onClick={() => goToSection('settings')} label="Settings" />
              <NavButton active={currentSection === 'pending'} onClick={() => goToSection('pending')} label="Pending Items" />
            </>
          ) : isManager ? (
            <>
              <NavButton active={currentSection === 'dashboard'} onClick={() => goToSection('dashboard')} label="Dashboard" />
              <NavButton active={currentSection === 'inventory'} onClick={() => goToSection('inventory')} label="Inventory" />
              <NavButton active={currentSection === 'staff'} onClick={() => goToSection('staff')} label="Staff Overview" />
              <NavButton active={currentSection === 'sales-log'} onClick={() => goToSection('sales-log')} label="Sales Log" />
              <NavButton active={currentSection === 'debt'} onClick={() => goToSection('debt')} label="Debt" />
              <NavButton active={currentSection === 'reports'} onClick={() => goToSection('reports')} label="Reports" />
              <NavButton active={currentSection === 'settings'} onClick={() => goToSection('settings')} label="Settings" />
              <NavButton active={currentSection === 'pending'} onClick={() => goToSection('pending')} label="Pending Items" />
            </>
          ) : isSecretary ? (
            <>
              <NavButton active={currentSection === 'dashboard'} onClick={() => goToSection('dashboard')} label="Dashboard" />
              <NavButton active={currentSection === 'products'} onClick={() => goToSection('products')} label="Product Catalog" />
              <NavButton active={currentSection === 'inventory'} onClick={() => goToSection('inventory')} label="Inventory Tracking" />
              <NavButton active={currentSection === 'staff'} onClick={() => goToSection('staff')} label="Staff Records" />
              <NavButton active={currentSection === 'sales-log'} onClick={() => goToSection('sales-log')} label="Sales Log" />
              <NavButton active={currentSection === 'debt'} onClick={() => goToSection('debt')} label="Debt" />
              <NavButton active={currentSection === 'pending'} onClick={() => goToSection('pending')} label="Pending Items" />
            </>
          ) : (
            <>
              <NavButton active={currentSection === 'pos'} onClick={() => goToSection('pos')} label="Point of Sale" />
              <NavButton active={currentSection === 'inventory'} onClick={() => goToSection('inventory')} label="Stock Check" />
              <NavButton active={currentSection === 'sales-log'} onClick={() => goToSection('sales-log')} label="Sales Log" />
              <NavButton active={currentSection === 'debt'} onClick={() => goToSection('debt')} label="Debt" />
              <NavButton active={currentSection === 'pending'} onClick={() => goToSection('pending')} label="Pending Items" />
            </>
          )}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="px-2 mb-3">
            <p className="text-xs text-white/40 truncate">{currentUser?.name || currentUser?.username}</p>
            <p className="text-[11px] text-white/25">{roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full border border-white/10 hover:border-rose-400/40 hover:bg-rose-500/10 text-white/70 hover:text-white py-2.5 px-4 rounded-md text-sm font-medium transition-colors"
          >
            Log out
          </button>
        </div>
      </aside>
    )
  }


  const renderContent = () => {
    if (userRole === 'SuperSuperAdmin') {
      switch (currentSection) {
        case 'clients':
          return <ClientsManagement
            onNavigateToOnboarding={() => goToSection('onboarding')}
            refreshTrigger={currentSection === 'clients'}
          />
        case 'onboarding':
          return <ClientOnboarding
            onComplete={() => goToSection('clients')}
            currentUser={currentUser}
          />
        case 'reports':
          return <SystemReports />
        default:
          return <SuperAdminDashboard onNavigateToSection={goToSection} />
      }
    }

    // Business user content
    const isSuperAdmin = userRole === 'SuperAdmin'
    const isManager = userRole === 'Manager'
    const isSecretary = userRole === 'Secretary'
    const isFloorStaff = ['Staff', 'BarStaff', 'KitchenStaff'].includes(userRole)

    // Floor staff (Staff / BarStaff / KitchenStaff) — POS-first, not admin dashboard
    if (isFloorStaff) {
      switch (currentSection) {
        case 'pos':
          return <StaffPOSInterface currentUser={currentUser} businessInfo={businessInfo} />
        case 'inventory':
          return <StaffInventoryCheck currentUser={currentUser} />
        case 'sales-log':
          return <SalesLogDashboard currentUser={currentUser} businessInfo={businessInfo} ownOnly />
        case 'debt':
          return <DebtManagementDashboard currentUser={currentUser} businessInfo={businessInfo} />
        case 'pending':
          return <PendingItemsDashboard currentUser={currentUser} businessInfo={businessInfo} />
        default:
          return <StaffPOSInterface currentUser={currentUser} businessInfo={businessInfo} />
      }
    }

    // Other business roles
    switch (currentSection) {
      case 'products':
        // Only SuperAdmin and Secretary can manage products
        if (isSuperAdmin || isSecretary) {
          return <ProductManagement businessInfo={businessInfo} currentUser={currentUser} />
        }
        return <AccessDenied />
      case 'sales':
        return <BusinessSales />
      case 'sales-log':
        return <SalesLogDashboard currentUser={currentUser} businessInfo={businessInfo} />
      case 'debt':
        if (isSuperAdmin || isManager || isSecretary || isFloorStaff) {
          return <DebtManagementDashboard currentUser={currentUser} businessInfo={businessInfo} />
        }
        return <AccessDenied />
      case 'inventory':
        return <BusinessInventory currentUser={currentUser} />
      case 'staff':
        // SuperAdmin, Manager, and Secretary can view staff records
        if (isSuperAdmin || isManager || isSecretary) {
          return <BusinessStaff currentUser={currentUser} businessInfo={businessInfo} />
        }
        return <AccessDenied />
      case 'reports':
        // Managers and above can see reports
        if (isSuperAdmin || isManager || isSecretary) {
          return <ReportsDashboard currentUser={currentUser} businessInfo={businessInfo} />
        }
        return <AccessDenied />
      case 'settings':
        // SuperAdmin and Manager can access settings
        if (isSuperAdmin || isManager) {
          return <SettingsDashboard currentUser={currentUser} businessInfo={businessInfo} />
        }
        return <AccessDenied />
      case 'pending':
        // All roles can view pending items
        return <PendingItemsDashboard currentUser={currentUser} businessInfo={businessInfo} />
      case 'kitchen':
        // All roles can view kitchen orders (kitchen staff, managers, etc.)
        return <KitchenOrderQueue currentUser={currentUser} businessInfo={businessInfo} />
      default:
        return (
          <BusinessDashboard
            currentUser={currentUser}
            onNavigate={goToSection}
          />
        )
    }
  }

  return (
    <div className="flex h-[100dvh] w-full max-w-[100vw] bg-[#f4f6f5] overflow-hidden">
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close menu overlay"
          className="fixed inset-0 z-30 bg-[#0b1210]/55 md:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      {renderSidebar()}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="md:hidden sticky top-0 z-20 flex items-center gap-3 px-4 py-3 bg-[#0b1210] text-white border-b border-white/10 shrink-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="h-10 w-10 rounded-md border border-white/10 hover:bg-white/10 flex flex-col items-center justify-center gap-1.5"
            aria-label="Open menu"
          >
            <span className="block w-4 h-0.5 bg-white rounded-full" />
            <span className="block w-4 h-0.5 bg-white rounded-full" />
            <span className="block w-4 h-0.5 bg-white rounded-full" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{displayName}</p>
            <p className="text-[11px] text-white/45 truncate">{roleLabel}</p>
          </div>
        </header>
        <div className="flex-1 min-w-0 overflow-auto overscroll-contain">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

function SuperAdminDashboard({ onNavigateToSection }: { onNavigateToSection: (section: string) => void }) {
  const [syncStatus, setSyncStatus] = useState<any>(null)
  const [syncing, setSyncing] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [currentVersion, setCurrentVersion] = useState<string>('')

  useEffect(() => {
    checkSyncStatus()
    loadCurrentVersion()
  }, [])

  const loadCurrentVersion = async () => {
    setCurrentVersion(import.meta.env.VITE_APP_VERSION || '1.0.0-web')
  }

  const checkSyncStatus = async () => {
    try {
      const status = await invoke('get_sync_status')
      setSyncStatus(status)
    } catch (error) {
      console.error('Failed to get sync status:', error)
    }
  }

  const handleSyncToCloud = async () => {
    setSyncing(true)
    try {
      const result = await invoke('sync_to_cloud') as any
      setSyncStatus(result)
      toast.success(`Cloud sync completed!\n${result.message}`, {
        duration: 5000,
      })
    } catch (error) {
      console.error('Sync failed:', error)
      toast.error('Cloud sync failed. Check console for details.')
    } finally {
      setSyncing(false)
    }
  }

  const handleSyncFromCloud = async () => {
    setSyncing(true)
    try {
      const result = await invoke('sync_from_cloud') as any
      toast.success(`Cloud restore completed!\n${result.message}`, {
        duration: 5000,
      })
      // Refresh data after a short delay
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (error) {
      console.error('Download failed:', error)
      toast.error('Cloud restore failed. Check console for details.')
    } finally {
      setSyncing(false)
    }
  }

  const handleFixOrphanedUsers = async () => {
    try {
      await invoke('fix_orphaned_users')
      toast.success('Data consistency issues fixed successfully!', {
        duration: 4000,
      })
      // Refresh data after a short delay
      setTimeout(() => {
        window.location.reload()
      }, 2000)
    } catch (error) {
      console.error('Failed to fix orphaned users:', error)
      toast.error('Failed to fix data issues. Check console for details.')
    }
  }

  const handleRemoveDuplicates = async () => {
    try {
      const deleted = await invoke('remove_duplicate_businesses') as number
      if (deleted > 0) {
        toast.success(`Removed ${deleted} duplicate business(es)!`, {
          duration: 4000,
        })
        // Refresh data after a short delay
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        toast.success('No duplicate businesses found!', {
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('Failed to remove duplicates:', error)
      toast.error('Failed to remove duplicates. Check console for details.')
    }
  }

  const handleFixUsersWithoutBusinessId = async () => {
    try {
      const fixed = await invoke('fix_users_without_business_id') as number
      if (fixed > 0) {
        toast.success(`Fixed ${fixed} user(s) with missing business ID! Please log out and log back in.`, {
          duration: 5000,
        })
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        toast.success('No users needed fixing!', {
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('Failed to fix users:', error)
      toast.error('Failed to fix users. Check console for details.')
    }
  }

  const handleFixProductIsActive = async () => {
    try {
      const fixed = await invoke('fix_product_is_active_values') as number
      if (fixed > 0) {
        toast.success(`Fixed ${fixed} product(s)! Products should now be visible.`, {
          duration: 5000,
        })
        setTimeout(() => {
          window.location.reload()
        }, 2000)
      } else {
        toast.success('No products needed fixing!', {
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('Failed to fix products:', error)
      toast.error('Failed to fix products. Check console for details.')
    }
  }

  const handleCheckForUpdates = async () => {
    setCheckingUpdate(true)
    try {
      const info = await checkForUpdates()
      setUpdateInfo(info)
      if (info.available) {
        toast.success(`Update available! Version ${info.version} is ready to install.`, {
          duration: 5000,
        })
      } else {
        toast.success('You are running the latest version!', {
          duration: 3000,
        })
      }
    } catch (error) {
      console.error('Failed to check for updates:', error)
      toast.error('Failed to check for updates. Make sure updater is enabled in configuration.')
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleInstallUpdate = async () => {
    if (!updateInfo?.available) {
      toast.error('No update available to install')
      return
    }

    const confirmed = window.confirm(
      `Install update version ${updateInfo.version}?\n\n${updateInfo.body || ''}\n\nThe application will restart after installation.`
    )

    if (!confirmed) return

    setInstallingUpdate(true)
    try {
      const result = await installUpdate()
      if (result.success) {
        toast.success('Update installed successfully! The application will restart...', {
          duration: 5000,
        })
      } else {
        toast.error(`Update installation failed: ${result.message}`)
      }
    } catch (error) {
      console.error('Failed to install update:', error)
      toast.error('Failed to install update. Check console for details.')
    } finally {
      setInstallingUpdate(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">Super Admin Dashboard</h1>
          <p className="text-slate-600 text-lg">Manage your POS system clients and businesses</p>
        </div>

        {/* Metrics Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8 w-full">
          <MetricCard
            title="Total Clients"
            value="0"
            icon="🏢"
            color="blue"
          />
          <MetricCard
            title="Active Businesses"
            value="0"
            icon="✅"
            color="green"
          />
          <MetricCard
            title="Total Revenue"
            value="₦0"
            icon="💰"
            color="purple"
          />
          <MetricCard
            title="Pending Setup"
            value="0"
            icon="⏳"
            color="orange"
          />
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Quick Actions</h2>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 w-full">
            <button
              onClick={() => onNavigateToSection('onboarding')}
              className="bg-blue-600 hover:bg-blue-700 text-white py-4 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg flex items-center justify-center space-x-3"
            >
              <span className="text-xl">➕</span>
              <span>Onboard New Client</span>
          </button>
            <button
              onClick={() => onNavigateToSection('clients')}
              className="bg-slate-600 hover:bg-slate-700 text-white py-4 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg flex items-center justify-center space-x-3"
            >
              <span className="text-xl">📊</span>
              <span>View All Clients</span>
          </button>
            <button
              onClick={() => onNavigateToSection('reports')}
              className="bg-slate-600 hover:bg-slate-700 text-white py-4 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg flex items-center justify-center space-x-3"
            >
              <span className="text-xl">📈</span>
              <span>System Reports</span>
          </button>
          </div>
        </div>

        {/* Application Updates */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">🔄 Application Updates</h2>

          {/* Current Version */}
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-700">Current Version</span>
              <span className="px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                v{currentVersion || 'Loading...'}
              </span>
            </div>
            {updateInfo?.available && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-green-800">Update Available!</span>
                  <span className="px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                    v{updateInfo.version}
                  </span>
                </div>
                {updateInfo.body && (
                  <p className="text-sm text-green-700 mt-2 whitespace-pre-wrap">{updateInfo.body}</p>
                )}
                {updateInfo.date && (
                  <p className="text-xs text-green-600 mt-1">
                    Released: {new Date(updateInfo.date).toLocaleDateString()}
                  </p>
                )}
              </div>
            )}
            {updateInfo && !updateInfo.available && (
              <p className="text-sm text-slate-600 mt-2">✅ You are running the latest version!</p>
            )}
          </div>

          {/* Update Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingUpdate || installingUpdate}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>{checkingUpdate ? '⏳' : '🔍'}</span>
              <span>{checkingUpdate ? 'Checking...' : 'Check for Updates'}</span>
            </button>

            {updateInfo?.available && (
              <button
                onClick={handleInstallUpdate}
                disabled={installingUpdate}
                className="bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
              >
                <span>{installingUpdate ? '⏳' : '⬇️'}</span>
                <span>{installingUpdate ? 'Installing...' : `Install v${updateInfo.version}`}</span>
              </button>
            )}
          </div>

          {/* Note */}
          <div className="mt-6 border-t border-slate-200 pt-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-sm text-yellow-800">
                <strong>⚠️ Note:</strong> Make sure the updater plugin is enabled in <code className="bg-yellow-100 px-1 rounded">tauri.conf.json</code> and your GitHub repository is configured correctly.
              </p>
            </div>
          </div>
        </div>

        {/* Cloud Management */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">☁️ Cloud Backup & Sync</h2>

          {/* Sync Status */}
          <div className="mb-6 p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-slate-700">Sync Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                syncStatus?.cloud_enabled ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {syncStatus?.cloud_enabled ? '🟢 Connected' : '🟡 Offline'}
              </span>
            </div>
            <p className="text-sm text-slate-600">
              {syncStatus?.message || 'Cloud sync not configured yet'}
            </p>
            {syncStatus?.last_sync && (
              <p className="text-xs text-slate-500 mt-1">
                Last sync: {new Date(syncStatus.last_sync).toLocaleString()}
              </p>
            )}
          </div>

          {/* Sync Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <button
              onClick={handleSyncToCloud}
              disabled={syncing}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>⬆️</span>
              <span>{syncing ? 'Syncing...' : 'Backup to Cloud'}</span>
            </button>

            <button
              onClick={handleSyncFromCloud}
              disabled={syncing || !syncStatus?.cloud_enabled}
              className="bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>⬇️</span>
              <span>{syncing ? 'Downloading...' : 'Restore from Cloud'}</span>
            </button>

            <button
              onClick={handleFixOrphanedUsers}
              className="bg-orange-600 hover:bg-orange-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🔧</span>
              <span>Fix Data Issues</span>
            </button>

            <button
              onClick={handleRemoveDuplicates}
              className="bg-purple-600 hover:bg-purple-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🧹</span>
              <span>Remove Duplicates</span>
            </button>

            <button
              onClick={handleFixUsersWithoutBusinessId}
              className="bg-teal-600 hover:bg-teal-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🔗</span>
              <span>Fix Missing Business IDs</span>
            </button>

            <button
              onClick={handleFixProductIsActive}
              className="bg-cyan-600 hover:bg-cyan-700 text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>🔧</span>
              <span>Fix Product Visibility</span>
        </button>
      </div>

          {/* Setup Instructions */}
          <div className="border-t border-slate-200 pt-6">
            <h3 className="font-semibold text-slate-800 mb-3">🚀 Cloud Setup (Coming Soon)</h3>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800 mb-2">
                <strong>Free Supabase Setup:</strong> We'll add Supabase integration for automatic cloud backup and multi-device sync.
              </p>
              <ul className="text-xs text-blue-700 space-y-1 ml-4">
                <li>• 500MB free database storage</li>
                <li>• Real-time data synchronization</li>
                <li>• Automatic backups</li>
                <li>• Multi-device access</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-8 w-full">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Recent Activity</h2>
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📋</div>
            <h3 className="text-xl font-semibold text-slate-700 mb-2">No Recent Activity</h3>
            <p className="text-slate-500">Client onboarding and business activities will appear here</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClientsManagement({
  onNavigateToOnboarding,
  refreshTrigger
}: {
  onNavigateToOnboarding: () => void
  refreshTrigger?: any
}) {
  const [clients, setClients] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadClients()
  }, [refreshTrigger])

  const loadClients = async () => {
    try {
      const businesses = await invoke('get_businesses')
      setClients(businesses as any[])
    } catch (error) {
      console.error('Failed to load clients:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateClientStatus = async (businessId: number, newStatus: string) => {
    try {
      // Convert string status to boolean for backend
      const isActive = newStatus === 'ACTIVE'
      await invoke('update_business_status', {
        request: {
          business_id: businessId,
          is_active: isActive
        }
      })
      await loadClients() // Refresh the list
      toast.success(`Client ${isActive ? 'activated' : 'suspended'} successfully`)
    } catch (error) {
      console.error('Failed to update client status:', error)
      toast.error('Failed to update client status')
    }
  }

  const deleteClient = async (businessId: number) => {
    if (!confirm('Are you sure you want to terminate this client? They will lose cloud access but can continue using the local software.')) {
      return
    }

    try {
      await invoke('update_business_status', {
        request: {
          business_id: businessId,
          is_active: false
        }
      })
      await loadClients() // Refresh the list
      toast.success('Client terminated successfully')
    } catch (error) {
      console.error('Failed to terminate client:', error)
      toast.error('Failed to terminate client')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-green-100 text-green-800'
      case 'SUSPENDED': return 'bg-yellow-100 text-yellow-800'
      case 'TERMINATED': return 'bg-red-100 text-red-800'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const viewAdminPassword = async (businessId: number) => {
    try {
      const result = await invoke('get_business_admin_password', {
        request: {
          business_id: businessId
        }
      }) as { username: string | null, password: string | null }
      if (result.password) {
        toast.success(`Admin Credentials:\n\nUsername: ${result.username}\nPassword: ${result.password}\n\n⚠️ Please share this securely with the client.`, {
          duration: 12000,
        })
      } else {
        // Password not found - offer to reset it
        if (confirm('Password not found in database. Would you like to reset it to a new temporary password?')) {
          resetAdminPassword(businessId)
        }
      }
    } catch (error) {
      console.error('Failed to get admin password:', error)
      toast.error('Failed to retrieve admin password')
    }
  }

  const resetAdminPassword = async (businessId: number) => {
    try {
      // Generate a new temporary password
      const newPassword = `Temp${Math.random().toString(36).slice(-8)}!`
      const passwordHash = btoa(newPassword)

      const result = await invoke('reset_business_admin_password', {
        request: {
          business_id: businessId,
          password_hash: passwordHash,
          temporary_password: newPassword
        }
      }) as { username: string | null }

      if (result.username) {
        toast.success(`Password Reset Successful!\n\nUsername: ${result.username}\nNew Password: ${newPassword}\n\n⚠️ Please share this securely with the client.`, {
          duration: 12000,
        })
      } else {
        toast.error('Failed to reset password. Admin user not found.')
      }
    } catch (error) {
      console.error('Failed to reset password:', error)
      toast.error('Failed to reset admin password')
    }
  }

  const deleteAllBusinesses = async () => {
    if (!confirm('⚠️ WARNING: This will delete ALL businesses and all related data (products, sales, inventory). This action cannot be undone!\n\nAre you absolutely sure you want to proceed?')) {
      return
    }

    if (!confirm('This is your last chance. All businesses will be permanently deleted. Continue?')) {
      return
    }

    try {
      await invoke('delete_all_businesses')
      await loadClients()
      toast.success('All businesses deleted successfully')
    } catch (error) {
      console.error('Failed to delete all businesses:', error)
      toast.error('Failed to delete all businesses')
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading clients...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Client Businesses</h1>
            <p className="text-slate-600 text-lg">Manage all your client businesses ({clients.length} total)</p>
          </div>
          <div className="flex gap-3">
            {clients.length > 0 && (
              <button
                onClick={deleteAllBusinesses}
                className="bg-red-600 hover:bg-red-700 text-white py-3 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg"
              >
                🗑️ Delete All Businesses
              </button>
            )}
            <button
              onClick={onNavigateToOnboarding}
              className="bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg"
            >
              ➕ Onboard New Client
            </button>
          </div>
        </div>

        {clients.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 w-full">
            <div className="text-center">
              <div className="text-7xl mb-6">🏢</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">No Clients Yet</h2>
              <p className="text-slate-600 mb-8 text-lg">Start building your business by onboarding your first client</p>
            <button
              onClick={onNavigateToOnboarding}
              className="bg-blue-600 hover:bg-blue-700 text-white py-4 px-8 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg text-lg"
            >
              ➕ Onboard First Client
            </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 w-full">
            {clients.map((client) => (
              <div key={client.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 w-full">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-xl font-bold text-slate-800">{client.name}</h3>
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(client.is_active ? 'ACTIVE' : 'SUSPENDED')}`}>
                        {client.is_active ? 'ACTIVE' : 'SUSPENDED'}
                      </span>
                    </div>
                    <p className="text-slate-600 mb-1">Client ID: {client.client_id}</p>
                    <p className="text-slate-600 mb-1">📍 {client.address}</p>
                    <p className="text-slate-600">📧 {client.email || 'No email'}</p>
                  </div>

                  <div className="flex space-x-2 flex-wrap">
                    <button
                      onClick={() => viewAdminPassword(client.id)}
                      className="px-3 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-medium transition-colors text-sm"
                      title="View Admin Password"
                    >
                      🔑 View Password
                    </button>
                    <button
                      onClick={() => resetAdminPassword(client.id)}
                      className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors text-sm"
                      title="Reset Admin Password"
                    >
                      🔄 Reset Password
                    </button>
                    {client.is_active ? (
                      <>
                        <button
                          onClick={() => updateClientStatus(client.id, 'SUSPENDED')}
                          className="px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                          Suspend
                        </button>
                        <button
                          onClick={() => deleteClient(client.id)}
                          className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                          Terminate
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => updateClientStatus(client.id, 'ACTIVE')}
                          className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                          Activate
                        </button>
                        <button
                          onClick={() => deleteClient(client.id)}
                          className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors text-sm"
                        >
                          Restore
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex justify-between items-center text-sm text-slate-500">
                  <span>Modules: {client.modules_enabled ? parseBusinessModules(client.modules_enabled).join(', ') : 'None'}</span>
                  <span>Status: {client.subscription_status || 'TRIAL'}</span>
                  <span>Last Sync: {client.last_sync || 'Never'}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {clients.length > 0 && (
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-4 w-full">
            <h4 className="font-semibold text-blue-800 mb-2">💡 Client Management Notes</h4>
            <ul className="text-blue-700 text-sm space-y-1">
              <li>• <strong>Suspend:</strong> Temporarily blocks cloud sync, client gets notification on next sync</li>
              <li>• <strong>Terminate:</strong> Permanently blocks cloud access, client keeps local software</li>
              <li>• <strong>Reactivate:</strong> Restores full cloud access for suspended clients</li>
              <li>• <strong>Local Data:</strong> Client's local database remains intact and functional</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

function ClientOnboarding({ onComplete, currentUser }: { onComplete?: () => void, currentUser: any }) {
  const [currentStep, setCurrentStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [createdBusiness, setCreatedBusiness] = useState<any>(null)
  const [formData, setFormData] = useState({
    // Step 1: Business Info
    businessName: '',
    address: '',
    phone: '',
    email: '',

    // Step 2: Module Selection
    selectedModules: [] as string[],

    // Step 3: Branding
    primaryColor: '#3B82F6',
    secondaryColor: '#1F2937',

    // Step 4: Admin Account
    adminName: '',
    adminUsername: '',
    adminEmail: '',

    // Calculated
    totalPrice: 0
  })

  const totalSteps = 5

  const steps = [
    { number: 1, title: 'Business Info', icon: '🏢' },
    { number: 2, title: 'Modules', icon: '📦' },
    { number: 3, title: 'Branding', icon: '🎨' },
    { number: 4, title: 'Pricing', icon: '💰' },
    { number: 5, title: 'Admin Setup', icon: '👤' }
  ]

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <BusinessInfoStep formData={formData} updateFormData={updateFormData} />
      case 2:
        return <ModuleSelectionStep formData={formData} updateFormData={updateFormData} />
      case 3:
        return <BrandingStep formData={formData} updateFormData={updateFormData} />
      case 4:
        return <PricingStep formData={formData} />
      case 5:
        return <AdminSetupStep formData={formData} updateFormData={updateFormData} />
      default:
        return null
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return formData.businessName && formData.address
      case 2:
        return formData.selectedModules.length > 0
      case 3:
        return formData.primaryColor && formData.secondaryColor
      case 4:
        return true
      case 5:
        return formData.adminName && formData.adminUsername
      default:
        return false
    }
  }

  const handleCompleteSetup = async () => {
    if (!canProceed()) return

    if (!currentUser?.id) {
      toast.error('User session expired. Please login again.', {
        duration: 5000,
      })
      return
    }

    // Prevent double submission
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    try {
      // Calculate final price
      const finalPrice = formData.selectedModules.reduce((total: number, module: string) => {
        switch (module) {
          case 'BAR':
          case 'KITCHEN':
          case 'ROOM':
            return total + 200000
          default:
            return total
        }
      }, 0)

      // Apply discounts
      let discountedPrice = finalPrice
      if (formData.selectedModules.length === 2) {
        discountedPrice -= 50000 // ₦50,000 discount for 2 modules
      } else if (formData.selectedModules.length === 3) {
        discountedPrice -= 100000 // ₦100,000 discount for all modules
      }

      // Get the actual logged-in Super Super Admin ID
      const superAdminId = currentUser?.id


      if (!superAdminId) {
        toast.error('User session expired. Please login again.', {
          duration: 5000,
        })
        return
      }


      // Check if business already exists
      const exists = await invoke('check_business_exists', {
        name: formData.businessName,
        email: formData.email || null
      }) as boolean
      if (exists) {
        toast.error('A business with this name or email already exists. Please use a different name or email.', {
          duration: 6000,
        })
        setIsSubmitting(false)
        return
      }

      // Create the business
      const result = await invoke('create_business', {
        request: {
          name: formData.businessName,
          address: formData.address,
          phone: formData.phone,
          email: formData.email,
          theme_primary_color: formData.primaryColor,
          theme_secondary_color: formData.secondaryColor,
          modules_enabled: formData.selectedModules,
          createdBy: superAdminId
        }
      }) as { business_id: number; client_id: string }


      // Generate a secure temporary password
      const tempPassword = `Temp${Math.random().toString(36).slice(-8)}!`
      const passwordHash = btoa(tempPassword)


      // Create the business admin user
      
      // Ensure business_id is set
      if (!result.business_id) {
        toast.error('Failed to create business admin: Business ID is missing')
        console.error('Business creation returned no business_id:', result)
        setIsSubmitting(false)
        return
      }

      const userId = await invoke('create_user', {
        request: {
          username: formData.adminUsername.trim(), // Trim whitespace
          password_hash: passwordHash,
          role: 'SuperAdmin',
          name: formData.adminName,
          email: formData.adminEmail,
          business_id: result.business_id, // Ensure this is always set
          temporary_password: tempPassword
        }
      }) as number

      
      // Verify the user was created with the correct business_id
      if (!userId) {
        toast.error('Failed to create business admin user')
        setIsSubmitting(false)
        return
      }

      // Show the generated password to the Super Super Admin
      toast.success(`Business admin created successfully!\n\nUsername: ${formData.adminUsername.trim()}\nPassword: ${tempPassword}\n\n⚠️ Please save this password and share it securely with the client. They should change it on first login.`, {
        duration: 10000,
      })

      // Show success modal with business details
      setCreatedBusiness({
        name: formData.businessName,
        clientId: result.client_id,
        price: discountedPrice,
        adminUsername: formData.adminUsername.trim(),
        adminPassword: tempPassword // Use the actual generated password
      })
      setShowSuccessModal(true)

      // Reset form
      setCurrentStep(1)
      setFormData({
        businessName: '',
        address: '',
        phone: '',
        email: '',
        selectedModules: [],
        primaryColor: '#3B82F6',
        secondaryColor: '#1F2937',
        adminName: '',
        adminUsername: '',
        adminEmail: '',
        totalPrice: 0
      })

    } catch (error) {
      console.error('Setup failed:', error)
      toast.error(`Setup failed: ${error}. Please check the console for details and try again.`, {
        duration: 6000,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Client Onboarding Wizard</h1>
          <p className="text-slate-600 text-lg">Set up a new business account for your client</p>
        </div>

        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            {steps.map((step, index) => (
              <div key={step.number} className="flex items-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold ${
                  currentStep > step.number
                    ? 'bg-green-500 text-white'
                    : currentStep === step.number
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-300 text-slate-600'
                }`}>
                  {currentStep > step.number ? '✓' : step.icon}
                </div>
                <div className="ml-3">
                  <div className={`text-sm font-medium ${
                    currentStep >= step.number ? 'text-slate-800' : 'text-slate-500'
                  }`}>
                    Step {step.number}
                  </div>
                  <div className={`text-xs ${
                    currentStep >= step.number ? 'text-slate-600' : 'text-slate-400'
                  }`}>
                    {step.title}
                  </div>
                </div>
                {index < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-4 ${
                    currentStep > step.number ? 'bg-green-500' : 'bg-slate-300'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full">
          <div className="p-8 max-h-[70vh] overflow-y-auto">
            {renderStepContent()}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <button
            onClick={prevStep}
            disabled={currentStep === 1}
            className="px-6 py-3 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 rounded-lg font-medium transition-colors"
          >
            ← Previous
          </button>

          {currentStep < totalSteps ? (
            <button
              onClick={nextStep}
              disabled={!canProceed()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              Next →
          </button>
          ) : (
        <button
              onClick={handleCompleteSetup}
              disabled={!canProceed() || isSubmitting}
              className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              {isSubmitting ? '🚀 Creating Business...' : '🚀 Complete Setup'}
            </button>
          )}
        </div>
      </div>

      {/* Success Modal */}
      {showSuccessModal && createdBusiness && (
        <BusinessCreationSuccessModal
          business={createdBusiness}
          onClose={() => {
            setShowSuccessModal(false)
            setCreatedBusiness(null)
            if (onComplete) {
              onComplete()
            }
          }}
        />
      )}
    </div>
  )
}

function BusinessCreationSuccessModal({ business, onClose }: {
  business: any
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6 rounded-t-2xl">
          <div className="flex items-center justify-center mb-4">
            <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center">
              <span className="text-3xl">🎉</span>
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center mb-2">Business Created Successfully!</h2>
          <p className="text-green-100 text-center text-sm">Your client is now ready to start using their POS system</p>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="space-y-4 mb-6">
            <div className="bg-slate-50 rounded-lg p-4">
              <h3 className="font-semibold text-slate-800 mb-3 flex items-center">
                <span className="text-lg mr-2">🏢</span>
                Business Details
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Business Name:</span>
                  <span className="font-medium text-slate-800">{business.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Client ID:</span>
                  <span className="font-mono text-slate-800">{business.clientId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total Price:</span>
                  <span className="font-bold text-green-600">₦{business.price.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="font-semibold text-blue-800 mb-3 flex items-center">
                <span className="text-lg mr-2">👤</span>
                Admin Account Created
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-blue-700">Username:</span>
                  <span className="font-mono font-medium text-blue-800">{business.adminUsername}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-700">Password:</span>
                  <span className="font-mono font-medium text-blue-800">{business.adminPassword}</span>
                </div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start">
                <span className="text-amber-600 text-xl mr-3 mt-0.5">⚠️</span>
                <div>
                  <h4 className="font-semibold text-amber-800 mb-1">Important</h4>
                  <p className="text-amber-700 text-sm">
                    Please provide these credentials to your client. They should change their password after first login for security.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className="flex-1 bg-slate-600 hover:bg-slate-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => {
                // Copy credentials to clipboard
                const credentials = `Business: ${business.name}\nClient ID: ${business.clientId}\nUsername: ${business.adminUsername}\nPassword: ${business.adminPassword}`
                navigator.clipboard.writeText(credentials)
                toast.success('Credentials copied to clipboard!')
              }}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              📋 Copy Details
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SystemReports() {
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<any>(null)
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(1)).toISOString().split('T')[0], // First day of month
    end: new Date().toISOString().split('T')[0] // Today
  })

  useEffect(() => {
    loadSummary()
  }, [dateRange])

  const loadSummary = async () => {
    try {
      setLoading(true)
      const result = await invoke('get_system_revenue_summary', {
        start_date: dateRange.start,
        end_date: dateRange.end
      }) as any
      setSummary(result)
    } catch (error) {
      console.error('Failed to load system summary:', error)
      toast.error('Failed to load system reports')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading system reports...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">System Reports</h1>
          <p className="text-slate-600 text-lg">View system-wide analytics and performance metrics</p>
        </div>

        {/* Date Range Filter */}
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 mb-2">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={loadSummary}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                <div className="text-3xl mb-2">💰</div>
                <div className="text-2xl font-bold mb-1">₦{summary.total_revenue?.toLocaleString() || '0'}</div>
                <div className="text-blue-100 text-sm">Total Revenue ({dateRange.start} to {dateRange.end})</div>
              </div>
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                <div className="text-3xl mb-2">📊</div>
                <div className="text-2xl font-bold mb-1">{summary.total_transactions || 0}</div>
                <div className="text-green-100 text-sm">Total Transactions</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white">
                <div className="text-3xl mb-2">🏢</div>
                <div className="text-2xl font-bold mb-1">{summary.total_businesses || 0}</div>
                <div className="text-purple-100 text-sm">Active Clients</div>
              </div>
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-6 text-white">
                <div className="text-3xl mb-2">📈</div>
                <div className="text-2xl font-bold mb-1">₦{summary.average_revenue_per_business?.toLocaleString() || '0'}</div>
                <div className="text-orange-100 text-sm">Avg Revenue per Client</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">📅 Today's Revenue</h3>
                <div className="text-3xl font-bold text-green-600">₦{summary.today_revenue?.toLocaleString() || '0'}</div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">📆 This Month's Revenue</h3>
                <div className="text-3xl font-bold text-blue-600">₦{summary.month_revenue?.toLocaleString() || '0'}</div>
              </div>
            </div>

            {/* Client Performance */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-xl font-bold text-slate-800">Client Performance</h2>
                <p className="text-slate-600 text-sm mt-1">Revenue by client business</p>
              </div>
              <div className="md:hidden divide-y divide-slate-200">
                {summary.business_revenue && summary.business_revenue.length > 0 ? (
                  summary.business_revenue.map((business: any, index: number) => (
                    <div key={business.business_id} className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <span className="text-blue-600 font-bold text-sm">{index + 1}</span>
                        </div>
                        <p className="font-medium text-slate-800">{business.business_name}</p>
                      </div>
                      <dl className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Revenue</dt>
                          <dd className="font-semibold text-slate-800">₦{business.revenue?.toLocaleString() || '0'}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Transactions</dt>
                          <dd className="text-slate-700">{business.transactions || 0}</dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Avg per transaction</dt>
                          <dd className="text-slate-700">
                            ₦{business.transactions > 0 ? (business.revenue / business.transactions).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  ))
                ) : (
                  <p className="px-6 py-8 text-center text-slate-500">
                    No revenue data available for the selected date range
                  </p>
                )}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-slate-700 uppercase">Business</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-700 uppercase">Revenue</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-700 uppercase">Transactions</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-slate-700 uppercase">Avg per Transaction</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {summary.business_revenue && summary.business_revenue.length > 0 ? (
                      summary.business_revenue.map((business: any, index: number) => (
                        <tr key={business.business_id} className="hover:bg-slate-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="flex items-center">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center mr-3">
                                <span className="text-blue-600 font-bold">{index + 1}</span>
                              </div>
                              <div className="font-medium text-slate-800">{business.business_name}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right font-semibold text-slate-800">
                            ₦{business.revenue?.toLocaleString() || '0'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-slate-600">
                            {business.transactions || 0}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-slate-600">
                            ₦{business.transactions > 0 ? (business.revenue / business.transactions).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                          No revenue data available for the selected date range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Onboarding Step Components
function BusinessInfoStep({ formData, updateFormData }: {
  formData: any
  updateFormData: (field: string, value: any) => void
}) {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Business Information</h2>
        <p className="text-slate-600">Tell us about your client's business</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Business Name *
          </label>
          <input
            type="text"
            value={formData.businessName}
            onChange={(e) => updateFormData('businessName', e.target.value)}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter business name"
          />
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Business Address *
          </label>
          <textarea
            value={formData.address}
            onChange={(e) => updateFormData('address', e.target.value)}
            rows={3}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Enter complete business address"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Phone Number
          </label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => updateFormData('phone', e.target.value)}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="+234 xxx xxx xxxx"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">
            Email Address
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData('email', e.target.value)}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="business@email.com"
          />
        </div>
      </div>
    </div>
  )
}

function ModuleSelectionStep({ formData, updateFormData }: {
  formData: any
  updateFormData: (field: string, value: any) => void
}) {
  const modules = [
    {
      id: 'BAR',
      name: 'BAR Module',
      description: 'Drinks, cocktails, and beverage management',
      price: 200000,
      icon: '🍸'
    },
    {
      id: 'KITCHEN',
      name: 'Kitchen Module',
      description: 'Food orders, recipes, and kitchen operations',
      price: 200000,
      icon: '👨‍🍳'
    },
    {
      id: 'ROOM',
      name: 'Room Module',
      description: 'Hotel rooms, bookings, and amenities',
      price: 200000,
      icon: '🏨'
    }
  ]

  const toggleModule = (moduleId: string) => {
    const currentModules = formData.selectedModules
    const newModules = currentModules.includes(moduleId)
      ? currentModules.filter((id: string) => id !== moduleId)
      : [...currentModules, moduleId]

    updateFormData('selectedModules', newModules)
  }

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Select Business Modules</h2>
        <p className="text-slate-600">Choose which services your client needs</p>
      </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {modules.map((module) => {
          const isSelected = formData.selectedModules.includes(module.id)

          return (
            <div
              key={module.id}
              onClick={() => toggleModule(module.id)}
              className={`border-2 rounded-xl p-6 cursor-pointer transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 shadow-lg'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">{module.icon}</div>
                <h3 className="text-lg font-semibold text-slate-800">{module.name}</h3>
                <p className="text-slate-600 text-sm mt-1">{module.description}</p>
          </div>

              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-slate-800">
                  ₦{module.price.toLocaleString()}
                </span>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                  isSelected ? 'bg-blue-500 border-blue-500' : 'border-slate-300'
                }`}>
                  {isSelected && <span className="text-white text-sm">✓</span>}
          </div>
          </div>
        </div>
          )
        })}
      </div>

      {formData.selectedModules.length > 0 && (
        <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="font-semibold text-blue-800 mb-2">Selected Modules:</h4>
          <div className="flex flex-wrap gap-2">
            {formData.selectedModules.map((moduleId: string) => {
              const module = modules.find(m => m.id === moduleId)
              return module ? (
                <span key={moduleId} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm">
                  {module.icon} {module.name}
                </span>
              ) : null
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function BrandingStep({ formData, updateFormData }: {
  formData: any
  updateFormData: (field: string, value: any) => void
}) {
  const colorOptions = [
    { name: 'Blue', primary: '#3B82F6', secondary: '#1F2937' },
    { name: 'Green', primary: '#10B981', secondary: '#064E3B' },
    { name: 'Purple', primary: '#8B5CF6', secondary: '#581C87' },
    { name: 'Orange', primary: '#F59E0B', secondary: '#92400E' },
    { name: 'Red', primary: '#EF4444', secondary: '#991B1B' },
    { name: 'Teal', primary: '#14B8A6', secondary: '#134E4A' }
  ]

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Business Branding</h2>
        <p className="text-slate-600">Customize the look and feel for your client's business</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Choose Color Theme</h3>
          <div className="grid grid-cols-2 gap-4">
            {colorOptions.map((color) => (
              <button
                key={color.name}
                onClick={() => {
                  updateFormData('primaryColor', color.primary)
                  updateFormData('secondaryColor', color.secondary)
                }}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.primaryColor === color.primary
                    ? 'border-slate-800 shadow-lg'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex space-x-2 mb-2">
                  <div
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: color.primary }}
                  />
                  <div
                    className="w-6 h-6 rounded"
                    style={{ backgroundColor: color.secondary }}
                  />
                </div>
                <span className="text-sm font-medium text-slate-700">{color.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Preview</h3>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div
              className="h-16 flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: formData.primaryColor }}
            >
              Header - {formData.businessName || 'Business Name'}
            </div>
            <div className="p-4 bg-white">
              <div
                className="inline-block px-4 py-2 rounded text-white text-sm font-medium mb-3"
                style={{ backgroundColor: formData.primaryColor }}
              >
                Primary Button
              </div>
              <div
                className="inline-block px-4 py-2 rounded border text-sm font-medium"
                style={{
                  borderColor: formData.secondaryColor,
                  color: formData.secondaryColor
                }}
              >
                Secondary Button
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 p-4 bg-slate-50 rounded-lg">
        <h4 className="font-semibold text-slate-800 mb-2">Custom Colors (Optional)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Primary Color</label>
            <input
              type="color"
              value={formData.primaryColor}
              onChange={(e) => updateFormData('primaryColor', e.target.value)}
              className="w-full h-12 border border-slate-300 rounded cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-600 mb-1">Secondary Color</label>
            <input
              type="color"
              value={formData.secondaryColor}
              onChange={(e) => updateFormData('secondaryColor', e.target.value)}
              className="w-full h-12 border border-slate-300 rounded cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function PricingStep({ formData }: { formData: any }) {
  const calculatePrice = () => {
    return formData.selectedModules.reduce((total: number, module: string) => {
      switch (module) {
        case 'BAR':
        case 'KITCHEN':
        case 'ROOM':
          return total + 200000
        default:
          return total
      }
    }, 0)
  }

  const basePrice = calculatePrice()
  const discount = formData.selectedModules.length === 2 ? 50000 :
                   formData.selectedModules.length === 3 ? 100000 : 0
  const finalPrice = Math.max(0, basePrice - discount)

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Pricing Summary</h2>
        <p className="text-slate-600">Review the pricing for your client's selected modules</p>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Business: {formData.businessName || 'Business Name'}</h3>

          <div className="space-y-3 mb-6">
            <h4 className="font-semibold text-slate-700">Selected Modules:</h4>
            {formData.selectedModules.map((module: string) => (
              <div key={module} className="flex justify-between items-center py-2 border-b border-slate-100">
                <span className="text-slate-700">{module} Module</span>
                <span className="font-semibold">₦200,000</span>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-2">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span>₦{basePrice.toLocaleString()}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Bundle Discount:</span>
                <span>-₦{discount.toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-xl font-bold text-slate-800 border-t border-slate-300 pt-2">
              <span>Total Price:</span>
              <span>₦{finalPrice.toLocaleString()}</span>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-800 mb-2">💰 Monthly Support (Optional)</h4>
          <div className="flex justify-between items-center">
            <span className="text-blue-700">Basic Support Package</span>
            <span className="font-semibold text-blue-800">₦15,000/month</span>
          </div>
          <p className="text-xs text-blue-600 mt-1">
            Includes updates, technical support, and maintenance
          </p>
        </div>
      </div>
    </div>
  )
}

function AdminSetupStep({ formData, updateFormData }: {
  formData: any
  updateFormData: (field: string, value: any) => void
}) {
  return (
    <div>
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Business Admin Account</h2>
        <p className="text-slate-600">Create the main administrator account for this business</p>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <span className="text-amber-600 text-xl mr-3">⚠️</span>
            <div>
              <h4 className="font-semibold text-amber-800 mb-1">Important</h4>
              <p className="text-amber-700 text-sm">
                This will create the business owner account. They can later create additional staff accounts
                (Manager, Secretary, Staff) from within their business dashboard.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Admin Full Name *
            </label>
            <input
              type="text"
              value={formData.adminName}
              onChange={(e) => updateFormData('adminName', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter admin's full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Username *
            </label>
            <input
              type="text"
              value={formData.adminUsername}
              onChange={(e) => updateFormData('adminUsername', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Choose a username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={formData.adminEmail}
              onChange={(e) => updateFormData('adminEmail', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="admin@business.com"
            />
          </div>

          <div className="md:col-span-2">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <h4 className="font-semibold text-slate-800 mb-2">Account Details</h4>
              <div className="text-sm text-slate-600 space-y-1">
                <p><strong>Role:</strong> Business Administrator</p>
                <p><strong>Permissions:</strong> Full business management, staff creation, reports</p>
                <p><strong>Password:</strong> Will be auto-generated and emailed to admin</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 p-6 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="font-semibold text-green-800 mb-3">🎉 Setup Complete!</h4>
          <p className="text-green-700 text-sm mb-3">
            Clicking "Complete Setup" will:
          </p>
          <ul className="text-green-700 text-sm space-y-1">
            <li>• Create the business account</li>
            <li>• Set up selected modules</li>
            <li>• Configure branding and theme</li>
            <li>• Create the business admin account</li>
            <li>• Generate invoice for ₦{Math.max(0, formData.selectedModules.reduce((total: number, module: string) => {
              switch (module) {
                case 'BAR':
                case 'KITCHEN':
                case 'ROOM':
                  return total + 200000
                default:
                  return total
              }
            }, 0) - (formData.selectedModules.length === 2 ? 50000 : formData.selectedModules.length === 3 ? 100000 : 0)).toLocaleString()}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

// Business Components
function BusinessDashboard({
  currentUser,
  onNavigate,
}: {
  currentUser: any
  onNavigate?: (section: string) => void
}) {
  const [staffCount, setStaffCount] = useState<any>(null)
  const [showAddStaff, setShowAddStaff] = useState(false)
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    todaySales: 0,
    itemsInStock: 0,
    activeStaff: 0,
    lowStockAlerts: 0,
  })

  useEffect(() => {
    if (currentUser?.business_id) {
      void loadDashboard()
    } else {
      setLoading(false)
    }
  }, [currentUser])

  const loadDashboard = async () => {
    setLoading(true)
    try {
      const [count, data] = await Promise.all([
        invoke('get_business_staff_count', { businessId: currentUser.business_id }),
        invoke('get_dashboard_metrics', { businessId: currentUser.business_id }) as Promise<any>,
      ])
      setStaffCount(count)
      if (data) setMetrics(data)
    } catch {
      toast.error('Failed to load dashboard data')
    } finally {
      setLoading(false)
    }
  }

  const handleAddStaff = async (staffData: any) => {
    try {
      const tempPassword = `Staff${Math.random().toString(36).slice(-6)}!`
      const passwordHash = btoa(tempPassword)

      await invoke('create_user', {
        request: {
          username: staffData.username,
          password_hash: passwordHash,
          role: staffData.role,
          name: staffData.name,
          email: staffData.email,
          business_id: currentUser.business_id,
          temporary_password: tempPassword
        }
      })

      toast.success(`Staff member added successfully!\n\nUsername: ${staffData.username}\nPassword: ${tempPassword}\n\nPlease save this password and share it securely.`, {
        duration: 8000,
      })

      setShowAddStaff(false)
      void loadDashboard()
    } catch {
      toast.error('Failed to add staff member')
    }
  }

  const firstName = String(currentUser?.name || currentUser?.username || 'there').split(' ')[0]
  const canManageStaff = currentUser?.role === 'SuperAdmin' || currentUser?.role === 'Manager'
  const formatMoney = (n: number) =>
    `₦${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  if (loading) {
    return <PageLoader label="Loading dashboard…" />
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 sm:mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Overview
            </p>
            <h1 className="font-display text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
              Good day, {firstName}
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
              Track sales, stock, and floor activity from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate?.('inventory')}
              className="border border-[#121c19]/15 hover:border-[#121c19]/35 hover:bg-white text-[#121c19] px-5 py-2.5 rounded-md text-sm font-semibold transition-colors"
            >
              Inventory
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('pending')}
              className="bg-[#121c19] hover:bg-[#1a2924] text-white px-5 py-2.5 rounded-md text-sm font-semibold transition-colors"
            >
              Pending items
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          <MetricCard title="Today's sales" value={formatMoney(metrics.todaySales)} accent="teal" />
          <MetricCard title="Items in stock" value={String(metrics.itemsInStock)} accent="ink" />
          <MetricCard
            title="Active staff"
            value={String(metrics.activeStaff || staffCount?.total || 0)}
            accent="copper"
          />
          <MetricCard title="Low stock alerts" value={String(metrics.lowStockAlerts)} accent="rose" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6 mb-8">
          <section className="xl:col-span-3 rounded-xl border border-[#d4dcd8] bg-white p-6 sm:p-7">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="font-display text-xl font-bold text-[#121c19]">Quick actions</h2>
                <p className="text-sm text-[#2a3d36]/55 mt-1">Jump into everyday tasks</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onNavigate?.('inventory')}
                className="text-left rounded-lg border border-[#d4dcd8] hover:border-[#c4783a]/50 hover:bg-[#f4f6f5] p-4 transition-colors"
              >
                <p className="font-semibold text-[#121c19]">Inventory</p>
                <p className="text-sm text-[#2a3d36]/55 mt-1">Check stock levels</p>
              </button>
              <button
                type="button"
                onClick={() => onNavigate?.('pending')}
                className="text-left rounded-lg border border-[#d4dcd8] hover:border-[#c4783a]/50 hover:bg-[#f4f6f5] p-4 transition-colors"
              >
                <p className="font-semibold text-[#121c19]">Pending items</p>
                <p className="text-sm text-[#2a3d36]/55 mt-1">Review open work</p>
              </button>
            </div>
          </section>

          <section className="xl:col-span-2 rounded-xl border border-[#d4dcd8] bg-white p-6 sm:p-7">
            <h2 className="font-display text-xl font-bold text-[#121c19]">Recent activity</h2>
            <p className="text-sm text-[#2a3d36]/55 mt-1 mb-8">Latest floor and sales events</p>
            <div className="rounded-lg border border-dashed border-[#d4dcd8] bg-[#f4f6f5]/70 px-4 py-10 text-center">
              <p className="font-medium text-[#121c19]">No activity yet</p>
              <p className="text-sm text-[#2a3d36]/55 mt-1">Sales and stock changes will show here.</p>
            </div>
          </section>
        </div>

        {staffCount && canManageStaff && (
          <section className="rounded-xl border border-[#d4dcd8] bg-white p-6 sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
              <div>
                <h2 className="font-display text-xl font-bold text-[#121c19]">Staff overview</h2>
                <p className="text-sm text-[#2a3d36]/55 mt-1">
                  {staffCount.total}/{staffCount.limits.max_total} seats in use
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStaff(true)}
                disabled={staffCount.available.total <= 0}
                className="bg-[#121c19] hover:bg-[#1a2924] disabled:bg-[#121c19]/35 text-white px-5 py-2.5 rounded-md text-sm font-semibold transition-colors disabled:cursor-not-allowed"
              >
                {staffCount.available.total <= 0 ? 'Staff limit reached' : 'Add staff member'}
              </button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Admin', value: staffCount.admin },
                { label: 'Manager', value: staffCount.manager, cap: `${staffCount.manager}/${staffCount.limits.max_manager}` },
                { label: 'Secretary', value: staffCount.secretary, cap: `${staffCount.secretary}/${staffCount.limits.max_secretary}` },
                { label: 'Staff', value: staffCount.staff, cap: `${staffCount.staff}/${staffCount.limits.max_staff}` },
              ].map((item) => (
                <div key={item.label} className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5]/80 px-4 py-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#2a3d36]/50">{item.label}</p>
                  <p className="font-display text-2xl font-bold text-[#121c19] mt-1">{item.value}</p>
                  {item.cap && <p className="text-xs text-[#2a3d36]/45 mt-1">{item.cap}</p>}
                </div>
              ))}
            </div>

            {staffCount.available.total <= 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-4 py-3">
                Maximum staff limit reached. Contact an administrator for additional seats.
              </p>
            )}
          </section>
        )}
      </div>

      {showAddStaff && staffCount && (
        <AddStaffModal
          onClose={() => setShowAddStaff(false)}
          onSave={handleAddStaff}
          staffLimits={staffCount}
        />
      )}
    </div>
  )
}

function ProductManagement({ businessInfo, currentUser }: { businessInfo: any, currentUser: any }) {
  const [products, setProducts] = useState<any[]>([])
  const [packagingTypes, setPackagingTypes] = useState<{ id: number; name: string }[]>([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any | null>(null)
  const [showPackagingModal, setShowPackagingModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)
  const [searchQuery, setSearchQuery] = useState('')
  const [packagingFilter, setPackagingFilter] = useState('ALL')

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      void loadAll()
    } else {
      setLoading(false)
    }
  }, [businessId])

  const loadAll = async () => {
    setLoading(true)
    try {
      await Promise.all([loadProducts(), loadPackagingTypes()])
    } finally {
      setLoading(false)
    }
  }

  const loadProducts = async () => {
    try {
      if (!businessId) {
        setProducts([])
        return
      }
      const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
      setProducts(Array.isArray(businessProducts) ? businessProducts : [])
    } catch {
      toast.error('Failed to load products. Please try refreshing the page.')
      setProducts([])
    }
  }

  const loadPackagingTypes = async () => {
    if (!businessId) {
      setPackagingTypes([])
      return
    }
    try {
      const rows = await invoke('get_product_categories', { businessId }) as any[]
      const list = Array.isArray(rows) ? rows : []
      setPackagingTypes(list.map((c) => ({ id: c.id, name: c.name })))
    } catch {
      setPackagingTypes([])
    }
  }

  const ensureDefaultPackaging = async () => {
    if (!businessId) return
    const existingNames = new Set(packagingTypes.map((c) => c.name.toLowerCase()))
    const defaults = ['Can', 'Plastic Bottle', 'Bottle', 'Glass']
    for (const name of defaults) {
      if (!existingNames.has(name.toLowerCase())) {
        try {
          await invoke('create_product_category', {
            request: { business_id: businessId, name },
          })
          existingNames.add(name.toLowerCase())
        } catch {
          // ignore duplicates
        }
      }
    }
    await loadPackagingTypes()
  }

  useEffect(() => {
    if (businessId && !loading && packagingTypes.length === 0) {
      void ensureDefaultPackaging()
    }
  }, [businessId, loading])

  const addProduct = async (productData: any) => {
    try {
      const id = currentUser?.business_id || businessInfo?.id || productData.business_id
      if (!id) {
        toast.error('Business ID not found. Please log out and log back in.')
        return
      }

      await invoke('create_product', {
        request: {
          business_id: id,
          name: productData.name,
          description: productData.description || '',
          category: 'BAR',
          packaging: productData.packaging || null,
          price: productData.price || 0,
          cost_price: productData.costPrice || productData.cost_price || 0,
          stock_quantity: productData.stockQuantity || productData.stock_quantity || 0,
          min_stock_level: productData.minStockLevel || productData.min_stock_level || 0,
          fridge_stock: productData.fridgeStock || productData.fridge_stock || 0,
          show_stock: productData.showStock || productData.show_stock || 0,
          store_stock: productData.storeStock || productData.store_stock || 0,
          image_path: productData.image_path || productData.imagePath || null,
        },
      })
      toast.success('Product added successfully!')
      await loadProducts()
      await loadPackagingTypes()
      setShowAddModal(false)
    } catch (error) {
      toast.error(`Failed to add product: ${error}`)
    }
  }

  const saveProductEdit = async (productData: any) => {
    try {
      const id = currentUser?.business_id || businessInfo?.id
      if (!id || !productData.id) {
        toast.error('Missing product or business id')
        return
      }
      await invoke('update_product', {
        request: {
          id: productData.id,
          business_id: id,
          name: productData.name,
          description: productData.description || '',
          category: 'BAR',
          packaging: productData.packaging || null,
          price: productData.price || 0,
          cost_price: productData.costPrice || productData.cost_price || 0,
          min_stock_level: productData.minStockLevel || productData.min_stock_level || 0,
          fridge_stock: productData.fridgeStock || productData.fridge_stock || 0,
          show_stock: productData.showStock || productData.show_stock || 0,
          store_stock: productData.storeStock || productData.store_stock || 0,
          image_path: productData.image_path || productData.imagePath || null,
        },
      })
      toast.success('Product updated')
      await loadProducts()
      setEditingProduct(null)
    } catch (error) {
      toast.error(`Failed to update product: ${error}`)
    }
  }

  const filteredProducts = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return products.filter((product) => {
      const isBar = String(product.category || '').toUpperCase() === 'BAR'
      const matchesPackaging =
        packagingFilter === 'ALL' ||
        String(product.packaging || '').toLowerCase() === packagingFilter.toLowerCase()
      const haystack = [product.name, product.description, product.packaging]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return isBar && matchesPackaging && (!q || haystack.includes(q))
    })
  }, [products, searchQuery, packagingFilter])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, packagingFilter])

  if (loading) {
    return <PageLoader label="Loading catalog…" />
  }

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / itemsPerPage))
  const pageProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )
  const lowStockCount = products.filter((p) => {
    if (String(p.category || '').toUpperCase() !== 'BAR') return false
    const total =
      Number(p.fridge_stock || 0) + Number(p.show_stock || 0) + Number(p.store_stock || 0)
    const min = Number(p.min_stock_level || 0)
    return total > 0 && total <= min
  }).length

  const packagingOptions = Array.from(
    new Set([
      ...packagingTypes.map((c) => c.name),
      ...products.map((p) => String(p.packaging || '').trim()).filter(Boolean),
    ])
  ).sort((a, b) => a.localeCompare(b))

  const fieldClass =
    'w-full px-4 py-3 text-base bg-white border border-[#d4dcd8] rounded-md text-[#121c19] placeholder:text-[#2a3d36]/35 focus:outline-none focus:border-[#c4783a] focus:ring-2 focus:ring-[#c4783a]/20 transition-colors'

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Catalog
            </p>
            <h1 className="font-display text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
              Product management
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
              BAR drinks only. Set packaging as Can, Plastic Bottle, Bottle, and more.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setShowPackagingModal(true)}
              className="border border-[#121c19]/15 hover:border-[#121c19]/35 hover:bg-white text-[#121c19] px-5 py-2.5 rounded-md text-sm font-semibold transition-colors"
            >
              Packaging types
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="bg-[#121c19] hover:bg-[#1a2924] text-white px-5 py-2.5 rounded-md text-sm font-semibold transition-colors"
            >
              Add product
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <MetricCard title="BAR products" value={String(filteredProducts.length)} accent="ink" />
          <MetricCard title="Low stock" value={String(lowStockCount)} accent="rose" />
          <MetricCard title="Packaging types" value={String(packagingOptions.length)} accent="copper" />
        </div>

        <div className="mb-6 grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or packaging…"
            className={fieldClass}
          />
          <select
            value={packagingFilter}
            onChange={(e) => setPackagingFilter(e.target.value)}
            className={fieldClass}
          >
            <option value="ALL">All packaging</option>
            {packagingOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
            <p className="font-display text-2xl font-bold text-[#121c19]">
              {products.length === 0 ? 'No products yet' : 'No matching products'}
            </p>
            <p className="mt-2 text-[#2a3d36]/60 max-w-md mx-auto">
              {products.length === 0
                ? 'Add a BAR drink and choose packaging like Can or Plastic Bottle.'
                : 'Try another search or packaging filter.'}
            </p>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="bg-[#121c19] hover:bg-[#1a2924] text-white px-6 py-3 rounded-md text-sm font-semibold transition-colors"
              >
                Add product
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
            <div className="px-6 py-4 border-b border-[#d4dcd8] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-display text-lg font-bold text-[#121c19]">Product catalog</h2>
              <p className="text-sm text-[#2a3d36]/55">
                Showing {((currentPage - 1) * itemsPerPage) + 1}–
                {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of{' '}
                {filteredProducts.length}
              </p>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-[#e8ecea]">
              {pageProducts.map((product) => {
                const fridge = Number(product.fridge_stock || 0)
                return (
                  <article key={product.id} className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-12 rounded-lg bg-[#f4f6f5] border border-[#d4dcd8] overflow-hidden flex items-center justify-center shrink-0">
                        {product.image_path ? (
                          <ProductImage imagePath={product.image_path} alt={product.name} />
                        ) : (
                          <span className="text-[10px] font-bold text-[#2a3d36]/40 tracking-wide">
                            BAR
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-[#121c19] leading-snug">{product.name}</p>
                        <p className="text-xs text-[#2a3d36]/50 mt-0.5 line-clamp-2">
                          {product.description || 'No description'}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="inline-flex px-2 py-0.5 rounded-md text-xs font-semibold bg-white text-[#121c19] border border-[#d4dcd8]">
                            {product.packaging || 'No packaging'}
                          </span>
                          <span className="font-semibold text-[#121c19]">
                            ₦{Number(product.price || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-[#f4f6f5] border border-[#d4dcd8] p-3">
                      <div className="text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Fridge</p>
                        <p className={`mt-0.5 font-semibold ${fridge < 5 ? 'text-rose-600' : 'text-[#121c19]'}`}>{fridge}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Show</p>
                        <p className="mt-0.5 font-semibold text-[#121c19]">{Number(product.show_stock || 0)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Store</p>
                        <p className="mt-0.5 font-semibold text-[#121c19]">{Number(product.store_stock || 0)}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingProduct(product)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-semibold text-[#c4783a] bg-[#c4783a]/10 border border-[#c4783a]/20"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      Edit product
                    </button>
                  </article>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Product</th>
                    <th className="px-5 py-3 font-semibold">Packaging</th>
                    <th className="px-5 py-3 font-semibold">Price</th>
                    <th className="px-5 py-3 font-semibold text-center">Fridge</th>
                    <th className="px-5 py-3 font-semibold text-center">Show</th>
                    <th className="px-5 py-3 font-semibold text-center">Store</th>
                    <th className="px-5 py-3 font-semibold text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ecea]">
                  {pageProducts.map((product) => {
                    const fridge = Number(product.fridge_stock || 0)
                    return (
                      <tr key={product.id} className="hover:bg-[#f4f6f5]/70 transition-colors">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3 min-w-[180px]">
                            <div className="h-11 w-11 rounded-lg bg-[#f4f6f5] border border-[#d4dcd8] overflow-hidden flex items-center justify-center shrink-0">
                              {product.image_path ? (
                                <ProductImage imagePath={product.image_path} alt={product.name} />
                              ) : (
                                <span className="text-[10px] font-bold text-[#2a3d36]/40 tracking-wide">
                                  BAR
                                </span>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-[#121c19] truncate">{product.name}</p>
                              <p className="text-xs text-[#2a3d36]/50 truncate max-w-[220px]">
                                {product.description || 'No description'}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-semibold bg-white text-[#121c19] border border-[#d4dcd8]">
                            {product.packaging || '—'}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-semibold text-[#121c19] whitespace-nowrap">
                          ₦{Number(product.price || 0).toFixed(2)}
                        </td>
                        <td className={`px-5 py-4 text-center font-semibold ${fridge < 5 ? 'text-rose-600' : 'text-[#121c19]'}`}>
                          {fridge}
                        </td>
                        <td className="px-5 py-4 text-center font-semibold text-[#121c19]">
                          {Number(product.show_stock || 0)}
                        </td>
                        <td className="px-5 py-4 text-center font-semibold text-[#121c19]">
                          {Number(product.store_stock || 0)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          <button
                            type="button"
                            onClick={() => setEditingProduct(product)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-[#c4783a] hover:bg-[#c4783a]/10 border border-transparent hover:border-[#c4783a]/25 transition-colors"
                            title="Edit product"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {filteredProducts.length > itemsPerPage && (
              <div className="px-6 py-4 border-t border-[#d4dcd8] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 rounded-md border border-[#d4dcd8] text-sm font-semibold text-[#121c19] disabled:opacity-40 hover:bg-[#f4f6f5]"
                >
                  Previous
                </button>
                <p className="text-sm text-[#2a3d36]/60">
                  Page {currentPage} of {totalPages}
                </p>
                <button
                  type="button"
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 rounded-md border border-[#d4dcd8] text-sm font-semibold text-[#121c19] disabled:opacity-40 hover:bg-[#f4f6f5]"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}

        {showAddModal && (
          <ProductFormModal
            mode="add"
            onClose={() => setShowAddModal(false)}
            onSave={addProduct}
            businessId={businessId}
            packagingTypes={packagingOptions}
            onManagePackaging={() => {
              setShowAddModal(false)
              setShowPackagingModal(true)
            }}
          />
        )}

        {editingProduct && (
          <ProductFormModal
            mode="edit"
            product={editingProduct}
            onClose={() => setEditingProduct(null)}
            onSave={saveProductEdit}
            businessId={businessId}
            packagingTypes={packagingOptions}
            onManagePackaging={() => {
              setEditingProduct(null)
              setShowPackagingModal(true)
            }}
          />
        )}

        {showPackagingModal && (
          <PackagingTypesModal
            businessId={businessId}
            packagingTypes={packagingTypes}
            onClose={() => setShowPackagingModal(false)}
            onChanged={async () => {
              await loadPackagingTypes()
            }}
          />
        )}
      </div>
    </div>
  )
}

function PackagingTypesModal({
  businessId,
  packagingTypes,
  onClose,
  onChanged,
}: {
  businessId: number
  packagingTypes: { id: number; name: string }[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const suggestions = ['Can', 'Plastic Bottle', 'Bottle', 'Glass']

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      await invoke('create_product_category', {
        request: { business_id: businessId, name: trimmed },
      })
      setName('')
      toast.success(`Packaging "${trimmed}" created`)
      await onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to create packaging type')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (item: { id: number; name: string }) => {
    try {
      await invoke('delete_product_category', {
        id: item.id,
        business_id: businessId,
        name: item.name,
      })
      toast.success(`Removed "${item.name}"`)
      await onChanged()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete packaging type')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b1210]/55">
      <div className="w-full max-w-lg bg-white rounded-xl border border-[#d4dcd8] shadow-xl overflow-hidden">
        <div className="px-6 py-5 border-b border-[#d4dcd8] flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a]">
              Catalog
            </p>
            <h2 className="font-display text-2xl font-bold text-[#121c19] mt-1">Packaging types</h2>
            <p className="text-sm text-[#2a3d36]/60 mt-1">
              Packaging for BAR drinks — Can, Plastic Bottle, Bottle, Glass.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#2a3d36]/45 hover:text-[#121c19] text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleCreate} className="px-6 py-5 border-b border-[#d4dcd8] space-y-3">
          <label className="block text-sm font-semibold text-[#121c19]">New packaging type</label>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Plastic Bottle"
              className="flex-1 px-4 py-3 border border-[#d4dcd8] rounded-md focus:outline-none focus:border-[#c4783a] focus:ring-2 focus:ring-[#c4783a]/20"
            />
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="bg-[#121c19] hover:bg-[#1a2924] disabled:opacity-40 text-white px-5 py-3 rounded-md text-sm font-semibold"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setName(suggestion)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold border border-[#d4dcd8] text-[#121c19] hover:bg-[#f4f6f5]"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>

        <div className="px-6 py-5 max-h-72 overflow-y-auto">
          {packagingTypes.length === 0 ? (
            <p className="text-sm text-[#2a3d36]/55 text-center py-8">
              No packaging types yet. Add Can, Plastic Bottle, Bottle, or Glass.
            </p>
          ) : (
            <ul className="space-y-2">
              {packagingTypes.map((item) => (
                <li
                  key={`${item.id}-${item.name}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[#d4dcd8] px-4 py-3"
                >
                  <span className="font-semibold text-[#121c19]">{item.name}</span>
                  <button
                    type="button"
                    onClick={() => void handleDelete(item)}
                    className="text-sm font-semibold text-rose-600 hover:text-rose-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#d4dcd8] bg-[#f4f6f5]/60">
          <p className="text-xs text-[#2a3d36]/55">
            Products are BAR only. Packaging types (Can, Plastic Bottle, Bottle) are managed here.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 w-full bg-[#121c19] hover:bg-[#1a2924] text-white py-2.5 rounded-md text-sm font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductFormModal({
  mode,
  product,
  onClose,
  onSave,
  businessId,
  packagingTypes,
  onManagePackaging,
}: {
  mode: 'add' | 'edit'
  product?: any
  onClose: () => void
  onSave: (product: any) => void
  businessId: number
  packagingTypes: string[]
  onManagePackaging: () => void
}) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    description: product?.description || '',
    category: 'BAR',
    packaging: product?.packaging || packagingTypes[0] || '',
    price: product?.price != null ? String(product.price) : '',
    costPrice: product?.cost_price != null ? String(product.cost_price) : '',
    minStockLevel: product?.min_stock_level != null ? String(product.min_stock_level) : '5',
    fridgeStock: product?.fridge_stock != null ? String(product.fridge_stock) : '',
    showStock: product?.show_stock != null ? String(product.show_stock) : '',
    storeStock: product?.store_stock != null ? String(product.store_stock) : '',
    imagePath: product?.image_path || '',
  })
  const [imagePreview, setImagePreview] = useState<string | null>(product?.image_path || null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!formData.packaging && packagingTypes.length > 0) {
      setFormData((prev) => ({ ...prev, packaging: packagingTypes[0] }))
    }
  }, [packagingTypes])

  const fieldClass =
    'w-full px-4 py-3 text-base bg-white border border-[#d4dcd8] rounded-md text-[#121c19] placeholder:text-[#2a3d36]/35 focus:outline-none focus:border-[#c4783a] focus:ring-2 focus:ring-[#c4783a]/20 transition-colors'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave({
        ...formData,
        id: product?.id,
        category: 'BAR',
        packaging: formData.packaging || null,
        price: parseFloat(formData.price),
        costPrice: parseFloat(formData.costPrice),
        minStockLevel: parseInt(formData.minStockLevel) || 0,
        fridgeStock: parseInt(formData.fridgeStock) || 0,
        showStock: parseInt(formData.showStock) || 0,
        storeStock: parseInt(formData.storeStock) || 0,
        business_id: businessId,
        image_path: formData.imagePath,
      })
    } finally {
      setSaving(false)
    }
  }

  const updateFormData = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB')
      return
    }

    try {
      const reader = new FileReader()
      reader.onload = (ev) => setImagePreview(ev.target?.result as string)
      reader.readAsDataURL(file)

      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.onerror = reject
        r.readAsDataURL(file)
      })

      const imagePath = await invoke('save_product_image', {
        imageData: base64,
        productName: formData.name || 'product',
        businessId: businessId,
      }) as string

      setFormData((prev) => ({ ...prev, imagePath }))
      toast.success('Image uploaded successfully')
    } catch {
      setFormData((prev) => ({ ...prev, imagePath: imagePreview || '' }))
      toast.error('Image save is limited in web mode; product can still be saved without it')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0b1210]/55">
      <div className="w-full max-w-3xl bg-white rounded-xl border border-[#d4dcd8] shadow-xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="px-6 py-5 border-b border-[#d4dcd8] flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a]">
              Catalog
            </p>
            <h2 className="font-display text-2xl font-bold text-[#121c19] mt-1">
              {mode === 'edit' ? 'Edit product' : 'Add product'}
            </h2>
            <p className="text-sm text-[#2a3d36]/60 mt-1">
              Category is fixed to BAR. Choose packaging like Can, Plastic Bottle, or Bottle.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[#2a3d36]/45 hover:text-[#121c19] text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#2a3d36]/50">
              Basics
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Product name *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => updateFormData('name', e.target.value)}
                  className={fieldClass}
                  placeholder="e.g. Maltina"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => updateFormData('description', e.target.value)}
                  rows={3}
                  className={fieldClass}
                  placeholder="Optional details"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Category</label>
                <div className="px-4 py-3 rounded-md border border-[#d4dcd8] bg-[#f4f6f5] font-semibold text-[#121c19]">
                  BAR
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="block text-sm font-semibold text-[#121c19]">Packaging</label>
                  <button
                    type="button"
                    onClick={onManagePackaging}
                    className="text-sm font-semibold text-[#c4783a] hover:text-[#a35f2a]"
                  >
                    Manage
                  </button>
                </div>
                {packagingTypes.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[#d4dcd8] bg-[#f4f6f5] px-4 py-4">
                    <p className="text-sm text-[#2a3d36]/70 mb-3">
                      Add Can, Plastic Bottle, or Bottle for BAR drinks.
                    </p>
                    <button
                      type="button"
                      onClick={onManagePackaging}
                      className="bg-[#121c19] text-white px-4 py-2 rounded-md text-sm font-semibold"
                    >
                      Add packaging
                    </button>
                  </div>
                ) : (
                  <select
                    value={formData.packaging}
                    onChange={(e) => updateFormData('packaging', e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">None</option>
                    {packagingTypes.map((packaging) => (
                      <option key={packaging} value={packaging}>
                        {packaging}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#2a3d36]/50">
              Pricing
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Selling price (₦) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.price}
                  onChange={(e) => updateFormData('price', e.target.value)}
                  className={fieldClass}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Cost price (₦) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.costPrice}
                  onChange={(e) => updateFormData('costPrice', e.target.value)}
                  className={fieldClass}
                  placeholder="0.00"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#2a3d36]/50">
              Stock
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Fridge stock *</label>
                <input
                  type="number"
                  required
                  value={formData.fridgeStock}
                  onChange={(e) => updateFormData('fridgeStock', e.target.value)}
                  className={fieldClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Show stock</label>
                <input
                  type="number"
                  value={formData.showStock}
                  onChange={(e) => updateFormData('showStock', e.target.value)}
                  className={fieldClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Store stock</label>
                <input
                  type="number"
                  value={formData.storeStock}
                  onChange={(e) => updateFormData('storeStock', e.target.value)}
                  className={fieldClass}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-[#121c19] mb-2">Min stock level</label>
                <input
                  type="number"
                  value={formData.minStockLevel}
                  onChange={(e) => updateFormData('minStockLevel', e.target.value)}
                  className={fieldClass}
                  placeholder="5"
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#2a3d36]/50">
              Media
            </h3>
            <div>
              <label className="block text-sm font-semibold text-[#121c19] mb-2">Product image</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className={fieldClass}
              />
              {imagePreview && (
                <img
                  src={imagePreview}
                  alt="Product preview"
                  className="mt-3 w-28 h-28 object-cover rounded-md border border-[#d4dcd8]"
                />
              )}
            </div>
          </section>

          <div className="sticky bottom-0 -mx-6 px-6 py-4 border-t border-[#d4dcd8] bg-white flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-[#d4dcd8] hover:bg-[#f4f6f5] text-[#121c19] py-3 rounded-md font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-[#121c19] hover:bg-[#1a2924] disabled:opacity-40 text-white py-3 rounded-md font-semibold"
            >
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BusinessSales() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Sales Management</h1>
        <p className="text-slate-600 text-lg">Process orders and manage transactions</p>
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-12">
          <div className="text-center">
            <div className="text-6xl mb-4">💰</div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">POS Interface</h2>
            <p className="text-slate-600">Full sales interface coming next</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function KitchenOrderQueue({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'PENDING' | 'PREPARING' | 'READY' | 'COMPLETED'>('all')
  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      loadOrders()
      // Refresh every 5 seconds for real-time updates
      const interval = setInterval(loadOrders, 5000)
      return () => clearInterval(interval)
    }
  }, [businessId, filter])

  const loadOrders = async () => {
    try {
      setLoading(true)
      const status = filter === 'all' ? null : filter
      const result = await invoke('get_kitchen_orders', {
        business_id: businessId,
        status: status
      }) as any[]
      setOrders(result || [])
    } catch (error) {
      console.error('Failed to load kitchen orders:', error)
      toast.error('Failed to load kitchen orders')
    } finally {
      setLoading(false)
    }
  }

  const updateOrderStatus = async (orderId: number, status: string) => {
    try {
      await invoke('update_kitchen_order_status', {
        order_id: orderId,
        status: status,
        prepared_by: currentUser?.id || null
      })
      toast.success(`Order status updated to ${status}`)
      loadOrders()
    } catch (error) {
      console.error('Failed to update order status:', error)
      toast.error('Failed to update order status')
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300'
      case 'PREPARING':
        return 'bg-blue-100 text-blue-800 border-blue-300'
      case 'READY':
        return 'bg-green-100 text-green-800 border-green-300'
      case 'COMPLETED':
        return 'bg-slate-100 text-slate-800 border-slate-300'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300'
    }
  }

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  const getElapsedTime = (_createdAt: string, elapsedMinutes: number | null) => {
    if (!elapsedMinutes) return '-'
    if (elapsedMinutes < 60) return `${Math.floor(elapsedMinutes)}m`
    const hours = Math.floor(elapsedMinutes / 60)
    const mins = Math.floor(elapsedMinutes % 60)
    return `${hours}h ${mins}m`
  }

  // Group orders by status
  const pendingOrders = orders.filter(o => o.status === 'PENDING')
  const preparingOrders = orders.filter(o => o.status === 'PREPARING')
  const readyOrders = orders.filter(o => o.status === 'READY')

  if (loading && orders.length === 0) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading kitchen orders...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Kitchen Order Queue</h1>
          <p className="text-slate-600 text-lg">Manage and track kitchen orders in real-time</p>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex gap-2 overflow-x-auto">
            {[
              { value: 'all', label: 'All Orders', count: orders.length },
              { value: 'PENDING', label: 'Pending', count: pendingOrders.length },
              { value: 'PREPARING', label: 'Preparing', count: preparingOrders.length },
              { value: 'READY', label: 'Ready', count: readyOrders.length },
              { value: 'COMPLETED', label: 'Completed', count: orders.filter(o => o.status === 'COMPLETED').length },
            ].map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value as any)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                  filter === tab.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
        </div>

        {/* Kitchen Display View - Show active orders prominently */}
        {(pendingOrders.length > 0 || preparingOrders.length > 0 || readyOrders.length > 0) && (
          <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {pendingOrders.length > 0 && (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4">
                <div className="text-yellow-800 font-bold text-lg mb-2">⏳ Pending: {pendingOrders.length}</div>
                <div className="text-sm text-yellow-600">Orders waiting to start</div>
              </div>
            )}
            {preparingOrders.length > 0 && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4">
                <div className="text-blue-800 font-bold text-lg mb-2">👨‍🍳 Preparing: {preparingOrders.length}</div>
                <div className="text-sm text-blue-600">Orders being prepared</div>
              </div>
            )}
            {readyOrders.length > 0 && (
              <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4">
                <div className="text-green-800 font-bold text-lg mb-2">✅ Ready: {readyOrders.length}</div>
                <div className="text-sm text-green-600">Orders ready for pickup</div>
              </div>
            )}
          </div>
        )}

        {/* Orders List */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {orders.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-6xl mb-4">🍽️</div>
              <h3 className="text-xl font-bold text-slate-800 mb-2">No Kitchen Orders</h3>
              <p className="text-slate-600">Orders will appear here when KITCHEN category products are sold</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {orders.map(order => (
                <div
                  key={order.id}
                  className={`p-6 hover:bg-slate-50 transition-colors ${
                    order.status === 'READY' ? 'bg-green-50' :
                    order.status === 'PREPARING' ? 'bg-blue-50' :
                    order.status === 'PENDING' ? 'bg-yellow-50' : ''
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                        <span className="text-slate-600 text-sm">Order #{order.sale_id}</span>
                        <span className="text-slate-600 text-sm">•</span>
                        <span className="text-slate-600 text-sm">{formatTime(order.created_at)}</span>
                        {order.elapsed_minutes && (
                          <>
                            <span className="text-slate-600 text-sm">•</span>
                            <span className="text-slate-600 text-sm">⏱️ {getElapsedTime(order.created_at, order.elapsed_minutes)}</span>
                          </>
                        )}
                      </div>
                      
                      <h3 className="text-xl font-bold text-slate-800 mb-1">
                        {order.product_name} × {order.quantity}
                      </h3>
                      
                      {order.customer_name && (
                        <p className="text-slate-600 text-sm mb-2">Customer: {order.customer_name}</p>
                      )}
                      
                      <div className="flex gap-4 text-sm text-slate-600">
                        <span>Total: ₦{order.total_amount?.toLocaleString() || '0'}</span>
                        <span>•</span>
                        <span>Payment: {order.payment_method}</span>
                      </div>

                      {order.notes && (
                        <div className="mt-2 p-2 bg-slate-100 rounded text-sm text-slate-700">
                          <strong>Notes:</strong> {order.notes}
                        </div>
                      )}

                      {order.started_at && (
                        <p className="text-xs text-slate-500 mt-2">Started: {formatTime(order.started_at)}</p>
                      )}
                      {order.ready_at && (
                        <p className="text-xs text-slate-500">Ready: {formatTime(order.ready_at)}</p>
                      )}
                      {order.completed_at && (
                        <p className="text-xs text-slate-500">Completed: {formatTime(order.completed_at)}</p>
                      )}
                    </div>

                    <div className="ml-4 flex flex-col gap-2">
                      {order.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => updateOrderStatus(order.id, 'PREPARING')}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm whitespace-nowrap"
                          >
                            Start Preparing
                          </button>
                        </>
                      )}
                      {order.status === 'PREPARING' && (
                        <>
                          <button
                            onClick={() => updateOrderStatus(order.id, 'READY')}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm whitespace-nowrap"
                          >
                            Mark Ready
                          </button>
                        </>
                      )}
                      {order.status === 'READY' && (
                        <>
                          <button
                            onClick={() => updateOrderStatus(order.id, 'COMPLETED')}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg font-medium text-sm whitespace-nowrap"
                          >
                            Mark Completed
                          </button>
                        </>
                      )}
                      {order.status === 'COMPLETED' && (
                        <span className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg font-medium text-sm whitespace-nowrap text-center">
                          ✓ Completed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function BusinessInventory({ currentUser }: { currentUser: any }) {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [packagingFilter, setPackagingFilter] = useState('ALL')
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [transferModal, setTransferModal] = useState<any>(null)
  const isAdmin = currentUser?.role === 'SuperAdmin'
  const isSecretary = currentUser?.role === 'Secretary'
  const canEditStore = isAdmin || isSecretary

  useEffect(() => {
    void loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const businessId = currentUser?.business_id
      if (businessId) {
        const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
        setProducts(Array.isArray(businessProducts) ? businessProducts : [])
      }
    } catch {
      toast.error('Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateStoreStock = async (productId: number, newStock: number) => {
    try {
      await invoke('update_stock_type', {
        productId,
        stockType: 'store',
        quantityChange: newStock,
        userId: currentUser?.id || 1,
        reason: 'Store stock update',
      })
      toast.success('Store stock updated')
      await loadProducts()
      setEditingProduct(null)
    } catch {
      toast.error('Failed to update store stock')
    }
  }

  const handleTransferStock = async (productId: number, from: string, to: string, quantity: number) => {
    try {
      await invoke('transfer_stock', {
        productId,
        from,
        to,
        quantity,
        userId: currentUser?.id || 1,
      })
      toast.success(`Transferred from ${from} to ${to}`)
      await loadProducts()
      setTransferModal(null)
    } catch (error) {
      toast.error(`Failed to transfer stock: ${error}`)
    }
  }

  const barProducts = React.useMemo(
    () => products.filter((p) => String(p.category || '').toUpperCase() === 'BAR'),
    [products]
  )

  const packagingOptions = Array.from(
    new Set(barProducts.map((p) => String(p.packaging || '').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b))

  const filtered = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return barProducts.filter((product) => {
      const matchesPackaging =
        packagingFilter === 'ALL' ||
        String(product.packaging || '').toLowerCase() === packagingFilter.toLowerCase()
      const haystack = [product.name, product.packaging].filter(Boolean).join(' ').toLowerCase()
      return matchesPackaging && (!q || haystack.includes(q))
    })
  }, [barProducts, searchQuery, packagingFilter])

  const lowFridge = barProducts.filter((p) => Number(p.fridge_stock || 0) < 5).length
  const totalFridge = barProducts.reduce((s, p) => s + Number(p.fridge_stock || 0), 0)
  const totalStore = barProducts.reduce((s, p) => s + Number(p.store_stock || 0), 0)

  const fieldClass =
    'w-full px-4 py-3 text-base bg-white border border-[#d4dcd8] rounded-md text-[#121c19] placeholder:text-[#2a3d36]/35 focus:outline-none focus:border-[#c4783a] focus:ring-2 focus:ring-[#c4783a]/20 transition-colors'

  if (loading) {
    return <PageLoader label="Loading inventory…" />
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-8">
          <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
            Stock
          </p>
          <h1 className="font-display text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
            Inventory tracking
          </h1>
          <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
            Track fridge, show, and store levels for BAR products. Move stock from store when needed.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <MetricCard title="Fridge units" value={String(totalFridge)} accent="ink" />
          <MetricCard title="Store units" value={String(totalStore)} accent="copper" />
          <MetricCard title="Low fridge" value={String(lowFridge)} accent="rose" />
        </div>

        <div className="mb-6 grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-3">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search BAR products…"
            className={fieldClass}
          />
          <select
            value={packagingFilter}
            onChange={(e) => setPackagingFilter(e.target.value)}
            className={fieldClass}
          >
            <option value="ALL">All packaging</option>
            {packagingOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
          <div className="px-6 py-4 border-b border-[#d4dcd8]">
            <h2 className="font-display text-lg font-bold text-[#121c19]">Stock overview</h2>
            <p className="text-sm text-[#2a3d36]/55 mt-1">
              Fridge for POS · Show for display · Store for warehouse
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center text-[#2a3d36]/60">No BAR products found</div>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="md:hidden divide-y divide-[#e8ecea]">
                {filtered.map((product) => {
                  const fridge = Number(product.fridge_stock || 0)
                  const show = Number(product.show_stock || 0)
                  const store = Number(product.store_stock || 0)
                  const low = fridge < 5
                  return (
                    <article
                      key={product.id}
                      className={`p-4 space-y-3 ${low ? 'bg-rose-50/60' : ''}`}
                    >
                      <div>
                        <p className="font-semibold text-[#121c19]">{product.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-[#2a3d36]/50">
                            {product.packaging || 'No packaging'}
                          </span>
                          {low && (
                            <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-rose-500 text-white">
                              Low fridge
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 rounded-lg bg-white border border-[#d4dcd8] p-3">
                        <div className="text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Fridge</p>
                          <p className={`mt-0.5 font-semibold ${low ? 'text-rose-600' : 'text-[#121c19]'}`}>{fridge}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Show</p>
                          <p className="mt-0.5 font-semibold text-[#121c19]">{show}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#2a3d36]/45">Store</p>
                          {editingProduct?.id === product.id ? (
                            <input
                              type="number"
                              defaultValue={store}
                              autoFocus
                              className="w-16 mt-0.5 mx-auto block px-1 py-1 border border-[#d4dcd8] rounded-md text-center text-sm"
                              onBlur={(e) => {
                                const next = parseInt(e.target.value) || 0
                                const change = next - store
                                if (change !== 0) handleUpdateStoreStock(product.id, change)
                                else setEditingProduct(null)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const next = parseInt((e.target as HTMLInputElement).value) || 0
                                  const change = next - store
                                  if (change !== 0) handleUpdateStoreStock(product.id, change)
                                  else setEditingProduct(null)
                                } else if (e.key === 'Escape') {
                                  setEditingProduct(null)
                                }
                              }}
                            />
                          ) : (
                            <p className="mt-0.5 font-semibold text-[#121c19]">{store}</p>
                          )}
                        </div>
                      </div>
                      {canEditStore && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingProduct(product)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-semibold text-[#c4783a] bg-[#c4783a]/10 border border-[#c4783a]/20"
                          >
                            Edit store
                          </button>
                          {store > 0 && (
                            <>
                              <button
                                type="button"
                                onClick={() => setTransferModal({ product, from: 'store', to: 'fridge' })}
                                className="flex-1 px-3 py-2.5 rounded-md text-xs font-semibold bg-[#121c19] text-white"
                              >
                                To fridge
                              </button>
                              <button
                                type="button"
                                onClick={() => setTransferModal({ product, from: 'store', to: 'show' })}
                                className="flex-1 px-3 py-2.5 rounded-md text-xs font-semibold border border-[#121c19]/15 text-[#121c19]"
                              >
                                To show
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>

              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold text-center">Fridge</th>
                      <th className="px-5 py-3 font-semibold text-center">Show</th>
                      <th className="px-5 py-3 font-semibold text-center">Store</th>
                      <th className="px-5 py-3 font-semibold text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8ecea]">
                    {filtered.map((product) => {
                      const fridge = Number(product.fridge_stock || 0)
                      const show = Number(product.show_stock || 0)
                      const store = Number(product.store_stock || 0)
                      const low = fridge < 5
                      return (
                        <tr
                          key={product.id}
                          className={`hover:bg-[#f4f6f5]/70 transition-colors ${low ? 'bg-rose-50/60' : ''}`}
                        >
                          <td className="px-5 py-4">
                            <p className="font-semibold text-[#121c19]">{product.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-[#2a3d36]/50">
                                {product.packaging || 'No packaging'}
                              </span>
                              {low && (
                                <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-rose-500 text-white">
                                  Low fridge
                                </span>
                              )}
                            </div>
                          </td>
                          <td className={`px-5 py-4 text-center font-semibold ${low ? 'text-rose-600' : 'text-[#121c19]'}`}>
                            {fridge}
                          </td>
                          <td className="px-5 py-4 text-center font-semibold text-[#121c19]">{show}</td>
                          <td className="px-5 py-4 text-center">
                            {editingProduct?.id === product.id ? (
                              <input
                                type="number"
                                defaultValue={store}
                                autoFocus
                                className="w-20 mx-auto block px-2 py-1.5 border border-[#d4dcd8] rounded-md text-center"
                                onBlur={(e) => {
                                  const next = parseInt(e.target.value) || 0
                                  const change = next - store
                                  if (change !== 0) handleUpdateStoreStock(product.id, change)
                                  else setEditingProduct(null)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const next = parseInt((e.target as HTMLInputElement).value) || 0
                                    const change = next - store
                                    if (change !== 0) handleUpdateStoreStock(product.id, change)
                                    else setEditingProduct(null)
                                  } else if (e.key === 'Escape') {
                                    setEditingProduct(null)
                                  }
                                }}
                              />
                            ) : (
                              <span className="font-semibold text-[#121c19]">{store}</span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              {canEditStore && (
                                <button
                                  type="button"
                                  onClick={() => setEditingProduct(product)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-semibold text-[#c4783a] hover:bg-[#c4783a]/10 border border-[#c4783a]/20"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <path d="M12 20h9" />
                                    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                  </svg>
                                  Edit
                                </button>
                              )}
                              {canEditStore && store > 0 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setTransferModal({ product, from: 'store', to: 'fridge' })}
                                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-[#121c19] text-white hover:bg-[#1a2924]"
                                  >
                                    To fridge
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setTransferModal({ product, from: 'store', to: 'show' })}
                                    className="px-3 py-1.5 rounded-md text-xs font-semibold border border-[#121c19]/15 text-[#121c19] hover:bg-[#f4f6f5]"
                                  >
                                    To show
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {transferModal && (
          <TransferStockModal
            product={transferModal.product}
            from={transferModal.from}
            to={transferModal.to}
            onTransfer={handleTransferStock}
            onClose={() => setTransferModal(null)}
          />
        )}
      </div>
    </div>
  )
}

function TransferStockModal({ product, from, to, onTransfer, onClose }: {
  product: any
  from: string
  to: string
  onTransfer: (productId: number, from: string, to: string, quantity: number) => void
  onClose: () => void
}) {
  const [quantity, setQuantity] = useState(1)
  const maxQuantity = from === 'store' ? (product.store_stock || 0) : 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (quantity > 0 && quantity <= maxQuantity) {
      onTransfer(product.id, from, to, quantity)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Transfer Stock</h2>
        <p className="text-slate-600 mb-4">
          Transfer from <strong>{from}</strong> to <strong>{to}</strong> for <strong>{product.name}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Quantity (Max: {maxQuantity})
            </label>
            <input
              type="number"
              min="1"
              max={maxQuantity}
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-3 px-4 rounded-lg font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium"
            >
              Transfer
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BusinessStaff({ currentUser, businessInfo }: { currentUser?: any, businessInfo?: any }) {
  const [staff, setStaff] = useState<any[]>([])
  const [staffCount, setStaffCount] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showAddStaff, setShowAddStaff] = useState(false)
  const businessId = currentUser?.business_id || businessInfo?.id
  const canManage =
    currentUser?.role === 'SuperAdmin' || currentUser?.role === 'Manager'

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
    void loadStaff()
  }, [businessId])

  const loadStaff = async () => {
    try {
      setLoading(true)
      const [rows, count] = await Promise.all([
        invoke('get_users_for_business', { businessId }) as Promise<any[]>,
        invoke('get_business_staff_count', { businessId }) as Promise<any>,
      ])
      setStaff(Array.isArray(rows) ? rows : [])
      setStaffCount(count)
    } catch {
      toast.error('Failed to load staff records')
      setStaff([])
    } finally {
      setLoading(false)
    }
  }

  const handleAddStaff = async (staffData: any) => {
    try {
      const tempPassword = `Staff${Math.random().toString(36).slice(-6)}!`
      const passwordHash = btoa(tempPassword)

      await invoke('create_user', {
        request: {
          username: staffData.username,
          password_hash: passwordHash,
          role: staffData.role,
          name: staffData.name,
          email: staffData.email || null,
          business_id: businessId,
          temporary_password: tempPassword,
        },
      })

      toast.success(
        `Staff added.\nUsername: ${staffData.username}\nPassword: ${tempPassword}\nSave and share this password securely.`,
        { duration: 9000 }
      )
      setShowAddStaff(false)
      await loadStaff()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to add staff member')
    }
  }

  const formatLastLogin = (value?: string | null) => {
    if (!value) return 'Never'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  }

  if (loading) {
    return <PageLoader label="Loading staff…" />
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Team
            </p>
            <h1 className="font-display text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
              Staff records
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
              {canManage
                ? 'View and manage team members for this business.'
                : 'View team members for this business.'}
            </p>
          </div>
          {canManage && staffCount && (
            <button
              type="button"
              onClick={() => setShowAddStaff(true)}
              disabled={staffCount.available?.total <= 0}
              className="inline-flex items-center justify-center gap-2 bg-[#121c19] hover:bg-[#1a2924] disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-md text-sm font-semibold transition-colors"
            >
              <span className="text-lg leading-none">+</span>
              Add staff
            </button>
          )}
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <MetricCard title="Team members" value={String(staff.length)} accent="ink" />
          <MetricCard
            title="Active"
            value={String(staff.filter((u) => u.is_active !== false).length)}
            accent="teal"
          />
          <MetricCard
            title="Roles"
            value={String(new Set(staff.map((u) => u.role)).size)}
            accent="copper"
          />
        </div>

        {staff.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
            <p className="font-display text-2xl font-bold text-[#121c19]">No staff records</p>
            <p className="mt-2 text-[#2a3d36]/60">No users found for this business yet.</p>
            {canManage && staffCount && staffCount.available?.total > 0 && (
              <button
                type="button"
                onClick={() => setShowAddStaff(true)}
                className="mt-6 bg-[#121c19] hover:bg-[#1a2924] text-white px-5 py-2.5 rounded-md text-sm font-semibold"
              >
                Add first staff member
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {staff.map((user) => (
                <article
                  key={user.id}
                  className="rounded-xl border border-[#d4dcd8] bg-white p-4"
                >
                  <p className="font-semibold text-[#121c19]">{user.name || user.username}</p>
                  <p className="text-xs text-[#2a3d36]/50 mt-1">@{user.username}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-semibold bg-[#f4f6f5] border border-[#d4dcd8] text-[#121c19]">
                      {user.role}
                    </span>
                    <span
                      className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold border ${
                        user.is_active !== false
                          ? 'bg-teal-50 text-teal-800 border-teal-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {user.is_active !== false ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  {user.email && (
                    <p className="mt-2 text-sm text-[#2a3d36]/60 truncate">{user.email}</p>
                  )}
                  <p className="mt-2 text-xs text-[#2a3d36]/55">
                    Last login: {formatLastLogin(user.last_login)}
                  </p>
                </article>
              ))}
            </div>

            <div className="hidden md:block rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
              <table className="min-w-full text-left">
                <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Name</th>
                    <th className="px-5 py-3 font-semibold">Username</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Email</th>
                    <th className="px-5 py-3 font-semibold">Last login</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ecea]">
                  {staff.map((user) => (
                    <tr key={user.id} className="hover:bg-[#f4f6f5]/70">
                      <td className="px-5 py-4 font-semibold text-[#121c19]">
                        {user.name || '—'}
                      </td>
                      <td className="px-5 py-4 text-[#2a3d36]/70">@{user.username}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex px-2.5 py-1 rounded-md text-xs font-semibold bg-[#f4f6f5] border border-[#d4dcd8]">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-[#2a3d36]/70">{user.email || '—'}</td>
                      <td className="px-5 py-4 text-sm text-[#2a3d36]/70 whitespace-nowrap">
                        {formatLastLogin(user.last_login)}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold border ${
                            user.is_active !== false
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                          }`}
                        >
                          {user.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {showAddStaff && staffCount && (
        <AddStaffModal
          onClose={() => setShowAddStaff(false)}
          onSave={handleAddStaff}
          staffLimits={staffCount}
        />
      )}
    </div>
  )
}

function SettingsDashboard({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [activeTab, setActiveTab] = useState<'business' | 'email' | 'reports' | 'notifications'>('business')
  const isSuperAdmin = currentUser?.role === 'SuperAdmin'

  const tabs: { id: typeof activeTab; label: string; desc: string; adminOnly?: boolean }[] = [
    { id: 'business', label: 'Business', desc: 'Profile & branding' },
    { id: 'email', label: 'Email', desc: 'Outgoing mail' },
    { id: 'reports', label: 'Report access', desc: 'Who can view reports', adminOnly: true },
    { id: 'notifications', label: 'Notifications', desc: 'Alerts & reminders' },
  ]

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isSuperAdmin)

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 sm:mb-8">
          <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
            Configuration
          </p>
          <h1 className="font-display text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
            Settings
          </h1>
          <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
            Manage business profile, branding, and notifications.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <aside className="lg:col-span-3">
            <div className="rounded-xl border border-[#d4dcd8] bg-white p-2 lg:sticky lg:top-6">
              <div className="flex lg:flex-col gap-1 overflow-x-auto">
                {visibleTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-w-[140px] lg:min-w-0 text-left rounded-lg px-4 py-3 transition-colors ${
                      activeTab === tab.id
                        ? 'bg-[#121c19] text-white'
                        : 'text-[#2a3d36]/80 hover:bg-[#f4f6f5]'
                    }`}
                  >
                    <p className="font-semibold text-sm">{tab.label}</p>
                    <p
                      className={`text-xs mt-0.5 ${
                        activeTab === tab.id ? 'text-white/60' : 'text-[#2a3d36]/45'
                      }`}
                    >
                      {tab.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <div className="lg:col-span-9">
            <div className="rounded-xl border border-[#d4dcd8] bg-white p-5 sm:p-7 min-h-[420px]">
              {activeTab === 'business' && (
                <BusinessSettings currentUser={currentUser} businessInfo={businessInfo} />
              )}
              {activeTab === 'email' && (
                <EmailSettings currentUser={currentUser} businessInfo={businessInfo} />
              )}
              {activeTab === 'reports' && isSuperAdmin && (
                <ReportPermissionsSettings currentUser={currentUser} businessInfo={businessInfo} />
              )}
              {activeTab === 'notifications' && (
                <NotificationPreferences currentUser={currentUser} businessInfo={businessInfo} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function BusinessSettings({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [businessData, setBusinessData] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    primary_color: '#3B82F6',
    secondary_color: '#1E40AF',
    logo_path: '',
  })
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      loadBusinessData()
    }
  }, [businessId])

  const loadBusinessData = async () => {
    try {
      setLoading(true)
      const business = await invoke('get_business_by_id', { businessId: businessId }) as any
      setBusinessData({
        name: business.name || '',
        address: business.address || '',
        phone: business.phone || '',
        email: business.email || '',
        primary_color: business.primary_color || '#3B82F6',
        secondary_color: business.secondary_color || '#1E40AF',
        logo_path: business.logo_path || '',
      })
      if (business.logo_path) {
        setLogoPreview(business.logo_path)
      }
    } catch (error) {
      console.error('Failed to load business data:', error)
      toast.error('Failed to load business information')
    } finally {
      setLoading(false)
    }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB')
      return
    }

    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const logoPath = await invoke('save_business_logo', {
        imageData: base64,
        businessId: businessId
      }) as string

      setBusinessData(prev => ({ ...prev, logo_path: logoPath }))
      toast.success('Logo uploaded successfully')
    } catch (error) {
      console.error('Failed to upload logo:', error)
      toast.error('Failed to upload logo')
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      await invoke('update_business_settings', {
        request: {
          business_id: businessId,
          ...businessData,
        }
      })
      toast.success('Business settings saved successfully!')
      await loadBusinessData()
    } catch (error) {
      console.error('Failed to save business settings:', error)
      toast.error(`Failed to save business settings: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-600">Loading business settings...</p>
      </div>
    )
  }

  const fieldClass =
    'w-full px-4 py-2.5 border border-[#d4dcd8] rounded-lg bg-[#f4f6f5] text-[#121c19] focus:outline-none focus:ring-2 focus:ring-[#c4783a]/35 focus:bg-white'

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-bold text-[#121c19] mb-1">Business information</h2>
        <p className="text-sm text-[#2a3d36]/55 mb-5">Name, contact, and location for this venue.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Business name
            </label>
            <input
              type="text"
              value={businessData.name}
              onChange={(e) => setBusinessData((prev) => ({ ...prev, name: e.target.value }))}
              className={fieldClass}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Email
            </label>
            <input
              type="email"
              value={businessData.email}
              onChange={(e) => setBusinessData((prev) => ({ ...prev, email: e.target.value }))}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Phone
            </label>
            <input
              type="tel"
              value={businessData.phone}
              onChange={(e) => setBusinessData((prev) => ({ ...prev, phone: e.target.value }))}
              className={fieldClass}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Address
            </label>
            <input
              type="text"
              value={businessData.address}
              onChange={(e) => setBusinessData((prev) => ({ ...prev, address: e.target.value }))}
              className={fieldClass}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-[#e8ecea] pt-8">
        <h2 className="font-display text-xl font-bold text-[#121c19] mb-1">Branding</h2>
        <p className="text-sm text-[#2a3d36]/55 mb-5">Logo and colors used across the POS.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Logo
            </label>
            <div className="flex flex-wrap items-center gap-4">
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Business Logo"
                  className="w-20 h-20 object-contain border border-[#d4dcd8] rounded-lg bg-[#f4f6f5]"
                />
              )}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                  id="logo-upload"
                />
                <label
                  htmlFor="logo-upload"
                  className="px-4 py-2.5 bg-[#121c19] hover:bg-[#1a2924] text-white rounded-md cursor-pointer inline-block text-sm font-semibold"
                >
                  {logoPreview ? 'Change logo' : 'Upload logo'}
                </label>
                <p className="text-xs text-[#2a3d36]/45 mt-1.5">Max 5MB, PNG or JPG</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Primary color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={businessData.primary_color}
                onChange={(e) =>
                  setBusinessData((prev) => ({ ...prev, primary_color: e.target.value }))
                }
                className="w-12 h-11 border border-[#d4dcd8] rounded-md cursor-pointer bg-white"
              />
              <input
                type="text"
                value={businessData.primary_color}
                onChange={(e) =>
                  setBusinessData((prev) => ({ ...prev, primary_color: e.target.value }))
                }
                className={fieldClass}
                placeholder="#14B8A6"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-2">
              Secondary color
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={businessData.secondary_color}
                onChange={(e) =>
                  setBusinessData((prev) => ({ ...prev, secondary_color: e.target.value }))
                }
                className="w-12 h-11 border border-[#d4dcd8] rounded-md cursor-pointer bg-white"
              />
              <input
                type="text"
                value={businessData.secondary_color}
                onChange={(e) =>
                  setBusinessData((prev) => ({ ...prev, secondary_color: e.target.value }))
                }
                className={fieldClass}
                placeholder="#134E4A"
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/50 mb-3">
            Preview
          </p>
          <div className="flex gap-3">
            <div
              className="w-16 h-16 rounded-md border border-[#d4dcd8]"
              style={{ backgroundColor: businessData.primary_color }}
            />
            <div
              className="w-16 h-16 rounded-md border border-[#d4dcd8]"
              style={{ backgroundColor: businessData.secondary_color }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-[#121c19] hover:bg-[#1a2924] text-white rounded-md font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

function NotificationPreferences({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState({
    daily_reports_enabled: false,
    low_stock_enabled: true,
    pending_sales_enabled: true,
    notification_roles: 'SuperAdmin,Manager',
  })

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
    void loadPreferences()
  }, [businessId])

  const loadPreferences = async () => {
    try {
      setLoading(true)
      const config = (await invoke('get_email_config', { businessId })) as any
      const safe = config && typeof config === 'object' ? config : {}
      setPreferences({
        daily_reports_enabled: Boolean(safe.daily_reports_enabled),
        low_stock_enabled: safe.low_stock_enabled !== false,
        pending_sales_enabled: safe.pending_sales_enabled !== false,
        notification_roles: String(safe.notification_roles || 'SuperAdmin,Manager'),
      })
    } catch (error) {
      console.error('Failed to load notification preferences:', error)
      toast.error('Failed to load notification preferences')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const config = (await invoke('get_email_config', { businessId })) as any
      await invoke('save_email_config', {
        request: {
          business_id: businessId,
          ...(config && typeof config === 'object' ? config : {}),
          daily_reports_enabled: preferences.daily_reports_enabled,
          low_stock_enabled: preferences.low_stock_enabled,
          pending_sales_enabled: preferences.pending_sales_enabled,
          notification_roles: preferences.notification_roles,
        },
      })
      toast.success('Notification preferences saved')
      await loadPreferences()
    } catch (error) {
      console.error('Failed to save notification preferences:', error)
      toast.error(`Failed to save notification preferences: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[#2a3d36]/60">Loading notification preferences…</p>
      </div>
    )
  }

  const Toggle = ({
    checked,
    onChange,
  }: {
    checked: boolean
    onChange: (v: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-[#121c19]' : 'bg-[#d4dcd8]'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )

  return (
    <form onSubmit={handleSave} className="space-y-8">
      <div>
        <h2 className="font-display text-xl font-bold text-[#121c19] mb-1">Notifications</h2>
        <p className="text-sm text-[#2a3d36]/55 mb-5">
          Choose which alerts to send when email is configured.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4">
            <div>
              <p className="font-semibold text-[#121c19]">Low stock alerts</p>
              <p className="text-sm text-[#2a3d36]/55">When products fall below minimum</p>
            </div>
            <Toggle
              checked={preferences.low_stock_enabled}
              onChange={(v) => setPreferences((prev) => ({ ...prev, low_stock_enabled: v }))}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4">
            <div>
              <p className="font-semibold text-[#121c19]">Pending sales</p>
              <p className="text-sm text-[#2a3d36]/55">When sales need completion</p>
            </div>
            <Toggle
              checked={preferences.pending_sales_enabled}
              onChange={(v) =>
                setPreferences((prev) => ({ ...prev, pending_sales_enabled: v }))
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4">
            <div>
              <p className="font-semibold text-[#121c19]">Daily sales reports</p>
              <p className="text-sm text-[#2a3d36]/55">End-of-day summary email</p>
            </div>
            <Toggle
              checked={preferences.daily_reports_enabled}
              onChange={(v) =>
                setPreferences((prev) => ({ ...prev, daily_reports_enabled: v }))
              }
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="font-display text-xl font-bold text-[#121c19] mb-1">Recipients</h2>
        <p className="text-sm text-[#2a3d36]/55 mb-4">Roles that should receive alerts</p>
        <input
          type="text"
          value={preferences.notification_roles}
          onChange={(e) =>
            setPreferences((prev) => ({ ...prev, notification_roles: e.target.value }))
          }
          className="w-full px-4 py-2.5 border border-[#d4dcd8] rounded-lg bg-[#f4f6f5] text-[#121c19] focus:outline-none focus:ring-2 focus:ring-[#c4783a]/35 focus:bg-white"
          placeholder="SuperAdmin,Manager"
        />
        <p className="text-xs text-[#2a3d36]/45 mt-1.5">
          Comma-separated roles (e.g. SuperAdmin, Manager, Secretary)
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-[#121c19] hover:bg-[#1a2924] text-white rounded-md font-semibold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
      </div>
    </form>
  )
}

function ReportPermissionsSettings({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permissions, setPermissions] = useState({
    manager_can_view: true,
    secretary_can_view: false,
    staff_can_view: false,
  })

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
    void loadPermissions()
  }, [businessId])

  const loadPermissions = async () => {
    try {
      setLoading(true)
      const perms = (await invoke('get_report_permissions', { businessId })) as any
      const safe = perms && typeof perms === 'object' ? perms : {}
      setPermissions({
        manager_can_view: Boolean(safe.manager_can_view),
        secretary_can_view: Boolean(safe.secretary_can_view),
        staff_can_view: Boolean(safe.staff_can_view),
      })
    } catch (error) {
      console.error('Failed to load report permissions:', error)
      toast.error('Failed to load report permissions')
      setPermissions({
        manager_can_view: true,
        secretary_can_view: false,
        staff_can_view: false,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await invoke('save_report_permissions', {
        businessId,
        managerCanView: permissions.manager_can_view,
        secretaryCanView: permissions.secretary_can_view,
        staffCanView: permissions.staff_can_view,
      })
      toast.success('Report permissions saved')
    } catch (error) {
      console.error('Failed to save report permissions:', error)
      toast.error(`Failed to save report permissions: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-[#2a3d36]/60">Loading permissions…</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-display text-xl font-bold text-[#121c19] mb-1">Report access</h2>
      <p className="text-sm text-[#2a3d36]/55 mb-6">
        Control which roles can view reports. SuperAdmin always has access.
      </p>

      <form onSubmit={handleSave} className="space-y-4">
        {(
          [
            { key: 'manager_can_view' as const, title: 'Manager', desc: 'Allow Managers to view reports and analytics' },
            { key: 'secretary_can_view' as const, title: 'Secretary', desc: 'Allow Secretaries to view reports and analytics' },
            { key: 'staff_can_view' as const, title: 'Staff', desc: 'Allow Staff to view reports and analytics' },
          ]
        ).map((item) => (
          <label
            key={item.key}
            className="flex items-center cursor-pointer p-4 rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] hover:bg-white transition-colors"
          >
            <input
              type="checkbox"
              checked={Boolean(permissions[item.key])}
              onChange={(e) => setPermissions({ ...permissions, [item.key]: e.target.checked })}
              className="w-5 h-5 accent-[#121c19] rounded"
            />
            <div className="ml-3 flex-1">
              <p className="font-semibold text-[#121c19]">{item.title}</p>
              <p className="text-sm text-[#2a3d36]/55">{item.desc}</p>
            </div>
          </label>
        ))}

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-[#121c19] hover:bg-[#1a2924] text-white rounded-md font-semibold disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save permissions'}
          </button>
        </div>
      </form>
    </div>
  )
}

function EmailSettings({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [emailConfig, setEmailConfig] = useState({
    smtp_server: 'smtp.gmail.com',
    smtp_port: 587,
    username: '',
    password: '',
    from_email: '',
    from_name: 'POS System',
    use_tls: true,
    enabled: false,
    notification_roles: 'SuperAdmin,Manager',
    low_stock_enabled: true,
    pending_sales_enabled: true,
  })
  const [testEmail, setTestEmail] = useState('')

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      loadEmailConfig()
    }
  }, [businessId])

  const loadEmailConfig = async () => {
    try {
      setLoading(true)
      const config = await invoke('get_email_config', { businessId }) as any
      setEmailConfig({
        smtp_server: config?.smtp_server || 'smtp.gmail.com',
        smtp_port: Number(config?.smtp_port) || 587,
        username: config?.username || '',
        password: config?.password || '',
        from_email: config?.from_email || '',
        from_name: config?.from_name || 'POS System',
        use_tls: config?.use_tls !== false,
        enabled: Boolean(config?.enabled),
        notification_roles: config?.notification_roles || 'SuperAdmin,Manager',
        low_stock_enabled: config?.low_stock_enabled !== false,
        pending_sales_enabled: config?.pending_sales_enabled !== false,
      })
    } catch (error) {
      console.error('Failed to load email config:', error)
      toast.error('Failed to load email configuration')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      await invoke('save_email_config', {
        request: {
          business_id: businessId,
          ...emailConfig,
        }
      })
      toast.success('Email configuration saved successfully!')
      await loadEmailConfig()
    } catch (error) {
      console.error('Failed to save email config:', error)
      toast.error(`Failed to save email configuration: ${error}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTestEmail = async () => {
    if (!testEmail || !testEmail.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }

    setTesting(true)
    try {
      await invoke('send_test_email', {
        request: {
          business_id: businessId,
          to_email: testEmail,
        }
      })
      toast.success(`Test email sent to ${testEmail}!`)
      setTestEmail('')
    } catch (error) {
      console.error('Failed to send test email:', error)
      toast.error(`Failed to send test email: ${error}`)
    } finally {
      setTesting(false)
    }
  }

  const updateConfig = (field: string, value: any) => {
    setEmailConfig(prev => ({ ...prev, [field]: value }))
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-slate-600">Loading email settings...</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-4">Email Settings</h2>
      <p className="text-slate-600 mb-6">Configure email notifications for your business</p>

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 mb-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">📧 SMTP Configuration</h2>
          
          <form onSubmit={handleSave} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  SMTP Server *
                </label>
                <input
                  type="text"
                  required
                  value={emailConfig.smtp_server}
                  onChange={(e) => updateConfig('smtp_server', e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="smtp.gmail.com"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Common: smtp.gmail.com, smtp.outlook.com, smtp.mail.yahoo.com
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  SMTP Port *
                </label>
                <input
                  type="number"
                  required
                  value={emailConfig.smtp_port}
                  onChange={(e) => updateConfig('smtp_port', parseInt(e.target.value) || 587)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="587"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Common: 587 (TLS), 465 (SSL), 25
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Email/Username *
                </label>
                <input
                  type="email"
                  required
                  value={emailConfig.username}
                  onChange={(e) => updateConfig('username', e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="your-email@gmail.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Password/App Password *
                </label>
                <input
                  type="password"
                  required
                  value={emailConfig.password}
                  onChange={(e) => updateConfig('password', e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Your email password or app password"
                />
                <p className="text-xs text-slate-500 mt-1">
                  For Gmail: Use App Password (not your regular password)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  From Email *
                </label>
                <input
                  type="email"
                  required
                  value={emailConfig.from_email}
                  onChange={(e) => updateConfig('from_email', e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="noreply@yourbusiness.com"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Email address that will appear as sender
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  From Name
                </label>
                <input
                  type="text"
                  value={emailConfig.from_name}
                  onChange={(e) => updateConfig('from_name', e.target.value)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="POS System"
                />
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailConfig.use_tls}
                  onChange={(e) => updateConfig('use_tls', e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-slate-700">
                  Use TLS/SSL Encryption
                </span>
              </label>

              <label className="flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={emailConfig.enabled}
                  onChange={(e) => updateConfig('enabled', e.target.checked)}
                  className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm font-medium text-slate-700">
                  Enable Email Notifications
                </span>
              </label>
            </div>

            <div className="flex space-x-4 pt-4 border-t border-slate-200">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : '💾 Save Configuration'}
              </button>
            </div>
          </form>
        </div>

        {/* Test Email Section */}
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-4">🧪 Test Email Configuration</h2>
          <p className="text-slate-600 mb-4">
            Send a test email to verify your configuration is working correctly.
          </p>
          
          <div className="flex gap-4">
            <input
              type="email"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="Enter email address to test"
              className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleTestEmail}
              disabled={testing || !emailConfig.enabled}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? 'Sending...' : '📧 Send Test Email'}
            </button>
          </div>

          {!emailConfig.enabled && (
            <p className="text-sm text-amber-600 mt-2">
              ⚠️ Please enable email notifications and save configuration before testing.
            </p>
          )}
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-6 mt-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-3">📚 Setup Instructions</h3>
          <div className="space-y-3 text-sm text-blue-800">
            <div>
              <strong>Gmail Setup:</strong>
              <ol className="list-decimal list-inside ml-4 mt-1 space-y-1">
                <li>Go to your Google Account settings</li>
                <li>Enable 2-Step Verification</li>
                <li>Generate an App Password (Settings → Security → App passwords)</li>
                <li>Use the App Password (not your regular password) in the password field</li>
                <li>SMTP Server: smtp.gmail.com, Port: 587</li>
              </ol>
            </div>
            <div>
              <strong>Outlook/Hotmail Setup:</strong>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li>SMTP Server: smtp-mail.outlook.com</li>
                <li>Port: 587</li>
                <li>Use your regular email password</li>
              </ul>
            </div>
            <div>
              <strong>Yahoo Mail Setup:</strong>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                <li>SMTP Server: smtp.mail.yahoo.com</li>
                <li>Port: 587 or 465</li>
                <li>Generate an App Password from Yahoo Account settings</li>
              </ul>
            </div>
          </div>
        </div>
    </div>
  )
}

function ReportsDashboard({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [reportDate, setReportDate] = useState(yesterday)
  const [report, setReport] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [view, setView] = useState<'all' | 'sold' | 'remaining'>('all')

  const businessId = currentUser?.business_id || businessInfo?.id
  const userRole = currentUser?.role || ''
  const roleAllows =
    userRole === 'SuperAdmin' || userRole === 'Manager' || userRole === 'Secretary'

  const formatMoney = (n: number) =>
    `₦${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatDateLabel = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  useEffect(() => {
    if (!businessId) {
      setLoading(false)
      return
    }
    void checkAccess()
  }, [businessId, userRole])

  useEffect(() => {
    if (hasAccess && businessId) {
      void loadReport()
    }
  }, [hasAccess, businessId, reportDate])

  const checkAccess = async () => {
    try {
      const canView = await invoke('can_user_view_reports', {
        businessId,
        userRole,
      }) as boolean | null
      setHasAccess(canView === true || (canView == null && roleAllows))
    } catch {
      setHasAccess(roleAllows)
    }
  }

  const loadReport = async () => {
    try {
      setLoading(true)
      const data = await invoke('get_daily_stock_report', {
        businessId,
        reportDate,
      }) as any
      setReport(data)
    } catch (error) {
      console.error('Failed to load daily stock report:', error)
      toast.error('Failed to load daily stock report')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  const rows: any[] = Array.isArray(report?.rows) ? report.rows : []
  const filtered = rows.filter((row) => {
    const q = searchQuery.trim().toLowerCase()
    const matches =
      !q ||
      String(row.name || '').toLowerCase().includes(q) ||
      String(row.packaging || '').toLowerCase().includes(q)
    if (!matches) return false
    if (view === 'sold') return Number(row.sold_qty) > 0
    if (view === 'remaining') return Number(row.remaining_stock) > 0
    return true
  })

  const exportReport = () => {
    if (!report) return
    const data = filtered.map((row) => ({
      Product: row.name,
      Packaging: row.packaging || '',
      'Unit price': row.price,
      Opening: row.opening_stock,
      Sold: row.sold_qty,
      'Sold value (₦)': row.sold_value,
      Remaining: row.remaining_stock,
      'Remaining value (₦)': row.remaining_value,
      Fridge: row.fridge_stock,
      Show: row.show_stock,
      Store: row.store_stock,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Stock')
    XLSX.writeFile(wb, `Daily_Stock_${report.report_date || reportDate}.xlsx`)
    toast.success('Exported daily stock report')
  }

  if (!hasAccess) {
    return (
      <div className="min-h-full bg-[#f4f6f5] flex items-center justify-center px-4">
        <div className="max-w-md w-full rounded-xl border border-[#d4dcd8] bg-white p-8 text-center">
          <p className="font-display text-2xl font-bold text-[#121c19]">Access denied</p>
          <p className="mt-2 text-[#2a3d36]/65">
            You don&apos;t have permission to view reports. Contact your administrator.
          </p>
        </div>
      </div>
    )
  }

  if (loading && !report) {
    return <PageLoader label="Loading reports…" />
  }

  const displayDate = report?.report_date || reportDate
  const totals = report?.totals || {
    sold_qty: 0,
    sold_value: 0,
    remaining_stock: 0,
    remaining_value: 0,
    opening_stock: 0,
  }

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 sm:mb-8 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Analytics
            </p>
            <h1 className="font-display text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
              Daily stock report
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base max-w-2xl">
              Opening stock, what sold, and what remains — with money values for{' '}
              {formatDateLabel(displayDate)}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 rounded-md border border-[#d4dcd8] bg-white px-3 py-2 text-sm">
              <span className="text-[#2a3d36]/55 font-medium">Date</span>
              <input
                type="date"
                value={reportDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  const next = e.target.value
                  if (!next || next === reportDate) return
                  setReportDate(next)
                  setReport(null)
                  setLoading(true)
                }}
                className="border-0 bg-transparent text-[#121c19] font-semibold focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void loadReport()}
              disabled={loading}
              className="border border-[#121c19]/15 hover:bg-white disabled:opacity-50 text-[#121c19] px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={exportReport}
              className="bg-[#121c19] hover:bg-[#1a2924] text-white px-4 py-2.5 rounded-md text-sm font-semibold"
            >
              Export Excel
            </button>
          </div>
        </header>

        {loading && (
          <div className="mb-4 rounded-lg border border-[#d4dcd8] bg-white px-4 py-3 text-sm text-[#2a3d36]/70">
            Loading sales for {formatDateLabel(reportDate)}…
          </div>
        )}

        <div className={`grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6 ${loading ? 'opacity-60' : ''}`}>
          <MetricCard
            title="Day sales"
            value={formatMoney(report?.day_sales_total || totals.sold_value)}
            hint={`${report?.day_sales_count || 0} transactions`}
            accent="teal"
          />
          <MetricCard
            title="Units sold"
            value={String(totals.sold_qty || 0)}
            hint={formatMoney(totals.sold_value || 0)}
            accent="copper"
          />
          <MetricCard
            title="Stock left"
            value={String(totals.remaining_stock || 0)}
            hint={formatMoney(totals.remaining_value || 0)}
            accent="ink"
          />
          <MetricCard
            title="Opening stock"
            value={String(totals.opening_stock || 0)}
            hint="Remaining + sold"
            accent="rose"
          />
        </div>

        <div className="rounded-xl border border-[#d4dcd8] bg-white p-4 sm:p-5 mb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'all', label: 'All products' },
                  { id: 'sold', label: 'Sold that day' },
                  { id: 'remaining', label: 'Still in stock' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className={`px-3.5 py-2 rounded-md text-sm font-semibold transition-colors ${
                    view === tab.id
                      ? 'bg-[#121c19] text-white'
                      : 'bg-[#f4f6f5] text-[#2a3d36]/70 hover:text-[#121c19]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product…"
              className="w-full lg:w-72 px-4 py-2.5 rounded-md border border-[#d4dcd8] bg-[#f4f6f5] text-sm focus:outline-none focus:ring-2 focus:ring-[#c4783a]/35"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d4dcd8] bg-white px-6 py-16 text-center">
            <p className="font-display text-2xl font-bold text-[#121c19]">No stock rows</p>
            <p className="mt-2 text-[#2a3d36]/60">
              Nothing matched this date or filter.
            </p>
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {filtered.map((row) => (
                <article
                  key={row.id}
                  className="rounded-xl border border-[#d4dcd8] bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#121c19]">{row.name}</p>
                      <p className="text-xs text-[#2a3d36]/50 mt-1">
                        {row.packaging || '—'} · {formatMoney(row.price)}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-1 rounded-md">
                      Sold {row.sold_qty}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-[#2a3d36]/45">Opening</p>
                      <p className="font-semibold text-[#121c19]">{row.opening_stock}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-[#2a3d36]/45">Sold value</p>
                      <p className="font-semibold text-[#121c19]">{formatMoney(row.sold_value)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-[#2a3d36]/45">Left</p>
                      <p className="font-semibold text-[#121c19]">{row.remaining_stock}</p>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-[#2a3d36]/45">Left value</p>
                      <p className="font-semibold text-[#121c19]">{formatMoney(row.remaining_value)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-[#2a3d36]/50">
                    Fridge {row.fridge_stock} · Show {row.show_stock} · Store {row.store_stock}
                  </p>
                </article>
              ))}
            </div>

            <div className="hidden md:block rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Price</th>
                      <th className="px-5 py-3 font-semibold text-right">Opening</th>
                      <th className="px-5 py-3 font-semibold text-right">Sold</th>
                      <th className="px-5 py-3 font-semibold text-right">Sold value</th>
                      <th className="px-5 py-3 font-semibold text-right">Left</th>
                      <th className="px-5 py-3 font-semibold text-right">Left value</th>
                      <th className="px-5 py-3 font-semibold">Locations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8ecea]">
                    {filtered.map((row) => (
                      <tr key={row.id} className="hover:bg-[#f4f6f5]/70">
                        <td className="px-5 py-4">
                          <p className="font-semibold text-[#121c19]">{row.name}</p>
                          <p className="text-xs text-[#2a3d36]/50 mt-0.5">
                            {row.packaging || '—'}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-[#2a3d36]/70 whitespace-nowrap">
                          {formatMoney(row.price)}
                        </td>
                        <td className="px-5 py-4 text-right font-medium text-[#121c19]">
                          {row.opening_stock}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-[#c4783a]">
                          {row.sold_qty}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-[#121c19] whitespace-nowrap">
                          {formatMoney(row.sold_value)}
                        </td>
                        <td className="px-5 py-4 text-right font-medium text-[#121c19]">
                          {row.remaining_stock}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-teal-800 whitespace-nowrap">
                          {formatMoney(row.remaining_value)}
                        </td>
                        <td className="px-5 py-4 text-xs text-[#2a3d36]/55 whitespace-nowrap">
                          F {row.fridge_stock} · S {row.show_stock} · St {row.store_stock}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#f4f6f5] border-t border-[#d4dcd8]">
                    <tr>
                      <td className="px-5 py-4 font-bold text-[#121c19]" colSpan={2}>
                        Totals
                      </td>
                      <td className="px-5 py-4 text-right font-bold">{totals.opening_stock}</td>
                      <td className="px-5 py-4 text-right font-bold text-[#c4783a]">
                        {totals.sold_qty}
                      </td>
                      <td className="px-5 py-4 text-right font-bold whitespace-nowrap">
                        {formatMoney(totals.sold_value)}
                      </td>
                      <td className="px-5 py-4 text-right font-bold">{totals.remaining_stock}</td>
                      <td className="px-5 py-4 text-right font-bold text-teal-800 whitespace-nowrap">
                        {formatMoney(totals.remaining_value)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PendingItemsDashboard({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'summary' | 'sales' | 'low_stock' | 'out_of_stock'>('summary')
  const [summary, setSummary] = useState<any>({
    pending_sales: 0,
    low_stock_products: 0,
    out_of_stock_products: 0,
    total_pending: 0,
  })
  const [pendingSales, setPendingSales] = useState<any[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([])
  const [outOfStockProducts, setOutOfStockProducts] = useState<any[]>([])

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      void loadAllData()
    } else {
      setLoading(false)
    }
  }, [businessId])

  const loadAllData = async () => {
    try {
      setLoading(true)
      const [summaryData, sales, lowStock, outOfStock] = await Promise.all([
        invoke('get_pending_items_summary', { businessId }) as Promise<any>,
        invoke('get_pending_sales', { businessId }) as Promise<any[]>,
        invoke('get_low_stock_products_for_business', { businessId }) as Promise<any[]>,
        invoke('get_out_of_stock_products_for_business', { businessId }) as Promise<any[]>,
      ])
      setSummary(
        summaryData || {
          pending_sales: 0,
          low_stock_products: 0,
          out_of_stock_products: 0,
          total_pending: 0,
        }
      )
      setPendingSales(Array.isArray(sales) ? sales : [])
      setLowStockProducts(Array.isArray(lowStock) ? lowStock : [])
      setOutOfStockProducts(Array.isArray(outOfStock) ? outOfStock : [])
    } catch (error) {
      console.error('Failed to load pending items:', error)
      toast.error('Failed to load pending items')
      setSummary({
        pending_sales: 0,
        low_stock_products: 0,
        out_of_stock_products: 0,
        total_pending: 0,
      })
      setPendingSales([])
      setLowStockProducts([])
      setOutOfStockProducts([])
    } finally {
      setLoading(false)
    }
  }

  const handleMarkSaleCompleted = async (saleId: number) => {
    try {
      await invoke('mark_sale_as_completed', { saleId })
      toast.success('Sale marked as completed')
      await loadAllData()
    } catch (error) {
      toast.error(`Failed to mark sale as completed: ${error}`)
    }
  }

  if (loading) {
    return <PageLoader label="Loading pending items…" />
  }

  const tabs: { id: typeof activeTab; label: string; count?: number }[] = [
    { id: 'summary', label: 'Overview' },
    { id: 'sales', label: 'Pending sales', count: summary.pending_sales || 0 },
    { id: 'low_stock', label: 'Low stock', count: summary.low_stock_products || 0 },
    { id: 'out_of_stock', label: 'Out of stock', count: summary.out_of_stock_products || 0 },
  ]

  return (
    <div className="min-h-full bg-[#f4f6f5]">
      <div className="px-4 sm:px-8 xl:px-10 py-6 sm:py-8 max-w-[1600px]">
        <header className="mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-2">
              Alerts
            </p>
            <h1 className="font-display text-2xl sm:text-3xl xl:text-4xl font-bold tracking-tight text-[#121c19]">
              Pending items
            </h1>
            <p className="mt-2 text-[#2a3d36]/70 text-base max-w-xl">
              Track unfinished sales and stock that needs attention.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAllData()}
            className="border border-[#121c19]/15 hover:border-[#121c19]/35 hover:bg-white text-[#121c19] px-5 py-2.5 rounded-md text-sm font-semibold transition-colors self-start"
          >
            Refresh
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <MetricCard title="Total pending" value={String(summary.total_pending || 0)} accent="ink" />
          <MetricCard title="Pending sales" value={String(summary.pending_sales || 0)} accent="copper" />
          <MetricCard title="Low stock" value={String(summary.low_stock_products || 0)} accent="teal" />
          <MetricCard title="Out of stock" value={String(summary.out_of_stock_products || 0)} accent="rose" />
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-semibold transition-colors ${
                activeTab === tab.id
                  ? 'bg-[#121c19] text-white'
                  : 'bg-white text-[#121c19] border border-[#d4dcd8] hover:bg-[#f4f6f5]'
              }`}
            >
              {tab.label}
              {typeof tab.count === 'number' && tab.count > 0 && (
                <span
                  className={`min-w-[1.25rem] h-5 px-1.5 rounded-md text-[11px] font-bold inline-flex items-center justify-center ${
                    activeTab === tab.id ? 'bg-white/15 text-white' : 'bg-[#c4783a]/15 text-[#a35f2a]'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-[#d4dcd8] bg-white overflow-hidden">
          {activeTab === 'summary' && (
            <div className="p-5 sm:p-6 space-y-5">
              <div>
                <h2 className="font-display text-lg font-bold text-[#121c19]">Overview</h2>
                <p className="text-sm text-[#2a3d36]/55 mt-1">Quick look at what needs action</p>
              </div>

              <section className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#121c19]">Pending sales</h3>
                  <span className="text-sm font-bold text-[#121c19]">{pendingSales.length}</span>
                </div>
                {pendingSales.length === 0 ? (
                  <p className="text-sm text-[#2a3d36]/55">No pending sales</p>
                ) : (
                  <div className="space-y-2">
                    {pendingSales.slice(0, 3).map((sale) => (
                      <div
                        key={sale.id}
                        className="rounded-md bg-white border border-[#d4dcd8] px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      >
                        <div>
                          <p className="font-semibold text-[#121c19]">Sale #{sale.id}</p>
                          <p className="text-sm text-[#2a3d36]/60">
                            {sale.user_name || 'Unknown'} · {sale.item_count || 0} items · ₦
                            {Number(sale.total_amount || 0).toLocaleString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleMarkSaleCompleted(sale.id)}
                          className="bg-[#121c19] hover:bg-[#1a2924] text-white px-4 py-2 rounded-md text-sm font-semibold"
                        >
                          Mark complete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-[#d4dcd8] bg-[#f4f6f5] p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#121c19]">Low stock</h3>
                  <span className="text-sm font-bold text-[#c4783a]">{lowStockProducts.length}</span>
                </div>
                {lowStockProducts.length === 0 ? (
                  <p className="text-sm text-[#2a3d36]/55">No low stock products</p>
                ) : (
                  <div className="space-y-2">
                    {lowStockProducts.slice(0, 4).map((product) => (
                      <div
                        key={product.id}
                        className="rounded-md bg-white border border-[#d4dcd8] px-4 py-3"
                      >
                        <p className="font-semibold text-[#121c19]">{product.name}</p>
                        <p className="text-xs text-[#2a3d36]/55 mt-1">
                          Fridge {product.fridge_stock || 0} · Show {product.show_stock || 0} · Store{' '}
                          {product.store_stock || 0} · Min {product.min_stock_level || 0}
                        </p>
                      </div>
                    ))}
                    {lowStockProducts.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('low_stock')}
                        className="text-sm font-semibold text-[#c4783a]"
                      >
                        View all {lowStockProducts.length} low stock items
                      </button>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#121c19]">Out of stock</h3>
                  <span className="text-sm font-bold text-rose-600">{outOfStockProducts.length}</span>
                </div>
                {outOfStockProducts.length === 0 ? (
                  <p className="text-sm text-[#2a3d36]/55">No out of stock products</p>
                ) : (
                  <div className="space-y-2">
                    {outOfStockProducts.slice(0, 4).map((product) => (
                      <div
                        key={product.id}
                        className="rounded-md bg-white border border-rose-100 px-4 py-3"
                      >
                        <p className="font-semibold text-[#121c19]">{product.name}</p>
                        <p className="text-xs text-rose-600 mt-1">All locations at 0</p>
                      </div>
                    ))}
                    {outOfStockProducts.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('out_of_stock')}
                        className="text-sm font-semibold text-rose-600"
                      >
                        View all {outOfStockProducts.length} out of stock items
                      </button>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'sales' && (
            <div className="p-5 sm:p-6">
              <h2 className="font-display text-lg font-bold text-[#121c19] mb-4">Pending sales</h2>
              {pendingSales.length === 0 ? (
                <p className="text-sm text-[#2a3d36]/55 py-8 text-center">No pending sales</p>
              ) : (
                <div className="space-y-3">
                  {pendingSales.map((sale) => (
                    <article
                      key={sale.id}
                      className="rounded-lg border border-[#d4dcd8] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <p className="font-semibold text-[#121c19]">Sale #{sale.id}</p>
                        <p className="text-sm text-[#2a3d36]/60 mt-1">
                          {sale.user_name || 'Unknown'} · {sale.item_count || 0} items ·{' '}
                          {sale.payment_method || 'N/A'}
                        </p>
                        <p className="text-xs text-[#2a3d36]/45 mt-1">{sale.created_at || '—'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="font-bold text-[#121c19]">
                          ₦{Number(sale.total_amount || 0).toLocaleString()}
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleMarkSaleCompleted(sale.id)}
                          className="bg-[#121c19] hover:bg-[#1a2924] text-white px-4 py-2 rounded-md text-sm font-semibold"
                        >
                          Mark complete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'low_stock' && (
            <div className="p-5 sm:p-6">
              <h2 className="font-display text-lg font-bold text-[#121c19] mb-4">Low stock</h2>
              {lowStockProducts.length === 0 ? (
                <p className="text-sm text-[#2a3d36]/55 py-8 text-center">No low stock products</p>
              ) : (
                <>
                  <div className="md:hidden space-y-3">
                    {lowStockProducts.map((product) => (
                      <article key={product.id} className="rounded-lg border border-[#d4dcd8] p-4">
                        <p className="font-semibold text-[#121c19]">{product.name}</p>
                        <p className="text-xs text-[#2a3d36]/50 mt-1">{product.packaging || product.category}</p>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                          <div>
                            <p className="text-[10px] uppercase text-[#2a3d36]/45">Fridge</p>
                            <p className="font-semibold text-rose-600">{product.fridge_stock || 0}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-[#2a3d36]/45">Show</p>
                            <p className="font-semibold">{product.show_stock || 0}</p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase text-[#2a3d36]/45">Store</p>
                            <p className="font-semibold">{product.store_stock || 0}</p>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Product</th>
                          <th className="px-4 py-3 font-semibold text-center">Fridge</th>
                          <th className="px-4 py-3 font-semibold text-center">Show</th>
                          <th className="px-4 py-3 font-semibold text-center">Store</th>
                          <th className="px-4 py-3 font-semibold text-center">Min</th>
                          <th className="px-4 py-3 font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8ecea]">
                        {lowStockProducts.map((product) => (
                          <tr key={product.id} className="hover:bg-[#f4f6f5]/70">
                            <td className="px-4 py-3 font-semibold text-[#121c19]">{product.name}</td>
                            <td className="px-4 py-3 text-center font-semibold text-rose-600">
                              {product.fridge_stock || 0}
                            </td>
                            <td className="px-4 py-3 text-center">{product.show_stock || 0}</td>
                            <td className="px-4 py-3 text-center">{product.store_stock || 0}</td>
                            <td className="px-4 py-3 text-center">{product.min_stock_level || 0}</td>
                            <td className="px-4 py-3 font-semibold">
                              ₦{Number(product.price || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'out_of_stock' && (
            <div className="p-5 sm:p-6">
              <h2 className="font-display text-lg font-bold text-[#121c19] mb-4">Out of stock</h2>
              {outOfStockProducts.length === 0 ? (
                <p className="text-sm text-[#2a3d36]/55 py-8 text-center">No out of stock products</p>
              ) : (
                <>
                  <div className="md:hidden space-y-3">
                    {outOfStockProducts.map((product) => (
                      <article
                        key={product.id}
                        className="rounded-lg border border-rose-200 bg-rose-50/40 p-4"
                      >
                        <p className="font-semibold text-[#121c19]">{product.name}</p>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <span className="inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-rose-500 text-white">
                            Out of stock
                          </span>
                          <span className="font-semibold text-[#121c19]">
                            ₦{Number(product.price || 0).toLocaleString()}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="min-w-full text-left">
                      <thead className="bg-[#f4f6f5] text-xs uppercase tracking-wide text-[#2a3d36]/50">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Product</th>
                          <th className="px-4 py-3 font-semibold">Packaging</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Price</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8ecea]">
                        {outOfStockProducts.map((product) => (
                          <tr key={product.id} className="bg-rose-50/40">
                            <td className="px-4 py-3 font-semibold text-[#121c19]">{product.name}</td>
                            <td className="px-4 py-3 text-[#2a3d36]/60">
                              {product.packaging || '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide bg-rose-500 text-white">
                                Out of stock
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold">
                              ₦{Number(product.price || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AccessDenied() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="max-w-md mx-auto mt-20">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
            <div className="text-6xl mb-4">🚫</div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h2>
            <p className="text-slate-600">You don't have permission to access this section.</p>
            <p className="text-slate-500 text-sm mt-2">Please contact your administrator.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AddStaffModal({ onClose, onSave, staffLimits }: {
  onClose: () => void
  onSave: (staffData: any) => void
  staffLimits: any
}) {
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    email: '',
    role: 'Staff',
  })
  const [submitting, setSubmitting] = useState(false)

  const updateFormData = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const canAddRole = (role: string) => {
    if (!staffLimits?.available) return false
    switch (role) {
      case 'Manager':
        return staffLimits.available.manager > 0
      case 'Secretary':
        return staffLimits.available.secretary > 0
      case 'Staff':
      case 'BarStaff':
        return staffLimits.available.staff > 0
      default:
        return true
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.username.trim() || !formData.name.trim()) {
      toast.error('Name and username are required')
      return
    }
    if (!canAddRole(formData.role)) {
      toast.error(`${formData.role} limit reached`)
      return
    }
    if (staffLimits.available?.total <= 0) {
      toast.error('Staff limit reached')
      return
    }

    setSubmitting(true)
    try {
      await onSave({
        ...formData,
        username: formData.username.trim(),
        name: formData.name.trim(),
        email: formData.email.trim(),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const roles = [
    {
      value: 'Staff',
      label: 'Bar Staff',
      hint: `${staffLimits.staff}/${staffLimits.limits.max_staff} seats`,
      available: canAddRole('Staff'),
    },
    {
      value: 'Manager',
      label: 'Manager',
      hint: `${staffLimits.manager}/${staffLimits.limits.max_manager} seats`,
      available: canAddRole('Manager'),
    },
    {
      value: 'Secretary',
      label: 'Secretary',
      hint: `${staffLimits.secretary}/${staffLimits.limits.max_secretary} seats`,
      available: canAddRole('Secretary'),
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[#121c19]/55 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full sm:max-w-lg bg-[#f4f6f5] sm:rounded-2xl shadow-2xl border border-[#d4dcd8] max-h-[92vh] overflow-y-auto animate-fade-in">
        <div className="px-6 sm:px-8 pt-6 sm:pt-8 pb-4 border-b border-[#d4dcd8]/80 bg-white sm:rounded-t-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-display text-[11px] font-semibold tracking-[0.2em] uppercase text-[#c4783a] mb-1">
                New member
              </p>
              <h2 className="font-display text-2xl font-bold text-[#121c19]">Add staff</h2>
              <p className="mt-1 text-sm text-[#2a3d36]/60">
                A temporary password will be generated after you save.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 rounded-md border border-[#d4dcd8] text-[#2a3d36]/60 hover:text-[#121c19] hover:bg-[#f4f6f5] text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="px-6 sm:px-8 py-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/55 mb-2">
                Full name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white text-[#121c19] focus:outline-none focus:ring-2 focus:ring-[#c4783a]/40 focus:border-[#c4783a]"
                placeholder="e.g. Ada Okonkwo"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/55 mb-2">
                Username *
              </label>
              <input
                type="text"
                required
                value={formData.username}
                onChange={(e) => updateFormData('username', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white text-[#121c19] focus:outline-none focus:ring-2 focus:ring-[#c4783a]/40 focus:border-[#c4783a]"
                placeholder="login name"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/55 mb-2">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => updateFormData('email', e.target.value)}
                className="w-full px-4 py-3 rounded-lg border border-[#d4dcd8] bg-white text-[#121c19] focus:outline-none focus:ring-2 focus:ring-[#c4783a]/40 focus:border-[#c4783a]"
                placeholder="optional"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#2a3d36]/55 mb-2">
              Role *
            </label>
            <div className="grid grid-cols-1 gap-2">
              {roles.map((role) => (
                <button
                  key={role.value}
                  type="button"
                  disabled={!role.available}
                  onClick={() => updateFormData('role', role.value)}
                  className={`text-left rounded-lg border px-4 py-3 transition-colors ${
                    formData.role === role.value
                      ? 'border-[#121c19] bg-[#121c19] text-white'
                      : role.available
                        ? 'border-[#d4dcd8] bg-white hover:border-[#c4783a]/50 text-[#121c19]'
                        : 'border-[#e8ecea] bg-[#f4f6f5] text-[#2a3d36]/35 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{role.label}</span>
                    <span
                      className={`text-xs ${
                        formData.role === role.value ? 'text-white/70' : 'text-[#2a3d36]/50'
                      }`}
                    >
                      {role.available ? role.hint : 'Limit reached'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-[#d4dcd8] bg-white px-4 py-3 text-sm text-[#2a3d36]/70">
            Seats left:{' '}
            <span className="font-semibold text-[#121c19]">
              {staffLimits.available?.total ?? 0}
            </span>{' '}
            of {staffLimits.limits?.max_total ?? 0}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-[#d4dcd8] hover:bg-white text-[#121c19] py-3 px-4 rounded-lg font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !canAddRole(formData.role)}
              className="flex-1 bg-[#121c19] hover:bg-[#1a2924] disabled:opacity-50 text-white py-3 px-4 rounded-lg font-semibold transition-colors"
            >
              {submitting ? 'Adding…' : 'Create staff account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default App
