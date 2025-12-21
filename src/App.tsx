import React, { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import toast, { Toaster } from 'react-hot-toast'
import { UpdateNotification } from './UpdateNotification'
import { checkForUpdates, installUpdate } from './updateApi'
import { Table } from './components/Table'
import { Html5Qrcode } from 'html5-qrcode'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import * as XLSX from 'xlsx'

// Helper component to display product images
function ProductImage({ imagePath, alt }: { imagePath: string, alt: string }) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!imagePath) {
      setLoading(false)
      return
    }

    const loadImage = async () => {
      try {
        const imageBytes = await invoke('get_product_image', { imagePath }) as number[]
        const blob = new Blob([new Uint8Array(imageBytes)], { type: 'image/png' })
        const url = URL.createObjectURL(blob)
        setImageSrc(url)
      } catch (error) {
        console.error('Failed to load image:', error)
      } finally {
        setLoading(false)
      }
    }

    loadImage()

    return () => {
      if (imageSrc) {
        URL.revokeObjectURL(imageSrc)
      }
    }
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
  const [currentView, setCurrentView] = useState<'setup' | 'login' | 'dashboard' | 'change-password'>('setup')
  const [loading, setLoading] = useState(true)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [showPasswordChange, setShowPasswordChange] = useState(false)

  useEffect(() => {
    initializeSystem()
  }, [])

  const initializeSystem = async () => {
    try {
      console.log('Checking for SuperSuperAdmin...')

      // Check if SuperSuperAdmin exists
      const hasSuperAdmin = await invoke<boolean>('has_super_super_admin')
      console.log('Has SuperSuperAdmin:', hasSuperAdmin)

      if (!hasSuperAdmin) {
        console.log('Creating default SuperSuperAdmin account...')
        const passwordHash = btoa('Pawpaw4life@')
        console.log('Password hash:', passwordHash)

        // Create default SuperSuperAdmin account
        const result = await invoke('create_user', {
          request: {
            username: 'admin',
            password_hash: passwordHash,
            role: 'SuperSuperAdmin',
            name: 'System Administrator',
            email: null,
            business_id: null
          }
        })
        console.log('Default SuperSuperAdmin account created successfully, ID:', result)
      } else {
        console.log('SuperSuperAdmin account already exists')
      }

      setCurrentView('login')
    } catch (error) {
      console.error('Failed to initialize system:', error)
      setCurrentView('login') // Continue to login even if setup fails
    } finally {
      setLoading(false)
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
    <div className="min-h-screen bg-gray-100">
      {showPasswordChange && currentUser ? (
        <PasswordChangeModal
          currentUser={currentUser}
          onPasswordChanged={() => {
            setShowPasswordChange(false)
            setCurrentView('dashboard')
          }}
          onCancel={() => {
            setShowPasswordChange(false)
            setCurrentUser(null)
            setCurrentView('login')
          }}
        />
      ) : currentView === 'login' ? (
        <LoginView
          onLogin={() => setCurrentView('dashboard')}
          onUserAuthenticated={(user) => {
            setCurrentUser(user)
            if ((user as any)?.has_temporary_password) {
              setShowPasswordChange(true)
            } else {
              setCurrentView('dashboard')
            }
          }}
          onShowPasswordChange={(user) => {
            setCurrentUser(user)
            setShowPasswordChange(true)
          }}
        />
      ) : (
        <DashboardView
          onLogout={() => {
            setCurrentUser(null)
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
      <UpdateNotification autoCheck={true} showNotification={true} />
    </div>
  )
}

function LoginView({ onLogin, onUserAuthenticated, onShowPasswordChange }: {
  onLogin: () => void
  onUserAuthenticated: (user: any) => void
  onShowPasswordChange?: (user: any) => void
}) {
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      console.log('Attempting login with:', formData.username)

      // Hash password for login check (trim username to avoid whitespace issues)
      const username = formData.username.trim()
      const passwordHash = btoa(formData.password)
      console.log('Attempting login with username:', username)
      console.log('Generated password hash:', passwordHash)

      const user = await invoke('authenticate_user', {
        request: {
          username: username,
          password_hash: passwordHash
        }
      })

      console.log('Authentication result:', user)

      if (user) {
        console.log('Login successful! User:', user)
        // Check if user has temporary password and needs to change it
        if ((user as any).has_temporary_password) {
          // Show password change modal instead of logging in
          onUserAuthenticated(user)
          if (onShowPasswordChange) {
            onShowPasswordChange(user)
          }
          return
        }
        // Store user information for the session
        onUserAuthenticated(user)
        onLogin()
      } else {
        console.log('Authentication returned null/undefined')
        setError('Invalid username or password')
      }
    } catch (error: any) {
      console.error('Login failed:', error)
      const errorMsg = error?.toString() || 'Login failed'
      if (errorMsg.includes('Query returned no rows') || errorMsg.includes('Authentication failed')) {
        setError('Invalid username or password. If this is a newly created account, use the "View Password" button in Client Businesses to see the password.')
      } else {
        setError(`Login failed: ${errorMsg}`)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="bg-white p-8 rounded-lg shadow-md w-96">
        <h1 className="text-2xl font-bold text-center mb-6">POS System Login</h1>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-700 mb-2">Username</label>
            <input
              type="text"
              name="username"
              required
              value={formData.username}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter username"
            />
          </div>
          <div className="mb-6">
            <label className="block text-gray-700 mb-2">Password</label>
            <input
              type="password"
              name="password"
              required
              value={formData.password}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-500 text-white py-2 px-4 rounded-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>
      </div>
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
      const newPasswordHash = btoa(formData.newPassword)
      
      await invoke('change_password', {
        user_id: currentUser.id,
        new_password_hash: newPasswordHash
      })

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
function NavButton({ active, onClick, icon, label }: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center py-3 px-4 rounded-lg transition-all duration-200 text-left ${
        active
          ? 'bg-blue-600 text-white shadow-lg'
          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <span className="mr-3 text-lg">{icon}</span>
      <span className="font-medium">{label}</span>
          </button>
  )
}

// MetricCard Component for consistent card styling
function MetricCard({ title, value, icon, color = 'blue' }: {
  title: string
  value: string
  icon: string
  color?: 'blue' | 'green' | 'purple' | 'orange' | 'red'
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-green-600',
    purple: 'from-purple-500 to-purple-600',
    orange: 'from-orange-500 to-orange-600',
    red: 'from-red-500 to-red-600'
  }

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} text-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-shadow duration-300`}>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <h3 className="text-sm font-medium text-blue-100 mb-1">{title}</h3>
          <p className="text-3xl font-bold">{value}</p>
        </div>
        <div className="text-4xl opacity-80">{icon}</div>
      </div>
    </div>
  )
}

function DashboardView({ onLogout, currentUser }: { onLogout: () => void, currentUser: any }) {
  const [userRole, setUserRole] = useState<string>('Staff')
  const [currentSection, setCurrentSection] = useState('dashboard')
  const [businessInfo, setBusinessInfo] = useState<any>(null)

  useEffect(() => {
    // Get current user info to determine role
    if (currentUser && currentUser.role) {
      console.log('Setting user role from currentUser:', currentUser.role)
      setUserRole(currentUser.role)

      // Get business information if user has a business_id
      if (currentUser.business_id) {
        loadBusinessInfo(currentUser.business_id)
      }
    } else {
      console.log('No currentUser or role found, defaulting to Staff')
      setUserRole('Staff')
    }
  }, [currentUser])

  const loadBusinessInfo = async (businessId: number) => {
    try {
      console.log('Loading business info for ID:', businessId)
      // Backend accepts serde_json::Value which can be a number or object
      const business = await invoke('get_business_by_id', businessId as any) as any
      if (business) {
        setBusinessInfo(business)
        console.log('Loaded business info:', business)
      } else {
        console.warn('Business not found for ID:', businessId)
      }
    } catch (error) {
      console.error('Failed to load business info:', error)
      // Fallback: try getting all businesses
      try {
        const businesses = await invoke('get_businesses') as any[]
        const business = businesses.find((b: any) => b.id === businessId)
        if (business) {
          setBusinessInfo(business)
          console.log('Loaded business info from fallback:', business)
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError)
      }
    }
  }

  const renderSidebar = () => {
    const isSuperSuperAdmin = userRole === 'SuperSuperAdmin'
    const isSuperAdmin = userRole === 'SuperAdmin'
    const isManager = userRole === 'Manager'
    const isSecretary = userRole === 'Secretary'

    return (
      <div className="w-72 bg-slate-900 text-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mr-4 shadow-lg ${
              isSuperSuperAdmin ? 'bg-gradient-to-br from-purple-500 to-purple-600' :
              isSuperAdmin ? 'bg-gradient-to-br from-blue-500 to-blue-600' :
              isManager ? 'bg-gradient-to-br from-green-500 to-green-600' :
              isSecretary ? 'bg-gradient-to-br from-orange-500 to-orange-600' :
              'bg-gradient-to-br from-gray-500 to-gray-600'
            }`}>
              <span className="text-xl font-bold text-white">
                {isSuperSuperAdmin ? 'SSA' :
                 isSuperAdmin ? 'SA' :
                 isManager ? 'M' :
                 isSecretary ? 'S' : 'ST'}
              </span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {isSuperSuperAdmin ? 'Super Super Admin' :
                 businessInfo ? businessInfo.name :
                 isSuperAdmin ? 'Business Admin' :
                 isManager ? 'Manager' :
                 isSecretary ? 'Secretary' : 'Staff'}
              </h2>
              <p className="text-slate-400 text-sm">
                {isSuperSuperAdmin ? 'Software Management' :
                 businessInfo ? `${businessInfo.address}` :
                 isSuperAdmin ? 'Full Business Control' :
                 isManager ? 'Operations Management' :
                 isSecretary ? 'Administrative Support' : 'Sales Operations'}
              </p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {isSuperSuperAdmin ? (
            // Super Super Admin - Full Software Control
            <>
              <NavButton
                active={currentSection === 'dashboard'}
                onClick={() => setCurrentSection('dashboard')}
                icon="📊"
                label="Dashboard"
              />
              <NavButton
                active={currentSection === 'clients'}
                onClick={() => setCurrentSection('clients')}
                icon="🏢"
                label="Client Businesses"
              />
              <NavButton
                active={currentSection === 'onboarding'}
                onClick={() => setCurrentSection('onboarding')}
                icon="➕"
                label="Onboard Client"
              />
              <NavButton
                active={currentSection === 'reports'}
                onClick={() => setCurrentSection('reports')}
                icon="📈"
                label="System Reports"
              />
            </>
          ) : isSuperAdmin ? (
            // Business Super Admin - Full Business Control
            <>
              <NavButton
                active={currentSection === 'dashboard'}
                onClick={() => setCurrentSection('dashboard')}
                icon="📊"
                label="Dashboard"
              />
              <NavButton
                active={currentSection === 'products'}
                onClick={() => setCurrentSection('products')}
                icon="🛍️"
                label="Products"
              />
              <NavButton
                active={currentSection === 'sales'}
                onClick={() => setCurrentSection('sales')}
                icon="💰"
                label="Sales & POS"
              />
              <NavButton
                active={currentSection === 'inventory'}
                onClick={() => setCurrentSection('inventory')}
                icon="📦"
                label="Inventory"
              />
              <NavButton
                active={currentSection === 'staff'}
                onClick={() => setCurrentSection('staff')}
                icon="👥"
                label="Staff Management"
              />
              <NavButton
                active={currentSection === 'reports'}
                onClick={() => setCurrentSection('reports')}
                icon="📊"
                label="Reports"
              />
              <NavButton
                active={currentSection === 'reports'}
                onClick={() => setCurrentSection('reports')}
                icon="📊"
                label="Reports"
              />
              <NavButton
                active={currentSection === 'settings'}
                onClick={() => setCurrentSection('settings')}
                icon="⚙️"
                label="Settings"
              />
              <NavButton
                active={currentSection === 'pending'}
                onClick={() => setCurrentSection('pending')}
                icon="📋"
                label="Pending Items"
              />
              <NavButton
                active={currentSection === 'kitchen'}
                onClick={() => setCurrentSection('kitchen')}
                icon="👨‍🍳"
                label="Kitchen Orders"
              />
            </>
          ) : isManager ? (
            // Manager - Operations Focus
            <>
              <NavButton
                active={currentSection === 'dashboard'}
                onClick={() => setCurrentSection('dashboard')}
                icon="📊"
                label="Dashboard"
              />
              <NavButton
                active={currentSection === 'sales'}
                onClick={() => setCurrentSection('sales')}
                icon="💰"
                label="Sales & POS"
              />
              <NavButton
                active={currentSection === 'inventory'}
                onClick={() => setCurrentSection('inventory')}
                icon="📦"
                label="Inventory"
              />
              <NavButton
                active={currentSection === 'staff'}
                onClick={() => setCurrentSection('staff')}
                icon="👥"
                label="Staff Overview"
              />
              <NavButton
                active={currentSection === 'reports'}
                onClick={() => setCurrentSection('reports')}
                icon="📊"
                label="Reports"
              />
              <NavButton
                active={currentSection === 'reports'}
                onClick={() => setCurrentSection('reports')}
                icon="📊"
                label="Reports"
              />
              <NavButton
                active={currentSection === 'settings'}
                onClick={() => setCurrentSection('settings')}
                icon="⚙️"
                label="Settings"
              />
              <NavButton
                active={currentSection === 'pending'}
                onClick={() => setCurrentSection('pending')}
                icon="📋"
                label="Pending Items"
              />
            </>
          ) : isSecretary ? (
            // Secretary - Administrative Focus
            <>
              <NavButton
                active={currentSection === 'dashboard'}
                onClick={() => setCurrentSection('dashboard')}
                icon="📊"
                label="Dashboard"
              />
              <NavButton
                active={currentSection === 'products'}
                onClick={() => setCurrentSection('products')}
                icon="🛍️"
                label="Product Catalog"
              />
              <NavButton
                active={currentSection === 'sales'}
                onClick={() => setCurrentSection('sales')}
                icon="💰"
                label="Sales Support"
              />
              <NavButton
                active={currentSection === 'inventory'}
                onClick={() => setCurrentSection('inventory')}
                icon="📦"
                label="Inventory Tracking"
              />
              <NavButton
                active={currentSection === 'staff'}
                onClick={() => setCurrentSection('staff')}
                icon="👥"
                label="Staff Records"
              />
              <NavButton
                active={currentSection === 'pending'}
                onClick={() => setCurrentSection('pending')}
                icon="📋"
                label="Pending Items"
              />
            </>
          ) : (
            // Staff - Sales Only (Kitchen or Bar)
            <>
              <NavButton
                active={currentSection === 'pos'}
                onClick={() => setCurrentSection('pos')}
                icon="🛒"
                label="Point of Sale"
              />
              <NavButton
                active={currentSection === 'inventory'}
                onClick={() => setCurrentSection('inventory')}
                icon="📦"
                label="Stock Check"
              />
              <NavButton
                active={currentSection === 'pending'}
                onClick={() => setCurrentSection('pending')}
                icon="📋"
                label="Pending Items"
              />
            </>
          )}
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={onLogout}
            className="w-full bg-slate-800 hover:bg-red-600 text-slate-300 hover:text-white py-3 px-4 rounded-lg transition-all duration-200 font-medium border border-slate-700 hover:border-red-500"
          >
            🚪 Logout
          </button>
        </div>
      </div>
    )
  }

  const renderContent = () => {
    if (userRole === 'SuperSuperAdmin') {
      switch (currentSection) {
        case 'clients':
          return <ClientsManagement
            onNavigateToOnboarding={() => setCurrentSection('onboarding')}
            refreshTrigger={currentSection === 'clients'}
          />
        case 'onboarding':
          return <ClientOnboarding
            onComplete={() => setCurrentSection('clients')}
            currentUser={currentUser}
          />
        case 'reports':
          return <SystemReports />
        default:
          return <SuperAdminDashboard onNavigateToSection={setCurrentSection} />
      }
    }

    // Business user content
    const isSuperAdmin = userRole === 'SuperAdmin'
    const isManager = userRole === 'Manager'
    const isSecretary = userRole === 'Secretary'
    const isStaff = userRole === 'Staff'

    // Staff only sees POS interface
    if (isStaff) {
      switch (currentSection) {
        case 'pos':
          return <StaffPOSInterface currentUser={currentUser} businessInfo={businessInfo} />
        case 'inventory':
          return <StaffInventoryCheck currentUser={currentUser} />
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
      case 'inventory':
        return <BusinessInventory currentUser={currentUser} />
      case 'staff':
        // Only SuperAdmin and Manager can manage staff
        if (isSuperAdmin || isManager) {
          return <BusinessStaff />
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
        return <BusinessDashboard currentUser={currentUser} />
    }
  }

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden">
      {renderSidebar()}
      <div className="flex-1 min-w-0 overflow-auto">
        {renderContent()}
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
    try {
      const version = await getVersion()
      setCurrentVersion(version)
    } catch (error) {
      console.error('Failed to get version:', error)
      setCurrentVersion('Unknown')
    }
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
                  <span>Modules: {client.modules_enabled ? JSON.parse(client.modules_enabled).join(', ') : 'None'}</span>
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

      console.log('Current user:', currentUser)
      console.log('SuperAdmin ID:', superAdminId)

      if (!superAdminId) {
        toast.error('User session expired. Please login again.', {
          duration: 5000,
        })
        return
      }

      console.log('Creating business with SuperAdmin ID:', superAdminId)

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

      console.log('Business created:', result)

      // Generate a secure temporary password
      const tempPassword = `Temp${Math.random().toString(36).slice(-8)}!`
      const passwordHash = btoa(tempPassword)

      console.log('Generated temp password:', tempPassword)

      // Create the business admin user
      console.log('Creating user with:', {
        username: formData.adminUsername,
        business_id: result.business_id,
        password_hash: passwordHash
      })
      
      // Ensure business_id is set
      if (!result.business_id) {
        toast.error('Failed to create business admin: Business ID is missing')
        console.error('Business creation returned no business_id:', result)
        setIsSubmitting(false)
        return
      }

      console.log('Creating admin user with business_id:', result.business_id)
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

      console.log('User created with ID:', userId, 'and business_id:', result.business_id)
      
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
              <div className="overflow-x-auto">
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
function BusinessDashboard({ currentUser }: { currentUser: any }) {
  const [staffCount, setStaffCount] = useState<any>(null)
  const [showAddStaff, setShowAddStaff] = useState(false)

  useEffect(() => {
    if (currentUser?.business_id) {
      loadStaffCount()
    }
  }, [currentUser])

  const loadStaffCount = async () => {
    try {
      const count = await invoke('get_business_staff_count', { businessId: currentUser.business_id })
      setStaffCount(count)
    } catch (error) {
      console.error('Failed to load staff count:', error)
    }
  }

  const handleAddStaff = async (staffData: any) => {
    try {
      // Generate temp password for new staff
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

      toast.success(`Staff member added successfully!\n\nUsername: ${staffData.username}\nPassword: ${tempPassword}\n\n⚠️ Please save this password and share it securely.`, {
        duration: 8000,
      })

      setShowAddStaff(false)
      loadStaffCount() // Refresh staff count
    } catch (error) {
      console.error('Failed to add staff:', error)
      toast.error('Failed to add staff member')
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Business Dashboard</h1>
          <p className="text-slate-600 text-lg">Manage your restaurant operations</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8 w-full">
          <MetricCard
            title="Today's Sales"
            value="₦0.00"
            icon="💰"
            color="green"
          />
          <MetricCard
            title="Items in Stock"
            value="0"
            icon="📦"
            color="blue"
          />
          <MetricCard
            title="Active Staff"
            value={staffCount ? staffCount.total.toString() : "0"}
            icon="👥"
            color="purple"
          />
          <MetricCard
            title="Low Stock Alert"
            value="0"
            icon="⚠️"
            color="red"
          />
        </div>

        {/* Staff Management */}
        {staffCount && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 w-full">
            <h3 className="text-xl font-bold text-slate-800 mb-4">👥 Staff Management</h3>

            {/* Staff Count Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{staffCount.admin}</div>
                <div className="text-sm text-slate-600">Admin</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{staffCount.manager}</div>
                <div className="text-sm text-slate-600">Manager</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{staffCount.secretary}</div>
                <div className="text-sm text-slate-600">Secretary</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{staffCount.staff}</div>
                <div className="text-sm text-slate-600">Staff</div>
              </div>
            </div>

            {/* Limits Info */}
            <div className="bg-slate-50 rounded-lg p-4 mb-4">
              <h4 className="font-semibold text-slate-700 mb-2">Staff Limits</h4>
              <div className="text-sm text-slate-600 space-y-1">
                <div>Manager: {staffCount.manager}/{staffCount.limits.max_manager} ({staffCount.available.manager} available)</div>
                <div>Secretary: {staffCount.secretary}/{staffCount.limits.max_secretary} ({staffCount.available.secretary} available)</div>
                <div>Staff: {staffCount.staff}/{staffCount.limits.max_staff} ({staffCount.available.staff} available)</div>
                <div className="font-medium">Total: {staffCount.total}/{staffCount.limits.max_total} users</div>
              </div>
            </div>

            {/* Add Staff Button */}
            <button
              onClick={() => setShowAddStaff(true)}
              disabled={staffCount.available.total <= 0}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
            >
              <span>➕</span>
              <span>{staffCount.available.total <= 0 ? 'Staff Limit Reached' : 'Add Staff Member'}</span>
            </button>

            {staffCount.available.total <= 0 && (
              <p className="text-sm text-amber-600 mt-2 text-center">
                ⚠️ Maximum staff limit reached. Contact administrator for additional staff slots.
              </p>
            )}
          </div>
        )}

        {/* Business-specific content */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 w-full">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <button className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium transition-colors">
                💰 New Sale
              </button>
              <button className="w-full bg-slate-600 hover:bg-slate-700 text-white py-3 px-4 rounded-lg font-medium transition-colors">
                📦 Manage Inventory
              </button>
              <button className="w-full bg-slate-600 hover:bg-slate-700 text-white py-3 px-4 rounded-lg font-medium transition-colors">
                📊 View Reports
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Recent Activity</h3>
            <div className="text-center py-8">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-slate-500">No recent activity</p>
            </div>
          </div>
        </div>
      </div>

      {/* Add Staff Modal */}
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
  const [showAddModal, setShowAddModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage] = useState(10)

  // Extract business modules from businessInfo
  const businessModules = React.useMemo(() => {
    if (businessInfo && businessInfo.modules_enabled) {
      try {
        const modules = JSON.parse(businessInfo.modules_enabled)
        console.log('Parsed business modules:', modules)
        return modules
      } catch (error) {
        console.error('Failed to parse business modules:', error)
        return []
      }
    }
    console.log('No business modules found, using defaults')
    return ['BAR', 'KITCHEN', 'ROOM'] // Default fallback
  }, [businessInfo])

  // Get business ID from user or business info - prioritize currentUser.business_id
  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      console.log('ProductManagement: Loading products for business ID:', businessId)
      loadProducts()
    } else {
      console.warn('ProductManagement: No business ID available')
      setLoading(false)
    }
  }, [businessId])

  const loadProducts = async () => {
    try {
      setLoading(true)
      console.log('Loading products for business ID:', businessId)
      if (!businessId) {
        console.error('No business ID available')
        setProducts([])
        return
      }
      // Pass as object with businessId (camelCase) - Tauri converts to snake_case
      console.log('About to load products for businessId:', businessId, 'Type:', typeof businessId)
      const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
      console.log('Loaded products:', businessProducts)
      console.log('Loaded products count:', businessProducts?.length || 0)
      
      // Debug: Also try to get all products to see what's in the database
      try {
        const allProducts = await invoke('get_all_products') as any[]
        console.log('All products in database:', allProducts)
        console.log('All products count:', allProducts?.length || 0)
        if (allProducts.length > 0) {
          console.log('Sample product business_id:', allProducts[0]?.business_id)
        }
      } catch (e) {
        console.error('Failed to get all products for debugging:', e)
      }
      if (businessProducts && Array.isArray(businessProducts)) {
        setProducts(businessProducts)
      } else {
        console.warn('Products is not an array:', businessProducts)
        setProducts([])
      }
    } catch (error) {
      console.error('Failed to load products:', error)
      toast.error('Failed to load products. Please try refreshing the page.')
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const addProduct = async (productData: any) => {
    try {
      // Get business_id from currentUser, businessInfo, or productData
      const businessId = currentUser?.business_id || businessInfo?.id || productData.business_id
      
      if (!businessId) {
        toast.error('Business ID not found. Please log out and log back in.')
        console.error('No business ID available:', { currentUser, businessInfo, productData })
        return
      }

      // Convert camelCase to snake_case for backend
      const requestData = {
        business_id: businessId,
        name: productData.name,
        description: productData.description || '',
        category: productData.category,
        price: productData.price || 0,
        cost_price: productData.costPrice || productData.cost_price || 0,
        stock_quantity: productData.stockQuantity || productData.stock_quantity || 0,
        min_stock_level: productData.minStockLevel || productData.min_stock_level || 0,
        fridge_stock: productData.fridgeStock || productData.fridge_stock || 0,
        show_stock: productData.showStock || productData.show_stock || 0,
        store_stock: productData.storeStock || productData.store_stock || 0,
        barcode: productData.barcode || '',
        serial_number: productData.serialNumber || productData.serial_number || ''
      }
      console.log('Creating product with data:', requestData)
      await invoke('create_product', {
        request: requestData
      })
      toast.success('Product added successfully!')
      await loadProducts()
      setShowAddModal(false)
    } catch (error) {
      console.error('Failed to add product:', error)
      toast.error(`Failed to add product: ${error}`)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading products...</p>
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
            <h1 className="text-3xl font-bold text-slate-800 mb-2">Product Management</h1>
            <p className="text-slate-600 text-lg">Manage your menu items and inventory</p>
          </div>
          <div className="flex space-x-4">
            <button
              onClick={() => setShowAddModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg"
            >
              ➕ Add Product
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="bg-green-600 hover:bg-green-700 text-white py-3 px-6 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg"
            >
              📊 Import from Excel
            </button>
          </div>
        </div>

        {products.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 w-full">
            <div className="text-center">
              <div className="text-7xl mb-6">🛍️</div>
              <h2 className="text-3xl font-bold text-slate-800 mb-3">No Products Yet</h2>
              <p className="text-slate-600 mb-8 text-lg">Start by adding your first product to the catalog</p>
              <button
                onClick={() => setShowAddModal(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white py-4 px-8 rounded-xl font-semibold transition-all duration-200 hover:shadow-lg text-lg"
              >
                ➕ Add Your First Product
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 w-full overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-800">Product Catalog ({products.length})</h3>
              <div className="text-sm text-slate-600">
                Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, products.length)} of {products.length}
              </div>
            </div>
            <Table
              columns={[
                {
                  key: 'image',
                  header: 'Image',
                  render: (product: any) => (
                    <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                      {product.image_path ? (
                        <ProductImage imagePath={product.image_path} alt={product.name} />
                      ) : (
                        <span className="text-2xl">
                          {product.category === 'KITCHEN' ? '🍽️' : product.category === 'BAR' ? '🍺' : '🏨'}
                        </span>
                      )}
                    </div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'name',
                  header: 'Name',
                  render: (product: any) => (
                    <div className="text-sm font-semibold text-slate-900">{product.name}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'category',
                  header: 'Category',
                  render: (product: any) => (
                    <span className="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                      {product.category}
                    </span>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'description',
                  header: 'Description',
                  render: (product: any) => (
                    <div className="text-sm text-slate-600 max-w-xs truncate" title={product.description || ''}>
                      {product.description || '-'}
                    </div>
                  )
                },
                {
                  key: 'price',
                  header: 'Price',
                  render: (product: any) => (
                    <div className="text-sm font-bold text-green-600">₦{product.price?.toFixed(2) || '0.00'}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'cost_price',
                  header: 'Cost Price',
                  render: (product: any) => (
                    <div className="text-sm text-slate-600">₦{product.cost_price?.toFixed(2) || '0.00'}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'fridge_stock',
                  header: 'Fridge Stock',
                  align: 'center',
                  render: (product: any) => (
                    <div className={`text-sm font-semibold ${(product.fridge_stock || 0) < 5 ? 'text-red-600' : 'text-slate-900'}`}>
                      {product.fridge_stock || 0}
                    </div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'show_stock',
                  header: 'Show Stock',
                  align: 'center',
                  render: (product: any) => (
                    <div className="text-sm font-semibold text-slate-900">{product.show_stock || 0}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'store_stock',
                  header: 'Store Stock',
                  align: 'center',
                  render: (product: any) => (
                    <div className="text-sm font-semibold text-slate-900">{product.store_stock || 0}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'min_stock_level',
                  header: 'Min Stock',
                  render: (product: any) => (
                    <div className="text-sm text-slate-600">{product.min_stock_level || 0}</div>
                  ),
                  className: 'whitespace-nowrap'
                },
                {
                  key: 'barcode',
                  header: 'Barcode',
                  render: (product: any) => (
                    <div className="text-sm text-slate-500 font-mono">{product.barcode || '-'}</div>
                  ),
                  className: 'whitespace-nowrap'
                }
              ]}
              data={products.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)}
              rowKey={(product) => product.id}
              emptyMessage="No products found"
            />
            {/* Pagination */}
            {products.length > itemsPerPage && (
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
                <div className="flex-1 flex justify-between sm:hidden">
                  <button
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setCurrentPage(prev => Math.min(Math.ceil(products.length / itemsPerPage), prev + 1))}
                    disabled={currentPage === Math.ceil(products.length / itemsPerPage)}
                    className="ml-3 relative inline-flex items-center px-4 py-2 border border-slate-300 text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
                <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-slate-700">
                      Showing <span className="font-medium">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                      <span className="font-medium">{Math.min(currentPage * itemsPerPage, products.length)}</span> of{' '}
                      <span className="font-medium">{products.length}</span> results
                    </p>
                  </div>
                  <div>
                    <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="sr-only">Previous</span>
                        ‹
                      </button>
                      {Array.from({ length: Math.ceil(products.length / itemsPerPage) }, (_, i) => i + 1)
                        .filter(page => {
                          // Show first page, last page, current page, and pages around current
                          return page === 1 || 
                                 page === Math.ceil(products.length / itemsPerPage) ||
                                 (page >= currentPage - 1 && page <= currentPage + 1)
                        })
                        .map((page, idx, arr) => {
                          // Add ellipsis if there's a gap
                          const showEllipsisBefore = idx > 0 && arr[idx - 1] !== page - 1
                          return (
                            <React.Fragment key={page}>
                              {showEllipsisBefore && (
                                <span className="relative inline-flex items-center px-4 py-2 border border-slate-300 bg-white text-sm font-medium text-slate-700">
                                  ...
                                </span>
                              )}
                              <button
                                onClick={() => setCurrentPage(page)}
                                className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                  currentPage === page
                                    ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                {page}
                              </button>
                            </React.Fragment>
                          )
                        })}
                      <button
                        onClick={() => setCurrentPage(prev => Math.min(Math.ceil(products.length / itemsPerPage), prev + 1))}
                        disabled={currentPage === Math.ceil(products.length / itemsPerPage)}
                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-slate-300 bg-white text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <span className="sr-only">Next</span>
                        ›
                      </button>
                    </nav>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add Product Modal */}
        {showAddModal && (
          <AddProductModal
            onClose={() => setShowAddModal(false)}
            onSave={addProduct}
        businessId={businessId}
            businessModules={businessModules}
          />
        )}

        {/* Import Products Modal */}
        {showImportModal && (
          <ImportProductsModal
            onClose={() => setShowImportModal(false)}
            onImportComplete={async () => {
              setShowImportModal(false)
              // Small delay to ensure database commits
              await new Promise(resolve => setTimeout(resolve, 300))
              await loadProducts()
            }}
            businessId={businessId}
          />
        )}
      </div>
    </div>
  )
}

function AddProductModal({ onClose, onSave, businessModules, businessId }: {
  onClose: () => void
  onSave: (product: any) => void
  businessModules: string[]
  businessId: number
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'BAR',
    price: '',
    costPrice: '',
    stockQuantity: '',
    minStockLevel: '',
    fridgeStock: '',
    showStock: '',
    storeStock: '',
    barcode: '',
    serialNumber: '',
    imagePath: ''
  })
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({
      ...formData,
      price: parseFloat(formData.price),
      costPrice: parseFloat(formData.costPrice),
      stockQuantity: parseInt(formData.stockQuantity) || 0,
      minStockLevel: parseInt(formData.minStockLevel) || 0,
      fridgeStock: parseInt(formData.fridgeStock) || 0,
      showStock: parseInt(formData.showStock) || 0,
      storeStock: parseInt(formData.storeStock) || 0,
      business_id: businessId,
      image_path: formData.imagePath
    })
  }

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB')
      return
    }

    try {
      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      // Convert to base64 and store
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          resolve(result)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      // Save image using Tauri command
      const imagePath = await invoke('save_product_image', {
        imageData: base64,
        productName: formData.name || 'product',
        businessId: businessId
      }) as string

      setFormData(prev => ({ ...prev, imagePath }))
      toast.success('Image uploaded successfully')
    } catch (error) {
      console.error('Failed to upload image:', error)
      toast.error('Failed to upload image')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800">Add New Product</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Product Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => updateFormData('name', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter product name"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => updateFormData('description', e.target.value)}
                rows={3}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Product description (optional)"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Category *
              </label>
              <select
                value={formData.category}
                onChange={(e) => updateFormData('category', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {businessModules.map(module => {
                  const moduleConfigs: Record<string, { icon: string; label: string }> = {
                    BAR: { icon: '🍸', label: 'BAR - Drinks & Cocktails' },
                    KITCHEN: { icon: '👨‍🍳', label: 'KITCHEN - Food Items' },
                    ROOM: { icon: '🏨', label: 'ROOM - Amenities & Services' }
                  }

                  const moduleConfig = moduleConfigs[module]

                  return moduleConfig ? (
                    <option key={module} value={module}>
                      {moduleConfig.icon} {moduleConfig.label}
                    </option>
                  ) : null
                })}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Selling Price (₦) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.price}
                onChange={(e) => updateFormData('price', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Cost Price (₦) *
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.costPrice}
                onChange={(e) => updateFormData('costPrice', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Fridge Stock (for POS) *
              </label>
              <input
                type="number"
                required
                value={formData.fridgeStock}
                onChange={(e) => updateFormData('fridgeStock', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Show Stock (for display)
              </label>
              <input
                type="number"
                value={formData.showStock}
                onChange={(e) => updateFormData('showStock', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Store Stock (warehouse)
              </label>
              <input
                type="number"
                value={formData.storeStock}
                onChange={(e) => updateFormData('storeStock', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Min Stock Level
              </label>
              <input
                type="number"
                value={formData.minStockLevel}
                onChange={(e) => updateFormData('minStockLevel', e.target.value)}
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="5"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Barcode (Optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.barcode}
                  onChange={(e) => updateFormData('barcode', e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Scan or enter barcode"
                  id="barcode-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    // Focus on barcode input and trigger scan mode
                    const input = document.getElementById('barcode-input') as HTMLInputElement
                    if (input) {
                      input.focus()
                      input.select()
                    }
                    toast('Ready to scan! Use your barcode scanner or type the code.', { duration: 3000 })
                  }}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                >
                  📷 Scan
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Serial Number (Optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.serialNumber}
                  onChange={(e) => updateFormData('serialNumber', e.target.value)}
                  className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Scan or enter serial number"
                  id="serial-input"
                />
                <button
                  type="button"
                  onClick={() => {
                    // Focus on serial input and trigger scan mode
                    const input = document.getElementById('serial-input') as HTMLInputElement
                    if (input) {
                      input.focus()
                      input.select()
                    }
                    toast('Ready to scan! Use your barcode scanner or type the code.', { duration: 3000 })
                  }}
                  className="px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
                >
                  📷 Scan
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Product Image (Optional)
              </label>
              <div className="space-y-3">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {imagePreview && (
                  <div className="mt-3">
                    <img
                      src={imagePreview}
                      alt="Product preview"
                      className="w-32 h-32 object-cover rounded-lg border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setImagePreview(null)
                        setFormData(prev => ({ ...prev, imagePath: '' }))
                      }}
                      className="mt-2 text-sm text-red-600 hover:text-red-700"
                    >
                      Remove Image
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex space-x-4 pt-6 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Add Product
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
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [transferModal, setTransferModal] = useState<any>(null)
  const isAdmin = currentUser?.role === 'SuperAdmin'
  const isSecretary = currentUser?.role === 'Secretary'
  const canEditStore = isAdmin || isSecretary

  useEffect(() => {
    loadProducts()
  }, [])

  const loadProducts = async () => {
    try {
      setLoading(true)
      const businessId = currentUser?.business_id
      if (businessId) {
        const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
        setProducts(businessProducts)
      }
    } catch (error) {
      console.error('Failed to load products:', error)
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
        reason: 'Store stock update'
      })
      toast.success('Store stock updated successfully')
      await loadProducts()
      setEditingProduct(null)
    } catch (error) {
      console.error('Failed to update store stock:', error)
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
        userId: currentUser?.id || 1
      })
      toast.success(`Stock transferred from ${from} to ${to} successfully`)
      await loadProducts()
      setTransferModal(null)
    } catch (error) {
      console.error('Failed to transfer stock:', error)
      toast.error(`Failed to transfer stock: ${error}`)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading inventory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Inventory Management</h1>
          <p className="text-slate-600 text-lg">Manage fridge stock, show stock, and store stock</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-800">Stock Overview</h2>
            <p className="text-sm text-slate-600 mt-1">Fridge stock is used for POS, show stock for display, store stock for warehouse</p>
          </div>

          <Table
            columns={[
              {
                key: 'product',
                header: 'Product',
                render: (product: any) => {
                  const fridgeStock = product.fridge_stock || 0
                  const isLowFridgeStock = fridgeStock < 5
                  return (
                    <>
                      <div className="font-semibold text-slate-800">{product.name}</div>
                      <div className="text-xs text-slate-500">{product.category}</div>
                      {isLowFridgeStock && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">
                          Low Fridge Stock
                        </span>
                      )}
                    </>
                  )
                }
              },
              {
                key: 'fridge_stock',
                header: 'Fridge Stock',
                align: 'center',
                render: (product: any) => {
                  const fridgeStock = product.fridge_stock || 0
                  const isLowFridgeStock = fridgeStock < 5
                  return (
                    <div className={`font-bold ${isLowFridgeStock ? 'text-red-600' : 'text-slate-700'}`}>
                      {fridgeStock}
                    </div>
                  )
                }
              },
              {
                key: 'show_stock',
                header: 'Show Stock',
                align: 'center',
                render: (product: any) => (
                  <div className="font-bold text-slate-700">{product.show_stock || 0}</div>
                )
              },
              {
                key: 'store_stock',
                header: 'Store Stock',
                align: 'center',
                render: (product: any) => {
                  const storeStock = product.store_stock || 0
                  if (editingProduct?.id === product.id) {
                    return (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          defaultValue={storeStock}
                          onBlur={(e) => {
                            const newStock = parseInt(e.target.value) || 0
                            const change = newStock - storeStock
                            if (change !== 0) {
                              handleUpdateStoreStock(product.id, change)
                            } else {
                              setEditingProduct(null)
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const newStock = parseInt((e.target as HTMLInputElement).value) || 0
                              const change = newStock - storeStock
                              if (change !== 0) {
                                handleUpdateStoreStock(product.id, change)
                              } else {
                                setEditingProduct(null)
                              }
                            } else if (e.key === 'Escape') {
                              setEditingProduct(null)
                            }
                          }}
                          className="w-20 px-2 py-1 border border-slate-300 rounded text-center"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )
                  }
                  return (
                    <div className="flex items-center justify-center gap-2">
                      <div className="font-bold text-slate-700">{storeStock}</div>
                      {canEditStore && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingProduct(product)
                          }}
                          className="text-blue-600 hover:text-blue-700 text-xs"
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </div>
                  )
                }
              },
              {
                key: 'actions',
                header: 'Actions',
                align: 'center',
                render: (product: any) => {
                  const storeStock = product.store_stock || 0
                  if (!canEditStore || storeStock <= 0) return null
                  return (
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setTransferModal({ product, from: 'store', to: 'fridge' })
                        }}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded font-medium"
                      >
                        ➡️ To Fridge
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setTransferModal({ product, from: 'store', to: 'show' })
                        }}
                        className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded font-medium"
                      >
                        ➡️ To Show
                      </button>
                    </div>
                  )
                }
              }
            ]}
            data={products}
            rowKey={(product) => product.id}
            rowClassName={(product) => {
              const fridgeStock = product.fridge_stock || 0
              return fridgeStock < 5 ? 'bg-red-50' : ''
            }}
            emptyMessage="No products found"
          />
        </div>

        {/* Transfer Stock Modal */}
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

function BusinessStaff() {
  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <h1 className="text-3xl font-bold text-slate-800 mb-2">Staff Management</h1>
        <p className="text-slate-600 text-lg">Manage your team members and permissions</p>
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-12">
          <div className="text-center">
            <div className="text-6xl mb-4">👥</div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Team Management</h2>
            <p className="text-slate-600">Staff management interface coming next</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function StaffPOSInterface({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [products, setProducts] = useState<any[]>([])
  const [cart, setCart] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processingPayment, setProcessingPayment] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [saleLocation, setSaleLocation] = useState<'fridge' | 'show'>('fridge')
  const [scanInput, setScanInput] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)

  // Get business ID from user or business info
  const businessId = currentUser?.business_id || businessInfo?.id

  // Extract business modules to determine available categories
  const businessModules = React.useMemo(() => {
    if (businessInfo && businessInfo.modules_enabled) {
      try {
        const modules = JSON.parse(businessInfo.modules_enabled)
        return modules
      } catch (error) {
        console.error('Failed to parse business modules:', error)
        return ['BAR', 'KITCHEN']
      }
    }
    return ['BAR', 'KITCHEN'] // Default fallback
  }, [businessInfo])

  // Set default category to ALL initially to show all products
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')

  useEffect(() => {
    console.log('POS: useEffect triggered. businessId:', businessId, 'currentUser:', currentUser?.id, 'businessInfo:', businessInfo?.id)
    if (businessId) {
      loadProducts()
    } else {
      console.warn('POS: No business ID available. currentUser?.business_id:', currentUser?.business_id, 'businessInfo?.id:', businessInfo?.id)
      setLoading(false)
    }
  }, [businessId, currentUser, businessInfo])

  const loadProducts = async () => {
    try {
      setLoading(true)
      console.log('POS: Loading products for business ID:', businessId)
      if (!businessId) {
        console.error('POS: No business ID available')
        setProducts([])
        setLoading(false)
        return
      }
      
      console.log('POS: About to load products for businessId:', businessId, 'Type:', typeof businessId)
      const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
      console.log('POS: Loaded products:', businessProducts)
      console.log('POS: Loaded products count:', businessProducts?.length || 0)
      
      // Debug: Also try to get all products to see what's in the database
      try {
        const allProducts = await invoke('get_all_products') as any[]
        console.log('POS: All products in database:', allProducts)
        console.log('POS: All products count:', allProducts?.length || 0)
        if (allProducts.length > 0) {
          console.log('POS: Sample product business_id:', allProducts[0]?.business_id)
          console.log('POS: Sample product category:', allProducts[0]?.category)
          console.log('POS: Sample product is_active:', allProducts[0]?.is_active)
        }
      } catch (e) {
        console.error('POS: Failed to get all products for debugging:', e)
      }
      
      if (businessProducts && Array.isArray(businessProducts)) {
        console.log('POS: Setting products array with', businessProducts.length, 'items')
        setProducts(businessProducts)
      } else {
        console.warn('POS: Products is not an array:', businessProducts)
        setProducts([])
      }
    } catch (error) {
      console.error('POS: Failed to load products:', error)
      toast.error(`Failed to load products: ${error}`)
      setProducts([])
    } finally {
      setLoading(false)
    }
  }

  const addToCart = (product: any) => {
    const existingItem = cart.find(item => item.product.id === product.id)

    if (existingItem) {
      setCart(cart.map(item =>
        item.product.id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ))
    } else {
      setCart([...cart, {
        product,
        quantity: 1,
        unitPrice: product.price
      }])
    }
    toast.success(`Added ${product.name} to cart`)
  }

  // Handle barcode/serial number scan for cart
  const handleScanInput = async (code: string) => {
    if (!code || !code.trim()) return

    try {
      const product = await invoke('find_product_by_code', {
        code: code.trim(),
        businessId: businessId
      }) as any

      if (product) {
        // Check stock availability
        const stock = saleLocation === 'fridge' ? (product.fridge_stock || 0) : (product.show_stock || 0)
        if (stock <= 0) {
          toast.error(`Product "${product.name}" is out of stock`)
          return
        }
        addToCart(product)
        setScanInput('')
        if (scanInputRef.current) {
          scanInputRef.current.focus()
        }
      } else {
        toast.error(`Product not found for code: ${code}`)
      }
    } catch (error) {
      console.error('Failed to find product:', error)
      toast.error(`Failed to find product: ${error}`)
    }
  }

  // Handle scan input change (for barcode scanner that types quickly)
  useEffect(() => {
    if (scanInput && scanInput.length > 3) {
      // Debounce: wait a bit to see if more characters are coming
      const timer = setTimeout(async () => {
        if (!scanInput || !scanInput.trim()) return

        try {
          const product = await invoke('find_product_by_code', {
            code: scanInput.trim(),
            businessId: businessId
          }) as any

          if (product) {
            // Check stock availability
            const stock = saleLocation === 'fridge' ? (product.fridge_stock || 0) : (product.show_stock || 0)
            if (stock <= 0) {
              toast.error(`Product "${product.name}" is out of stock`)
              return
            }
            addToCart(product)
            setScanInput('')
            if (scanInputRef.current) {
              scanInputRef.current.focus()
            }
          } else {
            toast.error(`Product not found for code: ${scanInput}`)
          }
        } catch (error) {
          console.error('Failed to find product:', error)
          toast.error(`Failed to find product: ${error}`)
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [scanInput, businessId, saleLocation])

  const scannerRef = useRef<Html5Qrcode | null>(null)

  // Start camera scanner
  const startCameraScanner = async () => {
    if (isScanning) {
      stopCameraScanner()
      return
    }

    try {
      setIsScanning(true)
      const html5QrCode = new Html5Qrcode("barcode-scanner")
      scannerRef.current = html5QrCode
      
      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          handleScanInput(decodedText)
          html5QrCode.stop()
          setIsScanning(false)
          scannerRef.current = null
        },
        (_errorMessage) => {
          // Ignore errors, just keep scanning
        }
      )
    } catch (error) {
      console.error('Failed to start camera:', error)
      toast.error('Failed to start camera. Please check permissions.')
      setIsScanning(false)
      scannerRef.current = null
    }
  }

  const stopCameraScanner = async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop()
        scannerRef.current = null
      }
      setIsScanning(false)
    } catch (error) {
      // Ignore errors
      setIsScanning(false)
      scannerRef.current = null
    }
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
        scannerRef.current = null
      }
    }
  }, [])

  const updateQuantity = (productId: number, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCart(cart.filter(item => item.product.id !== productId))
    } else {
      setCart(cart.map(item =>
        item.product.id === productId
          ? { ...item, quantity: newQuantity }
          : item
      ))
    }
  }

  const getTotal = () => {
    return cart.reduce((total, item) => total + (item.unitPrice * item.quantity), 0)
  }

  const processPayment = async (paymentMethod: string) => {
    setProcessingPayment(true)
    try {
      const saleData = {
        items: cart.map(item => ({
          product_id: item.product.id,
          quantity: item.quantity,
          unit_price: item.unitPrice
        })),
        payment_method: paymentMethod,
        staff_id: currentUser?.id || 1,
        business_id: businessId || 1,
        location: saleLocation // Use selected location (fridge or show)
      }

      const result = await invoke('process_sale', { request: saleData }) as {
        sale_id: number
        total_amount: number
        payment_method: string
        items: number
        timestamp: string
      }

      // Clear cart and show success
      setCart([])
      setShowPaymentModal(false)

      toast.success(`Sale completed!\nSale ID: ${result.sale_id}\nTotal: ₦${result.total_amount}\nPayment: ${result.payment_method}`, {
        duration: 6000,
      })

      // Refresh products to show updated inventory
      await loadProducts()

    } catch (error) {
      console.error('Payment failed:', error)
      toast.error(`Payment failed: ${error}`)
    } finally {
      setProcessingPayment(false)
    }
  }

  // Filter products by selected category and search query
  // Check for low stock and show notification
  useEffect(() => {
    const lowStockProducts = products.filter(p => (p.fridge_stock || 0) < 5 && (p.fridge_stock || 0) > 0)
    if (lowStockProducts.length > 0) {
      toast.error(`⚠️ Low Stock Alert: ${lowStockProducts.length} product(s) have less than 5 items in fridge stock!`, {
        duration: 8000,
      })
    }
  }, [products])

  const filteredProducts = React.useMemo(() => {
    console.log('POS: Filtering products. Total products:', products.length, 'Selected category:', selectedCategory, 'Search query:', searchQuery)
    const filtered = products.filter(product => {
      // Filter based on selected location (fridge or show)
      const stock = saleLocation === 'fridge' ? (product.fridge_stock || 0) : (product.show_stock || 0)
      const hasStock = stock > 0
      const matchesCategory = selectedCategory === 'ALL' || product.category === selectedCategory
      const matchesSearch = !searchQuery || 
        product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (product.description && product.description.toLowerCase().includes(searchQuery.toLowerCase()))
      const matches = hasStock && matchesCategory && matchesSearch
      if (!matches && products.length > 0) {
        console.log('POS: Product filtered out:', product.name, 'Category:', product.category, 'Selected:', selectedCategory, 'Matches category:', matchesCategory, 'Matches search:', matchesSearch)
      }
      return matches
    })
    console.log('POS: Filtered products count:', filtered.length)
    return filtered
  }, [products, selectedCategory, searchQuery])

  // Only show categories that are enabled in business modules
  const availableCategories = React.useMemo(() => {
    const allCategories = Array.from(new Set(products.map(p => p.category)))
    return allCategories.filter(cat => businessModules.includes(cat))
  }, [products, businessModules])

  const categories = ['ALL', ...availableCategories]

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading products...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      <div className="p-6 w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                Point of Sale
              </h1>
              <p className="text-slate-600 text-lg">Select products and process orders</p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Sale Location</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSaleLocation('fridge')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    saleLocation === 'fridge'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  🧊 Fridge
                </button>
                <button
                  onClick={() => setSaleLocation('show')}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    saleLocation === 'show'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  🎨 Show
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Product Selection */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search Bar */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="🔍 Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-3 pl-12 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-700"
                />
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400">
                  🔍
                </div>
              </div>
            </div>

            {/* Category Filter - Modern Design */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Select Category</h3>
              <div className="flex flex-wrap gap-3">
                {categories.map(category => {
                  const isKitchen = category === 'KITCHEN'
                  const isBar = category === 'BAR'
                  
                  return (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={`px-6 py-3 rounded-xl font-semibold transition-all duration-200 transform hover:scale-105 ${
                        selectedCategory === category
                          ? isKitchen
                            ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-lg'
                            : isBar
                            ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg'
                            : 'bg-gradient-to-r from-blue-500 to-purple-500 text-white shadow-lg'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {category === 'ALL' ? '🌐 All' : 
                       category === 'KITCHEN' ? '🍽️ Kitchen' :
                       category === 'BAR' ? '🍺 Bar' : category}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Products Grid - Modern Card Design */}
            <div className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-slate-800">
                  {selectedCategory === 'ALL' ? 'All Products' : 
                   selectedCategory === 'KITCHEN' ? '🍽️ Kitchen Menu' :
                   selectedCategory === 'BAR' ? '🍺 Bar Menu' : selectedCategory}
                </h2>
                <span className="px-4 py-2 bg-blue-100 text-blue-800 rounded-full font-semibold text-sm">
                  {filteredProducts.length} items
                </span>
              </div>

              {filteredProducts.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-8xl mb-4">📦</div>
                  <h3 className="text-2xl font-semibold text-slate-700 mb-2">No products found</h3>
                  <p className="text-slate-500 mb-4">
                    {searchQuery ? 'Try a different search term' : 
                     products.length === 0 ? 'No products available for this business' :
                     `No products match category "${selectedCategory}". Total products: ${products.length}`}
                  </p>
                  {products.length > 0 && (
                    <div className="mt-4 text-sm text-slate-600">
                      <p>Available categories: {Array.from(new Set(products.map(p => p.category))).join(', ')}</p>
                      <button
                        onClick={() => setSelectedCategory('ALL')}
                        className="mt-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                      >
                        Show All Products
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-y-auto max-h-[calc(100vh-400px)] pr-2">
                  <Table
                    columns={[
                      {
                        key: 'image',
                        header: 'Image',
                        render: (product: any) => {
                          const isKitchen = product.category === 'KITCHEN'
                          const isBar = product.category === 'BAR'
                          return (
                            <div className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                              {product.image_path ? (
                                <ProductImage imagePath={product.image_path} alt={product.name} />
                              ) : (
                                <div className="text-2xl">
                                  {isKitchen ? '🍽️' : isBar ? '🍺' : '🏨'}
                                </div>
                              )}
                            </div>
                          )
                        },
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      },
                      {
                        key: 'name',
                        header: 'Product Name',
                        render: (product: any) => {
                          const fridgeStock = product.fridge_stock || 0
                          const isLowStock = fridgeStock < 5
                          return (
                            <>
                              <div className="font-semibold text-slate-800">{product.name}</div>
                              {product.description && (
                                <div className="text-xs text-slate-500 mt-1 line-clamp-1">{product.description}</div>
                              )}
                              {isLowStock && (
                                <span className="inline-block mt-1 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">
                                  Low Stock
                                </span>
                              )}
                            </>
                          )
                        },
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      },
                      {
                        key: 'category',
                        header: 'Category',
                        render: (product: any) => {
                          const isKitchen = product.category === 'KITCHEN'
                          const isBar = product.category === 'BAR'
                          return (
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              isKitchen ? 'bg-orange-100 text-orange-700' : 
                              isBar ? 'bg-amber-100 text-amber-700' : 
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {product.category}
                            </span>
                          )
                        },
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      },
                      {
                        key: 'price',
                        header: 'Price',
                        render: (product: any) => {
                          const isKitchen = product.category === 'KITCHEN'
                          const isBar = product.category === 'BAR'
                          return (
                            <div className={`font-bold text-lg ${
                              isKitchen ? 'text-orange-600' : isBar ? 'text-amber-600' : 'text-blue-600'
                            }`}>
                              ₦{product.price.toLocaleString()}
                            </div>
                          )
                        },
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      },
                      {
                        key: saleLocation === 'fridge' ? 'fridge_stock' : 'show_stock',
                        header: saleLocation === 'fridge' ? 'Fridge Stock' : 'Show Stock',
                        render: (product: any) => {
                          const stock = saleLocation === 'fridge' ? (product.fridge_stock || 0) : (product.show_stock || 0)
                          const isLowStock = stock < 5
                          return (
                            <div className={`font-semibold ${
                              isLowStock ? 'text-red-600' : 'text-slate-700'
                            }`}>
                              {stock}
                            </div>
                          )
                        },
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      },
                      {
                        key: 'action',
                        header: 'Action',
                        align: 'center',
                        render: (product: any) => (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              addToCart(product)
                            }}
                            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                          >
                            ➕ Add
                          </button>
                        ),
                        headerClassName: 'px-4 py-3',
                        className: 'px-4 py-3'
                      }
                    ]}
                    data={filteredProducts}
                    rowKey={(product) => product.id}
                    rowClassName={(product) => {
                      const fridgeStock = product.fridge_stock || 0
                      return fridgeStock < 5 ? 'bg-red-50' : ''
                    }}
                    emptyMessage="No products found"
                    headerClassName="bg-slate-50 border-b border-slate-200"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Order Summary - Modern Design */}
          <div className="bg-gradient-to-br from-white to-blue-50 rounded-2xl shadow-xl border-2 border-blue-200 p-6 h-fit sticky top-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Current Order
              </h2>
              {cart.length > 0 && (
                <span className="px-3 py-1 bg-blue-500 text-white rounded-full text-sm font-bold">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)} items
                </span>
              )}
            </div>

            {/* Barcode Scanner Input */}
            <div className="mb-4 bg-white rounded-xl p-4 shadow-md border border-slate-200">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                📷 Scan Barcode/Serial Number
              </label>
              <div className="flex gap-2">
                <input
                  ref={scanInputRef}
                  type="text"
                  value={scanInput}
                  onChange={(e) => setScanInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && scanInput.trim()) {
                      handleScanInput(scanInput)
                    }
                  }}
                  placeholder="Scan or type barcode/serial"
                  className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={startCameraScanner}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    isScanning
                      ? 'bg-red-500 hover:bg-red-600 text-white'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'
                  }`}
                >
                  {isScanning ? '⏹️ Stop' : '📷 Camera'}
                </button>
              </div>
              {isScanning && (
                <div className="mt-3">
                  <div id="barcode-scanner" className="w-full rounded-lg overflow-hidden"></div>
                  <p className="text-xs text-slate-500 mt-2 text-center">Point camera at barcode</p>
                </div>
              )}
            </div>

            {cart.length === 0 ? (
              <div className="text-center text-slate-400 py-12">
                <div className="text-6xl mb-4 opacity-50">🛒</div>
                <p className="text-lg font-medium">Cart is empty</p>
                <p className="text-sm mt-2">Select products to add</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 mb-6 max-h-96 overflow-y-auto pr-2">
                  {cart.map((item, index) => {
                    const itemTotal = item.unitPrice * item.quantity
                    return (
                      <div key={index} className="bg-white rounded-xl p-4 shadow-md border border-slate-200 hover:shadow-lg transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="font-bold text-slate-800 text-sm mb-1">{item.product.name}</div>
                            <div className="text-slate-500 text-xs">₦{item.unitPrice.toLocaleString()} each</div>
                          </div>
                          <div className="text-right">
                            <div className="font-extrabold text-blue-600 text-sm">₦{itemTotal.toLocaleString()}</div>
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200">
                          <span className="text-xs text-slate-500">Quantity</span>
                          <div className="flex items-center space-x-3">
                            <button
                              onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                              className="w-8 h-8 bg-gradient-to-r from-red-400 to-red-500 hover:from-red-500 hover:to-red-600 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition-all transform hover:scale-110"
                            >
                              −
                            </button>
                            <span className="w-10 text-center font-bold text-slate-800 text-lg">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                              className="w-8 h-8 bg-gradient-to-r from-green-400 to-green-500 hover:from-green-500 hover:to-green-600 text-white rounded-lg font-bold shadow-md hover:shadow-lg transition-all transform hover:scale-110"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="border-t-2 border-blue-200 pt-4 space-y-4">
                  <div className="bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl p-4 text-white">
                    <div className="flex justify-between items-center">
                      <span className="text-lg font-semibold">Total Amount</span>
                      <span className="text-3xl font-extrabold">₦{getTotal().toLocaleString()}</span>
                    </div>
                  </div>

                  {cart.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowPaymentModal(true)}
                        disabled={processingPayment}
                        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:from-slate-400 disabled:to-slate-500 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:scale-105 disabled:transform-none"
                      >
                        {processingPayment ? (
                          <span className="flex items-center justify-center">
                            <span className="animate-spin mr-2">⏳</span>
                            Processing...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center">
                            💳 Process Payment
                          </span>
                        )}
                      </button>

                      <button
                        onClick={() => setCart([])}
                        disabled={processingPayment}
                        className="w-full bg-gradient-to-r from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700 disabled:from-slate-400 disabled:to-slate-500 text-white py-3 px-6 rounded-xl font-semibold shadow-md hover:shadow-lg transition-all transform hover:scale-105 disabled:transform-none"
                      >
                        🗑️ Clear Order
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          total={getTotal()}
          onPayment={processPayment}
          onClose={() => setShowPaymentModal(false)}
          processing={processingPayment}
        />
      )}
    </div>
  )
}

function PaymentModal({ total, onPayment, onClose, processing }: {
  total: number
  onPayment: (method: string) => void
  onClose: () => void
  processing: boolean
}) {
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [customerPaid, setCustomerPaid] = useState('')
  const [change, setChange] = useState(0)

  const calculateChange = (paid: string) => {
    const paidAmount = parseFloat(paid) || 0
    const changeAmount = Math.max(0, paidAmount - total)
    setChange(changeAmount)
  }

  const handlePayment = () => {
    if (paymentMethod === 'CASH' && parseFloat(customerPaid) < total) {
      toast.error('Payment amount is less than total!')
      return
    }
    onPayment(paymentMethod)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800">Payment</h2>
            <button
              onClick={onClose}
              disabled={processing}
              className="text-slate-400 hover:text-slate-600 text-2xl disabled:opacity-50"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-center">
              <div className="text-3xl font-bold text-slate-800 mb-1">
                ₦{total.toLocaleString()}
              </div>
              <div className="text-slate-600">Total Amount</div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-3">
              Payment Method
            </label>
            <div className="space-y-2">
              {[
                { value: 'CASH', label: '💵 Cash', icon: '💵' },
                { value: 'CARD', label: '💳 Card', icon: '💳' },
                { value: 'EXTERNAL_POS', label: '🖥️ External POS', icon: '🖥️' }
              ].map(method => (
                <button
                  key={method.value}
                  onClick={() => setPaymentMethod(method.value)}
                  disabled={processing}
                  className={`w-full p-3 rounded-lg border text-left transition-colors ${
                    paymentMethod === method.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  } disabled:opacity-50`}
                >
                  <span className="font-medium">{method.label}</span>
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'CASH' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Customer Paid (₦)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={customerPaid}
                  onChange={(e) => {
                    setCustomerPaid(e.target.value)
                    calculateChange(e.target.value)
                  }}
                  disabled={processing}
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-slate-100"
                  placeholder="Enter amount paid"
                />
              </div>

              {customerPaid && parseFloat(customerPaid) >= total && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-green-700 font-medium">Change:</span>
                    <span className="text-green-700 font-bold text-lg">
                      ₦{change.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex space-x-3 pt-4">
            <button
              onClick={onClose}
              disabled={processing}
              className="flex-1 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handlePayment}
              disabled={processing || (paymentMethod === 'CASH' && !customerPaid)}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              {processing ? 'Processing...' : `✅ Complete Payment`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StaffInventoryCheck({ currentUser }: { currentUser: any }) {
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const businessId = currentUser?.business_id

  useEffect(() => {
    if (businessId) {
      loadProducts()
    } else {
      setLoading(false)
    }
  }, [businessId])

  const loadProducts = async () => {
    try {
      setLoading(true)
      if (businessId) {
        const businessProducts = await invoke('get_products_for_business', { businessId }) as any[]
        setProducts(businessProducts)
      }
    } catch (error) {
      console.error('Failed to load products:', error)
      toast.error('Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading inventory...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">Stock Check</h1>
          <p className="text-slate-600 text-lg">View fridge stock and show stock levels (Read-only)</p>
        </div>

        <Table
          columns={[
            {
              key: 'name',
              header: 'Product Name',
              render: (product: any) => (
                <>
                  <div className="font-semibold text-slate-800">{product.name}</div>
                  <div className="text-xs text-slate-500">{product.category}</div>
                </>
              )
            },
            {
              key: 'fridge_stock',
              header: 'Fridge Stock',
              align: 'center',
              render: (product: any) => {
                const fridgeStock = product.fridge_stock || 0
                const isLowStock = fridgeStock < 5
                return (
                  <div className={`font-bold text-lg ${isLowStock ? 'text-red-600' : 'text-slate-700'}`}>
                    {fridgeStock}
                  </div>
                )
              }
            },
            {
              key: 'show_stock',
              header: 'Show Stock',
              align: 'center',
              render: (product: any) => {
                const showStock = product.show_stock || 0
                return (
                  <div className="font-bold text-lg text-slate-700">
                    {showStock}
                  </div>
                )
              }
            }
          ]}
          data={products}
          rowKey={(product) => product.id}
          emptyMessage="No products found"
        />
      </div>
    </div>
  )
}

// Placeholder component - replaced by ReportsDashboard which has full functionality
// function BusinessReports() {
//   return (
//     <div className="flex-1 overflow-auto bg-slate-50">
//       <div className="p-8 w-full">
//         <h1 className="text-3xl font-bold text-slate-800 mb-2">Business Reports</h1>
//         <p className="text-slate-600 text-lg">View sales reports and analytics</p>
//         <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-200 p-12">
//           <div className="text-center">
//             <div className="text-6xl mb-4">📊</div>
//             <h2 className="text-2xl font-bold text-slate-800 mb-2">Reports Dashboard</h2>
//             <p className="text-slate-600">Business analytics and reporting coming next</p>
//           </div>
//         </div>
//       </div>
//     </div>
//   )
// }

function SettingsDashboard({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [activeTab, setActiveTab] = useState<'business' | 'email' | 'reports' | 'notifications' | 'system'>('business')
  const isSuperAdmin = currentUser?.role === 'SuperAdmin'

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">⚙️ Settings</h1>
          <p className="text-slate-600 text-lg">Configure your business settings</p>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 mb-6">
          <div className="border-b border-slate-200">
            <div className="flex space-x-1 p-2 overflow-x-auto">
              <button
                onClick={() => setActiveTab('business')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'business'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                🏢 Business Settings
              </button>
              <button
                onClick={() => setActiveTab('email')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'email'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                📧 Email Settings
              </button>
              {isSuperAdmin && (
                <button
                  onClick={() => setActiveTab('reports')}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'reports'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  📊 Report Permissions
                </button>
              )}
              <button
                onClick={() => setActiveTab('notifications')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                  activeTab === 'notifications'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                🔔 Notifications
              </button>
              {isSuperAdmin && (
                <button
                  onClick={() => setActiveTab('system')}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors whitespace-nowrap ${
                    activeTab === 'system'
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  ⚙️ System Preferences
                </button>
              )}
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'business' && <BusinessSettings currentUser={currentUser} businessInfo={businessInfo} />}
            {activeTab === 'email' && <EmailSettings currentUser={currentUser} businessInfo={businessInfo} />}
            {activeTab === 'reports' && isSuperAdmin && <ReportPermissionsSettings currentUser={currentUser} businessInfo={businessInfo} />}
            {activeTab === 'notifications' && <NotificationPreferences currentUser={currentUser} businessInfo={businessInfo} />}
            {activeTab === 'system' && isSuperAdmin && <SystemPreferences currentUser={currentUser} businessInfo={businessInfo} />}
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

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Business Information</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Business Name</label>
            <input
              type="text"
              value={businessData.name}
              onChange={(e) => setBusinessData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Email</label>
            <input
              type="email"
              value={businessData.email}
              onChange={(e) => setBusinessData(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
            <input
              type="tel"
              value={businessData.phone}
              onChange={(e) => setBusinessData(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Address</label>
            <input
              type="text"
              value={businessData.address}
              onChange={(e) => setBusinessData(prev => ({ ...prev, address: e.target.value }))}
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Branding</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Logo</label>
            <div className="flex items-center gap-4">
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Business Logo"
                  className="w-24 h-24 object-contain border border-slate-300 rounded-lg"
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
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer inline-block"
                >
                  {logoPreview ? 'Change Logo' : 'Upload Logo'}
                </label>
                <p className="text-xs text-slate-500 mt-1">Max 5MB, PNG/JPG</p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Primary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={businessData.primary_color}
                onChange={(e) => setBusinessData(prev => ({ ...prev, primary_color: e.target.value }))}
                className="w-16 h-10 border border-slate-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={businessData.primary_color}
                onChange={(e) => setBusinessData(prev => ({ ...prev, primary_color: e.target.value }))}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="#3B82F6"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Secondary Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={businessData.secondary_color}
                onChange={(e) => setBusinessData(prev => ({ ...prev, secondary_color: e.target.value }))}
                className="w-16 h-10 border border-slate-300 rounded cursor-pointer"
              />
              <input
                type="text"
                value={businessData.secondary_color}
                onChange={(e) => setBusinessData(prev => ({ ...prev, secondary_color: e.target.value }))}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="#1E40AF"
              />
            </div>
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg p-4 mb-6">
          <p className="text-sm text-slate-600 mb-2">Color Preview:</p>
          <div className="flex gap-2">
            <div
              className="w-20 h-20 rounded-lg"
              style={{ backgroundColor: businessData.primary_color }}
            />
            <div
              className="w-20 h-20 rounded-lg"
              style={{ backgroundColor: businessData.secondary_color }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Settings'}
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
    if (businessId) {
      loadPreferences()
    }
  }, [businessId])

  const loadPreferences = async () => {
    try {
      setLoading(true)
      const config = await invoke('get_email_config', { businessId }) as any
      setPreferences({
        daily_reports_enabled: config.daily_reports_enabled || false,
        low_stock_enabled: config.low_stock_enabled !== false,
        pending_sales_enabled: config.pending_sales_enabled !== false,
        notification_roles: config.notification_roles || 'SuperAdmin,Manager',
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
      const config = await invoke('get_email_config', { businessId }) as any
      await invoke('save_email_config', {
        request: {
          business_id: businessId,
          ...config,
          daily_reports_enabled: preferences.daily_reports_enabled,
          low_stock_enabled: preferences.low_stock_enabled,
          pending_sales_enabled: preferences.pending_sales_enabled,
          notification_roles: preferences.notification_roles,
        }
      })
      toast.success('Notification preferences saved successfully!')
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
        <p className="text-slate-600">Loading notification preferences...</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Email Notifications</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-800">Low Stock Alerts</p>
              <p className="text-sm text-slate-600">Receive emails when products are running low</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferences.low_stock_enabled}
                onChange={(e) => setPreferences(prev => ({ ...prev, low_stock_enabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-800">Pending Sales Notifications</p>
              <p className="text-sm text-slate-600">Receive emails when sales are pending completion</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferences.pending_sales_enabled}
                onChange={(e) => setPreferences(prev => ({ ...prev, pending_sales_enabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-800">Daily Sales Reports</p>
              <p className="text-sm text-slate-600">Receive daily summary emails of sales performance</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferences.daily_reports_enabled}
                onChange={(e) => setPreferences(prev => ({ ...prev, daily_reports_enabled: e.target.checked }))}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Notification Recipients</h2>
        <div className="p-4 bg-slate-50 rounded-lg">
          <label className="block text-sm font-medium text-slate-700 mb-2">Roles to Receive Notifications</label>
          <input
            type="text"
            value={preferences.notification_roles}
            onChange={(e) => setPreferences(prev => ({ ...prev, notification_roles: e.target.value }))}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="SuperAdmin,Manager"
          />
          <p className="text-xs text-slate-500 mt-1">Comma-separated list of roles (e.g., SuperAdmin,Manager,Secretary)</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </div>
    </form>
  )
}

function SystemPreferences({ }: { currentUser?: any, businessInfo?: any }) {
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)

  const handleExportBackup = async () => {
    try {
      setBackingUp(true)
      setBackupStatus(null)
      
      const backupJson = await invoke('export_database_backup') as string
      
      // Create a blob and download
      const blob = new Blob([backupJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]
      a.download = `pos-backup-${timestamp}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      setBackupStatus('success')
      toast.success('Backup exported successfully!')
    } catch (error) {
      console.error('Failed to export backup:', error)
      setBackupStatus('error')
      toast.error(`Failed to export backup: ${error}`)
    } finally {
      setBackingUp(false)
    }
  }

  const handleImportBackup = async () => {
    // Create file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return

      try {
        setRestoring(true)
        setBackupStatus(null)

        const fileContent = await file.text()
        
        // Validate JSON
        const backupData = JSON.parse(fileContent)
        if (!backupData.data || !backupData.version) {
          throw new Error('Invalid backup file format')
        }

        // Confirm restore (destructive operation)
        const confirmed = window.confirm(
          '⚠️ WARNING: Restoring from backup will replace ALL current data!\n\n' +
          'This action cannot be undone. Are you sure you want to continue?'
        )

        if (!confirmed) {
          setRestoring(false)
          return
        }

        await invoke('import_database_backup', { backupJson: fileContent })
        
        setBackupStatus('success')
        toast.success('Backup restored successfully! Please refresh the application.')
        
        // Suggest reload after a delay
        setTimeout(() => {
          if (window.confirm('Backup restored successfully. Reload the application now?')) {
            window.location.reload()
          }
        }, 2000)
      } catch (error) {
        console.error('Failed to import backup:', error)
        setBackupStatus('error')
        toast.error(`Failed to import backup: ${error}`)
      } finally {
        setRestoring(false)
      }
    }
    input.click()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Backup & Restore</h2>
        
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 mb-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">📦 Export Backup</h3>
            <p className="text-sm text-slate-600 mb-4">
              Create a backup of all your data (users, businesses, products, sales, inventory, settings).
              The backup is saved as a JSON file that you can restore later.
            </p>
            <button
              onClick={handleExportBackup}
              disabled={backingUp}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {backingUp ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Creating Backup...
                </>
              ) : (
                <>
                  💾 Export Backup
                </>
              )}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-4 mt-4">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">🔄 Restore Backup</h3>
            <p className="text-sm text-slate-600 mb-4">
              <strong className="text-red-600">⚠️ Warning:</strong> Restoring from a backup will replace ALL current data 
              with the data from the backup file. This action cannot be undone. Make sure to export a backup first!
            </p>
            <button
              onClick={handleImportBackup}
              disabled={restoring}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {restoring ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Restoring...
                </>
              ) : (
                <>
                  🔄 Import Backup
                </>
              )}
            </button>
          </div>

          {backupStatus === 'success' && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800">✅ Operation completed successfully!</p>
            </div>
          )}

          {backupStatus === 'error' && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">❌ Operation failed. Please check the console for details.</p>
            </div>
          )}
        </div>

        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <h4 className="font-semibold text-blue-900 mb-2">💡 Backup Tips</h4>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Export backups regularly (recommended: weekly or before major changes)</li>
            <li>Store backups in a safe location (external drive, cloud storage)</li>
            <li>Backup files contain all your business data - keep them secure</li>
            <li>Email passwords are not included in backups for security</li>
            <li>After restoring, you may need to reconfigure email settings</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function ReportPermissionsSettings({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permissions, setPermissions] = useState({
    manager_can_view: false,
    secretary_can_view: false,
    staff_can_view: false
  })

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      loadPermissions()
    }
  }, [businessId])

  const loadPermissions = async () => {
    try {
      setLoading(true)
      const perms = await invoke('get_report_permissions', { businessId }) as any
      setPermissions(perms)
    } catch (error) {
      console.error('Failed to load report permissions:', error)
      toast.error('Failed to load report permissions')
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
        staffCanView: permissions.staff_can_view
      })
      toast.success('Report permissions saved successfully!')
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-slate-600">Loading permissions...</p>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-4">Report Access Permissions</h2>
      <p className="text-slate-600 mb-6">
        Control which roles can view reports. SuperAdmin always has access.
      </p>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4">
          <label className="flex items-center cursor-pointer p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={permissions.manager_can_view}
              onChange={(e) => setPermissions({ ...permissions, manager_can_view: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <p className="font-semibold text-slate-800">Manager</p>
              <p className="text-sm text-slate-600">Allow Managers to view reports and analytics</p>
            </div>
          </label>

          <label className="flex items-center cursor-pointer p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={permissions.secretary_can_view}
              onChange={(e) => setPermissions({ ...permissions, secretary_can_view: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <p className="font-semibold text-slate-800">Secretary</p>
              <p className="text-sm text-slate-600">Allow Secretaries to view reports and analytics</p>
            </div>
          </label>

          <label className="flex items-center cursor-pointer p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
            <input
              type="checkbox"
              checked={permissions.staff_can_view}
              onChange={(e) => setPermissions({ ...permissions, staff_can_view: e.target.checked })}
              className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
            />
            <div className="ml-3 flex-1">
              <p className="font-semibold text-slate-800">Staff</p>
              <p className="text-sm text-slate-600">Allow Staff members to view reports and analytics</p>
            </div>
          </label>
        </div>

        <div className="flex space-x-4 pt-4 border-t border-slate-200">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-6 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : '💾 Save Permissions'}
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
      setEmailConfig(config)
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
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [activeTab, setActiveTab] = useState<'sales' | 'revenue' | 'products' | 'staff' | 'inventory'>('sales')
  const [salesReport, setSalesReport] = useState<any>(null)
  const [revenueAnalytics, setRevenueAnalytics] = useState<any>(null)
  const [topProducts, setTopProducts] = useState<any[]>([])
  const [staffPerformance, setStaffPerformance] = useState<any[]>([])
  const [inventoryMovements, setInventoryMovements] = useState<any[]>([])
  // Reserved for future use
  // const [inventoryTransfers, setInventoryTransfers] = useState<any[]>([])
  // const [inventoryAdjustments, setInventoryAdjustments] = useState<any[]>([])
  const [inventorySummary, setInventorySummary] = useState<any>(null)
  const [dateRange, setDateRange] = useState({
    start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0]
  })

  const businessId = currentUser?.business_id || businessInfo?.id
  const userRole = currentUser?.role || ''

  useEffect(() => {
    if (businessId) {
      checkAccess()
    }
  }, [businessId, userRole])

  const checkAccess = async () => {
    try {
      const canView = await invoke('can_user_view_reports', { businessId, userRole: userRole }) as boolean
      setHasAccess(canView)
      if (canView) {
        loadRevenueAnalytics()
        loadSalesReport()
      }
    } catch (error) {
      console.error('Failed to check report access:', error)
      setHasAccess(false)
    }
  }


  const loadRevenueAnalytics = async () => {
    try {
      const analytics = await invoke('get_revenue_analytics', { businessId }) as any
      setRevenueAnalytics(analytics)
    } catch (error) {
      console.error('Failed to load revenue analytics:', error)
      toast.error('Failed to load revenue analytics')
    }
  }

  const loadSalesReport = async () => {
    try {
      setLoading(true)
      const [report, products, staff] = await Promise.all([
        invoke('get_sales_report', { businessId, startDate: dateRange.start, endDate: dateRange.end }) as Promise<any>,
        invoke('get_top_products', { businessId, startDate: dateRange.start, endDate: dateRange.end, limit: 10 }) as Promise<any[]>,
        invoke('get_staff_performance', { businessId, startDate: dateRange.start, endDate: dateRange.end }) as Promise<any[]>,
      ])
      setSalesReport(report)
      setTopProducts(products)
      setStaffPerformance(staff)
    } catch (error) {
      console.error('Failed to load sales report:', error)
      toast.error('Failed to load sales report')
    } finally {
      setLoading(false)
    }
  }

  const loadInventoryReport = async () => {
    try {
      setLoading(true)
      const [summary, movements] = await Promise.all([
        invoke('get_inventory_summary', { businessId }) as Promise<any>,
        invoke('get_inventory_movements', { businessId, startDate: dateRange.start, endDate: dateRange.end }) as Promise<any[]>,
        // Reserved for future use
        // invoke('get_inventory_transfers', { businessId, startDate: dateRange.start, endDate: dateRange.end }) as Promise<any[]>,
        // invoke('get_inventory_adjustments', { businessId, startDate: dateRange.start, endDate: dateRange.end }) as Promise<any[]>,
      ])
      setInventorySummary(summary)
      setInventoryMovements(movements)
      // Reserved for future use
      // setInventoryTransfers(transfers)
      // setInventoryAdjustments(adjustments)
    } catch (error) {
      console.error('Failed to load inventory report:', error)
      toast.error('Failed to load inventory report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasAccess && businessId) {
      if (activeTab === 'inventory') {
        loadInventoryReport()
      } else {
        loadRevenueAnalytics()
        loadSalesReport()
      }
    }
  }, [businessId, dateRange, hasAccess, activeTab])

  const exportToExcel = (data: any[], filename: string, sheetName: string) => {
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    XLSX.writeFile(wb, `${filename}.xlsx`)
    toast.success(`Exported to ${filename}.xlsx`)
  }

  const exportSalesReport = () => {
    if (!salesReport) return
    const data = salesReport.daily_sales?.map((day: any) => ({
      Date: day.date,
      'Total Revenue': day.total,
      'Transaction Count': day.count
    })) || []
    exportToExcel(data, `Sales_Report_${dateRange.start}_to_${dateRange.end}`, 'Sales Report')
  }

  const exportProductsReport = () => {
    const data = topProducts.map((product: any) => ({
      'Product Name': product.name,
      Category: product.category,
      'Quantity Sold': product.total_quantity,
      'Total Revenue': product.total_revenue,
      'Sales Count': product.sale_count,
      Price: product.price
    }))
    exportToExcel(data, `Products_Report_${dateRange.start}_to_${dateRange.end}`, 'Product Performance')
  }

  const exportStaffReport = () => {
    const data = staffPerformance.map((staff: any) => ({
      'Staff Name': staff.name || 'Unknown',
      Role: staff.role,
      'Sales Count': staff.sale_count,
      'Total Revenue': staff.total_revenue,
      'Average Sale': staff.average_sale
    }))
    exportToExcel(data, `Staff_Report_${dateRange.start}_to_${dateRange.end}`, 'Staff Performance')
  }

  const exportInventoryMovements = () => {
    const data = inventoryMovements.map((movement: any) => ({
      Date: movement.created_at,
      'Product Name': movement.product_name,
      Category: movement.category,
      'Transaction Type': movement.transaction_type,
      Quantity: movement.quantity,
      Reason: movement.reason || '',
      'User Name': movement.user_name || 'Unknown',
      'User Role': movement.user_role
    }))
    exportToExcel(data, `Inventory_Movements_${dateRange.start}_to_${dateRange.end}`, 'Inventory Movements')
  }

  // Reserved for future use - Export inventory transfers to Excel
  // const exportInventoryTransfers = () => {
  //   const data = inventoryTransfers.map((transfer: any) => ({
  //     Date: transfer.created_at,
  //     'Product Name': transfer.product_name,
  //     Category: transfer.category,
  //     'Transfer Type': transfer.transaction_type,
  //     Quantity: transfer.quantity,
  //     Reason: transfer.reason || '',
  //     'User Name': transfer.user_name || 'Unknown'
  //   }))
  //   exportToExcel(data, `Inventory_Transfers_${dateRange.start}_to_${dateRange.end}`, 'Inventory Transfers')
  // }

  // Reserved for future use - Export inventory adjustments to Excel
  // const exportInventoryAdjustments = () => {
  //   const data = inventoryAdjustments.map((adjustment: any) => ({
  //     Date: adjustment.created_at,
  //     'Product Name': adjustment.product_name,
  //     Category: adjustment.category,
  //     Quantity: adjustment.quantity,
  //     Reason: adjustment.reason || '',
  //     'User Name': adjustment.user_name || 'Unknown'
  //   }))
  //   exportToExcel(data, `Inventory_Adjustments_${dateRange.start}_to_${dateRange.end}`, 'Inventory Adjustments')
  // }

  if (!hasAccess) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="max-w-md mx-auto mt-20">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
              <div className="text-6xl mb-4">🚫</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Access Denied</h2>
              <p className="text-slate-600">You don't have permission to view reports. Please contact your administrator.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (loading && !salesReport) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading reports...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">📊 Reports & Analytics</h1>
          <p className="text-slate-600 text-lg">Comprehensive business insights and performance metrics</p>
        </div>

        {revenueAnalytics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Today's Revenue</p>
                  <p className="text-2xl font-bold text-blue-600">₦{revenueAnalytics.today?.revenue?.toLocaleString() || '0'}</p>
                  <p className="text-xs text-slate-500 mt-1">{revenueAnalytics.today?.count || 0} sales</p>
                </div>
                <div className="text-4xl">💰</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">This Week</p>
                  <p className="text-2xl font-bold text-green-600">₦{revenueAnalytics.week?.revenue?.toLocaleString() || '0'}</p>
                </div>
                <div className="text-4xl">📈</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">This Month</p>
                  <p className="text-2xl font-bold text-amber-600">₦{revenueAnalytics.month?.revenue?.toLocaleString() || '0'}</p>
                </div>
                <div className="text-4xl">📅</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">All Time</p>
                  <p className="text-2xl font-bold text-purple-600">₦{revenueAnalytics.all_time?.revenue?.toLocaleString() || '0'}</p>
                </div>
                <div className="text-4xl">🏆</div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-slate-700">Date Range:</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-slate-600">to</span>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={loadSalesReport}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg border border-slate-200 mb-6">
          <div className="border-b border-slate-200">
            <div className="flex space-x-1 p-2">
              <button
                onClick={() => setActiveTab('sales')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'sales' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                💰 Sales Report
              </button>
              <button
                onClick={() => setActiveTab('products')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'products' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                🛍️ Product Performance
              </button>
              <button
                onClick={() => setActiveTab('staff')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'staff' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                👥 Staff Performance
              </button>
              <button
                onClick={() => setActiveTab('inventory')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'inventory' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                📦 Inventory Reports
              </button>
            </div>
          </div>

          <div className="p-6">
            {activeTab === 'sales' && salesReport && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-slate-800">Sales Report</h2>
                  <button
                    onClick={exportSalesReport}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2"
                  >
                    📊 Export to Excel
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                    <p className="text-sm font-medium text-blue-900 mb-1">Total Sales</p>
                    <p className="text-3xl font-bold text-blue-600">₦{salesReport.total_sales?.toLocaleString() || '0'}</p>
                  </div>
                  <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                    <p className="text-sm font-medium text-green-900 mb-1">Total Transactions</p>
                    <p className="text-3xl font-bold text-green-600">{salesReport.total_count || 0}</p>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                    <p className="text-sm font-medium text-purple-900 mb-1">Average Sale</p>
                    <p className="text-3xl font-bold text-purple-600">₦{salesReport.average_sale?.toFixed(2) || '0'}</p>
                  </div>
                </div>

                {salesReport.daily_sales && salesReport.daily_sales.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-6">
                    <h3 className="text-xl font-bold text-slate-800 mb-4">Daily Sales Trend</h3>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={salesReport.daily_sales}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip formatter={(value: any) => `₦${value.toLocaleString()}`} />
                        <Legend />
                        <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name="Revenue" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {salesReport.payment_methods && salesReport.payment_methods.length > 0 && (
                  <div className="bg-slate-50 rounded-lg p-6">
                    <h3 className="text-xl font-bold text-slate-800 mb-4">Payment Methods</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {salesReport.payment_methods.map((method: any) => (
                        <div key={method.method} className="bg-white rounded-lg p-4 border border-slate-200">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-slate-800">{method.method}</p>
                              <p className="text-sm text-slate-600">{method.count} transactions</p>
                            </div>
                            <p className="text-xl font-bold text-blue-600">₦{method.total.toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'products' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Top Selling Products</h2>
                  <button
                    onClick={exportProductsReport}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2"
                  >
                    📊 Export to Excel
                  </button>
                </div>
                {topProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-xl font-semibold text-slate-700">No Product Sales</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-slate-50 rounded-lg p-6">
                      <h3 className="text-lg font-bold text-slate-800 mb-4">Revenue by Product</h3>
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart data={topProducts.slice(0, 10)}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                          <YAxis />
                          <Tooltip formatter={(value: any) => `₦${value.toLocaleString()}`} />
                          <Legend />
                          <Bar dataKey="total_revenue" fill="#3b82f6" name="Revenue" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Product</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Category</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Quantity Sold</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Revenue</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Sales Count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topProducts.map((product: any) => (
                            <tr key={product.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-800">{product.name}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                  {product.category}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{product.total_quantity}</td>
                              <td className="px-4 py-3 font-bold text-blue-600">₦{product.total_revenue.toLocaleString()}</td>
                              <td className="px-4 py-3 text-slate-700">{product.sale_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'staff' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Staff Performance</h2>
                  <button
                    onClick={exportStaffReport}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2"
                  >
                    📊 Export to Excel
                  </button>
                </div>
                {staffPerformance.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-xl font-semibold text-slate-700">No Staff Performance Data</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-slate-50 rounded-lg p-6">
                      <h3 className="text-lg font-bold text-slate-800 mb-4">Revenue by Staff</h3>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={staffPerformance}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="name" />
                          <YAxis />
                          <Tooltip formatter={(value: any) => `₦${value.toLocaleString()}`} />
                          <Legend />
                          <Bar dataKey="total_revenue" fill="#10b981" name="Revenue" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Staff Name</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Role</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Sales Count</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Total Revenue</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Average Sale</th>
                          </tr>
                        </thead>
                        <tbody>
                          {staffPerformance.map((staff: any) => (
                            <tr key={staff.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-3 font-semibold text-slate-800">{staff.name || 'Unknown'}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                                  {staff.role}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-700">{staff.sale_count}</td>
                              <td className="px-4 py-3 font-bold text-green-600">₦{staff.total_revenue.toLocaleString()}</td>
                              <td className="px-4 py-3 text-slate-700">₦{staff.average_sale.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'inventory' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Inventory Reports</h2>
                  <button
                    onClick={exportInventoryMovements}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium flex items-center gap-2"
                  >
                    📊 Export to Excel
                  </button>
                </div>

                {/* Inventory Summary */}
                {inventorySummary && (
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-6">
                    <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                      <p className="text-sm font-medium text-blue-900 mb-1">Total Products</p>
                      <p className="text-3xl font-bold text-blue-600">{inventorySummary.total_products || 0}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-6 border border-green-200">
                      <p className="text-sm font-medium text-green-900 mb-1">Total Stock Value</p>
                      <p className="text-3xl font-bold text-green-600">₦{inventorySummary.total_stock_value?.toLocaleString() || '0'}</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                      <p className="text-sm font-medium text-purple-900 mb-1">Total Stock Qty</p>
                      <p className="text-3xl font-bold text-purple-600">{inventorySummary.total_stock_quantity || 0}</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-6 border border-amber-200">
                      <p className="text-sm font-medium text-amber-900 mb-1">Low Stock</p>
                      <p className="text-3xl font-bold text-amber-600">{inventorySummary.low_stock_count || 0}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-6 border border-red-200">
                      <p className="text-sm font-medium text-red-900 mb-1">Out of Stock</p>
                      <p className="text-3xl font-bold text-red-600">{inventorySummary.out_of_stock_count || 0}</p>
                    </div>
                  </div>
                )}

                {/* Inventory Movements */}
                <div className="bg-slate-50 rounded-lg p-6 mb-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-slate-800">Stock Movements</h3>
                    <button
                      onClick={exportInventoryMovements}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm"
                    >
                      📊 Export
                    </button>
                  </div>
                {/* Inventory Movements Table */}
                {inventoryMovements.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">📦</div>
                    <p className="text-xl font-semibold text-slate-700">No Inventory Movements</p>
                    <p className="text-slate-600 mt-2">No inventory transactions found in the selected date range</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Date</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Product</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Category</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Type</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Quantity</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Reason</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">User</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventoryMovements.map((movement: any) => {
                          const isPositive = movement.quantity > 0
                          return (
                            <tr key={movement.id} className="border-b border-slate-100 hover:bg-slate-50">
                              <td className="px-4 py-3 text-sm text-slate-700">{movement.created_at}</td>
                              <td className="px-4 py-3 font-semibold text-slate-800">{movement.product_name}</td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                  {movement.category}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                  movement.transaction_type.includes('IN') || movement.transaction_type.includes('TRANSFER') 
                                    ? 'bg-green-100 text-green-700' 
                                    : 'bg-red-100 text-red-700'
                                }`}>
                                  {movement.transaction_type}
                                </span>
                              </td>
                              <td className={`px-4 py-3 font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                                {isPositive ? '+' : ''}{movement.quantity}
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-600">{movement.reason || '-'}</td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                {movement.user_name || 'Unknown'} ({movement.user_role})
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PendingItemsDashboard({ currentUser, businessInfo }: { currentUser: any, businessInfo: any }) {
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'summary' | 'sales' | 'low_stock' | 'out_of_stock'>('summary')
  const [summary, setSummary] = useState<any>(null)
  const [pendingSales, setPendingSales] = useState<any[]>([])
  const [lowStockProducts, setLowStockProducts] = useState<any[]>([])
  const [outOfStockProducts, setOutOfStockProducts] = useState<any[]>([])

  const businessId = currentUser?.business_id || businessInfo?.id

  useEffect(() => {
    if (businessId) {
      loadAllData()
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
      setSummary(summaryData)
      setPendingSales(sales)
      setLowStockProducts(lowStock)
      setOutOfStockProducts(outOfStock)
    } catch (error) {
      console.error('Failed to load pending items:', error)
      toast.error('Failed to load pending items')
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
      console.error('Failed to mark sale as completed:', error)
      toast.error(`Failed to mark sale as completed: ${error}`)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50">
        <div className="p-8 w-full">
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading pending items...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="p-8 w-full max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 mb-2">📋 Pending Items Dashboard</h1>
          <p className="text-slate-600 text-lg">View and manage all pending tasks and alerts</p>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Total Pending</p>
                  <p className="text-3xl font-bold text-slate-800">{summary.total_pending || 0}</p>
                </div>
                <div className="text-4xl">📋</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Pending Sales</p>
                  <p className="text-3xl font-bold text-blue-600">{summary.pending_sales || 0}</p>
                </div>
                <div className="text-4xl">💰</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Low Stock</p>
                  <p className="text-3xl font-bold text-amber-600">{summary.low_stock_products || 0}</p>
                </div>
                <div className="text-4xl">⚠️</div>
              </div>
            </div>
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6 hover:shadow-xl transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-600 mb-1">Out of Stock</p>
                  <p className="text-3xl font-bold text-red-600">{summary.out_of_stock_products || 0}</p>
                </div>
                <div className="text-4xl">🚨</div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 mb-6">
          <div className="border-b border-slate-200">
            <div className="flex space-x-1 p-2">
              <button
                onClick={() => setActiveTab('summary')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                  activeTab === 'summary'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                📊 Summary
              </button>
              <button
                onClick={() => setActiveTab('sales')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors relative ${
                  activeTab === 'sales'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                💰 Pending Sales
                {summary?.pending_sales > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                    {summary.pending_sales}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('low_stock')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors relative ${
                  activeTab === 'low_stock'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                ⚠️ Low Stock
                {summary?.low_stock_products > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-amber-500 text-white text-xs rounded-full">
                    {summary.low_stock_products}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('out_of_stock')}
                className={`px-6 py-3 rounded-lg font-medium transition-colors relative ${
                  activeTab === 'out_of_stock'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                🚨 Out of Stock
                {summary?.out_of_stock_products > 0 && (
                  <span className="ml-2 px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                    {summary.out_of_stock_products}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'summary' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-slate-800 mb-4">Overview</h2>
                
                {/* Pending Sales Summary */}
                <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-blue-900">💰 Pending Sales</h3>
                    <span className="px-3 py-1 bg-blue-600 text-white rounded-full font-bold">
                      {summary?.pending_sales || 0}
                    </span>
                  </div>
                  {pendingSales.length > 0 ? (
                    <div className="space-y-2">
                      {pendingSales.slice(0, 3).map((sale: any) => (
                        <div key={sale.id} className="bg-white rounded-lg p-4 flex items-center justify-between">
                          <div>
                            <p className="font-semibold text-slate-800">Sale #{sale.id}</p>
                            <p className="text-sm text-slate-600">
                              {sale.user_name || 'Unknown'} • {sale.item_count} items • ₦{sale.total_amount.toLocaleString()}
                            </p>
                            <p className="text-xs text-slate-500">{sale.created_at}</p>
                          </div>
                          <button
                            onClick={() => handleMarkSaleCompleted(sale.id)}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                          >
                            Mark Complete
                          </button>
                        </div>
                      ))}
                      {pendingSales.length > 3 && (
                        <p className="text-sm text-slate-600 text-center pt-2">
                          +{pendingSales.length - 3} more pending sales
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-600">No pending sales</p>
                  )}
                </div>

                {/* Low Stock Summary */}
                <div className="bg-amber-50 rounded-lg p-6 border border-amber-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-amber-900">⚠️ Low Stock Products</h3>
                    <span className="px-3 py-1 bg-amber-600 text-white rounded-full font-bold">
                      {summary?.low_stock_products || 0}
                    </span>
                  </div>
                  {lowStockProducts.length > 0 ? (
                    <div className="space-y-2">
                      {lowStockProducts.slice(0, 3).map((product: any) => (
                        <div key={product.id} className="bg-white rounded-lg p-4">
                          <p className="font-semibold text-slate-800">{product.name}</p>
                          <div className="flex gap-4 mt-2 text-sm">
                            <span className="text-slate-600">Fridge: <strong className={product.fridge_stock <= product.min_stock_level ? 'text-red-600' : ''}>{product.fridge_stock}</strong></span>
                            <span className="text-slate-600">Show: <strong className={product.show_stock <= product.min_stock_level ? 'text-red-600' : ''}>{product.show_stock}</strong></span>
                            <span className="text-slate-600">Store: <strong className={product.store_stock <= product.min_stock_level ? 'text-red-600' : ''}>{product.store_stock}</strong></span>
                            <span className="text-slate-600">Min: {product.min_stock_level}</span>
                          </div>
                        </div>
                      ))}
                      {lowStockProducts.length > 3 && (
                        <p className="text-sm text-slate-600 text-center pt-2">
                          +{lowStockProducts.length - 3} more low stock products
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-600">No low stock products</p>
                  )}
                </div>

                {/* Out of Stock Summary */}
                <div className="bg-red-50 rounded-lg p-6 border border-red-200">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-red-900">🚨 Out of Stock Products</h3>
                    <span className="px-3 py-1 bg-red-600 text-white rounded-full font-bold">
                      {summary?.out_of_stock_products || 0}
                    </span>
                  </div>
                  {outOfStockProducts.length > 0 ? (
                    <div className="space-y-2">
                      {outOfStockProducts.slice(0, 3).map((product: any) => (
                        <div key={product.id} className="bg-white rounded-lg p-4">
                          <p className="font-semibold text-slate-800">{product.name}</p>
                          <p className="text-sm text-red-600 mt-1">Completely out of stock - urgent restock needed!</p>
                        </div>
                      ))}
                      {outOfStockProducts.length > 3 && (
                        <p className="text-sm text-slate-600 text-center pt-2">
                          +{outOfStockProducts.length - 3} more out of stock products
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-600">No out of stock products</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'sales' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Pending Sales</h2>
                  <button
                    onClick={loadAllData}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                  >
                    🔄 Refresh
                  </button>
                </div>
                {pendingSales.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">✅</div>
                    <p className="text-xl font-semibold text-slate-700">No Pending Sales</p>
                    <p className="text-slate-600 mt-2">All sales have been completed!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {pendingSales.map((sale: any) => (
                      <div key={sale.id} className="bg-slate-50 rounded-lg p-6 border border-slate-200 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-4 mb-3">
                              <h3 className="text-xl font-bold text-slate-800">Sale #{sale.id}</h3>
                              <span className="px-3 py-1 bg-amber-500 text-white rounded-full text-sm font-semibold">
                                PENDING
                              </span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-slate-600">Total Amount</p>
                                <p className="font-bold text-lg text-blue-600">₦{sale.total_amount.toLocaleString()}</p>
                              </div>
                              <div>
                                <p className="text-slate-600">Items</p>
                                <p className="font-semibold text-slate-800">{sale.item_count}</p>
                              </div>
                              <div>
                                <p className="text-slate-600">Payment Method</p>
                                <p className="font-semibold text-slate-800">{sale.payment_method}</p>
                              </div>
                              <div>
                                <p className="text-slate-600">Staff</p>
                                <p className="font-semibold text-slate-800">{sale.user_name || 'Unknown'}</p>
                              </div>
                            </div>
                            <div className="mt-3">
                              <p className="text-xs text-slate-500">Created: {sale.created_at}</p>
                              {sale.notes && (
                                <p className="text-sm text-slate-600 mt-1">Notes: {sale.notes}</p>
                              )}
                            </div>
                          </div>
                          <div className="ml-6">
                            <button
                              onClick={() => handleMarkSaleCompleted(sale.id)}
                              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                            >
                              ✅ Mark Complete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'low_stock' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Low Stock Products</h2>
                  <button
                    onClick={loadAllData}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                  >
                    🔄 Refresh
                  </button>
                </div>
                {lowStockProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">✅</div>
                    <p className="text-xl font-semibold text-slate-700">No Low Stock Products</p>
                    <p className="text-slate-600 mt-2">All products are well stocked!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Product Name</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Category</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Fridge Stock</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Show Stock</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Store Stock</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lowStockProducts.map((product: any) => {
                          const isLow = product.fridge_stock <= product.min_stock_level || 
                                       product.show_stock <= product.min_stock_level ||
                                       product.store_stock <= product.min_stock_level
                          return (
                            <tr key={product.id} className={isLow ? 'bg-red-50' : ''}>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">{product.name}</div>
                                {product.description && (
                                  <div className="text-xs text-slate-500 mt-1">{product.description}</div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                  {product.category}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className={`font-semibold ${product.fridge_stock <= product.min_stock_level ? 'text-red-600' : 'text-slate-700'}`}>
                                  {product.fridge_stock} / {product.min_stock_level}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className={`font-semibold ${product.show_stock <= product.min_stock_level ? 'text-red-600' : 'text-slate-700'}`}>
                                  {product.show_stock} / {product.min_stock_level}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className={`font-semibold ${product.store_stock <= product.min_stock_level ? 'text-red-600' : 'text-slate-700'}`}>
                                  {product.store_stock} / {product.min_stock_level}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-semibold text-slate-800">₦{product.price.toLocaleString()}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'out_of_stock' && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">Out of Stock Products</h2>
                  <button
                    onClick={loadAllData}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium"
                  >
                    🔄 Refresh
                  </button>
                </div>
                {outOfStockProducts.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="text-6xl mb-4">✅</div>
                    <p className="text-xl font-semibold text-slate-700">No Out of Stock Products</p>
                    <p className="text-slate-600 mt-2">All products have stock available!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Product Name</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Category</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Stock Status</th>
                          <th className="px-4 py-3 text-left text-sm font-semibold text-slate-700">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {outOfStockProducts.map((product: any) => (
                          <tr key={product.id} className="bg-red-50">
                            <td className="px-4 py-3">
                              <div className="font-semibold text-red-600">{product.name}</div>
                              {product.description && (
                                <div className="text-xs text-slate-500 mt-1">{product.description}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                {product.category}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-3 py-1 bg-red-600 text-white rounded-full text-sm font-bold">
                                OUT OF STOCK
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-800">₦{product.price.toLocaleString()}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
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

function ImportProductsModal({ onClose, onImportComplete, businessId }: {
  onClose: () => void
  onImportComplete: () => void
  businessId: number
}) {
  const [importing, setImporting] = useState(false)
  const [importResults, setImportResults] = useState<any>(null)

  const downloadTemplate = () => {
    try {
      console.log('Starting template download...')

      // Create a sample CSV template with proper formatting
      const csvContent = `Product Name,Description,Category,Selling Price,Cost Price,Stock Quantity,Min Stock Level,Barcode
Beer Sample,Sample beer description,BAR,500,300,50,10,123456789
Wine Sample,Sample wine description,BAR,2000,1200,25,5,987654321
Burger Sample,Sample burger description,KITCHEN,1500,800,30,5,456789123
Room Service Sample,Sample room service,ROOM,5000,2500,10,2,789123456
Cocktail Sample,Sample cocktail,BAR,1800,900,20,3,321654987
Juice Sample,Fresh orange juice,BAR,800,400,40,8,654987321
Pizza Sample,Margherita pizza,KITCHEN,2500,1200,15,3,987321654
Spa Treatment Sample,Full body massage,ROOM,15000,5000,5,1,147258369`

      console.log('CSV content created, length:', csvContent.length)

      // Check if browser supports downloads
      const supportsDownload = 'download' in document.createElement('a')

      console.log('Browser supports download attribute:', supportsDownload)

      // Try multiple download methods for better compatibility
      try {
        // Method 1: Standard blob download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = window.URL.createObjectURL(blob)

        console.log('Blob created, size:', blob.size, 'bytes')
        console.log('Blob URL created:', url)

        // Create and trigger download
        const a = document.createElement('a')
        a.href = url
        a.download = 'product_import_template.csv'
        a.style.display = 'none'

        // Add click event listener for debugging
        a.addEventListener('click', () => {
          console.log('Download link clicked')
        })

        document.body.appendChild(a)
        console.log('Download link created and added to DOM')

        // Force download
        console.log('Triggering click...')
        a.click()
        console.log('Click triggered')

        // Give the browser time to process the download
        setTimeout(() => {
          document.body.removeChild(a)
          console.log('Download element removed from DOM')
        }, 100)

        // Cleanup blob URL after a longer delay
        setTimeout(() => {
          window.URL.revokeObjectURL(url)
          console.log('Blob URL cleaned up')
        }, 10000) // Increased delay to ensure download completes

        console.log('Download initiated successfully')

      } catch (error) {
        console.error('Primary download method failed, trying fallback:', error)

        // Method 2: Data URL fallback (for older browsers)
        try {
          const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent)
          const a = document.createElement('a')
          a.href = dataUrl
          a.download = 'product_import_template.csv'
          a.style.display = 'none'
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          console.log('Fallback download method succeeded')
        } catch (fallbackError) {
          console.error('Primary download methods failed:', fallbackError)

          // Method 3: Open in new tab as last resort
          try {
            const dataUrl = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent)
            const newWindow = window.open(dataUrl, '_blank')

            if (newWindow) {
              console.log('File opened in new tab')
              toast('Template opened in new tab. Right-click and "Save as..." to download as CSV file.', {
              duration: 6000,
            })
              return
            } else {
              console.error('Popup blocked or failed to open')
            }
          } catch (tabError) {
            console.error('All download methods failed:', tabError)
          }

          throw new Error('Download failed with all available methods')
        }
      }

      console.log('Template download completed successfully')

      // Show detailed success message with location info
      toast.success(`Template downloaded successfully!

📂 Check your browser's Downloads folder
Open with Excel, Google Sheets, or any CSV editor.`, {
        duration: 6000,
      })

    } catch (error) {
      console.error('Template download failed:', error)
      toast.error('Failed to download template. Please try again.')
    }
  }

  // Simple CSV parser that handles quoted fields
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          // Escaped quote
          current += '"'
          i++ // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes
        }
      } else if (char === ',' && !inQuotes) {
        // Field separator
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }

    // Add the last field
    result.push(current.trim())
    return result
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setImporting(true)
    try {
      const text = await file.text()
      const lines = text.split('\n').filter(line => line.trim())
      const headers = parseCSVLine(lines[0])

      console.log('Parsed headers:', headers)

      // Validate headers
      const requiredHeaders = ['Product Name', 'Category', 'Selling Price', 'Cost Price', 'Stock Quantity']
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))

      if (missingHeaders.length > 0) {
        toast.error(`Missing required columns: ${missingHeaders.join(', ')}\n\nExpected: ${requiredHeaders.join(', ')}`, {
          duration: 8000,
        })
        setImporting(false)
        return
      }

      // Parse products
      let successCount = 0
      let errorCount = 0
      const errors: string[] = []

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i])
        console.log(`Row ${i + 1} values:`, values)

        if (values.length < 5) {
          errors.push(`Row ${i + 1}: Not enough columns (found ${values.length}, need at least 5)`)
          errorCount++
          continue
        }

        try {
          const product = {
            name: values[0] || '',
            description: values[1] || '',
            category: values[2] || '',
            price: parseFloat(values[3]) || 0,
            cost_price: parseFloat(values[4]) || 0,
            stock_quantity: parseInt(values[5]) || 0,
            min_stock_level: parseInt(values[6]) || 0,
            barcode: values[7] || '',
            business_id: businessId
          }

          // Validate required fields
          if (!product.name.trim() || !product.category.trim() || isNaN(product.price) || isNaN(product.cost_price)) {
            errors.push(`Row ${i + 1}: Missing or invalid required fields (Name: "${product.name}", Category: "${product.category}", Price: ${product.price}, Cost: ${product.cost_price})`)
            errorCount++
            continue
          }

          console.log(`Creating product:`, product)

          // Import product
          await invoke('create_product', { request: product })
          successCount++
        } catch (error) {
          console.error(`Error on row ${i + 1}:`, error)
          errors.push(`Row ${i + 1}: ${error}`)
          errorCount++
        }
      }

      setImportResults({
        successCount,
        errorCount,
        errors: errors.slice(0, 10) // Show first 10 errors
      })

      if (successCount > 0) {
        toast.success(`Successfully imported ${successCount} product(s)!`, {
          duration: 3000,
        })
        // Wait a bit to ensure database commits, then refresh
        setTimeout(() => {
          onImportComplete()
        }, 500)
      } else if (errorCount > 0) {
        toast.error(`Failed to import ${errorCount} product(s). Check the errors below.`, {
          duration: 5000,
        })
      }

    } catch (error) {
      console.error('Import failed:', error)
      toast.error('Failed to import products. Please check your file format.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800">Import Products from Excel</h2>
            <button
              onClick={onClose}
              disabled={importing}
              className="text-slate-400 hover:text-slate-600 text-2xl disabled:opacity-50"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-800 mb-2">📋 Import Instructions</h3>
            <ol className="text-blue-700 text-sm space-y-1">
              <li>1. Download the CSV template below</li>
              <li>2. Fill in your product data following the format</li>
              <li>3. Upload your completed CSV file</li>
              <li>4. Review and confirm the import</li>
            </ol>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-800 mb-3">📊 CSV Template Format</h3>
            <div className="bg-white border border-slate-300 rounded p-3 font-mono text-xs text-slate-700 overflow-x-auto">
              Product Name,Description,Category,Selling Price,Cost Price,Stock Quantity,Min Stock Level,Barcode<br/>
              Beer Sample,Sample beer,BAR,500,300,50,10,123456789<br/>
              Burger Sample,Sample burger,KITCHEN,1500,800,30,5,456789123
            </div>
            <div className="mt-3 text-sm text-slate-600">
              <strong>Required:</strong> Product Name, Category, Selling Price, Cost Price<br/>
              <strong>Categories:</strong> BAR, KITCHEN, ROOM (based on your business setup)
            </div>
          </div>

          <div className="flex space-x-4">
            <button
              onClick={downloadTemplate}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              📥 Download Template
            </button>

            <div className="flex-1">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={importing}
                className="hidden"
                id="csv-upload"
              />
              <label
                htmlFor="csv-upload"
                className={`block w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium transition-colors text-center cursor-pointer ${
                  importing ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {importing ? '📤 Importing...' : '📤 Upload CSV File'}
              </label>
            </div>
          </div>

          {importResults && (
            <div className={`border rounded-lg p-4 ${
              importResults.errorCount === 0
                ? 'bg-green-50 border-green-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <h4 className={`font-semibold mb-2 ${
                importResults.errorCount === 0 ? 'text-green-800' : 'text-yellow-800'
              }`}>
                📊 Import Results
              </h4>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>✅ Successfully imported:</span>
                  <span className="font-medium text-green-600">{importResults.successCount} products</span>
                </div>
                {importResults.errorCount > 0 && (
                  <div className="flex justify-between">
                    <span>❌ Failed to import:</span>
                    <span className="font-medium text-red-600">{importResults.errorCount} products</span>
                  </div>
                )}
              </div>

              {importResults.errors.length > 0 && (
                <div className="mt-3">
                  <h5 className="font-medium text-red-800 mb-2">Error Details:</h5>
                  <div className="bg-red-50 border border-red-200 rounded p-2 max-h-32 overflow-y-auto">
                    {importResults.errors.map((error: string, index: number) => (
                      <div key={index} className="text-xs text-red-700">{error}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex space-x-3 pt-4 border-t border-slate-200">
            <button
              onClick={onClose}
              disabled={importing}
              className="flex-1 bg-slate-200 hover:bg-slate-300 disabled:bg-slate-100 disabled:text-slate-400 text-slate-700 py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Add Staff Modal Component
function AddStaffModal({ onClose, onSave, staffLimits }: {
  onClose: () => void
  onSave: (staffData: any) => void
  staffLimits: any
}) {
  const [formData, setFormData] = useState({
    username: '',
    name: '',
    email: '',
    role: 'Staff'
  })

  const updateFormData = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    // Validate staff limits
    if (formData.role === 'Manager' && staffLimits.available.manager <= 0) {
      toast.error('Manager limit reached')
      return
    }
    if (formData.role === 'Secretary' && staffLimits.available.secretary <= 0) {
      toast.error('Secretary limit reached')
      return
    }
    if (formData.role === 'Staff' && staffLimits.available.staff <= 0) {
      toast.error('Staff limit reached')
      return
    }

    onSave(formData)
  }

  const canAddRole = (role: string) => {
    switch (role) {
      case 'Manager': return staffLimits.available.manager > 0
      case 'Secretary': return staffLimits.available.secretary > 0
      case 'Staff': return staffLimits.available.staff > 0
      default: return true
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-slate-800">Add Staff Member</h2>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 text-2xl"
            >
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Username *
            </label>
            <input
              type="text"
              required
              value={formData.username}
              onChange={(e) => updateFormData('username', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Full Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => updateFormData('name', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => updateFormData('email', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter email (optional)"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Role *
            </label>
            <select
              value={formData.role}
              onChange={(e) => updateFormData('role', e.target.value)}
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Staff" disabled={!canAddRole('Staff')}>
                Staff {staffLimits.available.staff <= 0 ? '(Limit reached)' : `(${staffLimits.staff}/${staffLimits.limits.max_staff})`}
              </option>
              <option value="Manager" disabled={!canAddRole('Manager')}>
                Manager {staffLimits.available.manager <= 0 ? '(Limit reached)' : `(${staffLimits.manager}/${staffLimits.limits.max_manager})`}
              </option>
              <option value="Secretary" disabled={!canAddRole('Secretary')}>
                Secretary {staffLimits.available.secretary <= 0 ? '(Limit reached)' : `(${staffLimits.secretary}/${staffLimits.limits.max_secretary})`}
              </option>
            </select>
          </div>

          <div className="flex space-x-4 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-700 py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
            >
              Add Staff
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default App
